use rustc_hash::FxHashMap;
use value_types::CellValue;

use super::NormalizedKey;

/// Frequency map: normalized cell value -> count of occurrences.
pub struct CountFrequencyMap {
    counts: FxHashMap<NormalizedKey, u64>,
}

impl CountFrequencyMap {
    /// Build a frequency map from cell value refs in one O(N) pass.
    pub fn build(values: &[&CellValue]) -> Self {
        let mut counts = FxHashMap::default();
        for &v in values {
            let key = NormalizedKey::from_cell_value(v);
            *counts.entry(key).or_insert(0) += 1;
        }
        CountFrequencyMap { counts }
    }

    /// Incrementally update the frequency map for a single cell value change.
    ///
    /// Decrements the old value's count and increments the new value's count.
    /// If the old value's count reaches zero, the entry is removed.
    pub fn update(&mut self, old: &CellValue, new: &CellValue) {
        let old_key = NormalizedKey::from_cell_value(old);
        let new_key = NormalizedKey::from_cell_value(new);

        if let Some(count) = self.counts.get_mut(&old_key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.counts.remove(&old_key);
            }
        }

        *self.counts.entry(new_key).or_insert(0) += 1;
    }

    /// O(1) lookup -- normalizes the criteria value before lookup.
    #[inline]
    pub fn count(&self, criteria: &CellValue) -> u64 {
        let key = NormalizedKey::from_cell_value(criteria);
        let mut total = self.counts.get(&key).copied().unwrap_or(0);
        if matches!(&key, NormalizedKey::Text(s) if s.is_empty()) {
            total += self.counts.get(&NormalizedKey::Null).copied().unwrap_or(0);
        }
        total
    }
}

/// Build a `CountFrequencyMap` from cell value refs without caching.
#[inline]
pub fn build_count_map(values: &[&CellValue]) -> CountFrequencyMap {
    CountFrequencyMap::build(values)
}
