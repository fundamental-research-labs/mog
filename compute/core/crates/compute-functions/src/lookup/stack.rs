//! Stack/reshape functions: VSTACK, HSTACK, WRAPCOLS, WRAPROWS, TOCOL, TOROW.

use std::sync::Arc;

use value_types::{CellArray, CellError, CellValue};

use crate::helpers::coercion::flatten_values;
use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// FLATTEN(range1, [range2, ...])
// ---------------------------------------------------------------------------

pub(super) struct FnFlatten;
impl PureFunction for FnFlatten {
    fn name(&self) -> &'static str {
        "FLATTEN"
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
    fn call(&self, args: &[CellValue]) -> CellValue {
        let mut flat = Vec::new();
        for arg in args {
            match arg {
                CellValue::Array(arr) => flat.extend(arr.iter().cloned()),
                other => flat.push(other.clone()),
            }
        }
        CellValue::column_array(flat)
    }
}

// ---------------------------------------------------------------------------
// HSTACK
// ---------------------------------------------------------------------------

pub(super) struct FnHstack;
impl PureFunction for FnHstack {
    fn name(&self) -> &'static str {
        "HSTACK"
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
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Determine max number of rows across all arrays
        let arrays: Vec<Arc<CellArray>> = args
            .iter()
            .map(|a| match a {
                CellValue::Array(r) => Arc::clone(r),
                CellValue::Error(e, _) => {
                    Arc::new(CellArray::new(vec![CellValue::Error(*e, None)], 1))
                }
                other => Arc::new(CellArray::new(vec![other.clone()], 1)),
            })
            .collect();

        let max_rows = arrays.iter().map(|a| a.rows()).max().unwrap_or(0);
        if max_rows == 0 {
            return CellValue::from_rows(vec![]);
        }

        let mut result = Vec::with_capacity(max_rows);
        for ri in 0..max_rows {
            let mut row = Vec::new();
            for arr in &arrays {
                if ri < arr.rows() {
                    row.extend(arr.row(ri).iter().cloned());
                } else {
                    // Pad with #N/A for missing rows
                    let cols = arr.cols();
                    for _ in 0..cols {
                        row.push(CellValue::Error(CellError::Na, None));
                    }
                }
            }
            result.push(row);
        }
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// VSTACK
// ---------------------------------------------------------------------------

pub(super) struct FnVstack;
impl PureFunction for FnVstack {
    fn name(&self) -> &'static str {
        "VSTACK"
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
    fn call(&self, args: &[CellValue]) -> CellValue {
        let arrays: Vec<Arc<CellArray>> = args
            .iter()
            .map(|a| match a {
                CellValue::Array(r) => Arc::clone(r),
                CellValue::Error(e, _) => {
                    Arc::new(CellArray::new(vec![CellValue::Error(*e, None)], 1))
                }
                other => Arc::new(CellArray::new(vec![other.clone()], 1)),
            })
            .collect();

        // Determine max number of columns
        let max_cols = arrays.iter().map(|a| a.cols()).max().unwrap_or(0);

        let mut result = Vec::new();
        for arr in &arrays {
            for row in arr.rows_iter() {
                let mut padded_row = row.to_vec();
                while padded_row.len() < max_cols {
                    padded_row.push(CellValue::Error(CellError::Na, None));
                }
                result.push(padded_row);
            }
        }
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// TOCOL
// ---------------------------------------------------------------------------

pub(super) struct FnToCol;
impl PureFunction for FnToCol {
    fn name(&self) -> &'static str {
        "TOCOL"
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
        // TOCOL(array, [ignore], [scan_by_column])
        let arr = match &args[0] {
            CellValue::Array(r) => r,
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => return CellValue::from_rows(vec![vec![other.clone()]]),
        };
        let ignore = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0 // keep all
        };
        let scan_by_col = if args.len() > 2 {
            match args[2].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false // scan by row (default)
        };

        let num_rows = arr.rows();
        let num_cols = arr.cols();

        let mut flat = Vec::new();
        if scan_by_col {
            for ci in 0..num_cols {
                for ri in 0..num_rows {
                    if let Some(val) = arr.get(ri, ci) {
                        flat.push(val.clone());
                    }
                }
            }
        } else {
            for row in arr.rows_iter() {
                for val in row {
                    flat.push(val.clone());
                }
            }
        }

        // Apply ignore filter
        let filtered: Vec<CellValue> = flat
            .into_iter()
            .filter(|v| match ignore {
                0 => true,                                                 // keep all
                1 => !matches!(v, CellValue::Null),                        // ignore blanks
                2 => !matches!(v, CellValue::Error(..)),                   // ignore errors
                3 => !matches!(v, CellValue::Null | CellValue::Error(..)), // ignore both
                _ => true,
            })
            .collect();

        // Return as single column
        if filtered.is_empty() {
            return CellValue::error_with_message(
                CellError::Calc,
                "TOCOL: all values were filtered out".to_string(),
            );
        }
        CellValue::column_array(filtered)
    }
}

// ---------------------------------------------------------------------------
// TOROW
// ---------------------------------------------------------------------------

pub(super) struct FnToRow;
impl PureFunction for FnToRow {
    fn name(&self) -> &'static str {
        "TOROW"
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
        // TOROW(array, [ignore], [scan_by_column])
        let arr = match &args[0] {
            CellValue::Array(r) => r,
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => return CellValue::from_rows(vec![vec![other.clone()]]),
        };
        let ignore = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        let scan_by_col = if args.len() > 2 {
            match args[2].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false
        };

        let num_rows = arr.rows();
        let num_cols = arr.cols();

        let mut flat = Vec::new();
        if scan_by_col {
            for ci in 0..num_cols {
                for ri in 0..num_rows {
                    if let Some(val) = arr.get(ri, ci) {
                        flat.push(val.clone());
                    }
                }
            }
        } else {
            for row in arr.rows_iter() {
                for val in row {
                    flat.push(val.clone());
                }
            }
        }

        let filtered: Vec<CellValue> = flat
            .into_iter()
            .filter(|v| match ignore {
                0 => true,
                1 => !matches!(v, CellValue::Null),
                2 => !matches!(v, CellValue::Error(..)),
                3 => !matches!(v, CellValue::Null | CellValue::Error(..)),
                _ => true,
            })
            .collect();

        if filtered.is_empty() {
            return CellValue::error_with_message(
                CellError::Calc,
                "TOROW: all values were filtered out".to_string(),
            );
        }
        // Return as single row
        CellValue::row_array(filtered)
    }
}

// ---------------------------------------------------------------------------
// WRAPCOLS
// ---------------------------------------------------------------------------

pub(super) struct FnWrapCols;
impl PureFunction for FnWrapCols {
    fn name(&self) -> &'static str {
        "WRAPCOLS"
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
        // WRAPCOLS(vector, wrap_count, [pad_with])
        let flat = flatten_values(&[args[0].clone()]);
        let wrap_count = match args[1].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("WRAPCOLS: wrap_count ({}) must be at least 1", n as i32),
                );
            }
            Ok(n) => n as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        let pad = if args.len() > 2 {
            args[2].clone()
        } else {
            CellValue::Error(CellError::Na, None)
        };

        let total = flat.len();
        let num_cols = total.div_ceil(wrap_count);

        // Build column-major, then convert to row-major
        let mut result = vec![Vec::with_capacity(num_cols); wrap_count];
        for ci in 0..num_cols {
            for (ri, row) in result.iter_mut().enumerate() {
                let idx = ci * wrap_count + ri;
                if idx < total {
                    row.push(flat[idx].clone());
                } else {
                    row.push(pad.clone());
                }
            }
        }
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// WRAPROWS
// ---------------------------------------------------------------------------

pub(super) struct FnWrapRows;
impl PureFunction for FnWrapRows {
    fn name(&self) -> &'static str {
        "WRAPROWS"
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
        // WRAPROWS(vector, wrap_count, [pad_with])
        let flat = flatten_values(&[args[0].clone()]);
        let wrap_count = match args[1].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("WRAPROWS: wrap_count ({}) must be at least 1", n as i32),
                );
            }
            Ok(n) => n as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        let pad = if args.len() > 2 {
            args[2].clone()
        } else {
            CellValue::Error(CellError::Na, None)
        };

        let total = flat.len();
        let num_rows = total.div_ceil(wrap_count);

        let mut result = Vec::with_capacity(num_rows);
        for ri in 0..num_rows {
            let mut row = Vec::with_capacity(wrap_count);
            for ci in 0..wrap_count {
                let idx = ri * wrap_count + ci;
                if idx < total {
                    row.push(flat[idx].clone());
                } else {
                    row.push(pad.clone());
                }
            }
            result.push(row);
        }
        CellValue::from_rows(result)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnFlatten));
    registry.register(Box::new(FnHstack));
    registry.register(Box::new(FnVstack));
    registry.register(Box::new(FnToCol));
    registry.register(Box::new(FnToRow));
    registry.register(Box::new(FnWrapCols));
    registry.register(Box::new(FnWrapRows));
}
