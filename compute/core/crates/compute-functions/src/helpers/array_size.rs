//! Size limit for arrays a function builds from its arguments.

use cell_types::{MAX_COLS, MAX_ROWS};
use value_types::{CellError, CellValue};

/// Most cells a function may build into one result array.
pub const MAX_ARRAY_CELLS: u64 = 2_000_000;

/// `#CALC!` when a `rows` x `cols` result would not fit on a sheet or would
/// hold more than [`MAX_ARRAY_CELLS`] cells.
///
/// Call it before allocating: the dimensions come straight from arguments,
/// as in `SEQUENCE(1E9)`.
pub fn check_array_size(name: &str, rows: u64, cols: u64) -> Option<CellValue> {
    let fits = rows <= u64::from(MAX_ROWS)
        && cols <= u64::from(MAX_COLS)
        && rows * cols <= MAX_ARRAY_CELLS;
    (!fits).then(|| {
        CellValue::error_with_message(
            CellError::Calc,
            format!("{name}: dimensions {rows}x{cols} too large"),
        )
    })
}
