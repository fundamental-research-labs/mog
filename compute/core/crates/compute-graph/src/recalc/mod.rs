//! Recalc ordering — range-aware dirty-set, topo sort, and cycle detection.
//!
//! Position-aware analysis methods on [`DependencyGraph`]. Each method takes a
//! [`PositionResolver`] parameter, combining symbolic topology with concrete cell
//! positions to produce:
//!
//! - **`affected_cells`** — cycle-tolerant dirty-set expansion
//! - **`affected_cells_levels`** — dirty-set grouped by topological level
//! - **`evaluation_levels`** — full-graph topo ordering (cycle-failing)
//! - **`subset_levels`** — partial-recalc topo ordering (cycle-tolerant, position-sorted)
//! - **`detect_cycles`** — diagnostic cycle enumeration
//! - **`would_create_cycle`** — hypothetical edit-time cycle check
//!
//! ## Cycle contracts
//!
//! | Method | Cycle contract |
//! |---|---|
//! | `affected_cells` | Cycle-tolerant — returns cells, never errors |
//! | `affected_cells_levels` | Cycle-tolerant — returns `(levels, cycle_cells)` |
//! | `evaluation_levels` | Cycle-failing — `Result<_, GraphError::CycleDetected>` |
//! | `subset_levels` | Cycle-tolerant — returns `(levels, cycle_cells)` |
//! | `would_create_cycle` | Boolean — infallible |
//! | `detect_cycles` | Diagnostic — returns `Analyzed<Vec<Vec<CellId>>>` with all cycle groups |
//!
//! ## Completeness
//!
//! Every method returns [`Analyzed<T>`] which pairs the result with an
//! [`AnalysisCompleteness`] indicator. `Incomplete` means at least one cell's
//! position could not be resolved; the result is conservative (may over-invalidate)
//! but never fabricates structure that does not exist.

use cell_types::{CellId, RangePos, SheetId};
use rustc_hash::FxHashMap;

use crate::positions::{AnalysisCompleteness, CellPosition, PositionResolver};

mod barrier_graph;
mod cycles;
mod dirty_set;
mod range_helpers;
mod topo_order;

/// Topo sort result with cycle classification.
pub(crate) struct TopoResult {
    /// Cells in correct evaluation order (acyclic portion).
    pub levels: Vec<Vec<CellId>>,
    /// Strongly connected components — true cycle cores.
    /// Each inner Vec is one SCC. Evaluation should emit `#CIRC_REF` for these.
    pub cycle_cores: Vec<Vec<CellId>>,
    /// Cells downstream of cycle cores, in evaluation order.
    /// These should be evaluated after cycle cores resolve.
    pub downstream_levels: Vec<Vec<CellId>>,
}

/// Per-sheet position index: maps each sheet to a sorted list of (row, col, `cell_id`).
pub(super) type SheetPositionIndex = FxHashMap<SheetId, Vec<(u32, u32, CellId)>>;

/// Build a per-sheet, row-sorted position index from an iterator of cells.
///
/// Returns the index for range containment lookups via `range_slice`.
/// Completeness is tracked externally — when called with a [`TrackedResolver`],
/// resolution misses are recorded automatically.
pub(super) fn build_sheet_position_index(
    cells: impl Iterator<Item = CellId>,
    positions: &impl PositionResolver,
) -> SheetPositionIndex {
    let mut index: SheetPositionIndex = FxHashMap::default();
    for cell in cells {
        if let Some(CellPosition { sheet, row, col }) = positions.resolve(&cell) {
            index.entry(sheet).or_default().push((row, col, cell));
        }
    }
    for cells in index.values_mut() {
        cells.sort_unstable_by_key(|&(row, col, _)| (row, col));
    }
    index
}

/// Binary-search a row-sorted position list to find entries within a range's row bounds.
fn range_slice<'a>(cells: &'a [(u32, u32, CellId)], rect: &RangePos) -> &'a [(u32, u32, CellId)] {
    let lo = cells.partition_point(|&(row, _, _)| row < rect.start_row());
    let hi = cells.partition_point(|&(row, _, _)| row <= rect.end_row());
    &cells[lo..hi]
}

/// Iterate all cells within a range's row AND column bounds from a sheet position index.
///
/// Combines `range_slice` (binary search on rows) with column bounds filtering.
/// Returns an empty iterator if the sheet doesn't exist in `sheet_cells`.
pub(crate) fn cells_in_range<'a>(
    sheet_cells: &'a SheetPositionIndex,
    range: &'a RangePos,
) -> impl Iterator<Item = (u32, u32, CellId)> + 'a {
    let cells = sheet_cells.get(&range.sheet()).map_or(&[][..], |v| v);
    range_slice(cells, range)
        .iter()
        .filter(move |&&(_, col, _)| col >= range.start_col() && col <= range.end_col())
        .copied()
}

/// Merge two completeness values: Incomplete wins.
pub(super) fn merge_completeness(
    a: AnalysisCompleteness,
    b: AnalysisCompleteness,
) -> AnalysisCompleteness {
    if a == AnalysisCompleteness::Incomplete || b == AnalysisCompleteness::Incomplete {
        AnalysisCompleteness::Incomplete
    } else {
        AnalysisCompleteness::Exact
    }
}
