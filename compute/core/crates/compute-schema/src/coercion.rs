//! Type coercion engine.
//!
//! Converts cell values between schema types while preserving semantics.
//! Times are represented as fractional days (0.0–1.0) matching Excel convention.

use value_types::CellValue;

use super::types::{CellValueResult, CoercionResult, SchemaType};

/// Coerce a `CellValue` to the target `SchemaType`.
pub fn coerce(value: &CellValue, target: SchemaType) -> CoercionResult {
    // Null values — handle specially
    if matches!(value, CellValue::Null) {
        return match target {
            SchemaType::Null | SchemaType::Any => CoercionResult::ok(CellValueResult::Null),
            SchemaType::String
            | SchemaType::Email
            | SchemaType::Url
            | SchemaType::Phone
            | SchemaType::Company
            | SchemaType::Person
            | SchemaType::Stock
            | SchemaType::Location => CoercionResult::ok(CellValueResult::Text(String::new())),
            _ => CoercionResult::err("Cannot coerce null to non-null type"),
        };
    }

    // Any type accepts everything
    if target == SchemaType::Any {
        return coerce_passthrough(value);
    }

    match target {
        SchemaType::Null => coerce_to_null(value),
        SchemaType::Boolean => coerce_to_boolean(value),
        SchemaType::Number => coerce_to_number(value),
        SchemaType::Integer => coerce_to_integer(value),
        SchemaType::String => coerce_to_string(value),
        SchemaType::Date => coerce_to_date(value),
        SchemaType::Time => coerce_to_time(value),
        SchemaType::Email
        | SchemaType::Url
        | SchemaType::Phone
        | SchemaType::Company
        | SchemaType::Person
        | SchemaType::Stock
        | SchemaType::Location => coerce_to_string(value),
        SchemaType::Currency => coerce_to_currency(value),
        SchemaType::Percentage => coerce_to_percentage(value),
        SchemaType::Distribution => coerce_to_number(value),
        SchemaType::Any => unreachable!(), // handled above
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Pass through a `CellValue` as-is, mapping to the closest `CellValueResult`.
fn coerce_passthrough(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Number(n.get())),
        CellValue::Text(s) => CoercionResult::ok(CellValueResult::Text(s.to_string())),
        CellValue::Boolean(b) => CoercionResult::ok(CellValueResult::Boolean(*b)),
        CellValue::Null => CoercionResult::ok(CellValueResult::Null),
        CellValue::Error(e, _) => CoercionResult::err(format!("Cannot coerce error value: {e}")),
        CellValue::Array(_) => CoercionResult::ok(CellValueResult::Text("[Array]".into())),
        CellValue::Control(c) => CoercionResult::ok(CellValueResult::Boolean(c.value)),
    }
}

/// Coerce to null (only empty/falsy values).
fn coerce_to_null(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Null => CoercionResult::ok(CellValueResult::Null),
        CellValue::Text(s) if s.is_empty() => CoercionResult::ok(CellValueResult::Null),
        CellValue::Number(n) if n.get() == 0.0 => CoercionResult::ok(CellValueResult::Null),
        CellValue::Boolean(false) => CoercionResult::ok(CellValueResult::Null),
        _ => CoercionResult::err("Value is not empty"),
    }
}

/// Coerce to boolean.
fn coerce_to_boolean(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Boolean(b) => CoercionResult::ok(CellValueResult::Boolean(*b)),
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Boolean(n.get() != 0.0)),
        CellValue::Text(s) => {
            let lower = s.trim().to_ascii_lowercase();
            match lower.as_str() {
                "true" | "yes" | "1" | "on" => CoercionResult::ok(CellValueResult::Boolean(true)),
                "false" | "no" | "0" | "off" | "" => {
                    CoercionResult::ok(CellValueResult::Boolean(false))
                }
                _ => CoercionResult::err(format!("Cannot coerce \"{s}\" to boolean")),
            }
        }
        _ => CoercionResult::err("Cannot coerce value to boolean"),
    }
}

/// Coerce to number.
fn coerce_to_number(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Number(n.get())),
        CellValue::Boolean(b) => {
            CoercionResult::ok(CellValueResult::Number(if *b { 1.0 } else { 0.0 }))
        }
        CellValue::Text(s) => parse_text_as_number(s),
        _ => CoercionResult::err("Cannot coerce value to number"),
    }
}

/// Parse a text string into a number, stripping currency symbols, commas, and handling `%`.
fn parse_text_as_number(s: &str) -> CoercionResult {
    let cleaned = strip_currency_and_commas(s.trim());

    // Handle percentage suffix
    if let Some(before_pct) = cleaned.strip_suffix('%')
        && let Ok(n) = before_pct.parse::<f64>()
    {
        return CoercionResult::ok(CellValueResult::Number(n / 100.0));
    }

    match cleaned.parse::<f64>() {
        Ok(n) if n.is_finite() => CoercionResult::ok(CellValueResult::Number(n)),
        _ => CoercionResult::err(format!("Cannot parse \"{s}\" as number")),
    }
}

/// Strip currency symbols ($, euro, pound, yen, rupee, ruble, won), commas, and whitespace.
fn strip_currency_and_commas(s: &str) -> String {
    s.chars()
        .filter(|c| {
            !matches!(
                c,
                '$' | '\u{20ac}'
                    | '\u{00a3}'
                    | '\u{00a5}'
                    | '\u{20b9}'
                    | '\u{20bd}'
                    | '\u{20a9}'
                    | ','
                    | ' '
            )
        })
        .collect()
}

/// Coerce to integer — delegate to `coerce_to_number` and round.
fn coerce_to_integer(value: &CellValue) -> CoercionResult {
    let num_result = coerce_to_number(value);
    if !num_result.success {
        return num_result;
    }
    match num_result.value {
        Some(CellValueResult::Number(n)) => CoercionResult::ok(CellValueResult::Number(n.round())),
        _ => num_result,
    }
}

/// Coerce to string.
fn coerce_to_string(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Text(s) => CoercionResult::ok(CellValueResult::Text(s.to_string())),
        CellValue::Number(n) => {
            let s = format_number(n.get());
            CoercionResult::ok(CellValueResult::Text(s))
        }
        CellValue::Boolean(b) => CoercionResult::ok(CellValueResult::Text(b.to_string())),
        CellValue::Null => CoercionResult::ok(CellValueResult::Text(String::new())),
        CellValue::Error(e, _) => CoercionResult::ok(CellValueResult::Text(format!("{e}"))),
        CellValue::Array(_) => CoercionResult::ok(CellValueResult::Text("[Array]".into())),
        CellValue::Control(c) => CoercionResult::ok(CellValueResult::Text(
            if c.value { "true" } else { "false" }.into(),
        )),
    }
}

/// Format a number, removing unnecessary trailing zeros.
fn format_number(n: f64) -> String {
    if n == n.trunc() {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// Coerce to date.
///
/// In compute-core, dates are represented as Excel serial numbers (f64).
/// - If the value is already a number, assume it is a serial date.
/// - If it is text matching a known date pattern, return the text as-is
///   (the format engine handles display; actual parsing is deferred).
/// - If the text parses as a number, treat it as a serial date.
fn coerce_to_date(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Number(n.get())),
        CellValue::Text(s) => {
            let trimmed = s.trim();
            if super::patterns::is_date_string(trimmed) {
                return CoercionResult::ok(CellValueResult::Text(trimmed.to_string()));
            }
            if let Ok(n) = trimmed.parse::<f64>()
                && n.is_finite()
            {
                return CoercionResult::ok(CellValueResult::Number(n));
            }
            CoercionResult::err(format!("Cannot coerce \"{s}\" to date"))
        }
        _ => CoercionResult::err("Cannot coerce value to date"),
    }
}

/// Coerce to time.
///
/// Times are represented as fractional days in [0, 1) matching Excel convention:
/// - 0.0 = 00:00 (midnight)
/// - 0.5 = 12:00 (noon)
/// - 1.0 wraps to 0.0
fn coerce_to_time(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => {
            let frac = normalize_fractional_day(n.get());
            CoercionResult::ok(CellValueResult::Number(frac))
        }
        CellValue::Text(s) => parse_time_string(s.trim()),
        _ => CoercionResult::err("Cannot coerce value to time"),
    }
}

/// Normalize a number to the fractional-day range [0, 1).
fn normalize_fractional_day(n: f64) -> f64 {
    let frac = n % 1.0;
    if frac < 0.0 { frac + 1.0 } else { frac }
}

/// Parse a time string into a fractional day.
fn parse_time_string(s: &str) -> CoercionResult {
    // Try 12-hour format first (must check before 24h because "2:30 PM" contains a colon)
    if let Some(frac) = try_parse_12h(s) {
        return CoercionResult::ok(CellValueResult::Number(frac));
    }

    // Try 24-hour format (HH:MM or HH:MM:SS)
    if let Some(frac) = try_parse_24h(s) {
        return CoercionResult::ok(CellValueResult::Number(frac));
    }

    // Try compact format (HHMM or HHMMSS)
    if let Some(frac) = try_parse_compact_time(s) {
        return CoercionResult::ok(CellValueResult::Number(frac));
    }

    // Try as a number and normalize
    if let Ok(n) = s.parse::<f64>()
        && n.is_finite()
    {
        return CoercionResult::ok(CellValueResult::Number(normalize_fractional_day(n)));
    }

    CoercionResult::err(format!("Cannot coerce \"{s}\" to time"))
}

/// Try to parse a 24-hour time string like "14:30" or "14:30:45".
fn try_parse_24h(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else {
        0.0
    };
    if !(0.0..=23.0).contains(&hours)
        || !(0.0..=59.0).contains(&minutes)
        || !(0.0..60.0).contains(&seconds)
    {
        return None;
    }
    Some((hours + minutes / 60.0 + seconds / 3600.0) / 24.0)
}

/// Try to parse a 12-hour time string like "2:30 PM" or "12:00:00 AM".
fn try_parse_12h(s: &str) -> Option<f64> {
    let s_lower = s.to_ascii_lowercase();
    let trimmed = s_lower.trim();

    let (time_part, meridiem) = if trimmed.ends_with("am") || trimmed.ends_with("pm") {
        let meridiem_start = trimmed.len() - 2;
        let time_str = trimmed[..meridiem_start].trim();
        let mer = &trimmed[meridiem_start..];
        (time_str.to_string(), mer.to_string())
    } else if trimmed.ends_with("a.m.") || trimmed.ends_with("p.m.") {
        let meridiem_start = trimmed.len() - 4;
        let time_str = trimmed[..meridiem_start].trim();
        let mer = if trimmed.ends_with("a.m.") {
            "am"
        } else {
            "pm"
        };
        (time_str.to_string(), mer.to_string())
    } else {
        return None;
    };

    let parts: Vec<&str> = time_part.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let mut hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else {
        0.0
    };

    if !(1.0..=12.0).contains(&hours)
        || !(0.0..=59.0).contains(&minutes)
        || !(0.0..60.0).contains(&seconds)
    {
        return None;
    }

    // Convert 12-hour to 24-hour
    if meridiem.starts_with('p') && hours != 12.0 {
        hours += 12.0;
    } else if meridiem.starts_with('a') && hours == 12.0 {
        hours = 0.0;
    }

    Some((hours + minutes / 60.0 + seconds / 3600.0) / 24.0)
}

/// Try to parse compact time format like "1430" or "143045".
fn try_parse_compact_time(s: &str) -> Option<f64> {
    if s.len() != 4 && s.len() != 6 {
        return None;
    }
    if !s.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let hours: f64 = s[..2].parse().ok()?;
    let minutes: f64 = s[2..4].parse().ok()?;
    let seconds: f64 = if s.len() == 6 {
        s[4..6].parse().ok()?
    } else {
        0.0
    };
    if hours > 23.0 || minutes > 59.0 || seconds > 59.0 {
        return None;
    }
    Some((hours + minutes / 60.0 + seconds / 3600.0) / 24.0)
}

/// Coerce to currency — numbers pass through, strings have currency symbols extracted.
fn coerce_to_currency(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Number(n.get())),
        CellValue::Text(s) => {
            let trimmed = s.trim();
            // Extract number from currency string, handling parentheses for negatives
            let is_negative = trimmed.contains('(') || trimmed.contains('-');
            let cleaned = strip_currency_and_commas(&trimmed.replace(['(', ')'], ""));
            if let Ok(n) = cleaned.parse::<f64>()
                && n.is_finite()
            {
                let result = if is_negative && n > 0.0 { -n } else { n };
                return CoercionResult::ok(CellValueResult::Number(result));
            }
            // Fallback to generic number coercion
            coerce_to_number(value)
        }
        _ => coerce_to_number(value),
    }
}

/// Coerce to percentage.
///
/// Numbers > 1 in absolute value are assumed to be whole-number percentages
/// (e.g., 50 -> 0.50). Numbers <= 1 are already in decimal form.
fn coerce_to_percentage(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => {
            let v = n.get();
            if v.abs() > 1.0 {
                CoercionResult::ok(CellValueResult::Number(v / 100.0))
            } else {
                CoercionResult::ok(CellValueResult::Number(v))
            }
        }
        CellValue::Text(s) => {
            let trimmed = s.trim();
            // Explicit percentage sign
            if let Some(before_pct) = trimmed.strip_suffix('%')
                && let Ok(n) = before_pct.trim().parse::<f64>()
            {
                return CoercionResult::ok(CellValueResult::Number(n / 100.0));
            }
            // Plain number
            if let Ok(n) = trimmed.parse::<f64>()
                && n.is_finite()
            {
                return if n.abs() <= 1.0 {
                    CoercionResult::ok(CellValueResult::Number(n))
                } else {
                    CoercionResult::ok(CellValueResult::Number(n / 100.0))
                };
            }
            CoercionResult::err(format!("Cannot coerce \"{s}\" to percentage"))
        }
        _ => CoercionResult::err("Cannot coerce value to percentage"),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::FiniteF64;

    /// Helper: create a `CellValue::Number` from a raw f64.
    fn num(n: f64) -> CellValue {
        CellValue::Number(FiniteF64::new(n).unwrap())
    }

    /// Helper: create a `CellValue::Text`.
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    /// Helper: assert a coercion result is successful with a specific number.
    fn assert_num_result(result: &CoercionResult, expected: f64) {
        assert!(
            result.success,
            "expected success, got error: {:?}",
            result.error
        );
        match &result.value {
            Some(CellValueResult::Number(n)) => {
                assert!(
                    (n - expected).abs() < 0.001,
                    "expected ~{expected}, got {n}"
                );
            }
            other => panic!("expected Number({expected}), got {other:?}"),
        }
    }

    /// Helper: assert a coercion result is successful with a specific text.
    fn assert_text_result(result: &CoercionResult, expected: &str) {
        assert!(
            result.success,
            "expected success, got error: {:?}",
            result.error
        );
        match &result.value {
            Some(CellValueResult::Text(s)) => assert_eq!(s, expected),
            other => panic!("expected Text(\"{expected}\"), got {other:?}"),
        }
    }

    /// Helper: assert a coercion result is successful with a specific boolean.
    fn assert_bool_result(result: &CoercionResult, expected: bool) {
        assert!(
            result.success,
            "expected success, got error: {:?}",
            result.error
        );
        match &result.value {
            Some(CellValueResult::Boolean(b)) => assert_eq!(*b, expected),
            other => panic!("expected Boolean({expected}), got {other:?}"),
        }
    }

    /// Helper: assert a coercion result is a Null success.
    fn assert_null_result(result: &CoercionResult) {
        assert!(
            result.success,
            "expected success, got error: {:?}",
            result.error
        );
        assert_eq!(result.value, Some(CellValueResult::Null));
    }

    /// Helper: assert a coercion result is an error.
    fn assert_err(result: &CoercionResult) {
        assert!(
            !result.success,
            "expected error, got success: {:?}",
            result.value
        );
        assert!(result.error.is_some());
    }

    // ----- Null handling -----

    #[test]
    fn null_to_null() {
        let r = coerce(&CellValue::Null, SchemaType::Null);
        assert_null_result(&r);
    }

    #[test]
    fn null_to_any() {
        let r = coerce(&CellValue::Null, SchemaType::Any);
        assert_null_result(&r);
    }

    #[test]
    fn null_to_string() {
        let r = coerce(&CellValue::Null, SchemaType::String);
        assert_text_result(&r, "");
    }

    #[test]
    fn null_to_number() {
        let r = coerce(&CellValue::Null, SchemaType::Number);
        assert_err(&r);
    }

    // ----- Boolean coercion -----

    #[test]
    fn bool_to_bool() {
        let r = coerce(&CellValue::Boolean(true), SchemaType::Boolean);
        assert_bool_result(&r, true);
        let r = coerce(&CellValue::Boolean(false), SchemaType::Boolean);
        assert_bool_result(&r, false);
    }

    #[test]
    fn number_to_bool() {
        let r = coerce(&num(0.0), SchemaType::Boolean);
        assert_bool_result(&r, false);
        let r = coerce(&num(1.0), SchemaType::Boolean);
        assert_bool_result(&r, true);
        let r = coerce(&num(-5.0), SchemaType::Boolean);
        assert_bool_result(&r, true);
    }

    #[test]
    fn text_true_to_bool() {
        assert_bool_result(&coerce(&text("true"), SchemaType::Boolean), true);
        assert_bool_result(&coerce(&text("yes"), SchemaType::Boolean), true);
        assert_bool_result(&coerce(&text("1"), SchemaType::Boolean), true);
        assert_bool_result(&coerce(&text("on"), SchemaType::Boolean), true);
        assert_bool_result(&coerce(&text("TRUE"), SchemaType::Boolean), true);
        assert_bool_result(&coerce(&text("Yes"), SchemaType::Boolean), true);
    }

    #[test]
    fn text_false_to_bool() {
        assert_bool_result(&coerce(&text("false"), SchemaType::Boolean), false);
        assert_bool_result(&coerce(&text("no"), SchemaType::Boolean), false);
        assert_bool_result(&coerce(&text("0"), SchemaType::Boolean), false);
        assert_bool_result(&coerce(&text("off"), SchemaType::Boolean), false);
        assert_bool_result(&coerce(&text(""), SchemaType::Boolean), false);
    }

    #[test]
    fn invalid_text_to_bool() {
        assert_err(&coerce(&text("maybe"), SchemaType::Boolean));
    }

    // ----- Number coercion -----

    #[test]
    fn number_to_number() {
        let r = coerce(&num(42.5), SchemaType::Number);
        assert_num_result(&r, 42.5);
    }

    #[test]
    fn bool_to_number() {
        assert_num_result(&coerce(&CellValue::Boolean(true), SchemaType::Number), 1.0);
        assert_num_result(&coerce(&CellValue::Boolean(false), SchemaType::Number), 0.0);
    }

    #[test]
    fn text_to_number() {
        assert_num_result(&coerce(&text("42"), SchemaType::Number), 42.0);
        assert_num_result(&coerce(&text("3.14"), SchemaType::Number), 3.14);
        assert_num_result(&coerce(&text("-7"), SchemaType::Number), -7.0);
    }

    #[test]
    fn currency_text_to_number() {
        assert_num_result(&coerce(&text("$1,234.56"), SchemaType::Number), 1234.56);
        assert_num_result(&coerce(&text("\u{20ac}50.00"), SchemaType::Number), 50.0);
        assert_num_result(&coerce(&text("\u{00a3}99.99"), SchemaType::Number), 99.99);
    }

    #[test]
    fn percentage_text_to_number() {
        assert_num_result(&coerce(&text("50%"), SchemaType::Number), 0.5);
        assert_num_result(&coerce(&text("12.5%"), SchemaType::Number), 0.125);
    }

    #[test]
    fn invalid_text_to_number() {
        assert_err(&coerce(&text("abc"), SchemaType::Number));
    }

    // ----- Integer coercion -----

    #[test]
    fn integer_coercion_rounds() {
        assert_num_result(&coerce(&num(3.7), SchemaType::Integer), 4.0);
        assert_num_result(&coerce(&num(3.2), SchemaType::Integer), 3.0);
        assert_num_result(&coerce(&num(5.0), SchemaType::Integer), 5.0);
    }

    // ----- String coercion -----

    #[test]
    fn string_identity() {
        assert_text_result(&coerce(&text("hello"), SchemaType::String), "hello");
    }

    #[test]
    fn number_to_string() {
        assert_text_result(&coerce(&num(42.0), SchemaType::String), "42");
        assert_text_result(&coerce(&num(42.5), SchemaType::String), "42.5");
    }

    #[test]
    fn bool_to_string() {
        assert_text_result(
            &coerce(&CellValue::Boolean(true), SchemaType::String),
            "true",
        );
    }

    #[test]
    fn null_coerced_to_empty_string() {
        assert_text_result(&coerce(&CellValue::Null, SchemaType::String), "");
    }

    // ----- Date coercion -----

    #[test]
    fn date_from_number() {
        assert_num_result(&coerce(&num(44927.0), SchemaType::Date), 44927.0);
    }

    #[test]
    fn date_from_date_string() {
        let r = coerce(&text("2024-12-11"), SchemaType::Date);
        assert_text_result(&r, "2024-12-11");
    }

    #[test]
    fn date_from_invalid_string() {
        assert_err(&coerce(&text("not a date"), SchemaType::Date));
    }

    // ----- Time coercion -----

    #[test]
    fn time_from_number() {
        assert_num_result(&coerce(&num(0.5), SchemaType::Time), 0.5);
    }

    #[test]
    fn time_from_number_normalizes() {
        assert_num_result(&coerce(&num(1.75), SchemaType::Time), 0.75);
    }

    #[test]
    fn time_from_24h_string() {
        // "14:30" -> (14 + 30/60) / 24 = 14.5/24 = 0.604166...
        let r = coerce(&text("14:30"), SchemaType::Time);
        assert_num_result(&r, 0.604166);
    }

    #[test]
    fn time_from_12h_string() {
        // "2:30 PM" -> 14:30 -> same as above
        let r = coerce(&text("2:30 PM"), SchemaType::Time);
        assert_num_result(&r, 0.604166);
    }

    #[test]
    fn time_from_compact_string() {
        let r = coerce(&text("1430"), SchemaType::Time);
        assert_num_result(&r, 0.604166);
    }

    #[test]
    fn time_midnight() {
        let r = coerce(&text("00:00"), SchemaType::Time);
        assert_num_result(&r, 0.0);
    }

    #[test]
    fn time_from_invalid_string() {
        assert_err(&coerce(&text("not-a-time"), SchemaType::Time));
    }

    // ----- Currency coercion -----

    #[test]
    fn currency_from_number() {
        assert_num_result(&coerce(&num(99.99), SchemaType::Currency), 99.99);
    }

    #[test]
    fn currency_from_text() {
        assert_num_result(&coerce(&text("$1,234.56"), SchemaType::Currency), 1234.56);
        assert_num_result(&coerce(&text("\u{20ac}50"), SchemaType::Currency), 50.0);
    }

    #[test]
    fn currency_negative_parentheses() {
        let r = coerce(&text("($100)"), SchemaType::Currency);
        assert_num_result(&r, -100.0);
    }

    // ----- Percentage coercion -----

    #[test]
    fn percentage_from_big_number() {
        assert_num_result(&coerce(&num(50.0), SchemaType::Percentage), 0.5);
    }

    #[test]
    fn percentage_from_small_number() {
        assert_num_result(&coerce(&num(0.5), SchemaType::Percentage), 0.5);
    }

    #[test]
    fn percentage_from_text() {
        assert_num_result(&coerce(&text("75%"), SchemaType::Percentage), 0.75);
        assert_num_result(&coerce(&text("100%"), SchemaType::Percentage), 1.0);
    }

    #[test]
    fn percentage_from_text_number() {
        assert_num_result(&coerce(&text("0.25"), SchemaType::Percentage), 0.25);
        assert_num_result(&coerce(&text("50"), SchemaType::Percentage), 0.5);
    }

    // ----- Any type -----

    #[test]
    fn any_accepts_everything() {
        assert_num_result(&coerce(&num(42.0), SchemaType::Any), 42.0);
        assert_text_result(&coerce(&text("hello"), SchemaType::Any), "hello");
        assert_bool_result(&coerce(&CellValue::Boolean(true), SchemaType::Any), true);
        assert_null_result(&coerce(&CellValue::Null, SchemaType::Any));
    }

    // ----- Entity / semantic string types -----

    #[test]
    fn email_coerces_as_string() {
        assert_text_result(
            &coerce(&text("user@example.com"), SchemaType::Email),
            "user@example.com",
        );
    }

    #[test]
    fn url_coerces_as_string() {
        assert_text_result(
            &coerce(&text("https://example.com"), SchemaType::Url),
            "https://example.com",
        );
    }

    #[test]
    fn null_to_entity_types() {
        assert_text_result(&coerce(&CellValue::Null, SchemaType::Email), "");
        assert_text_result(&coerce(&CellValue::Null, SchemaType::Url), "");
        assert_text_result(&coerce(&CellValue::Null, SchemaType::Phone), "");
        assert_text_result(&coerce(&CellValue::Null, SchemaType::Company), "");
        assert_text_result(&coerce(&CellValue::Null, SchemaType::Person), "");
        assert_text_result(&coerce(&CellValue::Null, SchemaType::Stock), "");
        assert_text_result(&coerce(&CellValue::Null, SchemaType::Location), "");
    }

    // ----- Distribution -----

    #[test]
    fn distribution_coerces_as_number() {
        assert_num_result(&coerce(&num(3.14), SchemaType::Distribution), 3.14);
    }

    // ----- Null to null type -----

    #[test]
    fn coerce_falsy_to_null() {
        assert_null_result(&coerce(&text(""), SchemaType::Null));
        assert_null_result(&coerce(&num(0.0), SchemaType::Null));
        assert_null_result(&coerce(&CellValue::Boolean(false), SchemaType::Null));
    }

    #[test]
    fn coerce_truthy_to_null_fails() {
        assert_err(&coerce(&text("hello"), SchemaType::Null));
        assert_err(&coerce(&num(42.0), SchemaType::Null));
    }

    // ══════════════════════════════════════════════════════════════════
    // First-principle tests
    // ══════════════════════════════════════════════════════════════════

    // Principle: "$-100" should coerce to -100.0 (negative one hundred dollars)
    #[test]
    fn currency_negative_with_minus_sign() {
        let r = coerce(&text("$-100"), SchemaType::Currency);
        assert!(r.success, "Should successfully coerce $-100");
        assert_num_result(&r, -100.0);
    }

    // Principle: "-$100" should also coerce to -100.0
    #[test]
    fn currency_negative_with_leading_minus() {
        let r = coerce(&text("-$100"), SchemaType::Currency);
        assert!(r.success, "Should successfully coerce -$100");
        assert_num_result(&r, -100.0);
    }

    // Principle: "($100)" is accounting notation for -100.0
    #[test]
    fn currency_parentheses_accounting_notation() {
        let r = coerce(&text("($100)"), SchemaType::Currency);
        assert!(r.success);
        assert_num_result(&r, -100.0);
    }

    // Principle: "$100" should be positive 100.0 (no negation)
    #[test]
    fn currency_positive_no_negation() {
        let r = coerce(&text("$100"), SchemaType::Currency);
        assert!(r.success);
        assert_num_result(&r, 100.0);
    }

    // Principle: Negative time numbers should normalize to [0, 1)
    #[test]
    fn time_negative_normalizes() {
        let r = coerce(&num(-0.25), SchemaType::Time);
        assert!(r.success);
        assert_num_result(&r, 0.75);
    }

    // Principle: Time > 1 wraps around. 1.5 -> 0.5 (noon)
    #[test]
    fn time_wraps_past_one() {
        let r = coerce(&num(1.5), SchemaType::Time);
        assert!(r.success);
        assert_num_result(&r, 0.5);
    }

    // Principle: 12:00 AM = midnight = 0.0
    #[test]
    fn time_12am_is_midnight() {
        let r = coerce(&text("12:00 AM"), SchemaType::Time);
        assert!(r.success);
        assert_num_result(&r, 0.0);
    }

    // Principle: 12:00 PM = noon = 0.5
    #[test]
    fn time_12pm_is_noon() {
        let r = coerce(&text("12:00 PM"), SchemaType::Time);
        assert!(r.success);
        assert_num_result(&r, 0.5);
    }

    // Principle: 23:59:59 should be just under 1.0
    #[test]
    fn time_end_of_day() {
        let r = coerce(&text("23:59:59"), SchemaType::Time);
        assert!(r.success);
        match &r.value {
            Some(CellValueResult::Number(n)) => {
                assert!(*n > 0.999, "23:59:59 should be > 0.999, got {}", n);
                assert!(*n < 1.0, "23:59:59 should be < 1.0, got {}", n);
            }
            other => panic!("Expected Number, got {:?}", other),
        }
    }

    // Principle: Exactly 1.0 as percentage — treated as decimal form (100%)
    #[test]
    fn percentage_exactly_one_is_decimal_form() {
        let r = coerce(&num(1.0), SchemaType::Percentage);
        assert!(r.success);
        assert_num_result(&r, 1.0);
    }

    // Principle: -1.0 has abs() <= 1.0, should stay as -1.0 (-100%)
    #[test]
    fn percentage_negative_one_is_decimal_form() {
        let r = coerce(&num(-1.0), SchemaType::Percentage);
        assert!(r.success);
        assert_num_result(&r, -1.0);
    }

    // Principle: 1.01 has abs() > 1.0, so divided by 100 -> 0.0101
    #[test]
    fn percentage_just_over_one_divides() {
        let r = coerce(&num(1.01), SchemaType::Percentage);
        assert!(r.success);
        assert_num_result(&r, 0.0101);
    }

    // Principle: 0% text should be 0.0
    #[test]
    fn percentage_zero_text() {
        let r = coerce(&text("0%"), SchemaType::Percentage);
        assert!(r.success);
        assert_num_result(&r, 0.0);
    }

    // Principle: Error values should fail coercion to most types
    #[test]
    fn error_to_number_fails() {
        let err_val = CellValue::Error(value_types::CellError::Value, None);
        assert_err(&coerce(&err_val, SchemaType::Number));
    }

    // Principle: Error values coerced to String should produce error text
    #[test]
    fn error_to_string_produces_text() {
        let err_val = CellValue::Error(value_types::CellError::Value, None);
        let r = coerce(&err_val, SchemaType::String);
        assert!(r.success, "Error should be coercible to string");
    }

    // Principle: Array values coerced to String should produce "[Array]"
    #[test]
    fn array_to_string_produces_array_text() {
        let arr = CellValue::from_rows(vec![]);
        let r = coerce(&arr, SchemaType::String);
        assert!(r.success);
        assert_text_result(&r, "[Array]");
    }

    // Principle: Array values should fail coercion to Number
    #[test]
    fn array_to_number_fails() {
        let arr = CellValue::from_rows(vec![]);
        assert_err(&coerce(&arr, SchemaType::Number));
    }

    // Principle: Integer coercion from text should parse and round
    #[test]
    fn integer_from_text() {
        assert_num_result(&coerce(&text("42"), SchemaType::Integer), 42.0);
        assert_num_result(&coerce(&text("3.7"), SchemaType::Integer), 4.0);
        assert_num_result(&coerce(&text("3.2"), SchemaType::Integer), 3.0);
    }

    // Principle: Non-numeric text should fail integer coercion
    #[test]
    fn integer_from_non_numeric_text_fails() {
        assert_err(&coerce(&text("abc"), SchemaType::Integer));
    }

    // -- Coverage: a.m./p.m. time format variants --

    #[test]
    fn time_from_am_dot_format() {
        let r = coerce(&text("2:30 a.m."), SchemaType::Time);
        assert!(r.success, "a.m. format should be recognized");
        assert_num_result(&r, 2.5 / 24.0);
    }

    #[test]
    fn time_from_pm_dot_format() {
        let r = coerce(&text("2:30 p.m."), SchemaType::Time);
        assert!(r.success);
        assert_num_result(&r, 14.5 / 24.0);
    }

    #[test]
    fn time_1_30_am() {
        let r = coerce(&text("1:30 AM"), SchemaType::Time);
        assert!(r.success);
        assert_num_result(&r, 1.5 / 24.0);
    }

    #[test]
    fn time_1_30_pm() {
        let r = coerce(&text("1:30 PM"), SchemaType::Time);
        assert!(r.success);
        assert_num_result(&r, 13.5 / 24.0);
    }

    #[test]
    fn time_12h_with_seconds() {
        let r = coerce(&text("2:30:45 PM"), SchemaType::Time);
        assert!(r.success);
        let expected = (14.0 + 30.0 / 60.0 + 45.0 / 3600.0) / 24.0;
        assert_num_result(&r, expected);
    }

    // -- Coverage: date/time from numeric text --

    #[test]
    fn date_from_numeric_text() {
        let r = coerce(&text("44927"), SchemaType::Date);
        assert!(r.success);
        assert_num_result(&r, 44927.0);
    }

    #[test]
    fn time_from_numeric_text() {
        let r = coerce(&text("0.25"), SchemaType::Time);
        assert!(r.success);
        assert_num_result(&r, 0.25);
    }

    // -- Coverage: percentage edge cases --

    #[test]
    fn percentage_negative_text() {
        let r = coerce(&text("-50%"), SchemaType::Percentage);
        assert!(r.success);
        assert_num_result(&r, -0.5);
    }

    #[test]
    fn percentage_invalid_text() {
        assert_err(&coerce(&text("abc%"), SchemaType::Percentage));
    }

    #[test]
    fn percentage_bare_percent_sign() {
        assert_err(&coerce(&text("%"), SchemaType::Percentage));
    }

    // -- Coverage: currency fallback --

    #[test]
    fn currency_plain_number_text() {
        let r = coerce(&text("100"), SchemaType::Currency);
        assert!(r.success);
        assert_num_result(&r, 100.0);
    }

    #[test]
    fn currency_from_boolean() {
        let r = coerce(&CellValue::Boolean(true), SchemaType::Currency);
        assert!(r.success);
        assert_num_result(&r, 1.0);
    }

    // -- Coverage: null to non-null types --

    #[test]
    fn null_to_boolean_fails() {
        assert_err(&coerce(&CellValue::Null, SchemaType::Boolean));
    }

    #[test]
    fn null_to_date_fails() {
        assert_err(&coerce(&CellValue::Null, SchemaType::Date));
    }

    #[test]
    fn null_to_time_fails() {
        assert_err(&coerce(&CellValue::Null, SchemaType::Time));
    }

    #[test]
    fn null_to_integer_fails() {
        assert_err(&coerce(&CellValue::Null, SchemaType::Integer));
    }

    // -- Coverage: compact time with seconds --

    #[test]
    fn time_compact_with_seconds() {
        let r = coerce(&text("143045"), SchemaType::Time);
        assert!(r.success);
        let expected = (14.0 + 30.0 / 60.0 + 45.0 / 3600.0) / 24.0;
        assert_num_result(&r, expected);
    }
}
