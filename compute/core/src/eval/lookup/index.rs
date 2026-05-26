//! Subsystem 3: LookupIndex
//! Sorted/hashed column index for O(log n) VLOOKUP/MATCH.
//!
//! Built lazily from column data when a column is clean. Knows about
//! `CellValue`, `f64`, `String`. Does NOT know about evaluation,
//! dirty tracking, or the executor.

use ordered_float::OrderedFloat;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use value_types::CellValue;
use value_types::DenseColumn;

// ---------------------------------------------------------------------------
// LookupIndex
// ---------------------------------------------------------------------------

/// Sorted and hashed column index for O(log n) lookups.
pub struct LookupIndex {
    /// (value, row) sorted ascending by value -- for approximate match
    sorted_numeric: Vec<(f64, u32)>,
    /// (lowercase_value, row) sorted ascending -- for text approximate match
    sorted_string: Vec<(String, u32)>,
    /// value -> [rows] -- for exact numeric match (first row in row order)
    exact_numeric: FxHashMap<OrderedFloat<f64>, SmallVec<[u32; 1]>>,
    /// lowercase_value -> [rows] -- for exact text match
    exact_text: FxHashMap<String, SmallVec<[u32; 1]>>,
    /// All (lowercase_value, row) pairs in row order -- for wildcard scan
    text_by_row: Vec<(String, u32)>,
    /// True when this index was built from a dense (numeric-only) source and
    /// the source column had non-numeric cells that were not indexed.  Text
    /// searches against such an index are unreliable and callers should treat
    /// a `None` result as "not available" rather than "not found".
    has_unindexed_text: bool,
}

impl LookupIndex {
    /// Build from an iterator of (row, cell_value) pairs. O(n log n).
    /// Error values and null values are excluded from all indexes.
    /// NaN values from DenseColumn are also excluded.
    pub fn build(values: impl Iterator<Item = (u32, CellValue)>) -> Self {
        let mut sorted_numeric: Vec<(f64, u32)> = Vec::new();
        let mut sorted_string: Vec<(String, u32)> = Vec::new();
        let mut exact_numeric: FxHashMap<OrderedFloat<f64>, SmallVec<[u32; 1]>> =
            FxHashMap::default();
        let mut exact_text: FxHashMap<String, SmallVec<[u32; 1]>> = FxHashMap::default();
        let mut text_by_row: Vec<(String, u32)> = Vec::new();

        for (row, value) in values {
            match value {
                CellValue::Number(n) => {
                    let v = n.get();
                    sorted_numeric.push((v, row));
                    exact_numeric.entry(OrderedFloat(v)).or_default().push(row);
                }
                CellValue::Text(s) => {
                    let lower = s.to_lowercase();
                    sorted_string.push((lower.clone(), row));
                    exact_text.entry(lower.clone()).or_default().push(row);
                    text_by_row.push((lower, row));
                }
                // Boolean, Error, Null, Array, Lambda — skip
                _ => {}
            }
        }

        // Sort sorted_numeric by value (stable sort preserves row order for equal values)
        sorted_numeric.sort_by(|a, b| a.0.total_cmp(&b.0));

        // Sort sorted_string by lowercase text
        sorted_string.sort_by(|a, b| a.0.cmp(&b.0));

        // Sort text_by_row by row number
        text_by_row.sort_by_key(|&(_, row)| row);

        // Ensure SmallVec entries are sorted by row
        for rows in exact_numeric.values_mut() {
            rows.sort_unstable();
        }
        for rows in exact_text.values_mut() {
            rows.sort_unstable();
        }

        Self {
            sorted_numeric,
            sorted_string,
            exact_numeric,
            exact_text,
            text_by_row,
            has_unindexed_text: false,
        }
    }

    /// Build from a DenseColumn (numeric only, faster path).
    /// Skips NaN entries.
    pub fn build_from_dense(dense: &DenseColumn) -> Self {
        let mut sorted_numeric: Vec<(f64, u32)> = Vec::new();
        let mut exact_numeric: FxHashMap<OrderedFloat<f64>, SmallVec<[u32; 1]>> =
            FxHashMap::default();

        for (i, &v) in dense.values().iter().enumerate() {
            if v.is_nan() {
                continue;
            }
            let row = dense.start_row() + i as u32;
            sorted_numeric.push((v, row));
            exact_numeric.entry(OrderedFloat(v)).or_default().push(row);
        }

        // Sort by value (stable sort preserves row order for equal values)
        sorted_numeric.sort_by(|a, b| a.0.total_cmp(&b.0));

        // Ensure SmallVec entries are sorted by row
        for rows in exact_numeric.values_mut() {
            rows.sort_unstable();
        }

        // If there are NaN entries (non-numeric cells) in the dense column,
        // those cells may contain text that we cannot index from the numeric-
        // only DenseColumn representation.  Flag this so callers know text
        // search results are unreliable.
        let has_unindexed_text = dense.numeric_count() < dense.values().len();

        Self {
            sorted_numeric,
            sorted_string: Vec::new(),
            exact_numeric,
            exact_text: FxHashMap::default(),
            text_by_row: Vec::new(),
            has_unindexed_text,
        }
    }

    /// Returns true when this index was built from a dense (numeric-only)
    /// source and the column contained non-numeric cells that could not be
    /// indexed.  Text searches against such an index may return false negatives.
    pub fn has_unindexed_text(&self) -> bool {
        self.has_unindexed_text
    }

    /// Largest value <= target. Returns row number.
    pub fn search_leq_numeric(&self, target: f64) -> Option<u32> {
        if self.sorted_numeric.is_empty() {
            return None;
        }
        // partition_point returns the first index where value > target
        let idx = self
            .sorted_numeric
            .partition_point(|&(v, _)| v.total_cmp(&target) != std::cmp::Ordering::Greater);
        if idx == 0 {
            None
        } else {
            Some(self.sorted_numeric[idx - 1].1)
        }
    }

    /// Largest text <= target (case-insensitive). Returns row number.
    pub fn search_leq_text(&self, target: &str) -> Option<u32> {
        if self.sorted_string.is_empty() {
            return None;
        }
        let target_lower = target.to_lowercase();
        // partition_point returns the first index where value > target
        let idx = self
            .sorted_string
            .partition_point(|entry| entry.0.as_str() <= target_lower.as_str());
        if idx == 0 {
            None
        } else {
            Some(self.sorted_string[idx - 1].1)
        }
    }

    /// Smallest value >= target. Returns row number.
    pub fn search_geq_numeric(&self, target: f64) -> Option<u32> {
        if self.sorted_numeric.is_empty() {
            return None;
        }
        // partition_point returns the first index where value >= target
        let idx = self
            .sorted_numeric
            .partition_point(|&(v, _)| v.total_cmp(&target) == std::cmp::Ordering::Less);
        if idx >= self.sorted_numeric.len() {
            None
        } else {
            Some(self.sorted_numeric[idx].1)
        }
    }

    /// Smallest text >= target (case-insensitive). Returns row number.
    pub fn search_geq_text(&self, target: &str) -> Option<u32> {
        if self.sorted_string.is_empty() {
            return None;
        }
        let target_lower = target.to_lowercase();
        let idx = self
            .sorted_string
            .partition_point(|entry| entry.0.as_str() < target_lower.as_str());
        if idx >= self.sorted_string.len() {
            None
        } else {
            Some(self.sorted_string[idx].1)
        }
    }

    /// Exact match. Returns first matching row in row order.
    pub fn search_exact_numeric(&self, target: f64) -> Option<u32> {
        self.exact_numeric
            .get(&OrderedFloat(target))
            .map(|rows| rows[0])
    }

    /// Exact text match (case-insensitive). Returns first matching row in row order.
    pub fn search_exact_text(&self, target: &str) -> Option<u32> {
        let lower = target.to_lowercase();
        self.exact_text.get(&lower).map(|rows| rows[0])
    }

    // -----------------------------------------------------------------------
    // Incremental update
    // -----------------------------------------------------------------------

    /// Incrementally update the index for changed rows.
    ///
    /// Each element of `changes` is `(row, old_value, new_value)`. The old value
    /// is removed from all internal structures, then the new value is inserted.
    /// This is O(delta * log n) instead of O(n log n) for a full rebuild.
    pub fn update(&mut self, changes: &[(u32, CellValue, CellValue)]) {
        for (row, old_val, new_val) in changes {
            self.remove_entry(*row, old_val);
            self.insert_entry(*row, new_val);
        }
    }

    /// Remove a single (row, value) entry from all internal index structures.
    fn remove_entry(&mut self, row: u32, value: &CellValue) {
        match value {
            CellValue::Number(n) => {
                let v = n.get();
                // Remove from sorted_numeric
                if let Some(pos) = self
                    .sorted_numeric
                    .iter()
                    .position(|&(val, r)| r == row && val.to_bits() == v.to_bits())
                {
                    self.sorted_numeric.remove(pos);
                }
                // Remove from exact_numeric
                let key = OrderedFloat(v);
                if let Some(rows) = self.exact_numeric.get_mut(&key) {
                    rows.retain(|r| *r != row);
                    if rows.is_empty() {
                        self.exact_numeric.remove(&key);
                    }
                }
            }
            CellValue::Text(s) => {
                let lower = s.to_lowercase();
                // Remove from sorted_string
                if let Some(pos) = self
                    .sorted_string
                    .iter()
                    .position(|entry| entry.1 == row && entry.0 == lower)
                {
                    self.sorted_string.remove(pos);
                }
                // Remove from exact_text
                if let Some(rows) = self.exact_text.get_mut(&lower) {
                    rows.retain(|r| *r != row);
                    if rows.is_empty() {
                        self.exact_text.remove(&lower);
                    }
                }
                // Remove from text_by_row
                if let Some(pos) = self
                    .text_by_row
                    .iter()
                    .position(|entry| entry.1 == row && entry.0 == lower)
                {
                    self.text_by_row.remove(pos);
                }
            }
            // Boolean, Error, Null, Array, Lambda — not indexed, nothing to remove
            _ => {}
        }
    }

    /// Insert a single (row, value) entry into all internal index structures,
    /// maintaining sort order.
    fn insert_entry(&mut self, row: u32, value: &CellValue) {
        match value {
            CellValue::Number(n) => {
                let v = n.get();
                // Insert into sorted_numeric (maintain sort by value)
                let pos = self
                    .sorted_numeric
                    .partition_point(|&(val, _)| val.total_cmp(&v) == std::cmp::Ordering::Less);
                self.sorted_numeric.insert(pos, (v, row));
                // Insert into exact_numeric
                self.exact_numeric
                    .entry(OrderedFloat(v))
                    .or_default()
                    .push(row);
                // Keep SmallVec sorted by row
                if let Some(rows) = self.exact_numeric.get_mut(&OrderedFloat(v)) {
                    rows.sort_unstable();
                }
            }
            CellValue::Text(s) => {
                let lower = s.to_lowercase();
                // Insert into sorted_string (maintain sort by text)
                let pos = self
                    .sorted_string
                    .partition_point(|entry| entry.0.as_str() < lower.as_str());
                self.sorted_string.insert(pos, (lower.clone(), row));
                // Insert into exact_text
                self.exact_text.entry(lower.clone()).or_default().push(row);
                if let Some(rows) = self.exact_text.get_mut(&lower) {
                    rows.sort_unstable();
                }
                // Insert into text_by_row (maintain sort by row)
                let pos = self.text_by_row.partition_point(|entry| entry.1 < row);
                self.text_by_row.insert(pos, (lower, row));
            }
            // Boolean, Error, Null, Array, Lambda — not indexed
            _ => {}
        }
    }

    /// Wildcard match (* and ?, ~ escape). Returns first matching row.
    ///
    /// Wildcard rules:
    /// - `*` matches any sequence of characters (including empty)
    /// - `?` matches exactly one character
    /// - `~*` matches literal `*`
    /// - `~?` matches literal `?`
    /// - `~~` matches literal `~`
    /// - Case-insensitive
    pub fn search_wildcard(&self, pattern: &str) -> Option<u32> {
        let pattern_lower = pattern.to_lowercase();
        let compiled = compile_wildcard(&pattern_lower);

        for (text, row) in &self.text_by_row {
            if wildcard_match(&compiled, text) {
                return Some(*row);
            }
        }
        None
    }
}

use super::wildcard::{compile_wildcard, wildcard_match};

// ---------------------------------------------------------------------------
// HorizontalLookupIndex — row-oriented index for O(log n) HLOOKUP
// ---------------------------------------------------------------------------

/// Row-oriented lookup index for O(log n) HLOOKUP.
///
/// This is the horizontal mirror of `LookupIndex`. Instead of indexing a
/// column's values by row, it indexes a row's values by column. The search
/// methods return **column numbers** instead of row numbers.
pub struct HorizontalLookupIndex {
    /// (value, col) sorted ascending by value -- for approximate match
    sorted_numeric: Vec<(f64, u32)>,
    /// (lowercase_value, col) sorted ascending -- for text approximate match
    sorted_string: Vec<(String, u32)>,
    /// value -> [cols] -- for exact numeric match (first col in col order)
    exact_numeric: FxHashMap<OrderedFloat<f64>, SmallVec<[u32; 1]>>,
    /// lowercase_value -> [cols] -- for exact text match
    exact_text: FxHashMap<String, SmallVec<[u32; 1]>>,
    /// All (lowercase_value, col) pairs in column order -- for wildcard scan
    text_by_col: Vec<(String, u32)>,
}

impl HorizontalLookupIndex {
    /// Build from an iterator of (col, cell_value) pairs. O(n log n).
    /// Error values and null values are excluded from all indexes.
    pub fn build(values: impl Iterator<Item = (u32, CellValue)>) -> Self {
        let mut sorted_numeric: Vec<(f64, u32)> = Vec::new();
        let mut sorted_string: Vec<(String, u32)> = Vec::new();
        let mut exact_numeric: FxHashMap<OrderedFloat<f64>, SmallVec<[u32; 1]>> =
            FxHashMap::default();
        let mut exact_text: FxHashMap<String, SmallVec<[u32; 1]>> = FxHashMap::default();
        let mut text_by_col: Vec<(String, u32)> = Vec::new();

        for (col, value) in values {
            match value {
                CellValue::Number(n) => {
                    let v = n.get();
                    sorted_numeric.push((v, col));
                    exact_numeric.entry(OrderedFloat(v)).or_default().push(col);
                }
                CellValue::Text(s) => {
                    let lower = s.to_lowercase();
                    sorted_string.push((lower.clone(), col));
                    exact_text.entry(lower.clone()).or_default().push(col);
                    text_by_col.push((lower, col));
                }
                _ => {}
            }
        }

        sorted_numeric.sort_by(|a, b| a.0.total_cmp(&b.0));
        sorted_string.sort_by(|a, b| a.0.cmp(&b.0));
        text_by_col.sort_by_key(|&(_, col)| col);

        for cols in exact_numeric.values_mut() {
            cols.sort_unstable();
        }
        for cols in exact_text.values_mut() {
            cols.sort_unstable();
        }

        Self {
            sorted_numeric,
            sorted_string,
            exact_numeric,
            exact_text,
            text_by_col,
        }
    }

    /// Largest value <= target. Returns column number.
    pub fn search_leq_numeric(&self, target: f64) -> Option<u32> {
        if self.sorted_numeric.is_empty() {
            return None;
        }
        let idx = self
            .sorted_numeric
            .partition_point(|&(v, _)| v.total_cmp(&target) != std::cmp::Ordering::Greater);
        if idx == 0 {
            None
        } else {
            Some(self.sorted_numeric[idx - 1].1)
        }
    }

    /// Largest text <= target (case-insensitive). Returns column number.
    pub fn search_leq_text(&self, target: &str) -> Option<u32> {
        if self.sorted_string.is_empty() {
            return None;
        }
        let target_lower = target.to_lowercase();
        let idx = self
            .sorted_string
            .partition_point(|entry| entry.0.as_str() <= target_lower.as_str());
        if idx == 0 {
            None
        } else {
            Some(self.sorted_string[idx - 1].1)
        }
    }

    /// Exact match. Returns first matching column in column order.
    pub fn search_exact_numeric(&self, target: f64) -> Option<u32> {
        self.exact_numeric
            .get(&OrderedFloat(target))
            .map(|cols| cols[0])
    }

    /// Exact text match (case-insensitive). Returns first matching column in column order.
    pub fn search_exact_text(&self, target: &str) -> Option<u32> {
        let lower = target.to_lowercase();
        self.exact_text.get(&lower).map(|cols| cols[0])
    }

    /// Wildcard match (* and ?, ~ escape). Returns first matching column.
    #[allow(dead_code)] // Horizontal wildcard search — wire when HLOOKUP wildcard mode is activated
    pub fn search_wildcard(&self, pattern: &str) -> Option<u32> {
        let pattern_lower = pattern.to_lowercase();
        let compiled = compile_wildcard(&pattern_lower);

        for (text, col) in &self.text_by_col {
            if wildcard_match(&compiled, text) {
                return Some(*col);
            }
        }
        None
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::FiniteF64;

    /// Helper: build a CellValue::Number from a raw f64.
    fn num(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(v))
    }

    /// Helper: build a CellValue::Text.
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    // -----------------------------------------------------------------------
    // test_build_from_numeric_values
    // -----------------------------------------------------------------------

    #[test]
    fn test_build_from_numeric_values() {
        let data = vec![(0u32, num(30.0)), (1, num(10.0)), (2, num(20.0))];
        let idx = LookupIndex::build(data.into_iter());

        // sorted_numeric should be sorted by value
        assert_eq!(idx.sorted_numeric.len(), 3);
        assert_eq!(idx.sorted_numeric[0], (10.0, 1));
        assert_eq!(idx.sorted_numeric[1], (20.0, 2));
        assert_eq!(idx.sorted_numeric[2], (30.0, 0));

        // exact_numeric should have all three values
        assert_eq!(idx.exact_numeric.len(), 3);
        assert_eq!(idx.exact_numeric[&OrderedFloat(10.0)][0], 1);
        assert_eq!(idx.exact_numeric[&OrderedFloat(20.0)][0], 2);
        assert_eq!(idx.exact_numeric[&OrderedFloat(30.0)][0], 0);
    }

    // -----------------------------------------------------------------------
    // test_build_from_mixed_types
    // -----------------------------------------------------------------------

    #[test]
    fn test_build_from_mixed_types() {
        let data = vec![
            (0u32, num(10.0)),
            (1, text("Banana")),
            (2, num(20.0)),
            (3, text("Apple")),
            (4, CellValue::Boolean(true)),
            (5, CellValue::Error(value_types::CellError::Na, None)),
            (6, CellValue::Null),
        ];
        let idx = LookupIndex::build(data.into_iter());

        // Numbers: 10.0 at row 0, 20.0 at row 2
        assert_eq!(idx.sorted_numeric.len(), 2);
        assert_eq!(idx.exact_numeric.len(), 2);

        // Strings: "banana" at row 1, "apple" at row 3
        assert_eq!(idx.sorted_string.len(), 2);
        assert_eq!(idx.exact_text.len(), 2);

        // sorted_string should be sorted: "apple" < "banana"
        assert_eq!(idx.sorted_string[0].0, "apple");
        assert_eq!(idx.sorted_string[0].1, 3);
        assert_eq!(idx.sorted_string[1].0, "banana");
        assert_eq!(idx.sorted_string[1].1, 1);

        // text_by_row should be sorted by row
        assert_eq!(idx.text_by_row.len(), 2);
        assert_eq!(idx.text_by_row[0], ("banana".to_string(), 1));
        assert_eq!(idx.text_by_row[1], ("apple".to_string(), 3));
    }

    // -----------------------------------------------------------------------
    // test_build_from_dense_column
    // -----------------------------------------------------------------------

    #[test]
    fn test_build_from_dense_column() {
        let dense = DenseColumn::new(vec![30.0, f64::NAN, 10.0, 20.0], 3, 0, vec![]);
        let idx = LookupIndex::build_from_dense(&dense);

        // Should skip NaN at index 1
        assert_eq!(idx.sorted_numeric.len(), 3);
        assert_eq!(idx.sorted_numeric[0], (10.0, 2));
        assert_eq!(idx.sorted_numeric[1], (20.0, 3));
        assert_eq!(idx.sorted_numeric[2], (30.0, 0));

        // No text data
        assert!(idx.sorted_string.is_empty());
        assert!(idx.exact_text.is_empty());
        assert!(idx.text_by_row.is_empty());

        // Compare with build() output for same numeric data
        let data = vec![(0u32, num(30.0)), (2, num(10.0)), (3, num(20.0))];
        let idx2 = LookupIndex::build(data.into_iter());
        assert_eq!(idx.sorted_numeric, idx2.sorted_numeric);
    }

    // -----------------------------------------------------------------------
    // test_search_leq_exact_match
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_leq_exact_match() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        // Target exists exactly
        assert_eq!(idx.search_leq_numeric(20.0), Some(1));
        assert_eq!(idx.search_leq_numeric(10.0), Some(0));
        assert_eq!(idx.search_leq_numeric(30.0), Some(2));
    }

    // -----------------------------------------------------------------------
    // test_search_leq_between_values
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_leq_between_values() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        // Target between 10 and 20 -> returns row of 10
        assert_eq!(idx.search_leq_numeric(15.0), Some(0));
        // Target between 20 and 30 -> returns row of 20
        assert_eq!(idx.search_leq_numeric(25.0), Some(1));
        // Target above all -> returns row of 30
        assert_eq!(idx.search_leq_numeric(100.0), Some(2));
    }

    // -----------------------------------------------------------------------
    // test_search_leq_below_minimum
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_leq_below_minimum() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        // Target below all values -> None
        assert_eq!(idx.search_leq_numeric(5.0), None);
    }

    // -----------------------------------------------------------------------
    // test_search_leq_text
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_leq_text() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("banana")),
            (2, text("Cherry")),
        ];
        let idx = LookupIndex::build(data.into_iter());

        // Case-insensitive: "BANANA" should match
        assert_eq!(idx.search_leq_text("BANANA"), Some(1));
        // "b" is between "apple" and "banana"
        assert_eq!(idx.search_leq_text("b"), Some(0));
        // "d" is above "cherry"
        assert_eq!(idx.search_leq_text("d"), Some(2));
        // "a" is below "apple"
        assert_eq!(idx.search_leq_text("a"), None);
    }

    // -----------------------------------------------------------------------
    // test_search_geq
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_geq() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        // Exact match
        assert_eq!(idx.search_geq_numeric(20.0), Some(1));
        // Between 10 and 20 -> returns row of 20
        assert_eq!(idx.search_geq_numeric(15.0), Some(1));
        // Below all -> returns row of 10
        assert_eq!(idx.search_geq_numeric(5.0), Some(0));
        // Above all -> None
        assert_eq!(idx.search_geq_numeric(35.0), None);
    }

    // -----------------------------------------------------------------------
    // test_search_geq_text
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_geq_text() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("banana")),
            (2, text("Cherry")),
        ];
        let idx = LookupIndex::build(data.into_iter());

        // Exact match (case-insensitive)
        assert_eq!(idx.search_geq_text("BANANA"), Some(1));
        // "b" is between "apple" and "banana" -> returns banana
        assert_eq!(idx.search_geq_text("b"), Some(1));
        // "a" is below "apple" -> returns apple
        assert_eq!(idx.search_geq_text("a"), Some(0));
        // "z" is above everything -> None
        assert_eq!(idx.search_geq_text("z"), None);
    }

    // -----------------------------------------------------------------------
    // test_search_exact_numeric
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_exact_numeric() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_exact_numeric(20.0), Some(1));
        assert_eq!(idx.search_exact_numeric(10.0), Some(0));
        assert_eq!(idx.search_exact_numeric(30.0), Some(2));
        assert_eq!(idx.search_exact_numeric(15.0), None);
    }

    // -----------------------------------------------------------------------
    // test_search_exact_duplicates
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_exact_duplicates() {
        // Multiple rows with the same value -> first in row order
        let data = vec![(5u32, num(42.0)), (2, num(42.0)), (8, num(42.0))];
        let idx = LookupIndex::build(data.into_iter());

        // First in row order is row 2
        assert_eq!(idx.search_exact_numeric(42.0), Some(2));
    }

    // -----------------------------------------------------------------------
    // test_search_exact_text_case
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_exact_text_case() {
        let data = vec![(0u32, text("Hello")), (1, text("WORLD"))];
        let idx = LookupIndex::build(data.into_iter());

        // "ABC" matches "abc" — case insensitive
        assert_eq!(idx.search_exact_text("hello"), Some(0));
        assert_eq!(idx.search_exact_text("HELLO"), Some(0));
        assert_eq!(idx.search_exact_text("world"), Some(1));
        assert_eq!(idx.search_exact_text("World"), Some(1));
        assert_eq!(idx.search_exact_text("missing"), None);
    }

    // -----------------------------------------------------------------------
    // test_search_wildcard_star
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_wildcard_star() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("Avocado")),
            (2, text("Banana")),
        ];
        let idx = LookupIndex::build(data.into_iter());

        // "A*" matches "Apple" (row 0, first in row order)
        assert_eq!(idx.search_wildcard("A*"), Some(0));
        // "B*" matches "Banana" (row 2)
        assert_eq!(idx.search_wildcard("B*"), Some(2));
        // "*ado" matches "Avocado" (row 1)
        assert_eq!(idx.search_wildcard("*ado"), Some(1));
    }

    // -----------------------------------------------------------------------
    // test_search_wildcard_question
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_wildcard_question() {
        let data = vec![(0u32, text("AB")), (1, text("ABC")), (2, text("A"))];
        let idx = LookupIndex::build(data.into_iter());

        // "A?" matches "AB" (2 chars starting with A) but not "ABC" (3 chars) or "A" (1 char)
        assert_eq!(idx.search_wildcard("A?"), Some(0));
        // "A??" matches "ABC" (3 chars starting with A) but not "AB" or "A"
        assert_eq!(idx.search_wildcard("A??"), Some(1));
    }

    // -----------------------------------------------------------------------
    // test_search_wildcard_tilde_escape
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_wildcard_tilde_escape() {
        let data = vec![(0u32, text("A*B")), (1, text("AXB")), (2, text("AB"))];
        let idx = LookupIndex::build(data.into_iter());

        // "A~*B" matches literal "A*B" (row 0)
        assert_eq!(idx.search_wildcard("A~*B"), Some(0));
    }

    // -----------------------------------------------------------------------
    // test_search_wildcard_no_match
    // -----------------------------------------------------------------------

    #[test]
    fn test_search_wildcard_no_match() {
        let data = vec![(0u32, text("Apple")), (1, text("Banana"))];
        let idx = LookupIndex::build(data.into_iter());

        // Pattern doesn't match anything
        assert_eq!(idx.search_wildcard("Z*"), None);
        assert_eq!(idx.search_wildcard("X?"), None);
    }

    // -----------------------------------------------------------------------
    // test_empty_index
    // -----------------------------------------------------------------------

    #[test]
    fn test_empty_index() {
        let idx = LookupIndex::build(std::iter::empty());

        assert_eq!(idx.search_leq_numeric(10.0), None);
        assert_eq!(idx.search_geq_numeric(10.0), None);
        assert_eq!(idx.search_exact_numeric(10.0), None);
        assert_eq!(idx.search_leq_text("hello"), None);
        assert_eq!(idx.search_geq_text("hello"), None);
        assert_eq!(idx.search_exact_text("hello"), None);
        assert_eq!(idx.search_wildcard("*"), None);
    }

    // -----------------------------------------------------------------------
    // test_single_row
    // -----------------------------------------------------------------------

    #[test]
    fn test_single_row() {
        let data = vec![(5u32, num(42.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_leq_numeric(42.0), Some(5));
        assert_eq!(idx.search_leq_numeric(50.0), Some(5));
        assert_eq!(idx.search_leq_numeric(30.0), None);
        assert_eq!(idx.search_geq_numeric(42.0), Some(5));
        assert_eq!(idx.search_geq_numeric(30.0), Some(5));
        assert_eq!(idx.search_geq_numeric(50.0), None);
        assert_eq!(idx.search_exact_numeric(42.0), Some(5));
        assert_eq!(idx.search_exact_numeric(43.0), None);
    }

    // -----------------------------------------------------------------------
    // HorizontalLookupIndex tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_horizontal_build_from_numeric() {
        let data = vec![(0u32, num(30.0)), (1, num(10.0)), (2, num(20.0))];
        let idx = HorizontalLookupIndex::build(data.into_iter());

        assert_eq!(idx.sorted_numeric.len(), 3);
        assert_eq!(idx.sorted_numeric[0], (10.0, 1));
        assert_eq!(idx.sorted_numeric[1], (20.0, 2));
        assert_eq!(idx.sorted_numeric[2], (30.0, 0));
    }

    #[test]
    fn test_horizontal_search_exact_numeric() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = HorizontalLookupIndex::build(data.into_iter());

        assert_eq!(idx.search_exact_numeric(20.0), Some(1));
        assert_eq!(idx.search_exact_numeric(10.0), Some(0));
        assert_eq!(idx.search_exact_numeric(15.0), None);
    }

    #[test]
    fn test_horizontal_search_leq_numeric() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = HorizontalLookupIndex::build(data.into_iter());

        assert_eq!(idx.search_leq_numeric(20.0), Some(1));
        assert_eq!(idx.search_leq_numeric(15.0), Some(0));
        assert_eq!(idx.search_leq_numeric(100.0), Some(2));
        assert_eq!(idx.search_leq_numeric(5.0), None);
    }

    #[test]
    fn test_horizontal_search_exact_text() {
        let data = vec![(0u32, text("Hello")), (1, text("WORLD"))];
        let idx = HorizontalLookupIndex::build(data.into_iter());

        assert_eq!(idx.search_exact_text("hello"), Some(0));
        assert_eq!(idx.search_exact_text("world"), Some(1));
        assert_eq!(idx.search_exact_text("missing"), None);
    }

    #[test]
    fn test_horizontal_search_leq_text() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("banana")),
            (2, text("Cherry")),
        ];
        let idx = HorizontalLookupIndex::build(data.into_iter());

        assert_eq!(idx.search_leq_text("BANANA"), Some(1));
        assert_eq!(idx.search_leq_text("b"), Some(0));
        assert_eq!(idx.search_leq_text("d"), Some(2));
        assert_eq!(idx.search_leq_text("a"), None);
    }

    #[test]
    fn test_horizontal_search_wildcard() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("Avocado")),
            (2, text("Banana")),
        ];
        let idx = HorizontalLookupIndex::build(data.into_iter());

        assert_eq!(idx.search_wildcard("A*"), Some(0));
        assert_eq!(idx.search_wildcard("B*"), Some(2));
        assert_eq!(idx.search_wildcard("*ado"), Some(1));
        assert_eq!(idx.search_wildcard("Z*"), None);
    }

    #[test]
    fn test_horizontal_exact_duplicates() {
        // Multiple columns with same value → first in column order
        let data = vec![(5u32, num(42.0)), (2, num(42.0)), (8, num(42.0))];
        let idx = HorizontalLookupIndex::build(data.into_iter());
        assert_eq!(idx.search_exact_numeric(42.0), Some(2));
    }

    #[test]
    fn test_horizontal_empty_index() {
        let idx = HorizontalLookupIndex::build(std::iter::empty());
        assert_eq!(idx.search_leq_numeric(10.0), None);
        assert_eq!(idx.search_exact_numeric(10.0), None);
        assert_eq!(idx.search_leq_text("hello"), None);
        assert_eq!(idx.search_exact_text("hello"), None);
        assert_eq!(idx.search_wildcard("*"), None);
    }

    // -----------------------------------------------------------------------
    // Incremental update tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_incremental_update_numeric() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let mut idx = LookupIndex::build(data.into_iter());

        // Change row 1 from 20.0 to 25.0
        idx.update(&[(1, num(20.0), num(25.0))]);

        // 20.0 should no longer be found
        assert_eq!(idx.search_exact_numeric(20.0), None);
        // 25.0 should be found at row 1
        assert_eq!(idx.search_exact_numeric(25.0), Some(1));
        // Other values unchanged
        assert_eq!(idx.search_exact_numeric(10.0), Some(0));
        assert_eq!(idx.search_exact_numeric(30.0), Some(2));
        // Sorted order should be maintained
        assert_eq!(idx.search_leq_numeric(24.0), Some(0)); // 10 is the largest <= 24 (since 20 removed)
        assert_eq!(idx.search_leq_numeric(26.0), Some(1)); // 25 at row 1
    }

    #[test]
    fn test_incremental_update_text() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("Banana")),
            (2, text("Cherry")),
        ];
        let mut idx = LookupIndex::build(data.into_iter());

        // Change row 1 from "Banana" to "Blueberry"
        idx.update(&[(1, text("Banana"), text("Blueberry"))]);

        // "Banana" should no longer be found
        assert_eq!(idx.search_exact_text("banana"), None);
        // "Blueberry" should be found at row 1
        assert_eq!(idx.search_exact_text("blueberry"), Some(1));
        // Other values unchanged
        assert_eq!(idx.search_exact_text("apple"), Some(0));
        assert_eq!(idx.search_exact_text("cherry"), Some(2));
    }

    #[test]
    fn test_incremental_update_type_change() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0))];
        let mut idx = LookupIndex::build(data.into_iter());

        // Change row 1 from number 20.0 to text "Hello"
        idx.update(&[(1, num(20.0), text("Hello"))]);

        assert_eq!(idx.search_exact_numeric(20.0), None);
        assert_eq!(idx.search_exact_text("hello"), Some(1));
        assert_eq!(idx.search_exact_numeric(10.0), Some(0));
    }

    #[test]
    fn test_incremental_update_to_null() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0))];
        let mut idx = LookupIndex::build(data.into_iter());

        // Change row 1 from 20.0 to Null (effectively removing it)
        idx.update(&[(1, num(20.0), CellValue::Null)]);

        assert_eq!(idx.search_exact_numeric(20.0), None);
        assert_eq!(idx.search_exact_numeric(10.0), Some(0));
        assert_eq!(idx.sorted_numeric.len(), 1);
    }

    #[test]
    fn test_incremental_update_multiple_changes() {
        let data = vec![
            (0u32, num(10.0)),
            (1, num(20.0)),
            (2, num(30.0)),
            (3, num(40.0)),
        ];
        let mut idx = LookupIndex::build(data.into_iter());

        // Change row 0: 10→15, row 2: 30→35
        idx.update(&[(0, num(10.0), num(15.0)), (2, num(30.0), num(35.0))]);

        assert_eq!(idx.search_exact_numeric(10.0), None);
        assert_eq!(idx.search_exact_numeric(15.0), Some(0));
        assert_eq!(idx.search_exact_numeric(30.0), None);
        assert_eq!(idx.search_exact_numeric(35.0), Some(2));
        assert_eq!(idx.search_exact_numeric(20.0), Some(1));
        assert_eq!(idx.search_exact_numeric(40.0), Some(3));
    }
}
