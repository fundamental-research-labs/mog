//! Mutation pipeline helpers extracted as free functions.
//!
//! These functions handle the observer-driven synchronisation that keeps the
//! mirror, grid_indexes, compute scheduler, layout_indexes, and merge_indexes
//! in sync with yrs Doc changes. The 5-step ordering is **load-bearing**:
//! mirror -> grid_indexes -> compute -> layout -> merges.

use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::range_manager::RangeSpatialIndex;
use crate::snapshot::RecalcResult;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{dimensions, merges};
use compute_document::observe::{CellChange, CellChangeKind, DocumentChanges};

use super::super::merge_index::{MergeRangeRef, MergeSpatialItem};

/// Parse an A1-style range string (e.g., `"A1:C5"`) into 0-based
/// `(start_row, start_col, end_row, end_col)`. Local helper for
/// reconciling the persisted CSE marker against the runtime mirror.
/// Returns `None` if the string can't be parsed as a positional range.
fn parse_a1_range_simple(s: &str) -> Option<(u32, u32, u32, u32)> {
    if !s.contains(':') {
        return None;
    }
    let range = compute_parser::parse_a1_range(s)?;
    let (sr, sc) = match range.start {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let (er, ec) = match range.end {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    Some((sr, sc, er, ec))
}

// ---------------------------------------------------------------------------
// apply_cell_changes — mirror sync + grid index updates + recalc
// ---------------------------------------------------------------------------

/// Process cell-only changes from the observer (mirror sync + recalc).
///
/// For each modified cell: reads the current state from yrs, updates the
/// mirror and grid index, then delegates to ComputeCore for recalculation.
/// For each removed cell: removes from mirror and grid index, then clears
/// in ComputeCore.
pub(in crate::storage::engine) fn apply_cell_changes(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    changes: &[CellChange],
) -> Result<RecalcResult, ComputeError> {
    let mut edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)> =
        Vec::with_capacity(changes.len());
    let mut removed_cells = Vec::new();

    let mut observer_old_values: std::collections::HashMap<String, CellValue> =
        std::collections::HashMap::new();

    for change in changes {
        let CellChange {
            sheet_id,
            cell_id,
            kind,
            old_value,
        } = change;

        // Preserve observer-provided old values for undo/redo support.
        if let Some(val) = old_value {
            let key = format!("{}:{}", sheet_id.to_uuid_string(), cell_id.to_uuid_string(),);
            observer_old_values.insert(key, val.clone());
        }
        match kind {
            CellChangeKind::Modified => {
                // Read current state from yrs Doc — also pulls the
                // CSE array-formula range (`KEY_ARRAY_REF`) so the
                // runtime mirror's `cse_anchors` set tracks the Yrs
                // doc through undo/redo. table dependency work T6: the marker was
                // runtime-only pre-fix; undo replayed the formula
                // write but the CSE flag was lost.
                if let Some((value, formula, identity_formula, array_ref)) =
                    stores.storage.read_cell_from_yrs_full(sheet_id, cell_id)
                {
                    // Find position from mirror, in-memory grid index,
                    // or yrs grid index (fallback for redo after undo).
                    let pos = mirror
                        .resolve_position(cell_id)
                        .or_else(|| {
                            stores
                                .grid_indexes
                                .get(sheet_id)
                                .and_then(|g| g.cell_position(cell_id))
                                .map(|(r, c)| SheetPos::new(r, c))
                        })
                        .or_else(|| {
                            // Fallback: read from yrs grid index (idToPos).
                            // Needed when redo re-adds a cell whose position
                            // was cleared from mirror/grid_indexes during undo.
                            stores
                                .storage
                                .read_cell_position_from_yrs(sheet_id, cell_id)
                        });

                    if let Some(pos) = pos {
                        // In collaborative mode, multiple engines may create
                        // different CellIds for the same position. After CRDT
                        // merge, posToId resolves to one winner (LWW). Skip
                        // cells whose position was won by a different CellId.
                        if let Some(winner) =
                            stores
                                .storage
                                .read_cell_id_at_pos(sheet_id, pos.row(), pos.col())
                            && winner != *cell_id
                        {
                            // This cell lost the position conflict — skip it.
                            continue;
                        }

                        // Update mirror with IdentityFormula from yrs.
                        mirror.apply_edit(sheet_id, *cell_id, pos, value.clone(), identity_formula);

                        // Reconcile CSE marker with the persisted
                        // `KEY_ARRAY_REF`. Yrs is the source of truth
                        // for "is this cell a CSE anchor", so undo/
                        // redo replays correctly through the observer.
                        if let Some(ref ar_str) = array_ref {
                            mirror.mark_cse_anchor(*cell_id);
                            // Re-register the projection extent so
                            // post-undo writes inside the rectangle
                            // are still rejected as PartialArrayWrite.
                            if let Some((sr, sc, er, ec)) = parse_a1_range_simple(ar_str) {
                                let rows = er - sr + 1;
                                let cols = ec - sc + 1;
                                if rows == 1 && cols == 1 {
                                    mirror.cse_single_cell.insert(*cell_id);
                                } else {
                                    mirror
                                        .projection_registry
                                        .register(*cell_id, *sheet_id, sr, sc, rows, cols);
                                }
                            }
                        } else {
                            mirror.unmark_cse_anchor(cell_id);
                            mirror.cse_single_cell.remove(cell_id);
                        }

                        // Update grid_indexes — ensure cell is registered at position
                        if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
                            grid.register_cell(*cell_id, pos.row(), pos.col());
                        }

                        edits.push((*sheet_id, *cell_id, pos.row(), pos.col(), value, formula));
                    }
                }
            }
            CellChangeKind::Removed => {
                // During redo, a relocated cell may have taken over this
                // position: yrs posToId now points to the new winner.
                // In that case, remove this cell from mirror/grid without
                // emitting a Null viewport patch (the winner's Modified
                // change will write the correct value at the shared position).
                let evicted = mirror
                    .resolve_position(cell_id)
                    .and_then(|pos| {
                        stores
                            .storage
                            .read_cell_id_at_pos(sheet_id, pos.row(), pos.col())
                    })
                    .is_some_and(|winner| winner != *cell_id);

                if evicted {
                    // Position is owned by another cell — evict silently.
                    mirror.remove_cell(cell_id);
                    if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
                        grid.remove_cell(cell_id);
                    }
                } else {
                    // Defer mirror/grid removal — clear_cells() needs position
                    // info from the mirror to generate viewport patches. We
                    // remove from mirror and grid_indexes AFTER clear_cells().
                    removed_cells.push((*sheet_id, *cell_id));
                }
            }
        }
    }

    // Apply edits to ComputeCore.
    //
    // Trusted bulk path: CRDT sync/undo/redo replays edits whose cycle
    // structure is already established on the authoring peer. Per-edge DFS
    // here would #REF! whichever formula the CRDT happens to deliver last
    // that closes a cycle, diverging from the authoring peer (which goes
    // through the batch path with `skip_cycle_check=true`). The topological
    // sort in recalc() handles cycles uniformly for both peers.
    let mut result = if !edits.is_empty() {
        // Yrs replay — the upstream op (the authoring peer's user edit)
        // already passed its region partial-write guard, so this path
        // takes the legacy `set_cells_raw` (default `TrustedReplay`
        // trust). The replayed values are by construction consistent
        // with the authoring peer's region invariants.
        let edit_result = stores.compute.set_cells_raw(mirror, &edits, true)?;

        // Also handle removed cells
        if !removed_cells.is_empty() {
            let cell_ids: Vec<CellId> = removed_cells.iter().map(|(_, id)| *id).collect();
            let clear_result = stores.compute.clear_cells(mirror, &cell_ids)?;

            // NOW remove from mirror and grid_indexes (after clear_cells used position info)
            for (sheet_id, cell_id) in &removed_cells {
                mirror.remove_cell(cell_id);
                if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
                    grid.remove_cell(cell_id);
                }
            }

            merge_recalc_results(edit_result, clear_result)
        } else {
            edit_result
        }
    } else if !removed_cells.is_empty() {
        let clear_result = {
            let cell_ids: Vec<CellId> = removed_cells.iter().map(|(_, id)| *id).collect();
            stores.compute.clear_cells(mirror, &cell_ids)?
        };

        // NOW remove from mirror and grid_indexes (after clear_cells used position info)
        for (sheet_id, cell_id) in &removed_cells {
            mirror.remove_cell(cell_id);
            if let Some(grid) = stores.grid_indexes.get_mut(sheet_id) {
                grid.remove_cell(cell_id);
            }
        }

        clear_result
    } else {
        RecalcResult::empty()
    };

    // Thread observer-provided old values into the RecalcResult.
    // These come from yrs EntryChange::Updated/Removed variants and are
    // needed for undo/redo old-value tracking.
    for (key, val) in observer_old_values {
        result.old_values.entry(key).or_insert(val);
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// apply_dimension_changes_to_layout
// ---------------------------------------------------------------------------

/// Update layout indexes from observer dimension changes.
///
/// Handles row heights, column widths, hidden rows, and hidden columns
/// by reading the current state from the yrs Doc and applying to the
/// in-memory LayoutIndex.
pub(in crate::storage::engine) fn apply_dimension_changes_to_layout(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    changes: &DocumentChanges,
) {
    // Row heights — Yrs stores points, LayoutIndex needs pixels
    for dch in &changes.row_heights {
        let row_pos = resolve_hex_id_to_position(stores, &dch.sheet_id, &dch.key, true);
        if let Some(row) = row_pos
            && let Some(li) = stores.layout_indexes.get_mut(&dch.sheet_id)
        {
            match dch.kind {
                CellChangeKind::Modified => {
                    // Read canonical value (points) and convert to pixels
                    let height_pt = dimensions::get_row_height(
                        stores.storage.doc(),
                        stores.storage.sheets(),
                        &dch.sheet_id,
                        row,
                        stores.grid_indexes.get(&dch.sheet_id),
                    );
                    // get_row_height returns 0 for hidden rows — keep that
                    let height_px = if height_pt.0 == 0.0 {
                        domain_types::units::Pixels(0.0)
                    } else {
                        domain_types::units::points_to_pixels(height_pt)
                    };
                    li.set_row_height(row as usize, height_px);
                }
                CellChangeKind::Removed => {
                    let default_px =
                        domain_types::units::points_to_pixels(dimensions::DEFAULT_ROW_HEIGHT);
                    li.set_row_height(row as usize, default_px);
                }
            }
        }
    }

    // Column widths — Yrs stores char-width, LayoutIndex needs pixels
    let mdw = domain_types::units::platform_mdw();
    for dch in &changes.col_widths {
        let col_pos = resolve_hex_id_to_position(stores, &dch.sheet_id, &dch.key, false);
        if let Some(col) = col_pos
            && let Some(li) = stores.layout_indexes.get_mut(&dch.sheet_id)
        {
            match dch.kind {
                CellChangeKind::Modified => {
                    // Read canonical value (char-width) and convert to pixels
                    let width_cw = dimensions::get_col_width(
                        stores.storage.doc(),
                        stores.storage.sheets(),
                        &dch.sheet_id,
                        col,
                        stores.grid_indexes.get(&dch.sheet_id),
                    );
                    // get_col_width returns 0 for hidden cols — keep that
                    let width_px = if width_cw.0 == 0.0 {
                        domain_types::units::Pixels(0.0)
                    } else {
                        domain_types::units::char_width_to_pixels(width_cw, mdw)
                    };
                    li.set_col_width(col as usize, width_px);
                }
                CellChangeKind::Removed => {
                    // Revert to the sheet's default (respects metadata).
                    let default_cw = dimensions::get_sheet_default_col_width(
                        stores.storage.doc(),
                        stores.storage.sheets(),
                        &dch.sheet_id,
                    );
                    let default_px = domain_types::units::char_width_to_pixels(default_cw, mdw);
                    li.set_col_width(col as usize, default_px);
                }
            }
        }
    }

    // Hidden rows
    for vch in &changes.hidden_rows {
        let row_pos = resolve_hex_id_to_position(stores, &vch.sheet_id, &vch.key, true);
        if let Some(row) = row_pos {
            let is_hidden = dimensions::is_row_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                &vch.sheet_id,
                row,
            );
            if let Some(li) = stores.layout_indexes.get_mut(&vch.sheet_id) {
                if is_hidden {
                    li.hide_row(row as usize);
                } else {
                    li.unhide_row(row as usize);
                }
            }
            // Propagate hidden-row state to the CellMirror so that
            // SUBTOTAL and other aggregate functions can skip filtered rows.
            mirror.set_row_hidden(&vch.sheet_id, row, is_hidden);
        }
    }

    // Hidden cols
    for vch in &changes.hidden_cols {
        let col_pos = resolve_hex_id_to_position(stores, &vch.sheet_id, &vch.key, false);
        if let Some(col) = col_pos
            && let Some(li) = stores.layout_indexes.get_mut(&vch.sheet_id)
        {
            let is_hidden = dimensions::is_column_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                &vch.sheet_id,
                col,
            );
            if is_hidden {
                li.hide_col(col as usize);
            } else {
                li.unhide_col(col as usize);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// apply_merge_changes_to_index
// ---------------------------------------------------------------------------

/// Rebuild merge indexes for sheets that had merge changes.
///
/// Collects unique affected sheet IDs from the observer changes, then
/// fully rebuilds the merge spatial index for each from the yrs Doc.
/// Also syncs merge regions into `mirror` so spill detection sees them.
pub(in crate::storage::engine) fn apply_merge_changes_to_index(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    changes: &DocumentChanges,
) {
    let mut affected_sheets = Vec::new();
    for mch in &changes.merges {
        if !affected_sheets.contains(&mch.sheet_id) {
            affected_sheets.push(mch.sheet_id);
        }
    }
    for sheet_id in &affected_sheets {
        rebuild_merge_index(stores, sheet_id);
        sync_mirror_merge_regions(stores, mirror, sheet_id);
    }
}

/// Rebuild the merge spatial index for a sheet by reading all merges
/// from the yrs Doc.
///
/// Called after merge/unmerge operations, structural changes (insert/delete
/// rows/cols), and sheet creation/copy to keep the index in sync.
pub(in crate::storage::engine) fn rebuild_merge_index(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) {
    let resolved = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_all_merges(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
        ),
        None => Vec::new(),
    };
    let items: Vec<MergeSpatialItem> = resolved
        .iter()
        .map(|m| MergeSpatialItem {
            id: m.merge.top_left_id.clone(),
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
            range_ref: MergeRangeRef {
                start_row: m.start_row,
                start_col: m.start_col,
                end_row: m.end_row,
                end_col: m.end_col,
            },
        })
        .collect();

    if let Some(index) = stores.merge_indexes.get_mut(sheet_id) {
        index.rebuild(items);
    } else {
        stores
            .merge_indexes
            .insert(*sheet_id, RangeSpatialIndex::with_items(items));
    }
}

/// Sync the CellMirror's merge regions from the yrs Doc for a sheet.
///
/// Must be called after any merge/unmerge operation so that
/// `ProjectionRegistry::check_conflict` can detect merged-cell spill blockers.
/// Without this, dynamic-array formulas (e.g. SEQUENCE) spill into merged
/// regions instead of yielding #SPILL! at the anchor.
///
/// This is separate from `rebuild_merge_index` because bridge write methods
/// have access to `CellMirror` but the inner service functions do not — they
/// call `rebuild_merge_index` on the stores, then the bridge method calls this
/// helper with the mirror to complete the two-phase sync.
pub(in crate::storage::engine) fn sync_mirror_merge_regions(
    stores: &EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
) {
    let resolved = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_all_merges(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
        ),
        None => Vec::new(),
    };
    let mirror_regions: Vec<crate::mirror::MergeRegion> = resolved
        .iter()
        .map(|m| crate::mirror::MergeRegion {
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
        })
        .collect();
    mirror.set_merge_regions(sheet_id, mirror_regions);
}

// ---------------------------------------------------------------------------
// Private helpers (re-exported from mod.rs free functions)
// ---------------------------------------------------------------------------

/// Merge two RecalcResult values, combining changed cells and errors.
fn merge_recalc_results(a: RecalcResult, b: RecalcResult) -> RecalcResult {
    let mut changed_cells = a.changed_cells;
    changed_cells.extend(b.changed_cells);
    let mut projection_changes = a.projection_changes;
    projection_changes.extend(b.projection_changes);
    let mut errors = a.errors;
    errors.extend(b.errors);
    let mut validation_annotations = a.validation_annotations;
    validation_annotations.extend(b.validation_annotations);
    // Merge metrics: sum all counters, take max of max_deps_per_cell and range_scan_max_cells
    let mut metrics = a.metrics;
    metrics.cells_evaluated += b.metrics.cells_evaluated;
    metrics.cells_skipped_clean += b.metrics.cells_skipped_clean;
    metrics.cells_with_errors += b.metrics.cells_with_errors;
    metrics.topo_levels = metrics.topo_levels.max(b.metrics.topo_levels);
    metrics.max_deps_per_cell = metrics.max_deps_per_cell.max(b.metrics.max_deps_per_cell);
    metrics.total_dep_edges += b.metrics.total_dep_edges;
    metrics.range_scans += b.metrics.range_scans;
    metrics.range_scan_total_cells += b.metrics.range_scan_total_cells;
    metrics.range_scan_max_cells = metrics
        .range_scan_max_cells
        .max(b.metrics.range_scan_max_cells);
    metrics.cache_hits += b.metrics.cache_hits;
    metrics.cache_misses += b.metrics.cache_misses;
    metrics.cache_rebuilds += b.metrics.cache_rebuilds;
    metrics.cache_evictions += b.metrics.cache_evictions;
    metrics.agg_prepass_groups += b.metrics.agg_prepass_groups;
    metrics.agg_prepass_cells += b.metrics.agg_prepass_cells;
    metrics.levels_parallel += b.metrics.levels_parallel;
    metrics.levels_sequential += b.metrics.levels_sequential;
    metrics.parallel_batch_cells += b.metrics.parallel_batch_cells;
    metrics.hashmap_inserts += b.metrics.hashmap_inserts;
    metrics.hashmap_capacity_grows += b.metrics.hashmap_capacity_grows;
    metrics.projections_registered += b.metrics.projections_registered;
    metrics.projections_materialized += b.metrics.projections_materialized;
    metrics.projection_conflicts += b.metrics.projection_conflicts;

    RecalcResult {
        changed_cells,
        projection_changes,
        errors,
        validation_annotations,
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
        metrics,
        old_values: {
            let mut merged = a.old_values;
            merged.extend(b.old_values);
            merged
        },
    }
}

/// Resolve a row/col hex ID to a position via the GridIndex.
///
/// `is_row` determines whether to search row IDs or column IDs.
pub(in crate::storage::engine) fn resolve_hex_id_to_position(
    stores: &EngineStores,
    sheet_id: &SheetId,
    hex_id: &str,
    is_row: bool,
) -> Option<u32> {
    use compute_document::hex::hex_to_id;
    let raw = hex_to_id(hex_id)?;
    let grid = stores.grid_indexes.get(sheet_id)?;
    if is_row {
        let rid = cell_types::RowId::from_raw(raw);
        grid.row_index(&rid)
    } else {
        let cid = cell_types::ColId::from_raw(raw);
        grid.col_index(&cid)
    }
}
