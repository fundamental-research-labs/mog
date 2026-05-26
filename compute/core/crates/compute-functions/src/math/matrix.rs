//! Matrix functions: MMULT, MDETERM, MINVERSE, MUNIT

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/// Convert CellValue (expected to be an Array) to a numeric matrix.
fn to_matrix(val: &CellValue) -> Result<Vec<Vec<f64>>, CellError> {
    match val {
        CellValue::Error(e, _) => Err(*e),
        CellValue::Array(arr) => {
            let mut matrix = Vec::with_capacity(arr.rows());
            for row in arr.rows_iter() {
                let mut num_row = Vec::with_capacity(row.len());
                for cell in row {
                    match cell {
                        CellValue::Error(e, _) => return Err(*e),
                        _ => match cell.coerce_to_number() {
                            Ok(n) => num_row.push(n),
                            Err(e) => return Err(e),
                        },
                    }
                }
                matrix.push(num_row);
            }
            Ok(matrix)
        }
        _ => match val.coerce_to_number() {
            Ok(n) => Ok(vec![vec![n]]),
            Err(e) => Err(e),
        },
    }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

pub(super) struct FnMmult;
impl PureFunction for FnMmult {
    fn name(&self) -> &'static str {
        "MMULT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }

        let m1 = match to_matrix(&args[0]) {
            Ok(m) => m,
            Err(e) => return CellValue::Error(e, None),
        };
        let m2 = match to_matrix(&args[1]) {
            Ok(m) => m,
            Err(e) => return CellValue::Error(e, None),
        };

        let rows1 = m1.len();
        let cols1 = if rows1 > 0 { m1[0].len() } else { 0 };
        let rows2 = m2.len();
        let cols2 = if rows2 > 0 { m2[0].len() } else { 0 };

        if cols1 != rows2 || cols1 == 0 {
            return CellValue::error_with_message(
                CellError::Value,
                format!(
                    "MMULT: inner dimensions must match, got {rows1}x{cols1} * {rows2}x{cols2}"
                ),
            );
        }

        let mut result = Vec::with_capacity(rows1);
        for m1_row in m1.iter().take(rows1) {
            let mut row = Vec::with_capacity(cols2);
            #[allow(clippy::needless_range_loop)]
            for j in 0..cols2 {
                let mut sum = 0.0;
                for k in 0..cols1 {
                    sum += m1_row[k] * m2[k][j];
                }
                row.push(CellValue::number(sum));
            }
            result.push(row);
        }

        if result.len() == 1 && result[0].len() == 1 {
            result[0][0].clone()
        } else {
            CellValue::from_rows(result)
        }
    }
}

pub(super) struct FnMdeterm;
impl PureFunction for FnMdeterm {
    fn name(&self) -> &'static str {
        "MDETERM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let matrix = match to_matrix(&args[0]) {
            Ok(m) => m,
            Err(e) => return CellValue::Error(e, None),
        };
        let n = matrix.len();
        if n == 0 {
            return CellValue::error_with_message(
                CellError::Value,
                "MDETERM: argument must be a non-empty matrix",
            );
        }
        // Must be square
        for row in &matrix {
            if row.len() != n {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!(
                        "MDETERM: argument must be a square matrix, got {}x{}",
                        n,
                        row.len()
                    ),
                );
            }
        }

        // LU decomposition with partial pivoting
        let mut a: Vec<Vec<f64>> = matrix.to_vec();
        let mut det = 1.0_f64;
        for i in 0..n {
            let mut max_row = i;
            for k in (i + 1)..n {
                if a[k][i].abs() > a[max_row][i].abs() {
                    max_row = k;
                }
            }
            if max_row != i {
                a.swap(i, max_row);
                det *= -1.0;
            }
            if a[i][i] == 0.0 {
                return CellValue::number(0.0);
            }
            det *= a[i][i];
            for k in (i + 1)..n {
                let factor = a[k][i] / a[i][i];
                #[allow(clippy::needless_range_loop)]
                for j in i..n {
                    a[k][j] -= factor * a[i][j];
                }
            }
        }
        CellValue::number(det)
    }
}

pub(super) struct FnMinverse;
impl PureFunction for FnMinverse {
    fn name(&self) -> &'static str {
        "MINVERSE"
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
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let matrix = match to_matrix(&args[0]) {
            Ok(m) => m,
            Err(e) => return CellValue::Error(e, None),
        };
        let n = matrix.len();
        if n == 0 {
            return CellValue::error_with_message(
                CellError::Value,
                "MINVERSE: argument must be a non-empty matrix",
            );
        }
        for row in &matrix {
            if row.len() != n {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!(
                        "MINVERSE: argument must be a square matrix, got {}x{}",
                        n,
                        row.len()
                    ),
                );
            }
        }

        // Gauss-Jordan elimination with augmented identity matrix
        let mut aug: Vec<Vec<f64>> = Vec::with_capacity(n);
        for (i, matrix_row) in matrix.iter().enumerate().take(n) {
            let mut row = matrix_row.clone();
            for j in 0..n {
                row.push(if i == j { 1.0 } else { 0.0 });
            }
            aug.push(row);
        }

        for i in 0..n {
            let mut max_row = i;
            for k in (i + 1)..n {
                if aug[k][i].abs() > aug[max_row][i].abs() {
                    max_row = k;
                }
            }
            if max_row != i {
                aug.swap(i, max_row);
            }
            if aug[i][i].abs() < 1e-15 {
                return CellValue::error_with_message(
                    CellError::Num,
                    "MINVERSE: matrix is singular (not invertible)",
                );
            }
            let pivot = aug[i][i];
            #[allow(clippy::needless_range_loop)]
            for j in 0..(2 * n) {
                aug[i][j] /= pivot;
            }
            for k in 0..n {
                if k != i {
                    let factor = aug[k][i];
                    #[allow(clippy::needless_range_loop)]
                    for j in 0..(2 * n) {
                        aug[k][j] -= factor * aug[i][j];
                    }
                }
            }
        }

        let result: Vec<Vec<CellValue>> = (0..n)
            .map(|i| aug[i][n..].iter().map(|v| CellValue::number(*v)).collect())
            .collect();

        if result.len() == 1 && result[0].len() == 1 {
            result[0][0].clone()
        } else {
            CellValue::from_rows(result)
        }
    }
}

pub(super) struct FnMunit;
impl PureFunction for FnMunit {
    fn name(&self) -> &'static str {
        "MUNIT"
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
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(d) => {
                let n = d as usize;
                if n < 1 {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("MUNIT: dimension must be >= 1, got {}", d as i64),
                    );
                }
                if n > 16384 || n * n > 2_000_000 {
                    return CellValue::error_with_message(
                        CellError::Calc,
                        format!("MUNIT: dimension {n} too large (max 16384 or 2M cells)"),
                    );
                }
                let result: Vec<Vec<CellValue>> = (0..n)
                    .map(|i| {
                        (0..n)
                            .map(|j| CellValue::number(if i == j { 1.0 } else { 0.0 }))
                            .collect()
                    })
                    .collect();
                CellValue::from_rows(result)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnMmult));
    registry.register(Box::new(FnMdeterm));
    registry.register(Box::new(FnMinverse));
    registry.register(Box::new(FnMunit));
}
