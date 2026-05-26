//! Format bridge — connects schema types to the format engine.
//!
//! Provides reverse mapping: given a format code, infer which SchemaType it represents.

use super::types::SchemaType;

/// Infer a SchemaType from an Excel format code string.
///
/// This provides the reverse mapping from `SchemaType::default_format_code()`.
/// Uses heuristic pattern matching on the format code tokens.
///
/// Returns `None` for `General` or unrecognized format codes.
pub fn infer_schema_from_format(format_code: &str) -> Option<SchemaType> {
    let code = format_code.trim();

    // General format — no specific type
    if code.eq_ignore_ascii_case("General") || code.is_empty() {
        return None;
    }

    // Check for percentage (contains unescaped %)
    if contains_unescaped(code, '%') {
        return Some(SchemaType::Percentage);
    }

    // Check for currency symbols or [$...] locale token
    if has_currency_token(code) {
        return Some(SchemaType::Currency);
    }

    // Check for date/time patterns
    if is_date_time_format(code) {
        if is_time_only_format(code) {
            return Some(SchemaType::Time);
        }
        return Some(SchemaType::Date);
    }

    // Text format
    if code == "@" {
        return Some(SchemaType::String);
    }

    // Check for integer format (no decimal places, no exponent)
    if is_integer_format(code) {
        return Some(SchemaType::Integer);
    }

    // Number format (has decimal places or exponent)
    if is_number_format(code) {
        return Some(SchemaType::Number);
    }

    None
}

/// Check if format code contains unescaped character (not inside quotes or after backslash)
fn contains_unescaped(code: &str, ch: char) -> bool {
    let mut in_quotes = false;
    let mut prev_backslash = false;
    let mut in_bracket = false;

    for c in code.chars() {
        if prev_backslash {
            prev_backslash = false;
            continue;
        }
        if c == '\\' {
            prev_backslash = true;
            continue;
        }
        if c == '"' {
            in_quotes = !in_quotes;
            continue;
        }
        if in_quotes {
            continue;
        }
        if c == '[' {
            in_bracket = true;
            continue;
        }
        if c == ']' {
            in_bracket = false;
            continue;
        }
        if in_bracket {
            continue;
        }
        if c == ch {
            return true;
        }
    }
    false
}

/// Check for currency tokens: literal $ € £ ¥ ₹ ₽ ₩ or [$...] locale format
fn has_currency_token(code: &str) -> bool {
    // Check for [$...] locale currency
    if code.contains("[$") {
        return true;
    }

    // Check for literal currency symbols (outside quotes)
    for sym in ['$', '€', '£', '¥', '₹', '₽', '₩'] {
        if contains_unescaped(code, sym) {
            return true;
        }
    }
    false
}

/// Check if format code is a date/time format.
/// Looks for unescaped date/time tokens: y, m, d, h, s, AM/PM
fn is_date_time_format(code: &str) -> bool {
    let lower = code.to_lowercase();
    let cleaned = remove_quoted_and_brackets(&lower);

    let has_year = cleaned.contains('y');
    let has_day = cleaned.contains('d');
    let has_hour = cleaned.contains('h');
    let has_second = cleaned.contains('s');
    let has_ampm = lower.contains("am/pm") || lower.contains("a/p");
    let has_month = cleaned.contains('m');

    if has_year || has_day {
        return true;
    }

    if has_hour || has_second || has_ampm {
        return true;
    }

    if has_month {
        return true;
    }

    false
}

/// Check if format is time-only (no year, no day)
fn is_time_only_format(code: &str) -> bool {
    let lower = code.to_lowercase();
    let cleaned = remove_quoted_and_brackets(&lower);

    let has_hour = cleaned.contains('h');
    let has_second = cleaned.contains('s');
    let has_ampm = lower.contains("am/pm") || lower.contains("a/p");
    let has_year = cleaned.contains('y');
    let has_day = cleaned.contains('d');

    (has_hour || has_second || has_ampm) && !has_year && !has_day
}

/// Check if format is integer (digit placeholders with no decimal point)
fn is_integer_format(code: &str) -> bool {
    let cleaned = remove_quoted_and_brackets(code);
    let has_digit_placeholder = cleaned.contains('0') || cleaned.contains('#');
    let has_decimal = cleaned.contains('.');
    let has_exponent =
        cleaned.to_lowercase().contains("e+") || cleaned.to_lowercase().contains("e-");

    has_digit_placeholder && !has_decimal && !has_exponent
}

/// Check if format is a number format
fn is_number_format(code: &str) -> bool {
    let cleaned = remove_quoted_and_brackets(code);
    cleaned.contains('0') || cleaned.contains('#')
}

/// Remove quoted strings ("...") and bracketed sections ([...]) from format code
fn remove_quoted_and_brackets(code: &str) -> String {
    let mut result = String::new();
    let mut in_quotes = false;
    let mut in_bracket = false;
    let mut prev_backslash = false;

    for c in code.chars() {
        if prev_backslash {
            prev_backslash = false;
            continue;
        }
        if c == '\\' {
            prev_backslash = true;
            continue;
        }
        if c == '"' {
            in_quotes = !in_quotes;
            continue;
        }
        if in_quotes {
            continue;
        }
        if c == '[' {
            in_bracket = true;
            continue;
        }
        if c == ']' {
            in_bracket = false;
            continue;
        }
        if in_bracket {
            continue;
        }
        result.push(c);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentage_format() {
        assert_eq!(infer_schema_from_format("0%"), Some(SchemaType::Percentage));
        assert_eq!(
            infer_schema_from_format("0.00%"),
            Some(SchemaType::Percentage)
        );
    }

    #[test]
    fn currency_format() {
        assert_eq!(
            infer_schema_from_format("$#,##0.00"),
            Some(SchemaType::Currency)
        );
        assert_eq!(
            infer_schema_from_format("€#,##0.00"),
            Some(SchemaType::Currency)
        );
        assert_eq!(
            infer_schema_from_format("[$USD] #,##0.00"),
            Some(SchemaType::Currency)
        );
    }

    #[test]
    fn date_format() {
        assert_eq!(infer_schema_from_format("m/d/yyyy"), Some(SchemaType::Date));
        assert_eq!(
            infer_schema_from_format("yyyy-mm-dd"),
            Some(SchemaType::Date)
        );
        assert_eq!(infer_schema_from_format("d-mmm-yy"), Some(SchemaType::Date));
    }

    #[test]
    fn time_format() {
        assert_eq!(
            infer_schema_from_format("h:mm AM/PM"),
            Some(SchemaType::Time)
        );
        assert_eq!(infer_schema_from_format("h:mm:ss"), Some(SchemaType::Time));
        assert_eq!(infer_schema_from_format("hh:mm"), Some(SchemaType::Time));
    }

    #[test]
    fn integer_format() {
        assert_eq!(infer_schema_from_format("#,##0"), Some(SchemaType::Integer));
        assert_eq!(infer_schema_from_format("0"), Some(SchemaType::Integer));
    }

    #[test]
    fn number_format() {
        assert_eq!(infer_schema_from_format("0.00"), Some(SchemaType::Number));
        assert_eq!(
            infer_schema_from_format("#,##0.00"),
            Some(SchemaType::Number)
        );
    }

    #[test]
    fn general_format() {
        assert_eq!(infer_schema_from_format("General"), None);
        assert_eq!(infer_schema_from_format(""), None);
    }

    #[test]
    fn text_format() {
        assert_eq!(infer_schema_from_format("@"), Some(SchemaType::String));
    }

    #[test]
    fn scientific_format() {
        assert_eq!(
            infer_schema_from_format("0.00E+00"),
            Some(SchemaType::Number)
        );
    }

    #[test]
    fn round_trip_currency() {
        let code = SchemaType::Currency.default_format_code().unwrap();
        assert_eq!(infer_schema_from_format(code), Some(SchemaType::Currency));
    }

    #[test]
    fn round_trip_percentage() {
        let code = SchemaType::Percentage.default_format_code().unwrap();
        assert_eq!(infer_schema_from_format(code), Some(SchemaType::Percentage));
    }

    #[test]
    fn round_trip_date() {
        let code = SchemaType::Date.default_format_code().unwrap();
        assert_eq!(infer_schema_from_format(code), Some(SchemaType::Date));
    }

    #[test]
    fn round_trip_time() {
        let code = SchemaType::Time.default_format_code().unwrap();
        assert_eq!(infer_schema_from_format(code), Some(SchemaType::Time));
    }

    #[test]
    fn round_trip_integer() {
        let code = SchemaType::Integer.default_format_code().unwrap();
        assert_eq!(infer_schema_from_format(code), Some(SchemaType::Integer));
    }

    #[test]
    fn quoted_percent_not_percentage() {
        // "%" in quotes is literal text, not a percentage format
        assert_ne!(
            infer_schema_from_format("0\"%\""),
            Some(SchemaType::Percentage)
        );
    }

    // -- Coverage: state machine edge cases --

    #[test]
    fn backslash_escaped_percent_not_percentage() {
        assert_ne!(
            infer_schema_from_format("0\\%"),
            Some(SchemaType::Percentage)
        );
    }

    #[test]
    fn bracketed_content_ignored() {
        assert_eq!(
            infer_schema_from_format("[Red]0.00"),
            Some(SchemaType::Number)
        );
    }

    #[test]
    fn month_only_format_is_date() {
        assert_eq!(infer_schema_from_format("mmm"), Some(SchemaType::Date));
    }

    #[test]
    fn date_time_combined_is_date() {
        assert_eq!(
            infer_schema_from_format("m/d/yyyy h:mm"),
            Some(SchemaType::Date)
        );
    }

    #[test]
    fn ampm_only_format_is_time() {
        assert_eq!(
            infer_schema_from_format("h:mm AM/PM"),
            Some(SchemaType::Time)
        );
    }

    #[test]
    fn locale_currency_format() {
        assert_eq!(
            infer_schema_from_format("[$CAD] #,##0.00"),
            Some(SchemaType::Currency)
        );
    }

    #[test]
    fn yen_currency_format() {
        assert_eq!(
            infer_schema_from_format("\u{00a5}#,##0"),
            Some(SchemaType::Currency)
        );
    }

    #[test]
    fn exponent_only_format() {
        assert_eq!(infer_schema_from_format("0E+0"), Some(SchemaType::Number));
    }

    #[test]
    fn unrecognized_format_returns_none() {
        assert_eq!(infer_schema_from_format("???"), None);
    }
}
