use formula_types::IdentityFormulaRef;

use super::coords::shift_coord;
use super::{MAX_COLS, MAX_ROWS, RefPosition};
use crate::types::AdjustedRef;

/// Adjust a single formula ref, producing an [`AdjustedRef`].
pub(super) fn adjust_single_ref(
    ref_index: usize,
    formula_ref: &IdentityFormulaRef,
    pos: &RefPosition,
    row_delta: i64,
    col_delta: i64,
) -> AdjustedRef {
    match (formula_ref, pos) {
        (IdentityFormulaRef::Cell(cell_ref), RefPosition::Cell { row, col }) => {
            let target_row = shift_coord(*row, row_delta, cell_ref.row_absolute, MAX_ROWS);
            let target_col = shift_coord(*col, col_delta, cell_ref.col_absolute, MAX_COLS);
            AdjustedRef {
                ref_index,
                target_row: target_row.value,
                target_col: target_col.value,
                target_end_row: None,
                target_end_col: None,
                out_of_bounds: target_row.out_of_bounds || target_col.out_of_bounds,
            }
        }

        (
            IdentityFormulaRef::Range(range_ref),
            RefPosition::Range {
                start_row,
                start_col,
                end_row,
                end_col,
            },
        ) => {
            let start_row = shift_coord(
                *start_row,
                row_delta,
                range_ref.start_row_absolute,
                MAX_ROWS,
            );
            let start_col = shift_coord(
                *start_col,
                col_delta,
                range_ref.start_col_absolute,
                MAX_COLS,
            );
            let end_row = shift_coord(*end_row, row_delta, range_ref.end_row_absolute, MAX_ROWS);
            let end_col = shift_coord(*end_col, col_delta, range_ref.end_col_absolute, MAX_COLS);
            AdjustedRef {
                ref_index,
                target_row: start_row.value,
                target_col: start_col.value,
                target_end_row: Some(end_row.value),
                target_end_col: Some(end_col.value),
                out_of_bounds: start_row.out_of_bounds
                    || start_col.out_of_bounds
                    || end_row.out_of_bounds
                    || end_col.out_of_bounds,
            }
        }

        (IdentityFormulaRef::FullRow(row_ref), RefPosition::FullRow { row }) => {
            let target_row = shift_coord(*row, row_delta, row_ref.absolute, MAX_ROWS);
            AdjustedRef {
                ref_index,
                target_row: target_row.value,
                target_col: 0,
                target_end_row: None,
                target_end_col: None,
                out_of_bounds: target_row.out_of_bounds,
            }
        }

        (
            IdentityFormulaRef::RowRange(row_range_ref),
            RefPosition::RowRange { start_row, end_row },
        ) => {
            let start_row = shift_coord(
                *start_row,
                row_delta,
                row_range_ref.start_absolute,
                MAX_ROWS,
            );
            let end_row = shift_coord(*end_row, row_delta, row_range_ref.end_absolute, MAX_ROWS);
            AdjustedRef {
                ref_index,
                target_row: start_row.value,
                target_col: 0,
                target_end_row: Some(end_row.value),
                target_end_col: None,
                out_of_bounds: start_row.out_of_bounds || end_row.out_of_bounds,
            }
        }

        (IdentityFormulaRef::FullCol(col_ref), RefPosition::FullCol { col }) => {
            let target_col = shift_coord(*col, col_delta, col_ref.absolute, MAX_COLS);
            AdjustedRef {
                ref_index,
                target_row: 0,
                target_col: target_col.value,
                target_end_row: None,
                target_end_col: None,
                out_of_bounds: target_col.out_of_bounds,
            }
        }

        (
            IdentityFormulaRef::ColRange(col_range_ref),
            RefPosition::ColRange { start_col, end_col },
        ) => {
            let start_col = shift_coord(
                *start_col,
                col_delta,
                col_range_ref.start_absolute,
                MAX_COLS,
            );
            let end_col = shift_coord(*end_col, col_delta, col_range_ref.end_absolute, MAX_COLS);
            AdjustedRef {
                ref_index,
                target_row: 0,
                target_col: start_col.value,
                target_end_row: None,
                target_end_col: Some(end_col.value),
                out_of_bounds: start_col.out_of_bounds || end_col.out_of_bounds,
            }
        }

        _ => mismatch_adjusted_ref(ref_index),
    }
}

fn mismatch_adjusted_ref(ref_index: usize) -> AdjustedRef {
    AdjustedRef {
        ref_index,
        target_row: 0,
        target_col: 0,
        target_end_row: None,
        target_end_col: None,
        out_of_bounds: true,
    }
}
