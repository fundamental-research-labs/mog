//! Higher-level input operations for cell mutations.
//!
//! These functions encapsulate formatting decisions so TS never needs to
//! call individual format utility functions like `isDateFormat()` or `dateToSerial()`.

use crate::{is_date_format, is_time_only_format};
use serde::{Deserialize, Serialize};
use value_types::date_serial::{date_to_serial, ymd_to_serial};

/// Result of preparing a date/time value for cell storage.
///
/// Contains the computed serial number and an optional format code to apply
/// when the cell does not already have an appropriate date/time format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateValueResult {
    /// Excel serial number (days since 1899-12-30, fractional for time).
    pub serial: f64,
    /// Format code to apply, or `None` if the cell already has an appropriate format.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_to_apply: Option<String>,
}

/// Compute a date serial and determine if a date format needs to be applied.
///
/// Returns the Excel serial number for the given date and, if the cell's
/// existing format is not already a date format, a suggested format code.
///
/// # Examples
///
/// ```
/// use compute_formats::prepare_date_value;
///
/// let result = prepare_date_value(2024, 3, 15, None);
/// assert!(result.serial > 0.0);
/// assert_eq!(result.format_to_apply, Some("M/d/yyyy".to_string()));
///
/// // Existing date format is preserved:
/// let result = prepare_date_value(2024, 3, 15, Some("yyyy-mm-dd"));
/// assert_eq!(result.format_to_apply, None);
/// ```
#[must_use]
pub fn prepare_date_value(
    year: i32,
    month: u32,
    day: u32,
    existing_format: Option<&str>,
) -> DateValueResult {
    let date = chrono::NaiveDate::from_ymd_opt(year, month, day);
    let serial = match date {
        Some(d) => date_to_serial(&d).floor(),
        None => 0.0, // Invalid date — TS will see 0 and can decide to show error
    };
    let format_to_apply = match existing_format {
        Some(fmt) if is_date_format(fmt) => None,
        _ => Some("M/d/yyyy".to_string()),
    };
    DateValueResult {
        serial,
        format_to_apply,
    }
}

/// Compute a time serial and determine if a time format needs to be applied.
///
/// The serial is a fractional day (e.g., 0.5 = noon, 0.75 = 6:00 PM).
/// Hours > 23 are valid (Excel supports elapsed time like `[h]:mm:ss`) and
/// will produce serial > 1.0.
///
/// # Examples
///
/// ```
/// use compute_formats::prepare_time_value;
///
/// let result = prepare_time_value(12, 30, 0, None);
/// assert!((result.serial - 0.520833).abs() < 0.001);
/// assert_eq!(result.format_to_apply, Some("h:mm:ss AM/PM".to_string()));
/// ```
#[must_use]
pub fn prepare_time_value(
    hours: u32,
    minutes: u32,
    seconds: u32,
    existing_format: Option<&str>,
) -> DateValueResult {
    let serial =
        (f64::from(hours) * 3600.0 + f64::from(minutes) * 60.0 + f64::from(seconds)) / 86400.0;
    let format_to_apply = match existing_format {
        Some(fmt) if is_time_only_format(fmt) || is_date_format(fmt) => None,
        _ => Some("h:mm:ss AM/PM".to_string()),
    };
    DateValueResult {
        serial,
        format_to_apply,
    }
}

/// Result of parsing a date string from user input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDateInput {
    /// Excel serial number for the parsed date.
    pub serial: f64,
    /// Suggested format code for the cell (e.g., "yyyy-mm-dd", "M/d/yyyy").
    pub suggested_format: String,
}

/// Parse a text string as a date, respecting locale date order.
///
/// Handles: `M/D/YYYY`, `YYYY-MM-DD`, `D-MMM-YYYY`, `MMM D YYYY`, and more.
/// Returns `None` if the text is not a recognizable date.
///
/// # Examples
///
/// ```
/// use compute_formats::{parse_date_input, CultureInfo};
///
/// let locale = CultureInfo::default();
/// let result = parse_date_input("2024-03-15", &locale).unwrap();
/// assert!(result.serial > 0.0);
/// assert_eq!(result.suggested_format, "yyyy-mm-dd");
///
/// assert!(parse_date_input("not a date", &locale).is_none());
/// ```
#[must_use]
pub fn parse_date_input(text: &str, locale: &crate::CultureInfo) -> Option<ParsedDateInput> {
    parse_date_input_with_default_year(text, locale, 2000)
}

/// Parse a text string as a date using an explicit default year for inputs
/// that omit a year (for example, `Dec 25`).
///
/// Callers that have session/workbook time semantics should pass the year from
/// that explicit clock. This crate intentionally does not read wall time.
#[must_use]
pub fn parse_date_input_with_default_year(
    text: &str,
    locale: &crate::CultureInfo,
    default_year: i32,
) -> Option<ParsedDateInput> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }

    // Try ISO format first (YYYY-MM-DD) — universal regardless of locale
    if let Some(result) = try_parse_iso(text) {
        return Some(result);
    }

    // Try slash-separated (locale-dependent: M/D/Y vs D/M/Y)
    if let Some(result) = try_parse_slash(text, locale, default_year) {
        return Some(result);
    }

    // Try dash-separated with month names (D-MMM-YYYY, D-MMM-YY)
    if let Some(result) = try_parse_dash_month_name(text, locale) {
        return Some(result);
    }

    // Try space-separated with month names (MMM D YYYY, D MMM YYYY, January 15, 2024)
    if let Some(result) = try_parse_space_month_name(text, locale, default_year) {
        return Some(result);
    }

    None
}

// ---------------------------------------------------------------------------
// Internal parsing helpers
// ---------------------------------------------------------------------------

/// Resolve 2-digit year: 0-29 → 2000s, 30-99 → 1900s
fn resolve_year(y: i32) -> i32 {
    if (0..=29).contains(&y) {
        2000 + y
    } else if (30..=99).contains(&y) {
        1900 + y
    } else {
        y
    }
}

fn validate_date(year: i32, month: u32, day: u32) -> Option<f64> {
    if !(1900..=9999).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if year == 1900 && month == 2 && day == 29 {
        return Some(ymd_to_serial(1900, 2, 29));
    }
    let date = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
    Some(date_to_serial(&date))
}

/// Try YYYY-MM-DD (ISO 8601)
fn try_parse_iso(text: &str) -> Option<ParsedDateInput> {
    let parts: Vec<&str> = text.splitn(3, '-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    if !(1900..=9999).contains(&y) {
        return None; // Must be 4-digit year for ISO
    }
    let serial = validate_date(y, m, d)?;
    Some(ParsedDateInput {
        serial,
        suggested_format: "yyyy-mm-dd".to_string(),
    })
}

/// Try slash-separated dates: M/D/Y or D/M/Y depending on locale
fn try_parse_slash(
    text: &str,
    locale: &crate::CultureInfo,
    default_year: i32,
) -> Option<ParsedDateInput> {
    let parts: Vec<&str> = text.splitn(3, '/').collect();
    if parts.len() < 2 {
        return None;
    }
    let a: u32 = parts[0].parse().ok()?;
    let b: u32 = parts[1].parse().ok()?;
    let c: Option<i32> = parts.get(2).and_then(|s| s.parse().ok());

    let year = c.map_or(default_year, resolve_year);

    let (month, day) = match locale.date_order() {
        crate::locale::DateOrder::DMY => (b, a),
        _ => (a, b), // MDY (default) and YMD both try M/D for slash
    };

    let serial = validate_date(year, month, day)?;
    Some(ParsedDateInput {
        serial,
        suggested_format: "M/d/yyyy".to_string(),
    })
}

/// Try to match an abbreviated or full month name, returning 1-based month number.
fn parse_month_name(s: &str, locale: &crate::CultureInfo) -> Option<u32> {
    let lower = s.to_lowercase();

    // Check abbreviated names first (shorter, more common in typed input)
    let abbrev_names: Vec<String> = locale
        .abbreviated_month_names
        .iter()
        .map(|n| n.to_lowercase())
        .collect();
    for (i, name) in abbrev_names.iter().enumerate() {
        if lower == *name || lower.starts_with(name.as_str()) {
            return Some((i + 1) as u32);
        }
    }

    // Check full names
    let full_names: Vec<String> = locale
        .month_names
        .iter()
        .map(|n| n.to_lowercase())
        .collect();
    for (i, name) in full_names.iter().enumerate() {
        if lower == *name {
            return Some((i + 1) as u32);
        }
    }

    None
}

/// Try D-MMM-YYYY or D-MMM-YY (dash-separated with month name)
fn try_parse_dash_month_name(text: &str, locale: &crate::CultureInfo) -> Option<ParsedDateInput> {
    let parts: Vec<&str> = text.splitn(3, '-').collect();
    if parts.len() != 3 {
        return None;
    }

    // Try D-MMM-YYYY
    if let Ok(day) = parts[0].parse::<u32>()
        && let Some(month) = parse_month_name(parts[1], locale)
        && let Ok(year) = parts[2].parse::<i32>()
    {
        let year = resolve_year(year);
        let serial = validate_date(year, month, day)?;
        return Some(ParsedDateInput {
            serial,
            suggested_format: "d-mmm-yyyy".to_string(),
        });
    }

    None
}

/// Try space-separated dates: "MMM D YYYY", "D MMM YYYY", "January 15, 2024"
fn try_parse_space_month_name(
    text: &str,
    locale: &crate::CultureInfo,
    default_year: i32,
) -> Option<ParsedDateInput> {
    // Remove commas for "January 15, 2024" → "January 15 2024"
    let cleaned = text.replace(',', " ");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    // Try: MMM D [YYYY]
    if let Some(month) = parse_month_name(parts[0], locale)
        && let Ok(day) = parts[1].parse::<u32>()
    {
        let year = if parts.len() >= 3 {
            parts[2].parse::<i32>().map(resolve_year).ok()?
        } else {
            default_year
        };
        let serial = validate_date(year, month, day)?;
        return Some(ParsedDateInput {
            serial,
            suggested_format: "d-mmm-yyyy".to_string(),
        });
    }

    // Try: D MMM [YYYY]
    if let Ok(day) = parts[0].parse::<u32>()
        && let Some(month) = parse_month_name(parts[1], locale)
    {
        let year = if parts.len() >= 3 {
            parts[2].parse::<i32>().map(resolve_year).ok()?
        } else {
            default_year
        };
        let serial = validate_date(year, month, day)?;
        return Some(ParsedDateInput {
            serial,
            suggested_format: "d-mmm-yyyy".to_string(),
        });
    }

    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CultureInfo;

    #[test]
    fn test_prepare_date_value_no_existing_format() {
        let result = prepare_date_value(2024, 3, 15, None);
        assert!(result.serial > 0.0);
        assert_eq!(result.format_to_apply, Some("M/d/yyyy".to_string()));
    }

    #[test]
    fn test_prepare_date_value_existing_date_format() {
        let result = prepare_date_value(2024, 3, 15, Some("yyyy-mm-dd"));
        assert!(result.serial > 0.0);
        assert_eq!(result.format_to_apply, None); // Already has date format
    }

    #[test]
    fn test_prepare_date_value_existing_number_format() {
        let result = prepare_date_value(2024, 3, 15, Some("#,##0.00"));
        assert!(result.serial > 0.0);
        assert_eq!(result.format_to_apply, Some("M/d/yyyy".to_string()));
    }

    #[test]
    fn test_prepare_time_value_no_existing_format() {
        let result = prepare_time_value(12, 30, 0, None);
        let expected_serial = (12.0 * 3600.0 + 30.0 * 60.0) / 86400.0;
        assert!((result.serial - expected_serial).abs() < 1e-10);
        assert_eq!(result.format_to_apply, Some("h:mm:ss AM/PM".to_string()));
    }

    #[test]
    fn test_prepare_time_value_existing_time_format() {
        let result = prepare_time_value(12, 30, 0, Some("h:mm:ss"));
        assert_eq!(result.format_to_apply, None);
    }

    #[test]
    fn test_prepare_time_value_existing_date_format() {
        let result = prepare_time_value(12, 30, 0, Some("M/d/yyyy h:mm"));
        assert_eq!(result.format_to_apply, None);
    }

    #[test]
    fn test_parse_date_iso() {
        let locale = CultureInfo::default();
        let result = parse_date_input("2024-03-15", &locale).unwrap();
        assert!(result.serial > 0.0);
        assert_eq!(result.suggested_format, "yyyy-mm-dd");
    }

    #[test]
    fn test_parse_date_slash_mdy() {
        let locale = CultureInfo::default(); // MDY
        let result = parse_date_input("3/15/2024", &locale).unwrap();
        assert!(result.serial > 0.0);
        assert_eq!(result.suggested_format, "M/d/yyyy");
    }

    #[test]
    fn test_parse_date_slash_dmy() {
        let locale = CultureInfo {
            short_date_pattern: "dd/MM/yyyy".into(), // DMY
            ..Default::default()
        };
        let result = parse_date_input("15/3/2024", &locale).unwrap();
        assert!(result.serial > 0.0);
        assert_eq!(result.suggested_format, "M/d/yyyy");
    }

    #[test]
    fn test_parse_date_month_name() {
        let locale = CultureInfo::default();
        let result = parse_date_input("March 15, 2024", &locale).unwrap();
        assert!(result.serial > 0.0);
    }

    #[test]
    fn test_parse_date_abbreviated_month() {
        let locale = CultureInfo::default();
        let result = parse_date_input("15-Mar-2024", &locale).unwrap();
        assert!(result.serial > 0.0);
    }

    #[test]
    fn test_parse_date_accepts_excel_1900_leap_day_forms() {
        let locale = CultureInfo::default();
        for text in [
            "2/29/1900",
            "1900-02-29",
            "February 29, 1900",
            "29-Feb-1900",
        ] {
            let result = parse_date_input(text, &locale).unwrap();
            assert_eq!(result.serial, 60.0, "failed for {text}");
        }
    }

    #[test]
    fn test_parse_date_invalid() {
        let locale = CultureInfo::default();
        assert!(parse_date_input("not a date", &locale).is_none());
        assert!(parse_date_input("", &locale).is_none());
        assert!(parse_date_input("13/32/2024", &locale).is_none());
        assert!(parse_date_input("1900-02-30", &locale).is_none());
        assert!(parse_date_input("2/30/1900", &locale).is_none());
        assert!(parse_date_input("2023-02-29", &locale).is_none());
    }

    #[test]
    fn test_parse_date_two_digit_year() {
        let locale = CultureInfo::default();
        let result = parse_date_input("3/15/24", &locale).unwrap();
        // 24 → 2024
        let result2 = parse_date_input("3/15/2024", &locale).unwrap();
        assert!((result.serial - result2.serial).abs() < 0.01);
    }

    #[test]
    fn test_resolve_year() {
        assert_eq!(resolve_year(24), 2024);
        assert_eq!(resolve_year(0), 2000);
        assert_eq!(resolve_year(29), 2029);
        assert_eq!(resolve_year(30), 1930);
        assert_eq!(resolve_year(99), 1999);
        assert_eq!(resolve_year(2024), 2024);
    }
}
