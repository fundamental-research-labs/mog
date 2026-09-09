use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::{CellValue, ComputeError};

use crate::cells::CellStore;
use crate::snapshot::RecalcResult;
use crate::storage::engine::services::resolved_formats;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;

use super::patches::{merge_recalc_results, synthetic_null_change};
use super::range_sort::sort_range_backed_rows;

fn sort_range_intersects_range_view(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> bool {
    cell_store
        .get_sheet(sheet_id)
        .map(|sheet| {
            !sheet
                .range_spatial_index
                .query_range(start_row, start_col, end_row, end_col)
                .is_empty()
        })
        .unwrap_or(false)
}

#[derive(Debug, Clone)]
struct FilterRangeAnchor {
    filter_id: String,
    header_start: (u32, u32),
    header_end: (u32, u32),
    data_end: (u32, u32),
}

#[derive(Debug, Clone, Copy)]
struct SortRect {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

impl SortRect {
    fn intersects(self, other: Self) -> bool {
        !(self.end_row < other.start_row
            || self.start_row > other.end_row
            || self.end_col < other.start_col
            || self.start_col > other.end_col)
    }
}

fn resolve_filter_anchor_pos(cell_store: &CellStore, cell_id_hex: &str) -> Option<(u32, u32)> {
    let cell_id = CellId::from_raw(compute_document::hex::hex_to_id(cell_id_hex)?);
    let pos = cell_store.resolve_position(&cell_id)?;
    Some((pos.row(), pos.col()))
}

fn capture_filter_range_anchors(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<FilterRangeAnchor> {
    let sorted_rect = SortRect {
        start_row,
        start_col,
        end_row,
        end_col,
    };
    filters::get_filters_in_sheet(&stores.storage, sheet_id)
        .into_iter()
        .filter_map(|filter| {
            let header_start = resolve_filter_anchor_pos(cell_store, &filter.header_start_cell_id)?;
            let header_end = resolve_filter_anchor_pos(cell_store, &filter.header_end_cell_id)?;
            let data_end = resolve_filter_anchor_pos(cell_store, &filter.data_end_cell_id)?;

            let filter_start_row = header_start.0;
            let filter_start_col = header_start.1.min(header_end.1);
            let filter_end_row = data_end.0;
            let filter_end_col = header_start.1.max(header_end.1);
            let filter_rect = SortRect {
                start_row: filter_start_row,
                start_col: filter_start_col,
                end_row: filter_end_row,
                end_col: filter_end_col,
            };
            if !sorted_rect.intersects(filter_rect) {
                return None;
            }

            Some(FilterRangeAnchor {
                filter_id: filter.id,
                header_start,
                header_end,
                data_end,
            })
        })
        .collect()
}

fn ensure_filter_anchor_id(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let cell_id =
        super::super::super::cell_editing::ensure_cell_id(stores, cell_store, sheet_id, row, col)?;
    Some(id_to_hex(cell_id.as_u128()).to_string())
}

fn restore_filter_range_anchors(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    anchors: &[FilterRangeAnchor],
) -> Result<(), ComputeError> {
    for anchor in anchors {
        let Some(mut filter) = filters::get_filter(&stores.storage, sheet_id, &anchor.filter_id)
        else {
            continue;
        };
        let Some(header_start_cell_id) = ensure_filter_anchor_id(
            stores,
            cell_store,
            sheet_id,
            anchor.header_start.0,
            anchor.header_start.1,
        ) else {
            continue;
        };
        let Some(header_end_cell_id) = ensure_filter_anchor_id(
            stores,
            cell_store,
            sheet_id,
            anchor.header_end.0,
            anchor.header_end.1,
        ) else {
            continue;
        };
        let Some(data_end_cell_id) = ensure_filter_anchor_id(
            stores,
            cell_store,
            sheet_id,
            anchor.data_end.0,
            anchor.data_end.1,
        ) else {
            continue;
        };

        filter.header_start_cell_id = header_start_cell_id;
        filter.header_end_cell_id = header_end_cell_id;
        filter.data_end_cell_id = data_end_cell_id;
        filters::upsert_filter_state(&mut stores.storage, sheet_id, &filter)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// mutation_sort_range
// ---------------------------------------------------------------------------

/// Sort a range with full store synchronization.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_sort_range(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: &crate::storage::engine::mutation::BridgeSortOptions,
) -> Result<RecalcResult, ComputeError> {
    use crate::storage::engine::mutation::BridgeSortMode;
    use crate::storage::sheet::sorting;

    let range = sorting::CellRange::new(start_row, start_col, end_row, end_col);
    let has_headers = options.has_headers;

    // Bridge sort criteria are absolute sheet columns. Keep them positional so
    // imported Range-backed columns without sparse CellIds can still drive the
    // comparator through CellStore reads.
    let mut criteria = Vec::new();
    for criterion in &options.criteria {
        let mode = match &criterion.mode {
            BridgeSortMode::Value { custom_list } => sorting::SortMode::Value {
                custom_list: custom_list.clone(),
            },
            BridgeSortMode::CellColor { target, position } => sorting::SortMode::CellColor {
                target: target.clone(),
                position: *position,
            },
            BridgeSortMode::FontColor { target, position } => sorting::SortMode::FontColor {
                target: target.clone(),
                position: *position,
            },
        };
        criteria.push(sorting::SortColumnCriterion {
            column: criterion.column,
            direction: Some(criterion.direction),
            case_sensitive: criterion.case_sensitive,
            mode,
        });
    }

    stores
        .grid_indexes
        .get(sheet_id)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
        })?;

    let sort_result = {
        let sid = *sheet_id;
        let get_cell_format = |row: u32, col: u32| -> domain_types::CellFormat {
            resolved_formats::get_resolved_cell_format(stores, cell_store, settings, &sid, row, col)
        };

        let get_cell_value = |row: u32, col: u32| -> CellValue {
            cell_store
                .get_cell_value_at(&sid, SheetPos::new(row, col))
                .cloned()
                .unwrap_or(CellValue::Null)
        };

        let hidden_rows =
            crate::storage::engine::services::queries::get_hidden_rows(stores, sheet_id)
                .into_iter()
                .collect();
        sorting::compute_sorted_row_order_by_columns_with_scope(
            &hidden_rows,
            &range,
            &criteria,
            has_headers,
            get_cell_value,
            get_cell_format,
            options.visible_rows_only,
        )
    };

    if sort_result.sorted_indices.is_empty() || sort_result.rows_moved == 0 {
        return Ok(RecalcResult::empty());
    }

    let filter_range_anchors = capture_filter_range_anchors(
        stores, cell_store, sheet_id, start_row, start_col, end_row, end_col,
    );

    let data_start = if has_headers {
        start_row + 1
    } else {
        start_row
    };
    let permutation: Vec<(u32, u32)> = sort_result
        .sorted_indices
        .iter()
        .zip(sort_result.target_indices.iter())
        .filter_map(|(&original_row, &new_row)| {
            if original_row != new_row {
                Some((original_row, new_row))
            } else {
                None
            }
        })
        .collect();

    // -----------------------------------------------------------------------
    // Range detection: if any Range covers this sheet, use the Range sort
    // path which reorders `rowOrder` directly and leaves payload bytes in
    // place. Otherwise, fall through to the existing per-cell sort path.
    // -----------------------------------------------------------------------
    let has_ranges = sort_range_intersects_range_view(
        cell_store, sheet_id, start_row, start_col, end_row, end_col,
    );

    crate::storage::engine::history::structure::capture_sort(
        stores,
        cell_store,
        *sheet_id,
        &permutation,
        has_ranges,
    );
    if has_ranges {
        let recalc = sort_range_backed_rows(stores, cell_store, sheet_id, &permutation)?;
        restore_filter_range_anchors(stores, cell_store, sheet_id, &filter_range_anchors)?;
        return Ok(recalc);
    }

    // A sparse rectangular sort moves only its selected cells. Capture every
    // source before applying the permutation so overlapping moves are atomic.
    let row_destinations: rustc_hash::FxHashMap<_, _> = permutation.iter().copied().collect();
    let moves: Vec<_> = cell_store
        .get_sheet(sheet_id)
        .into_iter()
        .flat_map(|sheet| sheet.cells_in_range(data_start, start_col, end_row, end_col))
        .filter_map(|(id, row, col)| {
            row_destinations
                .get(&row)
                .map(|&new_row| (id, *sheet_id, SheetPos::new(new_row, col)))
        })
        .collect();
    cell_store.move_cells(&moves);
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> = Vec::new();

    // Pass 2: render each cell's post-sort A1 string from its preserved
    // IdentityFormula against the now-updated cell_store positions, and
    // record this as the input for set_cells below. This ensures refs
    // follow the cells they originally pointed at (the test invariant
    // in xlsx_sort_roundtrip), rather than being re-resolved against
    // whatever cell happens to sit at the old A1 position post-sort.
    for new_row in data_start..=end_row {
        for col in start_col..=end_col {
            if let Some(cell_id) = cell_store.resolve_cell_id(sheet_id, SheetPos::new(new_row, col))
                && let Some(value) = cell_store.get_cell_value_raw(&cell_id).cloned()
            {
                let formula_body = if let Some(id_formula) = cell_store.get_formula(&cell_id) {
                    let lookup = crate::cells::StorePositionLookup::new(cell_store, *sheet_id);
                    let a1 = compute_parser::to_a1_string(id_formula, &lookup);
                    Some(a1.strip_prefix('=').unwrap_or(&a1).to_string())
                } else {
                    stores.compute.get_formula(&cell_id).map(str::to_owned)
                };

                edits.push((*sheet_id, cell_id, new_row, col, value, formula_body));
            }
        }
    }

    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    // Publish the moved authored values and recalculate dependents.
    let mut recalc = stores.compute.set_cells_raw_with_trust(
        cell_store,
        &edits,
        true,
        crate::scheduler::WriteTrust::UserEdit,
    )?;

    let mut blank_slot_clears = Vec::new();
    if stores.grid_indexes.contains_key(sheet_id) {
        for row in data_start..=end_row {
            for col in start_col..=end_col {
                if cell_store
                    .resolve_cell_id(sheet_id, SheetPos::new(row, col))
                    .is_none()
                {
                    cell_store.vacate_position(sheet_id, SheetPos::new(row, col));
                    blank_slot_clears.push(synthetic_null_change(sheet_id, row, col));
                }
            }
        }
    }
    if !blank_slot_clears.is_empty() {
        let mut blank_recalc = RecalcResult::empty();
        blank_recalc.changed_cells = blank_slot_clears;
        merge_recalc_results(&mut recalc, blank_recalc);
    }

    restore_filter_range_anchors(stores, cell_store, sheet_id, &filter_range_anchors)?;

    Ok(recalc)
}
