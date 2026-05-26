//! Query methods for the dependency graph — lookups, statistics, and range containment queries.

use cell_types::{CellId, RangePos, SheetId};
use rustc_hash::{FxHashMap, FxHashSet};

use super::{DepTarget, DependencyGraph};

/// Statistics about dependency edges in the graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EdgeStats {
    /// Total number of dependency edges across all formula cells.
    pub total_edges: u64,
    /// Upper bound on the maximum number of dependencies any single cell has.
    /// May over-report after cell removals.
    pub max_deps_per_cell: u64,
}

impl DependencyGraph {
    // ─────────────────────────────────────────────────────────────────────
    // Lookups
    // ─────────────────────────────────────────────────────────────────────

    /// What does this cell depend on (its precedents)?
    ///
    /// Returns the list of [`DepTarget`] entries that the given cell depends on.
    /// Returns an empty slice if the cell has no recorded dependencies.
    ///
    /// **Cost:** O(1) hash lookup.
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
    ///
    /// assert_eq!(graph.get_precedents(&b1), &[DepTarget::Cell(a1)]);
    /// assert!(graph.get_precedents(&a1).is_empty());
    /// ```
    #[inline]
    #[must_use]
    pub fn get_precedents(&self, cell: &CellId) -> &[DepTarget] {
        self.precedents.get(cell).map_or(&[], |v| v.as_slice())
    }

    /// External refs this cell depends on.
    #[inline]
    #[must_use]
    pub fn get_external_precedents(&self, cell: &CellId) -> &[workbook_types::ExternalRefKey] {
        self.external_precedents
            .get(cell)
            .map_or(&[], |v| v.as_slice())
    }

    /// Iterator over cell-type precedents only (excludes Range deps).
    #[inline]
    pub fn get_precedent_cells<'a>(&'a self, cell: &CellId) -> impl Iterator<Item = &'a CellId> {
        self.get_precedents(cell)
            .iter()
            .filter_map(|dep| match dep {
                DepTarget::Cell(c) => Some(c),
                DepTarget::Range(..) => None,
            })
    }

    /// What depends on this cell (its dependents)?
    ///
    /// Returns an iterator over cells that depend on the given cell.
    /// Returns an empty iterator if nothing depends on this cell.
    ///
    /// **Cost:** O(1) hash lookup + O(D) iteration where D = number of dependents.
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
    ///
    /// let deps: Vec<_> = graph.get_dependents(&a1).collect();
    /// assert_eq!(deps, vec![&b1]);
    /// ```
    #[inline]
    pub fn get_dependents(&self, cell: &CellId) -> impl Iterator<Item = &CellId> + '_ {
        self.dependents.get(cell).into_iter().flat_map(|s| s.iter())
    }

    /// Formula cells depending on an external ref key.
    #[inline]
    pub fn get_external_dependents(
        &self,
        key: &workbook_types::ExternalRefKey,
    ) -> impl Iterator<Item = &CellId> + '_ {
        self.external_deps
            .get(key)
            .into_iter()
            .flat_map(|s| s.iter())
    }

    /// Does the given cell have `dep` as a direct dependent?
    ///
    /// **Cost:** O(1) hash lookup + O(1) set membership check.
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
    ///
    /// assert!(graph.has_dependent(&a1, &b1));
    /// assert!(!graph.has_dependent(&b1, &a1));
    /// ```
    #[inline]
    #[must_use]
    pub fn has_dependent(&self, cell: &CellId, dep: &CellId) -> bool {
        self.dependents.get(cell).is_some_and(|s| s.contains(dep))
    }

    /// Number of direct dependents of a cell.
    ///
    /// **Cost:** O(1) hash lookup.
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
    ///
    /// assert_eq!(graph.dependent_count(&a1), 2);
    /// assert_eq!(graph.dependent_count(&b1), 0);
    /// ```
    #[inline]
    #[must_use]
    pub fn dependent_count(&self, cell: &CellId) -> usize {
        self.dependents.get(cell).map_or(0, FxHashSet::len)
    }

    /// Is this cell volatile?
    ///
    /// **Cost:** O(1) hash lookup.
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
    ///
    /// assert!(graph.is_volatile(&a1));
    /// assert!(!graph.is_volatile(&CellId::from_raw(99)));
    /// ```
    #[inline]
    #[must_use]
    pub fn is_volatile(&self, cell: &CellId) -> bool {
        self.volatile_cells.contains(cell)
    }

    /// Iterate over all volatile cells.
    ///
    /// **Cost:** O(V) where V = number of volatile cells.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::DependencyGraph;
    /// use cell_types::CellId;
    ///
    /// let mut graph = DependencyGraph::new();
    /// let a1 = CellId::from_raw(1);
    /// let b1 = CellId::from_raw(2);
    /// graph.mark_volatile(&a1);
    /// graph.mark_volatile(&b1);
    ///
    /// assert_eq!(graph.volatile_cells().count(), 2);
    /// ```
    #[inline]
    pub fn volatile_cells(&self) -> impl Iterator<Item = &CellId> + '_ {
        self.volatile_cells.iter()
    }

    /// Compute total dependency edges and max deps per cell.
    ///
    /// **Cost:** O(P) where P = number of formula cells (iterates precedents map).
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
    /// graph.set_precedents(&c1, vec![DepTarget::Cell(a1), DepTarget::Cell(b1)]);
    ///
    /// let stats = graph.dep_edge_stats();
    /// assert_eq!(stats.total_edges, 2);
    /// assert_eq!(stats.max_deps_per_cell, 2);
    /// ```
    #[inline]
    #[must_use]
    pub const fn dep_edge_stats(&self) -> EdgeStats {
        EdgeStats {
            total_edges: self.total_edges,
            max_deps_per_cell: self.max_deps_per_cell,
        }
    }

    /// Does this cell exist in the graph (has precedents or is a dependent)?
    ///
    /// **Cost:** O(1) hash lookups.
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
    ///
    /// assert!(graph.has_cell(&a1));
    /// assert!(graph.has_cell(&b1));
    /// assert!(!graph.has_cell(&CellId::from_raw(99)));
    /// ```
    #[inline]
    #[must_use]
    pub fn has_cell(&self, cell: &CellId) -> bool {
        self.precedents.contains_key(cell)
            || self.dependents.contains_key(cell)
            || self.volatile_cells.contains(cell)
            || self.formula_cells.contains(cell)
    }

    // ─────────────────────────────────────────────────────────────────────
    // Statistics
    // ─────────────────────────────────────────────────────────────────────

    /// Number of cells with dependencies (formula cells).
    ///
    /// **Cost:** O(1).
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
    ///
    /// assert_eq!(graph.formula_cell_count(), 1);
    /// ```
    #[inline]
    #[must_use]
    pub fn formula_cell_count(&self) -> usize {
        self.formula_cells.len()
    }

    /// All formula cells in the graph (read-only reference).
    #[inline]
    #[must_use]
    pub const fn all_formula_cells(&self) -> &FxHashSet<CellId> {
        &self.formula_cells
    }

    /// Total dependency edges (cell-to-cell only; range deps counted separately).
    ///
    /// **Cost:** O(P) where P = number of formula cells.
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
    /// graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
    ///
    /// assert_eq!(graph.edge_count(), 2);
    /// ```
    #[must_use]
    pub fn edge_count(&self) -> usize {
        let cell_edges: usize = self
            .precedents
            .values()
            .map(|deps| {
                deps.iter()
                    .filter(|d| matches!(d, DepTarget::Cell(_)))
                    .count()
            })
            .sum();
        let range_edges: usize = self.range_deps.values().map(FxHashSet::len).sum();
        cell_edges + range_edges
    }

    /// Number of volatile cells.
    ///
    /// **Cost:** O(1).
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::DependencyGraph;
    /// use cell_types::CellId;
    ///
    /// let mut graph = DependencyGraph::new();
    /// graph.mark_volatile(&CellId::from_raw(1));
    /// graph.mark_volatile(&CellId::from_raw(2));
    ///
    /// assert_eq!(graph.volatile_count(), 2);
    /// ```
    #[inline]
    #[must_use]
    pub fn volatile_count(&self) -> usize {
        self.volatile_cells.len()
    }

    /// Number of range dependency entries in the graph.
    ///
    /// **Cost:** O(1).
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget, RangeAccess};
    /// use cell_types::{CellId, SheetId, RangePos};
    ///
    /// let mut graph = DependencyGraph::new();
    /// let sheet = SheetId::from_raw(1);
    /// let sum = CellId::from_raw(1);
    /// let range = RangePos::new(sheet, 0, 0, 999, 0);
    /// graph.set_precedents(&sum, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    ///
    /// assert_eq!(graph.range_dep_count(), 1);
    /// ```
    #[inline]
    #[must_use]
    pub fn range_dep_count(&self) -> usize {
        self.range_deps.len()
    }

    /// Check if any range dependencies exist for a specific sheet.
    ///
    /// **Cost:** O(1) hash lookup (uses cached sheet set).
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget, RangeAccess};
    /// use cell_types::{CellId, SheetId, RangePos};
    ///
    /// let mut graph = DependencyGraph::new();
    /// let sheet = SheetId::from_raw(1);
    /// let other = SheetId::from_raw(2);
    /// let sum = CellId::from_raw(1);
    /// let range = RangePos::new(sheet, 0, 0, 999, 0);
    /// graph.set_precedents(&sum, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    ///
    /// assert!(graph.has_range_deps_for_sheet(&sheet));
    /// assert!(!graph.has_range_deps_for_sheet(&other));
    /// ```
    #[inline]
    #[must_use]
    pub fn has_range_deps_for_sheet(&self, sheet_id: &SheetId) -> bool {
        self.sheets_with_range_deps.contains(sheet_id)
    }

    /// Check if the range index has entries for a specific sheet.
    ///
    /// **Cost:** O(1) hash lookup.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget, RangeAccess};
    /// use cell_types::{CellId, SheetId, RangePos};
    ///
    /// let mut graph = DependencyGraph::new();
    /// let sheet = SheetId::from_raw(1);
    /// let sum = CellId::from_raw(1);
    /// let range = RangePos::new(sheet, 0, 0, 999, 0);
    /// graph.set_precedents(&sum, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    ///
    /// assert!(graph.has_range_index_for_sheet(&sheet));
    /// ```
    #[inline]
    #[must_use]
    pub fn has_range_index_for_sheet(&self, sheet_id: &SheetId) -> bool {
        self.range_index.contains_key(sheet_id)
    }

    /// Collect all cells that have at least one `RangeAccess::Selective` precedent.
    ///
    /// These are formulas using INDEX, VLOOKUP, XLOOKUP, MATCH, etc. that read
    /// a dynamic subset of a range. In the hybrid Kahn's + deferral approach,
    /// these cells get no range barriers during topo sort and may need a fixup
    /// pass after the main evaluation.
    ///
    /// **Cost:** O(F × P) where F = formula cells, P = avg precedents per cell.
    #[must_use]
    pub fn selective_dep_cells(&self) -> FxHashSet<CellId> {
        self.selective_dep_cells_idx.keys().copied().collect()
    }

    /// Return selective dep cells that have at least one selective range precedent
    /// containing formula cells. Cells whose ranges only contain data cells
    /// (not in `formula_cells`) are excluded — they always read correct values
    /// and don't need the fixup pass.
    pub fn selective_dep_cells_with_formula_ranges<V>(
        &self,
        formula_cells: &FxHashMap<CellId, V>,
        positions: &impl crate::positions::PositionResolver,
    ) -> FxHashSet<CellId> {
        // Build sheet→column→rows index for formula cells for fast range checks
        let mut formula_index: FxHashMap<SheetId, FxHashMap<u32, Vec<u32>>> = FxHashMap::default();
        for cell_id in formula_cells.keys() {
            if let Some(pos) = positions.resolve(cell_id) {
                formula_index
                    .entry(pos.sheet)
                    .or_default()
                    .entry(pos.col)
                    .or_default()
                    .push(pos.row);
            }
        }
        for sheet_cols in formula_index.values_mut() {
            for rows in sheet_cols.values_mut() {
                rows.sort_unstable();
            }
        }

        let range_has_formulas = |range_pos: &RangePos| -> bool {
            let sheet = range_pos.sheet();
            let sr = range_pos.start_row();
            let er = range_pos.end_row();
            let sc = range_pos.start_col();
            let ec = range_pos.end_col();
            if let Some(sheet_cols) = formula_index.get(&sheet) {
                for col in sc..=ec {
                    if let Some(rows) = sheet_cols.get(&col) {
                        let lo = rows.partition_point(|&r| r < sr);
                        if lo < rows.len() && rows[lo] <= er {
                            return true;
                        }
                    }
                }
            }
            false
        };

        let mut result = FxHashSet::default();
        // Only scan the pre-computed selective dep cells, not all precedents
        for (cell, ranges) in &self.selective_dep_cells_idx {
            if ranges.iter().any(&range_has_formulas) {
                result.insert(*cell);
            }
        }
        result
    }

    /// Return selective dep cells that have at least one selective range precedent
    /// overlapping with a changed cell position. This is a tighter filter than
    /// `selective_dep_cells_with_formula_ranges`: it only returns cells whose
    /// ranges contain cells that actually changed value during the main eval pass.
    ///
    /// `changed_index` maps (`SheetId`, col) → sorted `Vec<row>` of changed positions.
    #[must_use]
    pub fn selective_dep_cells_with_changed_ranges(
        &self,
        changed_index: &FxHashMap<(SheetId, u32), Vec<u32>>,
    ) -> FxHashSet<CellId> {
        if changed_index.is_empty() || self.selective_dep_cells_idx.is_empty() {
            return FxHashSet::default();
        }

        let range_has_changes = |range_pos: &RangePos| -> bool {
            let sheet = range_pos.sheet();
            let sr = range_pos.start_row();
            let er = range_pos.end_row();
            let sc = range_pos.start_col();
            let ec = range_pos.end_col();
            for col in sc..=ec {
                if let Some(rows) = changed_index.get(&(sheet, col)) {
                    let lo = rows.partition_point(|&r| r < sr);
                    if lo < rows.len() && rows[lo] <= er {
                        return true;
                    }
                }
            }
            false
        };

        let mut result = FxHashSet::default();
        // Only scan the ~12K selective dep cells, not all 2.6M precedents
        for (cell, ranges) in &self.selective_dep_cells_idx {
            if ranges.iter().any(&range_has_changes) {
                result.insert(*cell);
            }
        }
        result
    }

    // ─────────────────────────────────────────────────────────────────────
    // Diagnostics
    // ─────────────────────────────────────────────────────────────────────

    /// One-line diagnostic summary of the graph's size and shape.
    ///
    /// Useful for logging after bulk operations (file open, full recalc).
    ///
    /// **Cost:** O(V + E) due to `max_depth()` and `edge_count()` traversals.
    /// For hot paths, use the individual stat methods instead.
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
    ///
    /// let s = graph.summary();
    /// assert!(s.contains("formulas: 1"));
    /// ```
    #[must_use]
    pub fn summary(&self) -> String {
        let stats = self.dep_edge_stats();
        format!(
            "DependencyGraph {{ formulas: {}, edges: {}, ranges: {}, volatile: {}, max_depth: {}, max_deps_per_cell: {} }}",
            self.formula_cell_count(),
            stats.total_edges,
            self.range_dep_count(),
            self.volatile_count(),
            self.max_depth(),
            stats.max_deps_per_cell,
        )
    }

    /// Find all formula cells whose range dependencies contain any of the given positions.
    ///
    /// Used by projection stabilization to find formulas affected by
    /// projection changes without requiring a full BFS through the graph.
    ///
    /// Returns a deduplicated set of [`CellId`]s whose formulas reference ranges
    /// that contain at least one of the given `(sheet, row, col)` positions.
    ///
    /// **Cost:** O(P * (log R + K)) where P = number of positions, R = range entries
    /// per sheet, K = matches per query.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget, RangeAccess};
    /// use cell_types::{CellId, SheetId, RangePos};
    ///
    /// let mut graph = DependencyGraph::new();
    /// let sheet = SheetId::from_raw(1);
    /// let sum = CellId::from_raw(1);
    /// let range = RangePos::new(sheet, 0, 0, 9, 0);
    /// graph.set_precedents(&sum, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    ///
    /// let found = graph.find_by_range_containment(&[(sheet, 5, 0)]);
    /// assert!(found.contains(&sum));
    /// ```
    #[must_use]
    pub fn find_by_range_containment(&self, positions: &[(SheetId, u32, u32)]) -> Vec<CellId> {
        let mut affected = FxHashSet::default();

        // Group positions by sheet for efficiency
        let mut by_sheet: FxHashMap<SheetId, Vec<(u32, u32)>> = FxHashMap::default();
        for &(sheet, row, col) in positions {
            by_sheet.entry(sheet).or_default().push((row, col));
        }

        for (sheet, positions) in &by_sheet {
            if let Some(tree) = self.range_index.get(sheet) {
                for &(row, col) in positions {
                    for rect in tree.query(row, col) {
                        if let Some(deps) = self.range_deps.get(rect) {
                            affected.extend(deps);
                        }
                    }
                }
            }
        }

        affected.into_iter().collect()
    }

    /// Find all formula cells whose range dependencies overlap any of the given rectangles.
    ///
    /// Range-based variant of [`find_by_range_containment`] — instead of testing individual
    /// points, tests rectangle-vs-rectangle overlap. This avoids materializing every cell
    /// position in large projection spills (e.g., 1000x1000 TRANSPOSE).
    ///
    /// Returns a deduplicated set of [`CellId`]s whose formulas reference ranges
    /// that overlap at least one of the given rectangles.
    ///
    /// **Cost:** O(Q * (log R + K)) where Q = number of query rectangles,
    /// R = range entries per sheet, K = matches per query.
    #[must_use]
    pub fn find_by_range_containment_ranges(
        &self,
        ranges: &[(SheetId, u32, u32, u32, u32)],
    ) -> Vec<CellId> {
        let mut affected = FxHashSet::default();

        // Group query ranges by sheet for efficiency
        let mut by_sheet: FxHashMap<SheetId, Vec<(u32, u32, u32, u32)>> = FxHashMap::default();
        for &(sheet, sr, sc, er, ec) in ranges {
            by_sheet.entry(sheet).or_default().push((sr, sc, er, ec));
        }

        for (sheet, query_ranges) in &by_sheet {
            if let Some(tree) = self.range_index.get(sheet) {
                for &(sr, sc, er, ec) in query_ranges {
                    for rect in tree.query_range(sr, sc, er, ec) {
                        if let Some(deps) = self.range_deps.get(rect) {
                            affected.extend(deps);
                        }
                    }
                }
            }
        }

        affected.into_iter().collect()
    }

    /// Given a cell position, find all formula cells that depend on a range
    /// containing this position.
    ///
    /// Encapsulates the `range_index` spatial lookup + `range_deps` indirection.
    /// Used by the scheduler to include range edges in level
    /// assignment without exposing internal data structures.
    ///
    /// **Cost:** O(log R + K) where R = range entries on the sheet, K = matches.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::{DependencyGraph, DepTarget, RangeAccess};
    /// use cell_types::{CellId, SheetId, RangePos};
    ///
    /// let mut graph = DependencyGraph::new();
    /// let sheet = SheetId::from_raw(1);
    /// let sum = CellId::from_raw(1);
    /// let range = RangePos::new(sheet, 0, 0, 9, 0);
    /// graph.set_precedents(&sum, vec![DepTarget::Range(range, RangeAccess::Aggregate)]);
    ///
    /// let deps = graph.get_range_dependents_at(sheet, 5, 0);
    /// assert!(deps.contains(&sum));
    /// ```
    #[must_use]
    pub fn get_range_dependents_at(&self, sheet: SheetId, row: u32, col: u32) -> Vec<CellId> {
        let mut seen = FxHashSet::default();
        if let Some(tree) = self.range_index.get(&sheet) {
            for rect in tree.query(row, col) {
                if let Some(deps) = self.range_deps.get(rect) {
                    seen.extend(deps.iter());
                }
            }
        }
        seen.into_iter().collect()
    }
}
