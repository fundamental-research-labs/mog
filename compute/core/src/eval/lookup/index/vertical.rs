use ordered_float::OrderedFloat;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use value_types::{CellValue, DenseColumn};

use super::super::wildcard::{compile_wildcard, wildcard_match};

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
    /// the source column had non-numeric cells that were not indexed. Text
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
                _ => {}
            }
        }

        sorted_numeric.sort_by(|a, b| a.0.total_cmp(&b.0));
        sorted_string.sort_by(|a, b| a.0.cmp(&b.0));
        text_by_row.sort_by_key(|&(_, row)| row);

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

        sorted_numeric.sort_by(|a, b| a.0.total_cmp(&b.0));

        for rows in exact_numeric.values_mut() {
            rows.sort_unstable();
        }

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
    /// indexed. Text searches against such an index may return false negatives.
    pub fn has_unindexed_text(&self) -> bool {
        self.has_unindexed_text
    }

    /// Largest value <= target. Returns row number.
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

    /// Largest text <= target (case-insensitive). Returns row number.
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

    /// Smallest value >= target. Returns row number.
    pub fn search_geq_numeric(&self, target: f64) -> Option<u32> {
        if self.sorted_numeric.is_empty() {
            return None;
        }
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
                if let Some(pos) = self
                    .sorted_numeric
                    .iter()
                    .position(|&(val, r)| r == row && val.to_bits() == v.to_bits())
                {
                    self.sorted_numeric.remove(pos);
                }
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
                if let Some(pos) = self
                    .sorted_string
                    .iter()
                    .position(|entry| entry.1 == row && entry.0 == lower)
                {
                    self.sorted_string.remove(pos);
                }
                if let Some(rows) = self.exact_text.get_mut(&lower) {
                    rows.retain(|r| *r != row);
                    if rows.is_empty() {
                        self.exact_text.remove(&lower);
                    }
                }
                if let Some(pos) = self
                    .text_by_row
                    .iter()
                    .position(|entry| entry.1 == row && entry.0 == lower)
                {
                    self.text_by_row.remove(pos);
                }
            }
            _ => {}
        }
    }

    /// Insert a single (row, value) entry into all internal index structures,
    /// maintaining sort order.
    fn insert_entry(&mut self, row: u32, value: &CellValue) {
        match value {
            CellValue::Number(n) => {
                let v = n.get();
                let pos = self
                    .sorted_numeric
                    .partition_point(|&(val, _)| val.total_cmp(&v) == std::cmp::Ordering::Less);
                self.sorted_numeric.insert(pos, (v, row));
                self.exact_numeric
                    .entry(OrderedFloat(v))
                    .or_default()
                    .push(row);
                if let Some(rows) = self.exact_numeric.get_mut(&OrderedFloat(v)) {
                    rows.sort_unstable();
                }
            }
            CellValue::Text(s) => {
                let lower = s.to_lowercase();
                let pos = self
                    .sorted_string
                    .partition_point(|entry| entry.0.as_str() < lower.as_str());
                self.sorted_string.insert(pos, (lower.clone(), row));
                self.exact_text.entry(lower.clone()).or_default().push(row);
                if let Some(rows) = self.exact_text.get_mut(&lower) {
                    rows.sort_unstable();
                }
                let pos = self.text_by_row.partition_point(|entry| entry.1 < row);
                self.text_by_row.insert(pos, (lower, row));
            }
            _ => {}
        }
    }

    /// Wildcard match (* and ?, ~ escape). Returns first matching row.
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

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellError, FiniteF64};

    fn num(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(v))
    }

    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    #[test]
    fn test_build_from_numeric_values() {
        let data = vec![(0u32, num(30.0)), (1, num(10.0)), (2, num(20.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.sorted_numeric.len(), 3);
        assert_eq!(idx.sorted_numeric[0], (10.0, 1));
        assert_eq!(idx.sorted_numeric[1], (20.0, 2));
        assert_eq!(idx.sorted_numeric[2], (30.0, 0));

        assert_eq!(idx.exact_numeric.len(), 3);
        assert_eq!(idx.exact_numeric[&OrderedFloat(10.0)][0], 1);
        assert_eq!(idx.exact_numeric[&OrderedFloat(20.0)][0], 2);
        assert_eq!(idx.exact_numeric[&OrderedFloat(30.0)][0], 0);
    }

    #[test]
    fn test_build_from_mixed_types() {
        let data = vec![
            (0u32, num(10.0)),
            (1, text("Banana")),
            (2, num(20.0)),
            (3, text("Apple")),
            (4, CellValue::Boolean(true)),
            (5, CellValue::Error(CellError::Na, None)),
            (6, CellValue::Null),
        ];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.sorted_numeric.len(), 2);
        assert_eq!(idx.exact_numeric.len(), 2);
        assert_eq!(idx.sorted_string.len(), 2);
        assert_eq!(idx.exact_text.len(), 2);

        assert_eq!(idx.sorted_string[0].0, "apple");
        assert_eq!(idx.sorted_string[0].1, 3);
        assert_eq!(idx.sorted_string[1].0, "banana");
        assert_eq!(idx.sorted_string[1].1, 1);

        assert_eq!(idx.text_by_row.len(), 2);
        assert_eq!(idx.text_by_row[0], ("banana".to_string(), 1));
        assert_eq!(idx.text_by_row[1], ("apple".to_string(), 3));
    }

    #[test]
    fn test_build_from_dense_column() {
        let dense = DenseColumn::new(vec![30.0, f64::NAN, 10.0, 20.0], 3, 0, vec![]);
        let idx = LookupIndex::build_from_dense(&dense);

        assert_eq!(idx.sorted_numeric.len(), 3);
        assert_eq!(idx.sorted_numeric[0], (10.0, 2));
        assert_eq!(idx.sorted_numeric[1], (20.0, 3));
        assert_eq!(idx.sorted_numeric[2], (30.0, 0));

        assert!(idx.sorted_string.is_empty());
        assert!(idx.exact_text.is_empty());
        assert!(idx.text_by_row.is_empty());

        let data = vec![(0u32, num(30.0)), (2, num(10.0)), (3, num(20.0))];
        let idx2 = LookupIndex::build(data.into_iter());
        assert_eq!(idx.sorted_numeric, idx2.sorted_numeric);
    }

    #[test]
    fn test_build_from_dense_column_nonzero_start_row() {
        let dense = DenseColumn::new(vec![30.0, f64::NAN, 10.0, 20.0], 3, 10, vec![]);
        let idx = LookupIndex::build_from_dense(&dense);

        assert_eq!(idx.sorted_numeric, vec![(10.0, 12), (20.0, 13), (30.0, 10)]);
        assert_eq!(idx.search_exact_numeric(30.0), Some(10));
        assert_eq!(idx.search_exact_numeric(10.0), Some(12));
    }

    #[test]
    fn test_has_unindexed_text_for_dense_columns() {
        let numeric = DenseColumn::new(vec![30.0, 10.0, 20.0], 3, 0, vec![]);
        let numeric_idx = LookupIndex::build_from_dense(&numeric);
        assert!(!numeric_idx.has_unindexed_text());

        let with_skipped_slots = DenseColumn::new(vec![30.0, f64::NAN, 20.0], 2, 0, vec![]);
        let skipped_idx = LookupIndex::build_from_dense(&with_skipped_slots);
        assert!(skipped_idx.has_unindexed_text());
    }

    #[test]
    fn test_search_leq_exact_match() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_leq_numeric(20.0), Some(1));
        assert_eq!(idx.search_leq_numeric(10.0), Some(0));
        assert_eq!(idx.search_leq_numeric(30.0), Some(2));
    }

    #[test]
    fn test_search_leq_between_values() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_leq_numeric(15.0), Some(0));
        assert_eq!(idx.search_leq_numeric(25.0), Some(1));
        assert_eq!(idx.search_leq_numeric(100.0), Some(2));
    }

    #[test]
    fn test_search_leq_below_minimum() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_leq_numeric(5.0), None);
    }

    #[test]
    fn test_search_leq_text() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("banana")),
            (2, text("Cherry")),
        ];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_leq_text("BANANA"), Some(1));
        assert_eq!(idx.search_leq_text("b"), Some(0));
        assert_eq!(idx.search_leq_text("d"), Some(2));
        assert_eq!(idx.search_leq_text("a"), None);
    }

    #[test]
    fn test_search_geq() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_geq_numeric(20.0), Some(1));
        assert_eq!(idx.search_geq_numeric(15.0), Some(1));
        assert_eq!(idx.search_geq_numeric(5.0), Some(0));
        assert_eq!(idx.search_geq_numeric(35.0), None);
    }

    #[test]
    fn test_search_geq_text() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("banana")),
            (2, text("Cherry")),
        ];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_geq_text("BANANA"), Some(1));
        assert_eq!(idx.search_geq_text("b"), Some(1));
        assert_eq!(idx.search_geq_text("a"), Some(0));
        assert_eq!(idx.search_geq_text("z"), None);
    }

    #[test]
    fn test_search_exact_numeric() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_exact_numeric(20.0), Some(1));
        assert_eq!(idx.search_exact_numeric(10.0), Some(0));
        assert_eq!(idx.search_exact_numeric(30.0), Some(2));
        assert_eq!(idx.search_exact_numeric(15.0), None);
    }

    #[test]
    fn test_search_exact_duplicates() {
        let data = vec![(5u32, num(42.0)), (2, num(42.0)), (8, num(42.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_exact_numeric(42.0), Some(2));
    }

    #[test]
    fn test_duplicate_approximate_numeric_tie_behavior() {
        let data = vec![(5u32, num(42.0)), (2, num(42.0)), (8, num(42.0))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.sorted_numeric, vec![(42.0, 5), (42.0, 2), (42.0, 8)]);
        assert_eq!(idx.search_leq_numeric(42.0), Some(8));
        assert_eq!(idx.search_geq_numeric(42.0), Some(5));
    }

    #[test]
    fn test_search_exact_text_case() {
        let data = vec![(0u32, text("Hello")), (1, text("WORLD"))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_exact_text("hello"), Some(0));
        assert_eq!(idx.search_exact_text("HELLO"), Some(0));
        assert_eq!(idx.search_exact_text("world"), Some(1));
        assert_eq!(idx.search_exact_text("World"), Some(1));
        assert_eq!(idx.search_exact_text("missing"), None);
    }

    #[test]
    fn test_search_wildcard_star() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("Avocado")),
            (2, text("Banana")),
        ];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_wildcard("A*"), Some(0));
        assert_eq!(idx.search_wildcard("B*"), Some(2));
        assert_eq!(idx.search_wildcard("*ado"), Some(1));
    }

    #[test]
    fn test_search_wildcard_question() {
        let data = vec![(0u32, text("AB")), (1, text("ABC")), (2, text("A"))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_wildcard("A?"), Some(0));
        assert_eq!(idx.search_wildcard("A??"), Some(1));
    }

    #[test]
    fn test_search_wildcard_tilde_escape() {
        let data = vec![(0u32, text("A*B")), (1, text("AXB")), (2, text("AB"))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_wildcard("A~*B"), Some(0));
    }

    #[test]
    fn test_search_wildcard_no_match() {
        let data = vec![(0u32, text("Apple")), (1, text("Banana"))];
        let idx = LookupIndex::build(data.into_iter());

        assert_eq!(idx.search_wildcard("Z*"), None);
        assert_eq!(idx.search_wildcard("X?"), None);
    }

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

    #[test]
    fn test_incremental_update_numeric() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0)), (2, num(30.0))];
        let mut idx = LookupIndex::build(data.into_iter());

        idx.update(&[(1, num(20.0), num(25.0))]);

        assert_eq!(idx.search_exact_numeric(20.0), None);
        assert_eq!(idx.search_exact_numeric(25.0), Some(1));
        assert_eq!(idx.search_exact_numeric(10.0), Some(0));
        assert_eq!(idx.search_exact_numeric(30.0), Some(2));
        assert_eq!(idx.search_leq_numeric(24.0), Some(0));
        assert_eq!(idx.search_leq_numeric(26.0), Some(1));
    }

    #[test]
    fn test_incremental_update_text() {
        let data = vec![
            (0u32, text("Apple")),
            (1, text("Banana")),
            (2, text("Cherry")),
        ];
        let mut idx = LookupIndex::build(data.into_iter());

        idx.update(&[(1, text("Banana"), text("Blueberry"))]);

        assert_eq!(idx.search_exact_text("banana"), None);
        assert_eq!(idx.search_exact_text("blueberry"), Some(1));
        assert_eq!(idx.search_exact_text("apple"), Some(0));
        assert_eq!(idx.search_exact_text("cherry"), Some(2));
    }

    #[test]
    fn test_incremental_update_type_change() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0))];
        let mut idx = LookupIndex::build(data.into_iter());

        idx.update(&[(1, num(20.0), text("Hello"))]);

        assert_eq!(idx.search_exact_numeric(20.0), None);
        assert_eq!(idx.search_exact_text("hello"), Some(1));
        assert_eq!(idx.search_exact_numeric(10.0), Some(0));
    }

    #[test]
    fn test_incremental_update_to_null() {
        let data = vec![(0u32, num(10.0)), (1, num(20.0))];
        let mut idx = LookupIndex::build(data.into_iter());

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

        idx.update(&[(0, num(10.0), num(15.0)), (2, num(30.0), num(35.0))]);

        assert_eq!(idx.search_exact_numeric(10.0), None);
        assert_eq!(idx.search_exact_numeric(15.0), Some(0));
        assert_eq!(idx.search_exact_numeric(30.0), None);
        assert_eq!(idx.search_exact_numeric(35.0), Some(2));
        assert_eq!(idx.search_exact_numeric(20.0), Some(1));
        assert_eq!(idx.search_exact_numeric(40.0), Some(3));
    }
}
