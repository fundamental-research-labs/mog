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

use formula_types::{IdentityFormula, IdentityFormulaRef};

use crate::types::AdjustedRef;

/// Maximum number of rows in the grid (Excel standard: 2^20).
pub const MAX_ROWS: u32 = 1_048_576;

/// Maximum number of columns in the grid (Excel standard: 2^14).
pub const MAX_COLS: u32 = 16_384;

/// Position data for a formula ref, pre-resolved by the bridge caller.
///
/// Each variant corresponds to an [`IdentityFormulaRef`] variant and carries
/// the current positional coordinates that the identity IDs resolve to.
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
        .map(|(i, (formula_ref, pos))| adjust_single_ref(i, formula_ref, pos, row_delta, col_delta))
        .collect()
}

/// Shift a single coordinate by `delta`, respecting the `absolute` flag.
///
/// Returns `(target_value, out_of_bounds)`. When out of bounds, `target_value`
/// is set to `original` (the unshifted value).
#[inline]
fn shift_coord(original: u32, delta: i64, absolute: bool, max: u32) -> (u32, bool) {
    if absolute {
        return (original, false);
    }
    let shifted = original as i64 + delta;
    if shifted < 0 || shifted >= max as i64 {
        (original, true)
    } else {
        (shifted as u32, false)
    }
}

/// Adjust a single formula ref, producing an [`AdjustedRef`].
fn adjust_single_ref(
    ref_index: usize,
    formula_ref: &IdentityFormulaRef,
    pos: &RefPosition,
    row_delta: i64,
    col_delta: i64,
) -> AdjustedRef {
    match (formula_ref, pos) {
        // ── Cell ref ────────────────────────────────────────────────
        (IdentityFormulaRef::Cell(cell_ref), RefPosition::Cell { row, col }) => {
            let (target_row, row_oob) =
                shift_coord(*row, row_delta, cell_ref.row_absolute, MAX_ROWS);
            let (target_col, col_oob) =
                shift_coord(*col, col_delta, cell_ref.col_absolute, MAX_COLS);
            AdjustedRef {
                ref_index,
                target_row,
                target_col,
                target_end_row: None,
                target_end_col: None,
                out_of_bounds: row_oob || col_oob,
            }
        }

        // ── Range ref ───────────────────────────────────────────────
        (
            IdentityFormulaRef::Range(range_ref),
            RefPosition::Range {
                start_row,
                start_col,
                end_row,
                end_col,
            },
        ) => {
            let (sr, sr_oob) = shift_coord(
                *start_row,
                row_delta,
                range_ref.start_row_absolute,
                MAX_ROWS,
            );
            let (sc, sc_oob) = shift_coord(
                *start_col,
                col_delta,
                range_ref.start_col_absolute,
                MAX_COLS,
            );
            let (er, er_oob) =
                shift_coord(*end_row, row_delta, range_ref.end_row_absolute, MAX_ROWS);
            let (ec, ec_oob) =
                shift_coord(*end_col, col_delta, range_ref.end_col_absolute, MAX_COLS);
            AdjustedRef {
                ref_index,
                target_row: sr,
                target_col: sc,
                target_end_row: Some(er),
                target_end_col: Some(ec),
                out_of_bounds: sr_oob || sc_oob || er_oob || ec_oob,
            }
        }

        // ── Full row ref (e.g. `1:1`) ──────────────────────────────
        (IdentityFormulaRef::FullRow(row_ref), RefPosition::FullRow { row }) => {
            let (target_row, oob) = shift_coord(*row, row_delta, row_ref.absolute, MAX_ROWS);
            AdjustedRef {
                ref_index,
                target_row,
                target_col: 0,
                target_end_row: None,
                target_end_col: None,
                out_of_bounds: oob,
            }
        }

        // ── Row range ref (e.g. `1:5`) ─────────────────────────────
        (IdentityFormulaRef::RowRange(rr_ref), RefPosition::RowRange { start_row, end_row }) => {
            let (sr, sr_oob) = shift_coord(*start_row, row_delta, rr_ref.start_absolute, MAX_ROWS);
            let (er, er_oob) = shift_coord(*end_row, row_delta, rr_ref.end_absolute, MAX_ROWS);
            AdjustedRef {
                ref_index,
                target_row: sr,
                target_col: 0,
                target_end_row: Some(er),
                target_end_col: None,
                out_of_bounds: sr_oob || er_oob,
            }
        }

        // ── Full col ref (e.g. `A:A`) ──────────────────────────────
        (IdentityFormulaRef::FullCol(col_ref), RefPosition::FullCol { col }) => {
            let (target_col, oob) = shift_coord(*col, col_delta, col_ref.absolute, MAX_COLS);
            AdjustedRef {
                ref_index,
                target_row: 0,
                target_col,
                target_end_row: None,
                target_end_col: None,
                out_of_bounds: oob,
            }
        }

        // ── Col range ref (e.g. `A:C`) ─────────────────────────────
        (IdentityFormulaRef::ColRange(cr_ref), RefPosition::ColRange { start_col, end_col }) => {
            let (sc, sc_oob) = shift_coord(*start_col, col_delta, cr_ref.start_absolute, MAX_COLS);
            let (ec, ec_oob) = shift_coord(*end_col, col_delta, cr_ref.end_absolute, MAX_COLS);
            AdjustedRef {
                ref_index,
                target_row: 0,
                target_col: sc,
                target_end_row: None,
                target_end_col: Some(ec),
                out_of_bounds: sc_oob || ec_oob,
            }
        }

        // ── Mismatched variant/position — defensive fallback ────────
        _ => AdjustedRef {
            ref_index,
            target_row: 0,
            target_col: 0,
            target_end_row: None,
            target_end_col: None,
            out_of_bounds: true,
        },
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::{CellId, ColId, RowId};
    use formula_types::{
        IdentityCellRef, IdentityColRangeRef, IdentityFormula, IdentityFormulaRef,
        IdentityFullColRef, IdentityFullRowRef, IdentityRangeRef, IdentityRowRangeRef,
    };

    // ── Helpers ─────────────────────────────────────────────────────

    fn cell_id(n: u128) -> CellId {
        CellId::from_raw(n)
    }
    fn row_id(n: u128) -> RowId {
        RowId::from_raw(n)
    }
    fn col_id(n: u128) -> ColId {
        ColId::from_raw(n)
    }

    fn make_cell_ref(id: u128, row_abs: bool, col_abs: bool) -> IdentityFormulaRef {
        IdentityFormulaRef::Cell(IdentityCellRef {
            id: cell_id(id),
            row_absolute: row_abs,
            col_absolute: col_abs,
        })
    }

    fn make_range_ref(
        start_id: u128,
        end_id: u128,
        sr_abs: bool,
        sc_abs: bool,
        er_abs: bool,
        ec_abs: bool,
    ) -> IdentityFormulaRef {
        IdentityFormulaRef::Range(IdentityRangeRef {
            start_id: cell_id(start_id),
            end_id: cell_id(end_id),
            start_row_absolute: sr_abs,
            start_col_absolute: sc_abs,
            end_row_absolute: er_abs,
            end_col_absolute: ec_abs,
        })
    }

    fn formula(refs: Vec<IdentityFormulaRef>) -> IdentityFormula {
        let template = refs
            .iter()
            .enumerate()
            .map(|(i, _)| format!("{{{i}}}"))
            .collect::<Vec<_>>()
            .join("+");
        IdentityFormula {
            template,
            refs,
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }
    }

    // ── 1. Simple relative ref shift (fill down) ────────────────────

    #[test]
    fn simple_relative_cell_ref_shift_down() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 0, col: 0 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (1, 0), &positions);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].ref_index, 0);
        assert_eq!(result[0].target_row, 1);
        assert_eq!(result[0].target_col, 0);
        assert!(!result[0].out_of_bounds);
        assert!(result[0].target_end_row.is_none());
    }

    // ── 2. Simple relative ref shift (fill right) ───────────────────

    #[test]
    fn simple_relative_cell_ref_shift_right() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 0, col: 0 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (0, 1), &positions);

        assert_eq!(result[0].target_row, 0);
        assert_eq!(result[0].target_col, 1);
        assert!(!result[0].out_of_bounds);
    }

    // ── 3. Absolute ref preserved ($A$1) ────────────────────────────

    #[test]
    fn absolute_ref_preserved() {
        let f = formula(vec![make_cell_ref(1, true, true)]);
        let positions = vec![RefPosition::Cell { row: 5, col: 3 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (10, 10), &positions);

        assert_eq!(result[0].target_row, 5);
        assert_eq!(result[0].target_col, 3);
        assert!(!result[0].out_of_bounds);
    }

    // ── 4. Mixed ref $A1 (col absolute, row relative) ───────────────

    #[test]
    fn mixed_ref_col_absolute() {
        let f = formula(vec![make_cell_ref(1, false, true)]); // $A1
        let positions = vec![RefPosition::Cell { row: 0, col: 0 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (3, 5), &positions);

        // Row shifts by 3, col stays at 0
        assert_eq!(result[0].target_row, 3);
        assert_eq!(result[0].target_col, 0);
        assert!(!result[0].out_of_bounds);
    }

    // ── 5. Mixed ref A$1 (row absolute, col relative) ───────────────

    #[test]
    fn mixed_ref_row_absolute() {
        let f = formula(vec![make_cell_ref(1, true, false)]); // A$1
        let positions = vec![RefPosition::Cell { row: 0, col: 0 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (3, 5), &positions);

        // Row stays at 0, col shifts by 5
        assert_eq!(result[0].target_row, 0);
        assert_eq!(result[0].target_col, 5);
        assert!(!result[0].out_of_bounds);
    }

    // ── 6. Out of bounds: row overflow ──────────────────────────────

    #[test]
    fn out_of_bounds_row_overflow() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell {
            row: MAX_ROWS - 1,
            col: 0,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (1, 0), &positions);

        assert!(result[0].out_of_bounds);
        // Original position preserved
        assert_eq!(result[0].target_row, MAX_ROWS - 1);
        assert_eq!(result[0].target_col, 0);
    }

    // ── 7. Out of bounds: col underflow (shift left past 0) ────────

    #[test]
    fn out_of_bounds_col_underflow() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 0, col: 0 }];

        // Fill left: source col=1, target col=0, delta=-1
        // Ref at col 0 would go to col -1 -> OOB
        let result = calculate_adjusted_positions(&f, (0, 1), (0, 0), &positions);

        assert!(result[0].out_of_bounds);
        assert_eq!(result[0].target_col, 0); // preserved
    }

    // ── 8. Out of bounds: row underflow ─────────────────────────────

    #[test]
    fn out_of_bounds_row_underflow() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 0, col: 0 }];

        let result = calculate_adjusted_positions(&f, (1, 0), (0, 0), &positions);

        assert!(result[0].out_of_bounds);
        assert_eq!(result[0].target_row, 0);
    }

    // ── 9. Out of bounds: col overflow ──────────────────────────────

    #[test]
    fn out_of_bounds_col_overflow() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell {
            row: 0,
            col: MAX_COLS - 1,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (0, 1), &positions);

        assert!(result[0].out_of_bounds);
        assert_eq!(result[0].target_col, MAX_COLS - 1);
    }

    // ── 10. Range ref: both corners shift ───────────────────────────

    #[test]
    fn range_ref_both_corners_shift() {
        let f = formula(vec![make_range_ref(1, 2, false, false, false, false)]);
        let positions = vec![RefPosition::Range {
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 3,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (2, 1), &positions);

        assert_eq!(result[0].target_row, 2);
        assert_eq!(result[0].target_col, 1);
        assert_eq!(result[0].target_end_row, Some(7));
        assert_eq!(result[0].target_end_col, Some(4));
        assert!(!result[0].out_of_bounds);
    }

    // ── 11. Range ref with mixed absolute ───────────────────────────

    #[test]
    fn range_ref_mixed_absolute() {
        // $A1:B$10 — start col absolute, end row absolute
        let f = formula(vec![make_range_ref(1, 2, false, true, true, false)]);
        let positions = vec![RefPosition::Range {
            start_row: 0,
            start_col: 0,
            end_row: 9,
            end_col: 1,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (3, 2), &positions);

        // start: row shifts +3, col stays (absolute)
        assert_eq!(result[0].target_row, 3);
        assert_eq!(result[0].target_col, 0);
        // end: row stays (absolute), col shifts +2
        assert_eq!(result[0].target_end_row, Some(9));
        assert_eq!(result[0].target_end_col, Some(3));
        assert!(!result[0].out_of_bounds);
    }

    // ── 12. Range ref: one corner out of bounds ─────────────────────

    #[test]
    fn range_ref_end_corner_out_of_bounds() {
        let f = formula(vec![make_range_ref(1, 2, false, false, false, false)]);
        let positions = vec![RefPosition::Range {
            start_row: 0,
            start_col: 0,
            end_row: MAX_ROWS - 1,
            end_col: 3,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (1, 0), &positions);

        assert!(result[0].out_of_bounds);
    }

    // ── 13. Multi-ref formula ───────────────────────────────────────

    #[test]
    fn multi_ref_formula_different_absolute_patterns() {
        let f = formula(vec![
            make_cell_ref(1, false, false), // A1 — fully relative
            make_cell_ref(2, true, true),   // $B$2 — fully absolute
            make_cell_ref(3, false, true),  // $C3 — col absolute
        ]);
        let positions = vec![
            RefPosition::Cell { row: 0, col: 0 },
            RefPosition::Cell { row: 1, col: 1 },
            RefPosition::Cell { row: 2, col: 2 },
        ];

        let result = calculate_adjusted_positions(&f, (0, 0), (5, 3), &positions);

        assert_eq!(result.len(), 3);

        // ref 0: relative -> shifts by (5, 3)
        assert_eq!(result[0].target_row, 5);
        assert_eq!(result[0].target_col, 3);
        assert!(!result[0].out_of_bounds);

        // ref 1: absolute -> no shift
        assert_eq!(result[1].target_row, 1);
        assert_eq!(result[1].target_col, 1);
        assert!(!result[1].out_of_bounds);

        // ref 2: col absolute, row relative -> row shifts, col stays
        assert_eq!(result[2].target_row, 7);
        assert_eq!(result[2].target_col, 2);
        assert!(!result[2].out_of_bounds);
    }

    // ── 14. FullRow ref: shifts row, no col ─────────────────────────

    #[test]
    fn full_row_ref_shifts_row() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row_id(1),
                absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::FullRow { row: 3 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (2, 5), &positions);

        assert_eq!(result[0].target_row, 5); // 3 + 2
        assert_eq!(result[0].target_col, 0); // no col for full-row
        assert!(!result[0].out_of_bounds);
    }

    // ── 15. FullRow ref: absolute stays fixed ───────────────────────

    #[test]
    fn full_row_ref_absolute() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row_id(1),
                absolute: true,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::FullRow { row: 3 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (10, 0), &positions);

        assert_eq!(result[0].target_row, 3); // stays
        assert!(!result[0].out_of_bounds);
    }

    // ── 16. FullCol ref: shifts col, no row ─────────────────────────

    #[test]
    fn full_col_ref_shifts_col() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col_id(1),
                absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::FullCol { col: 2 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (0, 3), &positions);

        assert_eq!(result[0].target_col, 5); // 2 + 3
        assert_eq!(result[0].target_row, 0);
        assert!(!result[0].out_of_bounds);
    }

    // ── 17. FullCol ref: absolute stays fixed ───────────────────────

    #[test]
    fn full_col_ref_absolute() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col_id(1),
                absolute: true,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::FullCol { col: 2 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (0, 10), &positions);

        assert_eq!(result[0].target_col, 2); // stays
        assert!(!result[0].out_of_bounds);
    }

    // ── 18. RowRange ref: shifts both rows ──────────────────────────

    #[test]
    fn row_range_ref_shifts_both_rows() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                start_row_id: row_id(1),
                end_row_id: row_id(2),
                start_absolute: false,
                end_absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::RowRange {
            start_row: 1,
            end_row: 5,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (3, 0), &positions);

        assert_eq!(result[0].target_row, 4); // 1 + 3
        assert_eq!(result[0].target_end_row, Some(8)); // 5 + 3
        assert!(!result[0].out_of_bounds);
    }

    // ── 19. RowRange ref: mixed absolute ────────────────────────────

    #[test]
    fn row_range_ref_mixed_absolute() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                start_row_id: row_id(1),
                end_row_id: row_id(2),
                start_absolute: true,
                end_absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::RowRange {
            start_row: 1,
            end_row: 5,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (3, 0), &positions);

        assert_eq!(result[0].target_row, 1); // absolute, stays
        assert_eq!(result[0].target_end_row, Some(8)); // relative, shifts
        assert!(!result[0].out_of_bounds);
    }

    // ── 20. ColRange ref: shifts both cols ──────────────────────────

    #[test]
    fn col_range_ref_shifts_both_cols() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::ColRange(IdentityColRangeRef {
                start_col_id: col_id(1),
                end_col_id: col_id(2),
                start_absolute: false,
                end_absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::ColRange {
            start_col: 0,
            end_col: 2,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (0, 4), &positions);

        assert_eq!(result[0].target_col, 4); // 0 + 4
        assert_eq!(result[0].target_end_col, Some(6)); // 2 + 4
        assert!(!result[0].out_of_bounds);
    }

    // ── 21. ColRange ref: mixed absolute ────────────────────────────

    #[test]
    fn col_range_ref_mixed_absolute() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::ColRange(IdentityColRangeRef {
                start_col_id: col_id(1),
                end_col_id: col_id(2),
                start_absolute: false,
                end_absolute: true,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::ColRange {
            start_col: 0,
            end_col: 2,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (0, 4), &positions);

        assert_eq!(result[0].target_col, 4); // relative, shifts
        assert_eq!(result[0].target_end_col, Some(2)); // absolute, stays
        assert!(!result[0].out_of_bounds);
    }

    // ── 22. Large delta ─────────────────────────────────────────────

    #[test]
    fn large_delta_correct_shift() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 0, col: 0 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (1000, 500), &positions);

        assert_eq!(result[0].target_row, 1000);
        assert_eq!(result[0].target_col, 500);
        assert!(!result[0].out_of_bounds);
    }

    // ── 23. Zero delta (source == target) ───────────────────────────

    #[test]
    fn zero_delta_no_change() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 5, col: 3 }];

        let result = calculate_adjusted_positions(&f, (2, 2), (2, 2), &positions);

        assert_eq!(result[0].target_row, 5);
        assert_eq!(result[0].target_col, 3);
        assert!(!result[0].out_of_bounds);
    }

    // ── 24. Negative delta (fill up) ────────────────────────────────

    #[test]
    fn negative_delta_fill_up() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 10, col: 5 }];

        let result = calculate_adjusted_positions(&f, (5, 0), (3, 0), &positions);

        // row_delta = 3 - 5 = -2
        assert_eq!(result[0].target_row, 8);
        assert_eq!(result[0].target_col, 5);
        assert!(!result[0].out_of_bounds);
    }

    // ── 25. Negative delta (fill left) ──────────────────────────────

    #[test]
    fn negative_delta_fill_left() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 0, col: 10 }];

        let result = calculate_adjusted_positions(&f, (0, 5), (0, 2), &positions);

        // col_delta = 2 - 5 = -3
        assert_eq!(result[0].target_row, 0);
        assert_eq!(result[0].target_col, 7);
        assert!(!result[0].out_of_bounds);
    }

    // ── 26. Dynamic array flag does not affect computation ──────────

    #[test]
    fn dynamic_array_flag_does_not_affect_computation() {
        let f = IdentityFormula {
            template: "SEQUENCE({0})".into(),
            refs: vec![make_cell_ref(1, false, false)],
            is_dynamic_array: true,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::Cell { row: 0, col: 0 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (2, 3), &positions);

        assert_eq!(result[0].target_row, 2);
        assert_eq!(result[0].target_col, 3);
        assert!(!result[0].out_of_bounds);
    }

    // ── 27. Empty formula (no refs) ─────────────────────────────────

    #[test]
    fn empty_formula_no_refs() {
        let f = IdentityFormula {
            template: "42".into(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions: Vec<RefPosition> = vec![];

        let result = calculate_adjusted_positions(&f, (0, 0), (5, 5), &positions);

        assert!(result.is_empty());
    }

    // ── 28. Row at exact MAX_ROWS boundary ──────────────────────────

    #[test]
    fn row_at_max_boundary_is_oob() {
        // A ref that would land exactly at MAX_ROWS (index == MAX_ROWS is invalid)
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell {
            row: MAX_ROWS - 2,
            col: 0,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (2, 0), &positions);

        // MAX_ROWS - 2 + 2 = MAX_ROWS -> out of bounds
        assert!(result[0].out_of_bounds);
    }

    // ── 29. Col at exact MAX_COLS boundary ──────────────────────────

    #[test]
    fn col_at_max_boundary_is_oob() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell {
            row: 0,
            col: MAX_COLS - 2,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (0, 2), &positions);

        assert!(result[0].out_of_bounds);
    }

    // ── 30. Row just below MAX_ROWS is valid ────────────────────────

    #[test]
    fn row_just_below_max_is_valid() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell {
            row: MAX_ROWS - 3,
            col: 0,
        }];

        let result = calculate_adjusted_positions(&f, (0, 0), (2, 0), &positions);

        // MAX_ROWS - 3 + 2 = MAX_ROWS - 1 -> valid
        assert!(!result[0].out_of_bounds);
        assert_eq!(result[0].target_row, MAX_ROWS - 1);
    }

    // ── 31. FullRow out of bounds ───────────────────────────────────

    #[test]
    fn full_row_out_of_bounds() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row_id(1),
                absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::FullRow { row: MAX_ROWS - 1 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (1, 0), &positions);

        assert!(result[0].out_of_bounds);
    }

    // ── 32. FullCol out of bounds ───────────────────────────────────

    #[test]
    fn full_col_out_of_bounds() {
        let f = IdentityFormula {
            template: "SUM({0})".into(),
            refs: vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col_id(1),
                absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![RefPosition::FullCol { col: MAX_COLS - 1 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (0, 1), &positions);

        assert!(result[0].out_of_bounds);
    }

    // ── 33. Ref indices are correct in multi-ref formula ────────────

    #[test]
    fn ref_indices_correct() {
        let f = formula(vec![
            make_cell_ref(1, false, false),
            make_cell_ref(2, false, false),
            make_cell_ref(3, false, false),
        ]);
        let positions = vec![
            RefPosition::Cell { row: 0, col: 0 },
            RefPosition::Cell { row: 1, col: 1 },
            RefPosition::Cell { row: 2, col: 2 },
        ];

        let result = calculate_adjusted_positions(&f, (0, 0), (1, 1), &positions);

        assert_eq!(result[0].ref_index, 0);
        assert_eq!(result[1].ref_index, 1);
        assert_eq!(result[2].ref_index, 2);
    }

    // ── 34. Mixed ref types in one formula ──────────────────────────

    #[test]
    fn mixed_ref_types_in_one_formula() {
        let f = IdentityFormula {
            template: "{0}+SUM({1})+{2}".into(),
            refs: vec![
                make_cell_ref(1, false, false),
                make_range_ref(2, 3, false, false, false, false),
                IdentityFormulaRef::FullRow(IdentityFullRowRef {
                    row_id: row_id(10),
                    absolute: false,
                }),
            ],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let positions = vec![
            RefPosition::Cell { row: 0, col: 0 },
            RefPosition::Range {
                start_row: 0,
                start_col: 0,
                end_row: 5,
                end_col: 2,
            },
            RefPosition::FullRow { row: 3 },
        ];

        let result = calculate_adjusted_positions(&f, (0, 0), (2, 1), &positions);

        assert_eq!(result.len(), 3);

        // Cell ref shifted
        assert_eq!(result[0].target_row, 2);
        assert_eq!(result[0].target_col, 1);

        // Range ref shifted
        assert_eq!(result[1].target_row, 2);
        assert_eq!(result[1].target_col, 1);
        assert_eq!(result[1].target_end_row, Some(7));
        assert_eq!(result[1].target_end_col, Some(3));

        // FullRow shifted
        assert_eq!(result[2].target_row, 5); // 3 + 2
    }

    // ── 35. Diagonal fill ───────────────────────────────────────────

    #[test]
    fn diagonal_fill_both_deltas() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        let positions = vec![RefPosition::Cell { row: 5, col: 5 }];

        // Fill diagonally: row +3, col +7
        let result = calculate_adjusted_positions(&f, (10, 10), (13, 17), &positions);

        assert_eq!(result[0].target_row, 8);
        assert_eq!(result[0].target_col, 12);
        assert!(!result[0].out_of_bounds);
    }

    // ── 36. Mismatched variant/position returns out_of_bounds ───────

    #[test]
    fn mismatched_variant_position_is_out_of_bounds() {
        let f = formula(vec![make_cell_ref(1, false, false)]);
        // Wrong position variant for a Cell ref
        let positions = vec![RefPosition::FullRow { row: 5 }];

        let result = calculate_adjusted_positions(&f, (0, 0), (1, 0), &positions);

        assert!(result[0].out_of_bounds);
    }
}
