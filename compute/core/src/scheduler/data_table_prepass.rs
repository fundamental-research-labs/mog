//! Data table prepass helpers for TABLE formula detection and A1 reference parsing.
//!
//! The `run_data_table_prepass` method resolves all TABLE formula cells in a batch
//! before level-based evaluation, analogous to `run_agg_prepass`.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::mirror::CellMirror;
use cell_types::{CellId, SheetId, SheetPos};
use compute_parser::ASTNode;
use formula_types::CellRef;
use snapshot_types::DataTableRegionDef;
use value_types::{CellError, CellValue};

#[cfg(test)]
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

/// Region group: maps (sheet_uuid, start_row, start_col) to (region_def, cells).
type RegionGroupMap = FxHashMap<(String, u32, u32), (DataTableRegionDef, Vec<(CellId, u32, u32)>)>;

#[cfg(test)]
static DATA_TABLE_PANIC_AFTER_OVERRIDE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static DATA_TABLE_EVAL_SCOPE_ENTRIES: AtomicUsize = AtomicUsize::new(0);
#[cfg(test)]
static DATA_TABLE_RESTORE_CALLS: AtomicUsize = AtomicUsize::new(0);

#[cfg(test)]
pub(super) fn set_data_table_panic_after_override_for_tests(enabled: bool) {
    DATA_TABLE_PANIC_AFTER_OVERRIDE.store(enabled, Ordering::SeqCst);
}

#[cfg(test)]
pub(super) fn reset_data_table_eval_scope_entries_for_tests() {
    DATA_TABLE_EVAL_SCOPE_ENTRIES.store(0, Ordering::SeqCst);
}

#[cfg(test)]
pub(super) fn data_table_eval_scope_entries_for_tests() -> usize {
    DATA_TABLE_EVAL_SCOPE_ENTRIES.load(Ordering::SeqCst)
}

#[cfg(test)]
pub(super) fn reset_data_table_restore_calls_for_tests() {
    DATA_TABLE_RESTORE_CALLS.store(0, Ordering::SeqCst);
}

#[cfg(test)]
pub(super) fn data_table_restore_calls_for_tests() -> usize {
    DATA_TABLE_RESTORE_CALLS.load(Ordering::SeqCst)
}

fn clear_data_table_eval_caches() {
    crate::eval::cache::subexpr_cache::clear();
    compute_functions::helpers::sorted_cache::clear();
    compute_functions::helpers::frequency_cache::clear();
    compute_functions::helpers::bitmask_cache::clear();
    compute_functions::helpers::column_index::clear();
    compute_functions::helpers::sumifs_result_cache::clear();
}

fn restore_data_table_saved_values(mirror: &mut CellMirror, saved_values: &[(CellId, CellValue)]) {
    #[cfg(test)]
    DATA_TABLE_RESTORE_CALLS.fetch_add(1, Ordering::SeqCst);
    for (cid, val) in saved_values {
        mirror.set_value_mut(cid, val.clone());
    }
    clear_data_table_eval_caches();
}

/// Return the current values for a registered data-table region.
///
/// `TABLE()` is a region-owned pseudo-formula, not a normal worksheet function.
/// If the prepass cannot reconstruct enough of the data-table model to evaluate
/// a registered region, keep those cells resolved to their current values so
/// they do not fall through to ordinary formula evaluation as `#CALC!`.
fn current_data_table_region_values(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    region: &DataTableRegionDef,
    id_alloc: &cell_types::IdAllocator,
) -> Vec<(CellId, CellValue)> {
    let mut values = Vec::new();
    for row in region.start_row..=region.end_row {
        for col in region.start_col..=region.end_col {
            let pos = SheetPos::new(row, col);
            let Some(cell_id) = mirror.ensure_cell_id_identity_only(sheet_id, pos, id_alloc) else {
                continue;
            };
            let value = mirror
                .get_cell_value_raw(&cell_id)
                .or_else(|| mirror.get_cell_value_at(sheet_id, pos))
                .cloned()
                .unwrap_or(CellValue::Null);
            values.push((cell_id, value));
        }
    }
    values
}

/// Check if an AST node is a top-level TABLE function call.
pub(super) fn is_table_formula(ast: &ASTNode) -> bool {
    matches!(ast, ASTNode::Function { name, .. } if name.eq_ignore_ascii_case("TABLE"))
}

/// Resolve a typed `CellRef` to its (row, col) on the given mirror.
///
/// `Positional` refs return their stored (row, col) directly.
/// `Resolved` refs look up the cell's current position via the mirror.
fn cell_ref_to_position(r: &CellRef, mirror: &CellMirror) -> Option<(u32, u32)> {
    match r {
        CellRef::Positional { row, col, .. } => Some((*row, *col)),
        CellRef::Resolved(cell_id) => {
            let sheet_id = mirror.sheet_for_cell(cell_id)?;
            let sheet = mirror.get_sheet(&sheet_id)?;
            let pos = sheet.position_of(cell_id)?;
            Some((pos.row(), pos.col()))
        }
    }
}

// ---------------------------------------------------------------------------
// ComputeCore integration — batch data table prepass
// ---------------------------------------------------------------------------

impl super::ComputeCore {
    /// Resolve all data table TABLE cells in a batch before level-based evaluation.
    /// Returns `Vec<(CellId, CellValue)>` of resolved cells (same contract as `run_agg_prepass`).
    pub(super) fn run_data_table_prepass(
        &mut self,
        mirror: &mut CellMirror,
        dirty_set: &FxHashSet<CellId>,
    ) -> Vec<(CellId, CellValue)> {
        // Guard: skip if we're already inside a data table evaluation
        // (full_recalc triggers topo_evaluate_pass which calls this again).
        if self.in_data_table_eval {
            return Vec::new();
        }

        // Step 1: Find all TABLE formula cells in the dirty set
        let mut table_cells: Vec<(CellId, SheetId, u32, u32)> = Vec::new();
        for &cell_id in dirty_set {
            if let Some(entry) = self.ast_cache.get(&cell_id)
                && is_table_formula(&entry.ast)
                && let Some(compute_graph::CellPosition {
                    sheet: sheet_id,
                    row,
                    col,
                }) = compute_graph::PositionResolver::resolve(mirror, &cell_id)
            {
                table_cells.push((cell_id, sheet_id, row, col));
            }
        }
        if table_cells.is_empty() {
            return Vec::new();
        }

        // Step 2: Group TABLE cells by registered data table region.
        // API-authored `=TABLE(...)` formulas do not create `DataTableRegionDef`
        // metadata; those are ordinary unsupported pseudo-function calls and must
        // fall through to evaluator-level #CALC! handling.
        let mut region_groups: RegionGroupMap = FxHashMap::default();
        for &(cell_id, sheet_id, row, col) in &table_cells {
            if let Some(region) = mirror.find_data_table_at(&sheet_id, row, col) {
                let key = (region.sheet.clone(), region.start_row, region.start_col);
                let entry = region_groups
                    .entry(key)
                    .or_insert_with(|| (region.clone(), Vec::new()));
                entry.1.push((cell_id, row, col));
            }
        }

        if region_groups.is_empty() {
            return Vec::new();
        }

        self.begin_sumifs_cache_epoch();

        let prior_in_data_table_eval = self.in_data_table_eval;
        self.in_data_table_eval = true;
        #[cfg(test)]
        DATA_TABLE_EVAL_SCOPE_ENTRIES.fetch_add(1, Ordering::SeqCst);

        let prepass_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // Step 3: Evaluate each region (sorted by key for deterministic ordering)
            let mut results: Vec<(CellId, CellValue)> = Vec::new();
            let mut sorted_regions: Vec<_> = region_groups.into_iter().collect();
            sorted_regions.sort_by_key(|(key, _)| key.clone());

            for (_key, (region, _cells)) in &sorted_regions {
                // 3a: Resolve sheet UUID -> SheetId
                let sheet_id = match SheetId::from_uuid_str(&region.sheet) {
                    Ok(id) => id,
                    Err(_) => continue,
                };

                // The result formula is at the corner cell: one row above and one column
                // to the left of the body region, i.e., (start_row - 1, start_col - 1).
                // This works for both two-variable and one-variable tables.
                //
                // For one-variable tables where the formula might also be at
                // (start_row - 1, start_col) or (start_row, start_col - 1) per
                // Excel convention, we try the corner first, then fall back.
                if region.start_row == 0 || region.start_col == 0 {
                    results.extend(current_data_table_region_values(
                        mirror,
                        &sheet_id,
                        region,
                        &self.id_alloc,
                    ));
                    continue;
                }
                let candidate_positions = [
                    (region.start_row - 1, region.start_col - 1), // corner (primary)
                    (region.start_row - 1, region.start_col),     // one-var row fallback
                    (region.start_row, region.start_col - 1),     // one-var col fallback
                ];
                let (formula_cell_id, ast) = match candidate_positions.iter().find_map(|&(r, c)| {
                    let cid = mirror.resolve_cell_id(&sheet_id, SheetPos::new(r, c))?;
                    let entry = self.ast_cache.get(&cid)?;
                    if is_table_formula(&entry.ast) {
                        return None; // skip TABLE cells — they're body cells, not the formula
                    }
                    Some((cid, entry.ast.clone()))
                }) {
                    Some(pair) => pair,
                    None => {
                        results.extend(current_data_table_region_values(
                            mirror,
                            &sheet_id,
                            region,
                            &self.id_alloc,
                        ));
                        continue;
                    }
                };

                // 3c: Resolve input cell references.
                //
                // Typed data-table input refs: `region.row_input_ref` / `col_input_ref` are
                // typed `Option<CellRef>`; resolve directly to (row, col) via
                // `cell_ref_to_position` — no `parse_a1_ref` shadow parser.
                let row_input_cell = region.row_input_ref.as_ref().and_then(|cr| {
                    let (row, col) = cell_ref_to_position(cr, mirror)?;
                    mirror.resolve_cell_id(&sheet_id, SheetPos::new(row, col))
                });
                let col_input_cell = region.col_input_ref.as_ref().and_then(|cr| {
                    let (row, col) = cell_ref_to_position(cr, mirror)?;
                    mirror.resolve_cell_id(&sheet_id, SheetPos::new(row, col))
                });

                // Must have at least one input cell
                if row_input_cell.is_none() && col_input_cell.is_none() {
                    results.extend(current_data_table_region_values(
                        mirror,
                        &sheet_id,
                        region,
                        &self.id_alloc,
                    ));
                    continue;
                }

                // 3d: Read header values from mirror.
                //
                // For a two-variable data table with region (start_row, start_col)-(end_row, end_col):
                //   Row header values: column (start_col - 1), rows start_row..=end_row
                //   Col header values: row (start_row - 1), columns start_col..=end_col
                //
                // For a one-variable row data table:
                //   Row header values: column (start_col - 1), rows start_row..=end_row
                //   (no col headers)
                //
                // For a one-variable col data table:
                //   Col header values: row (start_row - 1), columns start_col..=end_col
                //   (no row headers)
                let mut row_values: Vec<CellValue> = Vec::new();
                let mut col_values: Vec<CellValue> = Vec::new();

                if row_input_cell.is_some() {
                    // Row header values are in column (start_col - 1)
                    let header_col = if region.start_col > 0 {
                        region.start_col - 1
                    } else {
                        0
                    };
                    for r in region.start_row..=region.end_row {
                        let val = mirror
                            .get_cell_value_at(&sheet_id, SheetPos::new(r, header_col))
                            .cloned()
                            .unwrap_or(CellValue::Null);
                        row_values.push(val);
                    }
                }

                if col_input_cell.is_some() {
                    // Col header values are in row (start_row - 1)
                    let header_row = if region.start_row > 0 {
                        region.start_row - 1
                    } else {
                        0
                    };
                    for c in region.start_col..=region.end_col {
                        let val = mirror
                            .get_cell_value_at(&sheet_id, SheetPos::new(header_row, c))
                            .cloned()
                            .unwrap_or(CellValue::Null);
                        col_values.push(val);
                    }
                }

                // 3d½: Batch-materialize body cell CellIds.
                //
                // Densely hydrated data table cells can exist only in col_data
                // without pos_to_id entries. Without CellIds the write-back loop
                // silently drops computed values. Call ensure_cell_id() for every
                // body position before evaluation so the write-back is infallible.
                let body_rows = (region.end_row - region.start_row + 1) as usize;
                let body_cols = (region.end_col - region.start_col + 1) as usize;
                let mut body_cell_ids: Vec<Vec<Option<CellId>>> = Vec::with_capacity(body_rows);
                for r in region.start_row..=region.end_row {
                    let mut row_ids = Vec::with_capacity(body_cols);
                    for c in region.start_col..=region.end_col {
                        let cid = mirror.ensure_cell_id_identity_only(
                            &sheet_id,
                            SheetPos::new(r, c),
                            &self.id_alloc,
                        );
                        row_ids.push(cid);
                    }
                    body_cell_ids.push(row_ids);
                }

                // 3e: Compute dependency subgraph — all cells transitively affected
                // by input cell changes, in topological order.
                let input_cell_ids: Vec<CellId> = [row_input_cell, col_input_cell]
                    .iter()
                    .filter_map(|c| *c)
                    .collect();

                // Use level-grouped topo sort so we can clear caches between levels.
                // Without this, thread-local caches (column_index, sorted_cache, etc.)
                // accumulate stale entries when chain cells modify range data, causing
                // non-deterministic results.
                let affected_levels: Vec<Vec<CellId>> = {
                    let (mut levels, cycle_cells) = self
                        .graph
                        .affected_cells_levels(&input_cell_ids, &*mirror)
                        .into_value();
                    if !cycle_cells.is_empty() {
                        levels.push(cycle_cells);
                    }
                    levels
                };

                // Flatten for save/restore, filter to formula cells excluding TABLE and input cells
                let cell_filter = |c: &CellId| -> bool {
                    if input_cell_ids.contains(c) {
                        return false;
                    }
                    match self.ast_cache.get(c) {
                        Some(entry) => !is_table_formula(&entry.ast),
                        None => false,
                    }
                };

                let affected_chain: Vec<CellId> = affected_levels
                    .iter()
                    .flat_map(|level| level.iter().copied())
                    .filter(|c| cell_filter(c))
                    .collect();

                // Ensure result formula cell is saved/restored
                let has_formula_cell = affected_chain.contains(&formula_cell_id);

                // Save original values for affected chain + input cells.
                //
                // IMPORTANT: Use get_cell_value_raw() instead of get_cell_value().
                // Ghost cells at spill projection target positions have entry.value = Null
                // but get_cell_value() follows a fallback to col_data and returns the
                // materialized spill value. If we save that non-null value and then
                // restore it via set_value_mut(), we promote the ghost cell's entry.value
                // from Null to a real value — violating the ghost cell invariant. This
                // causes subsequent TRANSPOSE/dynamic-array re-evaluation to see real
                // cells where ghost cells should be, producing false #SPILL! errors.
                let mut saved_values: Vec<(CellId, CellValue)> = Vec::new();
                for &cid in affected_chain.iter().chain(input_cell_ids.iter()) {
                    let val = mirror
                        .get_cell_value_raw(&cid)
                        .cloned()
                        .unwrap_or(CellValue::Null);
                    saved_values.push((cid, val));
                }
                if !has_formula_cell {
                    let val = mirror
                        .get_cell_value_raw(&formula_cell_id)
                        .cloned()
                        .unwrap_or(CellValue::Null);
                    saved_values.push((formula_cell_id, val));
                }

                // Build level-grouped ASTs for the chain (preserving level structure)
                let chain_levels: Vec<Vec<(CellId, ASTNode, SheetId)>> = affected_levels
                    .iter()
                    .map(|level| {
                        level
                            .iter()
                            .filter(|c| cell_filter(c))
                            .filter_map(|&cid| {
                                let entry = self.ast_cache.get(&cid)?;
                                let chain_ast = entry.ast.clone();
                                let sid =
                                    compute_graph::PositionResolver::resolve(mirror, &cid)?.sheet;
                                Some((cid, chain_ast, sid))
                            })
                            .collect::<Vec<_>>()
                    })
                    .filter(|level| !level.is_empty())
                    .collect();

                let ast_clone = ast.clone();
                let sumifs_epoch = self.current_sumifs_cache_epoch();

                // 3f: Build evaluator closure — mutate-recalc-restore approach.
                // The closure mutates the mirror directly instead of using OverrideContext.

                let mut eval_count = 0u32;
                let mut evaluate = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
                    eval_count += 1;
                    if eval_count <= 3 {
                        eprintln!(
                            "[DT-EVAL] eval #{}, overrides: {:?}",
                            eval_count,
                            overrides
                                .iter()
                                .map(|(k, v)| format!("{:?}={:?}", k, v))
                                .collect::<Vec<_>>()
                        );
                    }
                    // 1. Write overrides to mirror
                    for (cell_id, value) in overrides {
                        mirror.set_value_mut(cell_id, value.clone());
                    }

                    #[cfg(test)]
                    if DATA_TABLE_PANIC_AFTER_OVERRIDE.swap(false, Ordering::SeqCst) {
                        panic!("test panic after data-table override mutation");
                    }

                    // 2. Clear thread-local caches
                    clear_data_table_eval_caches();

                    // 3. Re-evaluate dependency chain level-by-level, clearing caches
                    //    after each cell to prevent stale column_index/sorted_cache entries.
                    //    The data table closure is called O(rows*cols) times with different
                    //    overrides, so correctness > cache throughput here.
                    for level in &chain_levels {
                        for &(chain_cell, ref chain_ast, chain_sheet_id) in level {
                            let ctx = crate::eval_bridge::MirrorContext::new(
                                mirror,
                                chain_cell,
                                chain_sheet_id,
                            )
                            .with_sumifs_cache_epoch(sumifs_epoch);
                            let result = match crate::eval::sync_block_on(
                                crate::eval::Evaluator::evaluate(chain_ast, &ctx, &ctx),
                            ) {
                                Ok(v) => v,
                                Err(_) => CellValue::Error(CellError::Calc, None),
                            };
                            mirror.set_value_mut(&chain_cell, result);
                            // Clear ALL caches after each write to prevent any stale entries.
                            clear_data_table_eval_caches();
                        }
                    }

                    // 4. Read result — re-evaluate result formula directly
                    let result_ctx =
                        crate::eval_bridge::MirrorContext::new(mirror, formula_cell_id, sheet_id)
                            .with_sumifs_cache_epoch(sumifs_epoch);
                    let result = match crate::eval::sync_block_on(crate::eval::Evaluator::evaluate(
                        &ast_clone,
                        &result_ctx,
                        &result_ctx,
                    )) {
                        Ok(v) => v,
                        Err(_) => CellValue::Error(CellError::Calc, None),
                    };
                    if eval_count <= 3 {
                        eprintln!("[DT-EVAL] result={:?}", result);
                    }
                    result
                };

                // 3g: Call calculate_data_table.
                // row_input_ref/col_input_ref are normalized at the parser→domain boundary,
                // so row_values/col_values always have correct semantics regardless of origin.
                let dt_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    crate::data_table::calculate_data_table(
                        row_input_cell,
                        col_input_cell,
                        &row_values,
                        &col_values,
                        &mut evaluate,
                    )
                }));
                // Let the closure go out of scope to release the mutable borrow on mirror
                let _ = evaluate;

                // Pass 4: Restore original values and clear the same caches on
                // normal and unwind paths.
                restore_data_table_saved_values(mirror, &saved_values);
                let dt_result = match dt_result {
                    Ok(result) => result,
                    Err(payload) => std::panic::resume_unwind(payload),
                };

                // 3h: Map 2D result grid back to body cell CellIds.
                // Use the pre-materialized body_cell_ids grid (step 3d½) so that
                // every body position is guaranteed to have a CellId — no silent drops.
                for (i, row_results) in dt_result.results.iter().enumerate() {
                    for (j, value) in row_results.iter().enumerate() {
                        if let Some(cell_id) = body_cell_ids
                            .get(i)
                            .and_then(|row| row.get(j))
                            .copied()
                            .flatten()
                        {
                            results.push((cell_id, value.clone()));
                        }
                    }
                }
            }

            results
        }));

        self.in_data_table_eval = prior_in_data_table_eval;
        match prepass_result {
            Ok(results) => results,
            Err(payload) => std::panic::resume_unwind(payload),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::CellMirror;
    use crate::scheduler::ComputeCore;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use rustc_hash::FxHashSet;
    use std::sync::{Mutex, MutexGuard};

    static DATA_TABLE_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn data_table_test_lock() -> MutexGuard<'static, ()> {
        DATA_TABLE_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn test_is_table_formula() {
        use std::borrow::Cow;

        let table_ast = ASTNode::Function {
            name: Cow::Borrowed("TABLE"),
            args: vec![],
        };
        assert!(is_table_formula(&table_ast));

        let table_lower = ASTNode::Function {
            name: Cow::Borrowed("table"),
            args: vec![],
        };
        assert!(is_table_formula(&table_lower));

        let sum_ast = ASTNode::Function {
            name: Cow::Borrowed("SUM"),
            args: vec![],
        };
        assert!(!is_table_formula(&sum_ast));

        let number_ast = ASTNode::Number(42.0);
        assert!(!is_table_formula(&number_ast));
    }

    fn test_sheet_id() -> SheetId {
        SheetId::from_uuid_str("00000000-0000-0000-0000-0000000000aa").unwrap()
    }

    fn test_cell_id(suffix: u128) -> CellId {
        CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{suffix:012x}")).unwrap()
    }

    fn test_cell(
        row: u32,
        col: u32,
        suffix: u128,
        value: CellValue,
        formula: Option<&str>,
    ) -> CellData {
        CellData {
            cell_id: test_cell_id(suffix).to_uuid_string(),
            row,
            col,
            value,
            formula: formula.map(str::to_string),
            identity_formula: None,
            array_ref: None,
        }
    }

    fn data_table_snapshot() -> WorkbookSnapshot {
        let sheet_id = test_sheet_id();
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id.to_uuid_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 6,
                cells: vec![
                    test_cell(0, 0, 1, CellValue::number(300.0), Some("=A4+A5")),
                    test_cell(0, 1, 2, CellValue::number(1.0), None),
                    test_cell(0, 2, 3, CellValue::number(2.0), None),
                    test_cell(1, 0, 4, CellValue::number(10.0), None),
                    test_cell(2, 0, 5, CellValue::number(20.0), None),
                    test_cell(3, 0, 6, CellValue::number(100.0), None),
                    test_cell(4, 0, 7, CellValue::number(200.0), None),
                    test_cell(1, 1, 8, CellValue::number(0.0), Some("=TABLE($A$4,$A$5)")),
                    test_cell(1, 2, 9, CellValue::number(0.0), Some("=TABLE($A$4,$A$5)")),
                    test_cell(2, 1, 10, CellValue::number(0.0), Some("=TABLE($A$4,$A$5)")),
                    test_cell(2, 2, 11, CellValue::number(0.0), Some("=TABLE($A$4,$A$5)")),
                ],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![DataTableRegionDef {
                sheet: sheet_id.to_uuid_string(),
                start_row: 1,
                start_col: 1,
                end_row: 2,
                end_col: 2,
                row_input_ref: Some(CellRef::Positional {
                    sheet: SheetId::from_raw(0),
                    row: 3,
                    col: 0,
                }),
                col_input_ref: Some(CellRef::Positional {
                    sheet: SheetId::from_raw(0),
                    row: 4,
                    col: 0,
                }),
                ooxml_flags: None,
            }],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        }
    }

    fn data_table_core() -> (ComputeCore, CellMirror, SheetId, FxHashSet<CellId>) {
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let sheet_id = test_sheet_id();
        core.init_from_snapshot(&mut mirror, data_table_snapshot())
            .expect("data table snapshot should initialize");
        let mut dirty = FxHashSet::default();
        for suffix in [8, 9, 10, 11] {
            dirty.insert(test_cell_id(suffix));
        }
        (core, mirror, sheet_id, dirty)
    }

    #[test]
    fn data_table_prepass_empty_dirty_set_does_not_toggle_flag() {
        let _guard = data_table_test_lock();
        let (mut core, mut mirror, _, _) = data_table_core();
        reset_data_table_eval_scope_entries_for_tests();
        let dirty = FxHashSet::default();

        assert!(core.run_data_table_prepass(&mut mirror, &dirty).is_empty());
        assert!(!core.in_data_table_eval);
        assert_eq!(data_table_eval_scope_entries_for_tests(), 0);
    }

    #[test]
    fn data_table_prepass_non_table_dirty_set_does_not_toggle_flag() {
        let _guard = data_table_test_lock();
        let (mut core, mut mirror, _, _) = data_table_core();
        reset_data_table_eval_scope_entries_for_tests();
        let mut dirty = FxHashSet::default();
        dirty.insert(test_cell_id(1));

        assert!(core.run_data_table_prepass(&mut mirror, &dirty).is_empty());
        assert!(!core.in_data_table_eval);
        assert_eq!(data_table_eval_scope_entries_for_tests(), 0);
    }

    #[test]
    fn data_table_prepass_orphan_table_dirty_set_does_not_toggle_flag() {
        let _guard = data_table_test_lock();
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let mut snapshot = data_table_snapshot();
        snapshot.data_table_regions.clear();
        core.init_from_snapshot(&mut mirror, snapshot)
            .expect("orphan TABLE snapshot should initialize");
        reset_data_table_eval_scope_entries_for_tests();
        let mut dirty = FxHashSet::default();
        dirty.insert(test_cell_id(8));

        assert!(core.run_data_table_prepass(&mut mirror, &dirty).is_empty());
        assert!(!core.in_data_table_eval);
        assert_eq!(data_table_eval_scope_entries_for_tests(), 0);
    }

    #[test]
    fn data_table_prepass_unresolvable_table_dirty_set_does_not_toggle_flag() {
        let _guard = data_table_test_lock();
        let (mut core, mut mirror, _, _) = data_table_core();
        reset_data_table_eval_scope_entries_for_tests();
        let missing_id = test_cell_id(0xfff);
        core.ast_cache.insert(
            missing_id,
            crate::scheduler::AstEntry {
                ast: ASTNode::Function {
                    name: std::borrow::Cow::Borrowed("TABLE"),
                    args: vec![],
                },
                is_dynamic_array: false,
            },
        );
        let mut dirty = FxHashSet::default();
        dirty.insert(missing_id);

        assert!(core.run_data_table_prepass(&mut mirror, &dirty).is_empty());
        assert!(!core.in_data_table_eval);
        assert_eq!(data_table_eval_scope_entries_for_tests(), 0);
    }

    #[test]
    fn data_table_prepass_already_in_eval_leaves_flag_unchanged() {
        let _guard = data_table_test_lock();
        let (mut core, mut mirror, _, dirty) = data_table_core();
        reset_data_table_eval_scope_entries_for_tests();
        core.in_data_table_eval = true;

        assert!(core.run_data_table_prepass(&mut mirror, &dirty).is_empty());
        assert!(core.in_data_table_eval);
        assert_eq!(data_table_eval_scope_entries_for_tests(), 0);
    }

    #[test]
    fn data_table_prepass_normal_return_restores_flag_and_saved_values() {
        let _guard = data_table_test_lock();
        let (mut core, mut mirror, _, _) = data_table_core();
        reset_data_table_restore_calls_for_tests();
        let mut dirty = FxHashSet::default();
        dirty.insert(test_cell_id(8));
        let row_input = test_cell_id(6);
        let col_input = test_cell_id(7);
        let result_formula = test_cell_id(1);
        let original_row_input = mirror.get_cell_value_raw(&row_input).cloned();
        let original_col_input = mirror.get_cell_value_raw(&col_input).cloned();
        let original_result_formula = mirror.get_cell_value_raw(&result_formula).cloned();

        let resolved = core.run_data_table_prepass(&mut mirror, &dirty);

        assert!(!core.in_data_table_eval);
        assert_eq!(data_table_restore_calls_for_tests(), 1);
        assert_eq!(
            mirror.get_cell_value_raw(&row_input).cloned(),
            original_row_input
        );
        assert_eq!(
            mirror.get_cell_value_raw(&col_input).cloned(),
            original_col_input
        );
        assert_eq!(
            mirror.get_cell_value_raw(&result_formula).cloned(),
            original_result_formula
        );
        assert_eq!(resolved.len(), 4);
        let values: FxHashMap<CellId, CellValue> = resolved.into_iter().collect();
        assert_eq!(values.get(&test_cell_id(8)), Some(&CellValue::number(11.0)));
        assert_eq!(values.get(&test_cell_id(9)), Some(&CellValue::number(12.0)));
        assert_eq!(
            values.get(&test_cell_id(10)),
            Some(&CellValue::number(21.0))
        );
        assert_eq!(
            values.get(&test_cell_id(11)),
            Some(&CellValue::number(22.0))
        );
    }

    #[test]
    fn data_table_prepass_panic_after_override_restores_flag_values_and_cleanup_path() {
        let _guard = data_table_test_lock();
        let (mut core, mut mirror, _, _) = data_table_core();
        reset_data_table_restore_calls_for_tests();
        let mut dirty = FxHashSet::default();
        dirty.insert(test_cell_id(8));
        set_data_table_panic_after_override_for_tests(true);
        let row_input = test_cell_id(6);
        let col_input = test_cell_id(7);
        let result_formula = test_cell_id(1);
        let original_row_input = mirror.get_cell_value_raw(&row_input).cloned();
        let original_col_input = mirror.get_cell_value_raw(&col_input).cloned();
        let original_result_formula = mirror.get_cell_value_raw(&result_formula).cloned();

        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            core.run_data_table_prepass(&mut mirror, &dirty);
        }));

        assert!(panic.is_err());
        assert!(!core.in_data_table_eval);
        assert_eq!(
            data_table_restore_calls_for_tests(),
            1,
            "panic path must use the same saved-value restore/cache cleanup helper"
        );
        assert_eq!(
            mirror.get_cell_value_raw(&row_input).cloned(),
            original_row_input
        );
        assert_eq!(
            mirror.get_cell_value_raw(&col_input).cloned(),
            original_col_input
        );
        assert_eq!(
            mirror.get_cell_value_raw(&result_formula).cloned(),
            original_result_formula
        );
    }
}
