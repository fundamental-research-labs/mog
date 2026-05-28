use ordered_float::OrderedFloat;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use value_types::CellValue;

use super::super::wildcard::{compile_wildcard, wildcard_match};

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
    #[allow(dead_code)] // Horizontal wildcard search -- wire when HLOOKUP wildcard mode is activated.
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
    fn test_horizontal_build_from_numeric() {
        let data = vec![(0u32, num(30.0)), (1, num(10.0)), (2, num(20.0))];
        let idx = HorizontalLookupIndex::build(data.into_iter());

        assert_eq!(idx.sorted_numeric.len(), 3);
        assert_eq!(idx.sorted_numeric[0], (10.0, 1));
        assert_eq!(idx.sorted_numeric[1], (20.0, 2));
        assert_eq!(idx.sorted_numeric[2], (30.0, 0));
    }

    #[test]
    fn test_horizontal_build_from_mixed_types() {
        let data = vec![
            (0u32, num(10.0)),
            (1, text("Banana")),
            (2, num(20.0)),
            (3, text("Apple")),
            (4, CellValue::Boolean(true)),
            (5, CellValue::Error(CellError::Na, None)),
            (6, CellValue::Null),
        ];
        let idx = HorizontalLookupIndex::build(data.into_iter());

        assert_eq!(idx.sorted_numeric.len(), 2);
        assert_eq!(idx.exact_numeric.len(), 2);
        assert_eq!(idx.sorted_string.len(), 2);
        assert_eq!(idx.exact_text.len(), 2);

        assert_eq!(idx.sorted_string[0], ("apple".to_string(), 3));
        assert_eq!(idx.sorted_string[1], ("banana".to_string(), 1));
        assert_eq!(idx.text_by_col[0], ("banana".to_string(), 1));
        assert_eq!(idx.text_by_col[1], ("apple".to_string(), 3));
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
}
