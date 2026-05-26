//! Integration tests covering specific uncovered code paths in compute-formats.
//!
//! Each test is derived from first-principles Excel behavior, not reverse-engineered
//! from current output.

use compute_formats::*;

// =========================================================================
// 1. A/P format (datetime.rs:171) — single-letter AM/PM variant
// =========================================================================

#[test]
fn ap_format_6am() {
    // Excel: TEXT(0.25, "h:mm A/P") → "6:00 A"
    assert_eq!(format_number(0.25, "h:mm A/P"), "6:00 A");
}

#[test]
fn ap_format_6pm() {
    // Excel: TEXT(0.75, "h:mm A/P") → "6:00 P"
    assert_eq!(format_number(0.75, "h:mm A/P"), "6:00 P");
}

#[test]
fn ap_format_midnight() {
    // Excel: TEXT(0.0, "h:mm A/P") → "12:00 A"
    assert_eq!(format_number(0.0, "h:mm A/P"), "12:00 A");
}

#[test]
fn ap_format_noon() {
    // Excel: TEXT(0.5, "h:mm A/P") → "12:00 P"
    assert_eq!(format_number(0.5, "h:mm A/P"), "12:00 P");
}

// =========================================================================
// 2. Elapsed minutes combined with elapsed hours (datetime.rs:156)
//    [h]:mm — elapsed hours with remaining minutes
// =========================================================================

#[test]
fn elapsed_hours_mm_37h30m() {
    // 1.5625 days = 37.5 hours = 37 hours 30 minutes
    assert_eq!(format_number(1.5625, "[h]:mm"), "37:30");
}

#[test]
fn elapsed_hours_mm_1h() {
    // 1/24 days = 1 hour exactly
    let serial = 1.0 / 24.0;
    assert_eq!(format_number(serial, "[h]:mm"), "1:00");
}

// =========================================================================
// 3. Elapsed seconds with elapsed hours (datetime.rs:163)
//    [h]:mm:ss with sub-second precision that rounds
// =========================================================================

#[test]
fn elapsed_hours_mm_ss_rounds_to_60s() {
    // 0.0007 days = 60.48 seconds → rounds to 60s = 0h 1m 0s
    assert_eq!(format_number(0.0007, "[h]:mm:ss"), "0:01:00");
}

// =========================================================================
// 4. DateMinute1 in elapsed context (datetime.rs:125)
//    [h]:m:ss — single-digit minute (no zero padding) after elapsed hours
// =========================================================================

#[test]
fn elapsed_hours_single_m_no_pad() {
    // 1.5 days = 36 hours, 0 minutes, 0 seconds
    assert_eq!(format_number(1.5, "[h]:m:ss"), "36:0:00");
}

#[test]
fn elapsed_hours_single_m_nonzero() {
    // 1.5 + 5min = 1.5 + 5/1440 ≈ 1.503472...
    // = 36 hours 5 minutes 0 seconds → "36:5:00"
    let serial = 1.5 + 5.0 / 1440.0;
    assert_eq!(format_number(serial, "[h]:m:ss"), "36:5:00");
}

// =========================================================================
// 5. DateSecond1 non-elapsed (datetime.rs:141) — single-digit seconds
// =========================================================================

#[test]
fn single_s_noon() {
    // Excel: TEXT(0.5, "h:mm:s") → "12:00:0"
    assert_eq!(format_number(0.5, "h:mm:s"), "12:00:0");
}

#[test]
fn single_s_with_5_seconds() {
    // 12:00:05 = 0.5 + 5/86400
    let serial = 0.5 + 5.0 / 86400.0;
    assert_eq!(format_number(serial, "h:mm:s"), "12:00:5");
}

// =========================================================================
// 6. SkipWidth in datetime context (datetime.rs:177)
//    _) in a date format should produce a space character
// =========================================================================

#[test]
fn skip_width_in_datetime() {
    // The _) token produces a single space in the output
    let result = format_number(0.5, "h:mm_)ss");
    assert_eq!(result, "12:00 00");
}

// =========================================================================
// 7. Color in datetime context (datetime.rs:178)
//    [Red] in a date format is ignored in text but present in FormatResult
// =========================================================================

#[test]
fn color_in_datetime_text_output() {
    // Color token should not appear in text output
    assert_eq!(format_number(0.5, "[Red]h:mm:ss"), "12:00:00");
}

#[test]
fn color_in_datetime_format_result() {
    // Color should be extracted via format_number_result
    let r = format_number_result(0.5, "[Red]h:mm:ss", &CultureInfo::default());
    assert_eq!(r.text, "12:00:00");
    assert_eq!(r.color, Some(FormatColor::Red));
}

// =========================================================================
// 8. Parser: "General" literal token (parser.rs:257-262)
// =========================================================================

#[test]
fn general_literal_format_number() {
    assert_eq!(format_number(42.0, "General"), "42");
}

#[test]
fn general_literal_format_result() {
    let r = format_number_result(42.0, "General", &CultureInfo::default());
    assert_eq!(r.text, "42");
    assert_eq!(r.color, None);
}

// =========================================================================
// 9. Parser: lone 'E' or 'e' without +/- (parser.rs:113-114)
//    Treated as a literal character, not an exponent
// =========================================================================

#[test]
fn lone_e_is_literal() {
    // E without +/- is literal; the format "0E0" has two Zero placeholders
    // with a literal "E" between them. Should not panic and should contain "E".
    let result = format_number(42.0, "0E0");
    assert!(
        result.contains('E'),
        "lone E should appear as literal in output, got: {}",
        result
    );
}

#[test]
fn lone_lowercase_e_is_literal() {
    let result = format_number(42.0, "0e0");
    assert!(
        result.contains('e'),
        "lone e should appear as literal in output, got: {}",
        result
    );
}

// =========================================================================
// 10. Parser: A/a that is NOT AM/PM or A/P (parser.rs:205-206)
//     Lone 'a' or 'A' becomes a literal
// =========================================================================

#[test]
fn lone_a_is_literal() {
    // "0a" — 'a' is not followed by '/P' or 'M/PM', so it's a literal
    assert_eq!(format_number(42.0, "0a"), "42a");
}

#[test]
fn lone_uppercase_a_is_literal() {
    assert_eq!(format_number(42.0, "0A"), "42A");
}

// =========================================================================
// 11. Parser: RepeatFill *x token (parser.rs:146-149)
//     *- in a format fills with a repeat character; in string output it is
//     currently ignored (skipped), so it should not break output
// =========================================================================

#[test]
fn repeat_fill_ignored_in_string_output() {
    let result = format_number(42.0, "0*-");
    // RepeatFill is not rendered in fixed-width string output
    assert_eq!(result, "42");
}

// =========================================================================
// 12. Parser: SkipWidth _x (parser.rs:138-143)
//     _) produces a space; verify _( also works
// =========================================================================

#[test]
fn skip_width_paren_right() {
    assert_eq!(format_number(123.0, "0_)"), "123 ");
}

#[test]
fn skip_width_paren_left() {
    assert_eq!(format_number(123.0, "0_("), "123 ");
}

#[test]
fn skip_width_underscore_dash() {
    assert_eq!(format_number(123.0, "0_-"), "123 ");
}

// =========================================================================
// 13. Parser: bracket locale override [$symbol-localeId]
//     (parser.rs:163-168) — symbol extraction from locale bracket
// =========================================================================

#[test]
fn locale_bracket_with_symbol() {
    // [$CHF-807] extracts "CHF" as a literal prefix
    assert_eq!(format_number(1234.0, "[$CHF-807]#,##0"), "CHF1,234");
}

#[test]
fn locale_bracket_empty_symbol() {
    // [$-809] has no symbol before the dash — just a locale ID, no literal emitted
    assert_eq!(format_number(1234.0, "[$-809]#,##0"), "1,234");
}

// =========================================================================
// 14. Parser: unknown bracket content (parser.rs:185)
//     Brackets that aren't color, condition, elapsed, or locale
//     become a literal "[content]"
// =========================================================================

#[test]
fn unknown_bracket_becomes_literal() {
    // [DBNum1] is not a recognized bracket type, so it becomes literal "[DBNum1]"
    let result = format_number(42.0, "[DBNum1]0");
    assert_eq!(result, "[DBNum1]42");
}

// =========================================================================
// 15. Fraction slash that is NOT a fraction (parser.rs:101-102)
//     '/' where context doesn't match fraction pattern becomes literal
// =========================================================================

#[test]
fn slash_without_following_placeholder_is_literal() {
    // "/" not preceded by digit placeholder and not followed by digit placeholder
    // is treated as a literal slash
    let result = format_number(42.0, "0 / ");
    // The slash is a literal; there are no fraction placeholders after it
    assert!(
        result.contains('/'),
        "bare slash should be literal, got: {}",
        result
    );
}

#[test]
fn slash_with_digit_placeholders_is_fraction() {
    // "0/0" — preceded by digit placeholder, followed by digit placeholder → fraction
    // 42.0 as fraction with denominator up to 9: "42/ " or similar integer representation
    let result = format_number(0.5, "0/0");
    // 0.5 = 1/2
    assert!(
        result.contains('/'),
        "fraction slash should produce fraction output, got: {}",
        result
    );
}
