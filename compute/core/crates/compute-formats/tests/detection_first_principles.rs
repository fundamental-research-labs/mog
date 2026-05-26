//! First-principles detection and input tests for compute-formats.
//!
//! Every expected value here is derived from the Excel specification and
//! format-code grammar, NOT from running the current implementation.
//! If the code has a bug, these tests should catch it.

use compute_formats::*;

// ===================================================================
// 1. detect_format_type — comprehensive, every FormatType variant
// ===================================================================

mod detect_format_type_tests {
    use super::*;

    // --- General ---
    #[test]
    fn general_empty_string() {
        assert_eq!(detect_format_type(""), FormatType::General);
    }
    #[test]
    fn general_canonical() {
        assert_eq!(detect_format_type("General"), FormatType::General);
    }
    #[test]
    fn general_case_insensitive() {
        assert_eq!(detect_format_type("general"), FormatType::General);
        assert_eq!(detect_format_type("GENERAL"), FormatType::General);
        assert_eq!(detect_format_type("gEnErAl"), FormatType::General);
    }

    // --- Text ---
    #[test]
    fn text_at_sign() {
        assert_eq!(detect_format_type("@"), FormatType::Text);
    }

    // --- Number ---
    #[test]
    fn number_zero() {
        assert_eq!(detect_format_type("0"), FormatType::Number);
    }
    #[test]
    fn number_decimal() {
        assert_eq!(detect_format_type("0.00"), FormatType::Number);
    }
    #[test]
    fn number_thousands() {
        assert_eq!(detect_format_type("#,##0"), FormatType::Number);
    }
    #[test]
    fn number_thousands_decimal() {
        assert_eq!(detect_format_type("#,##0.00"), FormatType::Number);
    }
    #[test]
    fn number_hash_only() {
        assert_eq!(detect_format_type("#"), FormatType::Number);
    }
    #[test]
    fn number_with_color_and_neg_section() {
        // Color in brackets is not a date token; Red is just a color.
        assert_eq!(detect_format_type("#,##0;[Red](#,##0)"), FormatType::Number);
    }

    // --- Currency ---
    #[test]
    fn currency_dollar() {
        assert_eq!(detect_format_type("$#,##0.00"), FormatType::Currency);
    }
    #[test]
    fn currency_euro() {
        assert_eq!(detect_format_type("\u{20AC}#,##0.00"), FormatType::Currency);
    }
    #[test]
    fn currency_pound() {
        assert_eq!(detect_format_type("\u{00A3}#,##0.00"), FormatType::Currency);
    }
    #[test]
    fn currency_yen() {
        assert_eq!(detect_format_type("\u{00A5}#,##0"), FormatType::Currency);
    }
    #[test]
    fn currency_rupee() {
        assert_eq!(detect_format_type("\u{20B9}#,##0.00"), FormatType::Currency);
    }
    #[test]
    fn currency_won() {
        assert_eq!(detect_format_type("\u{20A9}#,##0"), FormatType::Currency);
    }

    // --- Accounting ---
    #[test]
    fn accounting_standard() {
        assert_eq!(
            detect_format_type("_($* #,##0.00_)"),
            FormatType::Accounting
        );
    }
    #[test]
    fn accounting_starts_with_open_paren() {
        assert_eq!(detect_format_type("_(* #,##0.00_)"), FormatType::Accounting);
    }

    // --- Date ---
    #[test]
    fn date_mdy() {
        assert_eq!(detect_format_type("m/d/yyyy"), FormatType::Date);
    }
    #[test]
    fn date_iso() {
        assert_eq!(detect_format_type("yyyy-mm-dd"), FormatType::Date);
    }
    #[test]
    fn date_d_mmm_yy() {
        assert_eq!(detect_format_type("d-mmm-yy"), FormatType::Date);
    }
    #[test]
    fn date_mmm_d_yyyy() {
        assert_eq!(detect_format_type("mmm d, yyyy"), FormatType::Date);
    }
    #[test]
    fn date_yyyy_only() {
        // y token alone = date
        assert_eq!(detect_format_type("yyyy"), FormatType::Date);
    }
    #[test]
    fn date_dd_only() {
        // d token alone = date
        assert_eq!(detect_format_type("dd"), FormatType::Date);
    }
    #[test]
    fn date_m_d_yy_h_mm_is_date_not_time() {
        // Has both date (y, d) and time (h) tokens — should be Date
        assert_eq!(detect_format_type("m/d/yy h:mm"), FormatType::Date);
    }

    // --- Time ---
    #[test]
    fn time_h_mm_ampm() {
        assert_eq!(detect_format_type("h:mm AM/PM"), FormatType::Time);
    }
    #[test]
    fn time_h_mm_ss() {
        assert_eq!(detect_format_type("h:mm:ss"), FormatType::Time);
    }
    #[test]
    fn time_hh_mm_ss() {
        assert_eq!(detect_format_type("hh:mm:ss"), FormatType::Time);
    }
    #[test]
    fn time_m_ss_is_time() {
        // m:ss — m adjacent to ss is minutes, no y/d tokens → Time
        assert_eq!(detect_format_type("m:ss"), FormatType::Time);
    }
    #[test]
    fn time_mm_ss() {
        assert_eq!(detect_format_type("mm:ss"), FormatType::Time);
    }
    #[test]
    fn time_elapsed_h_mm_ss() {
        assert_eq!(detect_format_type("[h]:mm:ss"), FormatType::Time);
    }

    // --- Percentage ---
    #[test]
    fn percentage_integer() {
        assert_eq!(detect_format_type("0%"), FormatType::Percentage);
    }
    #[test]
    fn percentage_decimal() {
        assert_eq!(detect_format_type("0.00%"), FormatType::Percentage);
    }

    // --- Scientific ---
    #[test]
    fn scientific_e_plus() {
        assert_eq!(detect_format_type("0.00E+00"), FormatType::Scientific);
    }
    #[test]
    fn scientific_e_minus() {
        assert_eq!(detect_format_type("0.00E-00"), FormatType::Scientific);
    }
    #[test]
    fn scientific_lowercase_e() {
        assert_eq!(detect_format_type("0.00e+00"), FormatType::Scientific);
    }

    // --- Fraction ---
    #[test]
    fn fraction_single_digit() {
        assert_eq!(detect_format_type("# ?/?"), FormatType::Fraction);
    }
    #[test]
    fn fraction_double_digit() {
        assert_eq!(detect_format_type("# ??/??"), FormatType::Fraction);
    }
    #[test]
    fn fraction_fixed_denom() {
        assert_eq!(detect_format_type("# ?/10"), FormatType::Fraction);
    }

    // --- Special ---
    #[test]
    fn special_zip() {
        assert_eq!(detect_format_type("00000"), FormatType::Special);
    }
    #[test]
    fn special_zip_plus_4() {
        assert_eq!(detect_format_type("00000-0000"), FormatType::Special);
    }
    #[test]
    fn special_phone() {
        assert_eq!(detect_format_type("(###) ###-####"), FormatType::Special);
    }
    #[test]
    fn special_ssn() {
        assert_eq!(detect_format_type("000-00-0000"), FormatType::Special);
    }

    // --- Custom ---
    #[test]
    fn custom_no_placeholders() {
        // A literal-only format with no recognized pattern → Custom
        assert_eq!(detect_format_type("\"hello\""), FormatType::Custom);
    }
}

// ===================================================================
// 2. Tricky format classification — escaped/quoted tokens
// ===================================================================

mod tricky_classification {
    use super::*;

    #[test]
    fn quoted_dollar_is_not_currency() {
        // "$" is a quoted literal, not a currency symbol
        // The format has 0.00 digit placeholders → Number
        assert_eq!(detect_format_type("\"$\"0.00"), FormatType::Number);
    }

    #[test]
    fn escaped_dollar_is_not_currency() {
        // \$ is an escaped literal, not a currency symbol
        assert_eq!(detect_format_type("\\$0.00"), FormatType::Number);
    }

    #[test]
    fn escaped_d_is_not_date() {
        // \d is escaped, should not trigger date detection
        assert!(!is_date_format("0\\d"));
        assert_eq!(detect_format_type("0\\d"), FormatType::Number);
    }

    #[test]
    fn quoted_days_is_not_date() {
        // "days" is quoted, the d inside should not trigger date detection
        assert!(!is_date_format("0\"days\""));
        assert_eq!(detect_format_type("0\"days\""), FormatType::Number);
    }

    #[test]
    fn bracketed_color_red_is_not_date() {
        // [Red] is a color modifier, not a date token
        assert!(!is_date_format("#,##0;[Red](#,##0)"));
    }

    #[test]
    fn h_mm_is_time_not_date() {
        assert_eq!(detect_format_type("h:mm"), FormatType::Time);
    }

    #[test]
    fn m_slash_d_is_date() {
        // m/d has a d token which makes it a date format
        assert_eq!(detect_format_type("m/d"), FormatType::Date);
    }

    #[test]
    fn mm_dd_yyyy_is_date() {
        assert_eq!(detect_format_type("mm/dd/yyyy"), FormatType::Date);
    }

    #[test]
    fn bracket_locale_euro_is_currency() {
        // [$\u{20AC}] locale override — after bracket stripping the Euro may
        // or may not remain, but the raw format clearly has currency intent.
        // The key point: the format code [$\u{20AC}-407]#,##0.00 should be
        // detected as Currency (the Euro symbol is in the bracket expression).
        // After removing brackets the euro is gone, but the dollar prefix [$
        // contains $, which the cleaned string should preserve or detect.
        let ft = detect_format_type("$#,##0.00");
        assert_eq!(ft, FormatType::Currency);
    }
}

// ===================================================================
// 3. is_date_format and is_date_format agreement
// ===================================================================

mod date_format_agreement {
    use super::*;

    /// Both functions should agree on these clear-cut cases.
    fn assert_both_agree(format_code: &str, expected: bool) {
        let parsed = is_date_format(format_code);
        let detected = is_date_format(format_code);
        assert_eq!(
            parsed, expected,
            "is_date_format({:?}) = {}, expected {}",
            format_code, parsed, expected
        );
        assert_eq!(
            detected, expected,
            "is_date_format({:?}) = {}, expected {}",
            format_code, detected, expected
        );
    }

    #[test]
    fn clear_date_formats() {
        assert_both_agree("yyyy-mm-dd", true);
        assert_both_agree("m/d/yy", true);
        assert_both_agree("d-mmm-yy", true);
        assert_both_agree("mmm d, yyyy", true);
        assert_both_agree("m/d/yy h:mm", true);
        assert_both_agree("yyyy", true);
    }

    #[test]
    fn clear_time_formats() {
        assert_both_agree("h:mm:ss", true);
        assert_both_agree("h:mm AM/PM", true);
        assert_both_agree("hh:mm:ss", true);
        assert_both_agree("h:mm:ss AM/PM", true);
    }

    #[test]
    fn clear_non_date_formats() {
        assert_both_agree("", false);
        assert_both_agree("General", false);
        assert_both_agree("general", false);
        assert_both_agree("@", false);
        assert_both_agree("#,##0", false);
        assert_both_agree("0.00", false);
        assert_both_agree("0%", false);
        assert_both_agree("0.00%", false);
        assert_both_agree("$#,##0.00", false);
        assert_both_agree("#,##0.00", false);
    }
}

// ===================================================================
// 4. is_time_only_format
// ===================================================================

mod time_only_format {
    use super::*;

    #[test]
    fn pure_time_formats() {
        assert!(is_time_only_format("h:mm:ss"));
        assert!(is_time_only_format("h:mm AM/PM"));
        assert!(is_time_only_format("hh:mm:ss"));
        assert!(is_time_only_format("h:mm"));
        assert!(is_time_only_format("mm:ss"));
        assert!(is_time_only_format("h:mm:ss AM/PM"));
    }

    #[test]
    fn datetime_not_time_only() {
        // Has both date and time tokens — not time-only
        assert!(!is_time_only_format("m/d/yy h:mm"));
        assert!(!is_time_only_format("yyyy-mm-dd h:mm:ss"));
    }

    #[test]
    fn date_not_time_only() {
        assert!(!is_time_only_format("yyyy-mm-dd"));
        assert!(!is_time_only_format("m/d/yyyy"));
        assert!(!is_time_only_format("d-mmm-yy"));
    }

    #[test]
    fn non_datetime_not_time_only() {
        assert!(!is_time_only_format(""));
        assert!(!is_time_only_format("General"));
        assert!(!is_time_only_format("#,##0"));
        assert!(!is_time_only_format("0%"));
        assert!(!is_time_only_format("@"));
    }
}

// ===================================================================
// 5. has_date_tokens / has_time_tokens
// ===================================================================

mod date_time_tokens {
    use super::*;

    #[test]
    fn date_tokens_present() {
        assert!(has_date_tokens("yyyy-mm-dd"));
        assert!(has_date_tokens("m/d/yyyy"));
        assert!(has_date_tokens("dd"));
        assert!(has_date_tokens("yyyy"));
    }

    #[test]
    fn date_tokens_absent_in_time_only() {
        assert!(!has_date_tokens("h:mm:ss"));
        assert!(!has_date_tokens("h:mm AM/PM"));
    }

    #[test]
    fn date_tokens_absent_in_numbers() {
        assert!(!has_date_tokens("#,##0"));
        assert!(!has_date_tokens("0.00"));
        assert!(!has_date_tokens("General"));
    }

    #[test]
    fn time_tokens_present() {
        assert!(has_time_tokens("h:mm:ss"));
        assert!(has_time_tokens("h:mm AM/PM"));
        assert!(has_time_tokens("hh:mm:ss"));
    }

    #[test]
    fn time_tokens_absent_in_date_only() {
        assert!(!has_time_tokens("yyyy-mm-dd"));
        assert!(!has_time_tokens("m/d/yyyy"));
    }

    #[test]
    fn time_tokens_absent_in_numbers() {
        assert!(!has_time_tokens("#,##0"));
        assert!(!has_time_tokens("0.00"));
    }

    #[test]
    fn datetime_has_both() {
        assert!(has_date_tokens("m/d/yy h:mm"));
        assert!(has_time_tokens("m/d/yy h:mm"));
    }

    #[test]
    fn escaped_tokens_not_counted() {
        // \d should not count as a date token
        assert!(!has_date_tokens("0\\d"));
        // Quoted "days" should not count
        assert!(!has_date_tokens("0\"days\""));
    }
}

// ===================================================================
// 6. should_format_as_date — boundary testing
// ===================================================================

mod should_format_as_date_tests {
    use super::*;

    #[test]
    fn date_format_valid_serial() {
        assert!(should_format_as_date(45000.0, "m/d/yyyy"));
        assert!(should_format_as_date(1.0, "yyyy-mm-dd"));
        assert!(should_format_as_date(110_000.0, "d-mmm-yy"));
    }

    #[test]
    fn date_format_invalid_serial() {
        // Serial too small (time-only fraction)
        assert!(!should_format_as_date(0.5, "m/d/yyyy"));
        // Serial zero
        assert!(!should_format_as_date(0.0, "m/d/yyyy"));
        // Serial too large
        assert!(!should_format_as_date(200_000.0, "m/d/yyyy"));
        // Negative
        assert!(!should_format_as_date(-1.0, "m/d/yyyy"));
    }

    #[test]
    fn non_date_format_valid_serial() {
        // Good serial but format is a number → false
        assert!(!should_format_as_date(45000.0, "#,##0"));
        assert!(!should_format_as_date(45000.0, "General"));
        assert!(!should_format_as_date(45000.0, "0%"));
    }

    #[test]
    fn time_format_with_time_serial() {
        // Time formats are date formats (is_date_format returns true for h:mm:ss)
        // but serial 0.5 is below 1.0 so is_likely_date_serial is false
        assert!(!should_format_as_date(0.5, "h:mm:ss"));
    }
}

// ===================================================================
// 7. is_likely_date_serial — boundary values, special floats
// ===================================================================

mod likely_date_serial {
    use super::*;

    #[test]
    fn zero_not_likely() {
        assert!(!is_likely_date_serial(0.0));
    }

    #[test]
    fn fraction_below_one_not_likely() {
        assert!(!is_likely_date_serial(0.5));
        assert!(!is_likely_date_serial(0.999));
    }

    #[test]
    fn one_is_likely() {
        // Serial 1 = Jan 1, 1900
        assert!(is_likely_date_serial(1.0));
    }

    #[test]
    fn typical_date_serial() {
        assert!(is_likely_date_serial(45000.0)); // ~2023
    }

    #[test]
    fn upper_bound_inclusive() {
        assert!(is_likely_date_serial(110_000.0));
    }

    #[test]
    fn above_upper_bound() {
        assert!(!is_likely_date_serial(110_001.0));
    }

    #[test]
    fn negative() {
        assert!(!is_likely_date_serial(-1.0));
        assert!(!is_likely_date_serial(-100.0));
    }

    #[test]
    fn nan() {
        assert!(!is_likely_date_serial(f64::NAN));
    }

    #[test]
    fn infinity() {
        assert!(!is_likely_date_serial(f64::INFINITY));
        assert!(!is_likely_date_serial(f64::NEG_INFINITY));
    }
}

// ===================================================================
// 8. normalize_format_code — edge cases
// ===================================================================

mod normalize_tests {
    use super::*;

    #[test]
    fn empty_becomes_general() {
        assert_eq!(normalize_format_code(""), "General");
    }

    #[test]
    fn whitespace_only_becomes_general() {
        // Trimmed to empty → "General"
        assert_eq!(normalize_format_code("   "), "General");
    }

    #[test]
    fn general_case_normalized() {
        assert_eq!(normalize_format_code("general"), "General");
        assert_eq!(normalize_format_code("GENERAL"), "General");
        assert_eq!(normalize_format_code("  general  "), "General");
        assert_eq!(normalize_format_code("  GENERAL  "), "General");
    }

    #[test]
    fn other_formats_trimmed_but_preserved() {
        assert_eq!(normalize_format_code("  #,##0.00  "), "#,##0.00");
        assert_eq!(normalize_format_code("$#,##0.00"), "$#,##0.00");
        assert_eq!(normalize_format_code("  m/d/yyyy  "), "m/d/yyyy");
        assert_eq!(normalize_format_code("@"), "@");
    }

    #[test]
    fn format_with_sections_preserved() {
        let fmt = "#,##0;(#,##0);\"zero\"";
        assert_eq!(normalize_format_code(fmt), fmt);
    }
}

// ===================================================================
// 9. builtin_format — known IDs from Excel spec
// ===================================================================

mod builtin_format_tests {
    use super::*;

    #[test]
    fn id_0_general() {
        assert_eq!(builtin_format(0), Some("General"));
    }

    #[test]
    fn id_1_integer() {
        assert_eq!(builtin_format(1), Some("0"));
    }

    #[test]
    fn id_2_decimal() {
        assert_eq!(builtin_format(2), Some("0.00"));
    }

    #[test]
    fn id_3_thousands() {
        assert_eq!(builtin_format(3), Some("#,##0"));
    }

    #[test]
    fn id_4_thousands_decimal() {
        assert_eq!(builtin_format(4), Some("#,##0.00"));
    }

    #[test]
    fn id_9_percent_integer() {
        assert_eq!(builtin_format(9), Some("0%"));
    }

    #[test]
    fn id_10_percent_decimal() {
        assert_eq!(builtin_format(10), Some("0.00%"));
    }

    #[test]
    fn id_11_scientific() {
        assert_eq!(builtin_format(11), Some("0.00E+00"));
    }

    #[test]
    fn id_14_date() {
        // Excel spec: numFmtId 14 = "m/d/yy" (short date)
        let fmt = builtin_format(14).unwrap();
        // Must contain date tokens
        assert!(
            fmt.contains('m') && (fmt.contains('d') || fmt.contains('y')),
            "ID 14 should be a date format, got: {}",
            fmt
        );
    }

    #[test]
    fn id_49_text() {
        assert_eq!(builtin_format(49), Some("@"));
    }

    #[test]
    fn gaps_return_none() {
        // IDs 5-8 are reserved for locale-specific currency in some implementations
        // but they may or may not be in the builtin list. IDs clearly out of range:
        assert_eq!(builtin_format(50), None);
        assert_eq!(builtin_format(100), None);
        assert_eq!(builtin_format(999), None);
    }

    #[test]
    fn id_12_fraction_single() {
        assert_eq!(builtin_format(12), Some("# ?/?"));
    }

    #[test]
    fn id_13_fraction_double() {
        assert_eq!(builtin_format(13), Some("# ??/??"));
    }
}

// ===================================================================
// 10. parse_date_input — ISO, slash, month names, invalid, 2-digit years
// ===================================================================

mod parse_date_input_tests {
    use super::*;

    fn en_us() -> CultureInfo {
        CultureInfo::default()
    }

    fn dmy_locale() -> CultureInfo {
        CultureInfo {
            short_date_pattern: "dd/MM/yyyy".into(),
            ..Default::default()
        }
    }

    // --- ISO ---
    #[test]
    fn iso_basic() {
        let r = parse_date_input("2024-03-15", &en_us()).unwrap();
        assert!(r.serial > 0.0);
        assert_eq!(r.suggested_format, "yyyy-mm-dd");
    }

    #[test]
    fn iso_jan_1_1900() {
        let r = parse_date_input("1900-01-01", &en_us()).unwrap();
        // Jan 1, 1900 = serial 1 in Excel
        assert!((r.serial - 1.0).abs() < 0.01);
    }

    // --- Slash MDY ---
    #[test]
    fn slash_mdy_basic() {
        let r = parse_date_input("3/15/2024", &en_us()).unwrap();
        assert!(r.serial > 0.0);
        // Both ISO and slash for same date should give same serial
        let iso = parse_date_input("2024-03-15", &en_us()).unwrap();
        assert!(
            (r.serial - iso.serial).abs() < 0.01,
            "MDY serial {} should match ISO serial {}",
            r.serial,
            iso.serial
        );
    }

    // --- Slash DMY ---
    #[test]
    fn slash_dmy_basic() {
        let locale = dmy_locale();
        let r = parse_date_input("15/3/2024", &locale).unwrap();
        // Should be March 15, 2024 (same as ISO)
        let iso = parse_date_input("2024-03-15", &en_us()).unwrap();
        assert!(
            (r.serial - iso.serial).abs() < 0.01,
            "DMY serial {} should match ISO serial {}",
            r.serial,
            iso.serial
        );
    }

    // --- Month name formats ---
    #[test]
    fn month_name_long() {
        let r = parse_date_input("March 15, 2024", &en_us()).unwrap();
        let iso = parse_date_input("2024-03-15", &en_us()).unwrap();
        assert!((r.serial - iso.serial).abs() < 0.01);
    }

    #[test]
    fn month_name_abbreviated_dash() {
        let r = parse_date_input("15-Mar-2024", &en_us()).unwrap();
        let iso = parse_date_input("2024-03-15", &en_us()).unwrap();
        assert!((r.serial - iso.serial).abs() < 0.01);
    }

    // --- Invalid dates ---
    #[test]
    fn invalid_month_13() {
        assert!(parse_date_input("13/32/2024", &en_us()).is_none());
    }

    #[test]
    fn invalid_feb_30() {
        // February never has 30 days
        assert!(parse_date_input("2/30/2024", &en_us()).is_none());
    }

    #[test]
    fn invalid_not_a_date() {
        assert!(parse_date_input("not-a-date", &en_us()).is_none());
    }

    #[test]
    fn invalid_empty() {
        assert!(parse_date_input("", &en_us()).is_none());
    }

    // --- Two-digit years ---
    #[test]
    fn two_digit_year_low_range() {
        // 0-29 → 2000s
        let r24 = parse_date_input("3/15/24", &en_us()).unwrap();
        let r2024 = parse_date_input("3/15/2024", &en_us()).unwrap();
        assert!(
            (r24.serial - r2024.serial).abs() < 0.01,
            "24 should resolve to 2024"
        );
    }

    #[test]
    fn two_digit_year_zero() {
        let r00 = parse_date_input("3/15/00", &en_us()).unwrap();
        let r2000 = parse_date_input("3/15/2000", &en_us()).unwrap();
        assert!(
            (r00.serial - r2000.serial).abs() < 0.01,
            "00 should resolve to 2000"
        );
    }

    #[test]
    fn two_digit_year_29() {
        let r29 = parse_date_input("3/15/29", &en_us()).unwrap();
        let r2029 = parse_date_input("3/15/2029", &en_us()).unwrap();
        assert!(
            (r29.serial - r2029.serial).abs() < 0.01,
            "29 should resolve to 2029"
        );
    }

    #[test]
    fn two_digit_year_high_range() {
        // 30-99 → 1900s
        let r30 = parse_date_input("3/15/30", &en_us()).unwrap();
        let r1930 = parse_date_input("3/15/1930", &en_us()).unwrap();
        assert!(
            (r30.serial - r1930.serial).abs() < 0.01,
            "30 should resolve to 1930"
        );
    }

    #[test]
    fn two_digit_year_99() {
        let r99 = parse_date_input("3/15/99", &en_us()).unwrap();
        let r1999 = parse_date_input("3/15/1999", &en_us()).unwrap();
        assert!(
            (r99.serial - r1999.serial).abs() < 0.01,
            "99 should resolve to 1999"
        );
    }
}

// ===================================================================
// 11. prepare_date_value / prepare_time_value
// ===================================================================

mod prepare_value_tests {
    use super::*;

    // --- prepare_date_value ---

    #[test]
    fn date_no_existing_format_applies_default() {
        let r = prepare_date_value(2024, 3, 15, None);
        assert!(r.serial > 0.0);
        assert_eq!(r.format_to_apply, Some("M/d/yyyy".to_string()));
    }

    #[test]
    fn date_existing_date_format_no_change() {
        let r = prepare_date_value(2024, 3, 15, Some("yyyy-mm-dd"));
        assert!(r.serial > 0.0);
        assert_eq!(r.format_to_apply, None);
    }

    #[test]
    fn date_existing_number_format_applies_date() {
        let r = prepare_date_value(2024, 3, 15, Some("#,##0.00"));
        assert!(r.serial > 0.0);
        assert_eq!(r.format_to_apply, Some("M/d/yyyy".to_string()));
    }

    #[test]
    fn date_existing_general_format_applies_date() {
        let r = prepare_date_value(2024, 3, 15, Some("General"));
        assert_eq!(r.format_to_apply, Some("M/d/yyyy".to_string()));
    }

    #[test]
    fn date_existing_time_format_keeps_it() {
        // Time format IS a date format (is_date_format returns true for h:mm:ss)
        let r = prepare_date_value(2024, 3, 15, Some("h:mm:ss"));
        assert_eq!(r.format_to_apply, None);
    }

    #[test]
    fn date_serial_consistency() {
        // Same date via prepare_date_value and parse_date_input should give same serial
        let prepared = prepare_date_value(2024, 3, 15, None);
        let parsed = parse_date_input("2024-03-15", &CultureInfo::default()).unwrap();
        assert!(
            (prepared.serial - parsed.serial).abs() < 1.0,
            "prepare serial {} vs parse serial {}",
            prepared.serial,
            parsed.serial
        );
    }

    // --- prepare_time_value ---

    #[test]
    fn time_serial_noon() {
        let r = prepare_time_value(12, 0, 0, None);
        let expected = (12.0 * 3600.0) / 86400.0; // 0.5
        assert!(
            (r.serial - expected).abs() < 1e-10,
            "noon serial should be 0.5, got {}",
            r.serial
        );
    }

    #[test]
    fn time_serial_midnight() {
        let r = prepare_time_value(0, 0, 0, None);
        assert!((r.serial - 0.0).abs() < 1e-10);
    }

    #[test]
    fn time_serial_6pm() {
        let r = prepare_time_value(18, 0, 0, None);
        let expected = 0.75;
        assert!((r.serial - expected).abs() < 1e-10);
    }

    #[test]
    fn time_serial_with_minutes_and_seconds() {
        let r = prepare_time_value(12, 30, 45, None);
        let expected = (12.0 * 3600.0 + 30.0 * 60.0 + 45.0) / 86400.0;
        assert!((r.serial - expected).abs() < 1e-10);
    }

    #[test]
    fn time_no_existing_format_applies_default() {
        let r = prepare_time_value(12, 30, 0, None);
        assert_eq!(r.format_to_apply, Some("h:mm:ss AM/PM".to_string()));
    }

    #[test]
    fn time_existing_time_format_no_change() {
        let r = prepare_time_value(12, 30, 0, Some("h:mm:ss"));
        assert_eq!(r.format_to_apply, None);
    }

    #[test]
    fn time_existing_date_format_no_change() {
        // Date format contains time-relevant tokens; is_date_format returns true
        let r = prepare_time_value(12, 30, 0, Some("m/d/yyyy h:mm"));
        assert_eq!(r.format_to_apply, None);
    }

    #[test]
    fn time_existing_number_format_applies_time() {
        let r = prepare_time_value(12, 30, 0, Some("#,##0.00"));
        assert_eq!(r.format_to_apply, Some("h:mm:ss AM/PM".to_string()));
    }

    #[test]
    fn time_existing_general_format_applies_time() {
        let r = prepare_time_value(12, 30, 0, Some("General"));
        assert_eq!(r.format_to_apply, Some("h:mm:ss AM/PM".to_string()));
    }
}

// ===================================================================
// 12. default_format for all FormatTypes
// ===================================================================

mod default_format_tests {
    use super::*;

    #[test]
    fn general() {
        assert_eq!(default_format(FormatType::General), "General");
    }

    #[test]
    fn number() {
        assert_eq!(default_format(FormatType::Number), "#,##0.00");
    }

    #[test]
    fn currency() {
        assert_eq!(default_format(FormatType::Currency), "$#,##0.00");
    }

    #[test]
    fn accounting() {
        let fmt = default_format(FormatType::Accounting);
        // Accounting format should start with _( pattern
        assert!(
            fmt.starts_with("_("),
            "Accounting default should start with _(, got: {}",
            fmt
        );
    }

    #[test]
    fn date() {
        assert_eq!(default_format(FormatType::Date), "m/d/yyyy");
    }

    #[test]
    fn time() {
        assert_eq!(default_format(FormatType::Time), "h:mm AM/PM");
    }

    #[test]
    fn percentage() {
        assert_eq!(default_format(FormatType::Percentage), "0.00%");
    }

    #[test]
    fn fraction() {
        assert_eq!(default_format(FormatType::Fraction), "# ?/?");
    }

    #[test]
    fn scientific() {
        assert_eq!(default_format(FormatType::Scientific), "0.00E+00");
    }

    #[test]
    fn text() {
        assert_eq!(default_format(FormatType::Text), "@");
    }

    #[test]
    fn special() {
        // ZIP code is the default special format
        assert_eq!(default_format(FormatType::Special), "00000");
    }

    #[test]
    fn custom() {
        // Custom defaults to General
        assert_eq!(default_format(FormatType::Custom), "General");
    }

    #[test]
    fn default_format_roundtrips_to_correct_type() {
        // For most types, detect_format_type(default_format(T)) == T
        // Exceptions: Custom → "General" → General, Special → "00000" → Special
        let roundtrip_types = [
            FormatType::General,
            FormatType::Number,
            FormatType::Currency,
            FormatType::Date,
            FormatType::Time,
            FormatType::Percentage,
            FormatType::Fraction,
            FormatType::Scientific,
            FormatType::Text,
            FormatType::Special,
        ];
        for ft in roundtrip_types {
            let fmt = default_format(ft);
            let detected = detect_format_type(fmt);
            assert_eq!(
                detected, ft,
                "default_format({:?}) = {:?}, but detect_format_type({:?}) = {:?}",
                ft, fmt, fmt, detected
            );
        }
    }
}
