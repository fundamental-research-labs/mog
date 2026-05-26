#![deny(clippy::all)]
#![warn(clippy::pedantic, clippy::nursery)]
#![forbid(unsafe_code)]
#![warn(missing_docs, unreachable_pub, trivial_casts, trivial_numeric_casts)]
// Selective allows for pedantic lints that don't apply:
#![allow(
    clippy::module_name_repetitions,   // DepTarget in dep_target module is fine
    clippy::redundant_pub_crate,       // pub(crate) in private modules is intentional
    clippy::items_after_statements,    // Frame struct in cell_depth is intentionally local
)]

//! Dependency Graph — [`CellId`]-keyed directed graph for tracking formula dependencies.
//!
//! Keyed by [`CellId`] — stable across structural changes (insert/delete rows/cols never
//! touch the graph). Supports cycle detection, topological sort, and range-group dependencies.
//!
//! ## Design
//!
//! The graph stores two kinds of edges:
//! - **Cell-to-cell** edges: `A` depends on `B` (fine-grained). Stored in both `precedents`
//!   (forward: A -> B) and `dependents` (reverse: B -> A).
//! - **Cell-to-range** edges: `A` depends on a rectangular region. For ranges with fewer
//!   than 256 cells, expanded to individual cell edges. For larger ranges, stored in
//!   `range_deps` for coarse-grained invalidation with bounded memory.
//!
//! ## Range Dependency Threshold
//!
//! Ranges with < 256 cells are expanded to individual [`CellId`] edges (fine-grained invalidation).
//! Ranges >= 256 cells are registered as [`DepTarget::Range`] (coarse invalidation, bounded memory).
//!
//! ## Quick Start
//!
//! ```
//! use compute_graph::{DependencyGraph, DepTarget};
//! use compute_graph::positions::CellPosition;
//! use cell_types::{CellId, SheetId, RangePos};
//!
//! let mut graph = DependencyGraph::new();
//! let a1 = CellId::from_raw(1);
//! let b1 = CellId::from_raw(2);
//! let c1 = CellId::from_raw(3);
//!
//! // B1 depends on A1; C1 depends on B1
//! graph.set_precedents(&b1, vec![DepTarget::Cell(a1)]);
//! graph.set_precedents(&c1, vec![DepTarget::Cell(b1)]);
//!
//! // When A1 changes, find affected cells (with position-aware analysis)
//! let null_resolver = |_: &CellId| -> Option<CellPosition> { None };
//! let affected = graph.affected_cells(&[a1], &null_resolver).into_value();
//! assert!(affected.contains(&a1));
//! assert!(affected.contains(&b1));
//! assert!(affected.contains(&c1));
//! ```
//!
//! ## Module Structure
//!
//! - `mutations` — adding/removing edges, volatile marking, clear
//! - `queries` — precedent/dependent lookups, statistics, range containment queries
//! - `topo` — depth computation, shared DFS helpers
//! - `recalc` — position-aware recalc ordering: dirty-set, topo sort, cycle detection
//! - `range_index` — spatial index for efficient range containment queries

use std::fmt;

use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};

use cell_types::{CellId, RangePos, SheetId};
use workbook_types::ExternalRefKey;

mod error;
pub use error::GraphError;

mod interval_tree;
mod mutations;
pub mod positions;
mod queries;
mod range_index;
mod recalc;
pub(crate) mod topo;

pub(crate) use interval_tree::RangeIntervalTree;
pub use mutations::{BatchMutations, GraphBuilder};
pub use positions::{
    AnalysisCompleteness, Analyzed, CellPosition, HypotheticalDependencyEdit, PositionResolver,
    WithOverrides,
};
pub use queries::EdgeStats;

#[cfg(test)]
mod tests {
    use super::*;

    mod test_mutations;
    mod test_proptest;
    mod test_queries;
    mod test_resolved_view;
    mod test_topo;
}

/// Threshold: ranges with fewer cells than this are expanded to individual edges.
///
/// Callers (parser, scheduler) should check `range.cell_count() < RANGE_EXPANSION_THRESHOLD`
/// and expand small ranges to individual [`DepTarget::Cell`] edges for fine-grained invalidation.
pub const RANGE_EXPANSION_THRESHOLD: u64 = 256;

/// How a formula accesses cells within a range dependency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RangeAccess {
    /// Formula reads every cell in the range (SUM, AVERAGE, COUNTIF, etc.).
    /// Barrier containment edges are created for all contained cells.
    Aggregate,
    /// Formula reads a dynamic subset of the range (INDEX, CHOOSE, etc.).
    /// Barrier containment edges use back-edge filtering — cells with
    /// back-edges to the dependent formula are excluded (preventing false
    /// cycles), while all other cells are included (preserving evaluation
    /// ordering).
    Selective,
}

/// Dependency target — either a single cell or a range group.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DepTarget {
    /// Direct cell-to-cell dependency.
    Cell(CellId),
    /// Range-group dependency with access semantics.
    Range(RangePos, RangeAccess),
}

impl fmt::Display for DepTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cell(id) => write!(f, "Cell({})", id.as_u128()),
            Self::Range(r, access) => write!(
                f,
                "Range(sheet={}, {}:{}-{}:{}, {:?})",
                r.sheet().as_u128(),
                r.start_row(),
                r.start_col(),
                r.end_row(),
                r.end_col(),
                access,
            ),
        }
    }
}

impl fmt::Display for RangeAccess {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Aggregate => write!(f, "Aggregate"),
            Self::Selective => write!(f, "Selective"),
        }
    }
}

/// CellId-keyed dependency graph for the spreadsheet compute engine.
///
/// Tracks which cells depend on which (precedent/dependent relationships),
/// supports cycle detection, topological sorting for evaluation order,
/// and efficient partial recalculation via BFS + topo sort.
#[derive(Debug)]
#[must_use = "constructing a DependencyGraph has no effect unless you use it"]
pub struct DependencyGraph {
    /// Forward edges: cell -> what it depends on (precedents).
    precedents: FxHashMap<CellId, Vec<DepTarget>>,
    /// Reverse edges: cell -> what depends on it (dependents).
    dependents: FxHashMap<CellId, FxHashSet<CellId>>,
    /// Range dependencies: ranges and which cells depend on them.
    /// Used for coarse-grained invalidation of large ranges (>= 256 cells).
    range_deps: FxHashMap<RangePos, FxHashSet<CellId>>,
    /// External dependencies keyed separately from local dependency targets.
    external_deps: FxHashMap<ExternalRefKey, FxHashSet<CellId>>,
    /// Reverse index from target formula cell to external refs it reads.
    external_precedents: FxHashMap<CellId, Vec<ExternalRefKey>>,
    /// Per-sheet interval tree for efficient point-in-range queries.
    /// Enables O(log R + K) lookups for range containment checks.
    range_index: FxHashMap<SheetId, RangeIntervalTree>,
    /// Cached set of sheets that have range dependencies — enables O(1)
    /// `has_range_deps_for_sheet` without scanning all `range_deps` keys.
    sheets_with_range_deps: FxHashSet<SheetId>,
    /// Per-sheet count of range dependency entries — enables O(1) sheet-empty
    /// checks when removing individual range deps (avoids O(R) scan of all
    /// `range_deps` keys).
    range_count_per_sheet: FxHashMap<SheetId, usize>,
    /// Per-sheet side index of range positions — enables O(1) lookup of all
    /// ranges on a given sheet without scanning all `range_deps` keys.
    sheet_ranges: FxHashMap<SheetId, Vec<RangePos>>,
    /// Volatile cells — always included in every recalc pass (e.g., `NOW()`, `RAND()`).
    volatile_cells: FxHashSet<CellId>,
    /// Explicit set of formula cells — decoupled from edge topology so that
    /// formula membership survives edge removal/re-insertion during updates.
    formula_cells: FxHashSet<CellId>,
    /// Pre-computed set of cells with selective range dependencies.
    /// Avoids scanning all 2.6M precedent entries to find the ~12K selective deps.
    /// Updated by `apply_precedents`, `remove_old_edges`, and `bulk_set_precedents`.
    selective_dep_cells_idx: FxHashMap<CellId, Vec<RangePos>>,
    /// Incrementally maintained total edge count (cell-to-cell + range edges).
    /// Updated by `apply_precedents`, `remove_old_edges`, `remove_cell`,
    /// `bulk_remove_cells`, and `clear`.
    total_edges: u64,
    /// Incrementally maintained max dependencies per cell.
    /// Updated by `apply_precedents` and `remove_old_edges`.
    max_deps_per_cell: u64,
}

impl DependencyGraph {
    /// Create an empty dependency graph.
    pub fn new() -> Self {
        Self {
            precedents: FxHashMap::default(),
            dependents: FxHashMap::default(),
            range_deps: FxHashMap::default(),
            external_deps: FxHashMap::default(),
            external_precedents: FxHashMap::default(),
            range_index: FxHashMap::default(),
            sheets_with_range_deps: FxHashSet::default(),
            range_count_per_sheet: FxHashMap::default(),
            sheet_ranges: FxHashMap::default(),
            volatile_cells: FxHashSet::default(),
            formula_cells: FxHashSet::default(),
            selective_dep_cells_idx: FxHashMap::default(),
            total_edges: 0,
            max_deps_per_cell: 0,
        }
    }

    /// Create a dependency graph with pre-allocated capacity.
    ///
    /// `estimated_formulas` is the expected number of formula cells. Avoids
    /// repeated hash map resizing during bulk load (e.g., file open).
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::DependencyGraph;
    ///
    /// let graph = DependencyGraph::with_capacity(1000);
    /// assert_eq!(graph.formula_cell_count(), 0);
    /// ```
    pub fn with_capacity(estimated_formulas: usize) -> Self {
        Self::with_capacity_full(estimated_formulas, estimated_formulas)
    }

    /// Create a dependency graph with separate capacities for formula and data cells.
    ///
    /// - `estimated_formulas`: pre-sizes `precedents` (one entry per formula cell).
    /// - `estimated_dependents`: pre-sizes `dependents` (one entry per cell that is
    ///   depended upon — includes both data cells and formula cells). Using total
    ///   cell count avoids rehash storms when 263K+ formulas reference data cells.
    ///
    /// # Examples
    ///
    /// ```
    /// use compute_graph::DependencyGraph;
    ///
    /// let graph = DependencyGraph::with_capacity_full(500, 2000);
    /// assert_eq!(graph.formula_cell_count(), 0);
    /// ```
    pub fn with_capacity_full(estimated_formulas: usize, estimated_dependents: usize) -> Self {
        // Range deps are typically ~1-10% of formula count (large-range formulas
        // like SUMIFS referencing full columns). Pre-size conservatively to avoid
        // the first few rehash doublings.
        let estimated_ranges = estimated_formulas / 16;
        Self {
            precedents: FxHashMap::with_capacity_and_hasher(estimated_formulas, FxBuildHasher),
            dependents: FxHashMap::with_capacity_and_hasher(estimated_dependents, FxBuildHasher),
            range_deps: FxHashMap::with_capacity_and_hasher(estimated_ranges, FxBuildHasher),
            external_deps: FxHashMap::default(),
            external_precedents: FxHashMap::default(),
            range_index: FxHashMap::default(),
            sheets_with_range_deps: FxHashSet::default(),
            range_count_per_sheet: FxHashMap::default(),
            sheet_ranges: FxHashMap::default(),
            volatile_cells: FxHashSet::default(),
            formula_cells: FxHashSet::with_capacity_and_hasher(estimated_formulas, FxBuildHasher),
            selective_dep_cells_idx: FxHashMap::default(),
            total_edges: 0,
            max_deps_per_cell: 0,
        }
    }
}

impl Default for DependencyGraph {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for DependencyGraph {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "DependencyGraph {{ formulas: {}, edges: {}, ranges: {}, volatile: {} }}",
            self.formula_cell_count(),
            self.edge_count(),
            self.range_dep_count(),
            self.volatile_count(),
        )
    }
}

// Static assertion: DependencyGraph must be Send + Sync for cross-thread use.
const fn assert_send<T: Send>() {}
const fn assert_sync<T: Sync>() {}
const _: () = assert_send::<DependencyGraph>();
const _: () = assert_sync::<DependencyGraph>();
