use super::*;

use crate::positions::{AnalysisCompleteness, CellPosition, HypotheticalDependencyEdit};
use rustc_hash::{FxHashMap, FxHashSet};

mod fixtures;

mod algorithms;
mod cell_cycles;
mod cell_order;
mod cycle_reporting;
mod empty_graph;
mod evaluation_levels;
mod hypothetical_edits;
mod max_depth;
mod range_cycles;
mod range_order;
mod scale;
mod unpositioned_regressions;
mod volatile_regressions;

use fixtures::*;

// Recalc topology contract tests cover cycle detection, ordering, levels,
// hypothetical edits, range-aware behavior, volatile cells, and helper algorithms.
