use value_types::{CellError, CellValue};

use super::common::{cell_value_cmp_sort, to_array};
use crate::PureFunction;

pub(in crate::lookup) struct FnSort;

impl PureFunction for FnSort {
    fn name(&self) -> &'static str {
        "SORT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(1.0)),
            2 => Some(CellValue::number(1.0)),
            3 => Some(CellValue::Boolean(false)),
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let rows = match to_array(&args[0]) {
            Ok(a) => a,
            Err(e) => return CellValue::Error(e, None),
        };
        if rows.is_empty() {
            return CellValue::Array(rows);
        }

        let sort_index = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };

        let sort_order = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };

        let by_col = if args.len() > 3 {
            match &args[3] {
                CellValue::Boolean(b) => *b,
                CellValue::Number(n) => n.get() != 0.0,
                CellValue::Null => false,
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                _ => false,
            }
        } else {
            false
        };

        if by_col {
            let num_rows = rows.rows();
            let num_cols = rows.cols();
            let key_row = (sort_index - 1) as usize;
            if key_row >= num_rows {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("SORT: sort_index ({sort_index}) exceeds number of rows ({num_rows})"),
                );
            }

            let mut col_indices: Vec<usize> = (0..num_cols).collect();
            col_indices.sort_by(|&a, &b| {
                let va = rows.get(key_row, a).unwrap_or(&CellValue::Null);
                let vb = rows.get(key_row, b).unwrap_or(&CellValue::Null);
                let cmp = cell_value_cmp_sort(va, vb);
                let directed = if sort_order < 0 { -cmp } else { cmp };
                if directed < 0 {
                    std::cmp::Ordering::Less
                } else if directed > 0 {
                    std::cmp::Ordering::Greater
                } else {
                    std::cmp::Ordering::Equal
                }
            });

            let result: Vec<Vec<CellValue>> = (0..num_rows)
                .map(|ri| {
                    col_indices
                        .iter()
                        .map(|&ci| rows.get(ri, ci).cloned().unwrap_or(CellValue::Null))
                        .collect()
                })
                .collect();
            CellValue::from_rows(result)
        } else {
            let key_col = (sort_index - 1) as usize;
            if key_col >= rows.cols() {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!(
                        "SORT: sort_index ({sort_index}) exceeds number of columns ({})",
                        rows.cols()
                    ),
                );
            }

            let mut indices: Vec<usize> = (0..rows.rows()).collect();
            indices.sort_by(|&a, &b| {
                let va = rows.row(a).get(key_col).unwrap_or(&CellValue::Null);
                let vb = rows.row(b).get(key_col).unwrap_or(&CellValue::Null);
                let cmp = cell_value_cmp_sort(va, vb);
                let directed = if sort_order < 0 { -cmp } else { cmp };
                if directed < 0 {
                    std::cmp::Ordering::Less
                } else if directed > 0 {
                    std::cmp::Ordering::Greater
                } else {
                    std::cmp::Ordering::Equal
                }
            });

            let sorted: Vec<Vec<CellValue>> =
                indices.iter().map(|&i| rows.row(i).to_vec()).collect();
            CellValue::from_rows(sorted)
        }
    }
}
