//! Classic lookup functions: LOOKUP.

use value_types::{CellError, CellValue};

use super::helpers::{SearchMode, binary_search_skip_errors};
use crate::helpers::coercion::{check_error, flatten_values};
use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// LOOKUP
// ---------------------------------------------------------------------------

pub(super) struct FnLookup;
impl PureFunction for FnLookup {
    fn name(&self) -> &'static str {
        "LOOKUP"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let lookup = &args[0];
        if let Some(e) = check_error(lookup) {
            return e;
        }

        if args.len() == 3 {
            // Vector form: LOOKUP(lookup_value, lookup_vector, result_vector)
            let lookup_vec = flatten_values(&[args[1].clone()]);
            let result_vec = flatten_values(&[args[2].clone()]);

            // Approximate match: binary search for largest value <= lookup_value.
            // Errors are skipped — critical for LOOKUP(2, 1/condition, result) idiom.
            match binary_search_skip_errors(&lookup_vec, lookup, true, SearchMode::NextSmaller) {
                Some(i) => result_vec
                    .get(i)
                    .cloned()
                    .unwrap_or(CellValue::error_with_message(
                        CellError::Na,
                        "LOOKUP: result index out of range in result_vector".to_string(),
                    )),
                None => CellValue::error_with_message(
                    CellError::Na,
                    "LOOKUP: lookup value not found".to_string(),
                ),
            }
        } else {
            // Array form: LOOKUP(lookup_value, array)
            // Search first column/row, return value from last column/row
            let arr = match &args[1] {
                CellValue::Array(r) => r,
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                _ => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "LOOKUP: second argument must be an array".to_string(),
                    );
                }
            };
            if arr.is_empty() {
                return CellValue::error_with_message(
                    CellError::Na,
                    "LOOKUP: lookup array is empty".to_string(),
                );
            }
            let num_rows = arr.rows();
            let num_cols = arr.cols();

            if num_cols >= num_rows {
                // Search first row, return from last row
                let first_row: Vec<CellValue> = arr.row(0).to_vec();
                match binary_search_skip_errors(&first_row, lookup, true, SearchMode::NextSmaller) {
                    Some(ci) => {
                        arr.get(num_rows - 1, ci)
                            .cloned()
                            .unwrap_or(CellValue::error_with_message(
                                CellError::Na,
                                "LOOKUP: result index out of range".to_string(),
                            ))
                    }
                    None => CellValue::error_with_message(
                        CellError::Na,
                        "LOOKUP: lookup value not found".to_string(),
                    ),
                }
            } else {
                // Search first column, return from last column
                let first_col: Vec<CellValue> = arr.col_iter(0).cloned().collect();
                match binary_search_skip_errors(&first_col, lookup, true, SearchMode::NextSmaller) {
                    Some(ri) => {
                        arr.get(ri, num_cols - 1)
                            .cloned()
                            .unwrap_or(CellValue::error_with_message(
                                CellError::Na,
                                "LOOKUP: result index out of range".to_string(),
                            ))
                    }
                    None => CellValue::error_with_message(
                        CellError::Na,
                        "LOOKUP: lookup value not found".to_string(),
                    ),
                }
            }
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnLookup));
}
