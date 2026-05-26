//! Integration tests targeting specific uncovered code paths in compute-formats.
//!
//! Tests are grouped by the source file whose coverage gaps they address.

use compute_formats::*;
use std::sync::Arc;

// ===========================================================================
// number.rs gaps
// ===========================================================================

mod number_rs {
    use super::*;

    // -----------------------------------------------------------------------
    // 1. evaluate_condition with `<=` operator (number.rs:76)
    // -----------------------------------------------------------------------

    #[test]
    fn condition_less_than_or_equal_boundary() {
        // Value exactly at threshold: should match the first section
        assert_eq!(format_number(100.0, "[<=100]\"small\";0"), "small");
    }

    #[test]
    fn condition_less_than_or_equal_below() {
        assert_eq!(format_number(99.0, "[<=100]\"small\";0"), "small");
    }

    #[test]
    fn condition_less_than_or_equal_above() {
        // 101 does NOT match <=100, falls to the second section
        assert_eq!(format_number(101.0, "[<=100]\"small\";0"), "101");
    }

    // -----------------------------------------------------------------------
    // 2. evaluate_condition with `=` operator (number.rs:92)
    // -----------------------------------------------------------------------

    #[test]
    fn condition_equal_matches() {
        assert_eq!(format_number(0.0, "[=0]\"zero\";0"), "zero");
    }

    #[test]
    fn condition_equal_no_match() {
        assert_eq!(format_number(1.0, "[=0]\"zero\";0"), "1");
    }

    // -----------------------------------------------------------------------
    // 3. evaluate_condition with `<>` operator (number.rs:97)
    // -----------------------------------------------------------------------

    #[test]
    fn condition_not_equal_matches() {
        // 5 <> 0, so first section applies
        assert_eq!(format_number(5.0, "[<>0]0;\"zero\""), "5");
    }

    #[test]
    fn condition_not_equal_no_match() {
        // 0 is NOT <> 0, so second section applies
        assert_eq!(format_number(0.0, "[<>0]0;\"zero\""), "zero");
    }

    // -----------------------------------------------------------------------
    // 4. No condition matched and no fallback (number.rs:37)
    // -----------------------------------------------------------------------

    #[test]
    fn all_conditions_fail_falls_to_last_section() {
        // 50 is neither >100 nor <-100, so no condition matches.
        // No unconditional fallback section exists -> uses last section.
        let result = format_number(50.0, "[>100]\"big\";[<-100]\"neg big\"");
        assert_eq!(result, "neg big");
    }

    // -----------------------------------------------------------------------
    // 5. 3-section and 4-section selection (number.rs:60-65)
    // -----------------------------------------------------------------------

    #[test]
    fn four_section_positive() {
        assert_eq!(
            format_number(5.0, "\"pos\";\"neg\";\"zero\";\"text\""),
            "pos"
        );
    }

    #[test]
    fn four_section_negative() {
        assert_eq!(
            format_number(-5.0, "\"pos\";\"neg\";\"zero\";\"text\""),
            "neg"
        );
    }

    #[test]
    fn four_section_zero() {
        assert_eq!(
            format_number(0.0, "\"pos\";\"neg\";\"zero\";\"text\""),
            "zero"
        );
    }

    // -----------------------------------------------------------------------
    // 6. emit_literals with SkipWidth and Percent (number.rs:129-130)
    // -----------------------------------------------------------------------

    #[test]
    fn emit_literals_skip_width() {
        // Format with a literal and skip-width character: _) adds a space
        let result = format_number(123.0, "\"hello\"_)");
        assert_eq!(result, "hello ");
    }

    #[test]
    fn emit_literals_percent_token() {
        // A format with only a percent literal (no digit placeholders)
        // triggers the emit_literals path.
        let result = format_number(42.0, "\"%\"");
        assert_eq!(result, "%");
    }

    // -----------------------------------------------------------------------
    // 7. Question placeholder with leading zero (number.rs:296)
    // -----------------------------------------------------------------------

    #[test]
    fn question_placeholder_zero_value() {
        // ??? with 0 -> "   " (three spaces: all ? placeholders show space
        // for leading zeros, and with no 0 placeholder none forces a digit)
        assert_eq!(format_number(0.0, "???"), "   ");
    }

    #[test]
    fn question_placeholder_small_value() {
        // ??? with 5 -> "  5"
        assert_eq!(format_number(5.0, "???"), "  5");
    }

    // -----------------------------------------------------------------------
    // 8. RepeatFill in numeric formatter (number.rs:399-400)
    // -----------------------------------------------------------------------

    #[test]
    fn repeat_fill_is_skipped() {
        // RepeatFill (*.) is a no-op in string output
        let result = format_number(42.0, "0*.");
        assert_eq!(result, "42");
    }

    // -----------------------------------------------------------------------
    // 9. TextPlaceholder in numeric section (number.rs:411-412)
    // -----------------------------------------------------------------------

    #[test]
    fn text_placeholder_in_numeric_section() {
        // "0@" has both a digit placeholder (0) and @, so it is NOT a text section.
        // The 0 formats the number, then @ inserts format_general(value).
        let result = format_number(42.0, "0@");
        assert_eq!(result, "4242");
    }

    // -----------------------------------------------------------------------
    // 10. Scientific with zero decimal places (number.rs:463, 480)
    // -----------------------------------------------------------------------

    #[test]
    fn scientific_zero_decimal_places() {
        // 1234 -> mantissa 1.234, exponent 3. Rounded to 0 decimals -> 1.
        assert_eq!(format_number(1234.0, "0E+00"), "1E+03");
    }

    #[test]
    fn scientific_zero_decimal_places_small() {
        assert_eq!(format_number(0.005, "0E+00"), "5E-03");
    }
}

// ===========================================================================
// constants.rs gaps
// ===========================================================================

mod constants_rs {
    use super::*;

    // -----------------------------------------------------------------------
    // 11. FormatType::as_str() for all variants (constants.rs:86-99)
    // -----------------------------------------------------------------------

    #[test]
    fn format_type_as_str_all_variants() {
        assert_eq!(FormatType::General.as_str(), "general");
        assert_eq!(FormatType::Number.as_str(), "number");
        assert_eq!(FormatType::Currency.as_str(), "currency");
        assert_eq!(FormatType::Accounting.as_str(), "accounting");
        assert_eq!(FormatType::Date.as_str(), "date");
        assert_eq!(FormatType::Time.as_str(), "time");
        assert_eq!(FormatType::Percentage.as_str(), "percentage");
        assert_eq!(FormatType::Fraction.as_str(), "fraction");
        assert_eq!(FormatType::Scientific.as_str(), "scientific");
        assert_eq!(FormatType::Text.as_str(), "text");
        assert_eq!(FormatType::Special.as_str(), "special");
        assert_eq!(FormatType::Custom.as_str(), "custom");
    }

    // -----------------------------------------------------------------------
    // 12. presets_for_type for all format types (constants.rs:323-336)
    // -----------------------------------------------------------------------

    #[test]
    fn presets_for_type_non_empty() {
        assert!(!presets_for_type(FormatType::General).is_empty());
        assert!(!presets_for_type(FormatType::Number).is_empty());
        assert!(!presets_for_type(FormatType::Currency).is_empty());
        assert!(!presets_for_type(FormatType::Accounting).is_empty());
        assert!(!presets_for_type(FormatType::Date).is_empty());
        assert!(!presets_for_type(FormatType::Time).is_empty());
        assert!(!presets_for_type(FormatType::Percentage).is_empty());
        assert!(!presets_for_type(FormatType::Fraction).is_empty());
        assert!(!presets_for_type(FormatType::Scientific).is_empty());
        assert!(!presets_for_type(FormatType::Text).is_empty());
        assert!(!presets_for_type(FormatType::Special).is_empty());
    }

    #[test]
    fn presets_for_type_custom_is_empty() {
        assert!(presets_for_type(FormatType::Custom).is_empty());
    }

    // -----------------------------------------------------------------------
    // 13. get_format_data() (constants.rs:537-551)
    // -----------------------------------------------------------------------

    #[test]
    fn get_format_data_structure() {
        let data = get_format_data();
        assert_eq!(data.format_categories.len(), 12);
        assert_eq!(data.currency_symbols.len(), 26);
        assert!(!data.format_presets.is_empty());
        assert!(!data.default_formats.is_empty());
        // Verify all 12 types are present in presets and defaults
        assert_eq!(data.format_presets.len(), 12);
        assert_eq!(data.default_formats.len(), 12);
    }
}

// ===========================================================================
// builder.rs gaps
// ===========================================================================

mod builder_rs {
    use super::*;

    // -----------------------------------------------------------------------
    // 14. Currency with zero decimals (builder.rs:86)
    // -----------------------------------------------------------------------

    #[test]
    fn currency_zero_decimals() {
        let o = FormatOptions {
            format_type: FormatType::Currency,
            decimal_places: Some(0),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "$#,##0");
    }

    // -----------------------------------------------------------------------
    // 15. ParenthesesRed negative format (builder.rs:97)
    // -----------------------------------------------------------------------

    #[test]
    fn currency_parentheses_red() {
        let o = FormatOptions {
            format_type: FormatType::Currency,
            negative_format: Some(NegativeFormat::ParenthesesRed),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "$#,##0.00;[Red]($#,##0.00)");
    }

    // -----------------------------------------------------------------------
    // 16. Accounting with zero decimals (builder.rs:107)
    // -----------------------------------------------------------------------

    #[test]
    fn accounting_zero_decimals() {
        let o = FormatOptions {
            format_type: FormatType::Accounting,
            decimal_places: Some(0),
            ..Default::default()
        };
        let result = build_format_code(&o);
        assert!(result.contains("#,##0_)"), "got: {}", result);
        assert!(!result.contains('.'), "should have no decimal: {}", result);
    }

    // -----------------------------------------------------------------------
    // 17. FractionType::Eighths and Tenths (builder.rs:138-140)
    // -----------------------------------------------------------------------

    #[test]
    fn fraction_eighths() {
        let o = FormatOptions {
            format_type: FormatType::Fraction,
            fraction_type: Some(FractionType::Eighths),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "# ?/8");
    }

    #[test]
    fn fraction_tenths() {
        let o = FormatOptions {
            format_type: FormatType::Fraction,
            fraction_type: Some(FractionType::Tenths),
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "# ?/10");
    }

    // -----------------------------------------------------------------------
    // 18. Special and Custom format types (builder.rs:163-164)
    // -----------------------------------------------------------------------

    #[test]
    fn special_type_defaults_to_general() {
        let o = FormatOptions {
            format_type: FormatType::Special,
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "General");
    }

    #[test]
    fn custom_type_defaults_to_general() {
        let o = FormatOptions {
            format_type: FormatType::Custom,
            ..Default::default()
        };
        assert_eq!(build_format_code(&o), "General");
    }
}

// ===========================================================================
// normalize.rs gaps
// ===========================================================================

mod normalize_rs {
    use super::*;

    // -----------------------------------------------------------------------
    // 19. get_format_preview with default samples (normalize.rs:35-39)
    // -----------------------------------------------------------------------

    #[test]
    fn preview_date_default_sample() {
        // Default date sample is serial 45639 = Dec 13, 2024
        let preview = get_format_preview("m/d/yyyy", None);
        assert_eq!(preview, "12/13/2024");
    }

    #[test]
    fn preview_time_default_sample() {
        // Default time sample is ~3:30 PM (0.645833333)
        let preview = get_format_preview("h:mm AM/PM", None);
        assert!(
            preview.contains("PM"),
            "expected PM in time preview, got: {}",
            preview
        );
    }

    #[test]
    fn preview_fraction_default_sample() {
        // Default fraction sample is 1.5, formatted as "# ?/?" -> "1 1/2"
        let preview = get_format_preview("# ?/?", None);
        assert!(
            preview.contains("1/2"),
            "expected 1/2 in fraction preview, got: {}",
            preview
        );
    }
}

// ===========================================================================
// lib.rs gaps
// ===========================================================================

mod lib_rs {
    use super::*;

    // -----------------------------------------------------------------------
    // 20. format_number_result with text section (lib.rs:151)
    // -----------------------------------------------------------------------

    #[test]
    fn format_number_result_text_section() {
        let r = format_number_result(42.0, "@", &CultureInfo::default());
        assert_eq!(r.text, "42");
        assert!(!r.is_error);
    }

    // -----------------------------------------------------------------------
    // 21. format_number_result with datetime (lib.rs:153)
    // -----------------------------------------------------------------------

    #[test]
    fn format_number_result_datetime() {
        // Serial 45292 = Jan 1, 2024
        let r = format_number_result(45292.0, "yyyy-mm-dd", &CultureInfo::default());
        assert_eq!(r.text, "2024-01-01");
    }

    // -----------------------------------------------------------------------
    // 22. format_number_result with literal-only format (lib.rs:159-161)
    // -----------------------------------------------------------------------

    #[test]
    fn format_number_result_literal_only() {
        let r = format_number_result(42.0, "\"hello\"", &CultureInfo::default());
        assert_eq!(r.text, "hello");
    }

    // -----------------------------------------------------------------------
    // 23. format_number_result with fraction (lib.rs:167)
    // -----------------------------------------------------------------------

    #[test]
    fn format_number_result_fraction() {
        let r = format_number_result(3.25, "# ?/?", &CultureInfo::default());
        assert!(
            r.text.contains("3") && r.text.contains("1/4"),
            "expected '3 1/4', got: {}",
            r.text
        );
    }

    // -----------------------------------------------------------------------
    // 24. format_value with Array (lib.rs:196)
    // -----------------------------------------------------------------------

    #[test]
    fn format_value_array() {
        let arr = value_types::CellArray::new(
            vec![value_types::CellValue::Number(
                value_types::FiniteF64::new(1.0).unwrap(),
            )],
            1,
        );
        let val = value_types::CellValue::Array(Arc::new(arr));
        let r = format_value(&val, "", &CultureInfo::default());
        assert_eq!(r.text, "{...}");
    }
}

// ===========================================================================
// general.rs gaps
// ===========================================================================

mod general_rs {
    use super::*;

    // -----------------------------------------------------------------------
    // 25. NaN and Infinity (general.rs:5)
    // -----------------------------------------------------------------------

    #[test]
    fn general_nan() {
        assert_eq!(format_number(f64::NAN, "General"), "#NUM!");
    }

    #[test]
    fn general_infinity() {
        assert_eq!(format_number(f64::INFINITY, "General"), "#NUM!");
    }

    #[test]
    fn general_neg_infinity() {
        assert_eq!(format_number(f64::NEG_INFINITY, "General"), "#NUM!");
    }

    // -----------------------------------------------------------------------
    // 26. Negative zero (general.rs:42)
    // -----------------------------------------------------------------------

    #[test]
    fn general_negative_zero() {
        // -0.0 should display as "0" with no negative sign
        assert_eq!(format_number(-0.0, "General"), "0");
    }
}

// ===========================================================================
// input.rs gaps
// ===========================================================================

mod input_rs {
    use super::*;

    // -----------------------------------------------------------------------
    // 27. Invalid date returning serial 0 (input.rs:35)
    // -----------------------------------------------------------------------

    #[test]
    fn prepare_date_invalid_month() {
        // Month 13 is invalid -> serial 0.0
        let result = prepare_date_value(2024, 13, 1, None);
        assert_eq!(result.serial, 0.0);
    }

    #[test]
    fn prepare_date_invalid_day() {
        // Feb 30 is invalid -> serial 0.0
        let result = prepare_date_value(2024, 2, 30, None);
        assert_eq!(result.serial, 0.0);
    }

    // -----------------------------------------------------------------------
    // 28. ISO parse with out-of-range year (input.rs:148)
    // -----------------------------------------------------------------------

    #[test]
    fn parse_date_iso_year_too_low() {
        // 1899 is below the 1900 minimum for ISO parsing
        assert!(parse_date_input("1899-01-15", &CultureInfo::default()).is_none());
    }

    #[test]
    fn parse_date_iso_year_too_high() {
        // 10000 exceeds the 9999 maximum
        assert!(parse_date_input("10000-01-15", &CultureInfo::default()).is_none());
    }

    // -----------------------------------------------------------------------
    // 29. Full month name in parse_month_name (input.rs:209)
    // -----------------------------------------------------------------------

    #[test]
    fn parse_date_full_month_name_day_first() {
        // "15 January 2024" -> D Month Y
        let result = parse_date_input("15 January 2024", &CultureInfo::default());
        assert!(
            result.is_some(),
            "expected valid parse for '15 January 2024'"
        );
        let r = result.unwrap();
        assert!(r.serial > 0.0);
    }

    #[test]
    fn parse_date_full_month_name_month_first() {
        // "January 15 2024" -> Month D Y
        let result = parse_date_input("January 15 2024", &CultureInfo::default());
        assert!(
            result.is_some(),
            "expected valid parse for 'January 15 2024'"
        );
        let r = result.unwrap();
        assert!(r.serial > 0.0);
    }

    #[test]
    fn parse_date_full_month_name_with_comma() {
        // "January 15, 2024" -> Month D, Y (comma-separated)
        let result = parse_date_input("January 15, 2024", &CultureInfo::default());
        assert!(result.is_some());
    }

    // -----------------------------------------------------------------------
    // 30. try_parse_space_month_name paths (input.rs:257-278)
    // -----------------------------------------------------------------------

    #[test]
    fn parse_date_abbreviated_month_no_year() {
        // "Dec 25" -> should parse with current year
        let result = parse_date_input("Dec 25", &CultureInfo::default());
        assert!(result.is_some(), "expected valid parse for 'Dec 25'");
    }

    #[test]
    fn parse_date_day_abbreviated_month_no_year() {
        // "25 Dec" -> D MMM format without year
        let result = parse_date_input("25 Dec", &CultureInfo::default());
        assert!(result.is_some(), "expected valid parse for '25 Dec'");
    }
}

// ===========================================================================
// detection.rs gap
// ===========================================================================

mod detection_rs {
    use super::*;

    // -----------------------------------------------------------------------
    // 31. s/S preceded by # or 0 (detection.rs:95)
    // -----------------------------------------------------------------------

    #[test]
    fn s_after_digit_placeholder_not_date() {
        // "0s" -- the s is preceded by 0, so should NOT trigger date detection
        assert!(
            !is_date_format("0s"),
            "0s should not be detected as a date format"
        );
    }

    #[test]
    fn plain_s_is_date() {
        // Plain "s" = seconds token, should be detected as date
        assert!(
            is_date_format("s"),
            "plain 's' should be detected as a date format"
        );
    }

    #[test]
    fn hash_s_not_date() {
        // "#s" -- s preceded by #, should NOT trigger date detection
        assert!(
            !is_date_format("#s"),
            "#s should not be detected as a date format"
        );
    }
}
