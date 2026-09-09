//! Persistent workbook-lifetime cache.
//!
//! `WorkbookCache` lives on `ComputeCore` and survives across recalc epochs.
//! It holds:
//!
//! - **Tier 0**: `LookupIndexCache` — workbook-lifetime lookup indexes that
//!   persist until structural changes (insert/delete row/col). Previously
//!   recreated per-epoch on `ParallelDemandExecutor`; now shared across epochs.
//!
//! - **Tier 1**: Version-validated persistent caches wrapped in
//!   `VersionedEntry<V>` for column-version-based staleness checks:
//!   - Sorted cache (SMALL/LARGE/RANK)
//!   - Frequency cache (COUNTIF/SUMIF)
//!   - bitmask_cache
//!
//! ## Eviction policy (Tier 1)
//!
//! Each Tier 1 cache has a max capacity of 10K entries. When inserting into a
//! full cache, a batch of entries is evicted. The bitmask tier also enforces
//! a 32 MiB retained-memory budget, including mask words and criterion text.

use crate::eval::lookup::index_cache::LookupIndexCache;

#[cfg(feature = "native")]
use std::sync::Arc;
#[cfg(feature = "native")]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(feature = "native")]
use super::range_version::RangeVersion;
#[cfg(feature = "native")]
use super::versioned_entry::VersionedEntry;
#[cfg(feature = "native")]
use crate::eval::context::traits::DataSource;
#[cfg(feature = "native")]
use cell_types::SheetId;
#[cfg(feature = "native")]
use compute_functions::helpers::bitmask_cache::{CachedBitmask, build_bitmask, update_bitmask_row};
#[cfg(feature = "native")]
use compute_functions::helpers::column_bitset::ColumnBitset;
#[cfg(feature = "native")]
use compute_functions::helpers::conditional_aggregate::ValueSlice;
#[cfg(feature = "native")]
use compute_functions::helpers::frequency_cache::{
    CountFrequencyMap, SumFrequencyMap, build_count_map, build_sum_map,
};
#[cfg(feature = "native")]
use compute_functions::helpers::sorted_cache::{incremental_update, sort_and_build};
#[cfg(feature = "native")]
use dashmap::DashMap;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Cache observability — counters and snapshots
// ---------------------------------------------------------------------------

/// Atomic counters for a single cache tier.
#[cfg(feature = "native")]
#[derive(Debug, Default)]
pub struct CacheCounters {
    pub hits: AtomicU64,
    pub misses: AtomicU64,
    pub rebuilds: AtomicU64,
    pub evictions: AtomicU64,
}

/// Non-atomic snapshot of a single cache tier's counters.
#[derive(Debug, Clone, Default)]
pub struct CacheCountersSnapshot {
    pub hits: u64,
    pub misses: u64,
    pub rebuilds: u64,
    pub evictions: u64,
}

#[cfg(feature = "native")]
impl CacheCounters {
    fn snapshot(&self) -> CacheCountersSnapshot {
        CacheCountersSnapshot {
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
            rebuilds: self.rebuilds.load(Ordering::Relaxed),
            evictions: self.evictions.load(Ordering::Relaxed),
        }
    }
}

/// Atomic counters for all workbook cache tiers.
#[cfg(feature = "native")]
#[derive(Debug, Default)]
pub struct WorkbookCacheStats {
    pub sorted: CacheCounters,
    pub frequency_count: CacheCounters,
    pub frequency_sum: CacheCounters,
    pub bitmask: CacheCounters,
    pub lookup: CacheCounters,
}

/// Non-atomic snapshot of all workbook cache stats.
#[derive(Debug, Clone, Default)]
pub struct WorkbookCacheStatsSnapshot {
    pub sorted: CacheCountersSnapshot,
    pub frequency_count: CacheCountersSnapshot,
    pub frequency_sum: CacheCountersSnapshot,
    pub bitmask: CacheCountersSnapshot,
    pub lookup: CacheCountersSnapshot,
    /// Estimated total memory usage in bytes across all cache tiers.
    pub estimated_memory_bytes: usize,
    /// Per-tier entry counts and estimated memory.
    pub sorted_entries: usize,
    pub sorted_memory_bytes: usize,
    pub frequency_count_entries: usize,
    pub frequency_count_memory_bytes: usize,
    pub frequency_sum_entries: usize,
    pub frequency_sum_memory_bytes: usize,
    pub bitmask_entries: usize,
    pub bitmask_memory_bytes: usize,
    pub lookup_entries: usize,
    pub lookup_memory_bytes: usize,
}

// ---------------------------------------------------------------------------
// Tier 1: Sorted Cache — key types
// ---------------------------------------------------------------------------

/// Cache key for sorted arrays: (sheet_id, col, row_start, row_end).
/// Identifies the exact column range whose values were sorted.
/// Used by SMALL, LARGE, RANK functions.
#[cfg(feature = "native")]
pub(crate) type SortedCacheKey = (SheetId, u32, u32, u32);

/// Max entries in the Tier 1 sorted cache before eviction.
#[cfg(feature = "native")]
const SORTED_CACHE_MAX: usize = 10_000;

// ---------------------------------------------------------------------------
// Tier 1: Frequency Cache — key types
// ---------------------------------------------------------------------------

/// Cache key for count frequency maps: (sheet_id, col, row_start, row_end).
/// Identifies the exact range whose values were used to build the frequency map.
#[cfg(feature = "native")]
pub(crate) type FrequencyCountKey = (SheetId, u32, u32, u32);

/// Cache key for sum frequency maps: (criteria range key, sum range key).
/// Each sub-key is (sheet_id, col, row_start, row_end).
#[cfg(feature = "native")]
pub(crate) type FrequencySumKey = (FrequencyCountKey, FrequencyCountKey);

/// Max entries per Tier 1 frequency cache before eviction.
#[cfg(feature = "native")]
#[allow(dead_code)]
const FREQUENCY_CACHE_MAX: usize = 10_000;

// ---------------------------------------------------------------------------
// Tier 1: Bitmask Cache — key types
// ---------------------------------------------------------------------------

/// Cache key for bitmask entries: (sheet_id, col, row_start, row_end, criteria_hash).
/// Identifies the exact column range + hashed criterion used to build the bitmask.
/// The criteria hash is an FxHash of the raw criteria `CellValue`.
#[cfg(feature = "native")]
pub(crate) type BitmaskCacheKey = (SheetId, u32, u32, u32, u64);

/// Max entries in the Tier 1 bitmask cache before eviction.
#[cfg(feature = "native")]
const BITMASK_CACHE_MAX: usize = 10_000;

/// Retained mask words, criteria text, and conservatively estimated entry overhead.
#[cfg(feature = "native")]
const BITMASK_CACHE_BYTES: usize = 32 * 1024 * 1024;

#[cfg(feature = "native")]
fn bitmask_entry_bytes(rows: u32, criteria: &CellValue) -> Option<usize> {
    let criteria_bytes = match criteria {
        CellValue::Number(_) | CellValue::Boolean(_) | CellValue::Null => 0,
        CellValue::Text(text) => text.len(),
        CellValue::Error(_, message) => message.as_ref().map_or(0, |text| text.len()),
        // Complex criterion objects can retain unrelated payloads. They keep
        // the ordinary predicate scan instead of entering this bounded cache.
        _ => return None,
    };
    let entry_overhead = std::mem::size_of::<BitmaskCacheKey>()
        + std::mem::size_of::<VersionedEntry<CachedBitmask>>()
        + 128;
    Some(entry_overhead + criteria_bytes + (rows as usize).div_ceil(64) * 8)
}

/// Persistent cache that lives on `ComputeCore` across recalc epochs.
///
/// On native targets, provides thread-safe (`DashMap`-backed) caches.
/// On WASM, the lookup cache is not available (single-threaded contexts
/// use thread-local caches or will get a `WorkbookCacheLocal`).
pub struct WorkbookCache {
    // Tier 0 — persists until structural changes (insert/delete row/col).
    // Available on both native (DashMap-backed) and WASM (RefCell-backed).
    pub(crate) lookup_cache: LookupIndexCache,

    // === Tier 1: Sorted Cache ===
    #[cfg(feature = "native")]
    pub(crate) sorted_cache: DashMap<SortedCacheKey, VersionedEntry<Arc<Vec<f64>>>>,

    // === Tier 1: Frequency Cache ===
    #[cfg(feature = "native")]
    pub(crate) count_frequency_cache: DashMap<FrequencyCountKey, VersionedEntry<CountFrequencyMap>>,
    #[cfg(feature = "native")]
    pub(crate) sum_frequency_cache: DashMap<FrequencySumKey, VersionedEntry<SumFrequencyMap>>,

    // === Tier 1: Bitmask Cache ===
    #[cfg(feature = "native")]
    pub(crate) bitmask_cache: DashMap<BitmaskCacheKey, VersionedEntry<CachedBitmask>>,
    // Serializes admission/eviction only; valid cache hits never acquire it.
    #[cfg(feature = "native")]
    bitmask_bytes: std::sync::Mutex<usize>,

    // === Cache observability ===
    #[cfg(feature = "native")]
    stats: WorkbookCacheStats,
}

#[allow(dead_code)]
impl WorkbookCache {
    /// Create a new empty workbook cache.
    pub fn new() -> Self {
        Self {
            lookup_cache: LookupIndexCache::new(),
            #[cfg(feature = "native")]
            sorted_cache: DashMap::with_capacity(256),
            #[cfg(feature = "native")]
            count_frequency_cache: DashMap::with_capacity(256),
            #[cfg(feature = "native")]
            sum_frequency_cache: DashMap::with_capacity(256),
            #[cfg(feature = "native")]
            bitmask_cache: DashMap::with_capacity(256),
            #[cfg(feature = "native")]
            bitmask_bytes: std::sync::Mutex::new(0),
            #[cfg(feature = "native")]
            stats: WorkbookCacheStats::default(),
        }
    }

    /// Invalidate position-dependent lookup indexes and criteria masks.
    ///
    /// Called on structural changes (insert/delete row/col) that may shift
    /// cell positions, invalidating all column-keyed lookup indexes.
    pub fn invalidate_structure(&self) {
        self.lookup_cache.clear();
        #[cfg(feature = "native")]
        self.clear_bitmasks();
    }

    /// Clear all caches (Tier 0 and Tier 1).
    ///
    /// Called when the workbook is reloaded from scratch (e.g., `init_from_snapshot`).
    pub fn clear_all(&self) {
        self.lookup_cache.clear();
        #[cfg(feature = "native")]
        self.sorted_cache.clear();
        #[cfg(feature = "native")]
        self.count_frequency_cache.clear();
        #[cfg(feature = "native")]
        self.sum_frequency_cache.clear();
        #[cfg(feature = "native")]
        self.clear_bitmasks();
    }

    #[cfg(feature = "native")]
    fn clear_bitmasks(&self) {
        let mut bytes = self
            .bitmask_bytes
            .lock()
            .expect("bitmask admission lock poisoned");
        self.bitmask_cache.clear();
        *bytes = 0;
    }

    // === Tier 1: Sorted Cache — accessors ===

    /// Get or build a sorted (ascending) numeric array for the given range.
    ///
    /// If a valid cached entry exists (column versions match), returns the
    /// cached `Arc<Vec<f64>>`. Otherwise builds a new sorted array from
    /// `values` via [`sort_and_build`], wraps it in a `VersionedEntry`,
    /// and inserts it into the cache.
    ///
    /// `key`: (sheet_id, col, row_start, row_end) identifying the range.
    /// `mirror`: current cell mirror for version validation.
    /// `sheet`: sheet containing the range.
    /// `col`: column of the range (for `RangeVersion` capture).
    /// `values`: cell values to extract numerics from and sort.
    ///
    /// Returns `None` if `values` contains an error cell (the caller should
    /// propagate the error from the cell values directly).
    #[cfg(feature = "native")]
    pub(crate) fn get_or_build_sorted(
        &self,
        key: SortedCacheKey,
        source: &dyn DataSource,
        sheet: &SheetId,
        col: u32,
        values: &[CellValue],
    ) -> Option<Arc<Vec<f64>>> {
        // Fast path: check for a valid cached entry.
        if let Some(entry) = self.sorted_cache.get(&key)
            && entry.is_valid(source)
        {
            self.stats.sorted.hits.fetch_add(1, Ordering::Relaxed);
            return Some(Arc::clone(&entry.value));
        }

        // Miss or stale — build and insert.
        self.stats.sorted.misses.fetch_add(1, Ordering::Relaxed);
        self.stats.sorted.rebuilds.fetch_add(1, Ordering::Relaxed);
        let sorted = sort_and_build(values).ok()?;
        let range_version = RangeVersion::capture(source, sheet, col, col);
        let versioned = VersionedEntry::new(Arc::clone(&sorted), range_version);

        // Evict if at capacity.
        if self.sorted_cache.len() >= SORTED_CACHE_MAX {
            self.evict_sorted();
        }

        self.sorted_cache.insert(key, versioned);
        Some(sorted)
    }

    /// Evict ~10% of sorted cache entries (oldest by insertion order).
    #[cfg(feature = "native")]
    fn evict_sorted(&self) {
        let to_remove = SORTED_CACHE_MAX / 10;
        let keys: Vec<_> = self
            .sorted_cache
            .iter()
            .take(to_remove)
            .map(|entry| *entry.key())
            .collect();
        let evicted = keys.len() as u64;
        for k in keys {
            self.sorted_cache.remove(&k);
        }
        self.stats
            .sorted
            .evictions
            .fetch_add(evicted, Ordering::Relaxed);
    }

    // === Tier 1: Frequency Cache — accessors ===

    /// Get or build a `CountFrequencyMap` for the given range.
    ///
    /// If a valid cached entry exists (column versions match), returns the
    /// cached map. Otherwise builds a new map from `values`, wraps it in a
    /// `VersionedEntry`, and inserts it into the cache.
    ///
    /// `key`: (sheet_id, col, row_start, row_end) identifying the range.
    /// `mirror`: current cell mirror for version validation.
    /// `sheet`: sheet containing the range.
    /// `col_start`/`col_end`: column span for `RangeVersion` capture.
    /// `values`: cell value refs to build the frequency map from.
    #[cfg(feature = "native")]
    pub(crate) fn get_or_build_count_frequency<'a>(
        &self,
        key: FrequencyCountKey,
        source: &dyn DataSource,
        sheet: &SheetId,
        col_start: u32,
        col_end: u32,
        values: impl FnOnce() -> Vec<&'a CellValue>,
    ) -> dashmap::mapref::one::Ref<'_, FrequencyCountKey, VersionedEntry<CountFrequencyMap>> {
        // Fast path: check for a valid cached entry.
        if let Some(entry) = self.count_frequency_cache.get(&key)
            && entry.is_valid(source)
        {
            self.stats
                .frequency_count
                .hits
                .fetch_add(1, Ordering::Relaxed);
            return entry;
        }

        // Miss or stale — build and insert.
        self.stats
            .frequency_count
            .misses
            .fetch_add(1, Ordering::Relaxed);
        self.stats
            .frequency_count
            .rebuilds
            .fetch_add(1, Ordering::Relaxed);
        let vals = values();
        let map = build_count_map(&vals);
        let range_version = RangeVersion::capture(source, sheet, col_start, col_end);
        let versioned = VersionedEntry::new(map, range_version);

        // Evict if at capacity.
        if self.count_frequency_cache.len() >= FREQUENCY_CACHE_MAX {
            self.evict_count_frequency();
        }

        match self.count_frequency_cache.entry(key) {
            dashmap::mapref::entry::Entry::Occupied(mut e) => {
                e.insert(versioned);
                e.into_ref().downgrade()
            }
            dashmap::mapref::entry::Entry::Vacant(e) => e.insert(versioned).downgrade(),
        }
    }

    /// Get or build a `SumFrequencyMap` for the given criteria+sum range pair.
    ///
    /// If a valid cached entry exists (column versions match for both ranges),
    /// returns the cached map. Otherwise builds a new map, wraps it in a
    /// `VersionedEntry`, and inserts it.
    ///
    /// `key`: (criteria_range_key, sum_range_key).
    /// `mirror`: current cell mirror for version validation.
    /// `sheet`: sheet containing the ranges.
    /// `col_start`/`col_end`: combined column span covering both ranges.
    /// `crit_values`/`sum_values`: cell value refs for building the map.
    #[cfg(feature = "native")]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn get_or_build_sum_frequency<'a>(
        &self,
        key: FrequencySumKey,
        source: &dyn DataSource,
        sheet: &SheetId,
        col_start: u32,
        col_end: u32,
        crit_values: impl FnOnce() -> Vec<&'a CellValue>,
        sum_values: impl FnOnce() -> Vec<&'a CellValue>,
    ) -> dashmap::mapref::one::Ref<'_, FrequencySumKey, VersionedEntry<SumFrequencyMap>> {
        // Fast path: check for a valid cached entry.
        if let Some(entry) = self.sum_frequency_cache.get(&key)
            && entry.is_valid(source)
        {
            self.stats
                .frequency_sum
                .hits
                .fetch_add(1, Ordering::Relaxed);
            return entry;
        }

        // Miss or stale — build and insert.
        self.stats
            .frequency_sum
            .misses
            .fetch_add(1, Ordering::Relaxed);
        self.stats
            .frequency_sum
            .rebuilds
            .fetch_add(1, Ordering::Relaxed);
        let crit_vals = crit_values();
        let sum_vals = sum_values();
        let map = build_sum_map(&crit_vals, &sum_vals);
        let range_version = RangeVersion::capture(source, sheet, col_start, col_end);
        let versioned = VersionedEntry::new(map, range_version);

        // Evict if at capacity.
        if self.sum_frequency_cache.len() >= FREQUENCY_CACHE_MAX {
            self.evict_sum_frequency();
        }

        match self.sum_frequency_cache.entry(key) {
            dashmap::mapref::entry::Entry::Occupied(mut e) => {
                e.insert(versioned);
                e.into_ref().downgrade()
            }
            dashmap::mapref::entry::Entry::Vacant(e) => e.insert(versioned).downgrade(),
        }
    }

    /// Evict ~10% of count frequency cache entries (oldest by insertion order).
    #[cfg(feature = "native")]
    fn evict_count_frequency(&self) {
        let to_remove = FREQUENCY_CACHE_MAX / 10;
        let keys: Vec<_> = self
            .count_frequency_cache
            .iter()
            .take(to_remove)
            .map(|entry| *entry.key())
            .collect();
        let evicted = keys.len() as u64;
        for k in keys {
            self.count_frequency_cache.remove(&k);
        }
        self.stats
            .frequency_count
            .evictions
            .fetch_add(evicted, Ordering::Relaxed);
    }

    /// Evict ~10% of sum frequency cache entries (oldest by insertion order).
    #[cfg(feature = "native")]
    fn evict_sum_frequency(&self) {
        let to_remove = FREQUENCY_CACHE_MAX / 10;
        let keys: Vec<_> = self
            .sum_frequency_cache
            .iter()
            .take(to_remove)
            .map(|entry| *entry.key())
            .collect();
        let evicted = keys.len() as u64;
        for k in keys {
            self.sum_frequency_cache.remove(&k);
        }
        self.stats
            .frequency_sum
            .evictions
            .fetch_add(evicted, Ordering::Relaxed);
    }

    // === Tier 1: Bitmask Cache — accessors ===

    /// Try to get a cached bitmask (hit-only, no build on miss).
    ///
    /// Returns `Some(ColumnBitset)` if a valid cached entry exists for the key,
    /// `None` otherwise. Used by the borrowed multi-criteria path where building
    /// on miss is wasteful for dynamic criteria (e.g., `">="&$CY109`) that
    /// produce unique keys per cell with little opportunity for reuse.
    #[cfg(feature = "native")]
    pub(crate) fn try_get_bitmask(
        &self,
        key: &BitmaskCacheKey,
        source: &dyn DataSource,
        criteria: &CellValue,
    ) -> Option<compute_functions::helpers::column_bitset::ColumnBitset> {
        if let Some(entry) = self.bitmask_cache.get(key)
            && entry.is_valid(source)
            && entry.value.criteria == *criteria
        {
            self.stats.bitmask.hits.fetch_add(1, Ordering::Relaxed);
            return Some(entry.value.bitmask.clone());
        }
        self.stats.bitmask.misses.fetch_add(1, Ordering::Relaxed);
        None
    }

    /// Build a versioned mask from borrowed native values on a cache miss.
    ///
    /// Retains only match bits and the criterion used for collision checking.
    /// Oversized masks or complex criterion objects bypass cache admission.
    #[cfg(feature = "native")]
    pub(crate) fn get_or_build_bitmask<V: ValueSlice + ?Sized>(
        &self,
        key: BitmaskCacheKey,
        source: &dyn DataSource,
        criteria: &CellValue,
        range_values: &V,
    ) -> Option<ColumnBitset> {
        if let Some(entry) = self.bitmask_cache.get(&key)
            && entry.is_valid(source)
            && entry.value.criteria == *criteria
        {
            self.stats.bitmask.hits.fetch_add(1, Ordering::Relaxed);
            return Some(entry.value.bitmask.clone());
        }
        self.stats.bitmask.misses.fetch_add(1, Ordering::Relaxed);
        let rows = u32::try_from(range_values.len()).ok()?;
        let entry_bytes = bitmask_entry_bytes(rows, criteria)?;
        if entry_bytes > BITMASK_CACHE_BYTES {
            return None;
        }

        // Build outside the admission lock so distinct cold masks can be
        // computed concurrently. No generic value buffer is created.
        let bitmask = build_bitmask(range_values, criteria);
        self.stats.bitmask.rebuilds.fetch_add(1, Ordering::Relaxed);
        let result = bitmask.clone();
        let cached = CachedBitmask {
            _arc_ref: None,
            criteria: criteria.clone(),
            bitmask,
        };
        let range_version = RangeVersion::capture(source, &key.0, key.1, key.1);
        let versioned = VersionedEntry::new(cached, range_version);

        self.insert_bitmask(key, versioned, entry_bytes);
        Some(result)
    }

    #[cfg(feature = "native")]
    fn insert_bitmask(
        &self,
        key: BitmaskCacheKey,
        versioned: VersionedEntry<CachedBitmask>,
        entry_bytes: usize,
    ) {
        let mut bytes = self
            .bitmask_bytes
            .lock()
            .expect("bitmask admission lock poisoned");
        if let Some((_, previous)) = self.bitmask_cache.remove(&key) {
            *bytes -= bitmask_entry_bytes(previous.value.bitmask.len(), &previous.value.criteria)
                .expect("only supported criteria enter the bitmask cache");
        }
        while self.bitmask_cache.len() >= BITMASK_CACHE_MAX
            || *bytes + entry_bytes > BITMASK_CACHE_BYTES
        {
            self.evict_bitmasks(&mut bytes);
        }
        self.bitmask_cache.insert(key, versioned);
        *bytes += entry_bytes;
    }

    /// Evict a small batch while the caller holds the admission lock.
    #[cfg(feature = "native")]
    fn evict_bitmasks(&self, bytes: &mut usize) {
        let to_remove = (self.bitmask_cache.len() / 10).max(1);
        let keys: Vec<_> = self
            .bitmask_cache
            .iter()
            .take(to_remove)
            .map(|entry| *entry.key())
            .collect();
        for key in keys {
            if let Some((_, entry)) = self.bitmask_cache.remove(&key) {
                *bytes -= bitmask_entry_bytes(entry.value.bitmask.len(), &entry.value.criteria)
                    .expect("only supported criteria enter the bitmask cache");
                self.stats.bitmask.evictions.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    // === Incremental update methods ===
    //
    // These methods attempt to incrementally patch a stale cache entry using
    // small deltas (old values → new values) instead of doing a full rebuild.
    // They return `Some` on success or `None` if the delta is too large or the
    // entry doesn't exist. Callers should fall back to `get_or_build_*` on `None`.
    //
    // The actual call sites will be wired when the evaluator threads old cell
    // values through (e.g., from EpochCache).

    /// Try to incrementally update a stale sorted cache entry.
    ///
    /// `removals`: old numeric values that were removed from the range.
    /// `insertions`: new numeric values that were added to the range.
    ///
    /// Returns `Some(Arc<Vec<f64>>)` if incremental update succeeded,
    /// `None` if the entry doesn't exist, delta is too large (>10%), or
    /// incremental update was not possible.
    #[cfg(feature = "native")]
    pub(crate) fn try_incremental_sorted_update(
        &self,
        key: SortedCacheKey,
        source: &dyn DataSource,
        sheet: &SheetId,
        col: u32,
        removals: &[f64],
        insertions: &[f64],
    ) -> Option<Arc<Vec<f64>>> {
        // Look up existing entry — must exist but can be stale.
        let existing = self.sorted_cache.get(&key)?;
        let old_sorted = &existing.value;

        // Try incremental update (returns None if delta > 10%).
        let updated = incremental_update(old_sorted, removals, insertions)?;
        let updated_arc = Arc::new(updated);

        // Drop the read guard before writing.
        drop(existing);

        // Re-insert with fresh version.
        let range_version = RangeVersion::capture(source, sheet, col, col);
        let versioned = VersionedEntry::new(Arc::clone(&updated_arc), range_version);
        self.sorted_cache.insert(key, versioned);

        Some(updated_arc)
    }

    /// Try to incrementally update a stale count frequency cache entry.
    ///
    /// `changes`: list of (old_value, new_value) pairs representing cell changes.
    ///
    /// Returns `true` if the entry was updated in place, `false` if the entry
    /// doesn't exist (caller should fall back to `get_or_build_count_frequency`).
    #[cfg(feature = "native")]
    pub(crate) fn try_incremental_count_frequency_update(
        &self,
        key: FrequencyCountKey,
        source: &dyn DataSource,
        sheet: &SheetId,
        col_start: u32,
        col_end: u32,
        changes: &[(&CellValue, &CellValue)],
    ) -> bool {
        let mut entry = match self.count_frequency_cache.get_mut(&key) {
            Some(e) => e,
            None => return false,
        };

        // Apply each change incrementally.
        for &(old_val, new_val) in changes {
            entry.value.update(old_val, new_val);
        }

        // Update the version to mark as fresh.
        entry.range_version = RangeVersion::capture(source, sheet, col_start, col_end);
        true
    }

    /// Try to incrementally update a stale sum frequency cache entry.
    ///
    /// `changes`: list of (old_criteria, new_criteria, old_sum, new_sum) tuples
    /// representing cell changes in the criteria and sum columns.
    ///
    /// Returns `true` if updated in place, `false` if entry doesn't exist.
    #[cfg(feature = "native")]
    pub(crate) fn try_incremental_sum_frequency_update(
        &self,
        key: FrequencySumKey,
        source: &dyn DataSource,
        sheet: &SheetId,
        col_start: u32,
        col_end: u32,
        changes: &[(&CellValue, &CellValue, &CellValue, &CellValue)],
    ) -> bool {
        let mut entry = match self.sum_frequency_cache.get_mut(&key) {
            Some(e) => e,
            None => return false,
        };

        // Apply each change incrementally.
        for &(old_crit, new_crit, old_sum, new_sum) in changes {
            entry.value.update(old_crit, new_crit, old_sum, new_sum);
        }

        // Update the version to mark as fresh.
        entry.range_version = RangeVersion::capture(source, sheet, col_start, col_end);
        true
    }

    /// Try to incrementally update a stale bitmask cache entry.
    ///
    /// `row_changes`: list of (row_index, new_cell_value) pairs for changed rows.
    /// `criteria`: the criterion value associated with this bitmask entry.
    ///
    /// Returns `true` if updated in place, `false` if entry doesn't exist.
    #[cfg(feature = "native")]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn try_incremental_bitmask_update(
        &self,
        key: BitmaskCacheKey,
        source: &dyn DataSource,
        sheet: &SheetId,
        col_start: u32,
        col_end: u32,
        criteria: &CellValue,
        row_changes: &[(usize, &CellValue)],
    ) -> bool {
        let mut entry = match self.bitmask_cache.get_mut(&key) {
            Some(e) => e,
            None => return false,
        };

        // Verify criteria matches (hash collision guard).
        if entry.value.criteria != *criteria {
            return false;
        }

        // Apply each row change incrementally.
        for &(row, new_value) in row_changes {
            update_bitmask_row(&mut entry.value.bitmask, row, new_value, criteria);
        }

        // Update the version to mark as fresh.
        entry.range_version = RangeVersion::capture(source, sheet, col_start, col_end);
        true
    }

    // === Memory estimation ===

    /// Estimate total memory usage across all cache tiers (bytes).
    ///
    /// These are order-of-magnitude estimates based on entry counts and
    /// typical entry sizes. Not exact — useful for observability dashboards.
    #[cfg(feature = "native")]
    pub fn estimated_memory_bytes(&self) -> usize {
        let mut total = 0usize;

        // Sorted cache: key (SheetId + 3*u32 = ~28B) + VersionedEntry overhead (~64B)
        //   + Arc<Vec<f64>> (~24B + avg 500 f64s * 8B = ~4KB)
        let sorted_count = self.sorted_cache.len();
        total += sorted_count * (28 + 64 + 24 + 4000);

        // Count frequency cache: key (~28B) + VersionedEntry (~64B)
        //   + FxHashMap<OrderedFloat<f64>, u32> (~avg 256 entries * 12B = ~3KB)
        let count_freq_count = self.count_frequency_cache.len();
        total += count_freq_count * (28 + 64 + 3072);

        // Sum frequency cache: key (~56B, two sub-keys) + VersionedEntry (~64B)
        //   + FxHashMap<OrderedFloat<f64>, f64> (~avg 256 entries * 16B = ~4KB)
        let sum_freq_count = self.sum_frequency_cache.len();
        total += sum_freq_count * (56 + 64 + 4096);

        total += *self
            .bitmask_bytes
            .lock()
            .expect("bitmask admission lock poisoned");

        // Lookup cache: not directly accessible (no len() method on LookupIndexCache).
        // Memory estimation for lookup indexes deferred to when LookupIndexCache
        // exposes entry count/size.

        total
    }

    // === Stats snapshot ===

    /// Read all atomic counters into a plain (non-atomic) snapshot struct.
    ///
    /// Safe to call concurrently — each counter is read with `Relaxed` ordering.
    /// The snapshot is a best-effort point-in-time view (individual counters may
    /// be read at slightly different moments under concurrent access).
    #[cfg(feature = "native")]
    pub fn stats_snapshot(&self) -> WorkbookCacheStatsSnapshot {
        let sorted_entries = self.sorted_cache.len();
        let count_freq_entries = self.count_frequency_cache.len();
        let sum_freq_entries = self.sum_frequency_cache.len();
        let bitmask_entries = self.bitmask_cache.len();

        // Per-tier memory estimates (same formula as estimated_memory_bytes)
        let sorted_mem = sorted_entries * (28 + 64 + 24 + 4000);
        let count_freq_mem = count_freq_entries * (28 + 64 + 3072);
        let sum_freq_mem = sum_freq_entries * (56 + 64 + 4096);
        let bitmask_mem = *self
            .bitmask_bytes
            .lock()
            .expect("bitmask admission lock poisoned");

        WorkbookCacheStatsSnapshot {
            sorted: self.stats.sorted.snapshot(),
            frequency_count: self.stats.frequency_count.snapshot(),
            frequency_sum: self.stats.frequency_sum.snapshot(),
            bitmask: self.stats.bitmask.snapshot(),
            lookup: self.stats.lookup.snapshot(),
            estimated_memory_bytes: sorted_mem + count_freq_mem + sum_freq_mem + bitmask_mem,
            sorted_entries,
            sorted_memory_bytes: sorted_mem,
            frequency_count_entries: count_freq_entries,
            frequency_count_memory_bytes: count_freq_mem,
            frequency_sum_entries: sum_freq_entries,
            frequency_sum_memory_bytes: sum_freq_mem,
            bitmask_entries,
            bitmask_memory_bytes: bitmask_mem,
            lookup_entries: 0, // LookupIndexCache doesn't expose len() yet
            lookup_memory_bytes: 0,
        }
    }
}

impl Default for WorkbookCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(all(test, feature = "native"))]
#[path = "workbook_cache_tests.rs"]
mod tests;
