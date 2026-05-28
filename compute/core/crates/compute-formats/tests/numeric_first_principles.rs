//! First-principles integration tests for compute-formats.
//!
//! Expected values are derived from the Excel format code specification,
//! NOT from running the current implementation. If the code has a bug,
//! these tests should catch it.

use compute_formats::*;
use std::sync::Arc;

// =========================================================================
// Helpers
// =========================================================================

fn num(v: f64) -> value_types::CellValue {
    value_types::CellValue::Number(value_types::FiniteF64::new(v).unwrap())
}

fn text(s: &str) -> value_types::CellValue {
    value_types::CellValue::Text(Arc::from(s))
}

fn locale_us() -> CultureInfo {
    CultureInfo::default()
}

fn locale_de() -> CultureInfo {
    CultureInfo {
        decimal_separator: ",".into(),
        thousands_separator: ".".into(),
        ..CultureInfo::default()
    }
}

// =========================================================================
// 1. format_values_batch — batch must match individual format_value calls
// =========================================================================

mod batch {
    use super::*;

    #[test]
    fn batch_matches_individual_for_numbers() {
        let locale = locale_us();
        let entries = vec![
            FormatEntry {
                value: num(1234.5),
                format_code: "#,##0.00".into(),
            },
            FormatEntry {
                value: num(0.0),
                format_code: "0.00".into(),
            },
            FormatEntry {
                value: num(-42.0),
                format_code: "#,##0;(#,##0)".into(),
            },
            FormatEntry {
                value: num(0.5),
                format_code: "0%".into(),
            },
        ];
        let batch = format_values_batch(&entries, &locale);
        for (i, entry) in entries.iter().enumerate() {
            let individual = format_value(&entry.value, &entry.format_code, &locale).text;
            assert_eq!(batch[i], individual, "mismatch at index {i}");
        }
    }

    #[test]
    fn batch_matches_individual_for_mixed_types() {
        let locale = locale_us();
        let entries = vec![
            FormatEntry {
                value: num(42.0),
                format_code: "0.00".into(),
            },
            FormatEntry {
                value: text("hello"),
                format_code: "@".into(),
            },
            FormatEntry {
                value: value_types::CellValue::Boolean(true),
                format_code: "0.00".into(),
            },
            FormatEntry {
                value: value_types::CellValue::Error(value_types::CellError::Div0, None),
                format_code: "".into(),
            },
            FormatEntry {
                value: value_types::CellValue::Null,
                format_code: "#,##0".into(),
            },
        ];
        let batch = format_values_batch(&entries, &locale);
        for (i, entry) in entries.iter().enumerate() {
            let individual = format_value(&entry.value, &entry.format_code, &locale).text;
            assert_eq!(batch[i], individual, "mismatch at index {i}");
        }
    }

    #[test]
    fn batch_empty_input_returns_empty() {
        let batch = format_values_batch(&[], &locale_us());
        assert!(batch.is_empty());
    }

    #[test]
    fn batch_single_entry() {
        let locale = locale_us();
        let entries = vec![FormatEntry {
            value: num(99.9),
            format_code: "0.0".into(),
        }];
        let batch = format_values_batch(&entries, &locale);
        assert_eq!(batch.len(), 1);
        assert_eq!(
            batch[0],
            format_value(&entries[0].value, &entries[0].format_code, &locale).text
        );
    }
}

// =========================================================================
// 2. format_text edge cases
// =========================================================================

mod format_text_tests {
    use super::*;

    #[test]
    fn no_at_placeholder_returns_text_as_is() {
        // If format has no @, text is returned unchanged
        assert_eq!(format_text("hello", "0.00"), "hello");
    }

    #[test]
    fn empty_text_with_at_placeholder() {
        assert_eq!(format_text("", "@"), "");
    }

    #[test]
    fn empty_format_returns_text_as_is() {
        assert_eq!(format_text("hello", ""), "hello");
    }

    #[test]
    fn four_section_format_uses_fourth_section() {
        // 4 sections: pos;neg;zero;text — 4th section applies to text
        let result = format_text("world", "0;0;0;\"hello \"@");
        assert_eq!(result, "hello world");
    }

    #[test]
    fn at_with_prefix_and_suffix() {
        assert_eq!(format_text("name", "\"Mr. \"@\" Jr.\""), "Mr. name Jr.");
    }

    #[test]
    fn just_at_placeholder() {
        assert_eq!(format_text("test", "@"), "test");
    }

    #[test]
    fn format_code_literal_string_no_at() {
        // A format with just literal text and no @ — text passes through unchanged
        assert_eq!(format_text("data", "\"fixed\""), "data");
    }
}

// =========================================================================
// 3. format_value for all CellValue types
// =========================================================================

mod format_value_types {
    use super::*;

    #[test]
    fn number_with_format() {
        let r = format_value(&num(1234.5), "#,##0.00", &locale_us());
        assert_eq!(r.text, "1,234.50");
        assert!(!r.is_error);
        assert_eq!(r.color, None);
    }

    #[test]
    fn number_with_percentage() {
        let r = format_value(&num(0.75), "0%", &locale_us());
        assert_eq!(r.text, "75%");
    }

    #[test]
    fn text_with_at_format() {
        let r = format_value(&text("hello"), "@", &locale_us());
        assert_eq!(r.text, "hello");
        assert!(!r.is_error);
    }

    #[test]
    fn text_with_prefix_format() {
        let r = format_value(&text("world"), "\"hello \"@", &locale_us());
        assert_eq!(r.text, "hello world");
    }

    #[test]
    fn boolean_true_ignores_format() {
        let val = value_types::CellValue::Boolean(true);
        // Boolean should always show TRUE regardless of format code
        assert_eq!(format_value(&val, "0.00", &locale_us()).text, "TRUE");
        assert_eq!(format_value(&val, "#,##0", &locale_us()).text, "TRUE");
        assert_eq!(format_value(&val, "", &locale_us()).text, "TRUE");
    }

    #[test]
    fn boolean_false_ignores_format() {
        let val = value_types::CellValue::Boolean(false);
        assert_eq!(format_value(&val, "0.00", &locale_us()).text, "FALSE");
    }

    #[test]
    fn error_returns_error_string_and_is_error_flag() {
        let val = value_types::CellValue::Error(value_types::CellError::Value, None);
        let r = format_value(&val, "0.00", &locale_us());
        assert_eq!(r.text, "#VALUE!");
        assert!(r.is_error);
    }

    #[test]
    fn error_div0() {
        let val = value_types::CellValue::Error(value_types::CellError::Div0, None);
        let r = format_value(&val, "", &locale_us());
        assert_eq!(r.text, "#DIV/0!");
        assert!(r.is_error);
    }

    #[test]
    fn error_na() {
        let val = value_types::CellValue::Error(value_types::CellError::Na, None);
        let r = format_value(&val, "#,##0", &locale_us());
        assert_eq!(r.text, "#N/A");
        assert!(r.is_error);
    }

    #[test]
    fn error_ref() {
        let val = value_types::CellValue::Error(value_types::CellError::Ref, None);
        let r = format_value(&val, "", &locale_us());
        assert_eq!(r.text, "#REF!");
        assert!(r.is_error);
    }

    #[test]
    fn null_returns_empty_string() {
        let val = value_types::CellValue::Null;
        let r = format_value(&val, "#,##0.00", &locale_us());
        assert_eq!(r.text, "");
        assert!(!r.is_error);
    }

    #[test]
    fn null_ignores_format() {
        let val = value_types::CellValue::Null;
        assert_eq!(format_value(&val, "0.00", &locale_us()).text, "");
        assert_eq!(format_value(&val, "$#,##0", &locale_us()).text, "");
    }

    #[test]
    fn control_uses_boolean_value() {
        let checked = value_types::CellValue::Control(value_types::CellControl::checkbox(true));
        let unchecked = value_types::CellValue::Control(value_types::CellControl::checkbox(false));
        assert_eq!(format_value(&checked, "0.00", &locale_us()).text, "TRUE");
        assert_eq!(
            format_value(&unchecked, "#,##0", &locale_us()).text,
            "FALSE"
        );
    }

    #[test]
    fn image_uses_fallback_text() {
        let image = value_types::CellImage::new(
            "https://example.test/cat.png",
            Some(Arc::from("Quarterly chart")),
            value_types::CellImageSizing::Fit,
            None,
            None,
        );
        let val = value_types::CellValue::Image(image);
        let r = format_value(&val, "$#,##0", &locale_us());
        assert_eq!(r.text, "Quarterly chart");
        assert!(!r.is_error);
    }
}

// =========================================================================
// 4. Conditional sections — all 6 operators
// =========================================================================

mod conditional_sections {
    use super::*;

    #[test]
    fn greater_than() {
        let fmt = "[>100]\"big\";\"small\"";
        assert_eq!(format_number(150.0, fmt), "big");
        assert_eq!(format_number(100.0, fmt), "small"); // not > 100
        assert_eq!(format_number(50.0, fmt), "small");
    }

    #[test]
    fn less_than() {
        let fmt = "[<0]\"neg\";\"non-neg\"";
        assert_eq!(format_number(-5.0, fmt), "neg");
        assert_eq!(format_number(0.0, fmt), "non-neg"); // not < 0
        assert_eq!(format_number(5.0, fmt), "non-neg");
    }

    #[test]
    fn greater_than_or_equal() {
        let fmt = "[>=100]\"big\";\"small\"";
        assert_eq!(format_number(100.0, fmt), "big"); // boundary: exactly 100
        assert_eq!(format_number(101.0, fmt), "big");
        assert_eq!(format_number(99.0, fmt), "small");
    }

    #[test]
    fn less_than_or_equal() {
        let fmt = "[<=0]\"non-pos\";\"pos\"";
        assert_eq!(format_number(0.0, fmt), "non-pos"); // boundary: exactly 0
        assert_eq!(format_number(-1.0, fmt), "non-pos");
        assert_eq!(format_number(1.0, fmt), "pos");
    }

    #[test]
    fn equal() {
        let fmt = "[=0]\"zero\";\"not-zero\"";
        assert_eq!(format_number(0.0, fmt), "zero");
        assert_eq!(format_number(1.0, fmt), "not-zero");
        assert_eq!(format_number(-1.0, fmt), "not-zero");
    }

    #[test]
    fn not_equal() {
        let fmt = "[<>0]\"not-zero\";\"zero\"";
        assert_eq!(format_number(5.0, fmt), "not-zero");
        assert_eq!(format_number(-5.0, fmt), "not-zero");
        assert_eq!(format_number(0.0, fmt), "zero");
    }

    #[test]
    fn three_section_conditional_with_fallback() {
        let fmt = "[>100]\"big\";[<0]\"neg\";\"other\"";
        assert_eq!(format_number(200.0, fmt), "big");
        assert_eq!(format_number(-10.0, fmt), "neg");
        assert_eq!(format_number(50.0, fmt), "other");
        assert_eq!(format_number(0.0, fmt), "other");
    }

    #[test]
    fn conditional_with_numeric_formats() {
        let fmt = "[>=1000]#,##0;0.00";
        assert_eq!(format_number(1500.0, fmt), "1,500");
        assert_eq!(format_number(42.5, fmt), "42.50");
    }
}

// =========================================================================
// 5. Color extraction
// =========================================================================

mod color_extraction {
    use super::*;

    #[test]
    fn red_color() {
        let r = format_number_result(42.0, "[Red]0.00", &locale_us());
        assert_eq!(r.color, Some(FormatColor::Red));
        assert_eq!(r.text, "42.00");
    }

    #[test]
    fn blue_color() {
        let r = format_number_result(10.0, "[Blue]0", &locale_us());
        assert_eq!(r.color, Some(FormatColor::Blue));
        assert_eq!(r.text, "10");
    }

    #[test]
    fn indexed_color() {
        let r = format_number_result(5.0, "[Color1]0", &locale_us());
        assert_eq!(r.color, Some(FormatColor::Index(1)));
    }

    #[test]
    fn no_color_directive() {
        let r = format_number_result(42.0, "0.00", &locale_us());
        assert_eq!(r.color, None);
    }

    #[test]
    fn color_in_negative_section_of_multi_section_format() {
        // positive has no color, negative has [Red]
        let r = format_number_result(-100.0, "#,##0;[Red](#,##0)", &locale_us());
        assert_eq!(r.color, Some(FormatColor::Red));
        assert_eq!(r.text, "(100)");
    }

    #[test]
    fn color_in_positive_section_not_applied_to_negative() {
        // [Green] only in positive section; negative section has no color
        let r = format_number_result(-5.0, "[Green]0;0", &locale_us());
        assert_eq!(r.color, None);
        assert_eq!(r.text, "5"); // negative section shows abs value
    }

    #[test]
    fn color_on_zero_in_three_section_format() {
        let r = format_number_result(0.0, "0;0;[Cyan]0", &locale_us());
        assert_eq!(r.color, Some(FormatColor::Cyan));
        assert_eq!(r.text, "0");
    }
}

// =========================================================================
// 6. Negative number display
// =========================================================================

mod negative_display {
    use super::*;

    #[test]
    fn single_section_prepends_minus() {
        // With only one section, negative numbers get a minus sign prepended
        assert_eq!(format_number(-1234.5, "#,##0.00"), "-1,234.50");
    }

    #[test]
    fn two_section_no_automatic_minus() {
        // 2 sections: second section handles negatives, value passed as abs
        // The format itself must provide the sign display
        assert_eq!(format_number(-1234.0, "#,##0;#,##0"), "1,234");
    }

    #[test]
    fn two_section_with_parentheses() {
        assert_eq!(format_number(-1234.0, "#,##0;(#,##0)"), "(1,234)");
    }

    #[test]
    fn two_section_with_explicit_minus_in_format() {
        assert_eq!(format_number(-1234.0, "#,##0;-#,##0"), "-1,234");
    }

    #[test]
    fn three_section_custom_zero() {
        assert_eq!(format_number(0.0, "#,##0;(#,##0);\"--\""), "--");
    }

    #[test]
    fn three_section_positive() {
        assert_eq!(format_number(42.0, "0;(0);\"zero\""), "42");
    }

    #[test]
    fn three_section_negative() {
        assert_eq!(format_number(-42.0, "0;(0);\"zero\""), "(42)");
    }
}

// =========================================================================
// 7. format_dollar
// =========================================================================

mod dollar {
    use super::*;

    #[test]
    fn positive() {
        assert_eq!(format_dollar(1234.5, 2), "$1,234.50");
    }

    #[test]
    fn negative_uses_parentheses() {
        assert_eq!(format_dollar(-1234.5, 2), "($1,234.50)");
    }

    #[test]
    fn zero() {
        assert_eq!(format_dollar(0.0, 2), "$0.00");
    }

    #[test]
    fn zero_with_zero_decimals() {
        assert_eq!(format_dollar(0.0, 0), "$0");
    }

    #[test]
    fn large_number() {
        assert_eq!(format_dollar(1234567.89, 2), "$1,234,567.89");
    }

    #[test]
    fn negative_decimals_rounds_to_hundreds() {
        // -2 decimals means round to nearest 100
        assert_eq!(format_dollar(1234.5, -2), "$1,200");
    }

    #[test]
    fn negative_decimals_rounds_to_tens() {
        assert_eq!(format_dollar(1234.5, -1), "$1,230");
    }

    #[test]
    fn no_decimals() {
        // 0 decimals: rounds to integer
        assert_eq!(format_dollar(1234.5, 0), "$1,235");
    }

    #[test]
    fn many_decimals() {
        assert_eq!(format_dollar(1.5, 4), "$1.5000");
    }
}

// =========================================================================
// 8. format_fixed
// =========================================================================

mod fixed {
    use super::*;

    #[test]
    fn basic_with_commas() {
        assert_eq!(format_fixed(1234.5, 2, false), "1,234.50");
    }

    #[test]
    fn basic_no_commas() {
        assert_eq!(format_fixed(1234.5, 2, true), "1234.50");
    }

    #[test]
    fn negative_with_commas() {
        assert_eq!(format_fixed(-1234.5, 2, false), "-1,234.50");
    }

    #[test]
    fn negative_no_commas() {
        assert_eq!(format_fixed(-1234.5, 2, true), "-1234.50");
    }

    #[test]
    fn zero_decimals() {
        assert_eq!(format_fixed(1234.5, 0, false), "1,235");
    }

    #[test]
    fn zero_value() {
        assert_eq!(format_fixed(0.0, 2, false), "0.00");
    }

    #[test]
    fn negative_decimals_rounds() {
        // Negative decimals: round to tens/hundreds, display 0 decimal places
        assert_eq!(format_fixed(1234.5, -2, false), "1,200");
    }

    #[test]
    fn large_number_no_commas() {
        assert_eq!(format_fixed(1234567.89, 2, true), "1234567.89");
    }

    #[test]
    fn large_number_with_commas() {
        assert_eq!(format_fixed(1234567.89, 2, false), "1,234,567.89");
    }
}

// =========================================================================
// 9. Fraction formatting from first principles
// =========================================================================

mod fractions {
    use super::*;

    #[test]
    fn one_half() {
        // 0.5 with # ?/? should display as " 1/2" (space-padded integer part)
        let result = format_number(0.5, "# ?/?");
        assert!(
            result.contains("1/2"),
            "0.5 should format as 1/2, got: {result}"
        );
    }

    #[test]
    fn one_quarter() {
        let result = format_number(0.25, "# ?/?");
        assert!(
            result.contains("1/4"),
            "0.25 should format as 1/4, got: {result}"
        );
    }

    #[test]
    fn one_third_approx() {
        // 1/3 with two-digit denominators should find 1/3
        let result = format_number(1.0 / 3.0, "# ??/??");
        assert!(
            result.contains("1/3"),
            "1/3 should format as 1/3, got: {result}"
        );
    }

    #[test]
    fn mixed_number() {
        // 3.25 = 3 1/4
        let result = format_number(3.25, "# ?/?");
        assert_eq!(result, "3 1/4");
    }

    #[test]
    fn whole_number_fraction() {
        // 5.0 with fraction format: integer part only, fraction part is zero
        let result = format_number(5.0, "# ?/?");
        // Should show 5 with blank fraction area
        assert!(
            result.starts_with("5"),
            "5.0 should start with 5, got: {result}"
        );
        // Should NOT contain a non-zero numerator
        assert!(
            !result.contains("1/"),
            "5.0 should not have a fraction numerator, got: {result}"
        );
    }

    #[test]
    fn negative_fraction() {
        // -0.5 should show as negative
        let result = format_number(-0.5, "# ?/?");
        assert!(
            result.contains("1/2"),
            "-0.5 should contain 1/2, got: {result}"
        );
        assert!(
            result.contains("-"),
            "-0.5 should be negative, got: {result}"
        );
    }

    // ---------------------------------------------------------------------
    // Two-digit-placeholder fraction cases (# ??/??).
    //
    // Pre-fix bug (right-fix/rust-event-emit, Hack C): the formatter
    // right-padded the numerator to `num_placeholders` chars, which composed
    // with the literal space between `#` and `??` to produce a doubled
    // inter-column space (e.g. `1  5/8` instead of `1 5/8`). The TS layer
    // compensated with a regex that collapsed `\d {2,}\d` to a single space.
    //
    // Right fix: emit numerator/denominator digits without padding when they
    // are non-zero. The literal space already provides the visual separator;
    // padding to the placeholder width was a column-alignment choice that did
    // not match the test fixture
    //   dev/app-eval/scenarios/formatting-deep/number-format-fraction.spec.ts.
    // ---------------------------------------------------------------------

    #[test]
    fn two_digit_placeholder_mixed_single_digit_num() {
        // 1.625 = 1 5/8 — single-digit numerator, single-digit denominator,
        // two-digit placeholders for both. No doubled spaces between the
        // integer and the numerator block.
        let result = format_number(1.625, "# ??/??");
        assert_eq!(result, "1 5/8");
    }

    #[test]
    fn two_digit_placeholder_large_int_with_fraction() {
        // 42.75 = 42 3/4 — large integer, single-digit numerator and
        // denominator. Same shape: single space between integer and fraction.
        let result = format_number(42.75, "# ??/??");
        assert_eq!(result, "42 3/4");
    }

    #[test]
    fn two_digit_placeholder_two_digit_denom() {
        // 1.0/13.0 ≈ 0.0769 — best two-digit approximation is 1/13 itself,
        // so we get a two-digit denominator. No padding artifacts.
        let result = format_number(1.0 / 13.0, "# ??/??");
        // Integer is 0 with `#` (suppressed → blanked to one space),
        // then literal space, then "1/13".
        assert_eq!(result, "  1/13");
    }

    #[test]
    fn two_digit_placeholder_zero_int_single_digit_num() {
        // 0.333 ≈ 1/3 — integer zero suppressed, single-digit numerator.
        let result = format_number(1.0 / 3.0, "# ??/??");
        assert_eq!(result, "  1/3");
    }

    #[test]
    fn two_digit_placeholder_whole_number() {
        // 5.0 with `# ??/??` — integer "5", literal space, numerator zone
        // blanked (two spaces), slash, denominator zone blanked (two spaces).
        let result = format_number(5.0, "# ??/??");
        assert_eq!(result, "5   /  ");
    }

    #[test]
    fn three_digit_placeholder_single_digit_fraction() {
        // 1.5 with `# ???/???` — emit "1 1/2" with no padding artifacts.
        let result = format_number(1.5, "# ???/???");
        assert_eq!(result, "1 1/2");
    }

    #[test]
    fn fixed_denominator_quarter_under_one() {
        let result = format_number(0.25, "# ?/4");
        assert_eq!(result, "  1/4");
    }

    #[test]
    fn fixed_denominator_quarter_mixed_number() {
        let result = format_number(1.25, "# ?/4");
        assert_eq!(result, "1 1/4");
    }

    #[test]
    fn fixed_denominator_tenths() {
        let result = format_number(0.3, "# ?/10");
        assert_eq!(result, "  3/10");
    }

    #[test]
    fn fixed_denominator_whole_number_preserves_fraction_columns() {
        let result = format_number(5.0, "# ?/4");
        assert_eq!(result, "5  /4");
    }

    #[test]
    fn fixed_denominator_carries_when_rounded_numerator_reaches_denominator() {
        let result = format_number(0.99, "# ?/4");
        assert_eq!(result, "1  /4");
    }

    #[test]
    fn fixed_denominator_sixteenths() {
        let result = format_number(0.3125, "# ??/16");
        assert_eq!(result, "  5/16");
    }

    #[test]
    fn fixed_denominator_hundredths() {
        let result = format_number(0.03, "# ??/100");
        assert_eq!(result, "  3/100");
    }
}

// =========================================================================
// 10. Locale-aware numeric formatting
// =========================================================================

mod locale_formatting {
    use super::*;

    #[test]
    fn german_decimal_separator() {
        let de = locale_de();
        assert_eq!(format_number_with_locale(1234.5, "0.00", &de), "1234,50");
    }

    #[test]
    fn german_thousands_separator() {
        let de = locale_de();
        assert_eq!(
            format_number_with_locale(1234567.0, "#,##0", &de),
            "1.234.567"
        );
    }

    #[test]
    fn german_thousands_and_decimal() {
        let de = locale_de();
        assert_eq!(
            format_number_with_locale(1234.5, "#,##0.00", &de),
            "1.234,50"
        );
    }

    #[test]
    fn us_default_separators() {
        let us = locale_us();
        assert_eq!(
            format_number_with_locale(1234.5, "#,##0.00", &us),
            "1,234.50"
        );
    }
}

// =========================================================================
// 11. General format edge cases
// =========================================================================

mod general_format {
    use super::*;

    #[test]
    fn zero() {
        assert_eq!(format_number(0.0, "General"), "0");
    }

    #[test]
    fn integer_no_trailing_decimal() {
        // Integers should not show ".0"
        assert_eq!(format_number(42.0, "General"), "42");
    }

    #[test]
    fn negative_integer() {
        assert_eq!(format_number(-42.0, "General"), "-42");
    }

    #[test]
    fn decimal_value() {
        assert_eq!(format_number(3.14, "General"), "3.14");
    }

    #[test]
    fn very_large_uses_scientific() {
        // Numbers >= 1e15 should not display as full integers in General format
        // They need scientific notation or some compressed form
        let result = format_number(1e16, "General");
        // Should not be "10000000000000000" — Excel uses scientific
        // The result should be reasonably short
        assert!(
            result.len() < 20,
            "very large number should be compact, got: {result}"
        );
    }

    #[test]
    fn very_small_positive() {
        let result = format_number(0.000001, "General");
        assert!(
            result.contains("1"),
            "should contain digit 1, got: {result}"
        );
        assert!(result != "0", "0.000001 should not show as 0");
    }

    #[test]
    fn negative_zero_shows_as_zero() {
        // -0.0 should display as "0", not "-0"
        assert_eq!(format_number(-0.0, "General"), "0");
    }

    #[test]
    fn empty_format_same_as_general() {
        assert_eq!(format_number(1234.5, ""), format_number(1234.5, "General"));
    }
}

// =========================================================================
// 12. Percentage edge cases
// =========================================================================

mod percentage {
    use super::*;

    #[test]
    fn zero_percent() {
        assert_eq!(format_number(0.0, "0%"), "0%");
    }

    #[test]
    fn hundred_percent() {
        assert_eq!(format_number(1.0, "0%"), "100%");
    }

    #[test]
    fn fifty_percent() {
        assert_eq!(format_number(0.5, "0%"), "50%");
    }

    #[test]
    fn over_hundred_percent() {
        assert_eq!(format_number(2.5, "0%"), "250%");
    }

    #[test]
    fn negative_percent() {
        assert_eq!(format_number(-0.25, "0%"), "-25%");
    }

    #[test]
    fn percent_with_decimals() {
        assert_eq!(format_number(0.1234, "0.00%"), "12.34%");
    }

    #[test]
    fn small_percent() {
        assert_eq!(format_number(0.001, "0.0%"), "0.1%");
    }

    #[test]
    fn percent_with_thousands() {
        // Large percentage: 100.0 = 10000%
        assert_eq!(format_number(100.0, "#,##0%"), "10,000%");
    }
}

// =========================================================================
// 13. Scientific notation edge cases
// =========================================================================

mod scientific {
    use super::*;

    #[test]
    fn zero() {
        assert_eq!(format_number(0.0, "0.00E+00"), "0.00E+00");
    }

    #[test]
    fn positive() {
        assert_eq!(format_number(1234567.0, "0.00E+00"), "1.23E+06");
    }

    #[test]
    fn negative() {
        let result = format_number(-1234567.0, "0.00E+00");
        assert_eq!(result, "-1.23E+06");
    }

    #[test]
    fn very_small() {
        assert_eq!(format_number(0.0001, "0.00E+00"), "1.00E-04");
    }

    #[test]
    fn very_large_exponent() {
        let result = format_number(1e20, "0.00E+00");
        assert_eq!(result, "1.00E+20");
    }

    #[test]
    fn one() {
        assert_eq!(format_number(1.0, "0.00E+00"), "1.00E+00");
    }

    #[test]
    fn between_one_and_ten() {
        assert_eq!(format_number(5.5, "0.00E+00"), "5.50E+00");
    }
}

// =========================================================================
// Additional: Digit placeholder semantics
// =========================================================================

mod digit_placeholders {
    use super::*;

    #[test]
    fn zero_placeholder_forces_digit() {
        // 0 placeholder shows 0 if no digit available
        assert_eq!(format_number(5.0, "000"), "005");
    }

    #[test]
    fn hash_suppresses_leading_zeros() {
        assert_eq!(format_number(5.0, "###"), "5");
    }

    #[test]
    fn hash_decimal_suppresses_trailing_zeros() {
        // #.## suppresses trailing zeros
        assert_eq!(format_number(1.5, "#.##"), "1.5");
    }

    #[test]
    fn hash_decimal_all_zeros_shows_dot() {
        // 0.0 with #.## — all zeros suppressed, just decimal point remains
        assert_eq!(format_number(0.0, "#.##"), ".");
    }

    #[test]
    fn thousands_zero_shows_zero() {
        // #,##0 for 0 must show "0" because the 0 placeholder forces a digit
        assert_eq!(format_number(0.0, "#,##0"), "0");
    }

    #[test]
    fn zero_double_zero_decimal() {
        assert_eq!(format_number(1234.5, "0.00"), "1234.50");
    }

    #[test]
    fn thousands_with_decimal() {
        assert_eq!(format_number(1234.5, "#,##0.00"), "1,234.50");
    }

    #[test]
    fn scale_divisor_single_comma() {
        // Trailing comma divides by 1000
        assert_eq!(format_number(1234567.0, "#,##0,"), "1,235");
    }

    #[test]
    fn scale_divisor_double_comma() {
        // Two trailing commas divide by 1,000,000
        assert_eq!(format_number(1234567890.0, "#,##0,,"), "1,235");
    }
}
