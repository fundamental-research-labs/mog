//! Flat 2D grid of cell values — the internal representation of `CellValue::Array`.

use std::fmt;
use std::ops::Index;

use crate::CellValue;

/// Error constructing a [`CellArray`].
#[derive(Debug, Clone, thiserror::Error)]
pub enum CellArrayError {
    /// Data length is not divisible by column count.
    #[error("data length {data_len} is not divisible by column count {cols}")]
    ShapeMismatch {
        /// Length of the data vector.
        data_len: usize,
        /// Requested column count.
        cols: usize,
    },
    /// Column count is zero.
    #[error("column count must be non-zero")]
    ZeroCols,
}

/// A 2D grid of cell values stored as a flat Vec in row-major order.
///
/// For an N-row, M-column array: `data[row * cols + col]` gives the value
/// at (row, col). Single-column ranges (the dominant case) store N elements
/// with cols=1 — zero inner-Vec overhead.
#[derive(Debug, Clone, PartialEq)]
pub struct CellArray {
    data: Vec<CellValue>,
    cols: usize,
}

impl CellArray {
    /// Fallible constructor from flat data in row-major order.
    ///
    /// # Errors
    ///
    /// Returns [`CellArrayError::ZeroCols`] if `cols` is 0 with non-empty data,
    /// or [`CellArrayError::ShapeMismatch`] if `data.len()` is not divisible by `cols`.
    pub fn try_new(data: Vec<CellValue>, cols: usize) -> Result<Self, CellArrayError> {
        if cols == 0 {
            if data.is_empty() {
                return Ok(Self { data, cols: 0 });
            }
            return Err(CellArrayError::ZeroCols);
        }
        if data.len() % cols != 0 {
            return Err(CellArrayError::ShapeMismatch {
                data_len: data.len(),
                cols,
            });
        }
        Ok(Self { data, cols })
    }

    /// Create a new `CellArray` from flat data in row-major order.
    ///
    /// # Panics
    /// Panics if `cols` is 0 and `data` is non-empty, or if `data.len()` is not divisible by `cols`.
    #[must_use]
    pub fn new(data: Vec<CellValue>, cols: usize) -> Self {
        Self::try_new(data, cols).expect("CellArray::new: invalid shape")
    }

    /// Create a single-column array (cols=1). The dominant case for range materialization.
    #[must_use]
    pub fn single_column(data: Vec<CellValue>) -> Self {
        Self { data, cols: 1 }
    }

    /// Create a single-row array (1 row, N cols).
    #[must_use]
    pub fn single_row(data: Vec<CellValue>) -> Self {
        let cols = data.len();
        Self { data, cols }
    }

    /// Fallible constructor from a 2D nested vector (rows of columns).
    ///
    /// # Errors
    ///
    /// Returns [`CellArrayError::ShapeMismatch`] if rows have inconsistent lengths.
    pub fn try_from_rows(rows: Vec<Vec<CellValue>>) -> Result<Self, CellArrayError> {
        let num_cols = rows.first().map_or(0, std::vec::Vec::len);
        let data: Vec<CellValue> = rows
            .into_iter()
            .flat_map(std::iter::IntoIterator::into_iter)
            .collect();
        if data.is_empty() {
            Ok(Self::empty())
        } else {
            Self::try_new(data, num_cols)
        }
    }

    /// Create a `CellArray` from a 2D nested vector (rows of columns).
    /// Flattens into row-major flat storage. Used by `RangeStore` materialization.
    ///
    /// # Panics
    ///
    /// Panics if `rows` contains rows of different lengths (the flattened data
    /// length would not be divisible by the column count from the first row).
    #[must_use]
    pub fn from_rows(rows: Vec<Vec<CellValue>>) -> Self {
        Self::try_from_rows(rows).expect("CellArray::from_rows: invalid shape")
    }

    /// Create an empty array (0 rows, 0 cols).
    #[must_use]
    pub const fn empty() -> Self {
        Self {
            data: Vec::new(),
            cols: 0,
        }
    }

    /// Number of rows.
    #[must_use]
    pub fn rows(&self) -> usize {
        self.data.len().checked_div(self.cols).unwrap_or(0)
    }

    /// Number of rows (alias for [`rows()`](Self::rows)).
    #[must_use]
    pub fn nrows(&self) -> usize {
        self.rows()
    }

    /// Number of columns.
    #[must_use]
    pub fn cols(&self) -> usize {
        self.cols
    }

    /// Number of columns (alias for [`cols()`](Self::cols)).
    #[must_use]
    pub fn ncols(&self) -> usize {
        self.cols
    }

    /// Total number of elements.
    #[must_use]
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Whether the array is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Get element at (row, col). Returns None if out of bounds.
    #[must_use]
    pub fn get(&self, row: usize, col: usize) -> Option<&CellValue> {
        if self.cols == 0 || col >= self.cols || row >= self.rows() {
            return None;
        }
        self.data.get(row * self.cols + col)
    }

    /// The flat data slice — THE key zero-copy API for iteration.
    #[must_use]
    pub fn data(&self) -> &[CellValue] {
        &self.data
    }

    /// Iterate over all elements in row-major order.
    pub fn iter(&self) -> impl Iterator<Item = &CellValue> {
        self.data.iter()
    }

    /// Get a row as a slice.
    ///
    /// # Panics
    /// Panics if `row >= self.rows()`.
    #[must_use]
    pub fn row(&self, row: usize) -> &[CellValue] {
        assert!(
            row < self.rows(),
            "CellArray::row({}) but only {} rows",
            row,
            self.rows()
        );
        let start = row * self.cols;
        &self.data[start..start + self.cols]
    }

    /// Iterate over rows, yielding each row as a slice.
    pub fn rows_iter(&self) -> impl Iterator<Item = &[CellValue]> {
        (0..self.rows()).map(move |r| {
            let start = r * self.cols;
            &self.data[start..start + self.cols]
        })
    }

    /// Iterate over a single column (strided access).
    ///
    /// # Panics
    /// Panics if `col >= self.cols()`.
    pub fn col_iter(&self, col: usize) -> impl Iterator<Item = &CellValue> {
        assert!(
            col < self.cols,
            "CellArray::col_iter({}) but only {} cols",
            col,
            self.cols
        );
        (0..self.rows()).map(move |r| &self.data[r * self.cols + col])
    }

    /// Consume the array and return the flat data.
    #[must_use]
    pub fn into_data(self) -> Vec<CellValue> {
        self.data
    }

    /// Transpose the array (swap rows and columns).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellArray;
    /// use value_types::CellValue;
    ///
    /// // 2x3 array:
    /// // [1, 2, 3]
    /// // [4, 5, 6]
    /// let arr = CellArray::new(vec![
    ///     1.0.into(), 2.0.into(), 3.0.into(),
    ///     4.0.into(), 5.0.into(), 6.0.into(),
    /// ], 3);
    ///
    /// let transposed = arr.transpose();
    /// assert_eq!(transposed.rows(), 3);
    /// assert_eq!(transposed.cols(), 2);
    /// assert_eq!(transposed[(0, 0)], CellValue::from(1.0));
    /// assert_eq!(transposed[(0, 1)], CellValue::from(4.0));
    /// assert_eq!(transposed[(1, 0)], CellValue::from(2.0));
    /// ```
    #[must_use]
    pub fn transpose(&self) -> Self {
        if self.is_empty() {
            return Self::empty();
        }
        let old_rows = self.rows();
        let old_cols = self.cols;
        let mut data = Vec::with_capacity(self.data.len());
        for c in 0..old_cols {
            for r in 0..old_rows {
                data.push(self.data[r * old_cols + c].clone());
            }
        }
        Self {
            data,
            cols: old_rows,
        }
    }

    /// Extract a contiguous range of rows as a new array.
    ///
    /// Returns `None` if the range is out of bounds or empty.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellArray;
    ///
    /// let arr = CellArray::new(vec![
    ///     1.0.into(), 2.0.into(),
    ///     3.0.into(), 4.0.into(),
    ///     5.0.into(), 6.0.into(),
    /// ], 2);
    ///
    /// let sliced = arr.slice_rows(1, 3).unwrap();
    /// assert_eq!(sliced.rows(), 2);
    /// assert_eq!(sliced[(0, 0)], 3.0.into());
    /// assert_eq!(sliced[(1, 0)], 5.0.into());
    /// ```
    #[must_use]
    pub fn slice_rows(&self, start: usize, end: usize) -> Option<Self> {
        if start >= end || start >= self.rows() || end > self.rows() || self.cols == 0 {
            return None;
        }
        let data_start = start * self.cols;
        let data_end = end * self.cols;
        Some(Self {
            data: self.data[data_start..data_end].to_vec(),
            cols: self.cols,
        })
    }

    /// Extract a single column as a new single-column array.
    ///
    /// Returns `None` if `col` is out of bounds.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellArray;
    ///
    /// let arr = CellArray::new(vec![
    ///     1.0.into(), 2.0.into(),
    ///     3.0.into(), 4.0.into(),
    /// ], 2);
    ///
    /// let col1 = arr.column(1).unwrap();
    /// assert_eq!(col1.rows(), 2);
    /// assert_eq!(col1.cols(), 1);
    /// assert_eq!(col1[(0, 0)], 2.0.into());
    /// assert_eq!(col1[(1, 0)], 4.0.into());
    /// ```
    #[must_use]
    pub fn column(&self, col: usize) -> Option<Self> {
        if col >= self.cols {
            return None;
        }
        let data: Vec<CellValue> = (0..self.rows())
            .map(|r| self.data[r * self.cols + col].clone())
            .collect();
        Some(Self::single_column(data))
    }
}

impl Index<(usize, usize)> for CellArray {
    type Output = CellValue;

    /// Index by `(row, col)` tuple.
    ///
    /// # Panics
    /// Panics if `row` or `col` is out of bounds.
    fn index(&self, (row, col): (usize, usize)) -> &Self::Output {
        assert!(
            col < self.cols && row < self.rows(),
            "CellArray index ({row}, {col}) out of bounds for {}x{} array",
            self.rows(),
            self.cols,
        );
        &self.data[row * self.cols + col]
    }
}

impl<'a> IntoIterator for &'a CellArray {
    type Item = &'a CellValue;
    type IntoIter = std::slice::Iter<'a, CellValue>;

    fn into_iter(self) -> Self::IntoIter {
        self.data.iter()
    }
}

impl IntoIterator for CellArray {
    type Item = CellValue;
    type IntoIter = std::vec::IntoIter<CellValue>;

    fn into_iter(self) -> Self::IntoIter {
        self.data.into_iter()
    }
}

impl Default for CellArray {
    /// Returns an empty array (0 rows, 0 cols).
    fn default() -> Self {
        Self::empty()
    }
}

impl fmt::Display for CellArray {
    /// Displays the array as a comma/semicolon-delimited string matching Excel's
    /// array literal format: `{1,2;3,4}` for a 2×2 array.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{{")?;
        for (r, row) in self.rows_iter().enumerate() {
            if r > 0 {
                write!(f, ";")?;
            }
            for (c, val) in row.iter().enumerate() {
                if c > 0 {
                    write!(f, ",")?;
                }
                write!(f, "{val}")?;
            }
        }
        write!(f, "}}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FiniteF64;

    fn n(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(v))
    }

    #[test]
    fn new_basic() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        assert_eq!(arr.rows(), 2);
        assert_eq!(arr.cols(), 2);
        assert_eq!(arr.len(), 4);
    }

    #[test]
    fn single_column() {
        let arr = CellArray::single_column(vec![n(1.0), n(2.0), n(3.0)]);
        assert_eq!(arr.rows(), 3);
        assert_eq!(arr.cols(), 1);
        assert_eq!(arr.get(1, 0), Some(&n(2.0)));
    }

    #[test]
    fn single_row() {
        let arr = CellArray::single_row(vec![n(1.0), n(2.0), n(3.0)]);
        assert_eq!(arr.rows(), 1);
        assert_eq!(arr.cols(), 3);
        assert_eq!(arr.get(0, 2), Some(&n(3.0)));
    }

    #[test]
    fn empty() {
        let arr = CellArray::empty();
        assert_eq!(arr.rows(), 0);
        assert_eq!(arr.cols(), 0);
        assert!(arr.is_empty());
        assert_eq!(arr.get(0, 0), None);
    }

    #[test]
    fn get_out_of_bounds() {
        let arr = CellArray::new(vec![n(1.0), n(2.0)], 2);
        assert_eq!(arr.get(0, 0), Some(&n(1.0)));
        assert_eq!(arr.get(0, 1), Some(&n(2.0)));
        assert_eq!(arr.get(1, 0), None);
        assert_eq!(arr.get(0, 2), None);
    }

    #[test]
    fn row_slice() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        assert_eq!(arr.row(0), &[n(1.0), n(2.0)]);
        assert_eq!(arr.row(1), &[n(3.0), n(4.0)]);
    }

    #[test]
    fn rows_iter_test() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        let rows: Vec<_> = arr.rows_iter().collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], &[n(1.0), n(2.0)]);
        assert_eq!(rows[1], &[n(3.0), n(4.0)]);
    }

    #[test]
    fn col_iter_test() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        let col0: Vec<_> = arr.col_iter(0).collect();
        assert_eq!(col0, vec![&n(1.0), &n(3.0)]);
        let col1: Vec<_> = arr.col_iter(1).collect();
        assert_eq!(col1, vec![&n(2.0), &n(4.0)]);
    }

    #[test]
    fn into_data_consumes() {
        let arr = CellArray::new(vec![n(1.0), n(2.0)], 1);
        let data = arr.into_data();
        assert_eq!(data, vec![n(1.0), n(2.0)]);
    }

    #[test]
    fn iter_test() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0)], 1);
        let vals: Vec<_> = arr.iter().collect();
        assert_eq!(vals, vec![&n(1.0), &n(2.0), &n(3.0)]);
    }

    #[test]
    #[should_panic(expected = "CellArray::new: invalid shape")]
    fn panics_on_cols_zero_with_data() {
        let _ = CellArray::new(vec![n(1.0)], 0);
    }

    #[test]
    #[should_panic(expected = "CellArray::new: invalid shape")]
    fn panics_on_non_divisible() {
        let _ = CellArray::new(vec![n(1.0), n(2.0), n(3.0)], 2);
    }

    // --- try_new / try_from_rows ---

    #[test]
    fn try_new_success() {
        let arr = CellArray::try_new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2).unwrap();
        assert_eq!(arr.rows(), 2);
        assert_eq!(arr.cols(), 2);
    }

    #[test]
    fn try_new_zero_cols_empty_data() {
        let arr = CellArray::try_new(vec![], 0).unwrap();
        assert!(arr.is_empty());
    }

    #[test]
    fn try_new_zero_cols_error() {
        let err = CellArray::try_new(vec![n(1.0)], 0).unwrap_err();
        assert!(matches!(err, CellArrayError::ZeroCols));
    }

    #[test]
    fn try_new_shape_mismatch() {
        let err = CellArray::try_new(vec![n(1.0), n(2.0), n(3.0)], 2).unwrap_err();
        assert!(matches!(
            err,
            CellArrayError::ShapeMismatch {
                data_len: 3,
                cols: 2
            }
        ));
    }

    #[test]
    fn try_from_rows_success() {
        let arr =
            CellArray::try_from_rows(vec![vec![n(1.0), n(2.0)], vec![n(3.0), n(4.0)]]).unwrap();
        assert_eq!(arr.rows(), 2);
        assert_eq!(arr.cols(), 2);
    }

    #[test]
    fn try_from_rows_ragged_error() {
        let err = CellArray::try_from_rows(vec![vec![n(1.0), n(2.0)], vec![n(3.0)]]).unwrap_err();
        assert!(matches!(err, CellArrayError::ShapeMismatch { .. }));
    }

    // --- Index ---

    #[test]
    fn index_access() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        assert_eq!(arr[(0, 0)], n(1.0));
        assert_eq!(arr[(0, 1)], n(2.0));
        assert_eq!(arr[(1, 0)], n(3.0));
        assert_eq!(arr[(1, 1)], n(4.0));
    }

    #[test]
    #[should_panic(expected = "out of bounds")]
    fn index_out_of_bounds() {
        let arr = CellArray::new(vec![n(1.0), n(2.0)], 2);
        let _ = arr[(1, 0)];
    }

    // --- IntoIterator ---

    #[test]
    fn into_iter_ref() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0)], 1);
        let mut vals = Vec::new();
        for v in &arr {
            vals.push(v.clone());
        }
        assert_eq!(vals, vec![n(1.0), n(2.0), n(3.0)]);
    }

    #[test]
    fn into_iter_owned() {
        let arr = CellArray::new(vec![n(1.0), n(2.0)], 1);
        let vals: Vec<_> = arr.into_iter().collect();
        assert_eq!(vals, vec![n(1.0), n(2.0)]);
    }

    // --- Dimension helpers ---

    #[test]
    fn nrows_ncols() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0), n(5.0), n(6.0)], 3);
        assert_eq!(arr.nrows(), 2);
        assert_eq!(arr.ncols(), 3);
    }

    #[test]
    fn is_empty_nonempty() {
        let arr = CellArray::new(vec![n(1.0)], 1);
        assert!(!arr.is_empty());
    }

    // --- transpose ---

    #[test]
    fn transpose_2x3() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0), n(5.0), n(6.0)], 3);
        let t = arr.transpose();
        assert_eq!(t.rows(), 3);
        assert_eq!(t.cols(), 2);
        assert_eq!(t[(0, 0)], n(1.0));
        assert_eq!(t[(0, 1)], n(4.0));
        assert_eq!(t[(1, 0)], n(2.0));
        assert_eq!(t[(1, 1)], n(5.0));
        assert_eq!(t[(2, 0)], n(3.0));
        assert_eq!(t[(2, 1)], n(6.0));
    }

    #[test]
    fn transpose_single_column() {
        let arr = CellArray::single_column(vec![n(1.0), n(2.0), n(3.0)]);
        let t = arr.transpose();
        assert_eq!(t.rows(), 1);
        assert_eq!(t.cols(), 3);
        assert_eq!(t[(0, 0)], n(1.0));
        assert_eq!(t[(0, 1)], n(2.0));
        assert_eq!(t[(0, 2)], n(3.0));
    }

    #[test]
    fn transpose_single_row() {
        let arr = CellArray::single_row(vec![n(1.0), n(2.0)]);
        let t = arr.transpose();
        assert_eq!(t.rows(), 2);
        assert_eq!(t.cols(), 1);
    }

    #[test]
    fn transpose_empty() {
        let t = CellArray::empty().transpose();
        assert!(t.is_empty());
    }

    #[test]
    fn transpose_1x1() {
        let arr = CellArray::new(vec![n(42.0)], 1);
        let t = arr.transpose();
        assert_eq!(t.rows(), 1);
        assert_eq!(t.cols(), 1);
        assert_eq!(t[(0, 0)], n(42.0));
    }

    #[test]
    fn transpose_double_is_identity() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0), n(5.0), n(6.0)], 3);
        let tt = arr.transpose().transpose();
        assert_eq!(tt.rows(), arr.rows());
        assert_eq!(tt.cols(), arr.cols());
        assert_eq!(tt, arr);
    }

    // --- slice_rows ---

    #[test]
    fn slice_rows_middle() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0), n(5.0), n(6.0)], 2);
        let sliced = arr.slice_rows(1, 3).unwrap();
        assert_eq!(sliced.rows(), 2);
        assert_eq!(sliced.cols(), 2);
        assert_eq!(sliced[(0, 0)], n(3.0));
        assert_eq!(sliced[(1, 0)], n(5.0));
    }

    #[test]
    fn slice_rows_first_row() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        let sliced = arr.slice_rows(0, 1).unwrap();
        assert_eq!(sliced.rows(), 1);
        assert_eq!(sliced[(0, 0)], n(1.0));
        assert_eq!(sliced[(0, 1)], n(2.0));
    }

    #[test]
    fn slice_rows_all() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        let sliced = arr.slice_rows(0, 2).unwrap();
        assert_eq!(sliced, arr);
    }

    #[test]
    fn slice_rows_out_of_bounds() {
        let arr = CellArray::new(vec![n(1.0), n(2.0)], 2);
        assert!(arr.slice_rows(0, 2).is_none());
        assert!(arr.slice_rows(1, 1).is_none());
        assert!(arr.slice_rows(2, 3).is_none());
    }

    #[test]
    fn slice_rows_empty() {
        let arr = CellArray::empty();
        assert!(arr.slice_rows(0, 1).is_none());
    }

    // --- column ---

    #[test]
    fn column_basic() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        let col0 = arr.column(0).unwrap();
        assert_eq!(col0.rows(), 2);
        assert_eq!(col0.cols(), 1);
        assert_eq!(col0[(0, 0)], n(1.0));
        assert_eq!(col0[(1, 0)], n(3.0));

        let col1 = arr.column(1).unwrap();
        assert_eq!(col1[(0, 0)], n(2.0));
        assert_eq!(col1[(1, 0)], n(4.0));
    }

    #[test]
    fn column_out_of_bounds() {
        let arr = CellArray::new(vec![n(1.0), n(2.0)], 2);
        assert!(arr.column(2).is_none());
    }

    #[test]
    fn column_single_column_identity() {
        let arr = CellArray::single_column(vec![n(1.0), n(2.0)]);
        let col = arr.column(0).unwrap();
        assert_eq!(col, arr);
    }

    // --- Default ---

    #[test]
    fn default_is_empty() {
        let arr = CellArray::default();
        assert!(arr.is_empty());
        assert_eq!(arr.rows(), 0);
        assert_eq!(arr.cols(), 0);
    }

    // --- Display ---

    #[test]
    fn display_2x2() {
        let arr = CellArray::new(vec![n(1.0), n(2.0), n(3.0), n(4.0)], 2);
        assert_eq!(format!("{arr}"), "{1,2;3,4}");
    }

    #[test]
    fn display_single_row() {
        let arr = CellArray::single_row(vec![n(1.0), n(2.0), n(3.0)]);
        assert_eq!(format!("{arr}"), "{1,2,3}");
    }

    #[test]
    fn display_single_column() {
        let arr = CellArray::single_column(vec![n(1.0), n(2.0)]);
        assert_eq!(format!("{arr}"), "{1;2}");
    }

    #[test]
    fn display_empty() {
        assert_eq!(format!("{}", CellArray::empty()), "{}");
    }
}
