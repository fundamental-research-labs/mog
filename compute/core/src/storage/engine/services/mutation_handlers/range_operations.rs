use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, ComputeError};
use yrs::{Map, Transact};

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::services::metadata_shift;
use crate::storage::engine::stores::EngineStores;
use compute_document::hex::id_to_hex;

use super::cell_mutations::mutation_set_cells_by_position_raw;
use super::fill::{
    AdjustedPositionLookup, build_adjusted_formula, resolve_identity_ref_to_fill_position,
};

/// Merge `other` into `dest` in place, deduplicating `changed_cells` by
/// (sheet_id, position). `other`'s entries replace any existing entries
/// at the same position; remaining `other` entries are appended.
///
/// Used by `mutation_relocate_cells` to combine the source-clear and
/// target-write recalcs into one viewport-patch payload (filter viewport R5.3).
fn merge_recalc_results(dest: &mut RecalcResult, other: RecalcResult) {
    use rustc_hash::FxHashSet;
    if other.changed_cells.is_empty()
        && other.projection_changes.is_empty()
        && other.errors.is_empty()
        && other.validation_annotations.is_empty()
    {
        return;
    }
    let dest_keys: FxHashSet<(String, u32, u32)> = dest
        .changed_cells
        .iter()
        .filter_map(|c| {
            c.position
                .as_ref()
                .map(|p| (c.sheet_id.clone(), p.row, p.col))
        })
        .collect();
    for change in other.changed_cells {
        let key = change
            .position
            .as_ref()
            .map(|p| (change.sheet_id.clone(), p.row, p.col));
        match key {
            Some(k) if dest_keys.contains(&k) => {} // target write wins
            _ => dest.changed_cells.push(change),
        }
    }
    dest.projection_changes.extend(other.projection_changes);
    dest.errors.extend(other.errors);
    dest.validation_annotations
        .extend(other.validation_annotations);
    // Preserve old_values from `other` only when not already present:
    // dest's pre-write snapshot (captured by the target-write pass) is
    // the authoritative read-before-write entry for any position we
    // touched twice.
    for (k, v) in other.old_values {
        dest.old_values.entry(k).or_insert(v);
    }
}

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
        let table_fmt = super::super::tables::resolve_table_format_at_cell(mirror, &sid, row, col);
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
        // ===================================================================
        // Range sort path
        // ===================================================================
        use crate::storage::infra::grid_helpers::get_row_order_array;
        use cell_types::RowId;
        use cell_types::interval_tree::IntervalTree;
        use compute_document::undo::ORIGIN_USER_EDIT;
        use yrs::{Any, Array, Origin, Out};

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let doc = stores.storage.doc();
        let sheets = stores.storage.sheets();

        // (a) Reorder the `rowOrder` YArray using ORIGIN_USER_EDIT so undo captures it.
        mutation.observer.set_suppressed(true);
        {
            let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
            if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
                && let Some(row_order_arr) = get_row_order_array(&sheet_map, &txn)
            {
                // Read current rowOrder entries
                let len = row_order_arr.len(&txn);
                let mut entries: Vec<String> = Vec::with_capacity(len as usize);
                for i in 0..len {
                    if let Some(Out::Any(Any::String(s))) = row_order_arr.get(&txn, i) {
                        entries.push(s.to_string());
                    }
                }

                // Build reordered list using the permutation.
                // permutation is Vec<(old_row, new_row)> — swap entries accordingly.
                let mut reordered = entries.clone();
                for &(old_row, new_row) in &permutation {
                    if (old_row as usize) < entries.len() && (new_row as usize) < reordered.len() {
                        reordered[new_row as usize] = entries[old_row as usize].clone();
                    }
                }

                // Remove all entries and re-insert in new order
                // (YArray doesn't have a "reorder" method — must remove+reinsert)
                row_order_arr.remove_range(&mut txn, 0, len);
                for entry in &reordered {
                    row_order_arr
                        .push_back(&mut txn, Any::String(std::sync::Arc::from(entry.as_str())));
                }
            }
        }
        mutation.observer.set_suppressed(false);

        // (b) Permute GridIndex::row_ids to match the reordered rowOrder.
        if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
            grid.reorder_row_ids(&permutation);
        }

        // (c) Update per-cell identity-to-position mappings (needed for mixed sheets).
        if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
            grid.sort_rows(&permutation);
        }

        // (d) Update mirror row_to_index / index_to_row from the reordered GridIndex.
        if let Some(grid) = stores.grid_indexes.get(sheet_id) {
            let row_ids = grid.row_ids_ordered();
            if let Some(sheet) = mirror.get_sheet_mut(sheet_id) {
                sheet.row_to_index.clear();
                sheet.index_to_row.clear();
                sheet.row_to_index.reserve(row_ids.len());
                sheet.index_to_row.reserve(row_ids.len());
                for (i, rid) in row_ids.into_iter().enumerate() {
                    sheet.row_to_index.insert(rid, i as u32);
                    sheet.index_to_row.insert(i as u32, rid);
                }
            }
        }

        // (e) Rebuild col_data for Range-backed columns.
        let range_cols: Vec<u32> = {
            let sheet = mirror.get_sheet(sheet_id);
            match sheet {
                Some(s) => {
                    let cols: rustc_hash::FxHashSet<u32> = s
                        .range_views
                        .values()
                        .flat_map(|rv| rv.col_offset_by_id.keys())
                        .filter_map(|cid| s.col_index_of(cid))
                        .collect();
                    cols.into_iter().collect()
                }
                None => Vec::new(),
            }
        };
        if let Some(sheet) = mirror.get_sheet_mut(sheet_id) {
            for col in &range_cols {
                sheet.rebuild_col_data(*col);
            }
        }

        // (f) Bump col_version for all affected columns.
        for col in &range_cols {
            mirror.bump_col_version(sheet_id, *col);
        }

        // (g) Rebuild spatial index — positional indices changed since
        //     row_to_index was remapped.
        if let Some(sheet) = mirror.get_sheet_mut(sheet_id) {
            let row_order: Vec<RowId> = (0..sheet.rows)
                .filter_map(|i| sheet.index_to_row.get(&i).copied())
                .collect();
            let col_order: Vec<cell_types::ColId> = (0..sheet.cols)
                .filter_map(|i| sheet.index_to_col.get(&i).copied())
                .collect();

            let mut extents = Vec::new();
            for rv in sheet.range_views.values() {
                if let Some(extent) = rv.compute_extent(&row_order, &col_order) {
                    extents.push(extent);
                }
            }
            sheet.range_spatial_index = IntervalTree::build(&extents);
        }

        // (h) Delegate to ComputeCore::structure_change(mirror, None) for dep graph
        //     rebuild + full recalc. This replaces the per-cell formula handling.
        mirror.projection_registry.clear();
        return stores.compute.structure_change(mirror, None);
    }

    // ===================================================================
    // Per-cell sort path (existing code — unchanged)
    // ===================================================================
    mutation.observer.set_suppressed(true);
    sorting::reorder_rows_in_range(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        &range,
        &sort_result.sorted_indices,
        has_headers,
        stores
            .grid_indexes
            .get(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
            })?,
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
    let sheet_id_str = sheet_id.to_uuid_string();
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for row in data_start..=end_row {
            for col in start_col..=end_col {
                if grid.cell_id_at(row, col).is_none() {
                    mirror.vacate_position(sheet_id, SheetPos::new(row, col));
                    blank_slot_clears.push(crate::snapshot::CellChange {
                        cell_id: String::new(),
                        sheet_id: sheet_id_str.clone(),
                        position: Some(crate::snapshot::CellPosition { row, col }),
                        value: CellValue::Null,
                        display_text: None,
                        format_idx: None,
                        extra_flags: 0,
                        old_value: None,
                    });
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

// ---------------------------------------------------------------------------
// mutation_relocate_cells
// ---------------------------------------------------------------------------

/// Relocate cells from source range to target position with full 5-store sync.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_relocate_cells(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    source_sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    target_sheet_id: &SheetId,
    target_row: u32,
    target_col: u32,
) -> Result<(RecalcResult, crate::engine_types::RelocateResult), ComputeError> {
    use crate::engine_types::RelocateResult;
    use crate::storage::infra::cell_iter;

    // Range guard: reject if the source sheet is Range-backed.
    if mirror
        .get_sheet(source_sheet_id)
        .is_some_and(|s| !s.range_views_is_empty())
    {
        return Err(ComputeError::RangeGuardViolation {
            sheet_id: source_sheet_id.to_uuid_string(),
            operation: "relocate_cells".to_string(),
        });
    }

    let source_range = cell_types::RangePos::new(
        *source_sheet_id,
        src_start_row,
        src_start_col,
        src_end_row,
        src_end_col,
    );

    // 1. Perform relocation: grid + yrs data transfer in one step.
    mutation.observer.set_suppressed(true);
    let result = if source_sheet_id == target_sheet_id {
        let grid = stores
            .grid_indexes
            .get_mut(source_sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: id_to_hex(source_sheet_id.as_u128()).to_string(),
            })?;
        cell_iter::relocate_cells(
            stores.storage.doc(),
            stores.storage.sheets(),
            *source_sheet_id,
            &source_range,
            *target_sheet_id,
            target_row,
            target_col,
            grid,
            None,
        )
    } else {
        // Cross-sheet: need mutable borrows of two different grids. `get_many_mut`
        // isn't available, so split the map with `iter_mut` + a match.
        let (src_grid, tgt_grid) = {
            let mut src: Option<&mut _> = None;
            let mut tgt: Option<&mut _> = None;
            for (sid, grid) in stores.grid_indexes.iter_mut() {
                if sid == source_sheet_id {
                    src = Some(grid);
                } else if sid == target_sheet_id {
                    tgt = Some(grid);
                }
            }
            match (src, tgt) {
                (Some(s), Some(t)) => (s, t),
                _ => {
                    mutation.observer.set_suppressed(false);
                    return Err(ComputeError::SheetNotFound {
                        sheet_id: format!(
                            "source={} target={}",
                            id_to_hex(source_sheet_id.as_u128()),
                            id_to_hex(target_sheet_id.as_u128())
                        ),
                    });
                }
            }
        };
        cell_iter::relocate_cells(
            stores.storage.doc(),
            stores.storage.sheets(),
            *source_sheet_id,
            &source_range,
            *target_sheet_id,
            target_row,
            target_col,
            src_grid,
            Some(tgt_grid),
        )
    };
    mutation.observer.set_suppressed(false);

    metadata_shift::relocate_validation_ranges(
        stores,
        source_sheet_id,
        src_start_row,
        src_start_col,
        src_end_row,
        src_end_col,
        target_sheet_id,
        target_row,
        target_col,
    );

    // 2. Sync mirror and compute for all affected cells. The GridIndex is
    //    already in its final state post-relocation, so we can look up
    //    target positions straight from it.
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> = Vec::new();
    let mut clear_ids: Vec<CellId> = Vec::new();

    for &cell_id in &result.target_cells_cleared {
        clear_ids.push(cell_id);
    }

    for &cell_id in &result.moved_cell_ids {
        if let Some(grid) = stores.grid_indexes.get(target_sheet_id)
            && let Some((new_row, new_col)) = grid.cell_position(&cell_id)
            && let Some((value, formula, identity_formula)) =
                stores.storage.read_cell_from_yrs(target_sheet_id, &cell_id)
        {
            mirror.apply_edit(
                target_sheet_id,
                cell_id,
                SheetPos::new(new_row, new_col),
                value.clone(),
                identity_formula,
            );
            edits.push((*target_sheet_id, cell_id, new_row, new_col, value, formula));
        }
    }

    // filter viewport R5.3: emit clear-patches for the target-cleared range.
    // The clear pass populates `recalc.changed_cells` with `Null` entries
    // for each cell displaced by the move so the viewport buffer
    // atomically transitions away from the old values; previously this
    // was discarded via `let _ =` and the source cells stayed in the
    // buffer until a viewport refresh.
    let clear_recalc = if clear_ids.is_empty() {
        RecalcResult::empty()
    } else {
        stores.compute.clear_cells(mirror, &clear_ids)?
    };

    let mut recalc = if edits.is_empty() {
        clear_recalc
    } else {
        let mut write_recalc = stores.compute.set_cells_raw_with_trust(
            mirror,
            &edits,
            true,
            crate::scheduler::WriteTrust::UserEdit,
        )?;
        merge_recalc_results(&mut write_recalc, clear_recalc);
        write_recalc
    };

    // 3. Source-position clear pass.
    //
    // R5.3 covered `target_cells_cleared` (pre-existing destination cells
    // displaced by the move) but NOT the source positions the moved cells
    // vacated. Same-sheet cut-paste therefore left the source viewport
    // buffer showing stale values: `register_cell` cleaned up the grid
    // index but no patch was emitted for the old positions, so the
    // buffered value at A1 stayed visible until a full viewport refresh.
    //
    // R5.3 deleted the kernel-side `onCutPasteComplete` band-aid on the
    // premise that the Rust patch channel handled this. It didn't — fix
    // is here.
    //
    // We append synthetic Null `CellChange` entries (position-keyed,
    // empty `cell_id` since no live CellId remains at the vacated
    // position) for each source position that's now empty. These flow
    // through `flush_viewport_patches()` the same way target writes do;
    // the binary patch's value-type bits are `Null` (0), which tells the
    // viewport buffer the cell is empty.
    //
    // Filter out source positions that now host a moved CellId — overlap
    // case (e.g. moving A1:A3 to A2:A4 keeps A2 and A3 occupied by the
    // moved cells). Emitting Null at those positions would shadow the
    // valid destination write that already lives in `recalc.changed_cells`.
    if !result.source_positions_vacated.is_empty() {
        let source_sheet_str = source_sheet_id.to_uuid_string();
        let post_grid_has = |row: u32, col: u32| {
            stores
                .grid_indexes
                .get(source_sheet_id)
                .and_then(|g| g.cell_id_at(row, col))
                .is_some()
        };
        let mut source_clears: Vec<crate::snapshot::CellChange> =
            Vec::with_capacity(result.source_positions_vacated.len());
        for &(row, col) in &result.source_positions_vacated {
            // If a CellId still occupies this position post-relocate, the
            // destination write (or an overlap-survivor) already produces
            // the correct patch. Skip.
            if post_grid_has(row, col) {
                continue;
            }

            // Same-sheet relocate corrupts the mirror at the source
            // position: `apply_edit` for the moved cell wrote the new
            // (row,col) into `pos_to_id`/`id_to_pos`/`col_data` but did
            // NOT erase the old (row,col). The old `pos_to_id[(r,c)]`
            // still points at the moved CellId, and `col_data[col][row]`
            // still holds the old value. `for_each_cell_in_range` (the
            // production read path the kernel's `getCellsViaBridge`
            // fallback uses) sees `cell_id_at(r,c)=None` (grid is
            // right) but falls through to
            // `mirror.get_cell_value_at((r,c))` which returns the
            // stale value, so `query_range` reports the source cell
            // as still occupied. Cross-sheet doesn't hit this because
            // the source sheet's mirror entry never had the moved
            // CellId at the new position to begin with — only
            // same-sheet has the dual-mapping problem.
            //
            // Restore mirror coherence by vacating the position. The
            // CellId itself stays alive (it's at the new position
            // now); we only clear the position→id and col_data
            // entries left behind.
            mirror.vacate_position(source_sheet_id, SheetPos::new(row, col));

            source_clears.push(crate::snapshot::CellChange {
                cell_id: String::new(),
                sheet_id: source_sheet_str.clone(),
                position: Some(crate::snapshot::CellPosition { row, col }),
                value: CellValue::Null,
                display_text: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            });
        }
        if !source_clears.is_empty() {
            let mut source_recalc = RecalcResult::empty();
            source_recalc.changed_cells = source_clears;
            merge_recalc_results(&mut recalc, source_recalc);
        }
    }

    stores.compute.regenerate_formula_strings(mirror);

    let moved_ids: Vec<String> = result
        .moved_cell_ids
        .iter()
        .map(|cid| id_to_hex(cid.as_u128()).into())
        .collect();
    let cleared_ids: Vec<String> = result
        .target_cells_cleared
        .iter()
        .map(|cid| id_to_hex(cid.as_u128()).into())
        .collect();

    let relocate_result = RelocateResult {
        moved_cell_ids: moved_ids,
        target_cells_cleared: cleared_ids,
        success: result.success,
        error: result.error,
    };

    Ok((recalc, relocate_result))
}

// ---------------------------------------------------------------------------
// build_cross_sheet_adjusted_formula
// ---------------------------------------------------------------------------

/// Cross-sheet copy ref-rebind via parse/render round-trip.
///
/// `IdentityCellRef`/`IdentityRangeRef` carry only a `CellId`, not a "naked"
/// flag — the source/target sheet split is recovered at display time via
/// `WorkbookLookup::formula_sheet()`. So a copy from Sheet1!C1 (`=A1+B1`) to
/// Sheet2!C1 cannot just relocate the IDs: each `id` still maps to a cell on
/// Sheet1, and `to_a1_string` would emit `=Sheet1!A1+Sheet1!B1`.
///
/// Excel's rule is to rebind naked refs to the target sheet (so Sheet2!C1
/// reads `=A1+B1`) while keeping qualified cross-sheet refs intact (a
/// `=Sheet1!A1` stays `=Sheet1!A1`). The parser already encodes that rule:
/// `to_a1_string` strips the sheet prefix when the ref resolves to
/// `lookup.formula_sheet()`, and `to_identity_formula` re-binds unqualified
/// refs (`CURRENT_SHEET` sentinel) to `resolver.current_sheet()`. Round-tripping
/// the formula text through both sides moves naked refs onto the target sheet
/// without touching the identity types.
///
/// Pipeline:
/// 1. Render source `IdentityFormula` to A1 with `formula_sheet = source_sheet`
///    so naked refs come out unqualified.
/// 2. Re-parse the A1 string with `current_sheet = target_sheet` so naked refs
///    rebind to the target sheet (qualified refs preserve their explicit sheet).
/// 3. Build new `ref_positions` against the *fresh* identity formula and run
///    the standard `calculate_adjusted_positions` + `build_adjusted_formula`
///    path. With refs now living on the target sheet,
///    `mirror.sheet_for_cell(&id)` inside `build_adjusted_formula` returns the
///    target sheet, so newly-allocated post-shift cells land there too.
/// 4. Render via `to_a1_string` with `formula_sheet = target_sheet`.
///
/// Returns `None` if the round-trip yields an empty body or the source formula
/// is unparseable in the target context (in which case the caller falls back
/// to the source's typed value).
#[allow(clippy::too_many_arguments)]
fn build_cross_sheet_adjusted_formula(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    source_sheet_id: &SheetId,
    target_sheet_id: &SheetId,
    source_formula: &formula_types::IdentityFormula,
    src_row: u32,
    src_col: u32,
    tgt_row: u32,
    tgt_col: u32,
) -> Option<String> {
    use crate::mirror::MirrorPositionLookup;

    // Step 1: render source formula to A1 against the source sheet. Naked refs
    // emit no sheet prefix; cross-sheet refs keep their explicit qualifier.
    let source_lookup = MirrorPositionLookup::new(mirror, *source_sheet_id);
    let a1 = compute_parser::to_a1_string(source_formula, &source_lookup);
    if a1.is_empty() {
        return None;
    }

    // Step 2 + 3a: re-parse on the target sheet. `to_identity_formula` walks
    // the parser's `IdentityResolver` with `current_sheet = target_sheet_id`,
    // so naked refs are rebound to the target sheet while qualified refs land
    // on whatever sheet the qualifier names. This also recomputes
    // `is_dynamic_array`/`is_volatile`/`is_aggregate` for the new AST.
    let rebased = stores
        .compute
        .to_identity_formula(mirror, target_sheet_id, &a1)
        .ok()?;

    // Step 3b: build fresh ref_positions for the rebased formula. The fill
    // engine works in pure (row, col) space, so this is a per-ref lookup
    // against the (now rebased) mirror identities. Sheet membership for each
    // ref doesn't enter the position math — only the deltas do.
    let ref_positions: Vec<compute_fill::formula_adjust::RefPosition> = rebased
        .refs
        .iter()
        .map(|r| {
            super::fill::resolve_identity_ref_to_fill_position(
                mirror,
                target_sheet_id,
                r,
                src_row,
                src_col,
            )
        })
        .collect();

    // Step 3c: shift positions by (tgt - src) and rebuild the IdentityFormula.
    // `build_adjusted_formula` honors per-ref `out_of_bounds` from
    // `calculate_adjusted_positions` (the resulting A1 carries `#REF!` for
    // those refs).
    let adjusted_refs = compute_fill::formula_adjust::calculate_adjusted_positions(
        &rebased,
        (src_row, src_col),
        (tgt_row, tgt_col),
        &ref_positions,
    );
    let (new_formula, overrides) =
        build_adjusted_formula(stores, mirror, target_sheet_id, &rebased, &adjusted_refs)?;

    // Step 4: render against the target sheet so naked refs stay naked.
    let lookup = AdjustedPositionLookup {
        mirror,
        formula_sheet: *target_sheet_id,
        overrides,
    };
    let out = compute_parser::to_a1_string(&new_formula, &lookup);
    let body = out.strip_prefix('=').unwrap_or(&out).to_string();
    if body.is_empty() { None } else { Some(body) }
}

// ---------------------------------------------------------------------------
// mutation_copy_range
// ---------------------------------------------------------------------------

/// Copy cells from source range to target position with full 5-store sync.
///
/// Unlike `mutation_relocate_cells`, the source range is preserved.
/// Supports:
/// - `CopyType::All` — values + formulas + formats
/// - `CopyType::Values` — computed values only (no formulas)
/// - `CopyType::Formulas` — formulas with reference adjustment, values for non-formula cells
/// - `CopyType::Formats` — formats only, preserve target values
/// - `skip_blanks` — skip source cells that are blank
/// - `transpose` — swap row/col offsets
///
/// Cross-sheet copy uses [`build_cross_sheet_adjusted_formula`] for the
/// formula rebind so naked refs follow the cell to the new sheet (Excel
/// behavior); same-sheet copy stays on the direct `build_adjusted_formula`
/// path.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_copy_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    source_sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    target_sheet_id: &SheetId,
    target_row: u32,
    target_col: u32,
    copy_type: domain_types::CopyType,
    skip_blanks: bool,
    transpose: bool,
) -> Result<RecalcResult, ComputeError> {
    use crate::storage::properties;
    use domain_types::CopyType;

    // Range guard: reject if the destination sheet is Range-backed.
    if mirror
        .get_sheet(target_sheet_id)
        .is_some_and(|s| !s.range_views_is_empty())
    {
        return Err(ComputeError::RangeGuardViolation {
            sheet_id: target_sheet_id.to_uuid_string(),
            operation: "copy_range".to_string(),
        });
    }

    // ── Pass 1: Collect all source data (immutable borrows only) ──
    // This avoids borrow conflicts when we later need &mut mirror for
    // build_adjusted_formula in pass 2.

    struct SourceCellData {
        src_row: u32,
        src_col: u32,
        tgt_row: u32,
        tgt_col: u32,
        value: CellValue,
        formula: Option<formula_types::IdentityFormula>,
        ref_positions: Vec<compute_fill::formula_adjust::RefPosition>,
        format: Option<domain_types::CellFormat>,
    }

    let mut source_data: Vec<SourceCellData> = Vec::new();

    {
        let sheet_mirror = mirror.get_sheet(source_sheet_id);

        for src_row in src_start_row..=src_end_row {
            for src_col in src_start_col..=src_end_col {
                let row_offset = src_row - src_start_row;
                let col_offset = src_col - src_start_col;

                // Apply transpose: swap row/col offsets
                let (tgt_row, tgt_col) = if transpose {
                    (target_row + col_offset, target_col + row_offset)
                } else {
                    (target_row + row_offset, target_col + col_offset)
                };

                let pos = SheetPos::new(src_row, src_col);

                // Read source value
                let value = mirror
                    .get_cell_value_at(source_sheet_id, pos)
                    .cloned()
                    .unwrap_or(CellValue::Null);

                // Read source formula (identity formula for ref adjustment)
                let (formula, ref_positions) = if let Some(sm) = sheet_mirror {
                    if let Some(cell_id) = sm.cell_id_at(pos) {
                        if let Some(entry) = sm.get_cell(&cell_id) {
                            if let Some(ref id_formula) = entry.formula {
                                let positions: Vec<compute_fill::formula_adjust::RefPosition> =
                                    id_formula
                                        .refs
                                        .iter()
                                        .map(|r| {
                                            resolve_identity_ref_to_fill_position(
                                                mirror,
                                                source_sheet_id,
                                                r,
                                                src_row,
                                                src_col,
                                            )
                                        })
                                        .collect();
                                (Some((**id_formula).clone()), positions)
                            } else {
                                (None, Vec::new())
                            }
                        } else {
                            (None, Vec::new())
                        }
                    } else {
                        (None, Vec::new())
                    }
                } else {
                    (None, Vec::new())
                };

                // Skip blank cells when skip_blanks is enabled
                if skip_blanks && value == CellValue::Null && formula.is_none() {
                    continue;
                }

                // Read source format (only needed for All and Formats modes)
                let format = match copy_type {
                    CopyType::All | CopyType::Formats => sheet_mirror
                        .as_ref()
                        .and_then(|sm| sm.cell_id_at(pos))
                        .map(|cell_id| {
                            let cell_hex = id_to_hex(cell_id.as_u128());
                            let table_fmt = super::super::tables::resolve_table_format_at_cell(
                                mirror,
                                source_sheet_id,
                                src_row,
                                src_col,
                            );
                            properties::get_effective_format(
                                &stores.storage,
                                source_sheet_id,
                                &cell_hex,
                                src_row,
                                src_col,
                                table_fmt.as_ref(),
                                stores.grid_indexes.get(source_sheet_id),
                                mirror.get_sheet(source_sheet_id),
                            )
                        }),
                    _ => None,
                };

                source_data.push(SourceCellData {
                    src_row,
                    src_col,
                    tgt_row,
                    tgt_col,
                    value,
                    formula,
                    ref_positions,
                    format,
                });
            }
        }
    } // sheet_mirror borrow ends here

    // ── Pass 2: Process collected data with mutable access to mirror ──

    let mut cell_edits: Vec<(SheetId, u32, u32, CellValue, Option<String>)> = Vec::new();
    let mut format_edits: Vec<(SheetId, u32, u32, domain_types::CellFormat)> = Vec::new();

    mutation.observer.set_suppressed(true);

    let is_cross_sheet = source_sheet_id != target_sheet_id;

    // Render an IdentityFormula to an A1 body against the target position. Returns
    // None if the result is empty (no body after stripping '=').
    //
    // Same-sheet path: feed the source IdentityFormula directly into
    // `build_adjusted_formula`. Refs stay bound to the source (== target) sheet.
    //
    // Cross-sheet path: round-trip through the parser so naked refs rebind to
    // the target sheet. Without this, naked `A1` on Sheet1!C1 copied to Sheet2!C1
    // would render as `Sheet1!A1` (because the IdentityCellRef's `id` still
    // resolves to a cell on Sheet1). See `build_cross_sheet_adjusted_formula`.
    let render_formula_body = |stores: &mut EngineStores,
                               mirror: &mut CellMirror,
                               src: &SourceCellData|
     -> Option<String> {
        let id_formula = src.formula.as_ref()?;
        if is_cross_sheet {
            return build_cross_sheet_adjusted_formula(
                stores,
                mirror,
                source_sheet_id,
                target_sheet_id,
                id_formula,
                src.src_row,
                src.src_col,
                src.tgt_row,
                src.tgt_col,
            );
        }
        let adjusted_refs = compute_fill::formula_adjust::calculate_adjusted_positions(
            id_formula,
            (src.src_row, src.src_col),
            (src.tgt_row, src.tgt_col),
            &src.ref_positions,
        );
        let (new_formula, overrides) =
            build_adjusted_formula(stores, mirror, target_sheet_id, id_formula, &adjusted_refs)?;
        let lookup = AdjustedPositionLookup {
            mirror,
            formula_sheet: *target_sheet_id,
            overrides,
        };
        let a1 = compute_parser::to_a1_string(&new_formula, &lookup);
        let body = a1.strip_prefix('=').unwrap_or(&a1).to_string();
        if body.is_empty() { None } else { Some(body) }
    };

    for src in &source_data {
        match copy_type {
            CopyType::All => {
                // Prefer formula (with adjustment); fall back to typed value.
                let formula_body = render_formula_body(stores, mirror, src);
                match formula_body {
                    Some(body) => cell_edits.push((
                        *target_sheet_id,
                        src.tgt_row,
                        src.tgt_col,
                        CellValue::Null,
                        Some(body),
                    )),
                    None => cell_edits.push((
                        *target_sheet_id,
                        src.tgt_row,
                        src.tgt_col,
                        src.value.clone(),
                        None,
                    )),
                }
                if let Some(ref fmt) = src.format {
                    format_edits.push((*target_sheet_id, src.tgt_row, src.tgt_col, fmt.clone()));
                }
            }

            CopyType::Formulas => {
                let formula_body = render_formula_body(stores, mirror, src);
                match formula_body {
                    Some(body) => cell_edits.push((
                        *target_sheet_id,
                        src.tgt_row,
                        src.tgt_col,
                        CellValue::Null,
                        Some(body),
                    )),
                    None => cell_edits.push((
                        *target_sheet_id,
                        src.tgt_row,
                        src.tgt_col,
                        src.value.clone(),
                        None,
                    )),
                }
            }

            CopyType::Values => {
                cell_edits.push((
                    *target_sheet_id,
                    src.tgt_row,
                    src.tgt_col,
                    src.value.clone(),
                    None,
                ));
            }

            CopyType::Formats => {
                if let Some(ref fmt) = src.format {
                    format_edits.push((*target_sheet_id, src.tgt_row, src.tgt_col, fmt.clone()));
                }
            }
        }
    }

    // Apply format edits
    for (sheet_id, row, col, format) in &format_edits {
        let Some(cell_id) = super::super::cell_editing::ensure_cell_id_mirrored(
            stores, mirror, sheet_id, *row, *col,
        ) else {
            continue;
        };
        let cell_hex = id_to_hex(cell_id.as_u128());
        properties::set_cell_format(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            stores.storage.sheets(),
            sheet_id,
            &cell_hex,
            format,
        );
    }

    mutation.observer.set_suppressed(false);

    if cell_edits.is_empty() {
        return Ok(RecalcResult::empty());
    }

    mutation_set_cells_by_position_raw(stores, mirror, mutation, cell_edits, false)
}

// ---------------------------------------------------------------------------
// mutation_remove_duplicates
// ---------------------------------------------------------------------------

/// Remove duplicate rows from a range with full 5-store sync.
///
/// 1. Collect old CellIds from GridIndex for the affected range.
/// 2. Suppress observer and call cell_ops::remove_duplicates on Yrs Doc.
/// 3. Rebuild GridIndex for the affected range from Yrs state.
/// 4. Clear stale cells from mirror/compute, sync remaining cells.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_remove_duplicates(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    columns: &[u32],
    has_headers: bool,
) -> Result<(RecalcResult, serde_json::Value), ComputeError> {
    use crate::storage::cells::data_ops as cell_ops;
    use std::collections::HashSet;

    // Range guard: reject if the target sheet is Range-backed.
    if mirror
        .get_sheet(sheet_id)
        .is_some_and(|s| !s.range_views_is_empty())
    {
        return Err(ComputeError::RangeGuardViolation {
            sheet_id: sheet_id.to_uuid_string(),
            operation: "remove_duplicates".to_string(),
        });
    }

    let options = cell_ops::RemoveDuplicatesOptions {
        has_headers,
        columns_to_compare: columns.to_vec(),
        case_sensitive: false,
    };

    let first_data_row = if has_headers {
        start_row + 1
    } else {
        start_row
    };

    // 1. Collect all pre-existing CellIds in the affected range from the
    //    GridIndex so we can diff against the post-compaction state to know
    //    which CellIds were removed and must be cleared from compute.
    let mut old_cell_ids: HashSet<CellId> = HashSet::new();
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for row in first_data_row..=end_row {
            for col in start_col..=end_col {
                if let Some(cell_id) = grid.cell_id_at(row, col) {
                    old_cell_ids.insert(cell_id);
                }
            }
        }
    }

    // 2. Suppress observer — we'll manually sync stores below.
    //    `remove_duplicates` manages cell identities through the GridIndex
    //    directly, so the GridIndex is in its final authoritative state
    //    after this call returns.
    mutation.observer.set_suppressed(true);
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: id_to_hex(sheet_id.as_u128()).to_string(),
            })?;
    let result = cell_ops::remove_duplicates(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        start_row,
        start_col,
        end_row,
        end_col,
        &options,
    );
    mutation.observer.set_suppressed(false);

    let data = serde_json::json!({
        "duplicatesFound": result.duplicates_found,
        "duplicatesRemoved": result.duplicates_removed,
        "uniqueValuesRemaining": result.unique_values_remaining,
    });

    if result.duplicates_removed == 0 {
        return Ok((RecalcResult::empty(), data));
    }

    // 3. Collect the post-compaction CellIds from the GridIndex.
    let mut new_cell_ids: HashSet<CellId> = HashSet::new();
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        for row in first_data_row..=end_row {
            for col in start_col..=end_col {
                if let Some(cell_id) = grid.cell_id_at(row, col) {
                    new_cell_ids.insert(cell_id);
                }
            }
        }
    }

    // 4. Clear cells that existed before but are now gone. filter viewport R5.3:
    //    capture the clear's recalc so its `Null` viewport patches reach the
    //    buffer; previously this was `let _ =` and the trailing rows kept
    //    their pre-compaction values until a viewport refresh.
    let removed_cell_ids: Vec<CellId> = old_cell_ids.difference(&new_cell_ids).copied().collect();
    let clear_recalc = if removed_cell_ids.is_empty() {
        RecalcResult::empty()
    } else {
        stores.compute.clear_cells(mirror, &removed_cell_ids)?
    };

    // 5. Sync mirror + compute for all cells still in the range.
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> = Vec::new();

    for row in first_data_row..=end_row {
        for col in start_col..=end_col {
            if let Some(grid) = stores.grid_indexes.get(sheet_id)
                && let Some(cell_id) = grid.cell_id_at(row, col)
                && let Some((value, formula, identity_formula)) =
                    stores.storage.read_cell_from_yrs(sheet_id, &cell_id)
            {
                mirror.apply_edit(
                    sheet_id,
                    cell_id,
                    SheetPos::new(row, col),
                    value.clone(),
                    identity_formula,
                );
                edits.push((*sheet_id, cell_id, row, col, value, formula));
            }
        }
    }

    let recalc = if edits.is_empty() {
        clear_recalc
    } else {
        let mut write_recalc = stores.compute.set_cells_raw_with_trust(
            mirror,
            &edits,
            true,
            crate::scheduler::WriteTrust::UserEdit,
        )?;
        merge_recalc_results(&mut write_recalc, clear_recalc);
        write_recalc
    };

    Ok((recalc, data))
}
