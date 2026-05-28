use std::sync::Arc;

use value_types::{CellArray, CellError, CellValue};

use super::common::cell_value_cmp_sort;
use crate::PureFunction;
use crate::helpers::coercion::flatten_values;

pub(in crate::lookup) struct FnSortBy;

impl PureFunction for FnSortBy {
    fn name(&self) -> &'static str {
        "SORTBY"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        if index >= 2 && index.is_multiple_of(2) {
            Some(CellValue::number(1.0))
        } else {
            None
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let rows = match &args[0] {
            CellValue::Array(r) => Arc::clone(r),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => Arc::new(CellArray::new(vec![other.clone()], 1)),
        };
        if rows.is_empty() {
            return CellValue::Array(rows);
        }

        let num_rows = rows.rows();
        let num_cols = rows.cols();

        let mut sort_keys: Vec<(Vec<CellValue>, i32)> = Vec::new();
        let mut i = 1;
        while i < args.len() {
            let by_flat = flatten_values(&[args[i].clone()]);
            let order = if i + 1 < args.len() {
                match args[i + 1].coerce_to_number() {
                    Ok(n) => {
                        let o = n as i32;
                        i += 2;
                        o
                    }
                    Err(_) => {
                        i += 1;
                        1
                    }
                }
            } else {
                i += 1;
                1
            };
            sort_keys.push((by_flat, order));
        }

        if sort_keys.is_empty() {
            return CellValue::Array(rows);
        }

        let is_horizontal =
            num_rows == 1 && num_cols > 1 && sort_keys.iter().all(|(key, _)| key.len() == num_cols);

        if is_horizontal {
            let mut col_indices: Vec<usize> = (0..num_cols).collect();
            col_indices.sort_by(|&a, &b| {
                for (key, order) in &sort_keys {
                    let cmp = cell_value_cmp_sort(&key[a], &key[b]);
                    if cmp != 0 {
                        let directed = if *order < 0 { -cmp } else { cmp };
                        return if directed < 0 {
                            std::cmp::Ordering::Less
                        } else {
                            std::cmp::Ordering::Greater
                        };
                    }
                }
                std::cmp::Ordering::Equal
            });

            let result: Vec<Vec<CellValue>> = rows
                .rows_iter()
                .map(|row| {
                    col_indices
                        .iter()
                        .map(|&ci| row.get(ci).cloned().unwrap_or(CellValue::Null))
                        .collect()
                })
                .collect();
            CellValue::from_rows(result)
        } else {
            for (key, _) in &sort_keys {
                if key.len() != num_rows {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!(
                            "SORTBY: by_array length ({}) does not match array row count ({num_rows})",
                            key.len()
                        ),
                    );
                }
            }

            let mut indices: Vec<usize> = (0..num_rows).collect();
            indices.sort_by(|&a, &b| {
                for (key, order) in &sort_keys {
                    let cmp = cell_value_cmp_sort(&key[a], &key[b]);
                    if cmp != 0 {
                        let directed = if *order < 0 { -cmp } else { cmp };
                        return if directed < 0 {
                            std::cmp::Ordering::Less
                        } else {
                            std::cmp::Ordering::Greater
                        };
                    }
                }
                std::cmp::Ordering::Equal
            });

            let sorted: Vec<Vec<CellValue>> =
                indices.iter().map(|&i| rows.row(i).to_vec()).collect();
            CellValue::from_rows(sorted)
        }
    }
}
