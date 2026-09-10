//! Borrowed access to a column without materializing a second value store.
use crate::CellValue;
use std::ops::{Index, Range};

/// A borrowed grid whose values remain owned by its native store.
pub trait ValueGrid: std::fmt::Debug + Sync {
    /// Read one scalar at a position without allocating.
    fn value_at(&self, row: u32, col: u32) -> Option<&CellValue>;
}

#[derive(Clone, Copy, Debug)]
enum Source<'a> {
    Slice(&'a [CellValue]),
    Grid(&'a dyn ValueGrid, u32),
    Strided {
        values: &'a [CellValue],
        cols: usize,
        col: usize,
        row_start: usize,
    },
}

/// A row-indexed borrowed view of existing values. Missing cells read as Null.
#[derive(Clone, Copy, Debug)]
pub struct ColumnView<'a> {
    source: Source<'a>,
    start: usize,
    len: usize,
}

impl<'a> ColumnView<'a> {
    /// Create an empty view.
    #[must_use]
    pub const fn empty() -> Self {
        Self::from_slice(&[])
    }
    /// Borrow an existing contiguous slice.
    #[must_use]
    pub const fn from_slice(values: &'a [CellValue]) -> Self {
        Self {
            source: Source::Slice(values),
            start: 0,
            len: values.len(),
        }
    }
    /// Borrow one column of a native grid.
    ///
    /// # Panics
    ///
    /// Panics if the last row exceeds the grid's `u32` coordinate range.
    #[must_use]
    pub fn from_grid(grid: &'a dyn ValueGrid, col: u32, rows: usize) -> Self {
        assert!(
            rows.checked_sub(1)
                .is_none_or(|row| u32::try_from(row).is_ok()),
            "column extent exceeds grid coordinates"
        );
        Self {
            source: Source::Grid(grid, col),
            start: 0,
            len: rows,
        }
    }
    /// Borrow a column from row-major native values, with leading/trailing Nulls.
    ///
    /// # Panics
    ///
    /// Panics if `cols` is zero, `col` is outside the column extent, the values
    /// do not contain complete rows, or the last row exceeds `u32::MAX`.
    #[must_use]
    pub fn from_strided(
        values: &'a [CellValue],
        cols: usize,
        col: usize,
        row_start: u32,
        rows: usize,
    ) -> Self {
        assert!(cols > 0 && col < cols && values.len() % cols == 0);
        assert!(
            rows.checked_sub(1)
                .is_none_or(|row| u32::try_from(row).is_ok()),
            "column extent exceeds grid coordinates"
        );
        Self {
            source: Source::Strided {
                values,
                cols,
                col,
                row_start: row_start as usize,
            },
            start: 0,
            len: rows,
        }
    }

    /// Number of addressable rows in the view.
    #[must_use]
    pub fn len(&self) -> usize {
        self.len
    }
    /// Whether the view contains no rows.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    /// Read a row relative to the view, including sparse Nulls.
    #[must_use]
    pub fn get(&self, row: usize) -> Option<&'a CellValue> {
        if row >= self.len {
            return None;
        }
        let row = self.start + row;
        Some(match self.source {
            Source::Slice(values) => &values[row],
            Source::Strided {
                values,
                cols,
                col,
                row_start,
            } => row
                .checked_sub(row_start)
                .and_then(|row| row.checked_mul(cols))
                .and_then(|index| index.checked_add(col))
                .and_then(|index| values.get(index))
                .unwrap_or(&CellValue::Null),
            Source::Grid(grid, col) => u32::try_from(row)
                .ok()
                .and_then(|row| grid.value_at(row, col))
                .unwrap_or(&CellValue::Null),
        })
    }
    /// Borrow a subrange without copying values.
    ///
    /// # Panics
    ///
    /// Panics if the range is reversed or extends beyond the view.
    #[must_use]
    pub fn slice(&self, range: Range<usize>) -> Self {
        assert!(range.start <= range.end && range.end <= self.len);
        Self {
            source: self.source,
            start: self.start + range.start,
            len: range.end - range.start,
        }
    }
    /// Iterate borrowed values in row order.
    #[must_use]
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = &'a CellValue> + ExactSizeIterator + 'a {
        (*self).into_iter()
    }
    /// Materialize values for an owned boundary.
    #[must_use]
    pub fn to_vec(&self) -> Vec<CellValue> {
        self.iter().cloned().collect()
    }
}
impl Index<usize> for ColumnView<'_> {
    type Output = CellValue;
    fn index(&self, row: usize) -> &CellValue {
        self.get(row).expect("column row out of bounds")
    }
}
/// Iterator over a borrowed column, with no per-iteration allocation.
pub struct ColumnIter<'a> {
    view: ColumnView<'a>,
    rows: std::ops::Range<usize>,
}
impl<'a> Iterator for ColumnIter<'a> {
    type Item = &'a CellValue;
    fn next(&mut self) -> Option<Self::Item> {
        self.view.get(self.rows.next()?)
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.rows.size_hint()
    }
}
impl DoubleEndedIterator for ColumnIter<'_> {
    fn next_back(&mut self) -> Option<Self::Item> {
        self.view.get(self.rows.next_back()?)
    }
}
impl ExactSizeIterator for ColumnIter<'_> {}
impl<'a> IntoIterator for ColumnView<'a> {
    type Item = &'a CellValue;
    type IntoIter = ColumnIter<'a>;
    fn into_iter(self) -> Self::IntoIter {
        ColumnIter {
            view: self,
            rows: 0..self.len,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_pointer_width = "64")]
    #[test]
    fn grid_column_reaches_the_last_u32_row_after_slicing() {
        #[derive(Debug)]
        struct LastRow(CellValue);
        impl ValueGrid for LastRow {
            fn value_at(&self, row: u32, col: u32) -> Option<&CellValue> {
                (row == u32::MAX && col == 3).then_some(&self.0)
            }
        }

        let grid = LastRow(CellValue::from(42.0));
        let last = usize::try_from(u32::MAX).unwrap();
        let column = ColumnView::from_grid(&grid, 3, last + 1);
        let tail = column.slice(last - 1..last + 1).slice(1..2);
        assert!(std::ptr::eq(tail.get(0).unwrap(), &grid.0));
        assert_eq!(tail.iter().next_back(), Some(&grid.0));
        assert_eq!(column.get(last + 1), None);
    }

    #[cfg(target_pointer_width = "64")]
    #[test]
    #[should_panic(expected = "column extent exceeds grid coordinates")]
    fn strided_column_rejects_rows_outside_grid_coordinates() {
        let rows = usize::try_from(u32::MAX).unwrap() + 2;
        let _ = ColumnView::from_strided(&[], 1, 0, 0, rows);
    }

    #[test]
    fn strided_column_borrows_values_and_pads_without_allocating() {
        let values: Vec<_> = (1..=6).map(|n| CellValue::from(f64::from(n))).collect();
        let column = ColumnView::from_strided(&values, 2, 1, 2, 7);
        assert_eq!(column.get(0), Some(&CellValue::Null));
        assert!(std::ptr::eq(column.get(2).unwrap(), &values[1]));
        assert_eq!(
            column.slice(2..5).to_vec(),
            vec![
                CellValue::from(2.0),
                CellValue::from(4.0),
                CellValue::from(6.0)
            ]
        );
        assert_eq!(column.get(5), Some(&CellValue::Null));
        assert_eq!(column.get(7), None);
        assert_eq!(column.iter().rev().count(), 7);
    }
}
