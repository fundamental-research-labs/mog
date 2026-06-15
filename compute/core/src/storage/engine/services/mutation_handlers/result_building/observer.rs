use std::collections::{HashMap, HashSet};

use cell_types::{CellId, SheetId};

use crate::mirror::CellMirror;
use crate::snapshot::{
    Axis, CellPosition, CfChange, ChangeKind, CommentChange, DimensionChange, FilterChange,
    FloatingObjectChange, FloatingObjectChangeKind, GroupingChange, MergeChange, MutationResult,
    NamedRangeChange, PivotTableChange, PropertyChange, RecalcResult, SheetChange,
    SheetChangeField, SheetSettingsChange, SlicerChange, SlicerChangeKind, SlicerSourceType,
    SortingChange, SparklineChange, TableChange, VisibilityChange, WorkbookSettingsChange,
};
use crate::storage::engine::services::structural::recompute_floating_object_bounds;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{
    comments as sheet_comments, dimensions, pivots, properties, settings, sparklines, view,
    visibility,
};
use crate::storage::workbook;
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::observe::{CellChangeKind, DocumentChanges};
use yrs::{Map, Transact};

use super::super::{
    observer_kind_to_change_kind, resolve_col_id_to_index, resolve_row_id_to_index,
};
use super::sheet_hydration::build_sheet_hydration_changes;

fn parse_cell_ref(cell_ref: &str) -> Option<CellId> {
    hex_to_id(cell_ref)
        .map(CellId::from_raw)
        .or_else(|| CellId::from_uuid_str(cell_ref).ok())
}

fn slicer_source_metadata(
    source: &domain_types::domain::slicer::SlicerSource,
) -> (SlicerSourceType, String) {
    match source {
        domain_types::domain::slicer::SlicerSource::Table { table_id, .. } => {
            (SlicerSourceType::Table, table_id.clone())
        }
        domain_types::domain::slicer::SlicerSource::Pivot { pivot_id, .. } => {
            (SlicerSourceType::Pivot, pivot_id.clone())
        }
    }
}

fn current_slicer_state(
    stores: &EngineStores,
    slicer_id: &str,
) -> Option<domain_types::domain::slicer::StoredSlicer> {
    let txn = stores.storage.doc().transact();
    let workbook = stores.storage.workbook_map();
    let slicers_map = match workbook.get(&txn, compute_document::schema::KEY_SLICERS) {
        Some(yrs::Out::YMap(map)) => map,
        _ => return None,
    };
    match slicers_map.get(&txn, slicer_id) {
        Some(yrs::Out::YMap(map)) => domain_types::yrs_schema::slicer::from_yrs_map(&map, &txn),
        _ => None,
    }
}

fn current_comment_cell_ref(
    stores: &EngineStores,
    sheet_id: &SheetId,
    comment_id: &str,
) -> Option<String> {
    sheet_comments::get_comment(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        comment_id,
    )
    .map(|comment| comment.cell_ref)
}

fn push_table_change_once(
    result: &mut MutationResult,
    name: String,
    table_id: Option<String>,
    sheet_id: String,
    kind: ChangeKind,
) {
    if result.table_changes.iter().any(|change| {
        change.name.eq_ignore_ascii_case(&name)
            && change.table_id.as_deref() == table_id.as_deref()
            && change.sheet_id == sheet_id
            && change.kind == kind
    }) {
        return;
    }

    result.table_changes.push(TableChange {
        name,
        table_id,
        sheet_id,
        kind,
    });
}

// ---------------------------------------------------------------------------
// build_mutation_result_from_changes
// ---------------------------------------------------------------------------

/// Build a complete [`MutationResult`] from a [`RecalcResult`] and
/// [`DocumentChanges`], reading current state from yrs for each change.
///
/// The `resolve_table_format_fn` callback handles table format resolution
/// which requires access to engine state beyond what's passed here.
pub(in crate::storage::engine) fn build_mutation_result_from_changes(
    stores: &EngineStores,
    mirror: &CellMirror,
    _settings: &EngineSettings,
    recalc: RecalcResult,
    changes: &DocumentChanges,
    resolve_table_format_fn: &dyn Fn(&SheetId, u32, u32) -> Option<domain_types::CellFormat>,
) -> MutationResult {
    let mut result = MutationResult::from_recalc(recalc);

    // --- Sheet lifecycle (additions / deletions) ---
    //
    // Observer-driven sheet additions (undo of a delete; remote sync
    // introducing a peer's new sheet) require the same MutationResult
    // shape as bootstrap / user-edit add / copy: a `SheetChange
    // { field: Sheet, kind: Set }` creation event plus the full
    // per-sheet hydration shape. Without this the kernel mirror never
    // re-introduces the restored sheet to `sheetMetaBySheet` /
    // `sheetOrder` / per-sheet projections — same architectural class
    // sync-paint/09 closed for the three live mutation handlers; this
    // is the fourth call site.
    //
    // Deletions emit `SheetChange { kind: Removed, field: Sheet }` so
    // the mirror's `applySheetChange` Removed arm calls `dropSheet(sid)`
    // to clear all per-sheet maps for the dropped sheet.
    for sid in &changes.sheet_additions {
        build_sheet_hydration_changes(stores, mirror, sid, None, &mut result);
    }
    for sid in &changes.sheet_deletions {
        result.sheet_changes.push(SheetChange {
            sheet_id: sid.to_uuid_string(),
            kind: ChangeKind::Removed,
            field: SheetChangeField::Sheet,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });
    }

    // --- Property changes ---
    //
    // Property removals can arrive in the same observer batch as a
    // gridIndex/posToId removal. apply_all_observer_changes applies that
    // removal before this result is built, so sparse cell_id -> position
    // lookups may fail. Preserve the position from the observer gridIndex
    // payload whenever it is available.
    let mut property_position_fallbacks: HashMap<(SheetId, CellId), CellPosition> = HashMap::new();
    for change in &changes.grid_index {
        let Some(row) = resolve_row_id_to_index(stores, &change.sheet_id, &change.row_hex) else {
            continue;
        };
        let Some(col) = resolve_col_id_to_index(stores, &change.sheet_id, &change.col_hex) else {
            continue;
        };
        property_position_fallbacks
            .entry((change.sheet_id, change.cell_id))
            .or_insert(CellPosition { row, col });
    }

    for pch in &changes.properties {
        let sheet_id_str = pch.sheet_id.to_uuid_string();
        let cell_hex = id_to_hex(pch.cell_id.as_u128());
        let kind = observer_kind_to_change_kind(pch.kind);

        // Resolve (row, col) from grid_indexes; `None` if unavailable.
        let position = stores
            .grid_indexes
            .get(&pch.sheet_id)
            .and_then(|g| g.cell_position(&pch.cell_id))
            .or_else(|| {
                mirror
                    .resolve_position(&pch.cell_id)
                    .map(|pos| (pos.row(), pos.col()))
            })
            .or_else(|| {
                property_position_fallbacks
                    .get(&(pch.sheet_id, pch.cell_id))
                    .map(|pos| (pos.row, pos.col))
            })
            .map(|(row, col)| CellPosition { row, col });

        let format = if kind == ChangeKind::Set {
            // Format resolution still needs (row, col); skip if unresolved.
            if let Some(pos) = position.as_ref() {
                let table_fmt = resolve_table_format_fn(&pch.sheet_id, pos.row, pos.col);
                let effective = crate::storage::properties::get_effective_format(
                    &stores.storage,
                    &pch.sheet_id,
                    &cell_hex,
                    pos.row,
                    pos.col,
                    table_fmt.as_ref(),
                    stores.grid_indexes.get(&pch.sheet_id),
                    mirror.get_sheet(&pch.sheet_id),
                );
                serde_json::to_value(&effective).ok()
            } else {
                None
            }
        } else {
            None
        };

        result.property_changes.push(PropertyChange {
            sheet_id: sheet_id_str,
            cell_id: cell_hex.into(),
            position,
            kind,
            format,
        });
    }

    // --- Dimension changes (row heights) ---
    // Yrs stores canonical units (points); DimensionChange.size must be pixels for TS.
    for dch in &changes.row_heights {
        let sheet_id_str = dch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(dch.kind);
        if let Some(row) = resolve_row_id_to_index(stores, &dch.sheet_id, &dch.key) {
            let size = if kind == ChangeKind::Set {
                let height_pt = dimensions::get_row_height(
                    stores.storage.doc(),
                    stores.storage.sheets(),
                    &dch.sheet_id,
                    row,
                    stores.grid_indexes.get(&dch.sheet_id),
                );
                let pixels = if height_pt.0 == 0.0 {
                    0.0
                } else {
                    domain_types::units::points_to_pixels(height_pt).0
                };
                // Storage units are always finite; use `must` to document the
                // invariant. A non-finite value here would indicate corrupt
                // storage state, which should panic in debug.
                Some(value_types::FiniteF64::must(pixels))
            } else {
                None
            };
            result.dimension_changes.push(DimensionChange {
                sheet_id: sheet_id_str,
                axis: Axis::Row,
                index: row,
                kind,
                size,
            });
        }
    }

    // --- Dimension changes (col widths) ---
    // Yrs stores canonical units (char-width); DimensionChange.size must be pixels for TS.
    let mdw = domain_types::units::platform_mdw();
    for dch in &changes.col_widths {
        let sheet_id_str = dch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(dch.kind);
        if let Some(col) = resolve_col_id_to_index(stores, &dch.sheet_id, &dch.key) {
            let size = if kind == ChangeKind::Set {
                let width_cw = dimensions::get_col_width(
                    stores.storage.doc(),
                    stores.storage.sheets(),
                    &dch.sheet_id,
                    col,
                    stores.grid_indexes.get(&dch.sheet_id),
                );
                let pixels = if width_cw.0 == 0.0 {
                    0.0
                } else {
                    domain_types::units::char_width_to_pixels(width_cw, mdw).0
                };
                Some(value_types::FiniteF64::must(pixels))
            } else {
                None
            };
            result.dimension_changes.push(DimensionChange {
                sheet_id: sheet_id_str,
                axis: Axis::Col,
                index: col,
                kind,
                size,
            });
        }
    }

    // --- Merge changes ---
    for mch in &changes.merges {
        let sheet_id_str = mch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(mch.kind);
        if kind == ChangeKind::Set {
            if let Some(idx) = stores.merge_indexes.get(&mch.sheet_id) {
                for item in idx.items() {
                    if item.id == mch.key {
                        result.merge_changes.push(MergeChange {
                            sheet_id: sheet_id_str.clone(),
                            kind,
                            start_row: item.start_row,
                            start_col: item.start_col,
                            end_row: item.end_row,
                            end_col: item.end_col,
                        });
                    }
                }
            }
        } else {
            result.merge_changes.push(MergeChange {
                sheet_id: sheet_id_str,
                kind,
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 0,
            });
        }
    }

    // --- Visibility changes (hidden rows) ---
    for vch in &changes.hidden_rows {
        let sheet_id_str = vch.sheet_id.to_uuid_string();
        if let Some(row) = resolve_row_id_to_index(stores, &vch.sheet_id, &vch.key) {
            let hidden = dimensions::is_row_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                &vch.sheet_id,
                row,
            );
            result.visibility_changes.push(VisibilityChange {
                sheet_id: sheet_id_str,
                axis: Axis::Row,
                index: row,
                hidden,
            });
        }
    }

    // --- Visibility changes (hidden cols) ---
    for vch in &changes.hidden_cols {
        let sheet_id_str = vch.sheet_id.to_uuid_string();
        if let Some(col) = resolve_col_id_to_index(stores, &vch.sheet_id, &vch.key) {
            let hidden = dimensions::is_column_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                &vch.sheet_id,
                col,
            );
            result.visibility_changes.push(VisibilityChange {
                sheet_id: sheet_id_str,
                axis: Axis::Col,
                index: col,
                hidden,
            });
        }
    }

    // --- Comment changes ---
    //
    // A structured comment row can emit both the top-level comment entry event
    // and field-level map events in the same observer drain, especially during
    // undo/redo. Public mutation results are cell-anchor invalidations, so
    // collapse raw comment-row churn to one `(sheet, cell)` change.
    let mut raw_comment_refs_by_key = HashMap::new();
    for cch in &changes.comments {
        if let Some(cell_ref) = cch.cell_ref.as_ref() {
            raw_comment_refs_by_key.insert((cch.sheet_id, cch.key.clone()), cell_ref.clone());
        }
    }
    let mut seen_comment_cells = HashSet::new();
    for cch in &changes.comments {
        let sheet_id_str = cch.sheet_id.to_uuid_string();
        let cell_ref = cch
            .cell_ref
            .clone()
            .or_else(|| {
                raw_comment_refs_by_key
                    .get(&(cch.sheet_id, cch.key.clone()))
                    .cloned()
            })
            .or_else(|| current_comment_cell_ref(stores, &cch.sheet_id, &cch.key))
            .unwrap_or_else(|| cch.key.clone());
        if !seen_comment_cells.insert((cch.sheet_id, cell_ref.clone())) {
            continue;
        }
        let kind = if sheet_comments::has_comments(
            stores.storage.doc(),
            stores.storage.sheets(),
            &cch.sheet_id,
            &cell_ref,
        ) {
            ChangeKind::Set
        } else {
            ChangeKind::Removed
        };
        let cell_id = parse_cell_ref(&cell_ref).unwrap_or_else(|| CellId::from_raw(0));
        let position = stores
            .grid_indexes
            .get(&cch.sheet_id)
            .and_then(|g| g.cell_position(&cell_id))
            .or_else(|| {
                mirror
                    .resolve_position(&cell_id)
                    .map(|pos| (pos.row(), pos.col()))
            })
            .map(|(row, col)| CellPosition { row, col });

        result.comment_changes.push(CommentChange {
            sheet_id: sheet_id_str,
            cell_id: cell_ref,
            position,
            kind,
        });
    }

    // --- Slicer changes ---
    let mut raw_slicer_data_by_id = HashMap::new();
    for sch in &changes.slicers {
        let entry = raw_slicer_data_by_id
            .entry(sch.slicer_id.clone())
            .or_insert_with(|| (sch.sheet_id, sch.data.clone()));
        if entry.1.is_none() && sch.data.is_some() {
            *entry = (sch.sheet_id, sch.data.clone());
        }
    }
    let mut seen_slicers = HashSet::new();
    for sch in &changes.slicers {
        if !seen_slicers.insert(sch.slicer_id.clone()) {
            continue;
        }
        let current_data = current_slicer_state(stores, &sch.slicer_id);
        let (raw_sheet_id, raw_data) = raw_slicer_data_by_id
            .get(&sch.slicer_id)
            .cloned()
            .unwrap_or((sch.sheet_id, sch.data.clone()));
        let kind = if current_data.is_some() {
            SlicerChangeKind::Updated
        } else {
            SlicerChangeKind::Deleted
        };
        let data = current_data.or(raw_data);
        let sheet_id = sch
            .sheet_id
            .map(|sid| sid.to_uuid_string())
            .or_else(|| raw_sheet_id.map(|sid| sid.to_uuid_string()))
            .or_else(|| data.as_ref().map(|slicer| slicer.sheet_id.clone()))
            .unwrap_or_default();
        let (source_type, source_id) = data
            .as_ref()
            .map(|slicer| slicer_source_metadata(&slicer.source))
            .map_or((None, None), |(source_type, source_id)| {
                (Some(source_type), Some(source_id))
            });

        result.slicer_changes.push(SlicerChange {
            sheet_id,
            slicer_id: sch.slicer_id.clone(),
            kind,
            source_type,
            source_id,
            updated_fields: Vec::new(),
            selected_values: None,
            selection_change_type: None,
            data,
        });
    }

    // --- Filter changes ---
    for fch in &changes.filters {
        let sheet_id_str = fch.sheet_id.to_uuid_string();
        result.filter_changes.push(FilterChange {
            sheet_id: sheet_id_str,
            filter_id: fch.key.clone().unwrap_or_default(),
            filter_kind: None,
            table_id: None,
            capability: None,
            unsupported_reasons: Vec::new(),
            has_active_filter: None,
            clearable: None,
            diagnostics: Vec::new(),
            action: Some(
                match observer_kind_to_change_kind(fch.kind) {
                    ChangeKind::Set => "updated",
                    ChangeKind::Removed => "deleted",
                }
                .to_string(),
            ),
            hidden_row_count: None,
            visible_row_count: None,
            kind: observer_kind_to_change_kind(fch.kind),
        });
    }

    // --- Table changes ---
    for tch in &changes.tables {
        let kind = observer_kind_to_change_kind(tch.kind);
        if tch.key.is_empty() {
            if kind == ChangeKind::Set {
                for table in mirror.all_tables() {
                    push_table_change_once(
                        &mut result,
                        table.name.clone(),
                        Some(table.id.clone()),
                        table.sheet_id.clone(),
                        kind,
                    );
                }
            }
            continue;
        }

        let table_key = tch.key.as_str();
        let current_table = mirror.get_table_by_id(table_key);
        let kind = if current_table.is_some() {
            ChangeKind::Set
        } else {
            ChangeKind::Removed
        };
        let table_name = current_table
            .map(|table| table.name.as_str())
            .or(tch.name.as_deref())
            .unwrap_or(table_key);
        let table_id = current_table.map(|table| table.id.clone()).or_else(|| {
            if table_key.is_empty() {
                None
            } else {
                Some(table_key.to_string())
            }
        });
        let sheet_id = current_table
            .map(|table| table.sheet_id.clone())
            .or_else(|| tch.sheet_id.map(|sheet_id| sheet_id.to_uuid_string()))
            .unwrap_or_default();
        push_table_change_once(
            &mut result,
            table_name.to_string(),
            table_id,
            sheet_id,
            kind,
        );
    }

    // --- Floating object changes ---
    for foch in &changes.floating_objects {
        let sheet_id_str = foch.sheet_id.to_uuid_string();
        let kind = match foch.kind {
            CellChangeKind::Modified => FloatingObjectChangeKind::Updated {
                changed_fields: vec![],
            },
            CellChangeKind::Removed => FloatingObjectChangeKind::Removed,
        };
        result.floating_object_changes.push(FloatingObjectChange {
            sheet_id: sheet_id_str,
            object_id: foch.object_id.clone(),
            kind,
            object_type: None,
            data: None,
            bounds: None,
        });
    }

    if !changes.structural_changes.is_empty() {
        let mut seen_structural_sheets = HashSet::new();
        for sheet_id in &changes.structural_changes {
            if seen_structural_sheets.insert(*sheet_id) {
                result
                    .floating_object_changes
                    .extend(recompute_floating_object_bounds(stores, sheet_id));
            }
        }
    }

    // --- Pivot table changes ---
    //
    // Undo/redo observer replay may include raw child-map churn under
    // `pivotTables/<pivotId>` in addition to the top-level entry change. The
    // public mutation result is semantic, so coalesce each touched pivot to its
    // final state after the transaction.
    let mut seen_pivots = HashSet::new();
    for pch in &changes.pivot_tables {
        if !seen_pivots.insert((pch.sheet_id, pch.pivot_id.clone())) {
            continue;
        }
        let kind = if pivots::get_pivot(
            stores.storage.doc(),
            stores.storage.sheets(),
            &pch.sheet_id,
            &pch.pivot_id,
        )
        .is_some()
        {
            ChangeKind::Set
        } else {
            ChangeKind::Removed
        };
        result.pivot_changes.push(PivotTableChange {
            sheet_id: pch.sheet_id.to_uuid_string(),
            pivot_id: pch.pivot_id.clone(),
            kind,
        });
    }

    // --- Grouping changes ---
    for gch in &changes.grouping {
        result.grouping_changes.push(GroupingChange {
            sheet_id: gch.sheet_id.to_uuid_string(),
            axis: Axis::Row,
            kind: observer_kind_to_change_kind(gch.kind),
        });
    }

    // --- Sparkline changes ---
    let mut seen_sparkline_positions: Vec<(String, u32, u32, ChangeKind)> = Vec::new();
    let mut push_sparkline_position =
        |result: &mut MutationResult, sheet_id: SheetId, row: u32, col: u32, kind: ChangeKind| {
            let sheet_id_str = sheet_id.to_uuid_string();
            if seen_sparkline_positions.contains(&(sheet_id_str.clone(), row, col, kind)) {
                return;
            }
            seen_sparkline_positions.push((sheet_id_str.clone(), row, col, kind));
            let cell_id = stores
                .grid_indexes
                .get(&sheet_id)
                .and_then(|grid| grid.cell_id_at(row, col))
                .map(|cell_id| id_to_hex(cell_id.as_u128()).to_string())
                .unwrap_or_default();
            result.sparkline_changes.push(SparklineChange {
                sheet_id: sheet_id_str,
                cell_id,
                position: Some(CellPosition { row, col }),
                kind,
            });
        };

    for sch in &changes.sparklines {
        let kind = observer_kind_to_change_kind(sch.kind);
        let Some(key) = sch.key.as_deref() else {
            continue;
        };

        if let Some(rest) = key.strip_prefix("idx:") {
            if let Some((row, col)) = parse_sparkline_idx_key(rest) {
                push_sparkline_position(&mut result, sch.sheet_id, row, col, kind);
            }
            continue;
        }

        if let Some(group_id) = key.strip_prefix("group:") {
            if kind == ChangeKind::Set
                && let Some(group) = sparklines::get_sparkline_group(
                    stores.storage.doc(),
                    &stores.storage.sheets_ref(),
                    &sch.sheet_id,
                    group_id,
                )
            {
                for sparkline_id in &group.sparkline_ids {
                    if let Some(sparkline) = sparklines::get_sparkline(
                        stores.storage.doc(),
                        &stores.storage.sheets_ref(),
                        &sch.sheet_id,
                        sparkline_id,
                    ) {
                        push_sparkline_position(
                            &mut result,
                            sch.sheet_id,
                            sparkline.cell.row,
                            sparkline.cell.col,
                            ChangeKind::Set,
                        );
                    }
                }
            }
            continue;
        }

        if kind == ChangeKind::Set
            && let Some(sparkline) = sparklines::get_sparkline(
                stores.storage.doc(),
                &stores.storage.sheets_ref(),
                &sch.sheet_id,
                key,
            )
        {
            push_sparkline_position(
                &mut result,
                sch.sheet_id,
                sparkline.cell.row,
                sparkline.cell.col,
                ChangeKind::Set,
            );
        }
    }

    // --- Conditional format changes ---
    for cfch in &changes.conditional_formats {
        result.cf_changes.push(CfChange {
            sheet_id: cfch.sheet_id.to_uuid_string(),
            kind: observer_kind_to_change_kind(cfch.kind),
            rule_id: cfch.key.clone(),
        });
    }

    // --- Named range changes ---
    for nrch in &changes.named_ranges {
        let kind = observer_kind_to_change_kind(nrch.kind);
        let name = nrch.key.clone().unwrap_or_default();
        result
            .named_range_changes
            .push(NamedRangeChange { name, kind });
    }

    // --- Sorting changes ---
    for sch in &changes.sorting {
        result.sorting_changes.push(SortingChange {
            sheet_id: sch.sheet_id.to_uuid_string(),
            kind: observer_kind_to_change_kind(sch.kind),
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 0,
            rows_moved: 0,
        });
    }

    // --- Sheet metadata changes ---
    //
    // Observer field names are raw camelCase Yrs meta keys (e.g. "name",
    // "frozenRows", "showGridlines"). Translate per key into either:
    //   - a `SheetSettingsChange` with the full post-state settings snapshot
    //     (when the key participates in `SheetSettings`), or
    //   - a `SheetChange` with the post-state payload populated (rename,
    //     order, hidden, visibility, tabColor, frozenRows/frozenCols).
    //
    // The observer record does not retain pre-mutation scalars, so
    // `old_name` / `old_index` / `old_color` / `old_frozen_*` are emitted
    // as `None`. The TS mirror tolerates missing pre-state; only the
    // post-state must be populated for the kernel mirror to resolve a
    // remote/observer-driven sheet-meta change correctly.
    let sheet_doc = stores.storage.doc();
    let sheet_map = stores.storage.sheets();
    for smch in &changes.sheet_meta {
        let sheet_id_str = smch.sheet_id.to_uuid_string();
        let kind = observer_kind_to_change_kind(smch.kind);
        let field_str = smch.field.as_deref().unwrap_or("");

        // Settings-bucket keys (top-level meta keys that participate in
        // SheetSettings). Source of truth: SHEET_SETTINGS_KEYS in
        // crate::storage::sheet::settings.
        if settings::is_sheet_settings_key(field_str) {
            let post_settings = settings::get_sheet_settings(sheet_doc, sheet_map, &smch.sheet_id);
            let settings_value =
                serde_json::to_value(&post_settings).expect("SheetSettings must serialize to JSON");
            result.settings_changes.push(SheetSettingsChange {
                sheet_id: sheet_id_str,
                kind,
                changed_key: field_str.to_string(),
                settings: settings_value,
            });
            continue;
        }

        // SheetChange-backed keys. Field-specific payloads are hydrated
        // from post-mutation Yrs state via existing query helpers.
        let mut sheet_change = SheetChange {
            sheet_id: sheet_id_str,
            kind,
            field: SheetChangeField::Sheet,
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        };

        match field_str {
            "name" => {
                sheet_change.field = SheetChangeField::Name;
                sheet_change.name =
                    properties::get_sheet_name(sheet_doc, sheet_map, &smch.sheet_id);
                // TODO(observer-old-state): observer does not retain old name.
            }
            "order" => {
                sheet_change.field = SheetChangeField::Order;
                sheet_change.index = stores
                    .storage
                    .sheet_order()
                    .iter()
                    .position(|sid| sid == &smch.sheet_id)
                    .map(|i| i as i32);
                // TODO(observer-old-state): observer does not retain old index.
            }
            "hidden" => {
                sheet_change.field = SheetChangeField::Hidden;
                sheet_change.hidden = Some(visibility::is_sheet_hidden(
                    sheet_doc,
                    sheet_map,
                    &smch.sheet_id,
                ));
            }
            "visibility" | "veryHidden" => {
                sheet_change.field = SheetChangeField::Visibility;
                let state = visibility::get_sheet_visibility(sheet_doc, sheet_map, &smch.sheet_id);
                sheet_change.hidden = Some(state == "hidden" || state == "veryHidden");
            }
            "tabColor" | "tab_color" => {
                sheet_change.field = SheetChangeField::TabColor;
                sheet_change.color =
                    properties::get_sheet_meta(sheet_doc, sheet_map, &smch.sheet_id)
                        .and_then(|m| m.tab_color);
                // TODO(observer-old-state): observer does not retain old color.
            }
            "frozenRows" | "frozenCols" | "frozen" => {
                sheet_change.field = SheetChangeField::Frozen;
                let panes = view::get_frozen_panes(sheet_doc, sheet_map, &smch.sheet_id);
                sheet_change.frozen_rows = Some(panes.rows);
                sheet_change.frozen_cols = Some(panes.cols);
                // TODO(observer-old-state): observer does not retain old frozen rows/cols.
            }
            "enableCalculation" => {
                sheet_change.field = SheetChangeField::EnableCalculation;
            }
            _ => {
                // Unknown sheet-meta keys are not sheet lifecycle events.
                // `SheetChangeField::Sheet` is reserved for canonical sheet
                // introduction/removal from `sheet_additions`,
                // `sheet_deletions`, and hydration. Emitting it here lets an
                // unrelated metadata removal look like a deleted sheet to the
                // TS mirror.
                continue;
            }
        }

        result.sheet_changes.push(sheet_change);
    }

    // --- Sheet order changes ---
    //
    // The `sheetOrder` Y.Array sits in the workbook map. Mutations
    // (move_sheet, reorder_sheets) and their undo/redo emit
    // `Event::Array` events that the observer captures as
    // `sheet_order_changed = true`. Translate into per-sheet
    // `SheetChange{field: Order}` entries so the TS mirror updates
    // tab positions. The observer does not retain pre-state, so
    // `old_index` is `None`.
    if changes.sheet_order_changed {
        let order = stores.storage.sheet_order();
        for (idx, sid) in order.iter().enumerate() {
            result.sheet_changes.push(SheetChange {
                sheet_id: sid.to_uuid_string(),
                kind: ChangeKind::Set,
                field: SheetChangeField::Order,
                name: None,
                old_name: None,
                index: Some(idx as i32),
                old_index: None,
                hidden: None,
                source_sheet_id: None,
                frozen_rows: None,
                old_frozen_rows: None,
                frozen_cols: None,
                old_frozen_cols: None,
                color: None,
                old_color: None,
            });
        }
    }

    // --- Observer old values ---
    // Thread old cell values from the observer into the MutationResult so the
    // TS ChangeAccumulator can populate DirtyCell.oldValue.
    for cell_change in &changes.cells {
        if let Some(ref old_val) = cell_change.old_value {
            let key = format!(
                "{}:{}",
                cell_change.sheet_id.to_uuid_string(),
                cell_change.cell_id.to_uuid_string(),
            );
            result.old_values.insert(key, old_val.clone());
        }
    }

    // --- Workbook settings changes ---
    if changes.workbook_settings_changed {
        let doc = stores.storage.doc();
        let workbook_settings =
            workbook::settings::get_settings(doc, stores.storage.workbook_map());
        let workbook_settings_value = serde_json::to_value(&workbook_settings)
            .expect("WorkbookSettings must serialize to JSON");
        let changed_keys = match &workbook_settings_value {
            serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
            _ => Vec::new(),
        };
        result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Set,
                changed_keys,
                settings: workbook_settings_value,
            });
    }

    result
}

fn parse_sparkline_idx_key(rest: &str) -> Option<(u32, u32)> {
    let (row, col) = rest.split_once(',')?;
    Some((row.parse().ok()?, col.parse().ok()?))
}
