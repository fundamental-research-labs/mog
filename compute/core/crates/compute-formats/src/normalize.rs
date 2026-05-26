//! Format code normalization and preview generation.
//!
//! [`normalize_format_code`] canonicalizes format strings (trimming, case normalization).
//! [`get_format_preview`] renders a format code with a sample value for UI previews.

use crate::constants::FormatType;
use crate::detection::detect_format_type;

/// Normalize a format code string.
///
/// Trims whitespace and normalizes `"general"` (any case) to `"General"`.
/// Empty strings are treated as `"General"`.
///
/// # Examples
///
/// ```
/// use compute_formats::normalize_format_code;
///
/// assert_eq!(normalize_format_code("  general  "), "General");
/// assert_eq!(normalize_format_code(""), "General");
/// assert_eq!(normalize_format_code("  #,##0.00  "), "#,##0.00");
/// ```
#[must_use]
pub fn normalize_format_code(format_code: &str) -> String {
    let trimmed = format_code.trim();

    if trimmed.is_empty() {
        return "General".to_string();
    }

    // Normalize "general" (any case) to "General"
    if trimmed.eq_ignore_ascii_case("General") {
        return "General".to_string();
    }

    trimmed.to_string()
}

/// Get a preview of a format code with a sample value.
///
/// Uses a type-appropriate default sample value if none is provided (e.g.,
/// `1234.5` for numbers, `0.5` for percentages, a date serial for dates).
///
/// # Examples
///
/// ```
/// use compute_formats::get_format_preview;
///
/// assert_eq!(get_format_preview("#,##0.00", Some(1234.5)), "1,234.50");
/// assert_eq!(get_format_preview("0%", Some(0.5)), "50%");
/// assert_eq!(get_format_preview("General", Some(42.0)), "42");
/// ```
#[must_use]
pub fn get_format_preview(format_code: &str, sample_value: Option<f64>) -> String {
    let format_type = detect_format_type(format_code);

    let value = sample_value.unwrap_or(match format_type {
        FormatType::Date => 45639.0,       // Dec 13, 2025
        FormatType::Time => 0.645_833_333, // ~3:30 PM
        FormatType::Percentage => 0.5,     // 50%
        FormatType::Fraction => 1.5,       // 1 1/2
        _ => 1234.5,
    });

    // Delegate to format_number
    crate::format_number(value, format_code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::default_format;

    // -----------------------------------------------------------------------
    // normalize_format_code tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_normalize_empty() {
        assert_eq!(normalize_format_code(""), "General");
    }

    #[test]
    fn test_normalize_general_case_insensitive() {
        assert_eq!(normalize_format_code("  general  "), "General");
        assert_eq!(normalize_format_code("GENERAL"), "General");
        assert_eq!(normalize_format_code("General"), "General");
        assert_eq!(normalize_format_code("  General  "), "General");
    }

    #[test]
    fn test_normalize_preserves_other_formats() {
        assert_eq!(normalize_format_code("#,##0.00"), "#,##0.00");
        assert_eq!(normalize_format_code("  #,##0.00  "), "#,##0.00");
        assert_eq!(normalize_format_code("$#,##0.00"), "$#,##0.00");
        assert_eq!(normalize_format_code("m/d/yyyy"), "m/d/yyyy");
        assert_eq!(normalize_format_code("@"), "@");
    }

    // -----------------------------------------------------------------------
    // default_format tests (via constants module)
    // -----------------------------------------------------------------------

    #[test]
    fn test_default_format_number() {
        assert_eq!(default_format(FormatType::Number), "#,##0.00");
    }

    #[test]
    fn test_default_format_date() {
        assert_eq!(default_format(FormatType::Date), "m/d/yyyy");
    }

    #[test]
    fn test_default_format_general() {
        assert_eq!(default_format(FormatType::General), "General");
    }

    #[test]
    fn test_default_format_time() {
        assert_eq!(default_format(FormatType::Time), "h:mm AM/PM");
    }

    #[test]
    fn test_default_format_percentage() {
        assert_eq!(default_format(FormatType::Percentage), "0.00%");
    }

    #[test]
    fn test_default_format_text() {
        assert_eq!(default_format(FormatType::Text), "@");
    }

    // -----------------------------------------------------------------------
    // get_format_preview tests
    // -----------------------------------------------------------------------

    // TODO: These tests depend on the full format_number integration.
    // Once constants module and lib.rs wiring are complete, verify:
    // - get_format_preview("#,##0.00", Some(1234.5)) == "1,234.50"
    // - get_format_preview("0%", Some(0.5)) == "50%"
    // - get_format_preview("m/d/yyyy", Some(45639.0)) shows a date string
    // - get_format_preview("h:mm AM/PM", None) uses default time sample
    // - get_format_preview("General", Some(42.0)) == "42"

    #[test]
    fn test_get_format_preview_number() {
        // format_number is already functional in the crate
        let result = get_format_preview("#,##0.00", Some(1234.5));
        assert_eq!(result, "1,234.50");
    }

    #[test]
    fn test_get_format_preview_percentage() {
        let result = get_format_preview("0%", Some(0.5));
        assert_eq!(result, "50%");
    }

    #[test]
    fn test_get_format_preview_general() {
        let result = get_format_preview("General", Some(42.0));
        assert_eq!(result, "42");
    }
}
