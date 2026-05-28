use value_types::{CellArray, CellError, CellValue};

use super::super::helpers::cell_value_cmp;
use super::common::{cell_value_cmp_sort, to_array};
use crate::PureFunction;

pub(in crate::lookup) struct FnSortN;

impl PureFunction for FnSortN {
    fn name(&self) -> &'static str {
        "SORTN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(1.0)),
            2 => Some(CellValue::number(0.0)),
            _ if index >= 4 && index.is_multiple_of(2) => Some(CellValue::Boolean(true)),
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let range = match to_array(&args[0]) {
            Ok(a) => a,
            Err(e) => return CellValue::Error(e, None),
        };
        if range.is_empty() {
            return CellValue::Array(range);
        }

        let n = match args.get(1) {
            Some(v) => match v.coerce_to_number() {
                Ok(n) if n > 0.0 => n as usize,
                Ok(_) => return CellValue::Error(CellError::Value, None),
                Err(e) => return CellValue::Error(e, None),
            },
            None => 1,
        };
        let ties_mode = match args.get(2) {
            Some(v) => match v.coerce_to_number() {
                Ok(n) if (0.0..=3.0).contains(&n) => n as i32,
                Ok(_) => return CellValue::Error(CellError::Value, None),
                Err(e) => return CellValue::Error(e, None),
            },
            None => 0,
        };

        let explicit_sort_args = args.len().saturating_sub(3);
        if explicit_sort_args == 1 {
            return CellValue::Error(CellError::Value, None);
        }

        let mut sort_keys: Vec<(Vec<CellValue>, bool)> = Vec::new();
        let mut i = 3;
        while i < args.len() {
            let key = match sortn_key_values(&range, &args[i]) {
                Ok(key) => key,
                Err(error) => return error,
            };
            let ascending = if i + 1 < args.len() {
                match args[i + 1].coerce_to_bool() {
                    Ok(b) => b,
                    Err(e) => return CellValue::Error(e, None),
                }
            } else {
                true
            };
            sort_keys.push((key, ascending));
            i += 2;
        }

        if sort_keys.is_empty() {
            for c in 0..range.cols() {
                let key = (0..range.rows())
                    .map(|r| range.get(r, c).cloned().unwrap_or(CellValue::Null))
                    .collect();
                sort_keys.push((key, true));
            }
        }

        for (key, _) in &sort_keys {
            if key.len() != range.rows() {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!(
                        "SORTN: sort key length ({}) does not match range row count ({})",
                        key.len(),
                        range.rows()
                    ),
                );
            }
        }

        let mut indices: Vec<usize> = (0..range.rows()).collect();
        indices.sort_by(|&a, &b| {
            for (key, ascending) in &sort_keys {
                let cmp = cell_value_cmp_sort(&key[a], &key[b]);
                if cmp != 0 {
                    let directed = if *ascending { cmp } else { -cmp };
                    return if directed < 0 {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    };
                }
            }
            std::cmp::Ordering::Equal
        });

        let selected = match ties_mode {
            0 => indices.into_iter().take(n).collect(),
            1 => sortn_take_with_ties(indices, n, &sort_keys),
            2 => sortn_unique_first_n(indices, n, &range),
            3 => sortn_first_n_unique_with_duplicates(indices, n, &range),
            _ => unreachable!(),
        };

        if selected.is_empty() {
            return CellValue::Error(CellError::Calc, None);
        }
        let rows = selected.iter().map(|&r| range.row(r).to_vec()).collect();
        CellValue::from_rows(rows)
    }
}

fn sortn_key_values(range: &CellArray, arg: &CellValue) -> Result<Vec<CellValue>, CellValue> {
    match arg {
        CellValue::Number(n) => {
            let idx = n.get() as i32;
            if idx <= 0 || idx as usize > range.cols() {
                return Err(CellValue::Error(CellError::Value, None));
            }
            let col = (idx - 1) as usize;
            Ok((0..range.rows())
                .map(|r| range.get(r, col).cloned().unwrap_or(CellValue::Null))
                .collect())
        }
        CellValue::Array(arr) if arr.cols() == 1 => Ok(arr.iter().cloned().collect()),
        CellValue::Array(_) => Err(CellValue::Error(CellError::Value, None)),
        CellValue::Error(e, _) => Err(CellValue::Error(*e, None)),
        _ => Err(CellValue::Error(CellError::Value, None)),
    }
}

fn sortn_key_tuple_equal(a: usize, b: usize, sort_keys: &[(Vec<CellValue>, bool)]) -> bool {
    sort_keys
        .iter()
        .all(|(key, _)| value_equal_for_sortn(&key[a], &key[b]))
}

fn sortn_take_with_ties(
    indices: Vec<usize>,
    n: usize,
    sort_keys: &[(Vec<CellValue>, bool)],
) -> Vec<usize> {
    if indices.len() <= n {
        return indices;
    }
    let nth = indices[n - 1];
    let mut selected = Vec::new();
    for (pos, idx) in indices.into_iter().enumerate() {
        if pos < n || sortn_key_tuple_equal(idx, nth, sort_keys) {
            selected.push(idx);
        } else {
            break;
        }
    }
    selected
}

fn sortn_unique_first_n(indices: Vec<usize>, n: usize, range: &CellArray) -> Vec<usize> {
    let mut selected: Vec<usize> = Vec::new();
    'outer: for idx in indices {
        let row = range.row(idx);
        for &existing in &selected {
            if row_equal_for_sortn(row, range.row(existing)) {
                continue 'outer;
            }
        }
        selected.push(idx);
        if selected.len() == n {
            break;
        }
    }
    selected
}

fn sortn_first_n_unique_with_duplicates(
    indices: Vec<usize>,
    n: usize,
    range: &CellArray,
) -> Vec<usize> {
    let unique = sortn_unique_first_n(indices.clone(), n, range);
    indices
        .into_iter()
        .filter(|&idx| {
            unique
                .iter()
                .any(|&u| row_equal_for_sortn(range.row(idx), range.row(u)))
        })
        .collect()
}

fn value_equal_for_sortn(a: &CellValue, b: &CellValue) -> bool {
    cell_value_cmp(a, b) == 0
}

fn row_equal_for_sortn(a: &[CellValue], b: &[CellValue]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b.iter())
            .all(|(left, right)| value_equal_for_sortn(left, right))
}
