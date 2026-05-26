//! Epoch-scoped sorted-array cache for SMALL/LARGE/RANK functions.
//!
//! When multiple cells call `SMALL(same_range, k)` for different `k` values,
//! the same array is sorted redundantly each time. This cache ensures the sort
//! happens once per unique input array per recalc epoch.
//!
//! ## Cache key
//!
//! FxHash of all f64 bits in the extracted numeric array, paired with the array
//! length. On hit, the full unsorted array is compared for collision safety.
//!
//! ## Lifetime
//!
//! Thread-local, cleared explicitly at recalc entry via `clear()`. This follows
//! the same pattern as `clock.rs` (`set_current_time()` at recalc boundaries).
//!
//! ## WorkbookCache integration
//!
//! [`sort_and_build`] provides the core sort logic without thread-local caching,
//! suitable for use by `WorkbookCache`'s version-validated Tier 1 sorted cache.
//! The thread-local `get_or_sort_asc` remains as a fallback for `PureFunction`
//! callers that lack `EvalMetadata` context.

use std::cell::RefCell;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use rustc_hash::{FxHashMap, FxHasher};
use value_types::{CellError, CellValue};

/// The value type stored in WorkbookCache's Tier 1 sorted cache.
///
/// Wraps an `Arc<Vec<f64>>` of ascending-sorted numerics extracted from a range.
/// `Arc` enables zero-copy sharing across threads (unlike `Rc`).
pub type SortedCacheValue = Arc<Vec<f64>>;

/// A cached sorted array entry.
struct SortedCacheEntry {
    /// The original unsorted numerics — kept for collision verification.
    unsorted: Vec<f64>,
    /// The sorted (ascending) numerics, wrapped in Arc for cross-thread sharing.
    sorted_asc: Arc<Vec<f64>>,
}

thread_local! {
    static SORTED_CACHE: RefCell<FxHashMap<(u64, usize), SortedCacheEntry>> =
        RefCell::new(FxHashMap::default());
}

/// Compute an FxHash over the raw f64 bits of a numeric slice.
fn hash_f64_slice(nums: &[f64]) -> u64 {
    let mut hasher = FxHasher::default();
    for &n in nums {
        n.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

/// Extract numeric values from a flat `CellValue` slice (strict: only `Number` variants).
/// Returns `Err` on first error value encountered.
fn extract_numerics(flat: &[CellValue]) -> Result<Vec<f64>, CellError> {
    let mut nums = Vec::new();
    for v in flat {
        match v {
            CellValue::Error(e, _) => return Err(*e),
            CellValue::Number(n) => nums.push(n.get()),
            _ => {} // skip text, null, boolean (strict mode)
        }
    }
    Ok(nums)
}

/// Extract numerics from `values` and sort them ascending.
///
/// This is the core sort logic used by `WorkbookCache`'s Tier 1 sorted cache
/// builder. Unlike [`get_or_sort_asc`], it performs no thread-local caching —
/// caching and version validation are handled by the caller.
///
/// Returns `Err` if any value is a `CellValue::Error`.
pub fn sort_and_build(values: &[CellValue]) -> Result<Arc<Vec<f64>>, CellError> {
    let mut nums = extract_numerics(values)?;
    nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Ok(Arc::new(nums))
}

/// Get a sorted (ascending) copy of the numeric values in `flat`, using the
/// thread-local cache to avoid redundant sorts within the same recalc epoch.
///
/// Returns `Err` if any value in `flat` is a `CellValue::Error`.
/// Returns `Ok(Arc<Vec<f64>>)` — the Arc allows O(1) clone and cross-thread sharing.
pub fn get_or_sort_asc(flat: &[CellValue]) -> Result<Arc<Vec<f64>>, CellError> {
    let nums = extract_numerics(flat)?;
    let key = (hash_f64_slice(&nums), nums.len());

    // Check cache (fast path)
    let hit = SORTED_CACHE.with(|cache| {
        let c = cache.borrow();
        if let Some(entry) = c.get(&key)
            && entry.unsorted == nums
        {
            return Some(Arc::clone(&entry.sorted_asc));
        }
        None
    });

    if let Some(sorted) = hit {
        return Ok(sorted);
    }

    // Cache miss — sort and insert
    let mut sorted = nums.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let sorted_arc = Arc::new(sorted);

    SORTED_CACHE.with(|cache| {
        cache.borrow_mut().insert(
            key,
            SortedCacheEntry {
                unsorted: nums,
                sorted_asc: Arc::clone(&sorted_arc),
            },
        );
    });

    Ok(sorted_arc)
}

/// Clear the sorted-array cache. Must be called at recalc entry to prevent
/// stale data from a previous epoch being reused.
pub fn clear() {
    SORTED_CACHE.with(|cache| cache.borrow_mut().clear());
}

// ---------------------------------------------------------------------------
// Incremental update
// ---------------------------------------------------------------------------

/// Incrementally update a sorted array by removing old values and inserting new ones.
///
/// Returns `None` if the delta (removals + insertions) exceeds 10% of the array size,
/// signaling that a full rebuild is cheaper than incremental patching.
///
/// Both `removals` and `insertions` are unsorted slices of f64 values.
/// The input `sorted` must be sorted ascending.
pub fn incremental_update(
    sorted: &[f64],
    removals: &[f64],
    insertions: &[f64],
) -> Option<Vec<f64>> {
    // If delta is large relative to array size, signal that a full rebuild is better.
    let delta = removals.len() + insertions.len();
    if delta > 0 && !sorted.is_empty() && delta > sorted.len() / 10 {
        return None;
    }

    let mut result = sorted.to_vec();

    // Remove old values (binary search for each removal)
    for &val in removals {
        if let Ok(idx) =
            result.binary_search_by(|a| a.partial_cmp(&val).unwrap_or(std::cmp::Ordering::Equal))
        {
            result.remove(idx);
        }
    }

    // Insert new values (binary search for insertion point)
    for &val in insertions {
        let idx = result
            .binary_search_by(|a| a.partial_cmp(&val).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or_else(|i| i);
        result.insert(idx, val);
    }

    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    #[test]
    fn test_get_or_sort_basic() {
        clear();
        let flat = vec![num(3.0), num(1.0), num(5.0), num(2.0), num(4.0)];
        let sorted = get_or_sort_asc(&flat).unwrap();
        assert_eq!(*sorted, vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn test_cache_hit_returns_same_arc() {
        clear();
        let flat = vec![num(3.0), num(1.0), num(2.0)];
        let first = get_or_sort_asc(&flat).unwrap();
        let second = get_or_sort_asc(&flat).unwrap();
        // Same Arc — not just equal values, but same allocation
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn test_clear_invalidates_cache() {
        clear();
        let flat = vec![num(3.0), num(1.0), num(2.0)];
        let first = get_or_sort_asc(&flat).unwrap();
        clear();
        let second = get_or_sort_asc(&flat).unwrap();
        // Values should be equal but NOT the same Arc (cache was cleared)
        assert_eq!(*first, *second);
        assert!(!Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn test_error_propagation() {
        clear();
        let flat = vec![num(1.0), CellValue::Error(CellError::Na, None), num(3.0)];
        let result = get_or_sort_asc(&flat);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), CellError::Na);
    }

    #[test]
    fn test_skips_non_numeric() {
        clear();
        let flat = vec![
            num(3.0),
            CellValue::Text("hello".into()),
            num(1.0),
            CellValue::Null,
            num(2.0),
        ];
        let sorted = get_or_sort_asc(&flat).unwrap();
        assert_eq!(*sorted, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_empty_array() {
        clear();
        let flat: Vec<CellValue> = vec![];
        let sorted = get_or_sort_asc(&flat).unwrap();
        assert!(sorted.is_empty());
    }

    #[test]
    fn test_different_arrays_same_length() {
        clear();
        let flat_a = vec![num(1.0), num(2.0), num(3.0)];
        let flat_b = vec![num(4.0), num(5.0), num(6.0)];
        let sorted_a = get_or_sort_asc(&flat_a).unwrap();
        let sorted_b = get_or_sort_asc(&flat_b).unwrap();
        assert_eq!(*sorted_a, vec![1.0, 2.0, 3.0]);
        assert_eq!(*sorted_b, vec![4.0, 5.0, 6.0]);
    }

    #[test]
    fn test_sort_and_build_basic() {
        let flat = vec![num(5.0), num(1.0), num(3.0), num(2.0), num(4.0)];
        let sorted = sort_and_build(&flat).unwrap();
        assert_eq!(*sorted, vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn test_sort_and_build_error() {
        let flat = vec![num(1.0), CellValue::Error(CellError::Na, None)];
        assert!(sort_and_build(&flat).is_err());
    }

    #[test]
    fn test_sort_and_build_skips_non_numeric() {
        let flat = vec![
            num(3.0),
            CellValue::Text("hello".into()),
            num(1.0),
            CellValue::Null,
        ];
        let sorted = sort_and_build(&flat).unwrap();
        assert_eq!(*sorted, vec![1.0, 3.0]);
    }

    #[test]
    fn test_hash_collision_safety() {
        // Even if two arrays happen to produce the same hash+len key,
        // the collision check (unsorted comparison) prevents wrong results.
        // We can't easily force a collision, but we verify the mechanism works
        // by testing that distinct arrays with the same length return correct sorts.
        clear();
        let flat_a = vec![num(3.0), num(1.0)];
        let flat_b = vec![num(5.0), num(2.0)];
        let sorted_a = get_or_sort_asc(&flat_a).unwrap();
        let sorted_b = get_or_sort_asc(&flat_b).unwrap();
        assert_eq!(*sorted_a, vec![1.0, 3.0]);
        assert_eq!(*sorted_b, vec![2.0, 5.0]);
    }

    // -- incremental_update tests --

    #[test]
    fn test_incremental_update_basic() {
        let sorted = vec![
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
            17.0, 18.0, 19.0, 20.0,
        ];
        // Remove 5.0, insert 5.5 — small delta relative to size
        let result = incremental_update(&sorted, &[5.0], &[5.5]);
        assert!(result.is_some());
        let r = result.unwrap();
        assert!(!r.contains(&5.0));
        assert!(r.contains(&5.5));
        // Verify still sorted
        for w in r.windows(2) {
            assert!(w[0] <= w[1]);
        }
    }

    #[test]
    fn test_incremental_update_returns_none_on_large_delta() {
        let sorted = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        // 2 removals + 2 insertions = 4 > 10/10 = 1 → should return None
        let result = incremental_update(&sorted, &[1.0, 2.0], &[1.5, 2.5]);
        assert!(result.is_none());
    }

    #[test]
    fn test_incremental_update_empty_delta() {
        let sorted = vec![1.0, 2.0, 3.0];
        let result = incremental_update(&sorted, &[], &[]);
        assert!(result.is_some());
        assert_eq!(result.unwrap(), vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn test_incremental_update_removal_not_found() {
        let sorted = vec![
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
            17.0, 18.0, 19.0, 20.0,
        ];
        // Try to remove 99.0 which doesn't exist — should not panic
        let result = incremental_update(&sorted, &[99.0], &[]);
        assert!(result.is_some());
        assert_eq!(result.unwrap().len(), 20);
    }

    #[test]
    fn test_incremental_update_preserves_sort_order() {
        let sorted = vec![
            1.0, 3.0, 5.0, 7.0, 9.0, 11.0, 13.0, 15.0, 17.0, 19.0, 21.0, 23.0, 25.0, 27.0, 29.0,
            31.0, 33.0, 35.0, 37.0, 39.0,
        ];
        let result = incremental_update(&sorted, &[5.0], &[4.0]).unwrap();
        for w in result.windows(2) {
            assert!(w[0] <= w[1], "Not sorted: {} > {}", w[0], w[1]);
        }
        assert!(result.contains(&4.0));
        assert!(!result.contains(&5.0));
    }
}
