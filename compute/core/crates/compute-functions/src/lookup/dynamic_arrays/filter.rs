use value_types::{CellError, CellValue};

use super::common::{is_truthy, to_array};
use crate::PureFunction;

pub(in crate::lookup) struct FnFilter;

impl PureFunction for FnFilter {
    fn name(&self) -> &'static str {
        "FILTER"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let array = match to_array(&args[0]) {
            Ok(a) => a,
            Err(e) => return CellValue::Error(e, None),
        };
        let include = match to_array(&args[1]) {
            Ok(a) => a,
            Err(e) => return CellValue::Error(e, None),
        };
        let if_empty = args.get(2);

        if array.is_empty() {
            return CellValue::Array(array);
        }

        let num_rows = array.rows();
        let num_cols = array.cols();
        let inc_rows = include.rows();
        let inc_cols = include.cols();

        if inc_cols == 1 && inc_rows == num_rows {
            let mut result = Vec::new();
            for ri in 0..num_rows {
                let val = include.get(ri, 0).unwrap_or(&CellValue::Null);
                if is_truthy(val) {
                    result.push(array.row(ri).to_vec());
                }
            }
            if result.is_empty() {
                return match if_empty {
                    Some(v) => v.clone(),
                    None => CellValue::error_with_message(
                        CellError::Calc,
                        "FILTER: no rows matched the filter criteria".to_string(),
                    ),
                };
            }
            CellValue::from_rows(result)
        } else if inc_rows == 1 && inc_cols == num_cols {
            let mask: Vec<bool> = include.row(0).iter().map(is_truthy).collect();
            let mut result = Vec::with_capacity(num_rows);
            for row in array.rows_iter() {
                let filtered: Vec<CellValue> = row
                    .iter()
                    .zip(mask.iter())
                    .filter(|&(_, &keep)| keep)
                    .map(|(v, _)| v.clone())
                    .collect();
                result.push(filtered);
            }
            if result.is_empty() || result[0].is_empty() {
                return match if_empty {
                    Some(v) => v.clone(),
                    None => CellValue::error_with_message(
                        CellError::Calc,
                        "FILTER: no columns matched the filter criteria".to_string(),
                    ),
                };
            }
            CellValue::from_rows(result)
        } else if inc_rows == num_rows && inc_cols == num_cols {
            let mut result = Vec::new();
            for ri in 0..num_rows {
                let any_true = include.row(ri).iter().any(is_truthy);
                if any_true {
                    result.push(array.row(ri).to_vec());
                }
            }
            if result.is_empty() {
                return match if_empty {
                    Some(v) => v.clone(),
                    None => CellValue::error_with_message(
                        CellError::Calc,
                        "FILTER: no rows matched the filter criteria".to_string(),
                    ),
                };
            }
            CellValue::from_rows(result)
        } else {
            CellValue::error_with_message(
                CellError::Value,
                format!(
                    "FILTER: include array dimensions ({inc_rows}x{inc_cols}) do not match data array ({num_rows}x{num_cols})"
                ),
            )
        }
    }
}
