//! Mutation methods for the dependency graph — adding/removing edges, volatile marking, clear.

use super::{DepTarget, DependencyGraph, RangeAccess};
use cell_types::{CellId, RangePos, SheetId};
use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};

/// RAII guard for batching mutations with deferred range-index rebuilding.
///
/// Created by [`DependencyGraph::batch_mutations`]. All mutations through this
/// guard defer the per-sheet range-index rebuild until the guard is dropped,
/// avoiding O(N) per-mutation tree rebuilds during bulk operations.
///
/// # Examples
///
/// ```
/// use compute_graph::{DependencyGraph, DepTarget, RangeAccess};
/// use cell_types::{CellId, SheetId, RangePos};
///
/// let mut graph = DependencyGraph::new();
/// let sheet = SheetId::from_raw(1);
///
/// {
///     let mut batch = graph.batch_mutations();
///     for i in 0..100 {
///         let cell = CellId::from_raw(i + 1);
///         let range = RangePos::new(sheet, 0, 0, 999, 0);
///         batch.set_precedents(&cell, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
///     }
///     // range index rebuilt automatically on drop
/// }
/// assert!(graph.has_range_index_for_sheet(&sheet));
/// ```
#[must_use = "dropping BatchMutations immediately triggers a useless range-index rebuild"]
pub struct BatchMutations<'a> {
    graph: &'a mut DependencyGraph,
}

impl BatchMutations<'_> {
    /// Replace all dependencies for a cell (deferred index rebuild).
    pub fn set_precedents(&mut self, cell: &CellId, deps: Vec<DepTarget>) {
        self.graph.set_precedents_defer_index(cell, deps);
    }

    /// Replace all external dependencies for a cell.
    pub fn set_external_precedents(
        &mut self,
        cell: &CellId,
        deps: Vec<workbook_types::ExternalRefKey>,
    ) {
        self.graph.set_external_precedents(cell, deps);
    }

    /// Like `set_precedents` but skips removing old edges (deferred index rebuild).
    ///
    /// Use only when the cell is known to have no prior edges (e.g., after `graph.clear()`).
    /// The RAII guard guarantees the range index is rebuilt on drop.
    ///
    /// # Panics
    ///
    /// Panics if the cell already has precedents in the graph.
    pub fn set_precedents_fresh(&mut self, cell: &CellId, deps: Vec<DepTarget>) {
        assert!(
            !self.graph.formula_cells.contains(cell),
            "BatchMutations::set_precedents_fresh called on cell {cell:?} which already has precedents",
        );
        self.graph.apply_precedents(cell, deps, false);
    }
}

impl Drop for BatchMutations<'_> {
    fn drop(&mut self) {
        self.graph.rebuild_range_index();
    }
}

/// Builder for constructing a [`DependencyGraph`] from scratch.
///
/// All cells are guaranteed fresh (no prior edges) because the builder starts
/// with an empty graph. This eliminates the `_fresh` precondition at the type
/// level — callers cannot accidentally use `_fresh` methods on a graph that
/// already contains edges.
///
/// Call [`build()`](Self::build) to finalize: it rebuilds the spatial range
/// index and returns the live [`DependencyGraph`].
///
/// # Examples
///
/// ```
/// use compute_graph::{GraphBuilder, DepTarget};
/// use cell_types::CellId;
///
/// let mut builder = GraphBuilder::new();
/// let a1 = CellId::from_raw(1);
/// let b1 = CellId::from_raw(2);
/// let c1 = CellId::from_raw(3);
/// builder.set_precedents(&b1, vec![DepTarget::Cell(a1)]);
/// builder.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
/// builder.mark_volatile(&c1);
/// let graph = builder.build();
/// assert_eq!(graph.formula_cell_count(), 2);
/// assert_eq!(graph.volatile_count(), 1);
/// ```
#[must_use = "call .build() to obtain the DependencyGraph"]
pub struct GraphBuilder {
    graph: DependencyGraph,
}

impl GraphBuilder {
    /// Create an empty builder.
    pub fn new() -> Self {
        Self {
            graph: DependencyGraph::new(),
        }
    }

    /// Create a builder with pre-allocated capacity for formula cells.
    pub fn with_capacity(estimated_formulas: usize) -> Self {
        Self {
            graph: DependencyGraph::with_capacity(estimated_formulas),
        }
    }

    /// Create a builder with separate capacities for formula and data cells.
    pub fn with_capacity_full(estimated_formulas: usize, estimated_dependents: usize) -> Self {
        Self {
            graph: DependencyGraph::with_capacity_full(estimated_formulas, estimated_dependents),
        }
    }

    /// Add dependencies for a cell.
    ///
    /// Since the builder starts empty, all cells are fresh by construction.
    /// Asserts that the cell hasn't been registered twice in this builder.
    ///
    /// Index rebuilding is deferred to [`build()`](Self::build).
    ///
    /// # Panics
    ///
    /// Panics if the cell already has precedents in this builder.
    pub fn set_precedents(&mut self, cell: &CellId, deps: Vec<DepTarget>) {
        assert!(
            !self.graph.formula_cells.contains(cell),
            "GraphBuilder::set_precedents called on cell {cell:?} which already has precedents",
        );
        self.graph.apply_precedents(cell, deps, false);
    }

    /// Bulk-insert precedents for many cells at once, with pre-sized dependent vecs.
    ///
    /// Much faster than calling [`set_precedents`](Self::set_precedents) in a loop
    /// because it pre-counts dependents and pre-sizes each inner `Vec` to the
    /// exact capacity needed, avoiding reallocation storms.
    ///
    /// Index rebuilding is deferred to [`build()`](Self::build).
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{GraphBuilder, DepTarget};
    /// use cell_types::CellId;
    ///
    /// let mut builder = GraphBuilder::new();
    /// let a1 = CellId::from_raw(1);
    /// let b1 = CellId::from_raw(2);
    /// let c1 = CellId::from_raw(3);
    /// builder.bulk_set_precedents(vec![
    ///     (b1, vec![DepTarget::Cell(a1)]),
    ///     (c1, vec![DepTarget::Cell(b1)]),
    /// ]);
    /// let graph = builder.build();
    /// assert_eq!(graph.formula_cell_count(), 2);
    /// ```
    pub fn bulk_set_precedents(&mut self, all_deps: Vec<(CellId, Vec<DepTarget>)>) {
        // Deduplicate by CellId — last entry wins (matches HashMap::insert semantics).
        // Debug-assert catches callers who shouldn't be sending duplicates.
        let original_len = all_deps.len();
        let all_deps = {
            let mut seen = FxHashSet::with_capacity_and_hasher(all_deps.len(), FxBuildHasher);
            let mut deduped: Vec<(CellId, Vec<DepTarget>)> = Vec::with_capacity(all_deps.len());
            for (cell, deps) in all_deps.into_iter().rev() {
                if seen.insert(cell) {
                    deduped.push((cell, deps));
                }
            }
            deduped.reverse();
            deduped
        };
        debug_assert_eq!(
            original_len,
            all_deps.len(),
            "bulk_set_precedents received duplicate CellIds"
        );

        // Pass 0: Deduplicate deps per cell (same invariant as apply_precedents).
        let all_deps: Vec<(CellId, Vec<DepTarget>)> = all_deps
            .into_iter()
            .map(|(cell, mut deps)| {
                let mut seen = FxHashSet::with_capacity_and_hasher(deps.len(), FxBuildHasher);
                deps.retain(|d| seen.insert(d.clone()));
                (cell, deps)
            })
            .collect();

        // Pass 1: Count cell-to-cell edges per target to pre-size inner Vecs.
        // Also count range edges per RangePos for range_deps pre-sizing.
        let mut cell_dep_counts: FxHashMap<CellId, usize> =
            FxHashMap::with_capacity_and_hasher(all_deps.len(), FxBuildHasher);
        let mut range_dep_counts: FxHashMap<RangePos, usize> = FxHashMap::default();

        for (_cell, deps) in &all_deps {
            for dep in deps {
                match dep {
                    DepTarget::Cell(target) => {
                        *cell_dep_counts.entry(*target).or_insert(0) += 1;
                    }
                    DepTarget::Range(rect, _) => {
                        *range_dep_counts.entry(*rect).or_insert(0) += 1;
                    }
                }
            }
        }

        // Pass 2: Pre-size all inner FxHashSets in the dependents map.
        for (target, count) in &cell_dep_counts {
            self.graph
                .dependents
                .entry(*target)
                .or_insert_with(|| FxHashSet::with_capacity_and_hasher(*count, FxBuildHasher));
        }

        // Pre-size range_deps inner sets too.
        for (rect, count) in &range_dep_counts {
            self.graph
                .range_deps
                .entry(*rect)
                .or_insert_with(|| FxHashSet::with_capacity_and_hasher(*count, FxBuildHasher));
        }

        // Pass 3: Insert all edges — inner sets are pre-sized, no rehashing.
        // Uses entry().or_default() for infallible access instead of .expect().
        for (cell, deps) in all_deps {
            let dep_count = deps.len() as u64;
            self.graph.total_edges += dep_count;
            if dep_count > self.graph.max_deps_per_cell {
                self.graph.max_deps_per_cell = dep_count;
            }
            let mut selective_ranges: Vec<RangePos> = Vec::new();
            for dep in &deps {
                match dep {
                    DepTarget::Cell(target) => {
                        self.graph
                            .dependents
                            .entry(*target)
                            .or_default()
                            .insert(cell);
                    }
                    DepTarget::Range(rect, access) => {
                        self.graph.range_deps.entry(*rect).or_default().insert(cell);
                        if matches!(access, RangeAccess::Selective) {
                            selective_ranges.push(*rect);
                        }
                    }
                }
            }
            if !selective_ranges.is_empty() {
                self.graph
                    .selective_dep_cells_idx
                    .insert(cell, selective_ranges);
            }
            self.graph.formula_cells.insert(cell);
            self.graph.precedents.insert(cell, deps);
        }
    }

    /// Mark a cell as volatile (always recalculated, e.g. `NOW()`, `RAND()`).
    pub fn mark_volatile(&mut self, cell: &CellId) {
        self.graph.volatile_cells.insert(*cell);
    }

    /// Finalize: builds the spatial range index and returns the live graph.
    pub fn build(mut self) -> DependencyGraph {
        self.graph.rebuild_range_index();
        self.graph
    }
}

impl Default for GraphBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl DependencyGraph {
    /// Create a batch mutation guard that defers range-index rebuilding.
    ///
    /// All `set_precedents` / `set_precedents_fresh` calls through the returned
    /// guard skip the per-mutation range-index rebuild. When the guard is dropped,
    /// `rebuild_range_index()` is called exactly once.
    ///
    /// This is the safe alternative to calling `set_precedents_defer_index` in a
    /// loop — the RAII guard guarantees the index is rebuilt even on early return.
    pub const fn batch_mutations(&mut self) -> BatchMutations<'_> {
        BatchMutations { graph: self }
    }

    /// Replace all dependencies for a cell.
    ///
    /// For `DepTarget::Cell`, adds to both `precedents` and `dependents`.
    /// For `DepTarget::Range`, adds to `range_deps` and `range_index`.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget};
    /// use cell_types::CellId;
    ///
    /// let mut graph = DependencyGraph::new();
    /// let a1 = CellId::from_raw(1);
    /// let b1 = CellId::from_raw(2);
    ///
    /// // B1 = A1 + 1
    /// graph.set_precedents(&b1, vec![DepTarget::Cell(a1)]);
    /// assert_eq!(graph.get_precedents(&b1), &[DepTarget::Cell(a1)]);
    /// assert!(graph.has_dependent(&a1, &b1));
    /// ```
    pub fn set_precedents(&mut self, cell: &CellId, deps: Vec<DepTarget>) {
        self.remove_old_edges(cell, true);
        self.apply_precedents(cell, deps, true);
    }

    /// Replace all external dependencies for a formula cell.
    pub fn set_external_precedents(
        &mut self,
        cell: &CellId,
        mut deps: Vec<workbook_types::ExternalRefKey>,
    ) {
        self.remove_external_edges(cell);
        let mut seen = FxHashSet::with_capacity_and_hasher(deps.len(), FxBuildHasher);
        deps.retain(|d| seen.insert(d.clone()));
        for dep in &deps {
            self.external_deps
                .entry(dep.clone())
                .or_default()
                .insert(*cell);
        }
        if !deps.is_empty() {
            self.formula_cells.insert(*cell);
            self.external_precedents.insert(*cell, deps);
        }
    }

    /// Like `set_precedents` but defers range-index rebuilding.
    ///
    /// Only accessible through [`BatchMutations`] which guarantees the index
    /// is rebuilt on drop.
    fn set_precedents_defer_index(&mut self, cell: &CellId, deps: Vec<DepTarget>) {
        self.remove_old_edges(cell, false);
        self.apply_precedents(cell, deps, false);
    }

    /// Shared implementation for `set_precedents` variants.
    ///
    /// Deduplicates `deps` before storing to prevent `edge_count()` over-counting
    /// and wasted storage when callers pass duplicate entries.
    fn apply_precedents(&mut self, cell: &CellId, mut deps: Vec<DepTarget>, reindex: bool) {
        // Deduplicate deps — preserves first occurrence order.
        {
            let mut seen = FxHashSet::with_capacity_and_hasher(deps.len(), FxBuildHasher);
            deps.retain(|d| seen.insert(d.clone()));
        }

        // Process deps before storing to avoid reborrowing from self.precedents.
        let mut range_rects_to_add = Vec::new();

        let mut selective_ranges: Vec<RangePos> = Vec::new();
        for dep in &deps {
            match dep {
                DepTarget::Cell(target) => {
                    self.dependents.entry(*target).or_default().insert(*cell);
                }
                DepTarget::Range(rect, access) => {
                    range_rects_to_add.push(*rect);
                    if matches!(access, RangeAccess::Selective) {
                        selective_ranges.push(*rect);
                    }
                }
            }
        }
        if !selective_ranges.is_empty() {
            self.selective_dep_cells_idx.insert(*cell, selective_ranges);
        }

        // Update incremental edge counters
        let dep_count = deps.len() as u64;
        self.total_edges += dep_count;
        if dep_count > self.max_deps_per_cell {
            self.max_deps_per_cell = dep_count;
        }

        self.formula_cells.insert(*cell);
        self.precedents.insert(*cell, deps);

        for rect in range_rects_to_add {
            let prev_len = self.range_deps.len();
            self.range_deps.entry(rect).or_default().insert(*cell);
            if self.range_deps.len() > prev_len {
                // New range entry — increment per-sheet counter and update sheet set.
                let sheet = rect.sheet();
                *self.range_count_per_sheet.entry(sheet).or_insert(0) += 1;
                self.sheets_with_range_deps.insert(sheet);
                if reindex {
                    self.add_to_range_index(&rect);
                }
            }
        }
    }

    /// Remove a cell and all its edges (both as precedent and dependent).
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget};
    /// use cell_types::CellId;
    ///
    /// let mut graph = DependencyGraph::new();
    /// let a1 = CellId::from_raw(1);
    /// let b1 = CellId::from_raw(2);
    /// graph.set_precedents(&b1, vec![DepTarget::Cell(a1)]);
    /// graph.remove_cell(&b1);
    /// assert_eq!(graph.formula_cell_count(), 0);
    /// ```
    pub fn remove_cell(&mut self, cell: &CellId) {
        // Remove forward edges (this cell's precedents)
        self.remove_old_edges(cell, true);
        self.precedents.remove(cell);
        self.formula_cells.remove(cell);
        self.selective_dep_cells_idx.remove(cell);
        self.remove_external_edges(cell);

        // Save the set of cells that depend on this cell, BEFORE removing it
        let cells_depending_on_me = self.dependents.remove(cell);

        // Clean up: remove this cell from those cells' precedent lists
        if let Some(dep_cells) = &cells_depending_on_me {
            for dep_cell in dep_cells {
                if let Some(precs) = self.precedents.get_mut(dep_cell) {
                    let before = precs.len();
                    precs.retain(|d| d != &DepTarget::Cell(*cell));
                    let removed = (before - precs.len()) as u64;
                    self.total_edges = self.total_edges.saturating_sub(removed);
                }
            }
        }

        // `remove_old_edges` already removed `cell` from all precedent-side dependent sets.
        // Verify graph consistency in debug builds.
        #[cfg(debug_assertions)]
        for dep_set in self.dependents.values() {
            debug_assert!(
                !dep_set.contains(cell),
                "graph inconsistency: cell still referenced as dependent after edge removal"
            );
        }

        // Remove from volatile
        self.volatile_cells.remove(cell);
    }

    /// Mark a cell as volatile (always recalculated).
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::DependencyGraph;
    /// use cell_types::CellId;
    ///
    /// let mut graph = DependencyGraph::new();
    /// let a1 = CellId::from_raw(1);
    /// graph.mark_volatile(&a1);
    /// assert_eq!(graph.volatile_count(), 1);
    /// graph.unmark_volatile(&a1);
    /// assert_eq!(graph.volatile_count(), 0);
    /// ```
    pub fn mark_volatile(&mut self, cell: &CellId) {
        self.volatile_cells.insert(*cell);
    }

    /// Unmark a cell as volatile.
    ///
    /// See [`mark_volatile`](Self::mark_volatile) for an example.
    pub fn unmark_volatile(&mut self, cell: &CellId) {
        self.volatile_cells.remove(cell);
    }

    /// Reset the entire graph.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget};
    /// use cell_types::CellId;
    ///
    /// let mut graph = DependencyGraph::new();
    /// let a1 = CellId::from_raw(1);
    /// let b1 = CellId::from_raw(2);
    /// graph.set_precedents(&b1, vec![DepTarget::Cell(a1)]);
    /// graph.clear();
    /// assert_eq!(graph.formula_cell_count(), 0);
    /// ```
    pub fn clear(&mut self) {
        self.precedents.clear();
        self.dependents.clear();
        self.range_deps.clear();
        self.external_deps.clear();
        self.external_precedents.clear();
        self.range_index.clear();
        self.sheets_with_range_deps.clear();
        self.range_count_per_sheet.clear();
        self.sheet_ranges.clear();
        self.volatile_cells.clear();
        self.formula_cells.clear();
        self.selective_dep_cells_idx.clear();
        self.total_edges = 0;
        self.max_deps_per_cell = 0;
    }

    /// Remove old forward and reverse edges for a cell (called before updating precedents).
    /// Takes ownership of the old deps via `remove` to avoid cloning.
    ///
    /// When `reindex` is false, skips the per-range `remove_from_range_index()` call
    /// (O(R log R) per sheet). Callers must ensure `rebuild_range_index()` is called
    /// later (e.g., via `BatchMutations` drop or explicit call in `bulk_remove_cells`).
    fn remove_old_edges(&mut self, cell: &CellId, reindex: bool) {
        // Take ownership of old deps to avoid borrow conflict
        if let Some(old_deps) = self.precedents.remove(cell) {
            // Decrement total edge count
            self.total_edges = self.total_edges.saturating_sub(old_deps.len() as u64);
            // Note: max_deps_per_cell is NOT decremented here because recomputing
            // the true max would require scanning all precedents. It remains an
            // upper bound, which is acceptable for statistics/diagnostics.
            for dep in &old_deps {
                match dep {
                    DepTarget::Cell(target) => {
                        if let Some(dep_set) = self.dependents.get_mut(target) {
                            dep_set.remove(cell);
                            if dep_set.is_empty() {
                                self.dependents.remove(target);
                            }
                        }
                    }
                    DepTarget::Range(rect, _) => {
                        let should_remove = self.range_deps.get_mut(rect).is_some_and(|dep_set| {
                            dep_set.remove(cell);
                            dep_set.is_empty()
                        });
                        if should_remove {
                            let sheet = rect.sheet();
                            self.range_deps.remove(rect);
                            if reindex {
                                self.remove_from_range_index(rect);
                            }
                            // Decrement per-sheet range count; remove sheet entry when zero.
                            if let Some(count) = self.range_count_per_sheet.get_mut(&sheet) {
                                *count -= 1;
                                if *count == 0 {
                                    self.range_count_per_sheet.remove(&sheet);
                                    self.sheets_with_range_deps.remove(&sheet);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn remove_external_edges(&mut self, cell: &CellId) {
        if let Some(old_deps) = self.external_precedents.remove(cell) {
            for dep in old_deps {
                let should_remove = self.external_deps.get_mut(&dep).is_some_and(|dep_set| {
                    dep_set.remove(cell);
                    dep_set.is_empty()
                });
                if should_remove {
                    self.external_deps.remove(&dep);
                }
            }
        }
    }

    /// Remove multiple cells and all their edges in a single pass.
    ///
    /// More efficient than calling `remove_cell` in a loop because it defers
    /// the range-index rebuild to a single call at the end.
    ///
    /// **Cost:** O(C x E) where C = cells to remove, E = average edges per cell,
    /// plus one O(R log R) range-index rebuild at the end.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget};
    /// use cell_types::CellId;
    ///
    /// let mut graph = DependencyGraph::new();
    /// let a1 = CellId::from_raw(1);
    /// let b1 = CellId::from_raw(2);
    /// let c1 = CellId::from_raw(3);
    /// graph.set_precedents(&b1, vec![DepTarget::Cell(a1)]);
    /// graph.set_precedents(&c1, vec![DepTarget::Cell(a1)]);
    /// graph.bulk_remove_cells(&[b1, c1]);
    /// assert_eq!(graph.formula_cell_count(), 0);
    /// ```
    pub fn bulk_remove_cells(&mut self, cells: &[CellId]) {
        let removal_set: FxHashSet<CellId> = cells.iter().copied().collect();

        // Step 1: Remove forward edges and precedent/volatile registration.
        // Uses remove_old_edges with reindex=false to defer range-index rebuilds.
        for cell in cells {
            self.remove_old_edges(cell, false);
            self.remove_external_edges(cell);
            self.precedents.remove(cell);
            self.formula_cells.remove(cell);
            self.volatile_cells.remove(cell);
            self.selective_dep_cells_idx.remove(cell);
        }

        // Step 2: Collect all surviving dependents that need precedent cleanup.
        // For each removed cell, gather cells that depended on it (and aren't
        // themselves being removed), mapping each to the set of removed precedents.
        let mut dependents_to_clean: FxHashMap<CellId, FxHashSet<CellId>> = FxHashMap::default();
        for &cell in cells {
            if let Some(dep_set) = self.dependents.remove(&cell) {
                for dep_cell in dep_set {
                    if !removal_set.contains(&dep_cell) {
                        dependents_to_clean
                            .entry(dep_cell)
                            .or_default()
                            .insert(cell);
                    }
                }
            }
        }

        // Step 3: Single pass — each dependent's precedent list is cleaned once,
        // regardless of how many removed cells it referenced.
        for (dep_cell, removed_precs) in &dependents_to_clean {
            if let Some(precs) = self.precedents.get_mut(dep_cell) {
                let before = precs.len();
                precs.retain(|d| !matches!(d, DepTarget::Cell(c) if removed_precs.contains(c)));
                let removed = (before - precs.len()) as u64;
                self.total_edges = self.total_edges.saturating_sub(removed);
            }
        }

        // Rebuild range index once for all removals
        self.rebuild_range_index();
    }

    /// Remove all range dependencies and range index entries for a given sheet.
    ///
    /// Called when a sheet is deleted to prevent orphaned range entries from
    /// accumulating (memory leak) and causing wasted work during recalc.
    /// Also cleans up stale [`DepTarget::Range`] entries from precedent lists
    /// so that `edge_count()` remains accurate.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget, RangeAccess};
    /// use cell_types::{CellId, SheetId, RangePos};
    ///
    /// let mut graph = DependencyGraph::new();
    /// let sheet = SheetId::from_raw(1);
    /// let a1 = CellId::from_raw(1);
    /// let range = RangePos::new(sheet, 0, 0, 999, 0);
    /// graph.set_precedents(&a1, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    /// graph.cleanup_sheet_ranges(&sheet);
    /// assert_eq!(graph.range_dep_count(), 0);
    /// ```
    pub fn cleanup_sheet_ranges(&mut self, sheet_id: &SheetId) {
        // Remove range_deps entries where the rect targets this sheet
        self.range_deps.retain(|rect, _| rect.sheet() != *sheet_id);
        // Remove the sheet's spatial index, cached sheet set entry, and range count
        self.range_index.remove(sheet_id);
        self.sheets_with_range_deps.remove(sheet_id);
        self.range_count_per_sheet.remove(sheet_id);
        self.sheet_ranges.remove(sheet_id);

        // Remove stale DepTarget::Range entries from precedent lists.
        // Cells whose precedent lists become empty still remain as formula cells
        // (they will evaluate to #REF! or similar) — do NOT remove them from
        // precedents, as that would violate the invariant that set_precedents
        // creates a permanent formula-cell entry.
        self.precedents.values_mut().for_each(|deps| {
            let before = deps.len();
            deps.retain(|d| !matches!(d, DepTarget::Range(rect, _) if rect.sheet() == *sheet_id));
            let removed = (before - deps.len()) as u64;
            self.total_edges = self.total_edges.saturating_sub(removed);
        });
    }
}
