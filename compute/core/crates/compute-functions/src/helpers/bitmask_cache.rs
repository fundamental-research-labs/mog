//! Session-scoped per-criterion bitmask cache for SUMIFS/COUNTIFS/MAXIFS/MINIFS.
//!
//! When 50K SUMIFS formulas each evaluate 3 criteria against 40K-row ranges,
//! `evaluate_multi_criteria()` linearly scans every row for every criterion for
//! every formula cell. Many of these scans are redundant: different formula cells
//! often test the same criterion value against the same range.
//!
//! This cache stores per-criterion bitmasks keyed by (range identity, criteria hash).
//! On a cache hit, the stored criteria `CellValue` is compared against the queried
//! criteria to detect hash collisions — if they differ, the cache rebuilds.
//! On a verified hit, the entire `flatten_values_ref` + `parse_criteria` + inner loop
//! is skipped — the cached bitmask is simply AND-ed into the match vector.
//!
//! ## Cache key
//!
//! `(range_identity: usize, range_len: usize, criteria_hash: u64)`
//!
//! - `range_identity`: For `CellValue::Array(arc)`, uses `Arc::as_ptr(arc) as usize`
//!   which is O(1) and unique as long as the Arc is alive. For scalars, hashes the value.
//! - `criteria_hash`: FxHash of the raw criteria CellValue.
//!
//! ## Lifetime
//!
//! Thread-local, cleared explicitly at recalc entry via `clear()`.
//! The cache holds an `Arc` clone of each source array to prevent pointer reuse
//! after drop, ensuring the Arc pointer remains a valid identity key.

use std::cell::RefCell;
use std::hash::Hasher;
use std::sync::Arc;

use rustc_hash::{FxHashMap, FxHasher};
use value_types::{CellArray, CellValue};

use super::coercion::flatten_values_ref;
use super::column_bitset::ColumnBitset;
use super::criteria::parse_criteria;
use super::hashing;

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

/// A cached bitmask for a single criterion applied to a single range.
pub struct CachedBitmask {
    /// Clone of the source Arc prevents address reuse after drop.
    /// This ensures the Arc pointer remains a valid identity key
    /// for the lifetime of the cache entry.
    pub _arc_ref: Option<Arc<CellArray>>,
    /// The criteria value — kept for collision verification.
    /// If two different criteria hash to the same u64, the equality check
    /// on this field detects the collision and forces a cache miss.
    pub criteria: CellValue,
    /// Per-row match result: bit `i` set = row `i` matched the criterion.
    pub bitmask: ColumnBitset,
}

// ---------------------------------------------------------------------------
// Hashing helpers (delegates to shared hashing module)
// ---------------------------------------------------------------------------

/// Compute an FxHash of a criteria CellValue.
pub fn hash_criteria_value(v: &CellValue) -> u64 {
    let mut hasher = FxHasher::default();
    hashing::hash_cell_value(v, &mut hasher);
    hasher.finish()
}

/// Compute a stable identity for a range argument.
///
/// For `CellValue::Array(arc)`, uses the Arc's pointer address — O(1) and
/// unique as long as the Arc is alive (which the cache ensures by holding
/// a clone). For scalars, hashes the value.
pub fn range_identity(v: &CellValue) -> usize {
    match v {
        CellValue::Array(arc) => Arc::as_ptr(arc) as usize,
        _ => {
            let mut hasher = FxHasher::default();
            hashing::hash_cell_value(v, &mut hasher);
            hasher.finish() as usize
        }
    }
}

/// Extract the Arc from an Array CellValue (for pinning in cache).
pub fn extract_arc(v: &CellValue) -> Option<Arc<CellArray>> {
    match v {
        CellValue::Array(arc) => Some(Arc::clone(arc)),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Public builder (used by WorkbookCache Tier 1)
// ---------------------------------------------------------------------------

/// Evaluate the criterion against every element in `range_values` and return
/// a per-row bitmask. This is the pure computation extracted from
/// `apply_criterion` so that `WorkbookCache` can call it on a cache miss
/// without going through the thread-local cache.
pub fn build_bitmask(range_values: &[CellValue], criteria: &CellValue) -> ColumnBitset {
    let parsed = parse_criteria(criteria);
    ColumnBitset::from_predicate(range_values, &parsed)
}

// ---------------------------------------------------------------------------
// Incremental bitmask update
// ---------------------------------------------------------------------------

/// Update a single row in a bitmask based on a new cell value and criterion.
///
/// Re-evaluates the criterion for the given row's new value and updates the
/// bitmask in place. Returns `true` if the row was within bounds and updated,
/// `false` if `row >= bitmask.len()`.
pub fn update_bitmask_row(
    bitmask: &mut ColumnBitset,
    row: usize,
    new_value: &CellValue,
    criterion: &CellValue,
) -> bool {
    if (row as u32) < bitmask.len() {
        let parsed = parse_criteria(criterion);
        bitmask.set(row as u32, parsed(new_value));
        true
    } else {
        false
    }
}

// ---------------------------------------------------------------------------
// Thread-local cache
// ---------------------------------------------------------------------------

/// Cache key: (range_identity, range_len, criteria_hash)
pub type CacheKey = (usize, usize, u64);

thread_local! {
    static BITMASK_CACHE: RefCell<FxHashMap<CacheKey, CachedBitmask>> =
        RefCell::new(FxHashMap::default());
}

/// Clear the bitmask cache. Must be called at recalc entry.
pub fn clear() {
    BITMASK_CACHE.with(|c| c.borrow_mut().clear());
}

// ---------------------------------------------------------------------------
// Primary API
// ---------------------------------------------------------------------------

/// Apply a single criterion to the matches vector, using cached bitmask if available.
///
/// On cache hit: skips `flatten_values_ref`, `parse_criteria`, and the inner loop
/// entirely — the cached bitmask is simply AND-ed into `matches`.
///
/// On cache miss: flattens the range, evaluates the criteria, computes the
/// bitmask, AND-s it into `matches`, and inserts into the cache.
pub fn apply_criterion(
    matches: &mut ColumnBitset,
    range_arg: &CellValue,
    criteria_arg: &CellValue,
) {
    let rid = range_identity(range_arg);
    let crit_hash = hash_criteria_value(criteria_arg);

    let mut _hit = 0u64;
    let mut _miss = 0u64;
    let mut _collision = 0u64;

    BITMASK_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();

        // Probe with matches.len() as range_len.
        // For Array ranges, the flattened length is deterministic from the Arc,
        // so the first insertion's len is authoritative for all subsequent lookups.
        let range_len = matches.len() as usize;
        let key = (rid, range_len, crit_hash);

        // Check cache: key match AND collision verification on the criteria value.
        // If two different criteria hash to the same u64, the equality check
        // detects the collision and forces a rebuild.
        if let Some(entry) = cache.get(&key) {
            if entry.criteria == *criteria_arg {
                _hit = 1;
                // Cache HIT: AND the cached bitmask into matches.
                let bitmask = &entry.bitmask;
                if bitmask.len() == matches.len() {
                    matches.and_assign(bitmask);
                } else {
                    // Size mismatch: build a padded/truncated bitset and AND.
                    let mut padded = ColumnBitset::new_all_false(matches.len());
                    let copy_len = matches.len().min(bitmask.len());
                    for idx in bitmask.ones() {
                        if idx < copy_len {
                            padded.set(idx, true);
                        }
                    }
                    matches.and_assign(&padded);
                }
                return;
            }
            // Hash collision — fall through to cache miss path.
            _collision = 1;
        }
        _miss = 1;

        // Cache MISS (or collision): flatten, parse, compute bitmask.
        let range = flatten_values_ref(range_arg);
        let criteria = parse_criteria(criteria_arg);

        let bitmask_len = range.len() as u32;
        let mut bitmask = ColumnBitset::new_all_false(bitmask_len);
        for (i, v) in range.iter().enumerate() {
            if criteria(v) {
                bitmask.set(i as u32, true);
            }
        }

        // AND into matches.
        if bitmask.len() == matches.len() {
            matches.and_assign(&bitmask);
        } else {
            let mut padded = ColumnBitset::new_all_false(matches.len());
            let copy_len = matches.len().min(bitmask.len());
            for idx in bitmask.ones() {
                if idx < copy_len {
                    padded.set(idx, true);
                }
            }
            matches.and_assign(&padded);
        }

        // Insert with the actual flattened length as key.
        // On collision, this overwrites the previous entry for the same key,
        // which is correct: the most recent criteria wins.
        let actual_key = (rid, bitmask.len() as usize, crit_hash);
        let arc_ref = extract_arc(range_arg);
        cache.insert(
            actual_key,
            CachedBitmask {
                _arc_ref: arc_ref,
                criteria: criteria_arg.clone(),
                bitmask,
            },
        );
    });

    let _span = tracing::info_span!(
        "bitmask_cache_probe",
        hit = _hit,
        miss = _miss,
        collision = _collision,
        range_len = matches.len() as u64,
    )
    .entered();
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

    /// Helper: create an Array CellValue with multiple rows of one column.
    fn column_range(values: Vec<CellValue>) -> CellValue {
        CellValue::column_array(values)
    }

    /// Helper: assert a ColumnBitset matches a Vec<bool> pattern.
    fn assert_bitset_eq(bs: &ColumnBitset, expected: &[bool]) {
        assert_eq!(bs.len() as usize, expected.len(), "bitset length mismatch");
        for (i, &exp) in expected.iter().enumerate() {
            assert_eq!(bs.get(i as u32), exp, "mismatch at index {i}");
        }
    }

    // -- Basic: single criterion, cache hit returns same result --

    #[test]
    fn test_single_criterion_basic() {
        clear();
        let range = column_range(vec![num(1.0), num(2.0), num(3.0), num(2.0), num(5.0)]);
        let criteria = num(2.0);

        let mut matches = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches, &range, &criteria);
        assert_bitset_eq(&matches, &[false, true, false, true, false]);
    }

    #[test]
    fn test_cache_hit_returns_same_result() {
        clear();
        let range = column_range(vec![num(1.0), num(2.0), num(3.0), num(2.0), num(5.0)]);
        let criteria = num(2.0);

        // First call (cache miss)
        let mut matches1 = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches1, &range, &criteria);

        // Second call (cache hit) — same range Arc, same criteria
        let mut matches2 = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches2, &range, &criteria);

        assert_bitset_eq(&matches1, &[false, true, false, true, false]);
        assert_bitset_eq(&matches2, &[false, true, false, true, false]);
    }

    // -- Multi-criterion: AND behavior --

    #[test]
    fn test_multi_criterion_and_behavior() {
        clear();
        // Range 1: categories
        let range1 = column_range(vec![text("A"), text("B"), text("A"), text("B"), text("A")]);
        // Range 2: values
        let range2 = column_range(vec![num(10.0), num(20.0), num(30.0), num(40.0), num(50.0)]);

        let mut matches = ColumnBitset::new_all_true(5);
        // First criterion: category = "A"
        apply_criterion(&mut matches, &range1, &text("A"));
        assert_bitset_eq(&matches, &[true, false, true, false, true]);

        // Second criterion: value > 20
        apply_criterion(&mut matches, &range2, &text(">20"));
        // Only rows where category="A" AND value>20: rows 2 (30) and 4 (50)
        assert_bitset_eq(&matches, &[false, false, true, false, true]);
    }

    // -- clear() invalidates cache --

    #[test]
    fn test_clear_invalidates_cache() {
        clear();
        let range = column_range(vec![num(1.0), num(2.0), num(3.0)]);
        let criteria = num(2.0);

        let mut matches = ColumnBitset::new_all_true(3);
        apply_criterion(&mut matches, &range, &criteria);
        assert_bitset_eq(&matches, &[false, true, false]);

        clear();

        // After clear, should still produce correct result (cache rebuilt)
        let mut matches2 = ColumnBitset::new_all_true(3);
        apply_criterion(&mut matches2, &range, &criteria);
        assert_bitset_eq(&matches2, &[false, true, false]);
    }

    // -- Different criteria on same range produce different bitmasks --

    #[test]
    fn test_different_criteria_same_range() {
        clear();
        let range = column_range(vec![num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)]);

        let mut m1 = ColumnBitset::new_all_true(5);
        apply_criterion(&mut m1, &range, &num(2.0));
        assert_bitset_eq(&m1, &[false, true, false, false, false]);

        let mut m2 = ColumnBitset::new_all_true(5);
        apply_criterion(&mut m2, &range, &num(4.0));
        assert_bitset_eq(&m2, &[false, false, false, true, false]);
    }

    // -- Different ranges produce different bitmasks --

    #[test]
    fn test_different_ranges_same_criteria() {
        clear();
        let range_a = column_range(vec![num(1.0), num(2.0), num(3.0)]);
        let range_b = column_range(vec![num(2.0), num(2.0), num(2.0)]);

        let mut m1 = ColumnBitset::new_all_true(3);
        apply_criterion(&mut m1, &range_a, &num(2.0));
        assert_bitset_eq(&m1, &[false, true, false]);

        let mut m2 = ColumnBitset::new_all_true(3);
        apply_criterion(&mut m2, &range_b, &num(2.0));
        assert_bitset_eq(&m2, &[true, true, true]);
    }

    // -- Scalar range (non-Array) handling --

    #[test]
    fn test_scalar_range() {
        clear();
        let range = num(5.0); // scalar, not an array
        let criteria = num(5.0);

        let mut matches = ColumnBitset::new_all_true(1);
        apply_criterion(&mut matches, &range, &criteria);
        assert_bitset_eq(&matches, &[true]);

        let mut matches2 = ColumnBitset::new_all_true(1);
        apply_criterion(&mut matches2, &range, &num(3.0));
        assert_bitset_eq(&matches2, &[false]);
    }

    // -- Empty range --

    #[test]
    fn test_empty_range() {
        clear();
        let range = CellValue::from_rows(vec![vec![]]);

        let mut matches = ColumnBitset::new_all_true(0);
        apply_criterion(&mut matches, &range, &num(1.0));
        assert!(matches.is_empty());
    }

    // -- Text criteria with operators --

    #[test]
    fn test_operator_criteria() {
        clear();
        let range = column_range(vec![num(10.0), num(20.0), num(30.0), num(40.0), num(50.0)]);

        let mut matches = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches, &range, &text(">=30"));
        assert_bitset_eq(&matches, &[false, false, true, true, true]);
    }

    // -- Wildcard criteria --

    #[test]
    fn test_wildcard_criteria() {
        clear();
        let range = column_range(vec![
            text("apple"),
            text("banana"),
            text("apricot"),
            text("cherry"),
            text("avocado"),
        ]);

        let mut matches = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches, &range, &text("a*"));
        assert_bitset_eq(&matches, &[true, false, true, false, true]);
    }

    // -- Boolean criteria --

    #[test]
    fn test_boolean_criteria() {
        clear();
        let range = column_range(vec![
            CellValue::Boolean(true),
            CellValue::Boolean(false),
            CellValue::Boolean(true),
            num(1.0),
            CellValue::Null,
        ]);

        let mut matches = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches, &range, &CellValue::Boolean(true));
        assert_bitset_eq(&matches, &[true, false, true, false, false]);
    }

    // -- Null criteria --

    #[test]
    fn test_null_criteria() {
        clear();
        let range = column_range(vec![
            CellValue::Null,
            num(0.0),
            CellValue::Null,
            text(""),
            CellValue::Null,
        ]);

        let mut matches = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches, &range, &CellValue::Null);
        assert_bitset_eq(&matches, &[true, false, true, false, true]);
    }

    // -- Multiple calls with same range identity but rebuilt matches --

    #[test]
    fn test_reuse_across_formula_cells() {
        clear();
        // Simulates multiple formula cells using the same range + criteria
        let range = column_range(vec![num(1.0), num(2.0), num(3.0), num(2.0)]);
        let criteria = num(2.0);

        // Formula cell 1
        let mut m1 = ColumnBitset::new_all_true(4);
        apply_criterion(&mut m1, &range, &criteria);
        assert_bitset_eq(&m1, &[false, true, false, true]);

        // Formula cell 2 (should hit cache)
        let mut m2 = ColumnBitset::new_all_true(4);
        apply_criterion(&mut m2, &range, &criteria);
        assert_bitset_eq(&m2, &[false, true, false, true]);

        // Formula cell 3 with additional criterion
        let mut m3 = ColumnBitset::new_all_true(4);
        apply_criterion(&mut m3, &range, &criteria);
        apply_criterion(&mut m3, &range, &text(">1"));
        assert_bitset_eq(&m3, &[false, true, false, true]);
    }

    // -- Mixed types in range --

    #[test]
    fn test_mixed_types_in_range() {
        clear();
        let range = column_range(vec![
            num(5.0),
            text("hello"),
            CellValue::Boolean(true),
            CellValue::Null,
            CellValue::Error(value_types::CellError::Na, None),
        ]);

        let mut matches = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches, &range, &num(5.0));
        assert_bitset_eq(&matches, &[true, false, false, false, false]);
    }

    // -- Verify AND behavior preserves false entries --

    #[test]
    fn test_and_preserves_existing_false() {
        clear();
        let range = column_range(vec![num(1.0), num(2.0), num(3.0)]);

        // Start with some entries already false
        let mut matches = ColumnBitset::new_all_false(3);
        matches.set(1, true);
        matches.set(2, true);
        apply_criterion(&mut matches, &range, &num(2.0));
        // Row 0 stays false (was already false), row 1 matches, row 2 doesn't
        assert_bitset_eq(&matches, &[false, true, false]);
    }

    // -- Large range (ensure no panics) --

    #[test]
    fn test_large_range() {
        clear();
        let values: Vec<CellValue> = (0..1000).map(|i| num(i as f64)).collect();
        let range = column_range(values);

        let mut matches = ColumnBitset::new_all_true(1000);
        apply_criterion(&mut matches, &range, &num(500.0));

        assert_eq!(matches.count_ones(), 1);
        assert!(matches.get(500));
    }

    // -- build_bitmask: standalone builder function --

    #[test]
    fn test_build_bitmask_basic() {
        let values = vec![num(1.0), num(2.0), num(3.0), num(2.0), num(5.0)];
        let bitmask = build_bitmask(&values, &num(2.0));
        assert_bitset_eq(&bitmask, &[false, true, false, true, false]);
    }

    #[test]
    fn test_build_bitmask_operator() {
        let values = vec![num(10.0), num(20.0), num(30.0), num(40.0), num(50.0)];
        let bitmask = build_bitmask(&values, &text(">=30"));
        assert_bitset_eq(&bitmask, &[false, false, true, true, true]);
    }

    #[test]
    fn test_build_bitmask_empty() {
        let values: Vec<CellValue> = vec![];
        let bitmask = build_bitmask(&values, &num(1.0));
        assert!(bitmask.is_empty());
    }

    #[test]
    fn test_build_bitmask_matches_apply_criterion() {
        // Verify build_bitmask produces same result as apply_criterion
        clear();
        let flat_values = vec![num(1.0), num(2.0), num(3.0), num(2.0), num(5.0)];
        let criteria = num(2.0);

        let bitmask = build_bitmask(&flat_values, &criteria);

        let range = column_range(flat_values);
        let mut matches = ColumnBitset::new_all_true(5);
        apply_criterion(&mut matches, &range, &criteria);

        // Both should have same bits set
        assert_eq!(bitmask.len(), matches.len());
        for i in 0..5u32 {
            assert_eq!(bitmask.get(i), matches.get(i), "mismatch at bit {i}");
        }
    }

    // -- Incremental bitmask update tests --

    #[test]
    fn test_update_bitmask_row_basic() {
        let mut bitmask = ColumnBitset::new_all_false(5);
        bitmask.set(1, true);
        bitmask.set(3, true);
        let criterion = num(5.0);

        // Row 2 changes to 5.0 — should now match
        let ok = update_bitmask_row(&mut bitmask, 2, &num(5.0), &criterion);
        assert!(ok);
        assert_bitset_eq(&bitmask, &[false, true, true, true, false]);
    }

    #[test]
    fn test_update_bitmask_row_out_of_bounds() {
        let mut bitmask = ColumnBitset::new_all_false(2);
        bitmask.set(0, true);
        let ok = update_bitmask_row(&mut bitmask, 5, &num(1.0), &num(1.0));
        assert!(!ok);
        // Bitmask unchanged
        assert_bitset_eq(&bitmask, &[true, false]);
    }

    #[test]
    fn test_update_bitmask_row_clears_match() {
        let mut bitmask = ColumnBitset::new_all_true(3);
        let criterion = num(2.0);

        // Row 1 changes from 2.0 to 3.0 — should no longer match
        let ok = update_bitmask_row(&mut bitmask, 1, &num(3.0), &criterion);
        assert!(ok);
        assert_bitset_eq(&bitmask, &[true, false, true]);
    }

    #[test]
    fn test_update_bitmask_row_operator_criterion() {
        let mut bitmask = ColumnBitset::new_all_false(3);
        let criterion = text(">=10");

        // Row 0 changes to 15.0 — should match >=10
        let ok = update_bitmask_row(&mut bitmask, 0, &num(15.0), &criterion);
        assert!(ok);
        assert_bitset_eq(&bitmask, &[true, false, false]);

        // Row 1 changes to 5.0 — should NOT match >=10
        let ok = update_bitmask_row(&mut bitmask, 1, &num(5.0), &criterion);
        assert!(ok);
        assert_bitset_eq(&bitmask, &[true, false, false]);
    }
}
