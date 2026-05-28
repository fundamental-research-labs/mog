//! Fill engine — orchestrates pattern detection, series generation, formula
//! adjustment, and format copying into a unified [`FillResult`].
//!
//! Pure function — no mutation, no storage access. The caller provides all
//! needed data via [`FillInput`].

use crate::engine_emitter::{EmissionState, emit_target};
use crate::engine_lanes::build_lane_plans;
use crate::engine_policy::{FillPolicy, copy_pattern};
use crate::engine_targets::{target_cells, target_merge_warning};
use crate::types::*;

/// Compute all fill updates. Pure function — no mutation, no storage access.
/// The caller provides all needed data via [`FillInput`].
pub fn compute_fill(input: &FillInput) -> FillResult {
    if input.source_cells.is_empty() {
        return FillResult {
            updates: Vec::new(),
            detected_pattern: copy_pattern(),
            filled_cell_count: 0,
            warnings: Vec::new(),
        };
    }

    let policy = FillPolicy::from_request(input.request.mode, &input.request);
    let mut lanes = build_lane_plans(input);
    let detected_pattern = lanes.detected_pattern();
    let mut warnings = Vec::new();
    if let Some(warning) = target_merge_warning(input) {
        warnings.push(warning);
    }
    let mut state = EmissionState::new(warnings);

    for target in target_cells(input) {
        emit_target(input, &policy, &mut lanes, target, &mut state);
    }

    state.sort_updates();

    FillResult {
        updates: state.updates,
        detected_pattern,
        filled_cell_count: state.filled_cell_count,
        warnings: state.warnings,
    }
}
