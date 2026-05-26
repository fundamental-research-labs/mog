//! Array manipulation functions: TRANSPOSE, TAKE, DROP, CHOOSECOLS, CHOOSEROWS, EXPAND.

use std::sync::Arc;

use value_types::{CellArray, CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// TRANSPOSE
// ---------------------------------------------------------------------------

pub(super) struct FnTranspose;
impl PureFunction for FnTranspose {
    fn name(&self) -> &'static str {
        "TRANSPOSE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let arr = match &args[0] {
            CellValue::Array(r) => r,
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => return CellValue::from_rows(vec![vec![other.clone()]]),
        };
        if arr.is_empty() {
            return CellValue::from_rows(vec![]);
        }
        let num_rows = arr.rows();
        let num_cols = arr.cols();
        let mut result = Vec::with_capacity(num_cols);
        for ci in 0..num_cols {
            let mut new_row = Vec::with_capacity(num_rows);
            for ri in 0..num_rows {
                new_row.push(arr.get(ri, ci).cloned().unwrap_or(CellValue::Null));
            }
            result.push(new_row);
        }
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// TAKE
// ---------------------------------------------------------------------------

pub(super) struct FnTake;
impl PureFunction for FnTake {
    fn name(&self) -> &'static str {
        "TAKE"
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
        let arr = match &args[0] {
            CellValue::Array(r) => Arc::clone(r),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => Arc::new(CellArray::new(vec![other.clone()], 1)),
        };
        let num_rows = arr.rows() as i32;
        let num_cols = arr.cols() as i32;

        // When arg is Null (omitted), treat as "take all" for that dimension
        let take_rows = if args[1].is_null() {
            num_rows
        } else {
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        };
        let take_cols = if args.len() > 2 {
            if args[2].is_null() {
                Some(num_cols)
            } else {
                match args[2].coerce_to_number() {
                    Ok(n) => Some(n as i32),
                    Err(e) => return CellValue::Error(e, None),
                }
            }
        } else {
            None
        };

        // Take rows
        let row_sliced: Vec<Vec<CellValue>> = if take_rows == 0 {
            return CellValue::error_with_message(
                CellError::Calc,
                "TAKE: rows argument must not be 0".to_string(),
            );
        } else if take_rows > 0 {
            let n = take_rows.min(num_rows) as usize;
            arr.rows_iter().take(n).map(|r| r.to_vec()).collect()
        } else {
            let n = (-take_rows).min(num_rows) as usize;
            let skip = (num_rows as usize).saturating_sub(n);
            arr.rows_iter().skip(skip).map(|r| r.to_vec()).collect()
        };

        if row_sliced.is_empty() {
            return CellValue::error_with_message(
                CellError::Calc,
                "TAKE: result has no rows".to_string(),
            );
        }

        // Take cols if specified
        let result = match take_cols {
            Some(0) => {
                return CellValue::error_with_message(
                    CellError::Calc,
                    "TAKE: columns argument must not be 0".to_string(),
                );
            }
            Some(tc) if tc > 0 => {
                let n = tc.min(num_cols) as usize;
                row_sliced.iter().map(|row| row[..n].to_vec()).collect()
            }
            Some(tc) => {
                let n = (-tc).min(num_cols) as usize;
                let start = (num_cols as usize).saturating_sub(n);
                row_sliced.iter().map(|row| row[start..].to_vec()).collect()
            }
            None => row_sliced,
        };

        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// DROP
// ---------------------------------------------------------------------------

pub(super) struct FnDrop;
impl PureFunction for FnDrop {
    fn name(&self) -> &'static str {
        "DROP"
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
        let arr = match &args[0] {
            CellValue::Array(r) => Arc::clone(r),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => Arc::new(CellArray::new(vec![other.clone()], 1)),
        };
        let drop_rows = match args[1].coerce_to_number() {
            Ok(n) => n as i32,
            Err(e) => return CellValue::Error(e, None),
        };
        let drop_cols = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        let num_rows = arr.rows() as i32;
        let num_cols = arr.cols() as i32;

        // Drop rows
        let row_sliced: Vec<Vec<CellValue>> = if drop_rows >= 0 {
            let skip = drop_rows.min(num_rows) as usize;
            arr.rows_iter().skip(skip).map(|r| r.to_vec()).collect()
        } else {
            let keep = (num_rows + drop_rows).max(0) as usize;
            arr.rows_iter().take(keep).map(|r| r.to_vec()).collect()
        };

        if row_sliced.is_empty() {
            return CellValue::error_with_message(
                CellError::Calc,
                "DROP: all rows were dropped".to_string(),
            );
        }

        // Drop cols
        let result: Vec<Vec<CellValue>> = if drop_cols >= 0 {
            let skip = drop_cols.min(num_cols) as usize;
            row_sliced.iter().map(|row| row[skip..].to_vec()).collect()
        } else {
            let keep = (num_cols + drop_cols).max(0) as usize;
            row_sliced.iter().map(|row| row[..keep].to_vec()).collect()
        };

        if result.is_empty() || result[0].is_empty() {
            return CellValue::error_with_message(
                CellError::Calc,
                "DROP: all rows or columns were dropped".to_string(),
            );
        }

        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// CHOOSECOLS
// ---------------------------------------------------------------------------

pub(super) struct FnChooseCols;
impl PureFunction for FnChooseCols {
    fn name(&self) -> &'static str {
        "CHOOSECOLS"
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
    fn call(&self, args: &[CellValue]) -> CellValue {
        let arr = match &args[0] {
            CellValue::Array(r) => r,
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "CHOOSECOLS: first argument must be an array".to_string(),
                );
            }
        };
        let num_cols = arr.cols() as i32;

        let mut col_indices: Vec<usize> = Vec::new();
        for arg in &args[1..] {
            match arg.coerce_to_number() {
                Ok(n) => {
                    let idx = n as i32;
                    if idx == 0 {
                        return CellValue::error_with_message(
                            CellError::Value,
                            "CHOOSECOLS: column index must not be 0".to_string(),
                        );
                    }
                    let resolved = if idx > 0 { idx - 1 } else { num_cols + idx };
                    if resolved < 0 || resolved >= num_cols {
                        return CellValue::error_with_message(
                            CellError::Value,
                            format!(
                                "CHOOSECOLS: column index ({idx}) is out of range, array has {num_cols} columns"
                            ),
                        );
                    }
                    col_indices.push(resolved as usize);
                }
                Err(e) => return CellValue::Error(e, None),
            }
        }

        let result: Vec<Vec<CellValue>> = arr
            .rows_iter()
            .map(|row| {
                col_indices
                    .iter()
                    .map(|&ci| {
                        row.get(ci)
                            .cloned()
                            .unwrap_or(CellValue::Error(CellError::Ref, None))
                    })
                    .collect()
            })
            .collect();
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// CHOOSEROWS
// ---------------------------------------------------------------------------

pub(super) struct FnChooseRows;
impl PureFunction for FnChooseRows {
    fn name(&self) -> &'static str {
        "CHOOSEROWS"
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
    fn call(&self, args: &[CellValue]) -> CellValue {
        let arr = match &args[0] {
            CellValue::Array(r) => r,
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "CHOOSEROWS: first argument must be an array".to_string(),
                );
            }
        };
        let num_rows = arr.rows() as i32;

        let mut row_indices: Vec<usize> = Vec::new();
        for arg in &args[1..] {
            match arg.coerce_to_number() {
                Ok(n) => {
                    let idx = n as i32;
                    if idx == 0 {
                        return CellValue::error_with_message(
                            CellError::Value,
                            "CHOOSEROWS: row index must not be 0".to_string(),
                        );
                    }
                    let resolved = if idx > 0 { idx - 1 } else { num_rows + idx };
                    if resolved < 0 || resolved >= num_rows {
                        return CellValue::error_with_message(
                            CellError::Value,
                            format!(
                                "CHOOSEROWS: row index ({idx}) is out of range, array has {num_rows} rows"
                            ),
                        );
                    }
                    row_indices.push(resolved as usize);
                }
                Err(e) => return CellValue::Error(e, None),
            }
        }

        let result: Vec<Vec<CellValue>> =
            row_indices.iter().map(|&ri| arr.row(ri).to_vec()).collect();
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// EXPAND
// ---------------------------------------------------------------------------

pub(super) struct FnExpand;
impl PureFunction for FnExpand {
    fn name(&self) -> &'static str {
        "EXPAND"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let arr = match &args[0] {
            CellValue::Array(r) => Arc::clone(r),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => Arc::new(CellArray::new(vec![other.clone()], 1)),
        };
        let target_rows = match args[1].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("EXPAND: rows ({}) must be at least 1", n as i32),
                );
            }
            Ok(n) => n as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        let src_cols = arr.cols();
        let target_cols = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) if n < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("EXPAND: columns ({}) must be at least 1", n as i32),
                    );
                }
                Ok(n) => n as usize,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            src_cols
        };
        let pad = if args.len() > 3 {
            args[3].clone()
        } else {
            CellValue::Error(CellError::Na, None)
        };

        let src_rows = arr.rows();
        if target_rows < src_rows || target_cols < src_cols {
            return CellValue::error_with_message(
                CellError::Value,
                format!(
                    "EXPAND: target size ({target_rows}x{target_cols}) is smaller than source ({src_rows}x{src_cols})"
                ),
            );
        }

        let mut result = Vec::with_capacity(target_rows);
        #[allow(clippy::needless_range_loop)]
        for ri in 0..target_rows {
            let mut row = Vec::with_capacity(target_cols);
            for ci in 0..target_cols {
                if ri < src_rows && ci < src_cols {
                    row.push(arr.get(ri, ci).cloned().unwrap_or(CellValue::Null));
                } else {
                    row.push(pad.clone());
                }
            }
            result.push(row);
        }
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// ARRAY_CONSTRAIN(input_range, num_rows, num_cols)
// ---------------------------------------------------------------------------

pub(super) struct FnArrayConstrain;
impl PureFunction for FnArrayConstrain {
    fn name(&self) -> &'static str {
        "ARRAY_CONSTRAIN"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let arr = match &args[0] {
            CellValue::Array(rows) => Arc::clone(rows),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => Arc::new(CellArray::new(vec![other.clone()], 1)),
        };
        let requested_rows = match args[1].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        let requested_cols = match args[2].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        if requested_rows <= 0 || requested_cols <= 0 {
            return CellValue::Error(CellError::Value, None);
        }
        if arr.is_empty() {
            return CellValue::Array(arr);
        }

        let rows = requested_rows as usize;
        let cols = requested_cols as usize;
        let keep_rows = rows.min(arr.rows());
        let keep_cols = cols.min(arr.cols());
        let mut result = Vec::with_capacity(keep_rows);
        for r in 0..keep_rows {
            let mut row = Vec::with_capacity(keep_cols);
            for c in 0..keep_cols {
                row.push(arr.get(r, c).cloned().unwrap_or(CellValue::Null));
            }
            result.push(row);
        }
        CellValue::from_rows(result)
    }
}

// ---------------------------------------------------------------------------
// TRIMRANGE(range, [trim_rows], [trim_cols])
// ---------------------------------------------------------------------------

pub(super) struct FnTrimRange;
impl PureFunction for FnTrimRange {
    fn name(&self) -> &'static str {
        "TRIMRANGE"
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
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 | 2 => Some(CellValue::number(3.0)),
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let arr = match &args[0] {
            CellValue::Array(rows) => Arc::clone(rows),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            other => Arc::new(CellArray::new(vec![other.clone()], 1)),
        };
        let trim_rows = match args.get(1) {
            Some(v) => match v.coerce_to_number() {
                Ok(n) if (0.0..=3.0).contains(&n) => n as i32,
                Ok(_) => return CellValue::Error(CellError::Value, None),
                Err(e) => return CellValue::Error(e, None),
            },
            None => 3,
        };
        let trim_cols = match args.get(2) {
            Some(v) => match v.coerce_to_number() {
                Ok(n) if (0.0..=3.0).contains(&n) => n as i32,
                Ok(_) => return CellValue::Error(CellError::Value, None),
                Err(e) => return CellValue::Error(e, None),
            },
            None => 3,
        };
        if arr.is_empty() {
            return CellValue::Error(CellError::Calc, None);
        }

        let mut top = 0usize;
        let mut bottom = arr.rows();
        let mut left = 0usize;
        let mut right = arr.cols();

        if trim_rows == 1 || trim_rows == 3 {
            while top < bottom && row_is_blank(&arr, top, left, right) {
                top += 1;
            }
        }
        if trim_rows == 2 || trim_rows == 3 {
            while bottom > top && row_is_blank(&arr, bottom - 1, left, right) {
                bottom -= 1;
            }
        }
        if trim_cols == 1 || trim_cols == 3 {
            while left < right && col_is_blank(&arr, left, top, bottom) {
                left += 1;
            }
        }
        if trim_cols == 2 || trim_cols == 3 {
            while right > left && col_is_blank(&arr, right - 1, top, bottom) {
                right -= 1;
            }
        }

        if top >= bottom || left >= right {
            return CellValue::Error(CellError::Calc, None);
        }

        let mut result = Vec::with_capacity(bottom - top);
        for r in top..bottom {
            let mut row = Vec::with_capacity(right - left);
            for c in left..right {
                row.push(arr.get(r, c).cloned().unwrap_or(CellValue::Null));
            }
            result.push(row);
        }
        CellValue::from_rows(result)
    }
}

fn trimrange_is_blank(v: &CellValue) -> bool {
    matches!(v, CellValue::Null)
}

fn row_is_blank(arr: &CellArray, row: usize, left: usize, right: usize) -> bool {
    (left..right).all(|c| trimrange_is_blank(arr.get(row, c).unwrap_or(&CellValue::Null)))
}

fn col_is_blank(arr: &CellArray, col: usize, top: usize, bottom: usize) -> bool {
    (top..bottom).all(|r| trimrange_is_blank(arr.get(r, col).unwrap_or(&CellValue::Null)))
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnArrayConstrain));
    registry.register(Box::new(FnChooseCols));
    registry.register(Box::new(FnChooseRows));
    registry.register(Box::new(FnDrop));
    registry.register(Box::new(FnExpand));
    registry.register(Box::new(FnTake));
    registry.register(Box::new(FnTrimRange));
    registry.register(Box::new(FnTranspose));
}
