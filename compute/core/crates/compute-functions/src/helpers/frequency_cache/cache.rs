use std::cell::RefCell;

use rustc_hash::FxHashMap;
use value_types::{CellError, CellValue};

use super::{CountFrequencyMap, SumFrequencyMap};
use crate::helpers::hashing;

type CacheKey = (u64, usize);

struct CountCacheEntry {
    verification_hash: u64,
    map: CountFrequencyMap,
}

struct SumCacheEntry {
    crit_verification_hash: u64,
    sum_verification_hash: u64,
    map: SumFrequencyMap,
}

thread_local! {
    static COUNT_CACHE: RefCell<FxHashMap<CacheKey, CountCacheEntry>> =
        RefCell::new(FxHashMap::default());
    static SUM_CACHE: RefCell<FxHashMap<(CacheKey, CacheKey), SumCacheEntry>> =
        RefCell::new(FxHashMap::default());
}

/// Clear all frequency caches. Must be called at recalc entry.
pub fn clear() {
    COUNT_CACHE.with(|c| c.borrow_mut().clear());
    SUM_CACHE.with(|c| c.borrow_mut().clear());
}

/// Look up (or build) a CountFrequencyMap for the given range values.
pub fn count_lookup(values: &[&CellValue], criteria: &CellValue) -> u64 {
    let key = (hash_cell_value_refs(values), values.len());
    let v_hash = verification_hash_refs(values);

    COUNT_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let entry = cache.get(&key);

        if let Some(entry) = entry
            && entry.verification_hash == v_hash
        {
            return entry.map.count(criteria);
        }

        let new_entry = CountCacheEntry {
            verification_hash: v_hash,
            map: CountFrequencyMap::build(values),
        };
        let count = new_entry.map.count(criteria);
        cache.insert(key, new_entry);
        count
    })
}

/// Look up (or build) a SumFrequencyMap for the given criteria+sum ranges.
pub fn sum_lookup(
    criteria_col: &[&CellValue],
    sum_col: &[&CellValue],
    criteria: &CellValue,
) -> Result<f64, CellError> {
    let crit_key = (hash_cell_value_refs(criteria_col), criteria_col.len());
    let sum_key = (hash_cell_value_refs(sum_col), sum_col.len());
    let cache_key = (crit_key, sum_key);
    let crit_v_hash = verification_hash_refs(criteria_col);
    let sum_v_hash = verification_hash_refs(sum_col);

    SUM_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let entry = cache.get(&cache_key);

        if let Some(entry) = entry
            && entry.crit_verification_hash == crit_v_hash
            && entry.sum_verification_hash == sum_v_hash
        {
            return entry.map.sum(criteria);
        }

        let new_entry = SumCacheEntry {
            crit_verification_hash: crit_v_hash,
            sum_verification_hash: sum_v_hash,
            map: SumFrequencyMap::build(criteria_col, sum_col),
        };
        let result = new_entry.map.sum(criteria);
        cache.insert(cache_key, new_entry);
        result
    })
}

/// Look up (or build) a SumFrequencyMap and return (sum, count) for AVERAGEIF.
pub fn sum_and_count_lookup(
    criteria_col: &[&CellValue],
    sum_col: &[&CellValue],
    criteria: &CellValue,
) -> Result<(f64, u64), CellError> {
    let crit_key = (hash_cell_value_refs(criteria_col), criteria_col.len());
    let sum_key = (hash_cell_value_refs(sum_col), sum_col.len());
    let cache_key = (crit_key, sum_key);
    let crit_v_hash = verification_hash_refs(criteria_col);
    let sum_v_hash = verification_hash_refs(sum_col);

    SUM_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let entry = cache.get(&cache_key);

        if let Some(entry) = entry
            && entry.crit_verification_hash == crit_v_hash
            && entry.sum_verification_hash == sum_v_hash
        {
            return entry.map.sum_and_count(criteria);
        }

        let new_entry = SumCacheEntry {
            crit_verification_hash: crit_v_hash,
            sum_verification_hash: sum_v_hash,
            map: SumFrequencyMap::build(criteria_col, sum_col),
        };
        let result = new_entry.map.sum_and_count(criteria);
        cache.insert(cache_key, new_entry);
        result
    })
}

fn hash_cell_value_refs(values: &[&CellValue]) -> u64 {
    hashing::hash_cell_value_refs(values)
}

fn verification_hash_refs(values: &[&CellValue]) -> u64 {
    hashing::verification_hash_refs(values)
}
