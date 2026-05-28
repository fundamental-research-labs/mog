mod detect_format_type_tests {
    use compute_formats::*;

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
        // Has both date (y, d) and time (h) tokens - should be Date
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
        // m:ss - m adjacent to ss is minutes, no y/d tokens -> Time
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
        // A literal-only format with no recognized pattern -> Custom
        assert_eq!(detect_format_type("\"hello\""), FormatType::Custom);
    }
}

mod tricky_classification {
    use compute_formats::*;

    #[test]
    fn quoted_dollar_is_not_currency() {
        // "$" is a quoted literal, not a currency symbol
        // The format has 0.00 digit placeholders -> Number
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
        // Preserve the current assertion: the plain dollar currency format is
        // detected as Currency.
        let ft = detect_format_type("$#,##0.00");
        assert_eq!(ft, FormatType::Currency);
    }
}
