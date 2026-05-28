use value_types::CellValue;

/// Human-readable label for a blank group in display surfaces.
pub const BLANK_DISPLAY_LABEL: &str = "(blank)";

/// Human-readable label for an array group in display surfaces.
pub const ARRAY_DISPLAY_LABEL: &str = "(array)";

/// Human-readable label for a lambda group in display surfaces.
pub const LAMBDA_DISPLAY_LABEL: &str = "(lambda)";

/// Convert a `CellValue` to a human-readable display string.
///
/// Unlike [`super::cell_value_to_key`], this produces user-facing strings
/// without type prefixes. Used for pivot table row/column headers and other
/// display surfaces that render group keys to end users.
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
        CellValue::Number(n) =>
        {
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
        CellValue::Null => BLANK_DISPLAY_LABEL.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use value_types::{CellControl, CellError, CellImage, CellImageSizing, CellValue};

    use super::*;

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
        let blank = cell_value_to_display_key(&CellValue::Null);
        assert!(!blank.contains('\x00'));

        let array = cell_value_to_display_key(&CellValue::from_rows(vec![vec![CellValue::Null]]));
        assert!(!array.contains('\x00'));

        assert!(!LAMBDA_DISPLAY_LABEL.contains('\x00'));
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
    fn test_display_key_large_integer_below_threshold() {
        assert_eq!(
            cell_value_to_display_key(&CellValue::number(1e14)),
            "100000000000000"
        );
    }

    #[test]
    fn test_display_key_very_large_above_threshold() {
        let key = cell_value_to_display_key(&CellValue::number(1e16));
        assert!(!key.is_empty());
    }

    #[test]
    fn test_display_key_negative_integer() {
        assert_eq!(cell_value_to_display_key(&CellValue::number(-5.0)), "-5");
    }

    #[test]
    fn test_display_key_text_lowercase() {
        assert_eq!(
            cell_value_to_display_key(&CellValue::Text("Hello".into())),
            "hello"
        );
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
    fn test_display_key_control() {
        assert_eq!(
            cell_value_to_display_key(&CellValue::Control(CellControl::checkbox(true))),
            "true"
        );
    }

    #[test]
    fn test_display_key_image_fallback_display() {
        let image = CellValue::Image(CellImage::new(
            "https://example.test/image.png",
            Some(Arc::from("Alt Text")),
            CellImageSizing::Fit,
            None,
            None,
        ));
        assert_eq!(cell_value_to_display_key(&image), "Alt Text");
    }

    #[test]
    fn test_display_key_error() {
        assert_eq!(
            cell_value_to_display_key(&CellValue::Error(CellError::Div0, None)),
            "#DIV/0!"
        );
    }

    #[test]
    fn test_display_key_array() {
        assert_eq!(
            cell_value_to_display_key(&CellValue::from_rows(vec![vec![CellValue::Null]])),
            ARRAY_DISPLAY_LABEL
        );
    }
}
