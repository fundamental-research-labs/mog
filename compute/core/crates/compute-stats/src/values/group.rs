use std::sync::Arc;

use value_types::CellValue;

/// Wire-format sentinel string for null / blank / whitespace-only values.
///
/// Used only by the wire-format string serialization produced by
/// [`super::cell_value_to_key`] for cross-boundary compatibility with the XLSX
/// parser and persisted filter include/exclude lists. New code inside the
/// engine should use [`GroupKey::Blank`] directly.
pub const BLANK_KEY: &str = "\x00BLANK\x00";

/// Wire-format sentinel string for `CellValue::Array` values.
///
/// Used only by the wire-format string serialization produced by
/// [`super::cell_value_to_key`]. New code inside the engine should use
/// [`GroupKey::Array`] directly.
pub const ARRAY_KEY: &str = "\x00ARRAY\x00";

/// Wire-format sentinel string for `CellValue::Lambda` values.
///
/// Used only by the wire-format string serialization produced by
/// [`super::cell_value_to_key`]. New code inside the engine should use
/// [`GroupKey::Lambda`] directly.
pub const LAMBDA_KEY: &str = "\x00LAMBDA\x00";

/// A structural key for grouping / deduplication of `CellValue` instances.
///
/// Replaces the in-band `"\x00BLANK\x00"` / `"\x00ARRAY\x00"` sentinel strings
/// previously used as `HashMap<String, _>` keys. Semantic intent is carried
/// in the type rather than smuggled through reserved byte patterns.
///
/// # Coalescence rules (matches [`super::cell_value_eq`])
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
/// For human-readable output use [`super::cell_value_to_display_key`], which
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
    let n = if n == 0.0 { 0.0 } else { n };
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
        CellValue::Null => GroupKey::Blank,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use value_types::{CellControl, CellError, CellImage, CellImageSizing, CellValue};

    use super::*;

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
        let k = cell_value_to_group_key(&CellValue::Text("\x00BLANK\x00".into()));
        assert_ne!(k, GroupKey::Blank);
        assert!(matches!(k, GroupKey::Text(_)));
    }

    #[test]
    fn test_group_key_number_vs_text() {
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
        assert_eq!(f64_to_group_bits(nan1), f64_to_group_bits(nan2));
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
    fn test_group_key_control_as_bool() {
        let control = CellValue::Control(CellControl::checkbox(true));
        assert_eq!(cell_value_to_group_key(&control), GroupKey::Bool(true));
    }

    #[test]
    fn test_group_key_image_fallback_text_is_not_lowercased() {
        let image = CellValue::Image(CellImage::new(
            "https://example.test/image.png",
            Some(Arc::from("Alt Text")),
            CellImageSizing::Fit,
            None,
            None,
        ));
        assert_eq!(
            cell_value_to_group_key(&image),
            GroupKey::Text(Arc::from("Alt Text"))
        );
    }

    #[test]
    fn test_group_key_error_ref_and_circ_collide_by_display_string() {
        assert_eq!(
            cell_value_to_group_key(&CellValue::Error(CellError::Ref, None)),
            cell_value_to_group_key(&CellValue::Error(CellError::Circ, None))
        );
    }

    #[test]
    fn test_group_key_to_wire_string_all_variants() {
        assert_eq!(GroupKey::Blank.to_wire_string(), BLANK_KEY);
        assert_eq!(GroupKey::Array.to_wire_string(), ARRAY_KEY);
        assert_eq!(GroupKey::Lambda.to_wire_string(), LAMBDA_KEY);
        assert_eq!(GroupKey::Number(42).to_wire_string(), "N:42");
        assert_eq!(
            GroupKey::Text(Arc::from("hello")).to_wire_string(),
            "T:hello"
        );
        assert_eq!(GroupKey::Bool(true).to_wire_string(), "B:true");
        assert_eq!(
            GroupKey::Error("#DIV/0!".to_string()).to_wire_string(),
            "E:#DIV/0!"
        );
    }
}
