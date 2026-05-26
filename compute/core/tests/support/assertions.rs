//! Assertion helpers for the iterative-recalc unit-test suite.
//!
//! All helpers return `Result<(), String>` with descriptive messages so
//! the class runners can collect failure counts rather than panicking
//! on the first diff. The user asked for pass/fail totals — panicking
//! helpers would defeat that.
//!
//! Stage 1 exposes:
//! - [`assert_bit_identity_f64`] — Class III bitwise equality.
//! - [`assert_identity_after_op_inverse`] — Class I
//!   op+inverse → original-value invariant. Signature is the stable
//!   API; Stage 2 fleshes out the internal capture/compare logic as
//!   the engine API pieces (`cell_id` lookup, targeted read) harden.

use cell_types::{CellId, SheetId};
use compute_core::storage::engine::YrsComputeEngine;
use value_types::CellValue;

/// Compare two `f64` values for bitwise identity.
///
/// Used by Class III. The error message is deliberately rich — it
/// prints the bit patterns so a failing case can be pinpointed without
/// re-running under `--nocapture`.
pub fn assert_bit_identity_f64(before: f64, after: f64) -> Result<(), String> {
    if before.to_bits() == after.to_bits() {
        Ok(())
    } else {
        Err(format!(
            "bit-identity f64: before={} (bits=0x{:016x}) after={} (bits=0x{:016x})",
            before,
            before.to_bits(),
            after,
            after.to_bits(),
        ))
    }
}

/// Capture the pre-op value at a target cell, apply (set → set-back),
/// and assert the target cell's value returns to the pre-op state.
///
/// Signature is the Stage 1 interface; this returns an error rather
/// than panicking so the driver can count failures.
///
/// # Arguments
/// * `engine` — mutable engine, typically freshly hydrated via
///   `YrsComputeEngine::from_snapshot`.
/// * `sheet_id` — sheet containing the edited cell.
/// * `target_cell` — cell we're editing (the "dependency source").
/// * `target_row`, `target_col` — the cell's grid position. We need
///   both the CellId (for mirror lookup) and row/col (for `set_cell`'s
///   address arguments).
/// * `new_input` — the forward-op input string.
/// * `prior_input` — the inverse input string (what the cell read as
///   text before the op).
/// * `dependent_cell` — cell we inspect after op+inverse. This is the
///   load-bearing check: a dependent formula's value must return to
///   exactly what it was pre-op.
pub fn assert_identity_after_op_inverse(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    target_cell: &CellId,
    target_row: u32,
    target_col: u32,
    new_input: &str,
    prior_input: &str,
    dependent_cell: &CellId,
) -> Result<(), String> {
    // Capture pre-op value of the dependent.
    let before = engine
        .mirror()
        .get_cell_value(dependent_cell)
        .cloned()
        .unwrap_or(CellValue::Null);

    // Forward op.
    engine
        .set_cell(
            sheet_id,
            *target_cell,
            target_row,
            target_col,
            new_input.into(),
        )
        .map_err(|e| format!("forward set_cell failed: {:?}", e))?;

    // Inverse op.
    engine
        .set_cell(
            sheet_id,
            *target_cell,
            target_row,
            target_col,
            prior_input.into(),
        )
        .map_err(|e| format!("inverse set_cell failed: {:?}", e))?;

    // Post-inverse value of the dependent.
    let after = engine
        .mirror()
        .get_cell_value(dependent_cell)
        .cloned()
        .unwrap_or(CellValue::Null);

    if before == after {
        Ok(())
    } else {
        Err(format!(
            "dependent drift: before={:?} after={:?} (forward={:?}, inverse={:?})",
            before, after, new_input, prior_input,
        ))
    }
}
