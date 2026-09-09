//! Dense columnar store for SIMD-accelerated aggregation.
//!
//! Materializes columns as contiguous `Vec<f64>` for fast aggregation (SUM, AVERAGE, COUNT,
//! MIN, MAX over large ranges). Dense columns enable SIMD-friendly linear scans instead of
//! cell-by-cell `FxHashMap` lookups (~5ns each).
//!
//! # Design
//!
//! - **Lazy**: columns are only materialized when requested by a large-range aggregate.
//! - **Native authority**: numeric writes update a derived slot; other mutations invalidate it.
//! - **NAN sentinel**: non-numeric cells are stored as `f64::NAN`, skipped during aggregation.
//! - **Threshold**: only used for ranges > `DENSE_THRESHOLD` cells; below that, direct
//!   FxHashMap iteration is fast enough.

use rustc_hash::FxHashMap;
use std::sync::OnceLock;

use super::SheetMirror;
use cell_types::SheetId;
use value_types::CellValue;

// Re-export pure value types from their canonical home in value-types.
pub use value_types::dense::{DENSE_THRESHOLD, DenseBoolMask, DenseColumn};

/// Cache key: (sheet_id, column_index).
type ColumnKey = (SheetId, u32);

// ---------------------------------------------------------------------------
// DenseColumnCache
// ---------------------------------------------------------------------------

/// Cache of materialized dense columns.
///
/// - **Lazy**: columns are only materialized when requested.
/// Numeric caches are disposable; authored values remain in the native cell store.
#[derive(Debug, Clone)]
pub struct DenseColumnCache {
    columns: FxHashMap<ColumnKey, OnceLock<Option<CachedColumn>>>,
}

#[derive(Debug, Clone)]
struct CachedColumn {
    dense: DenseColumn,
    mask: DenseBoolMask,
    /// Only lazily built numeric/null columns support direct slot updates.
    numeric_only: bool,
}

impl Default for DenseColumnCache {
    fn default() -> Self {
        Self::new()
    }
}

impl DenseColumnCache {
    pub fn new() -> Self {
        Self {
            columns: FxHashMap::default(),
        }
    }

    /// Get a cached dense column, or `None` if not materialized or dirty.
    pub fn get(&self, sheet: &SheetId, col: u32) -> Option<&DenseColumn> {
        Some(&self.columns.get(&(*sheet, col))?.get()?.as_ref()?.dense)
    }

    /// Get a cached bool mask, or `None` if not materialized or dirty.
    pub fn get_bool_mask(&self, sheet: &SheetId, col: u32) -> Option<&DenseBoolMask> {
        Some(&self.columns.get(&(*sheet, col))?.get()?.as_ref()?.mask)
    }

    /// Reserve a lazy slot for an occupied column without materializing its values.
    pub(crate) fn register_column(&mut self, sheet: SheetId, col: u32) {
        self.columns.entry((sheet, col)).or_default();
    }

    /// Borrow a lazily derived numeric/null column for a sufficiently large range.
    /// Mixed columns are remembered as ineligible until their next mutation.
    pub(crate) fn get_numeric_for_range(
        &self,
        sheet: SheetId,
        col: u32,
        start_row: u32,
        end_row: u32,
        source: &SheetMirror,
    ) -> Option<&DenseColumn> {
        if cfg!(feature = "dd-precision")
            || end_row < start_row
            || (end_row as u64 - start_row as u64 + 1) < DENSE_THRESHOLD as u64
        {
            return None;
        }
        let slot = self.columns.get(&(sheet, col))?;
        let cached = slot.get_or_init(|| {
            let view = source.get_column_view(col)?;
            if view.len() < DENSE_THRESHOLD {
                return None;
            }
            let mut values = Vec::with_capacity(view.len());
            let mut numeric_count = 0;
            for value in view {
                match value {
                    CellValue::Number(number) => {
                        values.push(number.get());
                        numeric_count += 1;
                    }
                    CellValue::Null => values.push(f64::NAN),
                    _ => return None,
                }
            }
            Some(CachedColumn {
                mask: DenseBoolMask::new(Vec::new(), 0, values.len() as u32),
                dense: DenseColumn::new(values, numeric_count, 0, Vec::new()),
                numeric_only: true,
            })
        });
        let cached = cached.as_ref()?;
        cached.numeric_only.then_some(&cached.dense)
    }

    /// Keep a numeric cache current after a native scalar write, or discard it.
    pub(crate) fn update_cell<'a>(
        &mut self,
        sheet: SheetId,
        col: u32,
        row: u32,
        value: impl FnOnce() -> Option<&'a CellValue>,
    ) {
        let slot = self.columns.entry((sheet, col)).or_default();
        if let Some(Some(cached)) = slot.get_mut()
            && cached.numeric_only
        {
            let number = match value() {
                Some(CellValue::Number(number)) => Some(number.get()),
                Some(CellValue::Null) | None => None,
                _ => {
                    slot.take();
                    return;
                }
            };
            if cached.dense.set_numeric_at(row, number) {
                return;
            }
        }
        slot.take();
    }

    /// Materialize a column from the `SheetMirror`'s data.
    /// Reads all cells in the column and builds a contiguous `Vec<f64>`.
    /// Also produces a `DenseBoolMask` tracking which rows are boolean-sourced.
    ///
    /// Reads authored, imported and projected values from their native owners.
    /// This numeric cache is derived lazily; generic CellValue copies are not retained.
    pub fn materialize(
        &mut self,
        sheet: &SheetId,
        col: u32,
        sheet_mirror: &SheetMirror,
    ) -> &DenseColumn {
        let rows = sheet_mirror.rows;
        let mut values = vec![f64::NAN; rows as usize];
        let mut numeric_count = 0usize;
        let mut errors: Vec<(u32, value_types::CellError)> = Vec::new();
        let num_words = (rows as usize).div_ceil(64);
        let mut mask = DenseBoolMask::new(vec![0u64; num_words], 0, rows);

        let column = sheet_mirror.get_column_view(col);
        for row in 0..rows {
            match column
                .as_ref()
                .and_then(|column| column.get(row as usize))
                .or_else(|| sheet_mirror.value_at(cell_types::SheetPos::new(row, col)))
            {
                Some(CellValue::Number(n)) => {
                    values[row as usize] = n.get();
                    numeric_count += 1;
                }
                Some(CellValue::Boolean(b)) => {
                    values[row as usize] = if *b { 1.0 } else { 0.0 };
                    numeric_count += 1;
                    mask.set_bit(row as usize);
                }
                Some(CellValue::Error(e, _)) => errors.push((row, *e)),
                _ => {}
            }
        }

        self.store_dense(
            *sheet,
            col,
            DenseColumn::new(values, numeric_count, 0, errors),
            mask,
        );
        self.get(sheet, col).unwrap()
    }

    /// Store an externally-produced dense column and its bool mask.
    /// Used by vectorized evaluation to insert pre-computed columns.
    pub fn store_dense(
        &mut self,
        sheet: SheetId,
        col: u32,
        dense: DenseColumn,
        mask: DenseBoolMask,
    ) {
        self.columns.insert(
            (sheet, col),
            OnceLock::from(Some(CachedColumn {
                dense,
                mask,
                numeric_only: false,
            })),
        );
    }

    /// Invalidate a column (called when any cell in that column is written).
    pub fn invalidate(&mut self, sheet: &SheetId, col: u32) {
        self.columns.entry((*sheet, col)).or_default().take();
    }

    /// Invalidate all columns for a sheet (called on structural changes).
    pub fn invalidate_sheet(&mut self, sheet: &SheetId) {
        for ((owner, _), slot) in &mut self.columns {
            if owner == sheet {
                slot.take();
            }
        }
    }

    /// Remove all cache slots when their owning sheet is removed.
    pub(crate) fn remove_sheet(&mut self, sheet: &SheetId) {
        self.columns.retain(|(owner, _), _| owner != sheet);
    }

    /// Invalidate everything.
    pub fn invalidate_all(&mut self) {
        for slot in self.columns.values_mut() {
            slot.take();
        }
    }

    /// Number of cached columns (for testing/diagnostics).
    pub fn len(&self) -> usize {
        self.columns
            .values()
            .filter(|slot| slot.get().is_some_and(Option::is_some))
            .count()
    }

    /// Whether the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::CellEntry;
    use cell_types::{CellId, SheetId, SheetPos};
    use value_types::{CellError, FiniteF64};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_cell_id(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    /// Build a SheetMirror with `num_rows` rows and `num_cols` cols.
    /// No cells are inserted -- caller populates them.
    fn make_empty_sheet(sheet_id: SheetId, num_rows: u32, num_cols: u32) -> SheetMirror {
        SheetMirror::new(sheet_id, "TestSheet".to_string(), num_rows, num_cols)
    }

    /// Insert a cell into a SheetMirror at (row, col) with a CellValue.
    fn insert_cell(sheet: &mut SheetMirror, row: u32, col: u32, value: CellValue) {
        let cell_id = make_cell_id((row as u128) * 1000 + (col as u128));
        let entry = CellEntry {
            value,
            formula: None,
        };
        sheet.cells.insert(cell_id, entry);
        sheet.pos_to_id.insert(SheetPos::new(row, col), cell_id);
        sheet.id_to_pos.insert(cell_id, SheetPos::new(row, col));
    }

    // -----------------------------------------------------------------------
    // 1. test_materialize_empty_column
    // -----------------------------------------------------------------------

    #[test]
    fn test_materialize_empty_column() {
        let sheet_id = make_sheet_id(1);
        let sheet = make_empty_sheet(sheet_id, 10, 5);
        let mut cache = DenseColumnCache::new();

        let dense = cache.materialize(&sheet_id, 0, &sheet);
        assert_eq!(dense.values().len(), 10);
        assert_eq!(dense.numeric_count(), 0);
        assert_eq!(dense.start_row(), 0);
        // All values should be NAN
        for v in dense.values() {
            assert!(v.is_nan());
        }
    }

    // -----------------------------------------------------------------------
    // 2. test_materialize_numeric_column
    // -----------------------------------------------------------------------

    #[test]
    fn test_materialize_numeric_column() {
        let sheet_id = make_sheet_id(1);
        let mut sheet = make_empty_sheet(sheet_id, 10, 5);

        // Insert numbers at rows 0, 3, 7
        insert_cell(&mut sheet, 0, 0, CellValue::Number(FiniteF64::must(10.0)));
        insert_cell(&mut sheet, 3, 0, CellValue::Number(FiniteF64::must(20.0)));
        insert_cell(&mut sheet, 7, 0, CellValue::Number(FiniteF64::must(30.0)));

        let mut cache = DenseColumnCache::new();
        let dense = cache.materialize(&sheet_id, 0, &sheet);

        assert_eq!(dense.values().len(), 10);
        assert_eq!(dense.numeric_count(), 3);
        assert_eq!(dense.values()[0], 10.0);
        assert!(dense.values()[1].is_nan());
        assert!(dense.values()[2].is_nan());
        assert_eq!(dense.values()[3], 20.0);
        assert_eq!(dense.values()[7], 30.0);
    }

    // -----------------------------------------------------------------------
    // 3. test_materialize_mixed_types
    // -----------------------------------------------------------------------

    #[test]
    fn test_materialize_mixed_types() {
        let sheet_id = make_sheet_id(1);
        let mut sheet = make_empty_sheet(sheet_id, 10, 5);

        insert_cell(&mut sheet, 0, 0, CellValue::Number(FiniteF64::must(42.0)));
        insert_cell(&mut sheet, 1, 0, CellValue::Text("hello".into()));
        insert_cell(&mut sheet, 2, 0, CellValue::Boolean(true));
        insert_cell(&mut sheet, 3, 0, CellValue::Boolean(false));
        insert_cell(&mut sheet, 4, 0, CellValue::Null);
        insert_cell(&mut sheet, 5, 0, CellValue::Error(CellError::Value, None));

        let mut cache = DenseColumnCache::new();
        let dense = cache.materialize(&sheet_id, 0, &sheet);

        // Numbers: 42.0 + booleans (true=1, false=0) = 3 numeric
        assert_eq!(dense.numeric_count(), 3);
        assert_eq!(dense.values()[0], 42.0);
        assert!(dense.values()[1].is_nan()); // text
        assert_eq!(dense.values()[2], 1.0); // true
        assert_eq!(dense.values()[3], 0.0); // false
        assert!(dense.values()[4].is_nan()); // null
        assert!(dense.values()[5].is_nan()); // error
    }

    // -----------------------------------------------------------------------
    // 4. test_sum_range
    // -----------------------------------------------------------------------

    #[test]
    fn test_sum_range() {
        let dense = DenseColumn::new(vec![1.0, 2.0, 3.0, 4.0, 5.0], 5, 0, vec![]);

        assert_eq!(dense.sum_range(0, 4), 15.0);
        assert_eq!(dense.sum_range(1, 3), 9.0);
        assert_eq!(dense.sum_range(0, 0), 1.0);
        assert_eq!(dense.sum_range(4, 4), 5.0);
    }

    // -----------------------------------------------------------------------
    // 5. test_sum_range_with_nans
    // -----------------------------------------------------------------------

    #[test]
    fn test_sum_range_with_nans() {
        let dense = DenseColumn::new(vec![1.0, f64::NAN, 3.0, f64::NAN, 5.0], 3, 0, vec![]);

        assert_eq!(dense.sum_range(0, 4), 9.0);
        assert_eq!(dense.sum_range(0, 2), 4.0);
        // Range with only NAN
        assert_eq!(dense.sum_range(1, 1), 0.0);
    }

    // -----------------------------------------------------------------------
    // 6. test_count_range
    // -----------------------------------------------------------------------

    #[test]
    fn test_count_range() {
        let dense = DenseColumn::new(vec![1.0, f64::NAN, 3.0, f64::NAN, 5.0], 3, 0, vec![]);

        assert_eq!(dense.count_range(0, 4), 3);
        assert_eq!(dense.count_range(0, 2), 2);
        assert_eq!(dense.count_range(1, 1), 0); // NAN only
        assert_eq!(dense.count_range(2, 2), 1);
    }

    // -----------------------------------------------------------------------
    // 7. test_min_max_range
    // -----------------------------------------------------------------------

    #[test]
    fn test_min_max_range() {
        let dense = DenseColumn::new(vec![3.0, f64::NAN, 1.0, f64::NAN, 5.0, 2.0], 4, 0, vec![]);

        assert_eq!(dense.min_range(0, 5), Some(1.0));
        assert_eq!(dense.max_range(0, 5), Some(5.0));
        assert_eq!(dense.min_range(0, 0), Some(3.0));
        assert_eq!(dense.max_range(4, 5), Some(5.0));
        assert_eq!(dense.min_range(1, 1), None); // NAN only
        assert_eq!(dense.max_range(1, 1), None); // NAN only
    }

    // -----------------------------------------------------------------------
    // 8. test_average_range
    // -----------------------------------------------------------------------

    #[test]
    fn test_average_range() {
        let dense = DenseColumn::new(vec![2.0, 4.0, 6.0], 3, 0, vec![]);

        assert_eq!(dense.average_range(0, 2), Some(4.0));
        assert_eq!(dense.average_range(0, 0), Some(2.0));
        assert_eq!(dense.average_range(1, 2), Some(5.0));
    }

    // -----------------------------------------------------------------------
    // 9. test_average_empty_range
    // -----------------------------------------------------------------------

    #[test]
    fn test_average_empty_range() {
        let dense = DenseColumn::new(vec![f64::NAN, f64::NAN, f64::NAN], 0, 0, vec![]);

        assert_eq!(dense.average_range(0, 2), None);
    }

    // -----------------------------------------------------------------------
    // 10. test_invalidate_column
    // -----------------------------------------------------------------------

    #[test]
    fn test_invalidate_column() {
        let sheet_id = make_sheet_id(1);
        let mut sheet = make_empty_sheet(sheet_id, 10, 5);
        insert_cell(&mut sheet, 0, 0, CellValue::Number(FiniteF64::must(42.0)));

        let mut cache = DenseColumnCache::new();
        cache.materialize(&sheet_id, 0, &sheet);
        assert!(cache.get(&sheet_id, 0).is_some());

        cache.invalidate(&sheet_id, 0);
        assert!(cache.get(&sheet_id, 0).is_none());
    }

    // -----------------------------------------------------------------------
    // 11. test_invalidate_sheet
    // -----------------------------------------------------------------------

    #[test]
    fn test_invalidate_sheet() {
        let sheet_id1 = make_sheet_id(1);
        let sheet_id2 = make_sheet_id(2);
        let sheet1 = make_empty_sheet(sheet_id1, 10, 5);
        let sheet2 = make_empty_sheet(sheet_id2, 10, 5);

        let mut cache = DenseColumnCache::new();
        cache.materialize(&sheet_id1, 0, &sheet1);
        cache.materialize(&sheet_id1, 1, &sheet1);
        cache.materialize(&sheet_id2, 0, &sheet2);

        assert_eq!(cache.len(), 3);

        // Invalidate sheet 1 -- should remove 2 columns, keep 1
        cache.invalidate_sheet(&sheet_id1);
        assert_eq!(cache.len(), 1);
        assert!(cache.get(&sheet_id1, 0).is_none());
        assert!(cache.get(&sheet_id1, 1).is_none());
        assert!(cache.get(&sheet_id2, 0).is_some());
    }

    // -----------------------------------------------------------------------
    // 12. test_invalidate_all
    // -----------------------------------------------------------------------

    #[test]
    fn test_invalidate_all() {
        let sheet_id1 = make_sheet_id(1);
        let sheet_id2 = make_sheet_id(2);
        let sheet1 = make_empty_sheet(sheet_id1, 10, 5);
        let sheet2 = make_empty_sheet(sheet_id2, 10, 5);

        let mut cache = DenseColumnCache::new();
        cache.materialize(&sheet_id1, 0, &sheet1);
        cache.materialize(&sheet_id2, 0, &sheet2);
        assert_eq!(cache.len(), 2);

        cache.invalidate_all();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    // -----------------------------------------------------------------------
    // 13. test_materialize_after_invalidate
    // -----------------------------------------------------------------------

    #[test]
    fn test_materialize_after_invalidate() {
        let sheet_id = make_sheet_id(1);
        let mut sheet = make_empty_sheet(sheet_id, 10, 5);
        insert_cell(&mut sheet, 0, 0, CellValue::Number(FiniteF64::must(10.0)));

        let mut cache = DenseColumnCache::new();
        let dense = cache.materialize(&sheet_id, 0, &sheet);
        assert_eq!(dense.values()[0], 10.0);

        // Invalidate
        cache.invalidate(&sheet_id, 0);
        assert!(cache.get(&sheet_id, 0).is_none());

        // Mutate the sheet (simulate a cell write)
        insert_cell(&mut sheet, 0, 0, CellValue::Number(FiniteF64::must(99.0)));

        // Re-materialize
        let dense = cache.materialize(&sheet_id, 0, &sheet);
        assert_eq!(dense.values()[0], 99.0);
        assert_eq!(dense.numeric_count(), 1);
    }

    // -----------------------------------------------------------------------
    // 14. test_large_column_sum
    // -----------------------------------------------------------------------

    #[test]
    fn test_large_column_sum() {
        let sheet_id = make_sheet_id(1);
        let num_rows = 10_000u32;
        let mut sheet = make_empty_sheet(sheet_id, num_rows, 1);

        // Insert numbers 1..=10000 into column 0
        for row in 0..num_rows {
            let cell_id = make_cell_id(row as u128);
            let entry = CellEntry {
                value: CellValue::Number(FiniteF64::must((row + 1) as f64)),
                formula: None,
            };
            sheet.cells.insert(cell_id, entry);
            sheet.pos_to_id.insert(SheetPos::new(row, 0), cell_id);
            sheet.id_to_pos.insert(cell_id, SheetPos::new(row, 0));
        }

        let mut cache = DenseColumnCache::new();
        let dense = cache.materialize(&sheet_id, 0, &sheet);

        assert_eq!(dense.numeric_count(), 10_000);
        // Sum of 1..=10000 = 10000 * 10001 / 2 = 50_005_000
        let expected_sum: f64 = 50_005_000.0;
        assert_eq!(dense.sum_range(0, num_rows - 1), expected_sum);

        // Verify count
        assert_eq!(dense.count_range(0, num_rows - 1), 10_000);

        // Verify min/max
        assert_eq!(dense.min_range(0, num_rows - 1), Some(1.0));
        assert_eq!(dense.max_range(0, num_rows - 1), Some(10_000.0));

        // Verify average
        assert_eq!(dense.average_range(0, num_rows - 1), Some(5000.5));
    }

    // -----------------------------------------------------------------------
    // 15. test_boolean_coercion
    // -----------------------------------------------------------------------

    #[test]
    fn test_boolean_coercion() {
        let sheet_id = make_sheet_id(1);
        let mut sheet = make_empty_sheet(sheet_id, 4, 1);

        insert_cell(&mut sheet, 0, 0, CellValue::Boolean(true));
        insert_cell(&mut sheet, 1, 0, CellValue::Boolean(false));
        insert_cell(&mut sheet, 2, 0, CellValue::Boolean(true));
        insert_cell(&mut sheet, 3, 0, CellValue::Boolean(true));

        let mut cache = DenseColumnCache::new();
        let dense = cache.materialize(&sheet_id, 0, &sheet);

        assert_eq!(dense.numeric_count(), 4);
        assert_eq!(dense.values()[0], 1.0); // TRUE
        assert_eq!(dense.values()[1], 0.0); // FALSE
        assert_eq!(dense.values()[2], 1.0); // TRUE
        assert_eq!(dense.values()[3], 1.0); // TRUE

        // Sum should be 3.0 (three TRUEs)
        assert_eq!(dense.sum_range(0, 3), 3.0);
        assert_eq!(dense.count_range(0, 3), 4);
        assert_eq!(dense.min_range(0, 3), Some(0.0));
        assert_eq!(dense.max_range(0, 3), Some(1.0));
        assert_eq!(dense.average_range(0, 3), Some(0.75));
    }

    // -----------------------------------------------------------------------
    // Additional edge case tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_sum_range_out_of_bounds() {
        let dense = DenseColumn::new(vec![1.0, 2.0, 3.0], 3, 0, vec![]);

        // end_row past the end of the vector -- should clamp
        assert_eq!(dense.sum_range(0, 100), 6.0);
    }

    #[test]
    fn test_empty_cache() {
        let cache = DenseColumnCache::new();
        assert!(cache.is_empty());
        assert_eq!(cache.len(), 0);
        let sheet_id = make_sheet_id(1);
        assert!(cache.get(&sheet_id, 0).is_none());
    }

    #[test]
    fn test_multiple_columns_same_sheet() {
        let sheet_id = make_sheet_id(1);
        let mut sheet = make_empty_sheet(sheet_id, 5, 3);

        // Column 0: numbers
        insert_cell(&mut sheet, 0, 0, CellValue::Number(FiniteF64::must(10.0)));
        insert_cell(&mut sheet, 1, 0, CellValue::Number(FiniteF64::must(20.0)));

        // Column 1: mixed
        insert_cell(&mut sheet, 0, 1, CellValue::Number(FiniteF64::must(100.0)));
        insert_cell(&mut sheet, 1, 1, CellValue::Text("x".into()));

        // Column 2: booleans
        insert_cell(&mut sheet, 0, 2, CellValue::Boolean(true));

        let mut cache = DenseColumnCache::new();
        cache.materialize(&sheet_id, 0, &sheet);
        cache.materialize(&sheet_id, 1, &sheet);
        cache.materialize(&sheet_id, 2, &sheet);

        assert_eq!(cache.len(), 3);

        let col0 = cache.get(&sheet_id, 0).unwrap();
        assert_eq!(col0.sum_range(0, 4), 30.0);

        let col1 = cache.get(&sheet_id, 1).unwrap();
        assert_eq!(col1.sum_range(0, 4), 100.0);
        assert_eq!(col1.count_range(0, 4), 1);

        let col2 = cache.get(&sheet_id, 2).unwrap();
        assert_eq!(col2.sum_range(0, 4), 1.0);
    }

    #[test]
    fn test_default_impl() {
        let cache = DenseColumnCache::default();
        assert!(cache.is_empty());
    }

    #[test]
    fn test_resolve_slice_bounds_with_start_row_offset() {
        // DenseColumn starting at row 5
        let dense = DenseColumn::new(vec![10.0, 20.0, 30.0, 40.0, 50.0], 5, 5, vec![]);

        // Query rows 5..=9 (maps to indices 0..=4)
        assert_eq!(dense.sum_range(5, 9), 150.0);
        assert_eq!(dense.sum_range(6, 8), 90.0);
        assert_eq!(dense.count_range(5, 9), 5);
        assert_eq!(dense.min_range(5, 9), Some(10.0));
        assert_eq!(dense.max_range(5, 9), Some(50.0));
    }

    #[test]
    fn test_invalidate_nonexistent() {
        let mut cache = DenseColumnCache::new();
        let sheet_id = make_sheet_id(1);
        // Should not panic
        cache.invalidate(&sheet_id, 0);
        cache.invalidate_sheet(&sheet_id);
        cache.invalidate_all();
    }

    // -----------------------------------------------------------------------
    // DenseBoolMask tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_bool_mask_empty() {
        let mask = DenseBoolMask::new(vec![0u64; 2], 0, 128);
        assert!(mask.is_empty());
        assert!(!mask.is_bool(0));
        assert!(!mask.is_bool(63));
        assert!(!mask.is_bool(64));
        assert!(!mask.is_bool(127));
    }

    #[test]
    fn test_bool_mask_is_bool() {
        let mut mask = DenseBoolMask::new(vec![0u64; 2], 0, 128);
        // Set bits at positions 0, 5, 63, 64, 100
        mask.set_bit(0);
        mask.set_bit(5);
        mask.set_bit(63);
        mask.set_bit(64);
        mask.set_bit(100);

        assert!(mask.is_bool(0));
        assert!(!mask.is_bool(1));
        assert!(mask.is_bool(5));
        assert!(!mask.is_bool(6));
        assert!(mask.is_bool(63));
        assert!(mask.is_bool(64));
        assert!(!mask.is_bool(65));
        assert!(mask.is_bool(100));
        assert!(!mask.is_bool(101));
        // Out of bounds
        assert!(!mask.is_bool(200));
    }

    #[test]
    fn test_bool_mask_any_in_range() {
        let mut mask = DenseBoolMask::new(vec![0u64; 2], 0, 128);
        mask.set_bit(10);
        mask.set_bit(70);

        // Ranges containing booleans
        assert!(mask.any_in_range(0, 20));
        assert!(mask.any_in_range(10, 11));
        assert!(mask.any_in_range(65, 80));

        // Ranges without booleans
        assert!(!mask.any_in_range(0, 10));
        assert!(!mask.any_in_range(11, 70));
        assert!(!mask.any_in_range(71, 128));

        // Empty/invalid ranges
        assert!(!mask.any_in_range(5, 5));
        assert!(!mask.any_in_range(10, 5));
    }

    #[test]
    fn test_bool_mask_count_in_range() {
        let mut mask = DenseBoolMask::new(vec![0u64; 2], 0, 128);
        mask.set_bit(1);
        mask.set_bit(3);
        mask.set_bit(5);
        mask.set_bit(64);

        assert_eq!(mask.count_in_range(0, 10), 3);
        assert_eq!(mask.count_in_range(0, 128), 4);
        assert_eq!(mask.count_in_range(2, 4), 1); // only bit 3
        assert_eq!(mask.count_in_range(60, 70), 1); // only bit 64
        assert_eq!(mask.count_in_range(10, 60), 0);
        assert_eq!(mask.count_in_range(5, 5), 0); // empty range
    }

    #[test]
    fn test_bool_mask_bool_sum() {
        let mut mask = DenseBoolMask::new(vec![0u64; 1], 0, 5);
        // values: [1.0, TRUE(1.0), 3.0, FALSE(0.0), 5.0]
        // bools at indices 1 and 3
        mask.set_bit(1);
        mask.set_bit(3);

        let values = vec![1.0, 1.0, 3.0, 0.0, 5.0];
        // bool_sum should return 1.0 (TRUE) + 0.0 (FALSE) = 1.0
        assert_eq!(mask.bool_sum(&values, 0, 5), 1.0);
        // Only bool at index 1
        assert_eq!(mask.bool_sum(&values, 0, 2), 1.0);
        // Only bool at index 3
        assert_eq!(mask.bool_sum(&values, 2, 5), 0.0);
    }

    #[test]
    fn test_materialize_with_mask() {
        let sheet_id = make_sheet_id(1);
        let mut sheet = make_empty_sheet(sheet_id, 10, 1);

        insert_cell(&mut sheet, 0, 0, CellValue::Number(FiniteF64::must(42.0)));
        insert_cell(&mut sheet, 1, 0, CellValue::Text("hello".into()));
        insert_cell(&mut sheet, 2, 0, CellValue::Boolean(true));
        insert_cell(&mut sheet, 3, 0, CellValue::Boolean(false));
        insert_cell(&mut sheet, 4, 0, CellValue::Number(FiniteF64::must(7.0)));

        let mut cache = DenseColumnCache::new();
        cache.materialize(&sheet_id, 0, &sheet);

        // Check the bool mask was produced
        let mask = cache.get_bool_mask(&sheet_id, 0).unwrap();
        assert!(!mask.is_bool(0)); // Number
        assert!(!mask.is_bool(1)); // Text (NAN)
        assert!(mask.is_bool(2)); // Boolean(true)
        assert!(mask.is_bool(3)); // Boolean(false)
        assert!(!mask.is_bool(4)); // Number
        assert!(!mask.is_bool(5)); // Empty (NAN)

        assert!(!mask.is_empty());
        assert_eq!(mask.count_in_range(0, 10), 2);
        assert!(mask.any_in_range(2, 4));
        assert!(!mask.any_in_range(0, 2));
    }

    #[test]
    fn test_store_dense() {
        let mut cache = DenseColumnCache::new();
        let sheet_id = make_sheet_id(1);
        let dense = DenseColumn::new(vec![1.0, 2.0, 3.0], 3, 0, vec![]);
        let mask = DenseBoolMask::new(vec![0u64], 0, 3);
        cache.store_dense(sheet_id, 0, dense, mask);
        assert!(cache.get(&sheet_id, 0).is_some());
        assert!(cache.get_bool_mask(&sheet_id, 0).is_some());
    }

    #[test]
    fn test_invalidate_clears_bool_mask() {
        let sheet_id = make_sheet_id(1);
        let mut sheet = make_empty_sheet(sheet_id, 5, 1);
        insert_cell(&mut sheet, 0, 0, CellValue::Boolean(true));

        let mut cache = DenseColumnCache::new();
        cache.materialize(&sheet_id, 0, &sheet);
        assert!(cache.get_bool_mask(&sheet_id, 0).is_some());

        cache.invalidate(&sheet_id, 0);
        assert!(cache.get_bool_mask(&sheet_id, 0).is_none());
    }

    #[test]
    fn test_invalidate_sheet_clears_bool_masks() {
        let sheet_id = make_sheet_id(1);
        let sheet = make_empty_sheet(sheet_id, 5, 2);

        let mut cache = DenseColumnCache::new();
        cache.materialize(&sheet_id, 0, &sheet);
        cache.materialize(&sheet_id, 1, &sheet);
        assert!(cache.get_bool_mask(&sheet_id, 0).is_some());
        assert!(cache.get_bool_mask(&sheet_id, 1).is_some());

        cache.invalidate_sheet(&sheet_id);
        assert!(cache.get_bool_mask(&sheet_id, 0).is_none());
        assert!(cache.get_bool_mask(&sheet_id, 1).is_none());
    }

    #[test]
    fn test_invalidate_all_clears_bool_masks() {
        let sheet_id = make_sheet_id(1);
        let sheet = make_empty_sheet(sheet_id, 5, 1);

        let mut cache = DenseColumnCache::new();
        cache.materialize(&sheet_id, 0, &sheet);
        assert!(cache.get_bool_mask(&sheet_id, 0).is_some());

        cache.invalidate_all();
        assert!(cache.get_bool_mask(&sheet_id, 0).is_none());
    }
}
