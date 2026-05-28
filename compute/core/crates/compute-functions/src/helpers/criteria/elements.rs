use value_types::CellValue;

/// If `val` is a multi-element array, returns the flattened elements along with
/// the array shape `(nrows, ncols)` so the caller can reconstruct the output
/// array with matching shape.
///
/// Returns `None` for scalar values or single-element arrays (these should use
/// the normal scalar `parse_criteria` path).
pub fn extract_criteria_elements(val: &CellValue) -> Option<(Vec<&CellValue>, usize, usize)> {
    match val {
        CellValue::Array(arr) => {
            let nrows = arr.rows();
            let ncols = arr.cols();
            if nrows * ncols <= 1 {
                return None;
            }
            let elems: Vec<&CellValue> = arr.iter().collect();
            Some((elems, nrows, ncols))
        }
        _ => None,
    }
}
