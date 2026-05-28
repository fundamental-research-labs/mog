//! Recalculation engine — top-level recalc entry points and topo evaluation pass.
//!
//! Input processing, formula registration, level evaluation, spill handling, and
//! cycle detection have been extracted into sibling modules (`formula_reg`,
//! `level_eval`, `spill`, `cycles`).

use super::*;

mod cache_invalidation;
mod entrypoints;
mod full;
mod incremental;
mod passes;
mod prepass_integration;
mod result;
mod selective_fixup;
mod session;

pub(super) use session::{Deadline, clear_thread_local_caches, make_deadline, past_deadline};

#[cfg(test)]
pub(super) use entrypoints::set_recalc_options_panic_before_full_recalc_for_tests;

/// Result tuple from topo evaluation: (changes, projections, errors, projection_deltas, deferred_cells).
type TopoEvalResult = (
    Vec<CellChange>,
    Vec<ProjectionChange>,
    Vec<CellErrorInfo>,
    Vec<ProjectionDelta>,
    Vec<CellId>,
);

/// Result tuple from pre-leveled evaluation: (changes, projections, errors, projection_deltas).
type PreLeveledEvalResult = (
    Vec<CellChange>,
    Vec<ProjectionChange>,
    Vec<CellErrorInfo>,
    Vec<ProjectionDelta>,
);
