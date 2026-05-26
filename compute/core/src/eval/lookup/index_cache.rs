//! LookupIndexCache — thread-safe (native) or single-threaded (WASM) cache
//! of lookup indexes keyed by `(SheetId, col)`.

use super::index::LookupIndex;

#[cfg(feature = "native")]
use cell_types::SheetId;

#[cfg(feature = "native")]
use dashmap::DashMap;

#[cfg(feature = "native")]
use value_types::CellValue;

#[cfg(not(feature = "native"))]
use rustc_hash::FxHashMap;

// ---------------------------------------------------------------------------
// LookupIndexCache — available on both native and WASM
// ---------------------------------------------------------------------------

// On native: use DashMap for thread-safe concurrent access.
// On WASM: use RefCell<HashMap> for single-threaded access.

/// Thread-safe cache of lookup indexes (native: DashMap, WASM: RefCell<HashMap>).
#[cfg(feature = "native")]
pub struct LookupIndexCache {
    indexes: DashMap<(SheetId, u32), LookupIndex>,
}

#[cfg(feature = "native")]
impl LookupIndexCache {
    /// Create a new empty cache.
    pub fn new() -> Self {
        Self {
            indexes: DashMap::new(),
        }
    }

    /// Get an existing index, or build and cache it using the provided builder closure.
    pub fn get_or_build<F>(
        &self,
        sheet: SheetId,
        col: u32,
        builder: F,
    ) -> dashmap::mapref::one::Ref<'_, (SheetId, u32), LookupIndex>
    where
        F: FnOnce() -> LookupIndex,
    {
        let key = (sheet, col);
        // Try to get existing entry first
        if let Some(entry) = self.indexes.get(&key) {
            return entry;
        }
        // Build and insert
        self.indexes.entry(key).or_insert_with(builder).downgrade()
    }

    /// Get or build a lookup index from full column values (`col_data`).
    ///
    /// This is the standard entry point for indexed lookups. It builds from
    /// `&[CellValue]` which includes both text and numeric values, producing
    /// a complete index that never needs a text-search fallback.
    pub fn get_or_build_from_col_data(
        &self,
        sheet: SheetId,
        col: u32,
        col_values: &[CellValue],
    ) -> dashmap::mapref::one::Ref<'_, (SheetId, u32), LookupIndex> {
        self.get_or_build(sheet, col, || {
            LookupIndex::build(
                col_values
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| !matches!(v, CellValue::Null))
                    .map(|(i, v)| (i as u32, v.clone())),
            )
        })
    }

    /// Clear all cached indexes.
    pub fn clear(&self) {
        self.indexes.clear();
    }

    /// Remove the cached lookup index for a specific (sheet, col) pair.
    /// Used during incremental invalidation when a cell in that column changes.
    pub fn remove_column(&self, sheet: SheetId, col: u32) {
        self.indexes.remove(&(sheet, col));
    }
}

#[cfg(feature = "native")]
impl Default for LookupIndexCache {
    fn default() -> Self {
        Self::new()
    }
}

// === WASM LookupIndexCache using RefCell<HashMap> ===

/// Single-threaded cache of lookup indexes for WASM targets.
#[cfg(not(feature = "native"))]
pub struct LookupIndexCache {
    indexes: std::cell::RefCell<FxHashMap<(cell_types::SheetId, u32), LookupIndex>>,
}

#[cfg(not(feature = "native"))]
impl LookupIndexCache {
    /// Create a new empty cache.
    pub fn new() -> Self {
        Self {
            indexes: std::cell::RefCell::new(FxHashMap::default()),
        }
    }

    /// Search an existing index using the given closure. Returns `None` if the
    /// index for `(sheet, col)` has not been built yet. Otherwise calls `f` with
    /// a reference to the cached `LookupIndex`.
    pub fn with_index<F, R>(&self, sheet: cell_types::SheetId, col: u32, f: F) -> Option<R>
    where
        F: FnOnce(&LookupIndex) -> R,
    {
        let indexes = self.indexes.borrow();
        indexes.get(&(sheet, col)).map(f)
    }

    /// Ensure an index exists for `(sheet, col)`, building it with `builder` if absent.
    /// Then call `f` on the cached index and return the result.
    pub fn get_or_build_with<F, B, R>(
        &self,
        sheet: cell_types::SheetId,
        col: u32,
        builder: B,
        f: F,
    ) -> R
    where
        B: FnOnce() -> LookupIndex,
        F: FnOnce(&LookupIndex) -> R,
    {
        let key = (sheet, col);
        // Check if already present (fast path — separate borrow scope)
        {
            let indexes = self.indexes.borrow();
            if let Some(idx) = indexes.get(&key) {
                return f(idx);
            }
        }
        // Build and insert
        let built = builder();
        let mut indexes = self.indexes.borrow_mut();
        indexes.entry(key).or_insert(built);
        // Re-borrow immutably to call f (drop mut borrow first)
        drop(indexes);
        let indexes = self.indexes.borrow();
        f(indexes.get(&key).expect("just inserted"))
    }

    /// Clear all cached indexes.
    pub fn clear(&self) {
        self.indexes.borrow_mut().clear();
    }

    /// Remove the cached lookup index for a specific (sheet, col) pair.
    /// Used during incremental invalidation when a cell in that column changes.
    pub fn remove_column(&self, sheet: cell_types::SheetId, col: u32) {
        self.indexes.borrow_mut().remove(&(sheet, col));
    }
}

#[cfg(not(feature = "native"))]
impl Default for LookupIndexCache {
    fn default() -> Self {
        Self::new()
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::SheetId;
    use value_types::{CellValue, FiniteF64};

    /// Helper: build a CellValue::Number from a raw f64.
    fn num(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(v))
    }

    // -----------------------------------------------------------------------
    // test_cache_get_or_build (native only)
    // -----------------------------------------------------------------------

    #[cfg(feature = "native")]
    #[test]
    fn test_cache_get_or_build() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let cache = LookupIndexCache::new();
        let sheet = SheetId::from_raw(1);
        let build_count = AtomicUsize::new(0);

        // First call: should build
        let _ref1 = cache.get_or_build(sheet, 0, || {
            build_count.fetch_add(1, Ordering::SeqCst);
            LookupIndex::build(vec![(0u32, num(10.0))].into_iter())
        });
        assert_eq!(build_count.load(Ordering::SeqCst), 1);
        drop(_ref1);

        // Second call: should return cached, not build again
        let _ref2 = cache.get_or_build(sheet, 0, || {
            build_count.fetch_add(1, Ordering::SeqCst);
            LookupIndex::build(vec![(0u32, num(99.0))].into_iter())
        });
        assert_eq!(build_count.load(Ordering::SeqCst), 1);

        // Verify it's the first-built index (value 10.0, not 99.0)
        assert_eq!(_ref2.search_exact_numeric(10.0), Some(0));
        assert_eq!(_ref2.search_exact_numeric(99.0), None);
    }

    // -----------------------------------------------------------------------
    // test_cache_clear (native only)
    // -----------------------------------------------------------------------

    #[cfg(feature = "native")]
    #[test]
    fn test_cache_clear() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let cache = LookupIndexCache::new();
        let sheet = SheetId::from_raw(1);
        let build_count = AtomicUsize::new(0);

        // Build an entry
        let _ref1 = cache.get_or_build(sheet, 0, || {
            build_count.fetch_add(1, Ordering::SeqCst);
            LookupIndex::build(vec![(0u32, num(10.0))].into_iter())
        });
        assert_eq!(build_count.load(Ordering::SeqCst), 1);
        drop(_ref1);

        // Clear the cache
        cache.clear();

        // Next call should build again
        let _ref2 = cache.get_or_build(sheet, 0, || {
            build_count.fetch_add(1, Ordering::SeqCst);
            LookupIndex::build(vec![(0u32, num(20.0))].into_iter())
        });
        assert_eq!(build_count.load(Ordering::SeqCst), 2);

        // Verify new index has the new value
        assert_eq!(_ref2.search_exact_numeric(20.0), Some(0));
        assert_eq!(_ref2.search_exact_numeric(10.0), None);
    }
}
