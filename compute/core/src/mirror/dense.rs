//! Dense columnar store for SIMD-accelerated aggregation.
//!
//! Materializes columns as contiguous `Vec<f64>` for fast aggregation (SUM, AVERAGE, COUNT,
//! MIN, MAX over large ranges). Dense columns enable SIMD-friendly linear scans instead of
//! cell-by-cell `FxHashMap` lookups (~5ns each).
//!
//! # Design
//!
//! - **Lazy**: columns are only materialized when requested by a large-range aggregate.
//! - **Dirty-on-write**: any write to a cell in a cached column invalidates that column.
//! - **NAN sentinel**: non-numeric cells are stored as `f64::NAN`, skipped during aggregation.
//! - **Threshold**: only used for ranges > `DENSE_THRESHOLD` cells; below that, direct
//!   FxHashMap iteration is fast enough.

use rustc_hash::FxHashMap;

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
/// - **Dirty-on-write**: any write to a cell in a cached column invalidates that column.
#[derive(Debug, Clone)]
pub struct DenseColumnCache {
    columns: FxHashMap<ColumnKey, DenseColumn>,
    bool_masks: FxHashMap<ColumnKey, DenseBoolMask>,
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
            bool_masks: FxHashMap::default(),
        }
    }

    /// Get a cached dense column, or `None` if not materialized or dirty.
    pub fn get(&self, sheet: &SheetId, col: u32) -> Option<&DenseColumn> {
        self.columns.get(&(*sheet, col))
    }

    /// Get a cached bool mask, or `None` if not materialized or dirty.
    pub fn get_bool_mask(&self, sheet: &SheetId, col: u32) -> Option<&DenseBoolMask> {
        self.bool_masks.get(&(*sheet, col))
    }

    /// Materialize a column from the `SheetMirror`'s data.
    /// Reads all cells in the column and builds a contiguous `Vec<f64>`.
    /// Also produces a `DenseBoolMask` tracking which rows are boolean-sourced.
    ///
    /// Prefers `col_data` when it exists for the column (includes projected values
    /// from dynamic array materialization), falling back to the sparse `cells` map
    /// via `pos_to_id` when col_data doesn't have that column.
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

        // Prefer col_data when available — it includes projected values from
        // dynamic array materialization alongside regular cell values.
        if let Some(col_slice) = sheet_mirror.get_column_slice(col) {
            let len = (rows as usize).min(col_slice.len());
            for row in 0..len {
                match &col_slice[row] {
                    CellValue::Number(n) => {
                        values[row] = n.get();
                        numeric_count += 1;
                    }
                    CellValue::Boolean(b) => {
                        values[row] = if *b { 1.0 } else { 0.0 };
                        numeric_count += 1;
                        mask.set_bit(row);
                    }
                    CellValue::Error(e, _) => {
                        errors.push((row as u32, *e));
                    }
                    _ => {} // NAN remains for non-numeric
                }
            }
        } else {
            // Fallback: sparse cell-by-cell lookup via pos_to_id + cells map.
            for row in 0..rows {
                if let Some(cell_id) = sheet_mirror
                    .pos_to_id
                    .get(&cell_types::SheetPos::new(row, col))
                    && let Some(entry) = sheet_mirror.cells.get(cell_id)
                {
                    match &entry.value {
                        CellValue::Number(n) => {
                            values[row as usize] = n.get();
                            numeric_count += 1;
                        }
                        CellValue::Boolean(b) => {
                            values[row as usize] = if *b { 1.0 } else { 0.0 };
                            numeric_count += 1;
                            mask.set_bit(row as usize);
                        }
                        CellValue::Error(e, _) => {
                            errors.push((row, *e));
                        }
                        _ => {} // NAN remains for non-numeric
                    }
                }
            }
        }

        let key = (*sheet, col);
        self.columns
            .insert(key, DenseColumn::new(values, numeric_count, 0, errors));
        self.bool_masks.insert(key, mask);
        self.columns.get(&key).unwrap()
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
        let key = (sheet, col);
        self.columns.insert(key, dense);
        self.bool_masks.insert(key, mask);
    }

    /// Invalidate a column (called when any cell in that column is written).
    pub fn invalidate(&mut self, sheet: &SheetId, col: u32) {
        let key = (*sheet, col);
        self.columns.remove(&key);
        self.bool_masks.remove(&key);
    }

    /// Invalidate all columns for a sheet (called on structural changes).
    pub fn invalidate_sheet(&mut self, sheet: &SheetId) {
        self.columns.retain(|(s, _), _| s != sheet);
        self.bool_masks.retain(|(s, _), _| s != sheet);
    }

    /// Invalidate everything.
    pub fn invalidate_all(&mut self) {
        self.columns.clear();
        self.bool_masks.clear();
    }

    /// Number of cached columns (for testing/diagnostics).
    pub fn len(&self) -> usize {
        self.columns.len()
    }

    /// Whether the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.columns.is_empty()
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
