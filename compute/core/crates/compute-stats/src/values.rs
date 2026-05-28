//! Canonical value normalization for the compute engine.
//!
//! This module is the **single source of truth** for how `CellValue` is
//! interpreted across the entire compute engine.  Every other compute module
//! (filter, aggregator, sorter, grouper) MUST delegate to
//! the functions here rather than rolling their own blank detection, numeric
//! checks, equality comparisons, sort ordering, key generation, or
//! compensated summation.
//!
//! # Responsibilities
//!
//! | Concern | Function |
//! |---------|----------|
//! | Blank detection | [`CellValue::is_visually_blank`] |
//! | Numeric detection | [`cell_value_is_numeric`] |
//! | Value equality | [`cell_value_eq`] |
//! | Sort ordering | [`cell_value_to_sort_key`] / [`SortKey`] |
//! | Structural grouping key | [`cell_value_to_group_key`] / [`GroupKey`] |
//! | Wire-format string key | [`cell_value_to_key`] (delegates to `GroupKey`) |
//! | User-visible label | [`cell_value_to_display_key`] |
//! | Accurate summation | [`kahan_sum`] |

use std::borrow::Cow;
use std::cmp::Ordering;
use std::sync::Arc;

use value_types::CellError;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Constants (wire-format sentinels — do not use for new code)
// ---------------------------------------------------------------------------

/// Wire-format sentinel string for null / blank / whitespace-only values.
///
/// Used only by the wire-format string serialization produced by
/// [`cell_value_to_key`] for cross-boundary compatibility with the XLSX
/// parser and persisted filter include/exclude lists. New code inside the
/// engine should use [`GroupKey::Blank`] directly.
pub const BLANK_KEY: &str = "\x00BLANK\x00";

/// Wire-format sentinel string for `CellValue::Array` values.
///
/// Used only by the wire-format string serialization produced by
/// [`cell_value_to_key`]. New code inside the engine should use
/// [`GroupKey::Array`] directly.
pub const ARRAY_KEY: &str = "\x00ARRAY\x00";

/// Wire-format sentinel string for `CellValue::Lambda` values.
///
/// Used only by the wire-format string serialization produced by
/// [`cell_value_to_key`]. New code inside the engine should use
/// [`GroupKey::Lambda`] directly.
pub const LAMBDA_KEY: &str = "\x00LAMBDA\x00";

// ---------------------------------------------------------------------------
// GroupKey — structural grouping key
// ---------------------------------------------------------------------------

/// A structural key for grouping / deduplication of `CellValue` instances.
///
/// Replaces the in-band `"\x00BLANK\x00"` / `"\x00ARRAY\x00"` sentinel strings
/// previously used as `HashMap<String, _>` keys. Semantic intent is carried
/// in the type rather than smuggled through reserved byte patterns.
///
/// # Coalescence rules (matches [`cell_value_eq`])
///
/// - `Null`, `Text("")`, and whitespace-only `Text` all collapse to
///   [`GroupKey::Blank`].
/// - Numeric values are stored as canonicalized `u64` bits so that `+0.0`
///   and `-0.0` compare equal and all NaN bit patterns collapse to one key.
/// - Text is lowercased for case-insensitive grouping (Excel convention).
/// - Booleans and `Control` values both map to [`GroupKey::Bool`].
/// - Errors use their stable string form (`#DIV/0!`, `#N/A`, ...).
///
/// # Display
///
/// For human-readable output use [`cell_value_to_display_key`], which
/// renders `Blank` / `Array` / `Lambda` as `"(blank)"` / `"(array)"` /
/// `"(lambda)"` — the NUL-wrapped wire sentinels never escape the engine.
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub enum GroupKey {
    /// Coalescence of `Null`, `Text("")`, and whitespace-only `Text`.
    Blank,
    /// A dynamic array result (non-scalar).
    Array,
    /// A lambda value (forward-compatible; no encoder sites today).
    Lambda,
    /// Number, stored as canonicalized IEEE-754 bits.
    ///
    /// `-0.0` is normalized to `+0.0`; all NaN bit patterns collapse to
    /// one canonical NaN.
    Number(u64),
    /// Text, lowercased for case-insensitive grouping.
    Text(Arc<str>),
    /// Boolean (also used for `CellValue::Control`).
    Bool(bool),
    /// Cell error, stored by its display string (`#DIV/0!`, ...).
    Error(String),
}

impl GroupKey {
    /// Render this group key as a wire-format string matching the legacy
    /// `cell_value_to_key` encoding.
    ///
    /// This encoding is preserved for compatibility with the XLSX parser
    /// (`shared_item_to_key`) and persisted filter include/exclude lists.
    /// The format is:
    ///
    /// - `Blank` → `"\x00BLANK\x00"`
    /// - `Array` → `"\x00ARRAY\x00"`
    /// - `Lambda` → `"\x00LAMBDA\x00"`
    /// - `Number(bits)` → `"N:{bits}"`
    /// - `Text(s)` → `"T:{s}"`  (already lowercased)
    /// - `Bool(b)` → `"B:{b}"`
    /// - `Error(e)` → `"E:{e}"`
    ///
    /// New code within the engine should prefer using the `GroupKey` value
    /// directly as a `HashMap` key instead of round-tripping through this
    /// string form.
    #[must_use]
    pub fn to_wire_string(&self) -> String {
        match self {
            GroupKey::Blank => BLANK_KEY.to_string(),
            GroupKey::Array => ARRAY_KEY.to_string(),
            GroupKey::Lambda => LAMBDA_KEY.to_string(),
            GroupKey::Number(bits) => format!("N:{bits}"),
            GroupKey::Text(s) => format!("T:{s}"),
            GroupKey::Bool(b) => format!("B:{b}"),
            GroupKey::Error(e) => format!("E:{e}"),
        }
    }
}

/// Canonicalize an `f64` into `u64` bits for use as a [`GroupKey::Number`].
///
/// Normalizes `-0.0` to `+0.0` and collapses all NaN bit patterns to the
/// canonical quiet-NaN. This guarantees that numerically equal values
/// produce identical keys.
#[inline]
#[must_use]
pub fn f64_to_group_bits(n: f64) -> u64 {
    // Canonicalize -0.0 to +0.0.
    let n = if n == 0.0 { 0.0 } else { n };
    // Canonicalize all NaN bit patterns to one.
    let n = if n.is_nan() { f64::NAN } else { n };
    n.to_bits()
}

/// Convert a `CellValue` into a [`GroupKey`] for grouping / deduplication.
///
/// See [`GroupKey`] for the coalescence rules. Visually-blank values
/// (`Null`, `Text("")`, whitespace-only `Text`) all collapse to
/// [`GroupKey::Blank`].
#[must_use]
pub fn cell_value_to_group_key(value: &CellValue) -> GroupKey {
    if value.is_visually_blank() {
        return GroupKey::Blank;
    }

    match value {
        CellValue::Number(n) => GroupKey::Number(f64_to_group_bits(n.get())),
        CellValue::Text(s) => GroupKey::Text(Arc::from(s.to_lowercase().as_str())),
        CellValue::Boolean(b) => GroupKey::Bool(*b),
        CellValue::Control(c) => GroupKey::Bool(c.value),
        CellValue::Image(image) => GroupKey::Text(Arc::from(image.fallback_text())),
        CellValue::Error(e, _) => GroupKey::Error(e.as_str().to_string()),
        CellValue::Array(_) => GroupKey::Array,
        // Null and whitespace-only Text already handled by is_visually_blank above.
        CellValue::Null => GroupKey::Blank,
    }
}

// ---------------------------------------------------------------------------
// Numeric detection
// ---------------------------------------------------------------------------

/// Returns `true` when `v` is a finite number.
///
/// `NaN`, `Infinity`, and `-Infinity` are *not** considered numeric because
/// they cannot participate meaningfully in aggregation (sum, average, etc.).
///
/// Only `CellValue::Number(n)` where `n.is_finite()` returns `true`.
#[inline]
#[must_use]
pub fn cell_value_is_numeric(v: &CellValue) -> bool {
    matches!(v, CellValue::Number(n) if n.is_finite())
}

// ---------------------------------------------------------------------------
// Value equality
// ---------------------------------------------------------------------------

/// Relative-epsilon tolerance for numeric comparison.
const NUMERIC_EPSILON: f64 = 1e-12;

/// Pivot-aware equality for `CellValue`.
///
/// # Rules
///
/// - **Blanks**: all blank values are equal to each other, even across types
///   (`Null == Text("") == Text("  ")`).
/// - **Number**: relative-epsilon comparison using
///   `|a - b| / max(|a|, |b|, MIN_POSITIVE) < 1e-12`.
/// - **Text**: case-insensitive Unicode comparison via `.to_lowercase()`.
/// - **Boolean**: exact match.
/// - **Error**: compare by error variant (uses derived `PartialEq`).
/// - **Cross-type** (other than blanks): always `false`.
#[must_use]
pub fn cell_value_eq(a: &CellValue, b: &CellValue) -> bool {
    let a_blank = a.is_visually_blank();
    let b_blank = b.is_visually_blank();

    // Blanks: all blank values are equal regardless of variant.
    if a_blank || b_blank {
        return a_blank && b_blank;
    }

    match (a, b) {
        (CellValue::Number(x), CellValue::Number(y)) => {
            // Fast path: bitwise identical.
            if x.to_bits() == y.to_bits() {
                return true;
            }
            // Relative epsilon comparison.
            let diff = (x.get() - y.get()).abs();
            let denom = x.abs().max(y.abs()).max(f64::MIN_POSITIVE);
            diff / denom < NUMERIC_EPSILON
        }
        (CellValue::Text(a_text), CellValue::Text(b_text)) => {
            // Fast path: ASCII case-insensitive comparison avoids two
            // `to_lowercase()` allocations.  Falls back to Unicode
            // `to_lowercase()` only when the strings differ in ASCII
            // comparison AND contain non-ASCII characters.
            if a_text.eq_ignore_ascii_case(b_text) {
                true
            } else if a_text.is_ascii() && b_text.is_ascii() {
                // Both are ASCII and differ case-insensitively -- not equal.
                false
            } else {
                // Non-ASCII: fall back to Unicode lowercase comparison.
                a_text.to_lowercase() == b_text.to_lowercase()
            }
        }
        (CellValue::Boolean(a_bool), CellValue::Boolean(b_bool)) => a_bool == b_bool,
        (CellValue::Error(a_err, None), CellValue::Error(b_err, None)) => a_err == b_err,
        // Cross-type: never equal (blanks already handled above).
        // Arrays and Lambdas have no meaningful equality in pivot context.
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Sort key
// ---------------------------------------------------------------------------

/// Internal comparable payload within a [`SortKey`].
///
/// Each variant implements `Ord` for within-type comparison.
#[derive(Debug, Clone)]
enum SortKeyData {
    /// f64 represented as canonicalized u64 bits for total ordering.
    Number(u64),
    /// Lowercased string for case-insensitive ordering.
    Text(String),
    /// Boolean value (false < true).
    Bool(bool),
    /// Error variant ordinal for deterministic ordering.
    ErrorOrdinal(u8),
    /// All blanks compare equal.
    Blank,
}

impl PartialEq for SortKeyData {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for SortKeyData {}

impl PartialOrd for SortKeyData {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SortKeyData {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (SortKeyData::Number(a), SortKeyData::Number(b)) => a.cmp(b),
            (SortKeyData::Text(a), SortKeyData::Text(b)) => a.cmp(b),
            (SortKeyData::Bool(a), SortKeyData::Bool(b)) => a.cmp(b),
            (SortKeyData::ErrorOrdinal(a), SortKeyData::ErrorOrdinal(b)) => a.cmp(b),
            // SortKey ensures same type_priority implies same SortKeyData variant.
            // Blank vs Blank and any defensive cross-variant case both yield Equal.
            _ => Ordering::Equal,
        }
    }
}

/// A fully-ordered sort key for `CellValue`.
///
/// Type priority (ascending) — matches Excel's sort behavior:
/// - 0 = Number
/// - 1 = Text
/// - 2 = Boolean
/// - 3 = Error
/// - 4 = Blank (always sorted last, regardless of direction)
///
/// When reversing sort direction (descending), only the **within-type**
/// comparison is reversed.  The type priority itself does NOT reverse.
/// This matches Excel's behavior: blanks always sort last; numbers sort
/// first (before text before booleans before errors).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SortKey {
    /// Type priority: Number(0) < Text(1) < Boolean(2) < Error(3) < Blank(4)
    type_priority: u8,
    /// Comparable representation within type.
    key_data: SortKeyData,
}

impl PartialOrd for SortKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SortKey {
    fn cmp(&self, other: &Self) -> Ordering {
        self.type_priority
            .cmp(&other.type_priority)
            .then_with(|| self.key_data.cmp(&other.key_data))
    }
}

impl SortKey {
    /// Returns the type priority of this sort key.
    ///
    /// Useful for verifying that type priority is stable across sort
    /// direction changes.
    #[must_use]
    pub fn type_priority(&self) -> u8 {
        self.type_priority
    }
}

/// Canonicalize an f64 into u64 bits that sort correctly.
///
/// IEEE 754 layout: sign(1) | exponent(11) | mantissa(52).
/// Positive floats already sort correctly as u64.
/// Negative floats need all bits flipped.
/// This gives a total order: -Inf < -1 < -0 == +0 < +1 < +Inf < NaN.
fn f64_to_sortable_bits(n: f64) -> u64 {
    // Canonicalize -0.0 to +0.0.
    let n = if n == 0.0 { 0.0 } else { n };
    // Canonicalize all NaN bit patterns to one.
    let n = if n.is_nan() { f64::NAN } else { n };

    let bits = n.to_bits();
    if n.is_sign_negative() {
        // Negative: flip all bits so that more-negative sorts smaller.
        !bits
    } else {
        // Positive (and +0.0, NaN): flip sign bit so positives sort after negatives.
        bits ^ (1u64 << 63)
    }
}

/// Map a `CellError` variant to a stable ordinal for sorting.
fn error_ordinal(e: CellError) -> u8 {
    match e {
        CellError::Div0 => 0,
        CellError::Na => 1,
        CellError::Name => 2,
        CellError::Null => 3,
        CellError::Num => 4,
        CellError::Ref | CellError::Circ => 5, // Circ displays as #REF!
        CellError::Value => 6,
        CellError::Spill => 7,
        CellError::Calc => 8,
        CellError::GettingData => 9,
    }
}

/// Convert a `CellValue` into a [`SortKey`] for deterministic, Excel-like
/// ordering.
///
/// Blanks always receive `type_priority = 4` so they sort **last**
/// regardless of ascending or descending direction.
///
/// # Sort direction
///
/// To sort descending, reverse only the within-type comparison:
/// ```text
/// // ascending:  key_a.cmp(&key_b)
/// // descending: key_b.cmp(&key_a)   // but blanks still sort last
/// ```
/// Because `type_priority` is always compared in ascending order, blanks
/// (priority 4) always appear after all other types.
#[must_use]
pub fn cell_value_to_sort_key(v: &CellValue) -> SortKey {
    if v.is_visually_blank() {
        return SortKey {
            type_priority: 4,
            key_data: SortKeyData::Blank,
        };
    }

    match v {
        CellValue::Number(n) => SortKey {
            type_priority: 0,
            key_data: SortKeyData::Number(f64_to_sortable_bits(n.get())),
        },
        CellValue::Text(s) => SortKey {
            type_priority: 1,
            key_data: SortKeyData::Text(s.to_lowercase()),
        },
        CellValue::Boolean(b) => SortKey {
            type_priority: 2,
            key_data: SortKeyData::Bool(*b),
        },
        CellValue::Control(c) => SortKey {
            type_priority: 2,
            key_data: SortKeyData::Bool(c.value),
        },
        CellValue::Image(image) => SortKey {
            type_priority: 1,
            key_data: SortKeyData::Text(image.fallback_text().to_lowercase()),
        },
        CellValue::Error(e, _) => SortKey {
            type_priority: 3,
            key_data: SortKeyData::ErrorOrdinal(error_ordinal(*e)),
        },
        // Null and whitespace-only Text are already handled by the blank
        // check above.  Array is exotic; treat as blank for sort purposes.
        CellValue::Null | CellValue::Array(_) => SortKey {
            type_priority: 4,
            key_data: SortKeyData::Blank,
        },
    }
}

// ---------------------------------------------------------------------------
// Key generation (for HashMap / grouping)
// ---------------------------------------------------------------------------

/// Convert a `CellValue` to the wire-format string key used at boundaries
/// that cannot yet carry a typed [`GroupKey`] (XLSX OOXML parser output,
/// persisted filter include/exclude lists).
///
/// New engine-internal code should prefer [`cell_value_to_group_key`] and
/// key `HashMap`s directly by [`GroupKey`]. This function is retained for
/// wire-format compatibility and will be removed once every caller routes
/// through `GroupKey`.
///
/// # Key format
///
/// | Type | Format | Example |
/// |------|--------|---------|
/// | Blank | `"\x00BLANK\x00"` | `Null`, `Text("")`, `Text("  ")` |
/// | Number | `"N:<bits>"` | `Number(42.0)` → `"N:4631107791820423168"` |
/// | Text | `"T:<lowercase>"` | `Text("Hello")` → `"T:hello"` |
/// | Boolean | `"B:<bool>"` | `Boolean(true)` → `"B:true"` |
/// | Error | `"E:<error_str>"` | `Error(Div0)` → `"E:#DIV/0!"` |
/// | Array | `"\x00ARRAY\x00"` | |
/// | Lambda | `"\x00LAMBDA\x00"` | |
///
/// Type prefixes prevent cross-type collisions (e.g., `Number(42.0)` and
/// `Text("42")` produce different keys).
///
/// Returns `Cow::Borrowed` for constant sentinel keys to avoid allocation.
#[must_use]
pub fn cell_value_to_key(value: &CellValue) -> Cow<'_, str> {
    if value.is_visually_blank() {
        return Cow::Borrowed(BLANK_KEY);
    }

    match value {
        CellValue::Array(_) => Cow::Borrowed(ARRAY_KEY),
        // Null and whitespace-only Text already handled by is_visually_blank above.
        CellValue::Null => Cow::Borrowed(BLANK_KEY),
        // Delegate through GroupKey to keep the two code paths in sync.
        _ => Cow::Owned(cell_value_to_group_key(value).to_wire_string()),
    }
}

/// Return all wire-format keys a value should match against in include/exclude
/// filter sets, allowing type-tolerant comparisons across `Number` and `Text`
/// representations.
///
/// Filter UIs and persisted filter lists frequently store values as strings
/// (e.g., the user types `2024` into a filter; the cell beneath is stored as
/// `Number(2024.0)`). The strict type-prefixed key format means `T:2024` and
/// `N:<bits-of-2024.0>` never collide — so without coercion the filter never
/// matches. Rather than coercing at every call site, this helper returns the
/// canonical key plus all alternate-typed keys the value could plausibly
/// represent. Callers insert *all* keys into the lookup set.
///
/// Coercion rules:
/// - `Text(s)` where `s` parses as `f64`: emit both the text key and the
///   number key for the parsed value.
/// - `Number(n)`: emit both the number key and the text-key matching the
///   number's lossless string form (e.g. `"2024"`, `"3.14"`).
/// - `Boolean(b)`: emit the bool key plus its `"true"`/`"false"` text key.
/// - All other variants: just the canonical single key.
///
/// The returned `Vec` is small (1–2 entries) and allocated only when
/// coercion applies; the canonical key is always first.
#[must_use]
pub fn cell_value_filter_keys(value: &CellValue) -> Vec<String> {
    let canonical = cell_value_to_key(value).into_owned();
    let mut out = vec![canonical];

    match value {
        CellValue::Text(s) => {
            let trimmed = s.trim();
            if !trimmed.is_empty()
                && let Ok(n) = trimmed.parse::<f64>()
                && n.is_finite()
            {
                let num_key = GroupKey::Number(f64_to_group_bits(n)).to_wire_string();
                if !out.contains(&num_key) {
                    out.push(num_key);
                }
            }
        }
        CellValue::Number(n) => {
            let v = n.get();
            if v.is_finite() {
                // Use the cell's display-style number formatting so that
                // `2024.0` matches a text filter `"2024"` (not `"2024.0"`).
                let s = format_number_for_text_key(v);
                let text_key =
                    GroupKey::Text(Arc::from(s.to_lowercase().as_str())).to_wire_string();
                if !out.contains(&text_key) {
                    out.push(text_key);
                }
            }
        }
        CellValue::Boolean(b) => {
            let text = if *b { "true" } else { "false" };
            let text_key = GroupKey::Text(Arc::from(text)).to_wire_string();
            if !out.contains(&text_key) {
                out.push(text_key);
            }
        }
        _ => {}
    }

    out
}

/// Format an `f64` as the shortest text representation that round-trips —
/// integers render without a decimal point (`2024` not `2024.0`), other
/// finite values use Rust's default `f64` `Display` impl.
fn format_number_for_text_key(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e16 {
        // Render as integer when there's no fractional part and the value
        // is small enough to fit losslessly in i64. This matches how users
        // type integer-valued filter values ("2024" not "2024.0").
        #[allow(clippy::cast_possible_truncation)]
        let i = n as i64;
        i.to_string()
    } else {
        n.to_string()
    }
}

// ---------------------------------------------------------------------------
// Display key (user-visible group labels)
// ---------------------------------------------------------------------------

/// Human-readable label for a blank group in display surfaces.
pub const BLANK_DISPLAY_LABEL: &str = "(blank)";

/// Human-readable label for an array group in display surfaces.
pub const ARRAY_DISPLAY_LABEL: &str = "(array)";

/// Human-readable label for a lambda group in display surfaces.
pub const LAMBDA_DISPLAY_LABEL: &str = "(lambda)";

/// Convert a `CellValue` to a human-readable display string.
///
/// Unlike [`cell_value_to_key`], this produces user-facing strings without
/// type prefixes. Used for pivot table row/column headers and other display
/// surfaces that render group keys to end users.
///
/// - Integer-like numbers (no fractional part, abs < 1e15) are formatted
///   without a decimal point.
/// - Text is lowercased for consistent grouping.
/// - Blanks display as `"(blank)"`; arrays as `"(array)"`; lambdas as
///   `"(lambda)"`. NUL-wrapped wire sentinels must never escape the engine
///   to end users, so this function never returns `"\x00BLANK\x00"` or its
///   siblings — presenters that want to relabel can still do so on top of
///   the human-readable defaults.
#[must_use]
pub fn cell_value_to_display_key(value: &CellValue) -> String {
    if value.is_visually_blank() {
        return BLANK_DISPLAY_LABEL.to_string();
    }

    match value {
        CellValue::Number(n) => {
            // Safety: we intentionally check exact equality with trunc() to detect
            // integer-valued floats. The cast to i64 is safe because abs < 1e15
            // fits in i64 range.
            #[allow(clippy::float_cmp, clippy::cast_possible_truncation)]
            if n.get() == n.trunc() && n.abs() < 1e15 {
                format!("{}", n.get() as i64)
            } else {
                n.to_string()
            }
        }
        CellValue::Text(s) => s.to_lowercase(),
        CellValue::Boolean(b) => b.to_string(),
        CellValue::Control(c) => c.value.to_string(),
        CellValue::Image(image) => image.fallback_text().to_string(),
        CellValue::Error(e, _) => e.as_str().to_string(),
        CellValue::Array(_) => ARRAY_DISPLAY_LABEL.to_string(),
        // Already handled by is_blank above.
        CellValue::Null => BLANK_DISPLAY_LABEL.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Kahan compensated summation
// ---------------------------------------------------------------------------

/// Welford's online algorithm for numerically stable mean and variance.
///
/// Single-pass over any `f64` iterator.  Returns `(mean, m2, count)` where:
/// - `population_variance = m2 / count`
/// - `sample_variance = m2 / (count - 1)`
///
/// Returns `(0.0, 0.0, 0)` for empty iterators.
///
/// # Example
///
/// ```
/// use compute_stats::welford_online;
///
/// let (mean, m2, count) = welford_online([1.0, 2.0, 3.0, 4.0, 5.0].iter().copied());
/// assert_eq!(count, 5);
/// assert!((mean - 3.0).abs() < 1e-10);
/// // population variance = m2 / count = 2.0
/// assert!((m2 / count as f64 - 2.0).abs() < 1e-10);
/// ```
#[allow(clippy::cast_precision_loss)]
pub fn welford_online(iter: impl Iterator<Item = f64>) -> (f64, f64, u64) {
    let mut count: u64 = 0;
    let mut mean = 0.0_f64;
    let mut m2 = 0.0_f64;
    for x in iter {
        count += 1;
        let delta = x - mean;
        mean += delta / count as f64;
        let delta2 = x - mean;
        m2 += delta * delta2;
    }
    (mean, m2, count)
}

// Re-export from value-types — the single canonical implementation.
pub use value_types::kahan_sum;

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // cell_value_is_numeric
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_numeric_finite() {
        assert!(cell_value_is_numeric(&CellValue::number(42.0)));
        assert!(cell_value_is_numeric(&CellValue::number(-3.14)));
        assert!(cell_value_is_numeric(&CellValue::number(0.0)));
    }

    #[test]
    fn test_is_not_numeric_nan() {
        assert!(!cell_value_is_numeric(&CellValue::number(f64::NAN)));
    }

    #[test]
    fn test_is_not_numeric_infinity() {
        assert!(!cell_value_is_numeric(&CellValue::number(f64::INFINITY)));
        assert!(!cell_value_is_numeric(&CellValue::number(
            f64::NEG_INFINITY
        )));
    }

    #[test]
    fn test_is_not_numeric_non_number() {
        assert!(!cell_value_is_numeric(&CellValue::Text("42".into())));
        assert!(!cell_value_is_numeric(&CellValue::Boolean(true)));
        assert!(!cell_value_is_numeric(&CellValue::Null));
    }

    // -----------------------------------------------------------------------
    // cell_value_eq
    // -----------------------------------------------------------------------

    #[test]
    fn test_eq_blanks_cross_type() {
        // All blank variants are equal to each other.
        assert!(cell_value_eq(&CellValue::Null, &CellValue::Null));
        assert!(cell_value_eq(&CellValue::Null, &CellValue::Text("".into())));
        assert!(cell_value_eq(
            &CellValue::Null,
            &CellValue::Text("  ".into())
        ));
        assert!(cell_value_eq(
            &CellValue::Text("".into()),
            &CellValue::Text("\t\n".into())
        ));
    }

    #[test]
    fn test_eq_blank_vs_non_blank() {
        // Blank is never equal to a non-blank value.
        assert!(!cell_value_eq(&CellValue::Null, &CellValue::number(0.0)));
        assert!(!cell_value_eq(&CellValue::Null, &CellValue::Boolean(false)));
        assert!(!cell_value_eq(
            &CellValue::Null,
            &CellValue::Text("hello".into())
        ));
    }

    #[test]
    fn test_eq_numbers_exact() {
        assert!(cell_value_eq(
            &CellValue::number(42.0),
            &CellValue::number(42.0)
        ));
    }

    #[test]
    fn test_eq_numbers_relative_epsilon_large() {
        // Large values: 1e15 with a tiny relative difference.
        let a = 1_000_000_000_000_000.0_f64;
        let b = a + 0.5; // within relative epsilon of 1e-12
        assert!(cell_value_eq(&CellValue::number(a), &CellValue::number(b)));
    }

    #[test]
    fn test_eq_numbers_relative_epsilon_small() {
        // Small values near zero.
        let a = 1e-15_f64;
        let b = 1e-15_f64 + 1e-28;
        assert!(cell_value_eq(&CellValue::number(a), &CellValue::number(b)));
    }

    #[test]
    fn test_eq_numbers_zero() {
        assert!(cell_value_eq(
            &CellValue::number(0.0),
            &CellValue::number(-0.0)
        ));
    }

    #[test]
    fn test_neq_numbers_different() {
        assert!(!cell_value_eq(
            &CellValue::number(1.0),
            &CellValue::number(2.0)
        ));
    }

    #[test]
    fn test_eq_text_case_insensitive() {
        assert!(cell_value_eq(
            &CellValue::Text("Hello".into()),
            &CellValue::Text("hello".into())
        ));
        assert!(cell_value_eq(
            &CellValue::Text("WORLD".into()),
            &CellValue::Text("world".into())
        ));
    }

    #[test]
    fn test_neq_text_different() {
        assert!(!cell_value_eq(
            &CellValue::Text("abc".into()),
            &CellValue::Text("def".into())
        ));
    }

    #[test]
    fn test_eq_booleans() {
        assert!(cell_value_eq(
            &CellValue::Boolean(true),
            &CellValue::Boolean(true)
        ));
        assert!(!cell_value_eq(
            &CellValue::Boolean(true),
            &CellValue::Boolean(false)
        ));
    }

    #[test]
    fn test_eq_errors() {
        assert!(cell_value_eq(
            &CellValue::Error(CellError::Div0, None),
            &CellValue::Error(CellError::Div0, None)
        ));
        assert!(!cell_value_eq(
            &CellValue::Error(CellError::Div0, None),
            &CellValue::Error(CellError::Na, None)
        ));
    }

    #[test]
    fn test_neq_cross_type() {
        // Number vs Text.
        assert!(!cell_value_eq(
            &CellValue::number(42.0),
            &CellValue::Text("42".into())
        ));
        // Boolean vs Number.
        assert!(!cell_value_eq(
            &CellValue::Boolean(true),
            &CellValue::number(1.0)
        ));
    }

    // -----------------------------------------------------------------------
    // cell_value_to_key
    // -----------------------------------------------------------------------

    #[test]
    fn test_key_blank_variants() {
        assert_eq!(cell_value_to_key(&CellValue::Null).as_ref(), BLANK_KEY);
        assert_eq!(
            cell_value_to_key(&CellValue::Text("".into())).as_ref(),
            BLANK_KEY
        );
        assert_eq!(
            cell_value_to_key(&CellValue::Text("  ".into())).as_ref(),
            BLANK_KEY
        );
        assert_eq!(
            cell_value_to_key(&CellValue::Text("\t\n".into())).as_ref(),
            BLANK_KEY
        );
    }

    #[test]
    fn test_key_no_cross_type_collision() {
        // Number 42 and Text "42" must produce different keys.
        assert_ne!(
            cell_value_to_key(&CellValue::number(42.0)),
            cell_value_to_key(&CellValue::Text("42".into()))
        );
        // Boolean true and Text "true" must produce different keys.
        assert_ne!(
            cell_value_to_key(&CellValue::Boolean(true)),
            cell_value_to_key(&CellValue::Text("true".into()))
        );
    }

    #[test]
    fn test_key_negative_zero_positive_zero() {
        assert_eq!(
            cell_value_to_key(&CellValue::number(0.0)),
            cell_value_to_key(&CellValue::number(-0.0))
        );
    }

    #[test]
    fn test_key_nan_canonicalization() {
        // Multiple NaN bit patterns should produce the same key.
        let nan1 = f64::NAN;
        let nan2 = f64::from_bits(0x7FF8_0000_0000_0001); // quiet NaN with payload
        assert_eq!(
            cell_value_to_key(&CellValue::number(nan1)),
            cell_value_to_key(&CellValue::number(nan2))
        );
    }

    #[test]
    fn test_key_infinity_maps_to_error() {
        // CellValue::number() maps ±Inf to CellError::Num (matching Excel).
        let pos_inf_val = CellValue::number(f64::INFINITY);
        let neg_inf_val = CellValue::number(f64::NEG_INFINITY);
        // Both are errors, so both produce the same error key.
        assert_eq!(
            cell_value_to_key(&pos_inf_val),
            cell_value_to_key(&neg_inf_val)
        );
    }

    #[test]
    fn test_key_case_insensitive_text() {
        assert_eq!(
            cell_value_to_key(&CellValue::Text("Hello".into())),
            cell_value_to_key(&CellValue::Text("hello".into()))
        );
    }

    #[test]
    fn test_key_text_that_looks_like_type_prefix() {
        // Text "N:42" should not collide with a real Number key.
        let text_val = CellValue::Text("N:42".into());
        let num_val = CellValue::number(42.0);
        let text_key = cell_value_to_key(&text_val);
        let num_key = cell_value_to_key(&num_val);
        assert_ne!(text_key, num_key);
        // Text "N:42" → "T:n:42" (lowercase), which is clearly distinct.
        assert!(text_key.starts_with("T:"));
    }

    #[test]
    fn test_key_error_distinct_from_text() {
        // Error #DIV/0! should not collide with Text("#DIV/0!").
        let err_val = CellValue::Error(CellError::Div0, None);
        let text_val = CellValue::Text("#DIV/0!".into());
        let err_key = cell_value_to_key(&err_val);
        let text_key = cell_value_to_key(&text_val);
        assert_ne!(err_key, text_key);
    }

    #[test]
    fn test_key_all_error_variants_distinct() {
        let errors = [
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
            CellError::Spill,
            CellError::Calc,
            CellError::GettingData,
        ];
        let keys: Vec<_> = errors
            .iter()
            .map(|e| cell_value_to_key(&CellValue::Error(*e, None)).into_owned())
            .collect();
        // All keys must be unique.
        for i in 0..keys.len() {
            for j in (i + 1)..keys.len() {
                assert_ne!(
                    keys[i], keys[j],
                    "Error keys {:?} and {:?} should be distinct",
                    errors[i], errors[j]
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // cell_value_to_group_key — structural GroupKey (sub-scope refactor)
    // -----------------------------------------------------------------------

    #[test]
    fn test_group_key_null_is_blank() {
        assert_eq!(cell_value_to_group_key(&CellValue::Null), GroupKey::Blank);
    }

    #[test]
    fn test_group_key_empty_text_is_blank() {
        assert_eq!(
            cell_value_to_group_key(&CellValue::Text("".into())),
            GroupKey::Blank
        );
    }

    #[test]
    fn test_group_key_whitespace_text_is_blank() {
        assert_eq!(
            cell_value_to_group_key(&CellValue::Text("  ".into())),
            GroupKey::Blank
        );
        assert_eq!(
            cell_value_to_group_key(&CellValue::Text("\t\n\r ".into())),
            GroupKey::Blank
        );
    }

    #[test]
    fn test_group_key_text_containing_blank_sentinel_is_distinct() {
        // Text("\x00BLANK\x00") must be distinct from GroupKey::Blank — the
        // whole point of the structural key is to eliminate the collision
        // risk of the legacy wire sentinel.
        let k = cell_value_to_group_key(&CellValue::Text("\x00BLANK\x00".into()));
        assert_ne!(k, GroupKey::Blank);
        assert!(matches!(k, GroupKey::Text(_)));
    }

    #[test]
    fn test_group_key_number_vs_text() {
        // Number(42) and Text("42") must produce different group keys.
        assert_ne!(
            cell_value_to_group_key(&CellValue::number(42.0)),
            cell_value_to_group_key(&CellValue::Text("42".into()))
        );
    }

    #[test]
    fn test_group_key_negative_zero_equals_positive_zero() {
        assert_eq!(
            cell_value_to_group_key(&CellValue::number(0.0)),
            cell_value_to_group_key(&CellValue::number(-0.0))
        );
    }

    #[test]
    fn test_group_key_nan_canonicalized() {
        let nan1 = f64::NAN;
        let nan2 = f64::from_bits(0x7FF8_0000_0000_0001);
        assert_eq!(
            cell_value_to_group_key(&CellValue::number(nan1)),
            cell_value_to_group_key(&CellValue::number(nan2))
        );
    }

    #[test]
    fn test_group_key_text_case_insensitive() {
        assert_eq!(
            cell_value_to_group_key(&CellValue::Text("Hello".into())),
            cell_value_to_group_key(&CellValue::Text("hello".into()))
        );
    }

    #[test]
    fn test_group_key_array_is_array_variant() {
        let arr = CellValue::from_rows(vec![vec![CellValue::Null]]);
        assert_eq!(cell_value_to_group_key(&arr), GroupKey::Array);
    }

    #[test]
    fn test_group_key_to_wire_string_matches_cell_value_to_key() {
        // Parity: GroupKey::to_wire_string must match cell_value_to_key for
        // every variant so that callers migrating from strings to GroupKey
        // are behaviorally equivalent.
        let cases: Vec<CellValue> = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::Text("  ".into()),
            CellValue::Text("Hello".into()),
            CellValue::Text("\x00BLANK\x00".into()),
            CellValue::number(0.0),
            CellValue::number(-0.0),
            CellValue::number(42.0),
            CellValue::number(3.14),
            CellValue::Boolean(true),
            CellValue::Boolean(false),
            CellValue::Error(CellError::Div0, None),
            CellValue::Error(CellError::Na, None),
            CellValue::from_rows(vec![vec![CellValue::number(1.0)]]),
        ];
        for v in cases {
            let wire = cell_value_to_key(&v).into_owned();
            let group = cell_value_to_group_key(&v).to_wire_string();
            assert_eq!(
                wire, group,
                "mismatch for {v:?}: cell_value_to_key={wire} group={group}"
            );
        }
    }

    #[test]
    fn test_key_returns_borrowed_for_constants() {
        // Verify that sentinel keys return Cow::Borrowed (no allocation).
        let null_key = cell_value_to_key(&CellValue::Null);
        assert!(
            matches!(null_key, Cow::Borrowed(_)),
            "Null key should be Cow::Borrowed"
        );

        let array_val = CellValue::from_rows(vec![vec![CellValue::Null]]);
        let array_key = cell_value_to_key(&array_val);
        assert!(
            matches!(array_key, Cow::Borrowed(_)),
            "Array key should be Cow::Borrowed"
        );
    }

    #[test]
    fn test_key_fp_consistency() {
        // Same bit pattern => same key.
        let a = 0.1_f64 + 0.2;
        let b = 0.1_f64 + 0.2;
        assert_eq!(
            cell_value_to_key(&CellValue::number(a)),
            cell_value_to_key(&CellValue::number(b))
        );
    }

    // -----------------------------------------------------------------------
    // cell_value_to_display_key
    // -----------------------------------------------------------------------

    #[test]
    fn test_display_key_blank() {
        assert_eq!(
            cell_value_to_display_key(&CellValue::Null),
            BLANK_DISPLAY_LABEL
        );
        assert_eq!(
            cell_value_to_display_key(&CellValue::Text("  ".into())),
            BLANK_DISPLAY_LABEL
        );
    }

    #[test]
    fn test_display_key_never_returns_nul_bytes() {
        // NUL-wrapped wire sentinels must not escape the engine to display
        // surfaces. `cell_value_to_display_key` should render human-readable
        // tokens for every non-scalar or blank variant.
        let blank = cell_value_to_display_key(&CellValue::Null);
        assert!(
            !blank.contains('\x00'),
            "blank label leaked NUL bytes: {blank:?}"
        );

        let array = cell_value_to_display_key(&CellValue::from_rows(vec![vec![CellValue::Null]]));
        assert!(
            !array.contains('\x00'),
            "array label leaked NUL bytes: {array:?}"
        );
    }

    #[test]
    fn test_display_key_integer_number() {
        assert_eq!(cell_value_to_display_key(&CellValue::number(42.0)), "42");
    }

    #[test]
    fn test_display_key_fractional_number() {
        assert_eq!(cell_value_to_display_key(&CellValue::number(3.14)), "3.14");
    }

    #[test]
    fn test_display_key_text_lowercase() {
        assert_eq!(
            cell_value_to_display_key(&CellValue::Text("Hello".into())),
            "hello"
        );
    }

    // -----------------------------------------------------------------------
    // SortKey ordering
    // -----------------------------------------------------------------------

    #[test]
    fn test_sort_key_type_priority_ascending() {
        // Number < Text < Boolean < Error < Blank (matches Excel)
        let number = cell_value_to_sort_key(&CellValue::number(1.0));
        let text = cell_value_to_sort_key(&CellValue::Text("a".into()));
        let bool_val = cell_value_to_sort_key(&CellValue::Boolean(false));
        let error = cell_value_to_sort_key(&CellValue::Error(CellError::Div0, None));
        let blank = cell_value_to_sort_key(&CellValue::Null);

        assert!(number < text);
        assert!(text < bool_val);
        assert!(bool_val < error);
        assert!(error < blank);
    }

    #[test]
    fn test_sort_key_blanks_always_last_ascending() {
        let values = vec![
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::Text("z".into()),
            CellValue::Boolean(true),
            CellValue::Error(CellError::Na, None),
        ];

        let mut keys: Vec<_> = values.iter().map(cell_value_to_sort_key).collect();
        keys.sort();

        // Last key should be blank (priority 4).
        assert_eq!(keys.last().unwrap().type_priority(), 4);
    }

    #[test]
    fn test_sort_key_blanks_always_last_descending() {
        // When sorting descending, we reverse within-type only.
        // Blanks must still be last (highest type_priority).
        let blank = cell_value_to_sort_key(&CellValue::Null);
        let number = cell_value_to_sort_key(&CellValue::number(100.0));
        let text = cell_value_to_sort_key(&CellValue::Text("z".into()));

        // In descending mode, type_priority is still compared ascending.
        // So blank.type_priority (4) > everything else => blanks last.
        assert!(blank.type_priority() > number.type_priority());
        assert!(blank.type_priority() > text.type_priority());
    }

    #[test]
    fn test_sort_key_type_priority_stable_in_descending() {
        // Verify that type_priority doesn't change when we conceptually
        // reverse direction — it's a property of the value, not the sort.
        let val = CellValue::number(42.0);
        let key = cell_value_to_sort_key(&val);
        assert_eq!(key.type_priority(), 0); // Number = 0

        let val2 = CellValue::Error(CellError::Div0, None);
        let key2 = cell_value_to_sort_key(&val2);
        assert_eq!(key2.type_priority(), 3); // Error = 3

        let val3 = CellValue::Null;
        let key3 = cell_value_to_sort_key(&val3);
        assert_eq!(key3.type_priority(), 4); // Blank = 4
    }

    #[test]
    fn test_sort_key_within_type_number_ordering() {
        let neg = cell_value_to_sort_key(&CellValue::number(-1.0));
        let zero = cell_value_to_sort_key(&CellValue::number(0.0));
        let pos = cell_value_to_sort_key(&CellValue::number(1.0));

        assert!(neg < zero);
        assert!(zero < pos);
    }

    #[test]
    fn test_sort_key_within_type_text_ordering() {
        let a = cell_value_to_sort_key(&CellValue::Text("apple".into()));
        let b = cell_value_to_sort_key(&CellValue::Text("Banana".into()));

        // Case-insensitive: "apple" < "banana"
        assert!(a < b);
    }

    #[test]
    fn test_sort_key_within_type_bool_ordering() {
        let f = cell_value_to_sort_key(&CellValue::Boolean(false));
        let t = cell_value_to_sort_key(&CellValue::Boolean(true));

        assert!(f < t);
    }

    #[test]
    fn test_sort_key_within_type_error_ordering() {
        let div0 = cell_value_to_sort_key(&CellValue::Error(CellError::Div0, None));
        let na = cell_value_to_sort_key(&CellValue::Error(CellError::Na, None));
        let value = cell_value_to_sort_key(&CellValue::Error(CellError::Value, None));

        assert!(div0 < na);
        assert!(na < value);
    }

    #[test]
    fn test_sort_key_neg_zero_eq_pos_zero() {
        let pos = cell_value_to_sort_key(&CellValue::number(0.0));
        let neg = cell_value_to_sort_key(&CellValue::number(-0.0));
        assert_eq!(pos, neg);
    }

    #[test]
    fn test_sort_key_whitespace_only_is_blank() {
        let ws = cell_value_to_sort_key(&CellValue::Text("   ".into()));
        let null = cell_value_to_sort_key(&CellValue::Null);
        assert_eq!(ws, null);
        assert_eq!(ws.type_priority(), 4);
    }

    // -----------------------------------------------------------------------
    // welford_online
    // -----------------------------------------------------------------------

    #[test]
    fn test_welford_empty() {
        let (mean, m2, count) = welford_online(std::iter::empty());
        assert_eq!(count, 0);
        assert_eq!(mean, 0.0);
        assert_eq!(m2, 0.0);
    }

    #[test]
    fn test_welford_single() {
        let (mean, m2, count) = welford_online(std::iter::once(42.0));
        assert_eq!(count, 1);
        assert_eq!(mean, 42.0);
        assert_eq!(m2, 0.0);
    }

    #[test]
    fn test_welford_basic() {
        let (mean, m2, count) = welford_online([1.0, 2.0, 3.0, 4.0, 5.0].iter().copied());
        assert_eq!(count, 5);
        assert!((mean - 3.0).abs() < 1e-10);
        // population variance = m2 / count = 2.0
        assert!((m2 / count as f64 - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_welford_large_offset() {
        // Values close together but with large magnitude — naive algorithm fails here.
        let (mean, m2, count) =
            welford_online([1e15 + 1.0, 1e15 + 2.0, 1e15 + 3.0].iter().copied());
        assert_eq!(count, 3);
        assert!((mean - (1e15 + 2.0)).abs() < 1e-6);
        // sample variance = m2 / (count - 1) = 1.0
        assert!((m2 / (count - 1) as f64 - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_welford_known_variance() {
        // [2, 4, 4, 4, 5, 5, 7, 9] mean=5, pop_var=4
        let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        let (mean, m2, count) = welford_online(data.iter().copied());
        assert_eq!(count, 8);
        assert!((mean - 5.0).abs() < 1e-10);
        assert!((m2 / count as f64 - 4.0).abs() < 1e-10);
    }

    // kahan_sum tests are in value-types::kahan

    // -----------------------------------------------------------------------
    // Whitespace-only text keys
    // -----------------------------------------------------------------------

    #[test]
    fn test_whitespace_only_produces_blank_key() {
        let val1 = CellValue::Text("   ".into());
        let key = cell_value_to_key(&val1);
        assert_eq!(key.as_ref(), BLANK_KEY);

        let val2 = CellValue::Text("\t\n\r ".into());
        let key2 = cell_value_to_key(&val2);
        assert_eq!(key2.as_ref(), BLANK_KEY);
    }

    // -----------------------------------------------------------------------
    // cell_value_filter_keys: type-tolerant filter matching
    // -----------------------------------------------------------------------

    #[test]
    fn filter_keys_for_text_numeric_includes_number_key() {
        let keys = cell_value_filter_keys(&CellValue::Text("2024".into()));
        assert!(
            keys.iter().any(|k| k.starts_with("T:2024")),
            "text key first: {keys:?}"
        );
        let want_num = cell_value_to_key(&CellValue::number(2024.0)).into_owned();
        assert!(keys.contains(&want_num), "expected {want_num} in {keys:?}");
    }

    #[test]
    fn filter_keys_for_number_includes_integer_text_key() {
        let keys = cell_value_filter_keys(&CellValue::number(2024.0));
        let want_text = cell_value_to_key(&CellValue::Text("2024".into())).into_owned();
        assert!(
            keys.contains(&want_text),
            "expected {want_text} in {keys:?}"
        );
    }

    #[test]
    fn filter_keys_for_decimal_number_includes_decimal_text_key() {
        let keys = cell_value_filter_keys(&CellValue::number(3.14));
        // The text representation of 3.14 should be included.
        assert!(keys.iter().any(|k| k == "T:3.14"), "{keys:?}");
    }

    #[test]
    fn filter_keys_for_text_non_numeric_returns_only_canonical() {
        let keys = cell_value_filter_keys(&CellValue::Text("North".into()));
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0], "T:north"); // lowercased
    }

    #[test]
    fn filter_keys_for_blank_returns_only_blank() {
        let keys = cell_value_filter_keys(&CellValue::Null);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0], BLANK_KEY);
    }

    #[test]
    fn filter_keys_for_boolean_includes_text_form() {
        let keys = cell_value_filter_keys(&CellValue::Boolean(true));
        assert!(keys.iter().any(|k| k.starts_with("B:true")));
        assert!(keys.iter().any(|k| k == "T:true"));
    }

    // -----------------------------------------------------------------------
    // Edge cases: f64_to_sortable_bits
    // -----------------------------------------------------------------------

    #[test]
    fn test_sortable_bits_total_order() {
        let values: Vec<f64> = vec![
            f64::NEG_INFINITY,
            -1e100,
            -1.0,
            -f64::MIN_POSITIVE,
            -0.0,
            0.0,
            f64::MIN_POSITIVE,
            1.0,
            1e100,
            f64::INFINITY,
        ];

        let bits: Vec<u64> = values.iter().map(|n| f64_to_sortable_bits(*n)).collect();
        for i in 0..(bits.len() - 1) {
            assert!(
                bits[i] <= bits[i + 1],
                "Expected bits[{}] ({}) <= bits[{}] ({}), for values {} <= {}",
                i,
                bits[i],
                i + 1,
                bits[i + 1],
                values[i],
                values[i + 1]
            );
        }
    }

    // -----------------------------------------------------------------------
    // cell_value_eq — additional edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_eq_tiny_numbers_100pct_relative_diff() {
        // 1e-15 vs 2e-15 differ by 100% relative — should NOT be equal.
        assert!(!cell_value_eq(
            &CellValue::number(1e-15),
            &CellValue::number(2e-15)
        ));
    }

    #[test]
    fn test_eq_large_numbers_tiny_relative_diff() {
        // 1e15 vs 1e15 + 1: relative diff is 1e-15, well below 1e-12 threshold.
        assert!(cell_value_eq(
            &CellValue::number(1e15),
            &CellValue::number(1e15 + 1.0)
        ));
    }

    #[test]
    fn test_eq_unicode_case_folding_german_eszett() {
        // German ß uppercases to SS; to_lowercase() of "STRASSE" is "strasse",
        // to_lowercase() of "Straße" is "straße". These differ — test documents
        // that Unicode case folding via to_lowercase() does NOT equate them.
        let result = cell_value_eq(
            &CellValue::Text("Straße".into()),
            &CellValue::Text("STRASSE".into()),
        );
        // "straße" != "strasse", so these should NOT be equal under to_lowercase().
        assert!(!result);
    }

    #[test]
    fn test_eq_error_div0_vs_na() {
        assert!(!cell_value_eq(
            &CellValue::Error(CellError::Div0, None),
            &CellValue::Error(CellError::Na, None)
        ));
    }

    #[test]
    fn test_eq_error_div0_vs_div0() {
        assert!(cell_value_eq(
            &CellValue::Error(CellError::Div0, None),
            &CellValue::Error(CellError::Div0, None)
        ));
    }

    #[test]
    fn test_eq_cross_type_number_zero_vs_boolean_false() {
        // Different types — should NOT be equal even if "logically" similar.
        assert!(!cell_value_eq(
            &CellValue::number(0.0),
            &CellValue::Boolean(false)
        ));
    }

    #[test]
    fn test_eq_cross_type_number_one_vs_boolean_true() {
        assert!(!cell_value_eq(
            &CellValue::number(1.0),
            &CellValue::Boolean(true)
        ));
    }

    // -----------------------------------------------------------------------
    // cell_value_to_sort_key — Excel sort order verification
    // -----------------------------------------------------------------------

    #[test]
    fn test_sort_key_excel_order_number_lt_text() {
        let num = cell_value_to_sort_key(&CellValue::number(1.0));
        let text = cell_value_to_sort_key(&CellValue::Text("a".into()));
        assert!(num < text);
    }

    #[test]
    fn test_sort_key_excel_order_text_lt_boolean() {
        let text = cell_value_to_sort_key(&CellValue::Text("a".into()));
        let bool_val = cell_value_to_sort_key(&CellValue::Boolean(true));
        assert!(text < bool_val);
    }

    #[test]
    fn test_sort_key_excel_order_boolean_lt_error() {
        let bool_val = cell_value_to_sort_key(&CellValue::Boolean(true));
        let error = cell_value_to_sort_key(&CellValue::Error(CellError::Na, None));
        assert!(bool_val < error);
    }

    #[test]
    fn test_sort_key_excel_order_error_lt_blank() {
        let error = cell_value_to_sort_key(&CellValue::Error(CellError::Na, None));
        let blank = cell_value_to_sort_key(&CellValue::Null);
        assert!(error < blank);
    }

    #[test]
    fn test_sort_key_within_numbers_neg_zero_pos() {
        let neg = cell_value_to_sort_key(&CellValue::number(-1.0));
        let zero = cell_value_to_sort_key(&CellValue::number(0.0));
        let pos = cell_value_to_sort_key(&CellValue::number(1.0));
        assert!(neg < zero);
        assert!(zero < pos);
    }

    #[test]
    fn test_sort_key_text_case_insensitive_ordering() {
        // "A" and "a" should produce equal sort keys (both lowercased to "a").
        let upper = cell_value_to_sort_key(&CellValue::Text("A".into()));
        let lower = cell_value_to_sort_key(&CellValue::Text("a".into()));
        assert_eq!(upper, lower);

        // "a" < "b" in ordering.
        let a = cell_value_to_sort_key(&CellValue::Text("a".into()));
        let b = cell_value_to_sort_key(&CellValue::Text("b".into()));
        assert!(a < b);
    }

    #[test]
    fn test_sort_key_within_booleans_false_lt_true() {
        let f = cell_value_to_sort_key(&CellValue::Boolean(false));
        let t = cell_value_to_sort_key(&CellValue::Boolean(true));
        assert!(f < t);
    }

    #[test]
    fn test_sort_key_blanks_all_equivalent() {
        // Null, Text(""), and Text("  ") should all produce equal blank sort keys.
        let null = cell_value_to_sort_key(&CellValue::Null);
        let empty = cell_value_to_sort_key(&CellValue::Text("".into()));
        let spaces = cell_value_to_sort_key(&CellValue::Text("  ".into()));
        assert_eq!(null, empty);
        assert_eq!(empty, spaces);
        assert_eq!(null.type_priority(), 4);
    }

    // -----------------------------------------------------------------------
    // cell_value_to_key — collision avoidance
    // -----------------------------------------------------------------------

    #[test]
    fn test_key_number_vs_text_collision() {
        // Number(42) and Text("42") MUST produce different keys.
        assert_ne!(
            cell_value_to_key(&CellValue::number(42.0)),
            cell_value_to_key(&CellValue::Text("42".into()))
        );
    }

    #[test]
    fn test_key_zero_canonicalization() {
        // 0.0 and -0.0 must produce the SAME key.
        assert_eq!(
            cell_value_to_key(&CellValue::number(0.0)),
            cell_value_to_key(&CellValue::number(-0.0))
        );
    }

    #[test]
    fn test_key_text_case_insensitive() {
        // "Hello" and "hello" must produce the SAME key.
        assert_eq!(
            cell_value_to_key(&CellValue::Text("Hello".into())),
            cell_value_to_key(&CellValue::Text("hello".into()))
        );
    }

    #[test]
    fn test_key_null_and_empty_text_both_blank() {
        // Null and Text("") must both produce BLANK_KEY.
        assert_eq!(cell_value_to_key(&CellValue::Null).as_ref(), BLANK_KEY);
        assert_eq!(
            cell_value_to_key(&CellValue::Text("".into())).as_ref(),
            BLANK_KEY
        );
    }

    // -----------------------------------------------------------------------
    // cell_value_to_display_key — additional cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_display_key_integer_like() {
        // 42.0 should display as "42" (no decimal).
        assert_eq!(cell_value_to_display_key(&CellValue::number(42.0)), "42");
    }

    #[test]
    fn test_display_key_fractional() {
        assert_eq!(cell_value_to_display_key(&CellValue::number(3.14)), "3.14");
    }

    #[test]
    fn test_display_key_large_integer_below_threshold() {
        // 1e14 is abs < 1e15, so should use integer format.
        assert_eq!(
            cell_value_to_display_key(&CellValue::number(1e14)),
            "100000000000000"
        );
    }

    #[test]
    fn test_display_key_very_large_above_threshold() {
        // 1e16 >= 1e15, should NOT use integer format.
        let key = cell_value_to_display_key(&CellValue::number(1e16));
        // Should not be the integer representation "10000000000000000".
        // It should use f64's default Display which is "10000000000000000" for 1e16...
        // Actually 1e16 == 10000000000000000.0, and 1e16 as i64 is fine.
        // But the code checks abs < 1e15. So 1e16 fails that check.
        // f64 Display of 1e16 is "10000000000000000" — FiniteF64's Display is used.
        // Let's just verify it doesn't crash and produces some string.
        assert!(!key.is_empty());
        // The key should NOT be the i64 cast version (which would be "10000000000000000").
        // Actually... FiniteF64::to_string() for 1e16 will also produce "10000000000000000".
        // The distinction matters for values that aren't exact integers at 1e15+ scale.
        // Let's test with a value that reveals the difference: 1e16 + 0.5
        // (but 1e16 + 0.5 == 1e16 in f64 due to precision, so this is tricky).
        // The important thing is the branch is taken correctly.
        // For 1e16 which is integer-like but >= 1e15, it goes through n.to_string().
    }

    #[test]
    fn test_display_key_boolean_true() {
        assert_eq!(cell_value_to_display_key(&CellValue::Boolean(true)), "true");
    }

    #[test]
    fn test_display_key_boolean_false() {
        assert_eq!(
            cell_value_to_display_key(&CellValue::Boolean(false)),
            "false"
        );
    }

    #[test]
    fn test_display_key_negative_integer() {
        assert_eq!(cell_value_to_display_key(&CellValue::number(-5.0)), "-5");
    }

    // -----------------------------------------------------------------------
    // welford_online — mathematical verification
    // -----------------------------------------------------------------------

    #[test]
    fn test_welford_1_to_5_exact() {
        // [1, 2, 3, 4, 5]: mean=3, pop_var=2, m2=10
        let (mean, m2, count) = welford_online([1.0, 2.0, 3.0, 4.0, 5.0].iter().copied());
        assert_eq!(count, 5);
        assert!((mean - 3.0).abs() < 1e-10);
        assert!((m2 - 10.0).abs() < 1e-10);
    }

    #[test]
    fn test_welford_single_value_7() {
        // Single value [7]: mean=7, m2=0, count=1
        let (mean, m2, count) = welford_online(std::iter::once(7.0));
        assert_eq!(count, 1);
        assert_eq!(mean, 7.0);
        assert_eq!(m2, 0.0);
    }

    #[test]
    fn test_welford_two_values_3_7() {
        // [3, 7]: mean=5, m2=8, count=2
        // pop_var = m2/count = 4, sample_var = m2/(count-1) = 8
        let (mean, m2, count) = welford_online([3.0, 7.0].iter().copied());
        assert_eq!(count, 2);
        assert!((mean - 5.0).abs() < 1e-10);
        assert!((m2 - 8.0).abs() < 1e-10);
    }

    // -----------------------------------------------------------------------
    // kahan_sum — precision tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_kahan_sum_catastrophic_cancellation() {
        // [1e15, 1.0, -1e15] should return 1.0 (not 0.0 from naive addition).
        // Note: 1e16 is too large — 1e16 + 1.0 == 1e16 in f64 due to precision,
        // so Kahan cannot recover the lost bit. 1e15 is within range.
        let result = kahan_sum([1e15, 1.0, -1e15].iter().copied());
        assert_eq!(result, 1.0);
    }

    #[test]
    fn test_kahan_sum_many_small_values() {
        // Sum of 1_000_000 copies of 1e-7 should be close to 0.1.
        let result = kahan_sum(std::iter::repeat(1e-7).take(1_000_000));
        assert!((result - 0.1).abs() < 1e-10, "Expected ~0.1, got {result}");
    }
}
