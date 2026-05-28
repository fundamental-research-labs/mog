/// Parallel bitvec tracking which rows in a `DenseColumn` are boolean-sourced.
/// Uses packed u64 words (1 bit per row) for 8x less memory than `Vec<bool>`.
/// For 1M rows: `Vec<bool>` = 1MB, `BitVec` = 125KB.
#[derive(Debug, Clone)]
pub struct DenseBoolMask {
    /// Packed bits: bit i = 1 if `DenseColumn::values()[i]` came from `CellValue::Boolean`.
    /// Word j, bit k corresponds to row (j * 64 + k).
    words: Vec<u64>,
    /// Start row for this mask.
    start_row: u32,
    /// Number of rows covered by this mask.
    len: u32,
}

impl DenseBoolMask {
    /// Create a new `DenseBoolMask` with all bits cleared.
    #[must_use]
    pub fn new(words: Vec<u64>, start_row: u32, len: u32) -> Self {
        Self {
            words,
            start_row,
            len,
        }
    }

    /// Packed bit words. Word j, bit k corresponds to row (j * 64 + k).
    #[must_use]
    pub fn words(&self) -> &[u64] {
        &self.words
    }

    /// Start row for this mask.
    #[must_use]
    pub fn start_row(&self) -> u32 {
        self.start_row
    }

    /// Number of rows covered by this mask.
    #[must_use]
    pub fn len(&self) -> u32 {
        self.len
    }

    /// Returns true if row `i` (relative to `start_row`) is boolean-sourced.
    #[inline]
    #[must_use]
    pub fn is_bool(&self, i: usize) -> bool {
        if i >= self.len as usize {
            return false;
        }
        let word_idx = i / 64;
        let bit_idx = i % 64;
        if word_idx >= self.words.len() {
            return false;
        }
        (self.words[word_idx] >> bit_idx) & 1 == 1
    }

    /// Returns true if any bit is set in [start..end) (relative to `start_row`).
    #[must_use]
    pub fn any_in_range(&self, start: usize, end: usize) -> bool {
        let end = end.min(self.len as usize);
        if start >= end {
            return false;
        }
        let start_word = start / 64;
        let end_word = (end.saturating_sub(1)) / 64;

        if start_word == end_word {
            return self
                .masked_word(start_word, start, end)
                .is_some_and(|word| word != 0);
        }

        if self
            .masked_word(start_word, start, (start_word + 1) * 64)
            .is_some_and(|word| word != 0)
        {
            return true;
        }

        for w in (start_word + 1)..end_word {
            if w < self.words.len() && self.words[w] != 0 {
                return true;
            }
        }

        self.masked_word(end_word, end_word * 64, end)
            .is_some_and(|word| word != 0)
    }

    /// Count of boolean-sourced rows in [start..end).
    #[must_use]
    pub fn count_in_range(&self, start: usize, end: usize) -> u32 {
        let end = end.min(self.len as usize);
        if start >= end {
            return 0;
        }
        let start_word = start / 64;
        let end_word = (end.saturating_sub(1)) / 64;

        if start_word == end_word {
            return self
                .masked_word(start_word, start, end)
                .map_or(0, u64::count_ones);
        }

        let mut count = self
            .masked_word(start_word, start, (start_word + 1) * 64)
            .map_or(0, u64::count_ones);

        for w in (start_word + 1)..end_word {
            if w < self.words.len() {
                count += self.words[w].count_ones();
            }
        }

        count
            + self
                .masked_word(end_word, end_word * 64, end)
                .map_or(0, u64::count_ones)
    }

    /// Sum of `dense.values()[i]` where `is_bool(i)` is true, for `i` in `[start..end)`.
    #[must_use]
    pub fn bool_sum(&self, dense_values: &[f64], start: usize, end: usize) -> f64 {
        let end = end.min(self.len as usize).min(dense_values.len());
        if start >= end {
            return 0.0;
        }
        let mut sum = 0.0f64;
        let start_word = start / 64;
        let end_word = (end.saturating_sub(1)) / 64;

        for w in start_word..=end_word {
            let Some(mut word) = self.masked_word(w, start, end) else {
                break;
            };

            let word_base = w * 64;
            while word != 0 {
                let bit = word.trailing_zeros() as usize;
                let idx = word_base + bit;
                if idx < end {
                    let v = dense_values[idx];
                    if !v.is_nan() {
                        sum += v;
                    }
                }
                word &= word - 1;
            }
        }
        sum
    }

    /// Returns true if no bits are set (no booleans in the column).
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.words.iter().all(|&w| w == 0)
    }

    /// Set bit `i` (relative to `start_row`) to 1.
    #[inline]
    pub fn set_bit(&mut self, i: usize) {
        let word_idx = i / 64;
        let bit_idx = i % 64;
        if word_idx < self.words.len() {
            self.words[word_idx] |= 1u64 << bit_idx;
        }
    }

    fn masked_word(&self, word_idx: usize, start: usize, end: usize) -> Option<u64> {
        let word = *self.words.get(word_idx)?;
        let word_start = word_idx * 64;
        let word_end = word_start + 64;
        let lo = start.max(word_start) - word_start;
        let hi = end.min(word_end) - word_start;
        if lo >= hi {
            return Some(0);
        }
        Some(word & mask_bits(lo, hi))
    }
}

fn mask_bits(lo: usize, hi: usize) -> u64 {
    let lower = !0u64 << lo;
    let upper = if hi == 64 { !0u64 } else { !0u64 >> (64 - hi) };
    lower & upper
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    fn mask(len: u32) -> DenseBoolMask {
        let num_words = (len as usize).div_ceil(64);
        DenseBoolMask::new(vec![0u64; num_words], 0, len)
    }

    #[test]
    fn mask_new_all_false() {
        let m = mask(128);
        assert_eq!(m.len(), 128);
        assert_eq!(m.start_row(), 0);
        assert_eq!(m.words().len(), 2);
        for i in 0..128 {
            assert!(!m.is_bool(i));
        }
    }

    #[test]
    fn mask_set_and_check_bits() {
        let mut m = mask(128);
        m.set_bit(0);
        m.set_bit(63);
        m.set_bit(64);
        m.set_bit(127);
        assert!(m.is_bool(0));
        assert!(m.is_bool(63));
        assert!(m.is_bool(64));
        assert!(m.is_bool(127));
        assert!(!m.is_bool(1));
        assert!(!m.is_bool(65));
    }

    #[test]
    fn mask_is_bool_out_of_range() {
        let m = mask(10);
        assert!(!m.is_bool(10));
        assert!(!m.is_bool(100));
    }

    #[test]
    fn mask_is_empty() {
        let m = mask(64);
        assert!(m.is_empty());

        let mut m2 = mask(64);
        m2.set_bit(5);
        assert!(!m2.is_empty());
    }

    #[test]
    fn any_in_range_all_false() {
        let m = mask(128);
        assert!(!m.any_in_range(0, 128));
    }

    #[test]
    fn any_in_range_one_true() {
        let mut m = mask(128);
        m.set_bit(50);
        assert!(m.any_in_range(0, 128));
        assert!(m.any_in_range(50, 51));
        assert!(!m.any_in_range(51, 60));
        assert!(!m.any_in_range(0, 50));
    }

    #[test]
    fn any_in_range_empty_range() {
        let mut m = mask(64);
        m.set_bit(0);
        assert!(!m.any_in_range(5, 5));
        assert!(!m.any_in_range(10, 5));
    }

    #[test]
    fn any_in_range_cross_word_boundary() {
        let mut m = mask(200);
        m.set_bit(100);
        assert!(m.any_in_range(60, 110));
        assert!(!m.any_in_range(101, 200));
    }

    #[test]
    fn any_in_range_last_bit_of_word() {
        let mut m = mask(128);
        m.set_bit(63);
        assert!(m.any_in_range(63, 64));
        assert!(!m.any_in_range(64, 128));
    }

    #[test]
    fn count_in_range_basic() {
        let mut m = mask(64);
        m.set_bit(0);
        m.set_bit(10);
        m.set_bit(63);
        assert_eq!(m.count_in_range(0, 64), 3);
    }

    #[test]
    fn count_in_range_partial() {
        let mut m = mask(64);
        m.set_bit(0);
        m.set_bit(10);
        m.set_bit(63);
        assert_eq!(m.count_in_range(5, 20), 1);
    }

    #[test]
    fn count_in_range_empty() {
        let m = mask(64);
        assert_eq!(m.count_in_range(0, 64), 0);
    }

    #[test]
    fn count_in_range_cross_word() {
        let mut m = mask(200);
        m.set_bit(10);
        m.set_bit(63);
        m.set_bit(64);
        m.set_bit(100);
        m.set_bit(128);
        m.set_bit(190);
        assert_eq!(m.count_in_range(0, 200), 6);
        assert_eq!(m.count_in_range(60, 130), 4);
        assert_eq!(m.count_in_range(64, 128), 2);
    }

    #[test]
    fn count_in_range_single_bit() {
        let mut m = mask(128);
        m.set_bit(70);
        assert_eq!(m.count_in_range(70, 71), 1);
        assert_eq!(m.count_in_range(69, 70), 0);
    }

    #[test]
    fn bool_sum_basic() {
        let mut m = mask(5);
        m.set_bit(0);
        m.set_bit(2);
        m.set_bit(4);
        let values = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(m.bool_sum(&values, 0, 5), 9.0);
    }

    #[test]
    fn bool_sum_all_true() {
        let mut m = mask(3);
        m.set_bit(0);
        m.set_bit(1);
        m.set_bit(2);
        let values = [10.0, 20.0, 30.0];
        assert_eq!(m.bool_sum(&values, 0, 3), 60.0);
    }

    #[test]
    fn bool_sum_all_false() {
        let m = mask(3);
        let values = [10.0, 20.0, 30.0];
        assert_eq!(m.bool_sum(&values, 0, 3), 0.0);
    }

    #[test]
    fn bool_sum_with_nan() {
        let mut m = mask(3);
        m.set_bit(0);
        m.set_bit(1);
        m.set_bit(2);
        let values = [1.0, f64::NAN, 3.0];
        assert_eq!(m.bool_sum(&values, 0, 3), 4.0);
    }

    #[test]
    fn bool_sum_partial_range() {
        let mut m = mask(5);
        m.set_bit(0);
        m.set_bit(1);
        m.set_bit(2);
        m.set_bit(3);
        m.set_bit(4);
        let values = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(m.bool_sum(&values, 2, 4), 7.0);
    }

    #[test]
    fn bool_sum_empty_range() {
        let mut m = mask(5);
        m.set_bit(0);
        let values = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(m.bool_sum(&values, 3, 3), 0.0);
        assert_eq!(m.bool_sum(&values, 5, 3), 0.0);
    }

    #[test]
    fn bool_sum_cross_word_boundary() {
        let mut m = mask(128);
        m.set_bit(63);
        m.set_bit(64);
        let mut values = vec![0.0; 128];
        values[63] = 100.0;
        values[64] = 200.0;
        assert_eq!(m.bool_sum(&values, 60, 70), 300.0);
    }

    #[test]
    fn zero_length_mask() {
        let m = DenseBoolMask::new(vec![], 0, 0);
        assert!(!m.is_bool(0));
        assert!(!m.any_in_range(0, 0));
        assert_eq!(m.count_in_range(0, 0), 0);
        assert_eq!(m.bool_sum(&[], 0, 0), 0.0);
        assert!(m.is_empty());
    }

    #[test]
    fn single_element_mask() {
        let mut m = mask(1);
        assert!(!m.is_bool(0));
        assert!(!m.any_in_range(0, 1));
        assert_eq!(m.count_in_range(0, 1), 0);

        m.set_bit(0);
        assert!(m.is_bool(0));
        assert!(m.any_in_range(0, 1));
        assert_eq!(m.count_in_range(0, 1), 1);
        assert_eq!(m.bool_sum(&[5.0], 0, 1), 5.0);
    }

    #[test]
    fn mask_many_bits_set_across_words() {
        let mut m = mask(256);
        for i in (0..256).step_by(13) {
            m.set_bit(i);
        }
        assert_eq!(m.count_in_range(0, 256), 20);
        assert!(m.any_in_range(0, 256));
        assert_eq!(m.count_in_range(50, 80), 3);
    }

    #[test]
    fn bool_sum_large_cross_word() {
        let n: usize = 200;
        let mut m = mask(u32::try_from(n).unwrap());
        let mut values = vec![0.0; n];
        for i in (0..n).step_by(2) {
            m.set_bit(i);
            values[i] = 1.0;
        }
        assert_eq!(m.bool_sum(&values, 0, n), 100.0);
        assert_eq!(m.bool_sum(&values, 60, 70), 5.0);
    }

    #[test]
    fn count_in_range_all_bits_set_multi_word() {
        let m = DenseBoolMask::new(vec![!0u64, !0u64, !0u64], 0, 192);
        assert_eq!(m.count_in_range(0, 192), 192);
        assert_eq!(m.count_in_range(10, 100), 90);
        assert_eq!(m.count_in_range(63, 65), 2);
    }

    #[test]
    fn missing_backing_words_read_false_and_do_not_panic() {
        let mut m = DenseBoolMask::new(vec![1u64], 0, 130);
        m.set_bit(100);
        assert!(m.is_bool(0));
        assert!(!m.is_bool(100));
        assert!(!m.any_in_range(64, 130));
        assert_eq!(m.count_in_range(64, 130), 0);
        let values = vec![1.0; 130];
        assert_eq!(m.bool_sum(&values, 0, 130), 1.0);
    }

    #[test]
    fn ranges_ending_on_word_boundaries() {
        let mut m = mask(128);
        m.set_bit(0);
        m.set_bit(63);
        m.set_bit(64);
        m.set_bit(127);
        assert!(m.any_in_range(0, 64));
        assert_eq!(m.count_in_range(0, 64), 2);
        assert!(m.any_in_range(63, 64));
        assert_eq!(m.count_in_range(63, 64), 1);
        assert!(m.any_in_range(64, 128));
        assert_eq!(m.count_in_range(64, 128), 2);
        assert!(m.any_in_range(65, 128));
        assert_eq!(m.count_in_range(65, 128), 1);
    }

    #[test]
    fn bool_sum_caps_to_shorter_values_or_mask() {
        let mut longer_mask = mask(128);
        longer_mask.set_bit(0);
        longer_mask.set_bit(100);
        assert_eq!(longer_mask.bool_sum(&[2.0, 3.0], 0, 128), 2.0);

        let mut shorter_mask = mask(2);
        shorter_mask.set_bit(0);
        shorter_mask.set_bit(1);
        assert_eq!(shorter_mask.bool_sum(&[2.0, 3.0, 4.0], 0, 3), 5.0);
    }
}
