//! Packed u64 bitset — bit `i` = row `i` matches.
//!
//! Used for columnar predicate composition (like ClickHouse/DuckDB).
//! Length is always `(row_count + 63) / 64` words.

use value_types::CellValue;

/// Number of u64 words needed to hold `len` bits.
#[inline]
const fn word_count(len: u32) -> usize {
    (len as usize).div_ceil(64)
}

/// Mask for the valid bits in the last word when `len % 64 != 0`.
/// Returns `!0u64` when `len` is a multiple of 64 (all bits valid).
#[inline]
const fn tail_mask(len: u32) -> u64 {
    let rem = len % 64;
    if rem == 0 { !0u64 } else { (1u64 << rem) - 1 }
}

/// Packed u64 bitset — bit `i` = row `i` matches.
#[derive(Clone, Debug)]
pub struct ColumnBitset {
    words: Vec<u64>,
    len: u32, // number of rows (not words)
}

impl ColumnBitset {
    /// All bits set to true.
    pub fn new_all_true(len: u32) -> Self {
        if len == 0 {
            return Self {
                words: Vec::new(),
                len: 0,
            };
        }
        let wc = word_count(len);
        let mut words = vec![!0u64; wc];
        // Mask trailing bits in the last word.
        words[wc - 1] &= tail_mask(len);
        Self { words, len }
    }

    /// All bits set to false.
    pub fn new_all_false(len: u32) -> Self {
        Self {
            words: vec![0u64; word_count(len)],
            len,
        }
    }

    /// Number of rows.
    #[inline]
    pub fn len(&self) -> u32 {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Get bit at row index.
    #[inline]
    pub fn get(&self, row: u32) -> bool {
        debug_assert!(row < self.len, "row {row} out of range (len={})", self.len);
        let w = (row / 64) as usize;
        let b = row % 64;
        (self.words[w] >> b) & 1 != 0
    }

    /// Set bit at row index.
    #[inline]
    pub fn set(&mut self, row: u32, val: bool) {
        debug_assert!(row < self.len, "row {row} out of range (len={})", self.len);
        let w = (row / 64) as usize;
        let b = row % 64;
        if val {
            self.words[w] |= 1u64 << b;
        } else {
            self.words[w] &= !(1u64 << b);
        }
    }

    /// Build bitset by evaluating a predicate on each cell in a column slice.
    pub fn from_predicate(col: &[CellValue], pred: &dyn Fn(&CellValue) -> bool) -> Self {
        let len = col.len() as u32;
        let wc = word_count(len);
        let mut words = vec![0u64; wc];

        // Process in chunks of 64 cells.
        let full_words = (len / 64) as usize;
        for (wi, word) in words.iter_mut().enumerate().take(full_words) {
            let base = wi * 64;
            let mut w = 0u64;
            for bit in 0..64u32 {
                w |= (pred(&col[base + bit as usize]) as u64) << bit;
            }
            *word = w;
        }

        // Remaining cells in the last (partial) word.
        let remaining_start = full_words * 64;
        if remaining_start < len as usize {
            let mut word = 0u64;
            for bit in 0..(len as usize - remaining_start) {
                word |= (pred(&col[remaining_start + bit]) as u64) << bit;
            }
            words[full_words] = word;
        }

        Self { words, len }
    }

    /// In-place AND.
    pub fn and_assign(&mut self, other: &ColumnBitset) {
        debug_assert_eq!(self.len, other.len, "bitset length mismatch");
        for (a, b) in self.words.iter_mut().zip(other.words.iter()) {
            *a &= *b;
        }
    }

    /// In-place OR.
    pub fn or_assign(&mut self, other: &ColumnBitset) {
        debug_assert_eq!(self.len, other.len, "bitset length mismatch");
        for (a, b) in self.words.iter_mut().zip(other.words.iter()) {
            *a |= *b;
        }
    }

    /// In-place NOT (flips all bits, respects len for trailing bits).
    pub fn not_assign(&mut self) {
        for w in self.words.iter_mut() {
            *w = !*w;
        }
        // Mask trailing bits in the last word.
        if self.len > 0 {
            let last = self.words.len() - 1;
            self.words[last] &= tail_mask(self.len);
        }
    }

    /// Count of set bits — compiles to hardware POPCNT.
    pub fn count_ones(&self) -> u32 {
        self.words.iter().map(|w| w.count_ones()).sum()
    }

    /// Iterator over indices of set bits.
    pub fn ones(&self) -> OnesIter<'_> {
        OnesIter {
            words: &self.words,
            word_idx: 0,
            current: self.words.first().copied().unwrap_or(0),
            len: self.len,
        }
    }

    /// Raw word access for future SIMD.
    #[inline]
    pub fn words(&self) -> &[u64] {
        &self.words
    }

    /// Mutable raw word access for future SIMD.
    #[inline]
    pub fn words_mut(&mut self) -> &mut [u64] {
        &mut self.words
    }
}

/// Iterator yielding indices of set bits.
/// Uses `trailing_zeros()` to find next set bit in O(1) per bit.
pub struct OnesIter<'a> {
    words: &'a [u64],
    word_idx: u32,
    current: u64, // copy of current word, bits cleared as yielded
    len: u32,
}

impl Iterator for OnesIter<'_> {
    type Item = u32;

    #[inline]
    fn next(&mut self) -> Option<u32> {
        loop {
            if self.current != 0 {
                let tz = self.current.trailing_zeros();
                let idx = self.word_idx * 64 + tz;
                if idx >= self.len {
                    return None;
                }
                // Clear the lowest set bit.
                self.current &= self.current - 1;
                return Some(idx);
            }
            // Advance to the next word.
            self.word_idx += 1;
            if (self.word_idx as usize) >= self.words.len() {
                return None;
            }
            self.current = self.words[self.word_idx as usize];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellValue;

    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    #[test]
    fn all_true_various_lengths() {
        for &n in &[0u32, 1, 63, 64, 65, 128, 200] {
            let bs = ColumnBitset::new_all_true(n);
            assert_eq!(bs.len(), n);
            assert_eq!(bs.count_ones(), n, "all_true({n}) count_ones mismatch");
            for i in 0..n {
                assert!(bs.get(i), "all_true({n}) bit {i} should be set");
            }
        }
    }

    #[test]
    fn all_false_various_lengths() {
        for &n in &[0u32, 1, 63, 64, 65, 128, 200] {
            let bs = ColumnBitset::new_all_false(n);
            assert_eq!(bs.len(), n);
            assert_eq!(bs.count_ones(), 0, "all_false({n}) count_ones mismatch");
            for i in 0..n {
                assert!(!bs.get(i), "all_false({n}) bit {i} should be clear");
            }
        }
    }

    #[test]
    fn is_empty() {
        assert!(ColumnBitset::new_all_false(0).is_empty());
        assert!(!ColumnBitset::new_all_false(1).is_empty());
    }

    // -----------------------------------------------------------------------
    // get / set
    // -----------------------------------------------------------------------

    #[test]
    fn set_and_get_individual_bits() {
        let mut bs = ColumnBitset::new_all_false(200);
        let indices: Vec<u32> = vec![0, 1, 63, 64, 65, 127, 128, 199];
        for &i in &indices {
            bs.set(i, true);
        }
        for i in 0..200 {
            assert_eq!(bs.get(i), indices.contains(&i), "mismatch at bit {i}");
        }
        assert_eq!(bs.count_ones(), indices.len() as u32);

        // Clear one bit.
        bs.set(64, false);
        assert!(!bs.get(64));
        assert_eq!(bs.count_ones(), (indices.len() - 1) as u32);
    }

    // -----------------------------------------------------------------------
    // from_predicate
    // -----------------------------------------------------------------------

    #[test]
    fn from_predicate_numeric_gt() {
        let col: Vec<CellValue> = (0..200).map(|i| CellValue::number(i as f64)).collect();

        // Predicate: value >= 100.0
        let bs = ColumnBitset::from_predicate(
            &col,
            &|cv| matches!(cv, CellValue::Number(n) if n.get() >= 100.0),
        );
        assert_eq!(bs.len(), 200);
        assert_eq!(bs.count_ones(), 100); // 100..199
        for i in 0..200 {
            assert_eq!(bs.get(i), i >= 100, "mismatch at row {i}");
        }
    }

    #[test]
    fn from_predicate_empty() {
        let col: Vec<CellValue> = Vec::new();
        let bs = ColumnBitset::from_predicate(&col, &|_| true);
        assert_eq!(bs.len(), 0);
        assert_eq!(bs.count_ones(), 0);
    }

    // -----------------------------------------------------------------------
    // and_assign / or_assign / not_assign
    // -----------------------------------------------------------------------

    #[test]
    fn and_assign_basic() {
        let mut a = ColumnBitset::new_all_true(130);
        let mut b = ColumnBitset::new_all_false(130);
        // Set every even bit in b.
        for i in (0..130).step_by(2) {
            b.set(i, true);
        }
        a.and_assign(&b);
        assert_eq!(a.count_ones(), 65); // 0, 2, 4, ..., 128
        for i in 0..130 {
            assert_eq!(a.get(i), i % 2 == 0);
        }
    }

    #[test]
    fn or_assign_basic() {
        let mut a = ColumnBitset::new_all_false(130);
        let mut b = ColumnBitset::new_all_false(130);
        // Set odd bits in a, even bits in b.
        for i in 0..130u32 {
            if i % 2 == 1 {
                a.set(i, true);
            } else {
                b.set(i, true);
            }
        }
        a.or_assign(&b);
        assert_eq!(a.count_ones(), 130);
    }

    #[test]
    fn not_assign_basic() {
        let mut bs = ColumnBitset::new_all_false(65);
        bs.set(0, true);
        bs.set(64, true);
        bs.not_assign();
        assert_eq!(bs.count_ones(), 63); // 65 - 2
        assert!(!bs.get(0));
        assert!(!bs.get(64));
        assert!(bs.get(1));
        assert!(bs.get(63));
    }

    #[test]
    fn not_assign_trailing_bits_masked() {
        // Ensure NOT doesn't set bits beyond len.
        let mut bs = ColumnBitset::new_all_false(65);
        bs.not_assign();
        assert_eq!(bs.count_ones(), 65);
        // The internal word count is 2 (128 bits capacity), but only 65 should be set.
        // Verify by checking raw words.
        let last_word = bs.words()[1];
        // Only bit 0 should be set in the second word (bit index 64 = word1, bit 0).
        assert_eq!(last_word, 1);
    }

    // -----------------------------------------------------------------------
    // count_ones
    // -----------------------------------------------------------------------

    #[test]
    fn count_ones_exact() {
        let mut bs = ColumnBitset::new_all_false(128);
        assert_eq!(bs.count_ones(), 0);
        for i in 0..128u32 {
            bs.set(i, true);
            assert_eq!(bs.count_ones(), i + 1);
        }
    }

    // -----------------------------------------------------------------------
    // OnesIter
    // -----------------------------------------------------------------------

    #[test]
    fn ones_iter_collects_correct_indices() {
        let mut bs = ColumnBitset::new_all_false(200);
        let expected: Vec<u32> = vec![0, 3, 63, 64, 127, 128, 199];
        for &i in &expected {
            bs.set(i, true);
        }
        let collected: Vec<u32> = bs.ones().collect();
        assert_eq!(collected, expected);
    }

    #[test]
    fn ones_iter_empty() {
        let bs = ColumnBitset::new_all_false(100);
        let collected: Vec<u32> = bs.ones().collect();
        assert!(collected.is_empty());
    }

    #[test]
    fn ones_iter_all_set() {
        let bs = ColumnBitset::new_all_true(65);
        let collected: Vec<u32> = bs.ones().collect();
        let expected: Vec<u32> = (0..65).collect();
        assert_eq!(collected, expected);
    }

    #[test]
    fn ones_iter_zero_length() {
        let bs = ColumnBitset::new_all_true(0);
        let collected: Vec<u32> = bs.ones().collect();
        assert!(collected.is_empty());
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn single_bit() {
        let mut bs = ColumnBitset::new_all_false(1);
        assert!(!bs.get(0));
        bs.set(0, true);
        assert!(bs.get(0));
        assert_eq!(bs.count_ones(), 1);
        assert_eq!(bs.ones().collect::<Vec<_>>(), vec![0]);
    }

    #[test]
    fn exactly_64_bits() {
        let bs = ColumnBitset::new_all_true(64);
        assert_eq!(bs.count_ones(), 64);
        assert_eq!(bs.words().len(), 1);
        assert_eq!(bs.words()[0], !0u64);
    }

    #[test]
    fn words_access() {
        let mut bs = ColumnBitset::new_all_false(128);
        bs.words_mut()[0] = 0xFF;
        assert_eq!(bs.count_ones(), 8);
        for i in 0..8 {
            assert!(bs.get(i));
        }
    }
}
