use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::{CellValue, ComputeError};
use yrs::{Map, Transact};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::patches::{merge_recalc_results, synthetic_null_change};
use super::range_sort::sort_range_backed_rows;

// ---------------------------------------------------------------------------
// mutation_sort_range
// ---------------------------------------------------------------------------

/// Sort a range with full store synchronization.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_sort_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: &crate::storage::engine::mutation::BridgeSortOptions,
) -> Result<RecalcResult, ComputeError> {
    use crate::storage::engine::mutation::BridgeSortMode;
    use crate::storage::properties;
    use crate::storage::sheet::sorting;

    let range = sorting::CellRange::new(start_row, start_col, end_row, end_col);
    let has_headers = options.has_headers;

    // Build sort criteria
    let header_row = start_row;
    let mut criteria = Vec::new();
    for criterion in &options.criteria {
        let cell_id = stores
            .grid_indexes
            .get(sheet_id)
            .and_then(|g| g.cell_id_at(header_row, criterion.column))
            .unwrap_or_else(|| CellId::from_raw(0));
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
        criteria.push(sorting::SortCriterion {
            header_cell_id: cell_id,
            direction: Some(criterion.direction),
            case_sensitive: criterion.case_sensitive,
            mode,
        });
    }
    let opts = sorting::SortOptions {
        criteria,
        has_headers,
    };

    let grid_for_compute =
        stores
            .grid_indexes
            .get(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
            })?;

    // Build the (row, col) → CellFormat accessor used by color-mode
    // criteria. Mirrors the format cascade the renderer uses.
    // TODO(consolidate-with-apply-filter): services/features.rs::apply_filter
    // has a similar closure; once both paths are stable,
    // hoist into a shared `make_format_accessor` helper.
    let storage = &stores.storage;
    let sid = *sheet_id;
    let grid_for_format = grid_for_compute;
    let get_cell_format = |row: u32, col: u32| -> domain_types::CellFormat {
        let table_fmt =
            super::super::super::tables::resolve_table_format_at_cell(mirror, &sid, row, col);
        match grid_for_format.cell_id_at(row, col) {
            Some(id) => properties::get_effective_format(
                storage,
                &sid,
                &id_to_hex(id.as_u128()),
                row,
                col,
                table_fmt.as_ref(),
                Some(grid_for_format),
                mirror.get_sheet(&sid),
            ),
            None => properties::get_positional_format(
                storage,
                &sid,
                row,
                col,
                Some(grid_for_format),
                mirror.get_sheet(&sid),
            ),
        }
    };

    let sort_result = if options.visible_rows_only {
        sorting::compute_sorted_row_order_with_scope(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            &range,
            &opts,
            grid_for_compute,
            get_cell_format,
            true,
        )
    } else {
        sorting::compute_sorted_row_order(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            &range,
            &opts,
            grid_for_compute,
            get_cell_format,
        )
    };

    if sort_result.sorted_indices.is_empty() || sort_result.rows_moved == 0 {
        return Ok(RecalcResult::empty());
    }

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
    let has_ranges = mirror
        .get_sheet(sheet_id)
        .map(|s| !s.range_views_is_empty())
        .unwrap_or(false);

    if has_ranges {
        return sort_range_backed_rows(stores, mirror, mutation, sheet_id, &permutation);
    }

    // ===================================================================
    // Per-cell sort path (existing code — unchanged)
    // ===================================================================
    let grid_for_reorder =
        stores
            .grid_indexes
            .get(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
            })?;
    mutation.observer.set_suppressed(true);
    sorting::reorder_rows_in_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        &range,
        &sort_result.sorted_indices,
        has_headers,
        grid_for_reorder,
    );
    mutation.observer.set_suppressed(false);

    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
        grid.sort_rows(&permutation);
    }

    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> = Vec::new();

    // Pass 1: update mirror positions for every cell in the sort range,
    // preserving the pre-sort IdentityFormula. XLSX hydration leaves
    // KEY_FORMULA_TEMPLATE empty in yrs, so `identity_formula` coming
    // back from `read_cell_from_yrs` is typically `None`;
    // `bulk_parse_and_register` populated the identity in the mirror
    // at hydration, which we must keep so refs still point at the cells
    // that moved with them.
    for new_row in data_start..=end_row {
        for col in start_col..=end_col {
            if let Some(cell_id) = stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_id_at(new_row, col))
                && let Some((value, _, identity_formula)) =
                    stores.storage.read_cell_from_yrs(sheet_id, &cell_id)
            {
                let preserved_identity =
                    identity_formula.or_else(|| mirror.get_formula(&cell_id).cloned());
                mirror.apply_edit(
                    sheet_id,
                    cell_id,
                    SheetPos::new(new_row, col),
                    value.clone(),
                    preserved_identity,
                );
            }
        }
    }

    // Pass 2: render each cell's post-sort A1 string from its preserved
    // IdentityFormula against the now-updated mirror positions, and
    // record this as the input for set_cells below. This ensures refs
    // follow the cells they originally pointed at (the test invariant
    // in xlsx_sort_roundtrip), rather than being re-resolved against
    // whatever cell happens to sit at the old A1 position post-sort.
    for new_row in data_start..=end_row {
        for col in start_col..=end_col {
            if let Some(cell_id) = stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_id_at(new_row, col))
                && let Some((value, formula, _)) =
                    stores.storage.read_cell_from_yrs(sheet_id, &cell_id)
            {
                // Resolve the post-sort formula body, if any. Preference order:
                // 1. Render the preserved IdentityFormula to an A1 body — refs
                //    follow the cells that moved.
                // 2. Fall back to the raw yrs formula body.
                // 3. No formula — the cell carries a plain typed value.
                let formula_body = if let Some(id_formula) = mirror.get_formula(&cell_id).cloned() {
                    let lookup = crate::mirror::MirrorPositionLookup::new(mirror, *sheet_id);
                    let a1 = compute_parser::to_a1_string(&id_formula, &lookup);
                    let body = a1.strip_prefix('=').unwrap_or(&a1).to_string();
                    if body.is_empty() {
                        formula.clone()
                    } else {
                        Some(body)
                    }
                } else {
                    formula.clone()
                };

                edits.push((*sheet_id, cell_id, new_row, col, value, formula_body));
            }
        }
    }

    if edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    // Persist the post-sort identity positions into the authoritative Yrs
    // gridIndex mirror in one user-edit transaction. The visible sort above
    // mutates GridIndex + CellMirror, but undo/redo only tracks Yrs writes;
    // without this transaction a per-cell sort never reaches the undo stack.
    //
    // Remove all old CellId -> position bindings first, then write the new
    // bindings, so rows containing blanks do not leave stale posToId entries
    // at positions no moved cell overwrites.
    //
    // The same transaction also rewrites yrs KEY_FORMULA to the re-rendered
    // A1 body so xlsx export — which prefers the raw yrs formula for
    // lossless round-trip — sees the post-sort A1 refs, and the entire sort
    // remains one undo step.
    {
        use crate::storage::cells::values::{
            remove_cell_position_from_yrs, write_cell_position_to_yrs,
        };
        use compute_document::schema::{KEY_CELLS, KEY_FORMULA};
        use compute_document::undo::ORIGIN_USER_EDIT;
        use yrs::{Any, Origin, Out};

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let doc = stores.storage.doc();
        let sheets = stores.storage.sheets();
        let position_writes: Vec<(String, String, String)> = stores
            .grid_indexes
            .get(sheet_id)
            .map(|grid| {
                edits
                    .iter()
                    .filter_map(|(_, cell_id, row, col, _, _)| {
                        let row_hex = grid.row_id_hex(*row)?;
                        let col_hex = grid.col_id_hex(*col)?;
                        Some((
                            String::from(id_to_hex(cell_id.as_u128())),
                            String::from(row_hex),
                            String::from(col_hex),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();

        mutation.observer.set_suppressed(true);
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        for (cell_hex, _, _) in &position_writes {
            remove_cell_position_from_yrs(&mut txn, sheets, &sheet_hex, cell_hex);
        }
        for (cell_hex, row_hex, col_hex) in &position_writes {
            write_cell_position_to_yrs(&mut txn, sheets, &sheet_hex, cell_hex, row_hex, col_hex);
        }
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
            && let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, KEY_CELLS)
        {
            for (_, cell_id, _, _, _, formula_body) in &edits {
                let Some(body) = formula_body.as_deref() else {
                    continue;
                };
                // KEY_FORMULA stores the body WITHOUT the leading '='. The
                // identity-rendered branch in Pass 2 has already stripped it;
                // the fallback branch passes through the raw yrs formula,
                // which `read_cell_from_yrs` re-prepends '=' onto — strip it
                // again here so we never double-prefix on the next read.
                let body = body.strip_prefix('=').unwrap_or(body);
                if body.is_empty() {
                    continue;
                }
                let cell_hex = id_to_hex(cell_id.as_u128());
                if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &cell_hex) {
                    cell_map.insert(
                        &mut txn,
                        KEY_FORMULA,
                        Any::String(std::sync::Arc::from(body)),
                    );
                }
            }
        }
        drop(txn);
        mutation.observer.set_suppressed(false);
    }

    let mut recalc = stores.compute.set_cells_raw_with_trust(
        mirror,
        &edits,
        true,
        crate::scheduler::WriteTrust::UserEdit,
    )?;

    let mut blank_slot_clears = Vec::new();
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for row in data_start..=end_row {
            for col in start_col..=end_col {
                if grid.cell_id_at(row, col).is_none() {
                    mirror.vacate_position(sheet_id, SheetPos::new(row, col));
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

    Ok(recalc)
}
