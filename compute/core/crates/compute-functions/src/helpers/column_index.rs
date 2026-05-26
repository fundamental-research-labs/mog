//! Per-column sorted index for O(1) criterion resolution in SUMIFS/COUNTIFS.
//!
//! Built once per unique column content, amortized across all SUMIFS calls
//! referencing that column. Uses NormalizedKey from frequency_cache for
//! cross-type matching (Text("5") == Number(5)).
//!
//! ## Cache tiers
//!
//! **Tier 1: Arc pointer cache** — O(1) lookup. When the eval context reuses
//! the same Arc (e.g., within a single COUNTIFS call iterating over array
//! criteria), we get instant hits. The cache holds an Arc clone to prevent
//! address reuse. The RangeStore guarantees that the same range reference
//! (e.g., E:E) produces the same Arc within a recalc, so this tier also
//! handles cross-formula deduplication.
//!
//! **Tier 2: Logical key cache** — keyed by (SheetId, col, start_row, end_row).
//! Used by the borrowed multi-criteria path which has direct access to range
//! identity. Collision-free by construction.
//!
//! ## Why no content-hash cache
//!
//! A previous implementation used an O(1) fingerprint (hash of dimensions +
//! sampled values) to deduplicate across different Arcs with the same content.
//! This was unsound: for full-column ranges (E:E, K:K) where data only
//! occupies the first few hundred rows, ALL sampled positions (middle, end,
//! quartile) are Null, making different columns hash-identical. This caused
//! COUNTIFS to silently use the wrong column's index, returning 0 instead of
//! correct counts. The RangeStore's Arc deduplication makes this tier
//! unnecessary — the same logical range always produces the same Arc.
//!
//! ## Lifetime
//!
//! Thread-local, cleared explicitly at recalc entry via `clear()`.

use std::cell::RefCell;
use std::sync::Arc;

use cell_types::SheetId;
use rustc_hash::FxHashMap;
use value_types::{CellArray, CellValue};

use super::column_bitset::ColumnBitset;
use super::frequency_cache::NormalizedKey;

// ---------------------------------------------------------------------------
// ColumnIndex
// ---------------------------------------------------------------------------

/// Per-column index for O(1) exact-match criterion resolution.
/// Built from a flattened column of CellValues in O(N) time.
/// Queries return a ColumnBitset of matching row indices.
pub struct ColumnIndex {
    exact_map: FxHashMap<NormalizedKey, Vec<u32>>,
    nrows: u32,
}

impl ColumnIndex {
    /// Build an index from flattened column value refs in O(N) time.
    pub fn build(values: &[&CellValue]) -> Self {
        let nrows = values.len() as u32;
        let mut exact_map: FxHashMap<NormalizedKey, Vec<u32>> = FxHashMap::default();
        for (i, &v) in values.iter().enumerate() {
            let key = NormalizedKey::from_cell_value(v);
            exact_map.entry(key).or_default().push(i as u32);
        }
        Self { exact_map, nrows }
    }

    /// Build an index from an owned slice of CellValues in O(N) time.
    pub fn build_from_slice(values: &[CellValue]) -> Self {
        let nrows = values.len() as u32;
        let mut exact_map: FxHashMap<NormalizedKey, Vec<u32>> = FxHashMap::default();
        for (i, v) in values.iter().enumerate() {
            let key = NormalizedKey::from_cell_value(v);
            exact_map.entry(key).or_default().push(i as u32);
        }
        Self { exact_map, nrows }
    }

    /// Query for exact-match criterion: return bitmap of matching rows.
    /// O(K) where K = number of matching rows.
    pub fn query_exact(&self, criteria: &CellValue) -> ColumnBitset {
        let key = NormalizedKey::from_cell_value(criteria);
        let mut bitmap = ColumnBitset::new_all_false(self.nrows);
        if let Some(indices) = self.exact_map.get(&key) {
            for &idx in indices {
                bitmap.set(idx, true);
            }
        }
        // Excel: criteria "" (empty text) also matches Null (empty) cells.
        // NormalizedKey maps Text("") and Null to different keys, so we
        // must explicitly include Null positions when criteria is Text("").
        if matches!(&key, NormalizedKey::Text(s) if s.is_empty())
            && let Some(indices) = self.exact_map.get(&NormalizedKey::Null)
        {
            for &idx in indices {
                bitmap.set(idx, true);
            }
        }
        bitmap
    }

    /// Number of rows in the indexed column.
    pub fn nrows(&self) -> u32 {
        self.nrows
    }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/// Entry in the Arc pointer cache. Holds an Arc clone to prevent address reuse.
struct PtrEntry {
    _arc: Arc<CellArray>,
    index: Arc<ColumnIndex>,
}

type PtrKey = (usize, usize); // (Arc::as_ptr(), len)

/// Logical key: (SheetId, col, start_row, end_row) — stable across entire recalc.
type LogicalKey = (SheetId, u32, u32, u32);

thread_local! {
    static PTR_CACHE: RefCell<FxHashMap<PtrKey, PtrEntry>> =
        RefCell::new(FxHashMap::default());
    static LOGICAL_CACHE: RefCell<FxHashMap<LogicalKey, Arc<ColumnIndex>>> =
        RefCell::new(FxHashMap::default());
}

/// Clear all caches. Must be called at recalc entry.
pub fn clear() {
    PTR_CACHE.with(|c| c.borrow_mut().clear());
    LOGICAL_CACHE.with(|c| c.borrow_mut().clear());
}

/// Get or build a ColumnIndex from a borrowed column slice, keyed by logical identity.
///
/// Used by the borrowed multi-criteria path which has (SheetId, col, row bounds).
/// Since the mirror data is stable within a recalc, the logical key is always valid.
pub fn get_or_build_for_slice(
    sheet: &SheetId,
    col: u32,
    start_row: u32,
    end_row: u32,
    values: &[CellValue],
) -> Arc<ColumnIndex> {
    let key = (*sheet, col, start_row, end_row);

    LOGICAL_CACHE.with(|c| {
        let mut cache = c.borrow_mut();
        if let Some(index) = cache.get(&key) {
            return Arc::clone(index);
        }

        let refs: Vec<&CellValue> = values.iter().collect();
        let index = Arc::new(ColumnIndex::build(&refs));
        cache.insert(key, Arc::clone(&index));
        index
    })
}

/// Get or build a ColumnIndex for the given range argument.
///
/// Uses the Arc pointer as cache key — the RangeStore guarantees that the
/// same range reference produces the same Arc within a recalc, so this is
/// both correct and efficient.
///
/// Returns None if range_arg is not an Array (scalar ranges use fallback path).
pub fn get_or_build(range_arg: &CellValue) -> Option<Arc<ColumnIndex>> {
    let arc = match range_arg {
        CellValue::Array(arc) => arc,
        _ => return None,
    };

    let ptr = Arc::as_ptr(arc) as usize;
    let len = arc.len();

    // Check Arc pointer cache — O(1), no allocation
    let ptr_hit = PTR_CACHE.with(|c| c.borrow().get(&(ptr, len)).map(|e| Arc::clone(&e.index)));
    if let Some(index) = ptr_hit {
        return Some(index);
    }

    // Cache miss: build index from data() slice
    let index = Arc::new(ColumnIndex::build_from_slice(arc.data()));

    // Store in ptr cache for subsequent calls with same Arc
    PTR_CACHE.with(|c| {
        c.borrow_mut().insert(
            (ptr, len),
            PtrEntry {
                _arc: Arc::clone(arc),
                index: Arc::clone(&index),
            },
        );
    });

    Some(index)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    /// Helper: assert a ColumnBitset matches a Vec<bool> pattern.
    fn assert_bitset_eq(bs: &ColumnBitset, expected: &[bool]) {
        assert_eq!(bs.len() as usize, expected.len(), "bitset length mismatch");
        for (i, &exp) in expected.iter().enumerate() {
            assert_eq!(bs.get(i as u32), exp, "mismatch at index {i}");
        }
    }

    // -- ColumnIndex::build + query_exact --

    #[test]
    fn test_build_from_numbers() {
        let values = [num(1.0), num(2.0), num(3.0), num(2.0), num(5.0)];
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);
        assert_eq!(index.nrows(), 5);

        let bitmap = index.query_exact(&num(2.0));
        assert_bitset_eq(&bitmap, &[false, true, false, true, false]);
    }

    #[test]
    fn test_build_from_text() {
        let values = [text("Alice"), text("Bob"), text("Alice"), text("Charlie")];
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);

        let bitmap = index.query_exact(&text("Alice"));
        assert_bitset_eq(&bitmap, &[true, false, true, false]);
    }

    #[test]
    fn test_build_mixed_types() {
        let values = [
            num(1.0),
            text("hello"),
            CellValue::Boolean(true),
            CellValue::Null,
            num(1.0),
        ];
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);

        let bitmap = index.query_exact(&num(1.0));
        assert_bitset_eq(&bitmap, &[true, false, false, false, true]);

        let bitmap = index.query_exact(&text("hello"));
        assert_bitset_eq(&bitmap, &[false, true, false, false, false]);

        let bitmap = index.query_exact(&CellValue::Boolean(true));
        assert_bitset_eq(&bitmap, &[false, false, true, false, false]);

        let bitmap = index.query_exact(&CellValue::Null);
        assert_bitset_eq(&bitmap, &[false, false, false, true, false]);
    }

    #[test]
    fn test_query_no_match() {
        let values = [num(1.0), num(2.0), num(3.0)];
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);

        let bitmap = index.query_exact(&num(99.0));
        assert_bitset_eq(&bitmap, &[false, false, false]);
    }

    #[test]
    fn test_cross_type_text_number() {
        // Text "5" should match Number(5) via NormalizedKey
        let values = [num(5.0), text("5"), num(10.0)];
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);

        let bitmap = index.query_exact(&num(5.0));
        assert_bitset_eq(&bitmap, &[true, true, false]);

        let bitmap = index.query_exact(&text("5"));
        assert_bitset_eq(&bitmap, &[true, true, false]);
    }

    #[test]
    fn test_case_insensitive_text() {
        let values = [text("Hello"), text("HELLO"), text("hello"), text("World")];
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);

        let bitmap = index.query_exact(&text("hello"));
        assert_bitset_eq(&bitmap, &[true, true, true, false]);

        let bitmap = index.query_exact(&text("HELLO"));
        assert_bitset_eq(&bitmap, &[true, true, true, false]);
    }

    #[test]
    fn test_empty_column() {
        let refs: Vec<&CellValue> = vec![];
        let index = ColumnIndex::build(&refs);
        assert_eq!(index.nrows(), 0);

        let bitmap = index.query_exact(&num(1.0));
        assert_eq!(bitmap.len(), 0);
    }

    #[test]
    fn test_large_column() {
        let values: Vec<CellValue> = (0..2000).map(|i| num(i as f64 % 100.0)).collect();
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);
        assert_eq!(index.nrows(), 2000);

        // Each value 0..99 appears 20 times
        let bitmap = index.query_exact(&num(42.0));
        assert_eq!(bitmap.count_ones(), 20);

        // Check specific positions: 42, 142, 242, ...
        for i in 0..20u32 {
            assert!(bitmap.get(42 + i * 100));
        }
    }

    // -- Cache tests --

    #[test]
    fn test_cache_hit_same_arc() {
        clear();
        let range = CellValue::column_array(vec![num(1.0), num(2.0), num(3.0)]);

        // First call builds the index
        let idx1 = get_or_build(&range).unwrap();
        // Second call should hit ptr cache (same Arc)
        let idx2 = get_or_build(&range).unwrap();

        // Same Arc => same ColumnIndex pointer
        assert!(Arc::ptr_eq(&idx1, &idx2));
    }

    #[test]
    fn test_different_arcs_same_content_get_different_indices() {
        clear();
        let range1 = CellValue::column_array(vec![num(1.0), num(2.0), num(3.0)]);
        let range2 = CellValue::column_array(vec![num(1.0), num(2.0), num(3.0)]);

        // Different Arcs with same content — must NOT share indices.
        // (The RangeStore deduplicates Arcs for the same range; if two
        // CellValues have different Arcs, they represent different ranges
        // and must be indexed independently.)
        let idx1 = get_or_build(&range1).unwrap();
        let idx2 = get_or_build(&range2).unwrap();

        assert!(!Arc::ptr_eq(&idx1, &idx2));

        // Both still produce correct results
        let bm1 = idx1.query_exact(&num(2.0));
        assert_bitset_eq(&bm1, &[false, true, false]);
        let bm2 = idx2.query_exact(&num(2.0));
        assert_bitset_eq(&bm2, &[false, true, false]);
    }

    #[test]
    fn test_different_columns_different_index() {
        clear();
        let range1 = CellValue::column_array(vec![num(1.0), num(2.0)]);
        let range2 = CellValue::column_array(vec![num(3.0), num(4.0)]);

        let idx1 = get_or_build(&range1).unwrap();
        let idx2 = get_or_build(&range2).unwrap();

        // Different content => different index
        assert!(!Arc::ptr_eq(&idx1, &idx2));

        // Verify correctness
        let bm1 = idx1.query_exact(&num(1.0));
        assert_bitset_eq(&bm1, &[true, false]);

        let bm2 = idx2.query_exact(&num(3.0));
        assert_bitset_eq(&bm2, &[true, false]);
    }

    #[test]
    fn test_clear_invalidates_cache() {
        clear();
        let range = CellValue::column_array(vec![num(1.0), num(2.0)]);

        let idx1 = get_or_build(&range).unwrap();
        clear();
        let idx2 = get_or_build(&range).unwrap();

        // After clear, a new ColumnIndex is built (not the same Arc)
        assert!(!Arc::ptr_eq(&idx1, &idx2));

        // But produces correct results
        let bm = idx2.query_exact(&num(1.0));
        assert_bitset_eq(&bm, &[true, false]);
    }

    // -- Logical cache (get_or_build_for_slice) tests --

    fn test_sheet_id() -> SheetId {
        SheetId::from_raw(0)
    }

    #[test]
    fn test_logical_cache_hit_same_key() {
        clear();
        let values = vec![num(1.0), num(2.0), num(3.0)];
        let sheet = test_sheet_id();

        let idx1 = get_or_build_for_slice(&sheet, 0, 0, 2, &values);
        let idx2 = get_or_build_for_slice(&sheet, 0, 0, 2, &values);

        // Same logical key => same Arc
        assert!(Arc::ptr_eq(&idx1, &idx2));
    }

    #[test]
    fn test_logical_cache_miss_different_col() {
        clear();
        let values = vec![num(1.0), num(2.0), num(3.0)];
        let sheet = test_sheet_id();

        let idx1 = get_or_build_for_slice(&sheet, 0, 0, 2, &values);
        let idx2 = get_or_build_for_slice(&sheet, 1, 0, 2, &values);

        // Different col => different Arc
        assert!(!Arc::ptr_eq(&idx1, &idx2));
    }

    #[test]
    fn test_logical_cache_miss_different_rows() {
        clear();
        let values = vec![num(1.0), num(2.0), num(3.0)];
        let sheet = test_sheet_id();

        let idx1 = get_or_build_for_slice(&sheet, 0, 0, 2, &values);
        let idx2 = get_or_build_for_slice(&sheet, 0, 0, 5, &values);

        assert!(!Arc::ptr_eq(&idx1, &idx2));
    }

    #[test]
    fn test_logical_cache_clear_invalidation() {
        clear();
        let values = vec![num(1.0), num(2.0), num(3.0)];
        let sheet = test_sheet_id();

        let idx1 = get_or_build_for_slice(&sheet, 0, 0, 2, &values);
        clear();
        let idx2 = get_or_build_for_slice(&sheet, 0, 0, 2, &values);

        // After clear, a new index is built
        assert!(!Arc::ptr_eq(&idx1, &idx2));

        // But produces correct results
        let bm = idx2.query_exact(&num(2.0));
        assert_bitset_eq(&bm, &[false, true, false]);
    }

    #[test]
    fn test_logical_cache_correctness() {
        clear();
        let values = vec![text("Alice"), text("Bob"), text("Alice")];
        let sheet = test_sheet_id();

        let index = get_or_build_for_slice(&sheet, 3, 10, 12, &values);
        let bm = index.query_exact(&text("Alice"));
        assert_bitset_eq(&bm, &[true, false, true]);
    }

    #[test]
    fn test_scalar_returns_none() {
        clear();
        let scalar = num(5.0);
        assert!(get_or_build(&scalar).is_none());
    }

    #[test]
    fn test_null_returns_none() {
        clear();
        assert!(get_or_build(&CellValue::Null).is_none());
    }

    #[test]
    fn test_error_values_in_column() {
        let values = [
            num(1.0),
            CellValue::Error(value_types::CellError::Na, None),
            num(1.0),
            CellValue::Error(value_types::CellError::Value, None),
        ];
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);

        let bitmap = index.query_exact(&CellValue::Error(value_types::CellError::Na, None));
        assert_bitset_eq(&bitmap, &[false, true, false, false]);

        let bitmap = index.query_exact(&num(1.0));
        assert_bitset_eq(&bitmap, &[true, false, true, false]);
    }

    #[test]
    fn test_all_same_value() {
        let values = vec![num(42.0); 100];
        let refs: Vec<&CellValue> = values.iter().collect();
        let index = ColumnIndex::build(&refs);

        let bitmap = index.query_exact(&num(42.0));
        assert_eq!(bitmap.count_ones(), 100);

        let bitmap = index.query_exact(&num(0.0));
        assert_eq!(bitmap.count_ones(), 0);
    }
}
