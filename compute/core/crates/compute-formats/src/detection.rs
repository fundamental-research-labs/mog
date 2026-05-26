//! Format type detection and classification.
//!
//! Detects whether a format code represents a date, time, currency, percentage, etc.

use crate::constants::FormatType;

/// Detect the format type from a format code string.
///
/// Analyzes the format code to determine which of the 12 Excel format categories
/// it belongs to. Used by the Format Cells dialog to show the correct category.
///
/// # Examples
///
/// ```
/// use compute_formats::{detect_format_type, FormatType};
///
/// assert_eq!(detect_format_type("#,##0.00"), FormatType::Number);
/// assert_eq!(detect_format_type("yyyy-mm-dd"), FormatType::Date);
/// assert_eq!(detect_format_type("$#,##0.00"), FormatType::Currency);
/// assert_eq!(detect_format_type("0%"), FormatType::Percentage);
/// ```
#[must_use]
pub fn detect_format_type(format_code: &str) -> FormatType {
    if format_code.is_empty() || format_code.eq_ignore_ascii_case("General") {
        return FormatType::General;
    }
    if format_code == "@" {
        return FormatType::Text;
    }

    // Clean: remove bracketed expressions and quoted strings for analysis
    let cleaned = strip_escapes_quotes_brackets(format_code);

    // Date/Time detection
    if is_date_format(format_code) {
        // Time-only check: has time tokens (h,s,AM/PM) but no date tokens (y,d)
        if has_time_tokens_inner(&cleaned) && !has_date_only_tokens(&cleaned) {
            return FormatType::Time;
        }
        return FormatType::Date;
    }

    // Percentage
    if cleaned.contains('%') {
        return FormatType::Percentage;
    }

    // Scientific
    if has_scientific_notation(&cleaned) {
        return FormatType::Scientific;
    }

    // Fraction (pattern like ?/? or ??/?? or ?/10)
    if has_fraction_pattern(&cleaned) {
        return FormatType::Fraction;
    }

    // Accounting (starts with _( pattern)
    if format_code.starts_with("_(") {
        return FormatType::Accounting;
    }

    // Currency (has currency symbol characters)
    if has_currency_symbol(&cleaned) {
        return FormatType::Currency;
    }

    // Special formats: ZIP, Phone, SSN
    if is_special_format(format_code) {
        return FormatType::Special;
    }

    // Number (has digit placeholders)
    if cleaned.contains('#') || cleaned.contains('0') {
        return FormatType::Number;
    }

    FormatType::Custom
}

/// Check if a format code represents a date/time format.
///
/// This is the comprehensive check that handles escaped characters, quoted strings,
/// and bracketed expressions properly. Escaped characters (`\d`) and quoted text
/// (`"days"`) are not treated as date tokens.
///
/// # Examples
///
/// ```
/// use compute_formats::is_date_format;
///
/// assert!(is_date_format("yyyy-mm-dd"));
/// assert!(is_date_format("h:mm:ss"));
/// assert!(!is_date_format("#,##0"));
/// assert!(!is_date_format("0\\d")); // escaped 'd' is not a date token
/// ```
#[must_use]
pub fn is_date_format(format_code: &str) -> bool {
    if format_code.is_empty() || format_code.eq_ignore_ascii_case("General") || format_code == "@" {
        return false;
    }

    // Remove escaped chars (\d, \m), quoted strings ("text"), and brackets ([Red], [>100])
    let cleaned = strip_escapes_quotes_brackets(format_code);

    // Check for date/time tokens
    if cleaned.contains('y') || cleaned.contains('Y') {
        return true;
    }
    if cleaned.contains('d') || cleaned.contains('D') {
        return true;
    }
    if cleaned.contains('h') || cleaned.contains('H') {
        return true;
    }

    // AM/PM check
    let upper = cleaned.to_uppercase();
    if upper.contains("AM/PM") || upper.contains("A/P") {
        return true;
    }

    // Check for s (seconds) not preceded by # or 0 (which would indicate a number format)
    // Simple heuristic: if 's' appears and no # or 0 precedes it directly
    let bytes = cleaned.as_bytes();
    for (idx, &byte) in bytes.iter().enumerate() {
        if (byte == b's' || byte == b'S')
            && (idx == 0 || !matches!(bytes.get(idx - 1), Some(b'#' | b'0')))
        {
            return true;
        }
    }

    false
}

/// Check if a format code is time-only (no date components).
///
/// Returns `true` if the format has time tokens (`h`, `s`, `AM/PM`) but no
/// date tokens (`y`, `d`).
///
/// # Examples
///
/// ```
/// use compute_formats::is_time_only_format;
///
/// assert!(is_time_only_format("h:mm:ss"));
/// assert!(!is_time_only_format("yyyy-mm-dd"));
/// assert!(!is_time_only_format("m/d/yy h:mm")); // has both date and time
/// ```
#[must_use]
pub fn is_time_only_format(format_code: &str) -> bool {
    if format_code.is_empty() {
        return false;
    }

    let cleaned = strip_escapes_quotes_brackets(format_code);
    let has_time = has_time_tokens_inner(&cleaned);
    let has_date = has_date_only_tokens(&cleaned);

    has_time && !has_date
}

/// Check if a numeric value looks like an Excel date serial number.
///
/// Reasonable range: serial 1 (Jan 1, 1900) to 110,000 (roughly Dec 31, 2199).
/// Values outside this range (including fractional time-only values like 0.5)
/// return `false`.
///
/// # Examples
///
/// ```
/// use compute_formats::is_likely_date_serial;
///
/// assert!(is_likely_date_serial(45000.0));
/// assert!(!is_likely_date_serial(0.5));   // time-only, not a date serial
/// assert!(!is_likely_date_serial(-1.0));
/// ```
#[must_use]
pub fn is_likely_date_serial(value: f64) -> bool {
    value.is_finite() && (1.0..=110_000.0).contains(&value)
}

/// Check whether a value should be formatted as a date.
///
/// Returns `true` only if the format code is a date format **and** the value
/// falls within the reasonable date serial range (1..=110,000).
///
/// # Examples
///
/// ```
/// use compute_formats::should_format_as_date;
///
/// assert!(should_format_as_date(45000.0, "m/d/yy"));
/// assert!(!should_format_as_date(45000.0, "#,##0"));   // not a date format
/// assert!(!should_format_as_date(0.5, "m/d/yy"));      // out of serial range
/// ```
#[must_use]
pub fn should_format_as_date(value: f64, format_code: &str) -> bool {
    is_date_format(format_code) && is_likely_date_serial(value)
}

/// Check if a format code has date tokens (`y`, `d`) after removing brackets/quotes.
///
/// Used to distinguish date-only vs time-only vs datetime formats.
///
/// # Examples
///
/// ```
/// use compute_formats::has_date_tokens;
///
/// assert!(has_date_tokens("yyyy-mm-dd"));
/// assert!(!has_date_tokens("h:mm:ss"));
/// ```
#[must_use]
pub fn has_date_tokens(format_code: &str) -> bool {
    let cleaned = strip_escapes_quotes_brackets(format_code);
    has_date_only_tokens(&cleaned)
}

/// Check if a format code has time tokens (`h`, `s`, `AM/PM`) after removing brackets/quotes.
///
/// # Examples
///
/// ```
/// use compute_formats::has_time_tokens;
///
/// assert!(has_time_tokens("h:mm:ss"));
/// assert!(has_time_tokens("h:mm AM/PM"));
/// assert!(!has_time_tokens("yyyy-mm-dd"));
/// ```
#[must_use]
pub fn has_time_tokens(format_code: &str) -> bool {
    let cleaned = strip_escapes_quotes_brackets(format_code);
    has_time_tokens_inner(&cleaned)
}

// -- Private helpers --

/// Remove escaped characters, quoted strings, and bracketed expressions from a format code.
/// Used for analysis/detection purposes only.
///
/// All delimiters (`\`, `"`, `[`, `]`) are ASCII, but format codes may contain
/// non-ASCII currency symbols (e.g., `\u{20AC}`), so we use `Vec<char>` for correctness.
fn strip_escapes_quotes_brackets(s: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() {
            i += 2; // skip escaped char
            continue;
        }
        if chars[i] == '"' {
            i += 1; // skip opening quote
            while i < chars.len() && chars[i] != '"' {
                i += 1;
            }
            i += 1; // skip closing quote
            continue;
        }
        if chars[i] == '[' {
            while i < chars.len() && chars[i] != ']' {
                i += 1;
            }
            i += 1; // skip closing bracket
            continue;
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

fn has_time_tokens_inner(cleaned: &str) -> bool {
    let upper = cleaned.to_uppercase();
    cleaned.contains('h')
        || cleaned.contains('H')
        || cleaned.contains('s')
        || cleaned.contains('S')
        || upper.contains("AM/PM")
        || upper.contains("A/P")
}

fn has_date_only_tokens(cleaned: &str) -> bool {
    cleaned.contains('y') || cleaned.contains('Y') || cleaned.contains('d') || cleaned.contains('D')
}

fn has_scientific_notation(cleaned: &str) -> bool {
    // E+ or E- followed by digit-like characters, but not in color/bracket context
    let bytes = cleaned.as_bytes();
    for i in 0..bytes.len().saturating_sub(1) {
        if (bytes[i] == b'E' || bytes[i] == b'e') && (bytes[i + 1] == b'+' || bytes[i + 1] == b'-')
        {
            return true;
        }
    }
    false
}

fn has_fraction_pattern(cleaned: &str) -> bool {
    // Look for pattern like ?/?, ??/??, #/#, ?/10, etc.
    // Digit placeholder, then /, then digit placeholder or actual digits
    let bytes = cleaned.as_bytes();
    for i in 1..bytes.len().saturating_sub(1) {
        if bytes[i] == b'/' {
            let before = bytes[i - 1];
            let after = bytes[i + 1];
            let is_placeholder_or_digit = |b: u8| matches!(b, b'#' | b'?' | b'0'..=b'9');
            if is_placeholder_or_digit(before) && is_placeholder_or_digit(after) {
                return true;
            }
        }
    }
    false
}

fn has_currency_symbol(cleaned: &str) -> bool {
    for ch in cleaned.chars() {
        if matches!(
            ch,
            '$' | '\u{20AC}'
                | '\u{00A3}'
                | '\u{00A5}'
                | '\u{20B9}'
                | '\u{20A9}'
                | '\u{20BD}'
                | '\u{20BA}'
                | '\u{0E3F}'
                | '\u{20B1}'
        ) {
            return true;
        }
    }
    // Multi-char symbols
    cleaned.contains("CHF")
        || cleaned.contains("CA$")
        || cleaned.contains("A$")
        || cleaned.contains("HK$")
        || cleaned.contains("NT$")
        || cleaned.contains("S$")
        || cleaned.contains("R$")
        || cleaned.contains("Mex$")
        || cleaned.contains("AED")
        || cleaned.contains("SAR")
}

fn is_special_format(format_code: &str) -> bool {
    format_code == "00000"
        || format_code == "00000-0000"
        || format_code == "(###) ###-####"
        || format_code == "000-00-0000"
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // detect_format_type tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_general() {
        assert_eq!(detect_format_type("General"), FormatType::General);
        assert_eq!(detect_format_type("general"), FormatType::General);
        assert_eq!(detect_format_type("GENERAL"), FormatType::General);
        assert_eq!(detect_format_type(""), FormatType::General);
    }

    #[test]
    fn test_detect_number() {
        assert_eq!(detect_format_type("0.00"), FormatType::Number);
        assert_eq!(detect_format_type("#,##0.00"), FormatType::Number);
        assert_eq!(detect_format_type("#,##0"), FormatType::Number);
        assert_eq!(detect_format_type("0"), FormatType::Number);
    }

    #[test]
    fn test_detect_currency() {
        assert_eq!(detect_format_type("$#,##0.00"), FormatType::Currency);
        assert_eq!(detect_format_type("\u{20AC}#,##0.00"), FormatType::Currency);
        assert_eq!(detect_format_type("\u{00A3}#,##0.00"), FormatType::Currency);
        assert_eq!(detect_format_type("\u{00A5}#,##0.00"), FormatType::Currency);
    }

    #[test]
    fn test_detect_accounting() {
        assert_eq!(
            detect_format_type("_($* #,##0.00_)"),
            FormatType::Accounting
        );
    }

    #[test]
    fn test_detect_date() {
        assert_eq!(detect_format_type("m/d/yyyy"), FormatType::Date);
        assert_eq!(detect_format_type("yyyy-mm-dd"), FormatType::Date);
        assert_eq!(detect_format_type("d-mmm-yy"), FormatType::Date);
        assert_eq!(detect_format_type("mmm d, yyyy"), FormatType::Date);
    }

    #[test]
    fn test_detect_time() {
        assert_eq!(detect_format_type("h:mm AM/PM"), FormatType::Time);
        assert_eq!(detect_format_type("h:mm:ss"), FormatType::Time);
        assert_eq!(detect_format_type("hh:mm:ss"), FormatType::Time);
    }

    #[test]
    fn test_detect_percentage() {
        assert_eq!(detect_format_type("0%"), FormatType::Percentage);
        assert_eq!(detect_format_type("0.00%"), FormatType::Percentage);
    }

    #[test]
    fn test_detect_scientific() {
        assert_eq!(detect_format_type("0.00E+00"), FormatType::Scientific);
        assert_eq!(detect_format_type("0.00e+00"), FormatType::Scientific);
    }

    #[test]
    fn test_detect_fraction() {
        assert_eq!(detect_format_type("# ?/?"), FormatType::Fraction);
        assert_eq!(detect_format_type("# ??/??"), FormatType::Fraction);
        assert_eq!(detect_format_type("# ?/10"), FormatType::Fraction);
    }

    #[test]
    fn test_detect_text() {
        assert_eq!(detect_format_type("@"), FormatType::Text);
    }

    #[test]
    fn test_detect_special() {
        assert_eq!(detect_format_type("00000"), FormatType::Special);
        assert_eq!(detect_format_type("000-00-0000"), FormatType::Special);
        assert_eq!(detect_format_type("(###) ###-####"), FormatType::Special);
        assert_eq!(detect_format_type("00000-0000"), FormatType::Special);
    }

    // -----------------------------------------------------------------------
    // is_date_format tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_date_format_positive() {
        assert!(is_date_format("yyyy-mm-dd"));
        assert!(is_date_format("m/d/yy"));
        assert!(is_date_format("d-mmm-yy"));
        assert!(is_date_format("h:mm:ss"));
        assert!(is_date_format("h:mm AM/PM"));
        assert!(is_date_format("yyyy"));
    }

    #[test]
    fn test_is_date_format_negative() {
        assert!(!is_date_format("#,##0"));
        assert!(!is_date_format("General"));
        assert!(!is_date_format("general"));
        assert!(!is_date_format(""));
        assert!(!is_date_format("@"));
        assert!(!is_date_format("0.00%"));
        assert!(!is_date_format("$#,##0.00"));
    }

    #[test]
    fn test_is_date_format_escaped_chars_ignored() {
        // \d should not trigger date detection
        assert!(!is_date_format("0\\d"));
        // Quoted text should not trigger
        assert!(!is_date_format("0\"days\""));
    }

    // -----------------------------------------------------------------------
    // is_time_only_format tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_time_only_format() {
        assert!(is_time_only_format("h:mm:ss"));
        assert!(is_time_only_format("h:mm AM/PM"));
        assert!(is_time_only_format("hh:mm"));
        assert!(!is_time_only_format("yyyy-mm-dd"));
        assert!(!is_time_only_format("m/d/yy h:mm"));
        assert!(!is_time_only_format(""));
    }

    // -----------------------------------------------------------------------
    // is_likely_date_serial tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_likely_date_serial() {
        assert!(is_likely_date_serial(1.0));
        assert!(is_likely_date_serial(45000.0));
        assert!(is_likely_date_serial(110_000.0));
        assert!(!is_likely_date_serial(0.5));
        assert!(!is_likely_date_serial(0.0));
        assert!(!is_likely_date_serial(-1.0));
        assert!(!is_likely_date_serial(200_000.0));
        assert!(!is_likely_date_serial(f64::NAN));
        assert!(!is_likely_date_serial(f64::INFINITY));
    }

    // -----------------------------------------------------------------------
    // should_format_as_date tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_should_format_as_date() {
        assert!(should_format_as_date(45000.0, "m/d/yy"));
        assert!(!should_format_as_date(45000.0, "#,##0"));
        assert!(!should_format_as_date(0.5, "m/d/yy")); // out of serial range
        assert!(!should_format_as_date(200_000.0, "m/d/yy")); // out of serial range
    }
}
