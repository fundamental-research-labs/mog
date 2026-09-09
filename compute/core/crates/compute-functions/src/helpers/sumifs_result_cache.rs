//! SUMIFS result lookup table cache for multi-criteria aggregation.
//!
//! When thousands of SUMIFS formulas share the same sum range and criteria ranges
//! (varying only in criteria values), we can pre-compute ALL results in a single
//! O(rows × criteria_count) pass and serve each formula with O(1) lookup.
//!
//! ## Cache key
//!
//! The scheduler/eval layer derives a stable [`SumifsCacheKey`] from the
//! workbook range identity and the current recalc epoch. The key deliberately
//! avoids borrowed slice pointers so rayon worker thread-local caches cannot
//! hit stale data after a later recalc reuses the same allocation address.
//!
//! ## Lifetime
//!
//! Thread-local, cleared explicitly at recalc boundaries via `clear()`. Cache
//! entries are still epoch-scoped by key so a missed clear cannot produce a
//! cross-recalc hit.

use std::cell::RefCell;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use super::conditional_aggregate::ValueSlice;
use rustc_hash::FxHashMap;
use value_types::{CellError, CellValue, KahanSum};

use super::frequency_cache::NormalizedKey;

// ---------------------------------------------------------------------------
// SumifsResultMap
// ---------------------------------------------------------------------------

/// Pre-computed SUMIFS results: criteria combo → accumulated sum.
///
/// Built in a single O(rows × criteria_count) pass over the data.
/// Each unique combination of criteria values across the criteria columns
/// maps to a Kahan-accumulated sum (or a poisoning error).
#[derive(Clone)]
pub struct SumifsResultMap {
    results: ResultEntries,
}

#[derive(Clone)]
enum ResultEntries {
    Normalized(FxHashMap<Vec<NormalizedKey>, SumEntry>),
    // Exact comparable numbers in ascending order. Each entry accumulates its
    // matching rows in source order; no source CellValue is retained.
    Numeric(Vec<(f64, SumEntry)>),
}

/// Sum entry: accumulated Kahan sum or a poisoning error.
#[derive(Clone)]
enum SumEntry {
    Sum(KahanSum),
    Error(CellError),
}

impl SumEntry {
    fn add(&mut self, value: Option<&CellValue>) {
        if let Self::Sum(acc) = self {
            match value {
                Some(CellValue::Number(number)) => acc.add(number.get()),
                Some(CellValue::Error(error, _)) => *self = Self::Error(*error),
                _ => {}
            }
        }
    }

    fn result(&self) -> Result<f64, CellError> {
        match self {
            Self::Sum(acc) => Ok(acc.total()),
            Self::Error(error) => Err(*error),
        }
    }
}

impl SumifsResultMap {
    /// Build a result map from criteria column slices and a sum column slice.
    ///
    /// Iterates all rows once, normalizing each row's criteria values into a
    /// composite key and accumulating the corresponding sum value.
    pub fn build<CR: ValueSlice, SR: ValueSlice + ?Sized>(
        criteria_slices: &[CR],
        sum_slice: &SR,
        total_rows: usize,
    ) -> Self {
        Self::build_with_mode(criteria_slices, sum_slice, total_rows, false)
    }

    fn build_with_mode<CR: ValueSlice, SR: ValueSlice + ?Sized>(
        criteria_slices: &[CR],
        sum_slice: &SR,
        total_rows: usize,
        text_criteria: bool,
    ) -> Self {
        let ncrit = criteria_slices.len();
        let mut results: FxHashMap<Vec<NormalizedKey>, SumEntry> = FxHashMap::default();

        'rows: for row in 0..total_rows {
            // Build the composite key for this row
            let mut key = Vec::with_capacity(ncrit);
            for crit_slice in criteria_slices {
                let val = crit_slice.get_value(row).unwrap_or(&CellValue::Null);
                let normalized = if text_criteria {
                    let Ok(text) = val.coerce_to_string() else {
                        continue 'rows;
                    };
                    NormalizedKey::Text(text.to_ascii_lowercase())
                } else {
                    NormalizedKey::from_cell_value(val)
                };
                key.push(normalized);
            }

            // Accumulate the sum value
            let entry = results
                .entry(key)
                .or_insert_with(|| SumEntry::Sum(KahanSum::new()));

            entry.add(sum_slice.get_value(row));
        }

        SumifsResultMap {
            results: ResultEntries::Normalized(results),
        }
    }

    fn build_numeric<CR: ValueSlice, SR: ValueSlice + ?Sized>(
        criteria_slice: &CR,
        sum_slice: &SR,
        total_rows: usize,
    ) -> Self {
        let mut groups: FxHashMap<u64, SumEntry> = FxHashMap::default();
        for row in 0..total_rows {
            let Some(number) = criteria_slice
                .get_value(row)
                .and_then(CellValue::as_comparable_number)
            else {
                continue;
            };
            // The predicate treats both signs of zero alike. All comparable
            // numbers are finite, so every other value has one exact bit key.
            let bits = if number == 0.0 { 0 } else { number.to_bits() };
            let entry = groups
                .entry(bits)
                .or_insert_with(|| SumEntry::Sum(KahanSum::new()));
            entry.add(sum_slice.get_value(row));
        }
        let mut groups: Vec<_> = groups
            .into_iter()
            .map(|(bits, entry)| (f64::from_bits(bits), entry))
            .collect();
        groups.sort_unstable_by(|left, right| left.0.total_cmp(&right.0));
        Self {
            results: ResultEntries::Numeric(groups),
        }
    }

    fn lookup_numeric(&self, criterion: f64) -> Option<Result<f64, CellError>> {
        let ResultEntries::Numeric(groups) = &self.results else {
            return None;
        };
        let matches = |index: usize| {
            groups
                .get(index)
                .is_some_and(|(number, _)| (number - criterion).abs() < 1e-10)
        };
        let insertion = groups.partition_point(|(number, _)| *number < criterion);
        let candidate = if matches(insertion) {
            insertion
        } else if insertion > 0 && matches(insertion - 1) {
            insertion - 1
        } else {
            return Some(Ok(0.0));
        };
        // Combining distinct groups would change Kahan accumulation and error
        // order. Preserve the original scan whenever tolerance spans groups.
        if (candidate > 0 && matches(candidate - 1)) || matches(candidate + 1) {
            return None;
        }
        Some(groups[candidate].1.result())
    }

    /// Look up the sum for a given combination of criteria values.
    ///
    /// Returns `Ok(sum)` on success, `Err(CellError)` if poisoned,
    /// or `Ok(0.0)` if no rows matched.
    #[inline]
    pub fn lookup(&self, criteria_keys: &[NormalizedKey]) -> Result<f64, CellError> {
        let ResultEntries::Normalized(results) = &self.results else {
            unreachable!("numeric SUMIF maps require tolerance-aware lookup");
        };
        match results.get(criteria_keys) {
            Some(entry) => entry.result(),
            None => Ok(0.0),
        }
    }
}

// ---------------------------------------------------------------------------
// Thread-local cache
// ---------------------------------------------------------------------------

/// Stable cache domain assigned by the scheduler to one compute engine/cache
/// owner. Domains are process-unique and never reused while rayon worker TLS
/// may retain SUMIFS cache entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SumifsCacheDomain(u64);

/// Recalc epoch for SUMIFS cache entries.
///
/// The `(domain, generation)` pair is included in every cache key and every
/// warm-data payload. `generation` comes from a process-global monotonic
/// counter, so it never resets while rayon worker TLS may retain old entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SumifsCacheEpoch {
    domain: SumifsCacheDomain,
    generation: u64,
}

/// Role of one range within a SUMIFS cache key.
///
/// The sum/value range and ordered criteria ranges are intentionally distinct
/// parts of the key. This prevents a criteria range from aliasing with the sum
/// range or with the same physical range used in a different criteria slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SumifsRangeRole {
    Sum,
    Criteria { order: u32 },
}

/// Stable identity for one single-column SUMIFS range.
///
/// `end_row_exclusive` is the requested range boundary after sentinel/cell-range
/// normalization. `effective_len` is the actual borrowed slice length after
/// clipping missing or short columns. `build_row_count` lives on
/// [`SumifsCacheKey`] because it is shared by all ranges in the map build.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SumifsRangeIdentity {
    role: SumifsRangeRole,
    sheet_id: u128,
    column: u32,
    start_row: u32,
    end_row_exclusive: u32,
    effective_len: usize,
}

impl SumifsRangeIdentity {
    pub fn sum_range(
        sheet_id: u128,
        column: u32,
        start_row: u32,
        end_row_exclusive: u32,
        effective_len: usize,
    ) -> Self {
        Self {
            role: SumifsRangeRole::Sum,
            sheet_id,
            column,
            start_row,
            end_row_exclusive,
            effective_len,
        }
    }

    pub fn criteria_range(
        order: u32,
        sheet_id: u128,
        column: u32,
        start_row: u32,
        end_row_exclusive: u32,
        effective_len: usize,
    ) -> Self {
        Self {
            role: SumifsRangeRole::Criteria { order },
            sheet_id,
            column,
            start_row,
            end_row_exclusive,
            effective_len,
        }
    }
}

/// Stable key for a cached SUMIFS result map.
///
/// Public constructors keep the key tied to an explicit recalc epoch and make
/// role/order part of the type-level shape used by scheduler-owned evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SumifsCacheKey {
    epoch: SumifsCacheEpoch,
    build_row_count: usize,
    sum_range: SumifsRangeIdentity,
    criteria_ranges: Vec<SumifsRangeIdentity>,
    criteria_mode: CriteriaMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum CriteriaMode {
    Normalized,
    Text {
        criteria_version: u64,
        sum_version: u64,
    },
    Numeric {
        criteria_version: u64,
        sum_version: u64,
    },
}

impl SumifsCacheKey {
    pub fn new(
        epoch: SumifsCacheEpoch,
        build_row_count: usize,
        sum_range: SumifsRangeIdentity,
        criteria_ranges: Vec<SumifsRangeIdentity>,
    ) -> Self {
        debug_assert!(matches!(sum_range.role, SumifsRangeRole::Sum));
        debug_assert!(
            criteria_ranges
                .iter()
                .enumerate()
                .all(|(idx, range)| matches!(
                    range.role,
                    SumifsRangeRole::Criteria { order } if order as usize == idx
                ))
        );
        Self {
            epoch,
            build_row_count,
            sum_range,
            criteria_ranges,
            criteria_mode: CriteriaMode::Normalized,
        }
    }

    /// Match plain text via string coercion and ASCII case folding, preserving
    /// SUMIF predicate semantics and separating these maps from normalized keys.
    /// Column versions also prevent reuse after a dependent formula changes
    /// a source column within the same recalculation epoch.
    pub fn with_text_criteria(mut self, criteria_version: u64, sum_version: u64) -> Self {
        self.criteria_mode = CriteriaMode::Text {
            criteria_version,
            sum_version,
        };
        self
    }

    /// Match numeric criteria with the SUMIF predicate's exact comparison
    /// conversion and tolerance. Source versions isolate edits within an epoch.
    pub fn with_numeric_criteria(mut self, criteria_version: u64, sum_version: u64) -> Self {
        self.criteria_mode = CriteriaMode::Numeric {
            criteria_version,
            sum_version,
        };
        self
    }

    pub fn epoch(&self) -> SumifsCacheEpoch {
        self.epoch
    }
}

type CacheKey = SumifsCacheKey;

struct CacheEntry {
    map: Arc<SumifsResultMap>,
}

thread_local! {
    static SUMIFS_CACHE: RefCell<FxHashMap<CacheKey, CacheEntry>> =
        RefCell::new(FxHashMap::default());
}

static NEXT_CACHE_DOMAIN: AtomicU64 = AtomicU64::new(1);
static NEXT_CACHE_GENERATION: AtomicU64 = AtomicU64::new(1);
static CACHE_HITS: AtomicU64 = AtomicU64::new(0);
static CACHE_MISSES: AtomicU64 = AtomicU64::new(0);
static CACHE_BUILDS: AtomicU64 = AtomicU64::new(0);
static CACHE_SEEDS: AtomicU64 = AtomicU64::new(0);
static CACHE_EPOCH_MISSES: AtomicU64 = AtomicU64::new(0);

/// Low-overhead counters for production-path SUMIFS cache verification.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SumifsCacheDiagnostics {
    pub hits: u64,
    pub misses: u64,
    pub builds: u64,
    pub seeds: u64,
    pub epoch_misses: u64,
}

/// Allocate a process-unique SUMIFS cache domain for a scheduler/cache owner.
pub fn new_cache_domain() -> SumifsCacheDomain {
    SumifsCacheDomain(NEXT_CACHE_DOMAIN.fetch_add(1, Ordering::Relaxed))
}

/// Allocate a fresh recalc epoch for `domain`.
///
/// This function is part of the scheduler-owned recalc SPI. Callers should
/// create a new epoch before a recalc/evaluation boundary whose worker TLS may
/// still contain entries from earlier evaluations.
pub fn begin_recalc_epoch(domain: SumifsCacheDomain) -> SumifsCacheEpoch {
    SumifsCacheEpoch {
        domain,
        generation: NEXT_CACHE_GENERATION.fetch_add(1, Ordering::Relaxed),
    }
}

/// Clear the SUMIFS result cache. Must be called at recalc entry.
pub fn clear() {
    SUMIFS_CACHE.with(|c| c.borrow_mut().clear());
}

/// Reset diagnostic counters. Intended for deterministic tests.
pub fn reset_diagnostics() {
    CACHE_HITS.store(0, Ordering::Relaxed);
    CACHE_MISSES.store(0, Ordering::Relaxed);
    CACHE_BUILDS.store(0, Ordering::Relaxed);
    CACHE_SEEDS.store(0, Ordering::Relaxed);
    CACHE_EPOCH_MISSES.store(0, Ordering::Relaxed);
}

/// Snapshot current diagnostic counters.
pub fn diagnostics() -> SumifsCacheDiagnostics {
    SumifsCacheDiagnostics {
        hits: CACHE_HITS.load(Ordering::Relaxed),
        misses: CACHE_MISSES.load(Ordering::Relaxed),
        builds: CACHE_BUILDS.load(Ordering::Relaxed),
        seeds: CACHE_SEEDS.load(Ordering::Relaxed),
        epoch_misses: CACHE_EPOCH_MISSES.load(Ordering::Relaxed),
    }
}

// ---------------------------------------------------------------------------
// Cross-thread cache sharing (Option A: extract + seed)
// ---------------------------------------------------------------------------

/// Snapshot of warmed cache entries that can be sent to worker threads.
///
/// Wraps the pre-built `SumifsResultMap` entries from the main thread
/// in a `Send + Sync` container so they can be seeded into rayon worker
/// thread-local caches before parallel evaluation begins.
pub struct SumifsWarmData {
    epoch: SumifsCacheEpoch,
    entries: Vec<(SumifsCacheKey, Arc<SumifsResultMap>)>,
}

impl SumifsWarmData {
    /// Returns true if there are no warmed entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Epoch carried by this scheduler-owned warm-data payload.
    pub fn epoch(&self) -> SumifsCacheEpoch {
        self.epoch
    }
}

/// Extract all warmed entries from the current thread's SUMIFS cache.
///
/// After `warm_sumifs_result_cache()` completes on the main thread, call this
/// to extract the pre-built `SumifsResultMap` entries for `epoch` into a
/// `Send`-safe container. The thread-local cache entries for the epoch are
/// drained (entries are moved, not cloned). Entries from older epochs are left
/// behind but cannot be hit by the new epoch-scoped key.
///
/// Returns `None` if the cache is empty (nothing was warmed).
///
/// This is scheduler-owned recalc SPI: callers must pass the same epoch used
/// to build warm cache entries for the current recalc evaluation.
pub fn extract_warm_data(epoch: SumifsCacheEpoch) -> Option<SumifsWarmData> {
    SUMIFS_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.is_empty() {
            return None;
        }
        let mut entries = Vec::new();
        cache.retain(|key, entry| {
            if key.epoch == epoch {
                entries.push((key.clone(), Arc::clone(&entry.map)));
                false
            } else {
                true
            }
        });
        if entries.is_empty() {
            None
        } else {
            Some(SumifsWarmData { epoch, entries })
        }
    })
}

/// Seed the current thread's SUMIFS cache with pre-warmed entries.
///
/// Called at the start of each rayon worker thread's eval closure to populate
/// the thread-local cache with maps built during the agg prepass. Subsequent
/// `sumifs_lookup()` calls with matching stable range keys get O(1) hits.
///
/// Warm data is seeded only when its epoch matches the caller's current recalc
/// epoch. A mismatched epoch is counted and ignored, so accidentally persisted
/// warm data cannot seed a stale worker TLS cache.
///
/// This is scheduler-owned recalc SPI.
pub fn seed_warm_data(epoch: SumifsCacheEpoch, warm: &SumifsWarmData) {
    if warm.epoch != epoch {
        CACHE_EPOCH_MISSES.fetch_add(1, Ordering::Relaxed);
        return;
    }
    SUMIFS_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        for (key, map) in &warm.entries {
            cache.insert(
                key.clone(),
                CacheEntry {
                    map: Arc::clone(map),
                },
            );
            CACHE_SEEDS.fetch_add(1, Ordering::Relaxed);
        }
    });
}

/// Look up a pre-computed SUMIFS result, building the result map on first call.
///
/// `criteria_slices`: borrowed column slices for each criteria range.
/// `sum_slice`: borrowed column slice for the sum range.
/// `total_rows`: number of rows to scan.
/// `criteria_keys`: normalized keys for the current formula's criteria values.
///
/// Returns `Ok(sum)` on success, `Err(CellError)` if poisoned.
pub fn sumifs_lookup<CR: ValueSlice, SR: ValueSlice + ?Sized>(
    cache_key: &SumifsCacheKey,
    criteria_slices: &[CR],
    sum_slice: &SR,
    total_rows: usize,
    criteria_keys: &[NormalizedKey],
) -> Result<f64, CellError> {
    with_cached_map(
        cache_key,
        || {
            SumifsResultMap::build_with_mode(
                criteria_slices,
                sum_slice,
                total_rows,
                matches!(cache_key.criteria_mode, CriteriaMode::Text { .. }),
            )
        },
        |map| map.lookup(criteria_keys),
    )
}

/// Look up a numeric single-criteria SUMIF, grouping exact comparable numbers
/// on the first call and using a binary search on subsequent calls.
///
/// Returns `None` when more than one distinct numeric group matches the
/// predicate's tolerance, so the caller can preserve source-order accumulation
/// and error propagation with its ordinary scan. A missing match is `Some(Ok(0))`.
/// The key must use [`SumifsCacheKey::with_numeric_criteria`].
pub fn sumif_numeric_lookup<CR: ValueSlice, SR: ValueSlice + ?Sized>(
    cache_key: &SumifsCacheKey,
    criteria_slices: &[CR],
    sum_slice: &SR,
    total_rows: usize,
    criterion: f64,
) -> Option<Result<f64, CellError>> {
    if !matches!(cache_key.criteria_mode, CriteriaMode::Numeric { .. })
        || criteria_slices.len() != 1
        || !criterion.is_finite()
    {
        return None;
    }
    with_cached_map(
        cache_key,
        || SumifsResultMap::build_numeric(&criteria_slices[0], sum_slice, total_rows),
        |map| map.lookup_numeric(criterion),
    )
}

fn with_cached_map<R>(
    cache_key: &SumifsCacheKey,
    build: impl FnOnce() -> SumifsResultMap,
    lookup: impl FnOnce(&SumifsResultMap) -> R,
) -> R {
    SUMIFS_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if let Some(entry) = cache.get(cache_key) {
            CACHE_HITS.fetch_add(1, Ordering::Relaxed);
            return lookup(&entry.map);
        }
        CACHE_MISSES.fetch_add(1, Ordering::Relaxed);
        let map = Arc::new(build());
        let result = lookup(&map);
        cache.insert(cache_key.clone(), CacheEntry { map });
        CACHE_BUILDS.fetch_add(1, Ordering::Relaxed);
        result
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    fn cache_test_guard() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }
    fn test_epoch() -> SumifsCacheEpoch {
        begin_recalc_epoch(new_cache_domain())
    }
    fn cache_key(
        epoch: SumifsCacheEpoch,
        total_rows: usize,
        sum_range: (u128, u32, u32, u32, usize),
        criteria_ranges: &[(u128, u32, u32, u32, usize)],
    ) -> SumifsCacheKey {
        let sum = SumifsRangeIdentity::sum_range(
            sum_range.0,
            sum_range.1,
            sum_range.2,
            sum_range.3,
            sum_range.4,
        );
        let criteria = criteria_ranges
            .iter()
            .enumerate()
            .map(|(order, &(sheet, col, start, end, len))| {
                SumifsRangeIdentity::criteria_range(order as u32, sheet, col, start, end, len)
            })
            .collect();
        SumifsCacheKey::new(epoch, total_rows, sum, criteria)
    }

    #[test]
    fn text_criteria_cache_matches_predicate_and_never_rescans_hits() {
        use super::super::conditional_aggregate::{AggregateOp, scan_single_criteria};
        use super::super::criteria::{parse_criteria, plain_text_criteria};
        use std::cell::Cell;

        struct Counted<'a> {
            values: &'a [CellValue],
            reads: Cell<usize>,
        }
        impl ValueSlice for Counted<'_> {
            fn get_value(&self, row: usize) -> Option<&CellValue> {
                self.reads.set(self.reads.get() + 1);
                self.values.get(row)
            }
            fn len(&self) -> usize {
                self.values.len()
            }
        }

        let _guard = cache_test_guard();
        clear();
        let categories = [
            text("Alpha"),
            text("ALPHA"),
            text("Key"),
            text("key"),
            text("É"),
            text("é"),
            CellValue::Null,
            text(""),
            CellValue::Boolean(true),
            text("TRUE"),
            text("bad"),
            text("bad"),
        ];
        let sums = [
            num(1.0),
            num(2.0),
            num(4.0),
            num(8.0),
            num(16.0),
            num(32.0),
            num(64.0),
            num(128.0),
            num(256.0),
            num(512.0),
            CellValue::Error(CellError::Div0, None),
            num(1024.0),
        ];
        let counted = Counted {
            values: &categories,
            reads: Cell::new(0),
        };
        let plain_key = cache_key(
            test_epoch(),
            categories.len(),
            (1, 1, 0, 12, 12),
            &[(1, 0, 0, 12, 12)],
        )
        .with_text_criteria(0, 0);

        for needle in [
            "alpha", "key", "Key", "É", "é", "", "true", "missing", "bad",
        ] {
            let criterion = text(needle);
            assert_eq!(plain_text_criteria(&criterion), Some(needle));
            let expected = scan_single_criteria(
                &categories,
                &*parse_criteria(&criterion),
                Some(&sums),
                categories.len(),
                AggregateOp::Sum,
            );
            let result = sumifs_lookup(
                &plain_key,
                &[&counted],
                &sums,
                categories.len(),
                &[NormalizedKey::Text(needle.to_ascii_lowercase())],
            );
            let actual = match result {
                Ok(sum) => num(sum),
                Err(error) => CellValue::Error(error, None),
            };
            assert_eq!(actual, expected, "criterion {needle:?}");
            assert_eq!(
                counted.reads.get(),
                categories.len(),
                "cache hit rescanned its column"
            );
        }
        for needle in ["1", "10%", ">0", "=Alpha", "Al*", "Al?", "Al~*"] {
            assert!(plain_text_criteria(&text(needle)).is_none(), "{needle}");
        }
        let normalized_key = cache_key(
            plain_key.epoch(),
            categories.len(),
            (1, 1, 0, 12, 12),
            &[(1, 0, 0, 12, 12)],
        );
        assert_ne!(
            plain_key, normalized_key,
            "normalization belongs in cache identity"
        );
        let changed_key = normalized_key.with_text_criteria(0, 1);
        let changed_sums = [num(10.0), num(20.0)];
        assert_eq!(
            sumifs_lookup(
                &changed_key,
                &[&counted],
                &changed_sums,
                categories.len(),
                &[NormalizedKey::Text("alpha".into())]
            ),
            Ok(30.0)
        );
        assert_eq!(
            counted.reads.get(),
            categories.len() * 2,
            "column version changes must rebuild within the same epoch"
        );
    }

    fn numeric_scan(criteria: &[CellValue], sums: &[CellValue], needle: f64) -> CellValue {
        use super::super::conditional_aggregate::{AggregateOp, scan_single_criteria};
        use super::super::criteria::parse_criteria;
        scan_single_criteria(
            criteria,
            &*parse_criteria(&num(needle)),
            Some(sums),
            criteria.len(),
            AggregateOp::Sum,
        )
    }

    fn numeric_result(result: Result<f64, CellError>) -> CellValue {
        match result {
            Ok(sum) => num(sum),
            Err(error) => CellValue::Error(error, None),
        }
    }

    #[test]
    fn numeric_criteria_cache_matches_predicate_and_never_rescans_hits() {
        use std::cell::Cell;

        struct Counted<'a> {
            values: &'a [CellValue],
            reads: Cell<usize>,
        }
        impl ValueSlice for Counted<'_> {
            fn get_value(&self, row: usize) -> Option<&CellValue> {
                self.reads.set(self.reads.get() + 1);
                self.values.get(row)
            }
            fn len(&self) -> usize {
                self.values.len()
            }
        }

        let _guard = cache_test_guard();
        clear();
        let categories = [
            text("header"),
            num(1.0),
            text("1"),
            text(" 1.0 "),
            num(0.0),
            num(-0.0),
            text("-0"),
            CellValue::Boolean(true),
            CellValue::Null,
            CellValue::Error(CellError::Value, None),
            num(2.0),
            num(2.0),
            num(2.0),
            text("2024-01-01"),
            text("1e3"),
            num(f64::MAX),
            num(-f64::MAX),
        ];
        let sums = [
            num(99.0),
            num(1e16),
            num(1.0),
            num(-1e16),
            num(1.0),
            num(2.0),
            num(4.0),
            CellValue::Error(CellError::Num, None),
            CellValue::Error(CellError::Num, None),
            CellValue::Error(CellError::Num, None),
            num(10.0),
            CellValue::Error(CellError::Div0, None),
            CellValue::Error(CellError::Value, None),
            num(20.0),
            text("ignored"),
            num(30.0),
            CellValue::Boolean(true),
        ];
        let criteria = Counted {
            values: &categories,
            reads: Cell::new(0),
        };
        let values = Counted {
            values: &sums,
            reads: Cell::new(0),
        };
        let key = cache_key(
            test_epoch(),
            categories.len(),
            (1, 1, 0, 17, 17),
            &[(1, 0, 0, 17, 17)],
        )
        .with_numeric_criteria(0, 0);
        let date = categories[13].as_comparable_number().unwrap();
        let mut sum_reads = None;
        for needle in [
            1.0,
            0.0,
            -0.0,
            2.0,
            date,
            1000.0,
            999.0,
            f64::MAX,
            -f64::MAX,
        ] {
            let expected = numeric_scan(&categories, &sums, needle);
            let actual =
                sumif_numeric_lookup(&key, &[&criteria], &values, categories.len(), needle)
                    .expect("distinct numeric keys permit cached lookup");
            assert_eq!(numeric_result(actual), expected, "criterion {needle}");
            assert_eq!(
                criteria.reads.get(),
                categories.len(),
                "hit rescanned criteria"
            );
            assert_eq!(
                *sum_reads.get_or_insert(values.reads.get()),
                values.reads.get(),
                "hit rescanned sums"
            );
        }
    }

    #[test]
    fn numeric_criteria_cache_preserves_tolerance_boundaries_and_ambiguous_scan_order() {
        let categories = [num(0.0)];
        let sums = [num(7.0)];
        let map = SumifsResultMap::build_numeric(&&categories, &sums, 1);
        let tolerance = 1e-10_f64;
        for needle in [
            0.0,
            -0.0,
            f64::from_bits(1),
            tolerance,
            -tolerance,
            f64::from_bits(tolerance.to_bits() - 1),
            f64::from_bits(tolerance.to_bits() + 1),
        ] {
            assert_eq!(
                numeric_result(map.lookup_numeric(needle).unwrap()),
                numeric_scan(&categories, &sums, needle)
            );
        }

        // Interleaved exact groups cannot be combined without changing the
        // source accumulation order or which error is returned first.
        let categories = [num(0.0), num(0.5e-10), num(0.0), num(0.5e-10)];
        let sums = [num(1e16), num(1.0), num(-1e16), num(1.0)];
        let map = SumifsResultMap::build_numeric(&&categories, &sums, 4);
        for needle in [0.0, 0.25e-10, 0.5e-10] {
            assert_eq!(map.lookup_numeric(needle), None);
        }
        let errors = [
            CellValue::Error(CellError::Div0, None),
            CellValue::Error(CellError::Value, None),
            num(1.0),
            num(2.0),
        ];
        let map = SumifsResultMap::build_numeric(&&categories, &errors, 4);
        assert_eq!(map.lookup_numeric(0.25e-10), None);
        assert_eq!(
            numeric_scan(&categories, &errors, 0.25e-10),
            CellValue::Error(CellError::Div0, None)
        );

        // Search both sides of the insertion point; a lone group may match
        // from either side even when the criterion is not an exact group key.
        for needle in [-0.9e-10, 1.4e-10, 2e-10] {
            assert_eq!(
                numeric_result(map.lookup_numeric(needle).unwrap()),
                numeric_scan(&categories, &errors, needle)
            );
        }
    }

    #[test]
    fn numeric_criteria_cache_helper_preserves_text_operator_and_percent_boundaries() {
        use super::super::conditional_aggregate::{AggregateOp, scan_single_criteria};
        use super::super::criteria::{numeric_equality_criteria, parse_criteria};
        let categories = [
            num(1.0),
            text("1"),
            text(" 1 "),
            num(0.1),
            text("0.1"),
            text("10%"),
            num(1000.0),
        ];
        let sums = [
            num(1.0),
            num(2.0),
            num(4.0),
            num(8.0),
            num(16.0),
            num(32.0),
            num(64.0),
        ];
        let map = SumifsResultMap::build_numeric(&&categories, &sums, categories.len());
        for criterion in [
            num(1.0),
            text("1"),
            text("=1"),
            text(" = 1 "),
            text("10%"),
            text("=10%"),
            text("1e3"),
            CellValue::Array(Arc::new(value_types::CellArray::new(vec![num(1.0)], 1))),
        ] {
            let needle = numeric_equality_criteria(&criterion).expect("numeric equality criterion");
            let expected = scan_single_criteria(
                &categories,
                &*parse_criteria(&criterion),
                Some(&sums),
                categories.len(),
                AggregateOp::Sum,
            );
            assert_eq!(
                numeric_result(map.lookup_numeric(needle).unwrap()),
                expected,
                "criterion {criterion:?}"
            );
        }
        for criterion in [
            text(" 1 "),
            text(" 10% "),
            text(">1"),
            text(">=1"),
            text("<>1"),
            text("<1"),
            text("1*"),
            text("=name"),
            CellValue::Boolean(true),
            CellValue::Null,
        ] {
            assert_eq!(
                numeric_equality_criteria(&criterion),
                None,
                "criterion {criterion:?}"
            );
        }
    }

    #[test]
    fn numeric_criteria_cache_isolates_modes_versions_and_warm_epochs() {
        let _guard = cache_test_guard();
        clear();
        let epoch = test_epoch();
        let base = cache_key(epoch, 2, (1, 1, 0, 2, 2), &[(1, 0, 0, 2, 2)]);
        let numeric = base.clone().with_numeric_criteria(0, 0);
        let text_key = base.clone().with_text_criteria(0, 0);
        let criteria = [num(1.0), num(2.0)];
        let sums = [num(10.0), num(20.0)];
        assert_ne!(numeric, base);
        assert_ne!(numeric, text_key);
        assert_eq!(
            sumifs_lookup(
                &base,
                &[&criteria],
                &sums,
                2,
                &[NormalizedKey::from_cell_value(&num(1.0))]
            ),
            Ok(10.0)
        );
        assert_eq!(
            sumifs_lookup(
                &text_key,
                &[&criteria],
                &sums,
                2,
                &[NormalizedKey::Text("1".into())]
            ),
            Ok(10.0)
        );
        assert_eq!(
            sumif_numeric_lookup(&numeric, &[&criteria], &sums, 2, 1.0),
            Some(Ok(10.0))
        );
        let changed_sums = [num(30.0), num(40.0)];
        assert_eq!(
            sumif_numeric_lookup(
                &base.clone().with_numeric_criteria(0, 1),
                &[&criteria],
                &changed_sums,
                2,
                1.0
            ),
            Some(Ok(30.0))
        );
        let changed_criteria = [text("header"), num(1.0)];
        assert_eq!(
            sumif_numeric_lookup(
                &base.clone().with_numeric_criteria(1, 1),
                &[&changed_criteria],
                &changed_sums,
                2,
                1.0
            ),
            Some(Ok(40.0))
        );

        let warm = extract_warm_data(epoch).unwrap();
        std::thread::spawn(move || {
            struct NoReads;
            impl ValueSlice for NoReads {
                fn get_value(&self, _: usize) -> Option<&CellValue> {
                    panic!("warm hit rescanned source")
                }
                fn len(&self) -> usize {
                    2
                }
            }
            seed_warm_data(epoch, &warm);
            assert_eq!(
                sumif_numeric_lookup(&numeric, &[NoReads], &NoReads, 2, 2.0),
                Some(Ok(20.0))
            );
        })
        .join()
        .unwrap();
    }

    #[test]
    fn test_basic_sumifs_result_map() {
        let crit1 = vec![text("a"), text("b"), text("a"), text("b"), text("a")];
        let crit2 = vec![num(1.0), num(1.0), num(2.0), num(1.0), num(1.0)];
        let sums = vec![num(10.0), num(20.0), num(30.0), num(40.0), num(50.0)];

        let map = SumifsResultMap::build(&[&crit1, &crit2], &sums, 5);

        // a,1 = 10+50 = 60
        let key_a1 = vec![
            NormalizedKey::from_cell_value(&text("a")),
            NormalizedKey::from_cell_value(&num(1.0)),
        ];
        assert_eq!(map.lookup(&key_a1).unwrap(), 60.0);

        // a,2 = 30
        let key_a2 = vec![
            NormalizedKey::from_cell_value(&text("a")),
            NormalizedKey::from_cell_value(&num(2.0)),
        ];
        assert_eq!(map.lookup(&key_a2).unwrap(), 30.0);

        // b,1 = 20+40 = 60
        let key_b1 = vec![
            NormalizedKey::from_cell_value(&text("b")),
            NormalizedKey::from_cell_value(&num(1.0)),
        ];
        assert_eq!(map.lookup(&key_b1).unwrap(), 60.0);

        // c,1 = not found = 0
        let key_c1 = vec![
            NormalizedKey::from_cell_value(&text("c")),
            NormalizedKey::from_cell_value(&num(1.0)),
        ];
        assert_eq!(map.lookup(&key_c1).unwrap(), 0.0);
    }

    #[test]
    fn test_error_poisoning() {
        let crit = vec![text("a"), text("a"), text("b")];
        let sums = vec![
            num(10.0),
            CellValue::Error(CellError::Value, None),
            num(20.0),
        ];

        let map = SumifsResultMap::build(&[&crit], &sums, 3);

        let key_a = vec![NormalizedKey::from_cell_value(&text("a"))];
        assert_eq!(map.lookup(&key_a).unwrap_err(), CellError::Value);

        let key_b = vec![NormalizedKey::from_cell_value(&text("b"))];
        assert_eq!(map.lookup(&key_b).unwrap(), 20.0);
    }

    #[test]
    fn test_non_numeric_sum_values_skipped() {
        let crit = vec![text("a"), text("a"), text("a")];
        let sums = vec![num(10.0), text("hello"), CellValue::Null];

        let map = SumifsResultMap::build(&[&crit], &sums, 3);

        let key_a = vec![NormalizedKey::from_cell_value(&text("a"))];
        assert_eq!(map.lookup(&key_a).unwrap(), 10.0);
    }

    #[test]
    fn test_kahan_accuracy() {
        let n = 10_000;
        let crit: Vec<CellValue> = vec![text("x"); n];
        let sums: Vec<CellValue> = vec![num(0.1); n];

        let map = SumifsResultMap::build(&[&crit], &sums, n);

        let key_x = vec![NormalizedKey::from_cell_value(&text("x"))];
        let result = map.lookup(&key_x).unwrap();
        assert!((result - 1000.0).abs() < 1e-10);
    }

    #[test]
    fn test_empty_data() {
        let crit: Vec<CellValue> = vec![];
        let sums: Vec<CellValue> = vec![];

        let map = SumifsResultMap::build(&[&crit], &sums, 0);

        let key = vec![NormalizedKey::from_cell_value(&text("a"))];
        assert_eq!(map.lookup(&key).unwrap(), 0.0);
    }

    #[test]
    fn test_case_insensitive_criteria() {
        let crit = vec![text("Alice"), text("alice"), text("ALICE")];
        let sums = vec![num(10.0), num(20.0), num(30.0)];

        let map = SumifsResultMap::build(&[&crit], &sums, 3);

        let key = vec![NormalizedKey::from_cell_value(&text("alice"))];
        assert_eq!(map.lookup(&key).unwrap(), 60.0);
    }

    #[test]
    fn test_cross_type_text_number() {
        let crit = vec![text("2019"), num(2019.0), num(2020.0)];
        let sums = vec![num(10.0), num(20.0), num(30.0)];

        let map = SumifsResultMap::build(&[&crit], &sums, 3);

        // Text "2019" and Number(2019) should combine
        let key = vec![NormalizedKey::from_cell_value(&num(2019.0))];
        assert_eq!(map.lookup(&key).unwrap(), 30.0);
    }

    #[test]
    fn test_thread_local_cache_lookup() {
        let _guard = cache_test_guard();
        clear();
        reset_diagnostics();
        let crit = vec![text("a"), text("b"), text("a")];
        let sums = vec![num(10.0), num(20.0), num(30.0)];
        let epoch = test_epoch();
        let cache_key = cache_key(
            epoch,
            3,
            (1, 2, 0, 3, sums.len()),
            &[(1, 0, 0, 3, crit.len())],
        );

        let key_a = vec![NormalizedKey::from_cell_value(&text("a"))];
        let key_b = vec![NormalizedKey::from_cell_value(&text("b"))];

        // First call builds the map
        let result = sumifs_lookup(&cache_key, &[&crit], &sums, 3, &key_a);
        assert_eq!(result.unwrap(), 40.0);

        // Second call should hit cache
        let result = sumifs_lookup(&cache_key, &[&crit], &sums, 3, &key_b);
        assert_eq!(result.unwrap(), 20.0);
        let diag = diagnostics();
        assert_eq!(diag.builds, 1);
        assert_eq!(diag.hits, 1);
    }

    #[test]
    fn test_clear_invalidates_cache() {
        let _guard = cache_test_guard();
        clear();
        let crit = vec![text("a"), text("a")];
        let sums = vec![num(10.0), num(20.0)];
        let epoch = test_epoch();
        let cache_key = cache_key(
            epoch,
            2,
            (1, 2, 0, 2, sums.len()),
            &[(1, 0, 0, 2, crit.len())],
        );

        let key_a = vec![NormalizedKey::from_cell_value(&text("a"))];
        assert_eq!(
            sumifs_lookup(&cache_key, &[&crit], &sums, 2, &key_a).unwrap(),
            30.0
        );

        clear();

        // After clear, cache is empty but rebuild produces same result
        assert_eq!(
            sumifs_lookup(&cache_key, &[&crit], &sums, 2, &key_a).unwrap(),
            30.0
        );
    }

    #[test]
    fn test_same_epoch_warm_extract_seed_hits() {
        let _guard = cache_test_guard();
        clear();
        reset_diagnostics();
        let crit = vec![text("a"), text("b"), text("a")];
        let sums = vec![num(10.0), num(20.0), num(30.0)];
        let epoch = test_epoch();
        let cache_key = cache_key(
            epoch,
            3,
            (1, 2, 0, 3, sums.len()),
            &[(1, 0, 0, 3, crit.len())],
        );
        let key_a = vec![NormalizedKey::from_cell_value(&text("a"))];
        let key_b = vec![NormalizedKey::from_cell_value(&text("b"))];

        assert_eq!(
            sumifs_lookup(&cache_key, &[&crit], &sums, 3, &key_a).unwrap(),
            40.0
        );
        let warm = extract_warm_data(epoch).expect("warm data should be extracted");
        assert!(!warm.is_empty());
        assert_eq!(warm.epoch(), epoch);
        assert!(extract_warm_data(epoch).is_none());

        seed_warm_data(epoch, &warm);
        assert_eq!(
            sumifs_lookup(&cache_key, &[&crit], &sums, 3, &key_b).unwrap(),
            20.0
        );
        let diag = diagnostics();
        assert_eq!(diag.builds, 1);
        assert_eq!(diag.seeds, 1);
        assert_eq!(diag.hits, 1);
    }

    #[test]
    fn test_different_ranges_same_length_do_not_alias() {
        let _guard = cache_test_guard();
        clear();
        let crit_a = vec![text("x"), text("x")];
        let sums_a = vec![num(1.0), num(2.0)];
        let crit_b = vec![text("x"), text("x")];
        let sums_b = vec![num(10.0), num(20.0)];
        let epoch = test_epoch();
        let key_a = cache_key(
            epoch,
            2,
            (1, 2, 0, 2, sums_a.len()),
            &[(1, 0, 0, 2, crit_a.len())],
        );
        let key_b = cache_key(
            epoch,
            2,
            (1, 3, 0, 2, sums_b.len()),
            &[(1, 1, 0, 2, crit_b.len())],
        );
        let lookup_key = vec![NormalizedKey::from_cell_value(&text("x"))];

        assert_eq!(
            sumifs_lookup(&key_a, &[&crit_a], &sums_a, 2, &lookup_key).unwrap(),
            3.0
        );
        assert_eq!(
            sumifs_lookup(&key_b, &[&crit_b], &sums_b, 2, &lookup_key).unwrap(),
            30.0
        );
    }

    #[test]
    fn test_same_pointer_epoch_different_build_row_count_does_not_alias() {
        let _guard = cache_test_guard();
        clear();
        let crit = vec![text("a"), text("a"), text("a")];
        let sums = vec![num(10.0), num(20.0), num(30.0)];
        let epoch = test_epoch();
        let key_two_rows = cache_key(
            epoch,
            2,
            (1, 2, 0, 3, sums.len()),
            &[(1, 0, 0, 3, crit.len())],
        );
        let key_three_rows = cache_key(
            epoch,
            3,
            (1, 2, 0, 3, sums.len()),
            &[(1, 0, 0, 3, crit.len())],
        );
        let lookup_key = vec![NormalizedKey::from_cell_value(&text("a"))];

        assert_eq!(
            sumifs_lookup(&key_two_rows, &[&crit], &sums, 2, &lookup_key).unwrap(),
            30.0
        );
        assert_eq!(
            sumifs_lookup(&key_three_rows, &[&crit], &sums, 3, &lookup_key).unwrap(),
            60.0
        );
    }

    #[test]
    fn test_same_sheet_col_different_row_window_does_not_alias() {
        let _guard = cache_test_guard();
        clear();
        let crit = [text("a"), text("b"), text("a")];
        let sums = [num(10.0), num(20.0), num(30.0)];
        let epoch = test_epoch();
        let first_window_key = cache_key(epoch, 2, (1, 2, 0, 2, 2), &[(1, 0, 0, 2, 2)]);
        let second_window_key = cache_key(epoch, 2, (1, 2, 1, 3, 2), &[(1, 0, 1, 3, 2)]);
        let lookup_key = vec![NormalizedKey::from_cell_value(&text("a"))];

        assert_eq!(
            sumifs_lookup(
                &first_window_key,
                &[&crit[0..2]],
                &sums[0..2],
                2,
                &lookup_key,
            )
            .unwrap(),
            10.0
        );
        assert_eq!(
            sumifs_lookup(
                &second_window_key,
                &[&crit[1..3]],
                &sums[1..3],
                2,
                &lookup_key,
            )
            .unwrap(),
            30.0
        );
    }

    #[test]
    fn test_empty_or_clipped_slices_do_not_collide_across_identity() {
        let _guard = cache_test_guard();
        clear();
        let empty_criteria: Vec<CellValue> = Vec::new();
        let sums_a = vec![num(1.0), num(2.0)];
        let sums_b = vec![num(10.0), num(20.0)];
        let epoch = test_epoch();
        let key_a = cache_key(epoch, 2, (1, 2, 0, 2, sums_a.len()), &[(1, 0, 0, 2, 0)]);
        let key_b = cache_key(epoch, 2, (2, 2, 0, 2, sums_b.len()), &[(2, 0, 0, 2, 0)]);
        let null_key = vec![NormalizedKey::Null];

        assert_eq!(
            sumifs_lookup(&key_a, &[&empty_criteria], &sums_a, 2, &null_key).unwrap(),
            3.0
        );
        assert_eq!(
            sumifs_lookup(&key_b, &[&empty_criteria], &sums_b, 2, &null_key).unwrap(),
            30.0
        );
    }

    #[test]
    fn test_same_pointer_length_different_epoch_misses_stale_entry() {
        let _guard = cache_test_guard();
        clear();
        reset_diagnostics();
        let crit = vec![text("a"), text("a")];
        let mut sums = vec![num(10.0), num(20.0)];
        let domain = new_cache_domain();
        let epoch_one = begin_recalc_epoch(domain);
        let epoch_two = begin_recalc_epoch(domain);
        let key_one = cache_key(
            epoch_one,
            2,
            (1, 2, 0, 2, sums.len()),
            &[(1, 0, 0, 2, crit.len())],
        );
        let key_two = cache_key(
            epoch_two,
            2,
            (1, 2, 0, 2, sums.len()),
            &[(1, 0, 0, 2, crit.len())],
        );
        let lookup_key = vec![NormalizedKey::from_cell_value(&text("a"))];

        assert_eq!(
            sumifs_lookup(&key_one, &[&crit], &sums, 2, &lookup_key).unwrap(),
            30.0
        );
        sums[0] = num(100.0);
        assert_eq!(
            sumifs_lookup(&key_two, &[&crit], &sums, 2, &lookup_key).unwrap(),
            120.0
        );
        let diag = diagnostics();
        assert_eq!(diag.builds, 2);
        assert_eq!(diag.hits, 0);
    }

    #[test]
    fn test_three_criteria_columns() {
        let crit1 = vec![text("a"), text("a"), text("a"), text("b")];
        let crit2 = vec![num(1.0), num(1.0), num(2.0), num(1.0)];
        let crit3 = vec![text("x"), text("y"), text("x"), text("x")];
        let sums = vec![num(100.0), num(200.0), num(300.0), num(400.0)];

        let map = SumifsResultMap::build(&[&crit1, &crit2, &crit3], &sums, 4);

        // a,1,x = 100
        let key = vec![
            NormalizedKey::from_cell_value(&text("a")),
            NormalizedKey::from_cell_value(&num(1.0)),
            NormalizedKey::from_cell_value(&text("x")),
        ];
        assert_eq!(map.lookup(&key).unwrap(), 100.0);

        // a,1,y = 200
        let key = vec![
            NormalizedKey::from_cell_value(&text("a")),
            NormalizedKey::from_cell_value(&num(1.0)),
            NormalizedKey::from_cell_value(&text("y")),
        ];
        assert_eq!(map.lookup(&key).unwrap(), 200.0);
    }
}
