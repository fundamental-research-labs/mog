use super::*;

#[test]
fn parse_input_value_percent_hint_bare_number() {
    match parse_input_value("11", Some(FormatType::Percentage)) {
        ParsedValue::Number(n) => assert!((n - 0.11).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(0.11), got {other:?}"),
    }
}

/// G1: negative bare number into a percent cell.

#[test]
fn parse_input_value_percent_hint_negative_bare_number() {
    match parse_input_value("-5", Some(FormatType::Percentage)) {
        ParsedValue::Number(n) => assert!((n - -0.05).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(-0.05), got {other:?}"),
    }
}

/// G1 regression guard: input shape already has `%` — `parse_formatted_number`
/// divides; the hint must NOT double-divide.

#[test]
fn parse_input_value_percent_hint_input_with_percent_does_not_double_divide() {
    match parse_input_value("50%", Some(FormatType::Percentage)) {
        ParsedValue::Number(n) => assert!((n - 0.5).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(0.5), got {other:?}"),
    }
}

/// Invariant: date-shaped input into an explicit non-date
/// format (here Percentage) falls through to text rather than coercing
/// to a date serial the format would misrender. Excel parity:
/// "format-aware text fallback." Pairs with the Phase-1 stickiness
/// guard in the engine — the cell keeps its Percentage format AND the
/// value is text, not a serial under the wrong format.

#[test]
fn parse_input_value_percent_hint_date_input_falls_through_to_text() {
    match parse_input_value("3/14/2024", Some(FormatType::Percentage)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/14/2024"),
        other => panic!("expected Text(\"3/14/2024\"), got {other:?}"),
    }
}

/// G1 regression guard: `"$100"` into a percent cell stays `Number(100)`.
/// Currency-prefix path classifies via `parse_formatted_number`; hint
/// must NOT divide.

#[test]
fn parse_input_value_percent_hint_currency_prefix_stays_unchanged() {
    match parse_input_value("$100", Some(FormatType::Percentage)) {
        ParsedValue::Number(n) => assert!((n - 100.0).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(100), got {other:?}"),
    }
}

/// G1 regression guard: format-blind path unchanged for bare number.

#[test]
fn parse_input_value_no_hint_bare_number_unchanged() {
    assert_eq!(parse_input_value("11", None), ParsedValue::Number(11.0));
}

/// G3: bare "1/2" into a fraction-formatted cell parses as 0.5.

#[test]
fn parse_input_value_fraction_hint_bare_fraction() {
    match parse_input_value("1/2", Some(FormatType::Fraction)) {
        ParsedValue::Number(n) => assert!((n - 0.5).abs() < 1e-12, "got {n}"),
        other => panic!("expected Number(0.5), got {other:?}"),
    }
}

/// Format-blind path uses the culture-aware date parser. Two-part slash
/// dates use the parser's explicit default year (2000), so `"1/2"` is
/// January 2, 2000 rather than a fraction.

#[test]
fn parse_input_value_no_hint_slash_date_uses_default_year() {
    match parse_input_value("1/2", None) {
        ParsedValue::Number(n) => assert!((n - 36527.0).abs() < 1e-9, "got {n}"),
        other => panic!("expected Number(36527), got {other:?}"),
    }
}

// ── Date-branch hint awareness ─────────────────────────────────────
//
// An explicit non-date target format suppresses date-shape coercion so
// the input falls through to text rather than landing as a serial under
// a format that will misrender it ("format-aware text fallback," Excel
// parity). General/None/Date/Time/Custom remain permissive.
/// `"3/15/2024"` into a Fraction-formatted cell is text — the
/// fraction parser fails on this shape and we no longer fall back to
/// the date branch.

#[test]
fn parse_input_value_fraction_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Fraction)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Number-formatted cell rejects date-shaped input.

#[test]
fn parse_input_value_number_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Number)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Currency-formatted cell rejects date-shaped input.

#[test]
fn parse_input_value_currency_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Currency)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Accounting-formatted cell rejects date-shaped input.

#[test]
fn parse_input_value_accounting_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Accounting)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Percentage-formatted cell rejects date-shaped input. Pairs
/// with `parse_input_value_percent_hint_date_input_falls_through_to_text`
/// which uses the older `"3/14/2024"` literal — keep both for breadth.

#[test]
fn parse_input_value_percentage_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Percentage)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Scientific-formatted cell rejects date-shaped input.

#[test]
fn parse_input_value_scientific_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Scientific)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2: Special-formatted cell (ZIP/Phone/SSN) rejects date-shaped
/// input — like other non-date explicit formats, the user told us what
/// shape this cell holds.

#[test]
fn parse_input_value_special_hint_date_shaped_falls_through_to_text() {
    match parse_input_value("3/15/2024", Some(FormatType::Special)) {
        ParsedValue::Text(s) => assert_eq!(s, "3/15/2024"),
        other => panic!("expected Text(\"3/15/2024\"), got {other:?}"),
    }
}

/// Phase-2 negative control: `None` hint keeps the historical
/// permissive behavior — date-shaped input lands as a serial.

#[test]
fn parse_input_value_no_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", None) {
        ParsedValue::Number(n) => {
            // 3/15/2024 → Excel serial 45366 on 1900 epoch.
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}

/// Phase-2 negative control: `General` hint keeps the historical
/// permissive behavior. Pairs with the engine-side auto-inference
/// regression guard: General cells get an inferred date format
/// applied after the parse.

#[test]
fn parse_input_value_general_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", Some(FormatType::General)) {
        ParsedValue::Number(n) => {
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}

/// Phase-2 negative control: Date hint of course still parses as a
/// serial — that's the format-matched case the date branch is for.

#[test]
fn parse_input_value_date_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", Some(FormatType::Date)) {
        ParsedValue::Number(n) => {
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}

/// Phase-2 negative control: `Custom` stays permissive on the date
/// branch — by definition we don't know what a custom format expects.
/// Phase-1 stickiness still keeps the format string intact.

#[test]
fn parse_input_value_custom_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", Some(FormatType::Custom)) {
        ParsedValue::Number(n) => {
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}

/// Phase-2 negative control: Time hint stays permissive — time and
/// date share the serial space, so date-shaped input under a Time
/// format still parses to the serial (the user can have a time-of-
/// day-only formatted cell that nonetheless contains a full
/// date-time value).

#[test]
fn parse_input_value_time_hint_date_shaped_still_serial() {
    match parse_input_value("3/15/2024", Some(FormatType::Time)) {
        ParsedValue::Number(n) => {
            assert!((n - 45366.0).abs() < 1e-9, "got {n}");
        }
        other => panic!("expected Number(serial), got {other:?}"),
    }
}
