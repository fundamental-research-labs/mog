use rustc_hash::FxHashMap;
use value_types::{CellError, CellValue, KahanSum};

use super::NormalizedKey;

/// Per-key sum entry: either an accumulated Kahan sum + count, or a poisoning error.
enum SumEntry {
    Sum { acc: KahanSum, count: u64 },
    Error(CellError),
}

/// Frequency map for SUMIF: normalized criteria value -> accumulated sum.
pub struct SumFrequencyMap {
    sums: FxHashMap<NormalizedKey, SumEntry>,
}

impl SumFrequencyMap {
    /// Build from criteria value refs + sum value refs in one O(N) pass.
    ///
    /// Uses Kahan summation for numerical stability. If any sum_col value
    /// is an Error for a given criteria key, that entry is poisoned.
    pub fn build(criteria_col: &[&CellValue], sum_col: &[&CellValue]) -> Self {
        let mut sums: FxHashMap<NormalizedKey, SumEntry> = FxHashMap::default();
        let len = criteria_col.len().min(sum_col.len());

        for i in 0..len {
            let key = NormalizedKey::from_cell_value(criteria_col[i]);
            let entry = sums.entry(key).or_insert_with(|| SumEntry::Sum {
                acc: KahanSum::new(),
                count: 0,
            });

            if let SumEntry::Sum { acc, count } = entry {
                match sum_col[i] {
                    CellValue::Number(n) => {
                        acc.add(n.get());
                        *count += 1;
                    }
                    CellValue::Error(e, _) => *entry = SumEntry::Error(*e),
                    _ => {}
                }
            }
        }

        SumFrequencyMap { sums }
    }

    /// Incrementally update the sum frequency map for a single cell value change.
    pub fn update(
        &mut self,
        old_criteria: &CellValue,
        new_criteria: &CellValue,
        old_sum_val: &CellValue,
        new_sum_val: &CellValue,
    ) {
        let old_key = NormalizedKey::from_cell_value(old_criteria);
        let new_key = NormalizedKey::from_cell_value(new_criteria);

        if let Some(entry) = self.sums.get_mut(&old_key)
            && let SumEntry::Sum { acc, count } = entry
        {
            if let CellValue::Number(n) = old_sum_val {
                acc.add(-n.get());
                *count = count.saturating_sub(1);
            }
            if *count == 0 {
                self.sums.remove(&old_key);
            }
        }

        let entry = self.sums.entry(new_key).or_insert_with(|| SumEntry::Sum {
            acc: KahanSum::new(),
            count: 0,
        });
        if let SumEntry::Sum { acc, count } = entry {
            match new_sum_val {
                CellValue::Number(n) => {
                    acc.add(n.get());
                    *count += 1;
                }
                CellValue::Error(e, _) => *entry = SumEntry::Error(*e),
                _ => {}
            }
        }
    }

    /// O(1) lookup. Returns `Ok(sum)` or `Err(CellError)` if the entry is poisoned.
    /// Returns `Ok(0.0)` if no matching key found (matches SUMIF behavior).
    #[inline]
    pub fn sum(&self, criteria: &CellValue) -> Result<f64, CellError> {
        let key = NormalizedKey::from_cell_value(criteria);
        let primary = self.sums.get(&key);
        let null_extra = if matches!(&key, NormalizedKey::Text(s) if s.is_empty()) {
            self.sums.get(&NormalizedKey::Null)
        } else {
            None
        };
        let mut total = 0.0;
        for entry in primary.into_iter().chain(null_extra.into_iter()) {
            match entry {
                SumEntry::Sum { acc, .. } => total += acc.total(),
                SumEntry::Error(e) => return Err(*e),
            }
        }
        Ok(total)
    }

    /// O(1) lookup returning (sum, count) for AVERAGEIF.
    #[inline]
    pub fn sum_and_count(&self, criteria: &CellValue) -> Result<(f64, u64), CellError> {
        let key = NormalizedKey::from_cell_value(criteria);
        let primary = self.sums.get(&key);
        let null_extra = if matches!(&key, NormalizedKey::Text(s) if s.is_empty()) {
            self.sums.get(&NormalizedKey::Null)
        } else {
            None
        };
        let mut total_sum = 0.0;
        let mut total_count = 0u64;
        for entry in primary.into_iter().chain(null_extra.into_iter()) {
            match entry {
                SumEntry::Sum { acc, count } => {
                    total_sum += acc.total();
                    total_count += *count;
                }
                SumEntry::Error(e) => return Err(*e),
            }
        }
        Ok((total_sum, total_count))
    }
}

/// Build a `SumFrequencyMap` from criteria+sum value refs without caching.
#[inline]
pub fn build_sum_map(crit_values: &[&CellValue], sum_values: &[&CellValue]) -> SumFrequencyMap {
    SumFrequencyMap::build(crit_values, sum_values)
}
