//! Session-scoped frequency map cache for COUNTIF/SUMIF/AVERAGEIF.
//!
//! When multiple cells call `COUNTIF(same_range, different_criteria)`, the same
//! range is linearly scanned on every call. This cache builds a frequency map
//! in a single O(N) pass and then serves subsequent calls with O(1) lookups.
//!
//! ## Cache key
//!
//! Content-based: FxHash of all cell values in the range, paired with length.
//! A secondary verification hash (different seed) is stored alongside each
//! cached entry. On hit, the verification hash is compared to detect the
//! astronomically unlikely case of a primary hash collision. This follows
//! the same dual-hash pattern as `sorted_cache.rs`'s full-data comparison,
//! trading perfect collision detection for zero storage overhead of cloned data.
//!
//! ## Lifetime
//!
//! Thread-local, cleared explicitly at recalc entry via `clear()`.

use std::cell::RefCell;
use std::hash::Hash;

use rustc_hash::FxHashMap;
use value_types::{CellError, CellValue, KahanSum};

use super::hashing;

// ---------------------------------------------------------------------------
// NormalizedKey
// ---------------------------------------------------------------------------

/// Normalized key for case-insensitive text and tolerance-aware numeric matching.
///
/// Two cell values that COUNTIF considers "equal" must produce the same key.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum NormalizedKey {
    /// Quantized numeric: `(n * 1e10).round() as i64` for |n| <= 9e8,
    /// or `n.to_bits() as i64` for larger magnitudes.
    Number(i64),
    /// Lowercased text (case-insensitive matching).
    Text(String),
    Boolean(bool),
    Null,
    /// Preserves error variant: `#N/A` ≠ `#VALUE!`.
    Error(CellError),
}

/// For |n| > this, quantization would overflow i64. At this magnitude, two
/// distinct representable f64 values can't be within 1e-10 of each other,
/// so bit-exact equality is correct.
const QUANTIZE_THRESHOLD: f64 = 9e8;

impl NormalizedKey {
    /// Quantize an f64 to an i64 key for tolerance-aware numeric matching.
    #[inline]
    fn quantize(n: f64) -> i64 {
        if n.abs() <= QUANTIZE_THRESHOLD {
            (n * 1e10).round() as i64
        } else {
            n.to_bits() as i64
        }
    }

    /// Normalize a cell value for frequency map keying.
    ///
    /// Text that parses as a number is normalized to `Number` so that
    /// `Text("2019")` and `Number(2019)` produce the same key. This matches
    /// Excel's COUNTIF/SUMIF/AVERAGEIF cross-type comparison semantics.
    #[inline]
    pub fn from_cell_value(v: &CellValue) -> Self {
        match v {
            CellValue::Number(n) => NormalizedKey::Number(Self::quantize(n.get())),
            CellValue::Text(s) => {
                // Numeric text normalizes to Number (cross-type matching).
                // Trim whitespace first — Excel's COUNTIF/SUMIF ignores
                // leading/trailing spaces when matching numeric criteria
                // (e.g., "1 " matches criteria 1). This must be consistent
                // with `as_comparable_number()` which also trims.
                let trimmed = s.trim();
                if let Ok(n) = trimmed.parse::<f64>()
                    && n.is_finite()
                {
                    return NormalizedKey::Number(Self::quantize(n));
                }
                NormalizedKey::Text(s.to_lowercase())
            }
            CellValue::Boolean(b) => NormalizedKey::Boolean(*b),
            CellValue::Control(c) => NormalizedKey::Boolean(c.value),
            CellValue::Image(image) => NormalizedKey::Text(image.fallback_text().to_lowercase()),
            CellValue::Null => NormalizedKey::Null,
            CellValue::Error(e, _) => NormalizedKey::Error(*e),
            // 1x1 arrays (e.g. from structured table refs) unwrap to scalar.
            CellValue::Array(arr) if arr.rows() == 1 && arr.cols() == 1 => {
                Self::from_cell_value(arr.get(0, 0).unwrap_or(&CellValue::Null))
            }
            _ => NormalizedKey::Null, // Multi-cell Array/Lambda treated as Null
        }
    }
}

// ---------------------------------------------------------------------------
// is_exact_match_criteria
// ---------------------------------------------------------------------------

/// Returns true if the criteria value can use exact-match frequency lookup.
///
/// Returns false for:
/// - Text with operator prefixes (`>`, `<`, `=`, `<>`, `>=`, `<=`)
/// - Text containing unescaped wildcards (`*`, `?`)
/// - Text "TRUE"/"FALSE" (cross-type boolean matching not handled by NormalizedKey)
pub fn is_exact_match_criteria(criteria: &CellValue) -> bool {
    match criteria {
        CellValue::Text(s) => {
            let trimmed = s.trim();
            // Operator prefixes
            if trimmed.starts_with(">=")
                || trimmed.starts_with("<=")
                || trimmed.starts_with("<>")
                || trimmed.starts_with('>')
                || trimmed.starts_with('<')
                || trimmed.starts_with('=')
            {
                return false;
            }
            // Wildcards (unescaped)
            if has_unescaped_wildcard(s) {
                return false;
            }
            // Text "TRUE"/"FALSE" — parse_criteria uses coerce_to_string() which
            // matches Boolean(true/false) cross-type. StaticExact would compare
            // NormalizedKey::Text("true") vs NormalizedKey::Boolean(true) — mismatch.
            if trimmed.eq_ignore_ascii_case("TRUE") || trimmed.eq_ignore_ascii_case("FALSE") {
                return false;
            }
            // Text that parses as a number (e.g. "5") can now use the fast path
            // because NormalizedKey::from_cell_value normalizes numeric text to
            // NormalizedKey::Number, matching cross-type correctly.
            true
        }
        CellValue::Number(_)
        | CellValue::Boolean(_)
        | CellValue::Control(_)
        | CellValue::Image(_)
        | CellValue::Null
        | CellValue::Error(..) => true,
        // Single-element arrays (1x1): unwrap to the scalar element.
        // Multi-element arrays are rejected by extract_criteria_elements before
        // we get here, but 1x1 arrays pass through and need recursive handling.
        CellValue::Array(arr) => {
            match arr.get(0, 0) {
                Some(inner) => is_exact_match_criteria(inner),
                None => true, // Empty array → Null-like, exact match
            }
        }
    }
}

/// Check if a string contains unescaped `*` or `?` wildcards.
/// Tilde (`~`) escapes the next character: `~*` is literal `*`.
fn has_unescaped_wildcard(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '~' {
            i += 2; // skip escaped char
        } else if chars[i] == '*' || chars[i] == '?' {
            return true;
        } else {
            i += 1;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// CountFrequencyMap
// ---------------------------------------------------------------------------

/// Frequency map: normalized cell value → count of occurrences.
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

        // Decrement old
        if let Some(count) = self.counts.get_mut(&old_key) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.counts.remove(&old_key);
            }
        }

        // Increment new
        *self.counts.entry(new_key).or_insert(0) += 1;
    }

    /// O(1) lookup — normalizes the criteria value before lookup.
    #[inline]
    pub fn count(&self, criteria: &CellValue) -> u64 {
        let key = NormalizedKey::from_cell_value(criteria);
        let mut total = self.counts.get(&key).copied().unwrap_or(0);
        // Excel: criteria "" (empty text) also matches Null (empty) cells.
        if matches!(&key, NormalizedKey::Text(s) if s.is_empty()) {
            total += self.counts.get(&NormalizedKey::Null).copied().unwrap_or(0);
        }
        total
    }
}

// ---------------------------------------------------------------------------
// SumFrequencyMap
// ---------------------------------------------------------------------------

/// Per-key sum entry: either an accumulated Kahan sum + count, or a poisoning error.
enum SumEntry {
    Sum { acc: KahanSum, count: u64 },
    Error(CellError),
}

/// Frequency map for SUMIF: normalized criteria value → accumulated sum.
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

            // Only accumulate if not already poisoned
            if let SumEntry::Sum { acc, count } = entry {
                match sum_col[i] {
                    CellValue::Number(n) => {
                        acc.add(n.get());
                        *count += 1;
                    }
                    CellValue::Error(e, _) => *entry = SumEntry::Error(*e),
                    _ => {} // Non-numeric, non-error: skip (matches SUMIF behavior)
                }
            }
        }

        SumFrequencyMap { sums }
    }

    /// Incrementally update the sum frequency map for a single cell value change.
    ///
    /// `old_criteria` / `new_criteria`: the criteria column values (old and new).
    /// `old_sum_val` / `new_sum_val`: the sum column values (old and new).
    ///
    /// Subtracts the old sum value from the old criteria's bucket and adds the new
    /// sum value to the new criteria's bucket. Handles error poisoning.
    pub fn update(
        &mut self,
        old_criteria: &CellValue,
        new_criteria: &CellValue,
        old_sum_val: &CellValue,
        new_sum_val: &CellValue,
    ) {
        let old_key = NormalizedKey::from_cell_value(old_criteria);
        let new_key = NormalizedKey::from_cell_value(new_criteria);

        // Subtract old sum value from old criteria bucket
        if let Some(entry) = self.sums.get_mut(&old_key)
            && let SumEntry::Sum { acc, count } = entry
        {
            if let CellValue::Number(n) = old_sum_val {
                acc.add(-n.get());
                *count = count.saturating_sub(1);
            }
            // Clean up empty entries
            if *count == 0 {
                self.sums.remove(&old_key);
            }
        }
        // If poisoned (Error), leave as-is — incremental update cannot un-poison

        // Add new sum value to new criteria bucket
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
                _ => {} // Non-numeric, non-error: skip
            }
        }
    }

    /// O(1) lookup. Returns `Ok(sum)` or `Err(CellError)` if the entry is poisoned.
    /// Returns `Ok(0.0)` if no matching key found (matches SUMIF behavior).
    #[inline]
    pub fn sum(&self, criteria: &CellValue) -> Result<f64, CellError> {
        let key = NormalizedKey::from_cell_value(criteria);
        let primary = self.sums.get(&key);
        // Excel: criteria "" (empty text) also matches Null (empty) cells.
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
    /// Returns `Err(CellError)` if the entry is poisoned.
    /// Returns `Ok((0.0, 0))` if no matching key found.
    #[inline]
    pub fn sum_and_count(&self, criteria: &CellValue) -> Result<(f64, u64), CellError> {
        let key = NormalizedKey::from_cell_value(criteria);
        let primary = self.sums.get(&key);
        // Excel: criteria "" (empty text) also matches Null (empty) cells.
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

// ---------------------------------------------------------------------------
// Public builder functions (cache-free, for WorkbookCache integration)
// ---------------------------------------------------------------------------

/// Build a `CountFrequencyMap` from cell value refs without caching.
///
/// This is the core frequency-building logic extracted for use by
/// `WorkbookCache::get_or_build_count_frequency()`. Callers that don't
/// have `EvalMetadata` context should use `count_lookup()` instead.
#[inline]
pub fn build_count_map(values: &[&CellValue]) -> CountFrequencyMap {
    CountFrequencyMap::build(values)
}

/// Build a `SumFrequencyMap` from criteria+sum value refs without caching.
///
/// This is the core frequency-building logic extracted for use by
/// `WorkbookCache::get_or_build_sum_frequency()`. Callers that don't
/// have `EvalMetadata` context should use `sum_lookup()` instead.
#[inline]
pub fn build_sum_map(crit_values: &[&CellValue], sum_values: &[&CellValue]) -> SumFrequencyMap {
    SumFrequencyMap::build(crit_values, sum_values)
}

// ---------------------------------------------------------------------------
// Content-based hashing (delegates to shared hashing module)
// ---------------------------------------------------------------------------

/// Hash a slice of CellValue references for cache key identity.
fn hash_cell_value_refs(values: &[&CellValue]) -> u64 {
    hashing::hash_cell_value_refs(values)
}

/// Compute a secondary verification hash using a different seed.
fn verification_hash_refs(values: &[&CellValue]) -> u64 {
    hashing::verification_hash_refs(values)
}

// ---------------------------------------------------------------------------
// Thread-local cache
// ---------------------------------------------------------------------------

type CacheKey = (u64, usize);

/// Cached count frequency map with a verification hash for collision safety.
struct CountCacheEntry {
    /// Secondary hash of the range values (different seed from the primary key hash).
    verification_hash: u64,
    /// The frequency map itself.
    map: CountFrequencyMap,
}

/// Cached sum frequency map with verification hashes for collision safety.
struct SumCacheEntry {
    /// Secondary hash of the criteria column values.
    crit_verification_hash: u64,
    /// Secondary hash of the sum column values.
    sum_verification_hash: u64,
    /// The frequency map itself.
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
///
/// Returns the count for the given criteria value. This is the primary
/// entry point for COUNTIF optimization.
///
/// On cache hit, a secondary verification hash is compared to detect
/// the astronomically unlikely case of a primary hash collision.
pub fn count_lookup(values: &[&CellValue], criteria: &CellValue) -> u64 {
    let key = (hash_cell_value_refs(values), values.len());
    let v_hash = verification_hash_refs(values);

    COUNT_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        let entry = cache.get(&key);

        // Check for a verified hit
        if let Some(entry) = entry
            && entry.verification_hash == v_hash
        {
            return entry.map.count(criteria);
        }

        // Miss or collision — (re)build and insert
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
///
/// Returns `Ok(sum)` or `Err(CellError)` if any matching sum cell was an error.
///
/// On cache hit, secondary verification hashes for both columns are compared
/// to detect the astronomically unlikely case of a primary hash collision.
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
///
/// Returns `Ok((sum, count))` or `Err(CellError)` if poisoned.
///
/// On cache hit, secondary verification hashes for both columns are compared
/// to detect the astronomically unlikely case of a primary hash collision.
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

    // -- NormalizedKey tests --

    #[test]
    fn test_normalized_key_case_insensitive_text() {
        let k1 = NormalizedKey::from_cell_value(&text("Hello"));
        let k2 = NormalizedKey::from_cell_value(&text("HELLO"));
        let k3 = NormalizedKey::from_cell_value(&text("hello"));
        assert_eq!(k1, k2);
        assert_eq!(k2, k3);
    }

    #[test]
    fn test_normalized_key_numeric_tolerance() {
        // Quantization: (n * 1e10).round() as i64. Bin width = 1e-10.
        // Values well within the same bin hash identically.
        let k1 = NormalizedKey::from_cell_value(&num(1.0));
        let k2 = NormalizedKey::from_cell_value(&num(1.0 + 1e-11));
        assert_eq!(k1, k2);

        // Values that differ by more than 1e-10 hash differently.
        let k3 = NormalizedKey::from_cell_value(&num(1.0 + 2e-10));
        assert_ne!(k1, k3);

        // Negative values work too.
        let k4 = NormalizedKey::from_cell_value(&num(-5.0));
        let k5 = NormalizedKey::from_cell_value(&num(-5.0 + 1e-11));
        assert_eq!(k4, k5);
    }

    #[test]
    fn test_normalized_key_large_numbers_no_overflow() {
        // Numbers > 9e8 use to_bits() — no overflow
        let big1 = num(1e15);
        let big2 = num(1e15 + 1.0);
        let k1 = NormalizedKey::from_cell_value(&big1);
        let k2 = NormalizedKey::from_cell_value(&big2);
        // These are distinct f64 values, so should produce different keys
        assert_ne!(k1, k2);

        // Same large value should produce same key
        let k3 = NormalizedKey::from_cell_value(&num(1e15));
        assert_eq!(k1, k3);
    }

    #[test]
    fn test_normalized_key_error_variants_distinct() {
        let na = NormalizedKey::from_cell_value(&CellValue::Error(CellError::Na, None));
        let val = NormalizedKey::from_cell_value(&CellValue::Error(CellError::Value, None));
        let ref_ = NormalizedKey::from_cell_value(&CellValue::Error(CellError::Ref, None));
        assert_ne!(na, val);
        assert_ne!(na, ref_);
        assert_ne!(val, ref_);
    }

    #[test]
    fn test_normalized_key_text_as_number_cross_type() {
        // Text "2019" should produce the same key as Number(2019)
        let k_num = NormalizedKey::from_cell_value(&num(2019.0));
        let k_text = NormalizedKey::from_cell_value(&text("2019"));
        assert_eq!(k_num, k_text);

        // Decimal text too
        let k_num2 = NormalizedKey::from_cell_value(&num(2.75));
        let k_text2 = NormalizedKey::from_cell_value(&text("2.75"));
        assert_eq!(k_num2, k_text2);

        // Non-numeric text stays as Text
        let k_hello = NormalizedKey::from_cell_value(&text("hello"));
        assert!(matches!(k_hello, NormalizedKey::Text(_)));
        assert_ne!(k_hello, NormalizedKey::from_cell_value(&num(0.0)));
    }

    #[test]
    fn test_normalized_key_text_with_whitespace_matches_number() {
        // Text "1 " (trailing space) should normalize to Number, matching Number(1)
        let k_num = NormalizedKey::from_cell_value(&num(1.0));
        let k_trailing = NormalizedKey::from_cell_value(&text("1 "));
        assert_eq!(
            k_num, k_trailing,
            "trailing space: \"1 \" should match Number(1)"
        );

        let k_leading = NormalizedKey::from_cell_value(&text(" 1"));
        assert_eq!(
            k_num, k_leading,
            "leading space: \" 1\" should match Number(1)"
        );

        let k_both = NormalizedKey::from_cell_value(&text(" 2.75 "));
        let k_num2 = NormalizedKey::from_cell_value(&num(2.75));
        assert_eq!(k_num2, k_both, "\" 2.75 \" should match Number(2.75)");

        // Pure whitespace should NOT match any number
        let k_spaces = NormalizedKey::from_cell_value(&text("  "));
        assert!(matches!(k_spaces, NormalizedKey::Text(_)));
    }

    #[test]
    fn test_normalized_key_null() {
        let k = NormalizedKey::from_cell_value(&CellValue::Null);
        assert_eq!(k, NormalizedKey::Null);
    }

    #[test]
    fn test_normalized_key_boolean() {
        let t = NormalizedKey::from_cell_value(&CellValue::Boolean(true));
        let f = NormalizedKey::from_cell_value(&CellValue::Boolean(false));
        assert_ne!(t, f);
    }

    // -- is_exact_match_criteria tests --

    #[test]
    fn test_exact_match_plain_text() {
        assert!(is_exact_match_criteria(&text("hello")));
        assert!(is_exact_match_criteria(&text("Alice")));
        assert!(is_exact_match_criteria(&text("")));
    }

    #[test]
    fn test_exact_match_numbers() {
        assert!(is_exact_match_criteria(&num(5.0)));
        assert!(is_exact_match_criteria(&num(0.0)));
        assert!(is_exact_match_criteria(&num(-1.5)));
    }

    #[test]
    fn test_exact_match_boolean_null_error() {
        assert!(is_exact_match_criteria(&CellValue::Boolean(true)));
        assert!(is_exact_match_criteria(&CellValue::Null));
        assert!(is_exact_match_criteria(&CellValue::Error(
            CellError::Na,
            None
        )));
    }

    #[test]
    fn test_not_exact_match_operators() {
        assert!(!is_exact_match_criteria(&text(">5")));
        assert!(!is_exact_match_criteria(&text("<5")));
        assert!(!is_exact_match_criteria(&text(">=5")));
        assert!(!is_exact_match_criteria(&text("<=5")));
        assert!(!is_exact_match_criteria(&text("<>5")));
        assert!(!is_exact_match_criteria(&text("=5")));
    }

    #[test]
    fn test_not_exact_match_wildcards() {
        assert!(!is_exact_match_criteria(&text("*")));
        assert!(!is_exact_match_criteria(&text("hello*")));
        assert!(!is_exact_match_criteria(&text("h?llo")));
        assert!(!is_exact_match_criteria(&text("*test*")));
    }

    #[test]
    fn test_exact_match_escaped_wildcards() {
        // ~* is literal *, should be exact match
        assert!(is_exact_match_criteria(&text("hello~*")));
        assert!(is_exact_match_criteria(&text("hello~?")));
    }

    #[test]
    fn test_exact_match_text_as_number() {
        // Numeric text can use exact match because NormalizedKey normalizes
        // it to Number, matching cross-type correctly.
        assert!(is_exact_match_criteria(&text("5")));
        assert!(is_exact_match_criteria(&text("3.14")));
        assert!(is_exact_match_criteria(&text("-10")));
        assert!(is_exact_match_criteria(&text("0")));
    }

    #[test]
    fn test_not_exact_match_boolean_text() {
        // "TRUE"/"FALSE" text criteria must NOT use StaticExact because
        // parse_criteria matches Boolean(true/false) cross-type via
        // coerce_to_string(), but StaticExact would compare
        // NormalizedKey::Text("true") vs NormalizedKey::Boolean(true) — mismatch.
        assert!(!is_exact_match_criteria(&text("TRUE")));
        assert!(!is_exact_match_criteria(&text("FALSE")));
        assert!(!is_exact_match_criteria(&text("true")));
        assert!(!is_exact_match_criteria(&text("false")));
        assert!(!is_exact_match_criteria(&text("True")));
        assert!(!is_exact_match_criteria(&text("False")));
        // Actual boolean values are fine as StaticExact
        assert!(is_exact_match_criteria(&CellValue::Boolean(true)));
        assert!(is_exact_match_criteria(&CellValue::Boolean(false)));
    }

    #[test]
    fn test_exact_match_array_criteria() {
        // Single-element array containing a number — should unwrap and return true
        let arr_num = CellValue::from_rows(vec![vec![CellValue::number(42.0)]]);
        assert!(is_exact_match_criteria(&arr_num));

        // Single-element array containing plain text — should unwrap and return true
        let arr_text = CellValue::from_rows(vec![vec![CellValue::Text("ios".into())]]);
        assert!(is_exact_match_criteria(&arr_text));

        // Single-element array containing operator text — should unwrap and return false
        let arr_op = CellValue::from_rows(vec![vec![CellValue::Text(">5".into())]]);
        assert!(!is_exact_match_criteria(&arr_op));

        // Single-element array containing wildcard text — should unwrap and return false
        let arr_wild = CellValue::from_rows(vec![vec![CellValue::Text("hello*".into())]]);
        assert!(!is_exact_match_criteria(&arr_wild));

        // Empty array — treated as Null-like, exact match
        let arr_empty = CellValue::from_rows(vec![]);
        assert!(is_exact_match_criteria(&arr_empty));
    }

    // -- CountFrequencyMap tests --

    #[test]
    fn test_count_basic() {
        clear();
        let values = [num(1.0), num(2.0), num(1.0), num(3.0), num(1.0)];
        let refs: Vec<&CellValue> = values.iter().collect();
        let map = CountFrequencyMap::build(&refs);
        assert_eq!(map.count(&num(1.0)), 3);
        assert_eq!(map.count(&num(2.0)), 1);
        assert_eq!(map.count(&num(3.0)), 1);
        assert_eq!(map.count(&num(4.0)), 0);
    }

    #[test]
    fn test_count_mixed_types() {
        clear();
        let values = [
            num(1.0),
            text("hello"),
            text("HELLO"),
            CellValue::Boolean(true),
            CellValue::Null,
            CellValue::Error(CellError::Na, None),
            CellValue::Error(CellError::Na, None),
            CellValue::Error(CellError::Value, None),
        ];
        let refs: Vec<&CellValue> = values.iter().collect();
        let map = CountFrequencyMap::build(&refs);

        assert_eq!(map.count(&num(1.0)), 1);
        assert_eq!(map.count(&text("hello")), 2); // case-insensitive
        assert_eq!(map.count(&text("Hello")), 2); // case-insensitive
        assert_eq!(map.count(&CellValue::Boolean(true)), 1);
        assert_eq!(map.count(&CellValue::Null), 1);
        assert_eq!(map.count(&CellValue::Error(CellError::Na, None)), 2);
        assert_eq!(map.count(&CellValue::Error(CellError::Value, None)), 1);
    }

    #[test]
    fn test_count_cross_type_text_number() {
        clear();
        // Text "2019" and Number(2019) should be counted together
        let values = [text("2019"), num(2019.0), text("2019"), num(2020.0)];
        let refs: Vec<&CellValue> = values.iter().collect();
        let map = CountFrequencyMap::build(&refs);
        // Number criteria matches both Number and numeric Text
        assert_eq!(map.count(&num(2019.0)), 3);
        // Text criteria also matches (normalized to same Number key)
        assert_eq!(map.count(&text("2019")), 3);
        assert_eq!(map.count(&num(2020.0)), 1);
    }

    #[test]
    fn test_count_empty_range() {
        clear();
        let refs: Vec<&CellValue> = vec![];
        let map = CountFrequencyMap::build(&refs);
        assert_eq!(map.count(&num(1.0)), 0);
    }

    #[test]
    fn test_count_all_null() {
        clear();
        let values = [CellValue::Null, CellValue::Null, CellValue::Null];
        let refs: Vec<&CellValue> = values.iter().collect();
        let map = CountFrequencyMap::build(&refs);
        assert_eq!(map.count(&CellValue::Null), 3);
        assert_eq!(map.count(&num(0.0)), 0);
    }

    // -- SumFrequencyMap tests --

    #[test]
    fn test_sum_basic() {
        clear();
        let criteria = [text("a"), text("b"), text("a"), text("b"), text("a")];
        let sums = [num(10.0), num(20.0), num(30.0), num(40.0), num(50.0)];
        let crit_refs: Vec<&CellValue> = criteria.iter().collect();
        let sum_refs: Vec<&CellValue> = sums.iter().collect();
        let map = SumFrequencyMap::build(&crit_refs, &sum_refs);

        assert_eq!(map.sum(&text("a")).unwrap(), 90.0); // 10+30+50
        assert_eq!(map.sum(&text("b")).unwrap(), 60.0); // 20+40
        assert_eq!(map.sum(&text("c")).unwrap(), 0.0); // not found
    }

    #[test]
    fn test_sum_kahan_accuracy() {
        clear();
        // Sum many small values — Kahan should prevent drift
        let n = 10_000;
        let criteria: Vec<CellValue> = vec![text("x"); n];
        let sums: Vec<CellValue> = vec![num(0.1); n];
        let crit_refs: Vec<&CellValue> = criteria.iter().collect();
        let sum_refs: Vec<&CellValue> = sums.iter().collect();
        let map = SumFrequencyMap::build(&crit_refs, &sum_refs);

        let result = map.sum(&text("x")).unwrap();
        // Without Kahan, naive f64 summation of 10000 × 0.1 drifts from 1000.0
        assert!((result - 1000.0).abs() < 1e-10);
    }

    #[test]
    fn test_sum_error_poisoning() {
        clear();
        let criteria = [text("a"), text("a"), text("b")];
        let sums = [
            num(10.0),
            CellValue::Error(CellError::Value, None),
            num(20.0),
        ];
        let crit_refs: Vec<&CellValue> = criteria.iter().collect();
        let sum_refs: Vec<&CellValue> = sums.iter().collect();
        let map = SumFrequencyMap::build(&crit_refs, &sum_refs);

        // "a" is poisoned because one of its sum values was an error
        assert_eq!(map.sum(&text("a")).unwrap_err(), CellError::Value);
        // "b" is fine
        assert_eq!(map.sum(&text("b")).unwrap(), 20.0);
    }

    #[test]
    fn test_sum_and_count() {
        clear();
        let criteria = [text("a"), text("b"), text("a"), text("a")];
        let sums = [num(10.0), num(20.0), num(30.0), CellValue::Null];
        let crit_refs: Vec<&CellValue> = criteria.iter().collect();
        let sum_refs: Vec<&CellValue> = sums.iter().collect();
        let map = SumFrequencyMap::build(&crit_refs, &sum_refs);

        let (sum, count) = map.sum_and_count(&text("a")).unwrap();
        assert_eq!(sum, 40.0); // 10+30 (Null skipped)
        assert_eq!(count, 2); // only numeric values counted
    }

    // -- Thread-local cache tests --

    #[test]
    fn test_count_lookup_caches() {
        clear();
        let values = [num(1.0), num(2.0), num(1.0)];
        let refs: Vec<&CellValue> = values.iter().collect();

        // First call builds the map
        let c1 = count_lookup(&refs, &num(1.0));
        assert_eq!(c1, 2);

        // Second call should hit cache (same result)
        let c2 = count_lookup(&refs, &num(2.0));
        assert_eq!(c2, 1);
    }

    #[test]
    fn test_clear_invalidates() {
        clear();
        let values = [num(1.0), num(1.0)];
        let refs: Vec<&CellValue> = values.iter().collect();
        assert_eq!(count_lookup(&refs, &num(1.0)), 2);

        clear();

        // After clear, cache is empty but rebuild produces same result
        assert_eq!(count_lookup(&refs, &num(1.0)), 2);
    }

    #[test]
    fn test_sum_lookup_basic() {
        clear();
        let criteria = [text("x"), text("y"), text("x")];
        let sums = [num(5.0), num(10.0), num(15.0)];
        let crit_refs: Vec<&CellValue> = criteria.iter().collect();
        let sum_refs: Vec<&CellValue> = sums.iter().collect();

        let result = sum_lookup(&crit_refs, &sum_refs, &text("x"));
        assert_eq!(result.unwrap(), 20.0);
    }

    // -- has_unescaped_wildcard tests --

    #[test]
    fn test_unescaped_wildcards() {
        assert!(has_unescaped_wildcard("*"));
        assert!(has_unescaped_wildcard("hello*"));
        assert!(has_unescaped_wildcard("h?llo"));
        assert!(!has_unescaped_wildcard("hello"));
        assert!(!has_unescaped_wildcard("hello~*"));
        assert!(!has_unescaped_wildcard("hello~?"));
        assert!(!has_unescaped_wildcard("hello~~"));
    }

    // -- Incremental update tests --

    #[test]
    fn test_count_frequency_map_incremental_update() {
        let values = [num(1.0), num(2.0), num(1.0), num(3.0)];
        let refs: Vec<&CellValue> = values.iter().collect();
        let mut map = CountFrequencyMap::build(&refs);
        assert_eq!(map.count(&num(1.0)), 2);
        assert_eq!(map.count(&num(2.0)), 1);

        // Change a cell from 1.0 to 2.0
        map.update(&num(1.0), &num(2.0));
        assert_eq!(map.count(&num(1.0)), 1);
        assert_eq!(map.count(&num(2.0)), 2);
    }

    #[test]
    fn test_count_frequency_map_update_removes_zero_count() {
        let values = [num(5.0)];
        let refs: Vec<&CellValue> = values.iter().collect();
        let mut map = CountFrequencyMap::build(&refs);
        assert_eq!(map.count(&num(5.0)), 1);

        // Change from 5.0 to 6.0 — 5.0 count drops to 0 and is removed
        map.update(&num(5.0), &num(6.0));
        assert_eq!(map.count(&num(5.0)), 0);
        assert_eq!(map.count(&num(6.0)), 1);
    }

    #[test]
    fn test_count_frequency_map_update_text_case_insensitive() {
        let values = [text("Hello"), text("hello")];
        let refs: Vec<&CellValue> = values.iter().collect();
        let mut map = CountFrequencyMap::build(&refs);
        assert_eq!(map.count(&text("hello")), 2);

        // Change one "Hello" to "World"
        map.update(&text("Hello"), &text("World"));
        assert_eq!(map.count(&text("hello")), 1);
        assert_eq!(map.count(&text("world")), 1);
    }

    #[test]
    fn test_sum_frequency_map_incremental_update() {
        let criteria = [text("a"), text("b"), text("a")];
        let sums = [num(10.0), num(20.0), num(30.0)];
        let crit_refs: Vec<&CellValue> = criteria.iter().collect();
        let sum_refs: Vec<&CellValue> = sums.iter().collect();
        let mut map = SumFrequencyMap::build(&crit_refs, &sum_refs);
        assert_eq!(map.sum(&text("a")).unwrap(), 40.0); // 10+30
        assert_eq!(map.sum(&text("b")).unwrap(), 20.0);

        // Change row 0: criteria "a" → "b", sum 10.0 → 15.0
        map.update(&text("a"), &text("b"), &num(10.0), &num(15.0));
        assert_eq!(map.sum(&text("a")).unwrap(), 30.0); // only 30 left
        assert_eq!(map.sum(&text("b")).unwrap(), 35.0); // 20+15
    }

    #[test]
    fn test_sum_frequency_map_update_removes_empty_bucket() {
        let criteria = [text("x")];
        let sums = [num(100.0)];
        let crit_refs: Vec<&CellValue> = criteria.iter().collect();
        let sum_refs: Vec<&CellValue> = sums.iter().collect();
        let mut map = SumFrequencyMap::build(&crit_refs, &sum_refs);

        // Change criteria from "x" to "y" — "x" bucket should be removed
        map.update(&text("x"), &text("y"), &num(100.0), &num(100.0));
        assert_eq!(map.sum(&text("x")).unwrap(), 0.0); // gone
        assert_eq!(map.sum(&text("y")).unwrap(), 100.0);
    }
}
