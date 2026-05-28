use std::hash::{Hash, Hasher};
use std::sync::Arc;

use rustc_hash::FxHashMap;
use value_types::{CellArray, CellError, CellValue};

use super::common::{rows_equal, to_array};
use crate::PureFunction;

pub(in crate::lookup) struct FnUnique;

impl PureFunction for FnUnique {
    fn name(&self) -> &'static str {
        "UNIQUE"
    }
    fn min_args(&self) -> usize {
        1
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
        if array.is_empty() {
            return CellValue::Array(array);
        }

        let array: Arc<CellArray> = {
            let cols = array.cols();
            let coerced: Vec<CellValue> = array
                .iter()
                .map(|v| match v {
                    CellValue::Null => CellValue::number(0.0),
                    other => other.clone(),
                })
                .collect();
            Arc::new(CellArray::new(coerced, cols))
        };

        let by_col = if args.len() > 1 {
            match &args[1] {
                CellValue::Boolean(b) => *b,
                CellValue::Number(n) => n.get() != 0.0,
                CellValue::Null => false,
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                _ => false,
            }
        } else {
            false
        };

        let exactly_once = if args.len() > 2 {
            match &args[2] {
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
            let num_rows = array.rows();
            let num_cols = array.cols();

            let columns: Vec<Vec<CellValue>> = (0..num_cols)
                .map(|ci| {
                    (0..num_rows)
                        .map(|ri| array.get(ri, ci).cloned().unwrap_or(CellValue::Null))
                        .collect()
                })
                .collect();

            let selected = if exactly_once {
                let mut buckets: FxHashMap<u64, Vec<usize>> = FxHashMap::default();
                for (i, col) in columns.iter().enumerate() {
                    let h = hash_row_ci(col);
                    buckets.entry(h).or_default().push(i);
                }
                let mut result_indices = Vec::new();
                for (i, col) in columns.iter().enumerate() {
                    let h = hash_row_ci(col);
                    let bucket = &buckets[&h];
                    let count = bucket
                        .iter()
                        .filter(|&&j| rows_equal(&columns[j], col))
                        .count();
                    if count == 1 {
                        result_indices.push(i);
                    }
                }
                result_indices
            } else {
                let mut seen: FxHashMap<u64, Vec<usize>> = FxHashMap::default();
                let mut result_indices = Vec::new();
                for (i, col) in columns.iter().enumerate() {
                    let h = hash_row_ci(col);
                    let bucket = seen.entry(h).or_default();
                    let is_dup = bucket.iter().any(|&j| rows_equal(&columns[j], col));
                    if !is_dup {
                        bucket.push(i);
                        result_indices.push(i);
                    }
                }
                result_indices
            };

            if selected.is_empty() {
                return CellValue::error_with_message(
                    CellError::Calc,
                    "UNIQUE: no unique columns found".to_string(),
                );
            }

            let result: Vec<Vec<CellValue>> = (0..num_rows)
                .map(|ri| {
                    selected
                        .iter()
                        .map(|&ci| array.get(ri, ci).cloned().unwrap_or(CellValue::Null))
                        .collect()
                })
                .collect();
            CellValue::from_rows(result)
        } else {
            let rows_vec: Vec<Vec<CellValue>> = array.rows_iter().map(|r| r.to_vec()).collect();

            let selected = if exactly_once {
                let mut buckets: FxHashMap<u64, Vec<usize>> = FxHashMap::default();
                for (i, row) in rows_vec.iter().enumerate() {
                    let h = hash_row_ci(row);
                    buckets.entry(h).or_default().push(i);
                }
                let mut result_indices = Vec::new();
                for (i, row) in rows_vec.iter().enumerate() {
                    let h = hash_row_ci(row);
                    let bucket = &buckets[&h];
                    let count = bucket
                        .iter()
                        .filter(|&&j| rows_equal(&rows_vec[j], row))
                        .count();
                    if count == 1 {
                        result_indices.push(i);
                    }
                }
                result_indices
            } else {
                let mut seen: FxHashMap<u64, Vec<usize>> = FxHashMap::default();
                let mut result_indices = Vec::new();
                let rows_vec: Vec<Vec<CellValue>> = array.rows_iter().map(|r| r.to_vec()).collect();
                for (i, row) in rows_vec.iter().enumerate() {
                    let h = hash_row_ci(row);
                    let bucket = seen.entry(h).or_default();
                    let is_dup = bucket.iter().any(|&j| rows_equal(&rows_vec[j], row));
                    if !is_dup {
                        bucket.push(i);
                        result_indices.push(i);
                    }
                }
                result_indices
            };

            if selected.is_empty() {
                return CellValue::error_with_message(
                    CellError::Calc,
                    "UNIQUE: no unique rows found".to_string(),
                );
            }

            let result: Vec<Vec<CellValue>> =
                selected.iter().map(|&i| array.row(i).to_vec()).collect();
            CellValue::from_rows(result)
        }
    }
}

fn hash_cell_value_ci(v: &CellValue, hasher: &mut impl Hasher) {
    match v {
        CellValue::Number(n) => {
            0u8.hash(hasher);
            n.get().to_bits().hash(hasher);
        }
        CellValue::Text(s) => {
            1u8.hash(hasher);
            for c in s.chars().flat_map(|c| c.to_lowercase()) {
                c.hash(hasher);
            }
        }
        CellValue::Boolean(b) => {
            2u8.hash(hasher);
            b.hash(hasher);
        }
        CellValue::Null => {
            3u8.hash(hasher);
        }
        CellValue::Error(e, _) => {
            4u8.hash(hasher);
            e.hash(hasher);
        }
        CellValue::Array(rows) => {
            5u8.hash(hasher);
            rows.len().hash(hasher);
        }
        CellValue::Control(c) => {
            2u8.hash(hasher);
            c.value.hash(hasher);
        }
        CellValue::Image(image) => {
            6u8.hash(hasher);
            image.source.hash(hasher);
            image.alt_text.hash(hasher);
            image.sizing.hash(hasher);
            image.height.hash(hasher);
            image.width.hash(hasher);
        }
    }
}

fn hash_row_ci(row: &[CellValue]) -> u64 {
    let mut hasher = rustc_hash::FxHasher::default();
    row.len().hash(&mut hasher);
    for v in row {
        hash_cell_value_ci(v, &mut hasher);
    }
    hasher.finish()
}
