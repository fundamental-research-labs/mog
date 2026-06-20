use cell_types::{IdAllocator, PayloadEncoding, SheetId};
use compute_layout_index::LayoutIndex;
use rustc_hash::FxHashMap;
use std::sync::Arc;
use value_types::ComputeError;

use crate::identity::GridIndex;
use crate::mirror::{CellMirror, range_view::ColDataState};
use crate::range_manager::RangeSpatialIndex;
use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};
use crate::storage::YrsStorage;
use crate::storage::sheet::{merges, visibility};

use crate::storage::engine::build_grid_from_yrs_for_sheet;
use crate::storage::engine::merge_index::{MergeRangeRef, MergeSpatialItem};
use crate::storage::engine::services;
use crate::storage::engine::stores::EngineStores;

use super::{
    build_layout_index_for_sheet, build_sheet_snapshot_from_yrs, hydrate_mirror_format_ranges,
};

pub(in crate::storage::engine) struct RebuiltSheetRuntime {
    pub sheet_id: SheetId,
    pub sheet_snapshot: SheetSnapshot,
    pub grid_index: GridIndex,
    pub layout_index: LayoutIndex,
    pub merge_index: RangeSpatialIndex<MergeSpatialItem>,
}

pub(in crate::storage::engine) fn rebuild_sheet_runtime_from_yrs(
    storage: &YrsStorage,
    sheet_id: SheetId,
    grid_id_alloc: Arc<IdAllocator>,
) -> Result<Option<RebuiltSheetRuntime>, ComputeError> {
    let Some(sheet_snapshot) = build_sheet_snapshot_from_yrs(storage, &sheet_id)? else {
        return Ok(None);
    };
    let grid_index =
        build_grid_from_yrs_for_sheet(storage, sheet_id, &sheet_snapshot, grid_id_alloc)?;
    let layout_index = build_layout_index_for_sheet(
        storage,
        &sheet_id,
        sheet_snapshot.rows,
        sheet_snapshot.cols,
        Some(&grid_index),
    );
    let merge_index = build_merge_index_for_sheet(storage, sheet_id, &grid_index);

    Ok(Some(RebuiltSheetRuntime {
        sheet_id,
        sheet_snapshot,
        grid_index,
        layout_index,
        merge_index,
    }))
}

pub(in crate::storage::engine) fn finalize_rebuilt_sheet_runtimes(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    rebuilt: Vec<RebuiltSheetRuntime>,
) -> Result<(), ComputeError> {
    let affected_sheet_ids: Vec<SheetId> = rebuilt.iter().map(|runtime| runtime.sheet_id).collect();

    for runtime in rebuilt {
        stores
            .grid_indexes
            .insert(runtime.sheet_id, runtime.grid_index);
        stores
            .layout_indexes
            .insert(runtime.sheet_id, runtime.layout_index);
        stores
            .merge_indexes
            .insert(runtime.sheet_id, runtime.merge_index);

        mirror.remove_sheet(&runtime.sheet_id);
        mirror.add_sheet(runtime.sheet_snapshot)?;

        let enabled = visibility::is_sheet_calculation_enabled(
            stores.storage.doc(),
            stores.storage.sheets(),
            &runtime.sheet_id,
        );
        mirror.set_enable_calculation(&runtime.sheet_id, enabled);
    }

    install_ordered_row_col_indexes(mirror, &stores.grid_indexes);
    hydrate_mirror_format_ranges(&stores.storage, mirror);
    mirror.finalize_range_hydration();

    for sheet_id in &affected_sheet_ids {
        services::mutation::sync_mirror_merge_regions(stores, mirror, sheet_id);
        validate_rebuilt_sheet_runtime(stores, mirror, sheet_id)?;
    }

    Ok(())
}

pub(in crate::storage::engine) fn build_finalized_mirror_from_snapshot(
    storage: &YrsStorage,
    snapshot: &WorkbookSnapshot,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
) -> Result<CellMirror, ComputeError> {
    let mut mirror = CellMirror::from_snapshot(snapshot.clone())?;
    install_ordered_row_col_indexes(&mut mirror, grid_indexes);
    sync_enable_calculation_flags_for_mirror(storage, &mut mirror);
    hydrate_mirror_format_ranges(storage, &mut mirror);
    mirror.finalize_range_hydration();
    Ok(mirror)
}

pub(in crate::storage::engine) fn install_ordered_row_col_indexes(
    mirror: &mut CellMirror,
    grid_indexes: &FxHashMap<SheetId, GridIndex>,
) {
    mirror.install_row_col_indexes(
        grid_indexes
            .iter()
            .map(|(sid, grid)| (*sid, grid.row_ids_ordered(), grid.col_ids_ordered())),
    );
}

pub(in crate::storage::engine) fn sync_enable_calculation_flags_for_mirror(
    storage: &YrsStorage,
    mirror: &mut CellMirror,
) {
    let sheet_ids: Vec<_> = mirror.sheet_ids().copied().collect();
    for sheet_id in sheet_ids {
        let enabled =
            visibility::is_sheet_calculation_enabled(storage.doc(), storage.sheets(), &sheet_id);
        mirror.set_enable_calculation(&sheet_id, enabled);
    }
}

fn build_merge_index_for_sheet(
    storage: &YrsStorage,
    sheet_id: SheetId,
    grid_index: &GridIndex,
) -> RangeSpatialIndex<MergeSpatialItem> {
    let resolved = merges::get_all_merges(storage.doc(), storage.sheets(), sheet_id, grid_index);
    let items = resolved
        .iter()
        .map(|merge| MergeSpatialItem {
            id: merge.merge.top_left_id.clone(),
            start_row: merge.start_row,
            start_col: merge.start_col,
            end_row: merge.end_row,
            end_col: merge.end_col,
            range_ref: MergeRangeRef {
                start_row: merge.start_row,
                start_col: merge.start_col,
                end_row: merge.end_row,
                end_col: merge.end_col,
            },
        })
        .collect();
    RangeSpatialIndex::with_items(items)
}

fn validate_rebuilt_sheet_runtime(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Result<(), ComputeError> {
    let Some(grid) = stores.grid_indexes.get(sheet_id) else {
        return Err(ComputeError::InternalPanic {
            message: format!(
                "rebuilt sheet {} missing GridIndex",
                sheet_id.to_uuid_string()
            ),
        });
    };
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Err(ComputeError::InternalPanic {
            message: format!(
                "rebuilt sheet {} missing CellMirror sheet",
                sheet_id.to_uuid_string()
            ),
        });
    };

    if sheet.row_to_index.len() != grid.row_count() as usize {
        return Err(ComputeError::InternalPanic {
            message: format!(
                "rebuilt sheet {} row identity mismatch: mirror={} grid={}",
                sheet_id.to_uuid_string(),
                sheet.row_to_index.len(),
                grid.row_count()
            ),
        });
    }
    if sheet.col_to_index.len() != grid.col_count() as usize {
        return Err(ComputeError::InternalPanic {
            message: format!(
                "rebuilt sheet {} column identity mismatch: mirror={} grid={}",
                sheet_id.to_uuid_string(),
                sheet.col_to_index.len(),
                grid.col_count()
            ),
        });
    }

    for range_view in sheet.range_views.values() {
        let mut representative = None;

        for row_id in range_view.row_offset_by_id.keys() {
            if !sheet.row_to_index.contains_key(row_id) {
                return Err(ComputeError::InternalPanic {
                    message: format!(
                        "rebuilt sheet {} range {} has unresolved row identity",
                        sheet_id.to_uuid_string(),
                        range_view.range_id.to_uuid_string()
                    ),
                });
            }
        }
        for col_id in range_view.col_offset_by_id.keys() {
            let Some(&col_index) = sheet.col_to_index.get(col_id) else {
                return Err(ComputeError::InternalPanic {
                    message: format!(
                        "rebuilt sheet {} range {} has unresolved column identity",
                        sheet_id.to_uuid_string(),
                        range_view.range_id.to_uuid_string()
                    ),
                });
            };
            if range_view.encoding != PayloadEncoding::None {
                let Some(col_state) = sheet.col_data_state.get(&col_index) else {
                    return Err(ComputeError::InternalPanic {
                        message: format!(
                            "rebuilt sheet {} range {} column {} missing rebuilt col_data",
                            sheet_id.to_uuid_string(),
                            range_view.range_id.to_uuid_string(),
                            col_index
                        ),
                    });
                };
                if *col_state != ColDataState::Complete {
                    return Err(ComputeError::InternalPanic {
                        message: format!(
                            "rebuilt sheet {} range {} column {} has incomplete col_data",
                            sheet_id.to_uuid_string(),
                            range_view.range_id.to_uuid_string(),
                            col_index
                        ),
                    });
                }
            }
        }

        for row_id in range_view.row_offset_by_id.keys() {
            let Some(&row_index) = sheet.row_to_index.get(row_id) else {
                continue;
            };
            for col_id in range_view.col_offset_by_id.keys() {
                let Some(&col_index) = sheet.col_to_index.get(col_id) else {
                    continue;
                };
                representative = Some((row_index, col_index));
                break;
            }
            if representative.is_some() {
                break;
            }
        }

        if let Some((row, col)) = representative {
            let covers_range = sheet
                .range_spatial_index
                .query(row, col)
                .iter()
                .any(|extent| extent.range_id == range_view.range_id);
            if !covers_range {
                return Err(ComputeError::InternalPanic {
                    message: format!(
                        "rebuilt sheet {} range {} missing from range spatial index",
                        sheet_id.to_uuid_string(),
                        range_view.range_id.to_uuid_string()
                    ),
                });
            }
        }
    }

    for (cell_id, owner) in mirror.cell_to_sheet_entries() {
        if owner == sheet_id && mirror.resolve_position(cell_id).is_none() {
            return Err(ComputeError::InternalPanic {
                message: format!(
                    "rebuilt sheet {} left stale cell_to_sheet entry for {}",
                    sheet_id.to_uuid_string(),
                    cell_id.to_uuid_string()
                ),
            });
        }
    }

    let merge_index =
        stores
            .merge_indexes
            .get(sheet_id)
            .ok_or_else(|| ComputeError::InternalPanic {
                message: format!(
                    "rebuilt sheet {} missing merge spatial index",
                    sheet_id.to_uuid_string()
                ),
            })?;
    let merge_regions = mirror.get_merge_regions(sheet_id);
    if merge_index.items().len() != merge_regions.len() {
        return Err(ComputeError::InternalPanic {
            message: format!(
                "rebuilt sheet {} merge count mismatch: mirror={} index={}",
                sheet_id.to_uuid_string(),
                merge_regions.len(),
                merge_index.items().len()
            ),
        });
    }
    for merge in merge_regions {
        let found = merge_index.items().iter().any(|item| {
            item.start_row == merge.start_row
                && item.start_col == merge.start_col
                && item.end_row == merge.end_row
                && item.end_col == merge.end_col
        });
        if !found {
            return Err(ComputeError::InternalPanic {
                message: format!(
                    "rebuilt sheet {} mirror merge {}:{}-{}:{} missing from merge spatial index",
                    sheet_id.to_uuid_string(),
                    merge.start_row,
                    merge.start_col,
                    merge.end_row,
                    merge.end_col
                ),
            });
        }
    }

    Ok(())
}
