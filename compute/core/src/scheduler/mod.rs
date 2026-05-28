//! Recalc Scheduler — orchestrates formula recalculation.
//!
//! `ComputeCore` is the top-level struct that owns the CellMirror, DependencyGraph,
//! and AST cache. It processes cell edits by parsing formulas, building the dependency
//! graph, and evaluating cells in topological order.
//!
//! Level-based parallel recalc with rayon (native) or single-threaded fallback (WASM).
//!
//! ## Architecture: shared evaluator, specialized orchestration
//!
//! All recalc paths converge on a single evaluation core:
//!
//! - **`Evaluator::evaluate()`** (`eval/engine/evaluator.rs`) — the one and only
//!   formula evaluator. Every path calls this with a `MirrorContext` adapter.
//! - **`MirrorContext`** (`eval_bridge/mirror_context.rs`) — implements `EvalDataAccess`
//!   + `EvalMetadata` traits, providing uniform data access regardless of caller.
//! - **`make_cell_change()`** — shared result packaging for all topo-based paths.
//!
//! What differs across paths is **orchestration** — how cells are scheduled, what
//! pre/post-processing occurs, and what invariants are maintained. The scheduler
//! exposes four orchestration strategies because they have incompatible requirements:
//!
//! | Path | Module | When | Why separate |
//! |------|--------|------|--------------|
//! | **Incremental topo** | `recalc/` (`topo_evaluate_pass`) | Small dirty set after edits | Computes fresh topo levels from dirty cells via `graph.subset_levels()` |
//! | **Full topo** | `recalc/` (`topo_evaluate_pass_with_levels`) | Full recalc (load, structural change) | Accepts pre-computed global levels — avoids redundant topo sort |
//! | **Cycle recovery** | `cycles.rs` (`handle_cycles_and_recalc`) | Circular references detected | SCC analysis + special seeding (null→0.0) + optional iterative convergence |
//! | **Data table prepass** | `data_table_prepass.rs` (`run_data_table_prepass`) | TABLE formulas present | Mutate-recalc-restore: overrides input cells per (row,col) combination, clears caches per write |
//!
//! These are **not** interchangeable. Merging them would either lose performance
//! (always recomputing levels) or lose correctness (data tables require per-write
//! cache invalidation that would break level-batched evaluation).
//!
//! ## Parallelism strategy
//!
//! Cells are grouped by topological level (Kahn's algorithm). Cells at the same level
//! have no mutual dependencies and can be evaluated concurrently. Each level uses a
//! two-phase approach:
//! 1. **Parallel read phase** — evaluate all formulas using shared `&CellMirror`
//! 2. **Sequential write phase** — apply results to the mirror
//!
//! Levels with fewer than `PARALLEL_THRESHOLD` cells skip rayon overhead and evaluate
//! sequentially.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::formula_text::{FormulaTextDepIndex, FormulaTextDepTarget, FormulaTextProvider};
use crate::graph::{DepTarget, DependencyGraph, GraphBuilder, RangeAccess};
use crate::mirror::{CellMirror, MirrorPositionLookup};
use crate::schema::schema_map::SchemaMap;
use crate::snapshot::{
    CalcMode, CellChange, CellEdit, CellErrorInfo, ProjectionCellData, ProjectionChange,
    RecalcMetrics, RecalcResult, SheetSnapshot, WorkbookSnapshot,
};
use cell_types::RangePos;
use cell_types::{CellId, ColId, IdAllocator, RowId, SheetId, SheetPos};
use compute_functions::helpers::sumifs_result_cache::{
    SumifsCacheDomain, SumifsCacheEpoch, new_cache_domain,
};
use compute_parser::ASTNode;
use compute_parser::{CellRefResolver, IdentityResolver, parse_formula};
use formula_types::{CellRef, IdentityFormula};
#[cfg(test)]
use value_types::CellArray;
use value_types::{CellError, CellValue, ComputeError};

// ---------------------------------------------------------------------------
// Submodules
// ---------------------------------------------------------------------------

mod agg_prepass;
pub(crate) mod ast_transform;
mod cf_eval;
mod cycles;
mod data_table_prepass;
mod dep_extract;
mod edit;
mod formula_reg;
mod init;
pub(crate) mod input;
mod level_eval;
mod recalc;
mod resolvers;
mod schema_validation;
mod solver_methods;
mod spill;
mod value_utils;

#[cfg(test)]
mod test_helpers;

#[cfg(test)]
#[path = "scheduler_tests/mod.rs"]
mod tests;

#[cfg(test)]
#[path = "cf_formula_tests.rs"]
mod cf_formula_tests;

#[cfg(test)]
#[path = "projection_tests.rs"]
mod projection_tests;

// Re-export from submodules for use via `use super::*;` in sibling modules
#[cfg(test)]
use ast_transform::{contains_volatile_function, shift_ast_for_cf};
#[cfg(test)]
use dep_extract::extract_dependencies;
use dep_extract::extract_deps_and_volatility;
#[cfg(feature = "native")]
use resolvers::ConcurrentIdentityResolver;
use resolvers::{CoreIdentityResolver, CoreResolver};
use value_utils::{truncate_chars, values_equal};

/// Stream A′ trust marker — see `edit::WriteTrust` for full docs.
pub use edit::WriteTrust;

// ---------------------------------------------------------------------------
// AstEntry — cached formula AST with metadata flags
// ---------------------------------------------------------------------------

/// Entry in the formula AST cache. Stores the parsed AST alongside metadata
/// flags that are computed at parse time and persist through all mutation paths.
#[derive(Debug, Clone)]
pub struct AstEntry {
    /// The parsed formula AST.
    pub ast: ASTNode,
    /// Whether this formula contains array-returning functions (SEQUENCE, FILTER, SORT, etc.)
    /// and should spill its result into neighboring cells instead of applying implicit intersection.
    pub is_dynamic_array: bool,
}

// ---------------------------------------------------------------------------
// ProjectionDelta — tracks projection registry changes during spill handling
// ---------------------------------------------------------------------------

use crate::projection::Projection;

/// Tracks the old and new projection state for a single source cell.
/// Used to propagate projection changes after spill handling.
#[derive(Debug, Clone)]
pub(crate) struct ProjectionDelta {
    pub old: Option<Projection>,
    pub new: Option<Projection>,
}

// ---------------------------------------------------------------------------
// Volatile function names — formulas containing these are always recalculated
// ---------------------------------------------------------------------------

// Re-export from compute-functions (single source of truth).
use compute_functions::helpers::VOLATILE_FUNCTIONS;

// ---------------------------------------------------------------------------
// ComputeCore — the top-level orchestrator
// ---------------------------------------------------------------------------

/// Top-level compute engine that owns the cell mirror, dependency graph, and AST cache.
///
/// All recalculation flows through this struct:
/// 1. Edits update the mirror and graph
/// 2. Affected cells are found via the dependency graph
/// 3. Cells are evaluated in topological order
/// 4. Changed cells are returned as `RecalcResult`
pub struct ComputeCore {
    graph: DependencyGraph,
    /// Monotonic ID allocator — generates unique CellIds without syscalls.
    /// Wrapped in `Arc` so it can be shared with `EngineStores.grid_id_alloc`
    /// in collaborative mode, preventing CellId collisions between ghost cells
    /// (allocated here during formula resolution) and real cells (allocated via
    /// the grid allocator in mutation handlers).
    id_alloc: std::sync::Arc<IdAllocator>,
    ast_cache: FxHashMap<CellId, AstEntry>,
    /// Formula strings stored separately for reparsing when references change.
    formula_strings: FxHashMap<CellId, String>,
    /// Cell-authored formula text used for readback, independent of graph readiness.
    ///
    /// This is deliberately cell-only. `formula_strings` also stores synthetic
    /// variable/named-range formulas used by the graph, so it cannot be the
    /// document identity source for cell formula readback during deferred import.
    cell_formula_text: FxHashMap<CellId, String>,
    formula_text_deps: FormulaTextDepIndex,
    /// Whether iterative calculation is enabled for this workbook.
    iterative_calc: bool,
    /// Maximum number of iterations for iterative calculation.
    max_iterations: u32,
    /// Maximum change (delta) threshold for convergence.
    max_change: f64,
    /// Workbook calculation mode. In manual mode, incremental edits update only
    /// edited cells/new formula seeds; dependent formulas keep their last value
    /// until an explicit calculate call.
    calc_mode: CalcMode,
    /// Maximum time allowed for a full recalculation (default: 30s).
    /// Set to `Duration::MAX` to disable.
    recalc_timeout: std::time::Duration,
    /// Column schema map for post-recalc validation. None if schemas not loaded.
    pub(crate) schema_map: Option<SchemaMap>,
    /// Persistent workbook-lifetime cache shared across recalc epochs.
    workbook_cache: crate::eval::cache::workbook_cache::WorkbookCache,
    /// Process-unique SUMIFS cache domain owned by this compute core.
    sumifs_cache_domain: SumifsCacheDomain,
    /// Current recalc epoch for scheduler-owned SUMIFS thread-local cache keys.
    current_sumifs_cache_epoch: Option<SumifsCacheEpoch>,
    /// Pre-computed per-cell range keys for materialization scheduling.
    /// Populated during init/parse, consumed during recalc to avoid redundant AST walks.
    cell_range_keys: FxHashMap<CellId, Vec<crate::eval::cache::range_store::RangeKey>>,
    /// Sheet ordering from the workbook snapshot (tab order). Used for cycle
    /// evaluation to match Excel's declaration-order evaluation of circular refs.
    sheet_order: FxHashMap<SheetId, usize>,
    /// Cached sorted sheet list for 3-D reference evaluation. Rebuilt on sheet add/delete.
    ordered_sheets_cache: Vec<SheetId>,
    /// Guard against recursive data table prepass calls. When true,
    /// `run_data_table_prepass` returns empty (TABLE cells are skipped).
    in_data_table_eval: bool,
    /// True when a mutation has occurred since the last successful full recalc.
    /// Checked by `Engine::recalculate_with_options` to short-circuit idempotent calls.
    pub(crate) dirty_since_last_recalc: bool,
    /// Dirty seeds accumulated while in manual calculation mode.
    pending_manual_dirty_cells: FxHashSet<CellId>,
    /// Tracks which cell is blocking each spill-formula cell (blocker → source).
    /// When a spill formula at `source` cannot create its projection because `blocker`
    /// already has content, we record (blocker → source). When `blocker` is later
    /// cleared, `source` is added to the recalc dirty set so the projection
    /// can be restored.
    pub(crate) spill_blockers: FxHashMap<CellId, CellId>,
    /// Formula cells deferred from minimal init. When `Some`, the dependency
    /// graph hasn't been built yet — `ensure_graph_built()` must be called
    /// before any recalc or mutation that depends on the graph.
    deferred_formula_cells: Option<Vec<(CellId, SheetId, String)>>,
    deferred_snapshot: Option<WorkbookSnapshot>,
}

impl Default for ComputeCore {
    fn default() -> Self {
        Self::new()
    }
}

impl ComputeCore {
    /// Create a new empty ComputeCore.
    pub fn new() -> Self {
        Self {
            graph: DependencyGraph::new(),
            id_alloc: std::sync::Arc::new(IdAllocator::new()),
            ast_cache: FxHashMap::default(),
            formula_strings: FxHashMap::default(),
            cell_formula_text: FxHashMap::default(),
            formula_text_deps: FormulaTextDepIndex::default(),
            iterative_calc: false,
            max_iterations: 100,
            max_change: 0.001,
            calc_mode: CalcMode::Auto,
            recalc_timeout: std::time::Duration::from_secs(30),
            schema_map: None,
            workbook_cache: crate::eval::cache::workbook_cache::WorkbookCache::new(),
            sumifs_cache_domain: new_cache_domain(),
            current_sumifs_cache_epoch: None,
            cell_range_keys: FxHashMap::default(),
            sheet_order: FxHashMap::default(),
            ordered_sheets_cache: Vec::new(),
            in_data_table_eval: false,
            // Initial state requires a recalc: formula cells start with Null
            // values from the mirror until `full_recalc` evaluates them.
            dirty_since_last_recalc: true,
            pending_manual_dirty_cells: FxHashSet::default(),
            spill_blockers: FxHashMap::default(),
            deferred_formula_cells: None,
            deferred_snapshot: None,
        }
    }

    /// Replace the ID allocator (used for collaborative mode to partition by client_id).
    pub fn set_id_alloc(&mut self, alloc: std::sync::Arc<IdAllocator>) {
        self.id_alloc = alloc;
    }

    /// Mark the compute store as dirty. Called from every mutation entry point
    /// that produces cell writes, structural changes, or schema/pivot-layout
    /// edits that invalidate cached recalc output.
    pub(crate) fn mark_dirty(&mut self) {
        self.dirty_since_last_recalc = true;
    }

    pub(crate) fn formula_text_provider(&self) -> FormulaTextProvider<'_> {
        FormulaTextProvider::new(&self.cell_formula_text, &self.formula_strings)
    }

    pub(super) fn begin_sumifs_cache_epoch(&mut self) -> SumifsCacheEpoch {
        let epoch = compute_functions::helpers::sumifs_result_cache::begin_recalc_epoch(
            self.sumifs_cache_domain,
        );
        self.current_sumifs_cache_epoch = Some(epoch);
        epoch
    }

    pub(super) fn current_sumifs_cache_epoch(&self) -> Option<SumifsCacheEpoch> {
        self.current_sumifs_cache_epoch
    }

    pub(crate) fn mark_formula_text_changed(
        &self,
        mirror: &CellMirror,
        cell_id: CellId,
    ) -> FxHashSet<CellId> {
        let mut out = FxHashSet::default();
        self.formula_text_deps
            .mark_changed(&FormulaTextDepTarget::Cell(cell_id), &mut out);
        if let Some(sheet) = mirror.sheet_for_cell(&cell_id)
            && let Some(pos) = mirror.resolve_position(&cell_id)
        {
            self.formula_text_deps.mark_changed(
                &FormulaTextDepTarget::PosTopLeft {
                    sheet,
                    row: pos.row(),
                    col: pos.col(),
                },
                &mut out,
            );
        }
        out
    }

    /// Returns true if a mutation has occurred since the last successful full recalc.
    pub(crate) fn is_dirty(&self) -> bool {
        self.dirty_since_last_recalc
    }

    fn rebuild_ordered_sheets_cache(&mut self) {
        let mut pairs: Vec<(SheetId, usize)> = self
            .sheet_order
            .iter()
            .map(|(&id, &pos)| (id, pos))
            .collect();
        pairs.sort_by_key(|(_, pos)| *pos);
        self.ordered_sheets_cache = pairs.into_iter().map(|(id, _)| id).collect();
    }

    /// Return the ordered list of sheet IDs (from snapshot init).
    pub(crate) fn ordered_sheets(&self) -> &[SheetId] {
        &self.ordered_sheets_cache
    }

    pub fn ordered_sheets_for_diagnostics(&self) -> &[SheetId] {
        &self.ordered_sheets_cache
    }

    /// Clear the dirty bit — called by `Engine::recalculate_with_options` after
    /// a successful full recalc and by init paths that leave the workbook in a
    /// "just recalculated" state.
    pub(crate) fn clear_dirty(&mut self) {
        self.dirty_since_last_recalc = false;
        self.pending_manual_dirty_cells.clear();
    }

    // -----------------------------------------------------------------------
    // Spill blocker drain helpers (used by merge mutation paths)
    // -----------------------------------------------------------------------

    /// Drain spill blockers whose blocker cell falls within the given sheet
    /// region.  Returns the unblocked spill-source `CellId`s so the caller
    /// can pass them to `recalc()`.
    ///
    /// Called after `unmerge_range` / `merge_and_center` so that spill
    /// formulas blocked by the now-removed merge region are re-evaluated.
    pub(crate) fn drain_spill_blockers_for_region(
        &mut self,
        mirror: &CellMirror,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<CellId> {
        let mut unblocked = Vec::new();
        self.spill_blockers.retain(|blocker_id, source_id| {
            let in_region = mirror
                .sheet_for_cell(blocker_id)
                .is_some_and(|sid| sid == *sheet_id)
                && mirror.resolve_position(blocker_id).is_some_and(|pos| {
                    pos.row() >= start_row
                        && pos.row() <= end_row
                        && pos.col() >= start_col
                        && pos.col() <= end_col
                });
            // Merge-fallback case: when the merge region contains no cell
            // entities, `check_conflict()` falls back to recording the spill
            // *source* itself as the blocker (blocker_id == source_id).
            // Such entries have no real blocker position to intersect with
            // the just-removed merge rect, so the in_region check above
            // never fires. They must be re-evaluated whenever a merge on
            // the same sheet is removed — otherwise the formula stays
            // permanently #SPILL!. Repro: spill-into-merged-cell scenario.
            let is_merge_fallback = blocker_id == source_id
                && mirror
                    .sheet_for_cell(source_id)
                    .is_some_and(|sid| sid == *sheet_id);
            if in_region || is_merge_fallback {
                unblocked.push(*source_id);
                false // remove from map
            } else {
                true // keep
            }
        });
        unblocked
    }

    /// Drain all spill blockers whose blocker cell belongs to the given sheet.
    /// Returns the unblocked spill-source `CellId`s for recalc.
    ///
    /// Called after `clear_all_merges` when every merge on the sheet is gone.
    pub(crate) fn drain_spill_blockers_for_sheet(
        &mut self,
        mirror: &CellMirror,
        sheet_id: &SheetId,
    ) -> Vec<CellId> {
        let mut unblocked = Vec::new();
        self.spill_blockers.retain(|blocker_id, source_id| {
            let on_sheet = mirror
                .sheet_for_cell(blocker_id)
                .is_some_and(|sid| sid == *sheet_id);
            if on_sheet {
                unblocked.push(*source_id);
                false // remove from map
            } else {
                true // keep
            }
        });
        unblocked
    }

    // -----------------------------------------------------------------------
    // Sheet management
    // -----------------------------------------------------------------------

    /// Add a new sheet from a snapshot. Parses formulas and recalculates.
    pub fn add_sheet(
        &mut self,
        mirror: &mut CellMirror,
        snapshot: SheetSnapshot,
    ) -> Result<(), ComputeError> {
        // Extract formula cells before adding (need the data)
        let sheet_id = SheetId::from_uuid_str(&snapshot.id)?;
        let formula_cells: Vec<(CellId, SheetId, String)> = snapshot
            .cells
            .iter()
            .filter_map(|cd| {
                let f = cd.formula.as_ref()?;
                let cell_id = match CellId::from_uuid_str(&cd.cell_id) {
                    Ok(id) => id,
                    Err(_) => {
                        tracing::warn!(raw = %cd.cell_id, "Skipping cell with unparseable UUID");
                        return None;
                    }
                };
                Some((cell_id, sheet_id, f.clone()))
            })
            .collect();

        mirror.add_sheet(snapshot)?;
        self.seed_cell_formula_text(&formula_cells);

        // Maintain sheet_order — initialized at init_from_snapshot but
        // never updated for dynamically added sheets, so without this the
        // newly added sheet has no entry and any code that iterates
        // sheet_order to enumerate sheets misses it. Append it after the
        // current max position. Repro: stress-many-sheets scenario.
        let next_pos = self
            .sheet_order
            .values()
            .copied()
            .max()
            .map(|m| m + 1)
            .unwrap_or(0);
        self.sheet_order.insert(sheet_id, next_pos);
        self.rebuild_ordered_sheets_cache();

        // Parse formulas for the new sheet using bulk parallel parsing.
        // These are new cells with no prior edges, so set_precedents_fresh is safe.
        self.bulk_parse_and_register(mirror, formula_cells);

        Ok(())
    }

    /// Remove a sheet. Cleans up all cells in that sheet from the graph.
    /// Returns a `RecalcResult` containing updates for cells in OTHER sheets
    /// that depended on cells in the deleted sheet (they now evaluate to #REF!).
    pub fn remove_sheet(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
    ) -> Result<RecalcResult, ComputeError> {
        // Collect cell IDs from this sheet before removing
        let cell_ids: Vec<CellId> = if let Some(sheet) = mirror.get_sheet(sheet_id) {
            sheet.cell_ids().copied().collect()
        } else {
            Vec::new()
        };

        // Before removing, collect all dependents in OTHER sheets so we can
        // recalc them after deletion (they should now produce #REF!).
        let cell_id_set: FxHashSet<CellId> = cell_ids.iter().copied().collect();
        let mut ext_dep_set: FxHashSet<CellId> = FxHashSet::default();
        for cell_id in &cell_ids {
            for dep in self.graph.get_dependents(cell_id) {
                // Only keep dependents that are NOT in the sheet being deleted
                if !cell_id_set.contains(dep) {
                    ext_dep_set.insert(*dep);
                }
            }
        }
        let external_dependents: Vec<CellId> = ext_dep_set.into_iter().collect();

        // Remove from graph and caches
        for cell_id in &cell_ids {
            self.graph.remove_cell(cell_id);
            self.ast_cache.remove(cell_id);
            self.formula_strings.remove(cell_id);
            self.cell_formula_text.remove(cell_id);
            self.cell_range_keys.remove(cell_id);
        }

        // Clean up orphaned range dependencies that target the deleted sheet.
        // Without this, RangePos entries in range_deps/range_index would accumulate
        // as a memory leak and cause wasted work during recalc.
        self.graph.cleanup_sheet_ranges(sheet_id);

        // Maintain sheet_order — leaving the deleted sheet's entry behind
        // would make sheet_order disagree with the mirror's set of sheets
        // and confuse callers that iterate the order map.
        self.sheet_order.remove(sheet_id);
        self.rebuild_ordered_sheets_cache();

        mirror.remove_sheet(sheet_id);

        // Recalc external dependents so they pick up #REF! from the missing sheet.
        if external_dependents.is_empty() {
            Ok(RecalcResult::empty())
        } else {
            self.recalc(mirror, &external_dependents)
        }
    }

    /// Rename a sheet. May need to reparse formulas that reference the old name.
    pub fn rename_sheet(&mut self, mirror: &mut CellMirror, sheet_id: &SheetId, name: &str) {
        mirror.rename_sheet(sheet_id, name);
        // Formulas use resolved SheetIds internally, so no reparsing needed.
        // But formula_strings (A1 display cache) contain sheet names, so we
        // must regenerate them to reflect the new name.
        self.regenerate_formula_strings(mirror);
    }

    // -----------------------------------------------------------------------
    // Read API
    // -----------------------------------------------------------------------

    /// Get the formula string for a cell.
    pub fn get_formula(&self, cell_id: &CellId) -> Option<&str> {
        self.cell_formula_text
            .get(cell_id)
            .or_else(|| self.formula_strings.get(cell_id))
            .map(|s| s.as_str())
    }

    /// Iterate over all (CellId, formula_string) pairs.
    /// Used to sync regenerated formula strings back to Yrs after structural changes.
    pub fn formula_strings_iter(&self) -> impl Iterator<Item = (&CellId, &str)> {
        self.formula_strings.iter().map(|(k, v)| (k, v.as_str()))
    }

    pub fn formula_texts_for_diagnostics(&self) -> impl Iterator<Item = (&CellId, &str)> {
        self.cell_formula_text
            .iter()
            .map(|(k, v)| (k, v.as_str()))
            .chain(self.formula_strings.iter().map(|(k, v)| (k, v.as_str())))
    }

    /// Get the current value of a cell.
    pub fn get_cell_value<'a>(
        &self,
        mirror: &'a CellMirror,
        cell_id: &CellId,
    ) -> Option<&'a CellValue> {
        mirror.get_cell_value(cell_id)
    }

    /// Get a reference to the underlying DependencyGraph (for testing/inspection).
    pub fn graph(&self) -> &DependencyGraph {
        &self.graph
    }

    /// Whether iterative calculation is enabled.
    pub fn iterative_calc(&self) -> bool {
        self.iterative_calc
    }

    /// Current workbook calculation mode.
    pub fn calc_mode(&self) -> CalcMode {
        self.calc_mode
    }

    /// Set the workbook calculation mode at runtime.
    pub fn set_calc_mode(&mut self, mode: CalcMode) {
        self.calc_mode = mode;
    }

    pub(crate) fn is_manual_calculation(&self) -> bool {
        self.calc_mode == CalcMode::Manual
    }

    pub(crate) fn has_volatile_cells(&self) -> bool {
        self.graph.volatile_count() > 0
    }

    /// Set the iterative calculation flag at runtime.
    pub fn set_iterative_calc(&mut self, enabled: bool) {
        self.iterative_calc = enabled;
    }

    /// Maximum number of iterations for iterative calculation.
    pub fn max_iterations(&self) -> u32 {
        self.max_iterations
    }

    /// Set the maximum iterations for iterative calculation at runtime.
    pub fn set_max_iterations(&mut self, n: u32) {
        self.max_iterations = n;
    }

    /// Maximum change (delta) threshold for iterative calculation convergence.
    pub fn max_change(&self) -> f64 {
        self.max_change
    }

    /// Set the convergence threshold for iterative calculation at runtime.
    pub fn set_max_change(&mut self, threshold: f64) {
        self.max_change = threshold;
    }

    /// Get a reference to the ID allocator.
    pub fn id_alloc(&self) -> &IdAllocator {
        &self.id_alloc
    }

    /// Get or create a CellId at the given position (delegates to mirror + allocator).
    pub fn ensure_cell_id(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        pos: SheetPos,
    ) -> Option<CellId> {
        mirror.ensure_cell_id(sheet_id, pos, &self.id_alloc)
    }

    /// Check if a cell is flagged as a dynamic array formula.
    pub fn is_dynamic_array(&self, cell_id: &CellId) -> Option<bool> {
        self.ast_cache.get(cell_id).map(|e| e.is_dynamic_array)
    }

    /// Get a snapshot of workbook cache statistics (hit/miss/eviction counters, memory estimates).
    pub fn workbook_cache_stats(&self) -> crate::eval::WorkbookCacheStatsSnapshot {
        #[cfg(feature = "native")]
        {
            self.workbook_cache.stats_snapshot()
        }
        #[cfg(not(feature = "native"))]
        {
            crate::eval::WorkbookCacheStatsSnapshot::default()
        }
    }

    /// Get the direct dependents of a cell as CellId values.
    ///
    /// Returns the set of cells whose formulas reference the given cell.
    pub fn get_dependents(&self, cell_id: &CellId) -> Vec<CellId> {
        self.graph.get_dependents(cell_id).copied().collect()
    }

    // -----------------------------------------------------------------------
    // Named range management
    // -----------------------------------------------------------------------

    /// Add or update a named range, registering it as a DAG node.
    ///
    /// Parses the variable's raw expression (if any), caches the AST under
    /// a synthetic CellId, and registers its dependencies in the graph.
    pub fn set_named_range(
        &mut self,
        mirror: &mut CellMirror,
        name: String,
        def: formula_types::NamedRangeDef,
    ) {
        let scope = def.scope.clone();
        let raw_expr = def.raw_expression.clone();

        // Insert into mirror (which populates VariableStore id maps)
        mirror.set_named_range(name.clone(), def);

        // Register in the DAG
        self.register_single_variable(mirror, &scope, &name, raw_expr.as_deref());
    }

    /// Remove a named range by name, cleaning up its DAG node.
    pub fn remove_named_range(&mut self, mirror: &mut CellMirror, name: &str) {
        // Collect all variable CellIds for this name before removing
        let key = name.to_ascii_lowercase();
        let to_remove: Vec<(formula_types::Scope, CellId)> = mirror
            .variables
            .all_variables()
            .filter(|(_, var_name, _)| var_name.as_str() == key)
            .filter_map(|(scope, _, _)| {
                let cell_id = mirror.variables.get_variable_cell_id(scope, &key)?;
                Some((scope.clone(), cell_id))
            })
            .collect();

        // Clean up DAG entries
        for (_scope, cell_id) in &to_remove {
            self.graph.remove_cell(cell_id);
            self.ast_cache.remove(cell_id);
            self.formula_strings.remove(cell_id);
            self.cell_range_keys.remove(cell_id);
        }

        mirror.remove_named_range(name);
    }

    /// Remove a named range by name and scope, cleaning up only that specific DAG node.
    pub fn remove_named_range_scoped(
        &mut self,
        mirror: &mut CellMirror,
        scope: &formula_types::Scope,
        name: &str,
    ) {
        let key = name.to_ascii_lowercase();
        if let Some(cell_id) = mirror.variables.get_variable_cell_id(scope, &key) {
            self.graph.remove_cell(&cell_id);
            self.ast_cache.remove(&cell_id);
            self.formula_strings.remove(&cell_id);
            self.cell_range_keys.remove(&cell_id);
        }
        mirror.remove_named_range_scoped(scope, name);
    }

    // -----------------------------------------------------------------------
    // Table management
    // -----------------------------------------------------------------------

    /// Add or update a canonical table definition.
    pub fn set_table(
        &mut self,
        mirror: &mut CellMirror,
        table: domain_types::domain::table::Table,
    ) {
        mirror.set_table(table);
    }

    /// Remove a table by name.
    pub fn remove_table(&mut self, mirror: &mut CellMirror, name: &str) {
        mirror.remove_table(name);
    }

    /// Re-parse formula cells in a given table range that contain implicit
    /// structured refs (`[@…]`), then recalc any that changed.
    ///
    /// Called after table creation to fix up formulas that were entered before
    /// the table existed (they would have been stored as `#NAME?`).
    pub fn reparse_implicit_structured_refs(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> RecalcResult {
        let sheet_hex = sheet_id.to_uuid_string();
        let cells_to_reparse: Vec<(CellId, String)> = self
            .cell_formula_text
            .iter()
            .filter_map(|(cell_id, formula)| {
                if !formula.contains("[@") {
                    return None;
                }
                let pos = mirror.resolve_position(cell_id)?;
                let cell_sheet = mirror.sheet_for_cell(cell_id)?;
                if cell_sheet.to_uuid_string() != sheet_hex {
                    return None;
                }
                if pos.row() >= start_row
                    && pos.row() <= end_row
                    && pos.col() >= start_col
                    && pos.col() <= end_col
                {
                    Some((*cell_id, formula.clone()))
                } else {
                    None
                }
            })
            .collect();

        if cells_to_reparse.is_empty() {
            return RecalcResult::empty();
        }

        let mut dirty = Vec::new();
        for (cell_id, formula) in cells_to_reparse {
            self.parse_and_register_formula(mirror, cell_id, *sheet_id, formula, false);
            dirty.push(cell_id);
        }

        self.recalc(mirror, &dirty)
            .unwrap_or_else(|_| RecalcResult::empty())
    }

    // -----------------------------------------------------------------------
    // Time injection (for WASM / testing)
    // -----------------------------------------------------------------------

    /// Set the current time for NOW()/TODAY() as an Excel serial date number.
    ///
    /// On WASM, this should be called from JavaScript before each recalc
    /// with the value from `Date.now()` converted to an Excel serial number.
    /// On native targets, this overrides the system clock (useful for testing).
    ///
    /// Pass `0.0` to clear the override (native falls back to system clock).
    pub fn set_current_time(timestamp: f64) {
        crate::eval::clock::set_current_time(timestamp);
    }

    /// Set the maximum time allowed for a full recalculation.
    /// Default is 30 seconds. Set to `Duration::MAX` to disable.
    pub fn set_recalc_timeout(&mut self, timeout: std::time::Duration) {
        self.recalc_timeout = timeout;
    }

    // -----------------------------------------------------------------------
    // Schema management
    // -----------------------------------------------------------------------

    /// Load a full schema map (replaces existing). Called during compute_init.
    pub fn load_schema_map(
        &mut self,
        schemas: std::collections::HashMap<
            crate::schema::schema_map::SchemaKey,
            crate::schema::types::ColumnSchema,
        >,
        version: u64,
    ) {
        let mut map = SchemaMap::new();
        map.load(schemas, version);
        self.schema_map = Some(map);
    }

    /// Update a single column schema. Returns false if version is stale.
    pub fn update_schema(
        &mut self,
        key: crate::schema::schema_map::SchemaKey,
        schema: crate::schema::types::ColumnSchema,
        version: u64,
    ) -> bool {
        match &mut self.schema_map {
            Some(map) => map.update(key, schema, version),
            None => {
                let mut map = SchemaMap::new();
                map.update(key, schema, version);
                self.schema_map = Some(map);
                true
            }
        }
    }

    /// Remove a column schema. Returns false if version is stale.
    pub fn remove_schema(
        &mut self,
        key: &crate::schema::schema_map::SchemaKey,
        version: u64,
    ) -> bool {
        match &mut self.schema_map {
            Some(map) => map.remove(key, version),
            None => false,
        }
    }

    /// Clear all schemas.
    pub fn clear_schemas(&mut self) {
        self.schema_map = None;
    }

    // -----------------------------------------------------------------------
    // Formula parser public API
    // -----------------------------------------------------------------------

    /// Convert an A1-style formula string to an identity-based `IdentityFormula`.
    ///
    /// Uses a `CoreIdentityResolver` backed by the live `CellMirror` so that
    /// referenced cells get stable `CellId`s (creating them for empty cells if
    /// necessary, which is why `&mut self` is required).
    pub fn to_identity_formula(
        &mut self,
        mirror: &mut CellMirror,
        sheet: &SheetId,
        formula_a1: &str,
    ) -> Result<IdentityFormula, ComputeError> {
        let resolver = CoreIdentityResolver {
            mirror: std::cell::RefCell::new(mirror),
            id_alloc: &self.id_alloc,
            current_sheet: *sheet,
        };
        compute_parser::to_identity_formula(formula_a1, &resolver).map_err(|e| {
            ComputeError::Parse {
                message: e.message(),
                position: e.position(),
            }
        })
    }

    pub fn to_identity_formula_with_rect_ranges(
        &mut self,
        mirror: &mut CellMirror,
        sheet: &SheetId,
        formula_a1: &str,
    ) -> Result<IdentityFormula, ComputeError> {
        let resolver = CoreIdentityResolver {
            mirror: std::cell::RefCell::new(mirror),
            id_alloc: &self.id_alloc,
            current_sheet: *sheet,
        };
        compute_parser::to_identity_formula_with_rect_ranges(formula_a1, &resolver).map_err(|e| {
            ComputeError::Parse {
                message: e.message(),
                position: e.position(),
            }
        })
    }

    /// Convert an `IdentityFormula` back to an A1-style display string.
    ///
    /// Read-only — uses a `MirrorPositionLookup` to resolve identity IDs to
    /// their current positional coordinates.
    pub fn to_a1_display(
        &self,
        mirror: &CellMirror,
        sheet: &SheetId,
        formula: &IdentityFormula,
    ) -> String {
        let lookup = MirrorPositionLookup::new(mirror, *sheet);
        compute_parser::to_a1_string(formula, &lookup)
    }

    /// Like [`to_a1_display`](Self::to_a1_display), but always includes the
    /// sheet prefix on every reference (used for named-range display).
    pub fn to_a1_display_qualified(
        &self,
        mirror: &CellMirror,
        sheet: &SheetId,
        formula: &IdentityFormula,
    ) -> String {
        let lookup = MirrorPositionLookup::new(mirror, *sheet);
        compute_parser::to_a1_string_qualified(formula, &lookup)
    }
}
