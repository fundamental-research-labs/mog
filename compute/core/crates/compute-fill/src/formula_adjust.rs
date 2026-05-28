//! Formula reference adjustment for autofill operations.
//!
//! Adjusts formula references when filling/copying formulas to new positions.
//! This is a pure computation module — no mutation, no CellId creation.
//!
//! # Rules
//!
//! - Absolute refs (`$A$1`) are NOT shifted — they keep their original position.
//! - Relative refs (`A1`) ARE shifted by the delta between source and target cells.
//! - Mixed refs (`$A1`, `A$1`) shift only the relative component.
//! - If a shifted position falls outside the grid (negative or >= MAX), the ref
//!   is marked `out_of_bounds = true` and retains its original position.

mod coords;
mod shapes;

#[cfg(test)]
mod tests;

use formula_types::IdentityFormula;

use crate::types::AdjustedRef;

/// Maximum number of rows in the grid (Excel standard: 2^20).
pub const MAX_ROWS: u32 = 1_048_576;

/// Maximum number of columns in the grid (Excel standard: 2^14).
pub const MAX_COLS: u32 = 16_384;

/// Position data for a formula ref, pre-resolved by the bridge caller.
///
/// Each variant corresponds to a [`formula_types::IdentityFormulaRef`] variant
/// and carries the current positional coordinates that the identity IDs resolve to.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RefPosition {
    /// Single cell ref — current (row, col).
    Cell { row: u32, col: u32 },
    /// Cell range ref — current corners.
    Range {
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    },
    /// Single full-row ref (e.g. `1:1`).
    FullRow { row: u32 },
    /// Full-row range ref (e.g. `1:5`).
    RowRange { start_row: u32, end_row: u32 },
    /// Single full-column ref (e.g. `A:A`).
    FullCol { col: u32 },
    /// Full-column range ref (e.g. `A:C`).
    ColRange { start_col: u32, end_col: u32 },
}

/// Calculate adjusted positions for each ref in a formula.
///
/// Pure function — no mutation, no CellId creation.
///
/// # Arguments
///
/// * `formula` — the source formula whose refs will be adjusted.
/// * `source_pos` — `(row, col)` of the cell that owns the formula.
/// * `target_pos` — `(row, col)` of the cell where the formula will be placed.
/// * `ref_positions` — current positional coordinates for each ref in
///   `formula.refs`, pre-resolved by the caller. Must be the same length as
///   `formula.refs` and each entry must match the variant of the corresponding ref.
///
/// # Returns
///
/// One [`AdjustedRef`] per ref in the formula.
///
/// # Panics
///
/// Panics (debug-only) if `ref_positions.len() != formula.refs.len()`.
pub fn calculate_adjusted_positions(
    formula: &IdentityFormula,
    source_pos: (u32, u32),
    target_pos: (u32, u32),
    ref_positions: &[RefPosition],
) -> Vec<AdjustedRef> {
    debug_assert_eq!(
        formula.refs.len(),
        ref_positions.len(),
        "ref_positions length must match formula.refs length"
    );

    let row_delta = target_pos.0 as i64 - source_pos.0 as i64;
    let col_delta = target_pos.1 as i64 - source_pos.1 as i64;

    formula
        .refs
        .iter()
        .zip(ref_positions.iter())
        .enumerate()
        .map(|(i, (formula_ref, pos))| {
            shapes::adjust_single_ref(i, formula_ref, pos, row_delta, col_delta)
        })
        .collect()
}
