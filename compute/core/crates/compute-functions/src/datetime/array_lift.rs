// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use value_types::{CellError, CellValue};

pub(super) fn array_dims(val: &CellValue) -> Option<(usize, usize)> {
    match val {
        CellValue::Array(arr) => Some((arr.rows(), arr.cols())),
        _ => None,
    }
}

/// Index into a CellValue: if it's an array, return the element at (row, col);
/// if it's a scalar, return a clone (broadcast). Out-of-bounds returns #N/A.
pub(super) fn array_get(val: &CellValue, row: usize, col: usize) -> CellValue {
    match val {
        CellValue::Array(arr) => arr
            .get(row, col)
            .cloned()
            .unwrap_or(CellValue::Error(CellError::Na, None)),
        other => other.clone(),
    }
}

/// Check if any value in the slice is a CellValue::Array.
pub(super) fn has_any_array(args: &[CellValue]) -> bool {
    args.iter().any(|a| matches!(a, CellValue::Array(_)))
}

/// Compute the broadcast dimensions (max rows, max cols) across all array args.
pub(super) fn broadcast_dims(args: &[CellValue]) -> (usize, usize) {
    args.iter()
        .filter_map(array_dims)
        .fold((1, 1), |(r, c), (ar, ac)| (r.max(ar), c.max(ac)))
}
