//! Dynamic array functions: FILTER, SORT, UNIQUE, SEQUENCE, SORTBY.

use std::hash::{Hash, Hasher};
use std::sync::Arc;

use rustc_hash::FxHashMap;
use value_types::{CellArray, CellError, CellValue};

use super::helpers::cell_value_cmp;
use crate::helpers::coercion::flatten_values;
use crate::{FunctionRegistry, PureFunction};

/// Hash a single `CellValue` for UNIQUE comparison (case-insensitive for text,
/// matching the semantics of `rows_equal` / `cell_value_cmp`).
#[inline]
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

/// Hash a row (slice of `CellValue`) using case-insensitive text hashing.
fn hash_row_ci(row: &[CellValue]) -> u64 {
    let mut hasher = rustc_hash::FxHasher::default();
    row.len().hash(&mut hasher);
    for v in row {
        hash_cell_value_ci(v, &mut hasher);
    }
    hasher.finish()
}

/// Comparison for SORT/SORTBY: blanks (Null) sort AFTER all other values,
/// matching Excel's behavior. Regular `cell_value_cmp` puts Null at rank 0
/// (before numbers/text), which is correct for lookup binary searches but
/// wrong for user-visible sorting.
fn cell_value_cmp_sort(a: &CellValue, b: &CellValue) -> i32 {
    match (a, b) {
        (CellValue::Null, CellValue::Null) => 0,
        (CellValue::Null, _) => 1,  // null sorts after everything
        (_, CellValue::Null) => -1, // everything sorts before null
        _ => cell_value_cmp(a, b),
    }
}

// ---------------------------------------------------------------------------
// Helper: coerce arg to array (single value → 1x1 array)
// ---------------------------------------------------------------------------

fn to_array(v: &CellValue) -> Result<Arc<CellArray>, CellError> {
    match v {
        CellValue::Array(rows) => Ok(Arc::clone(rows)),
        CellValue::Error(e, _) => Err(*e),
        other => Ok(Arc::new(CellArray::new(vec![other.clone()], 1))),
    }
}

/// Case-insensitive equality for UNIQUE comparisons.
/// Matches the semantics of `cell_value_cmp` == 0.
fn rows_equal(a: &[CellValue], b: &[CellValue]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| cell_value_cmp(x, y) == 0)
}

/// Check if a CellValue is truthy for FILTER purposes:
/// TRUE or nonzero number → true, everything else → false.
fn is_truthy(v: &CellValue) -> bool {
    match v {
        CellValue::Boolean(b) => *b,
        CellValue::Number(n) => n.get() != 0.0,
        _ => false,
    }
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

// ---------------------------------------------------------------------------
// SEQUENCE(rows, [columns], [start], [step])
// ---------------------------------------------------------------------------

pub(super) struct FnSequence;
impl PureFunction for FnSequence {
    fn name(&self) -> &'static str {
        "SEQUENCE"
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
    fn call(&self, args: &[CellValue]) -> CellValue {
        // rows (required)
        let rows = match args[0].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        // columns (default 1)
        let cols = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        // start (default 1)
        let start = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        // step (default 1)
        let step = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };

        if rows <= 0 || cols <= 0 {
            return CellValue::error_with_message(
                CellError::Calc,
                format!("SEQUENCE: rows ({rows}) and columns ({cols}) must be positive"),
            );
        }

        let rows = rows as usize;
        let cols = cols as usize;
        let mut result = Vec::with_capacity(rows);
        let mut current = start;
        for _ in 0..rows {
            let mut row = Vec::with_capacity(cols);
            for _ in 0..cols {
                row.push(CellValue::number(current));
                current += step;
            }
            result.push(row);
        }
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// SORTN(range, [n], [display_ties_mode], [sort_column1, is_ascending1], ...)
// ---------------------------------------------------------------------------

pub(super) struct FnSortN;
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

// ---------------------------------------------------------------------------
// FILTER(array, include, [if_empty])
// ---------------------------------------------------------------------------

pub(super) struct FnFilter;
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

        // Determine filter direction
        if inc_cols == 1 && inc_rows == num_rows {
            // Column filter mask: filter rows
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
            // Row filter mask: filter columns
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
            // Same dimensions: filter rows where ANY include cell in that row is truthy
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
            // Dimension mismatch
            CellValue::error_with_message(
                CellError::Value,
                format!(
                    "FILTER: include array dimensions ({inc_rows}x{inc_cols}) do not match data array ({num_rows}x{num_cols})"
                ),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// SORT(array, [sort_index], [sort_order], [by_col])
// ---------------------------------------------------------------------------

pub(super) struct FnSort;
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
            1 => Some(CellValue::number(1.0)),    // sort_index default
            2 => Some(CellValue::number(1.0)),    // sort_order (ascending)
            3 => Some(CellValue::Boolean(false)), // by_col
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

        // sort_index: 1-based (default 1)
        let sort_index = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };

        // sort_order: 1=ascending (default), -1=descending
        let sort_order = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };

        // by_col: FALSE = sort rows (default), TRUE = sort columns
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
            // Sort columns
            let num_rows = rows.rows();
            let num_cols = rows.cols();
            let key_row = (sort_index - 1) as usize;
            if key_row >= num_rows {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("SORT: sort_index ({sort_index}) exceeds number of rows ({num_rows})"),
                );
            }

            // Build column index array
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

            // Rearrange columns
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
            // Sort rows
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

// ---------------------------------------------------------------------------
// SORTBY(array, by_array1, [sort_order1], ...)
// ---------------------------------------------------------------------------

pub(super) struct FnSortBy;
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
        // Odd indices >= 2 are sort_order args, default ascending
        if index >= 2 && index.is_multiple_of(2) {
            Some(CellValue::number(1.0))
        } else {
            None
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // SORTBY(array, by_array1, [sort_order1], ...)
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

        // Parse by_array/sort_order pairs
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
                        // Not a valid sort_order, treat as next by_array
                        i += 1;
                        1
                    }
                }
            } else {
                i += 1;
                1 // default ascending
            };
            sort_keys.push((by_flat, order));
        }

        if sort_keys.is_empty() {
            return CellValue::Array(rows);
        }

        // Detect horizontal case: single row where keys match column count
        let is_horizontal =
            num_rows == 1 && num_cols > 1 && sort_keys.iter().all(|(key, _)| key.len() == num_cols);

        if is_horizontal {
            // Sort columns (horizontal)
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

            // Rearrange columns in each row
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
            // Validate key lengths match row count (vertical sort)
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

            // Create index array and sort rows
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

// ---------------------------------------------------------------------------
// UNIQUE(array, [by_col], [exactly_once])
// ---------------------------------------------------------------------------

pub(super) struct FnUnique;
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

        // Excel coerces blank source cells to literal `0` BEFORE deduping in
        // UNIQUE, so `=UNIQUE(A1:A5)` over ["alpha", "beta", <blank>, ...]
        // yields three distinct rows ["alpha", "beta", 0] — the blanks
        // collapse into a single Number(0) row that also collides with any
        // literal 0 in the source. `cell_value_cmp` / `hash_cell_value_ci`
        // (helpers.rs:43, dynamic_arrays.rs:32) treat Null as its own bucket,
        // so without this rewrite blanks would survive as a distinct
        // CellValue::Null row. Scope is intentionally local to FnUnique:
        // pushing this into the shared `to_array` helper would break
        // FILTER's blank-tail semantics — see
        // tests/filter_unique_column_range_blank_tail.rs.
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

        // by_col: FALSE = compare rows (default), TRUE = compare columns
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

        // exactly_once: FALSE = distinct (default), TRUE = only values that appear exactly once
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
            // Compare columns
            let num_rows = array.rows();
            let num_cols = array.cols();

            // Extract columns as vectors
            let columns: Vec<Vec<CellValue>> = (0..num_cols)
                .map(|ci| {
                    (0..num_rows)
                        .map(|ri| array.get(ri, ci).cloned().unwrap_or(CellValue::Null))
                        .collect()
                })
                .collect();

            let selected = if exactly_once {
                // Only columns that appear exactly once — O(n) via frequency map.
                // Group column indices by hash, then within each bucket only
                // compare columns that share the same hash (collision check).
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
                // Distinct columns (first occurrence) — O(n) via hash set
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

            // Reconstruct array with selected columns
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
            // Compare rows
            // Collect rows once for indexed access in hash collision checks
            let rows_vec: Vec<Vec<CellValue>> = array.rows_iter().map(|r| r.to_vec()).collect();

            let selected = if exactly_once {
                // Only rows that appear exactly once — O(n) via frequency map
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
                // Distinct rows (first occurrence) — O(n) via hash set
                let mut seen: FxHashMap<u64, Vec<usize>> = FxHashMap::default();
                let mut result_indices = Vec::new();
                // Collect rows to allow indexed access for collision checks
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

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnFilter));
    registry.register(Box::new(FnSort));
    registry.register(Box::new(FnSortN));
    registry.register(Box::new(FnUnique));
    registry.register(Box::new(FnSequence));
    registry.register(Box::new(FnSortBy));
}
