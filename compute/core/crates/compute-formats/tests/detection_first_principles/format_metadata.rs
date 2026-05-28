mod normalize_tests {
    use compute_formats::*;

    #[test]
    fn empty_becomes_general() {
        assert_eq!(normalize_format_code(""), "General");
    }

    #[test]
    fn whitespace_only_becomes_general() {
        // Trimmed to empty -> "General"
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

mod builtin_format_tests {
    use compute_formats::*;

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

mod default_format_tests {
    use compute_formats::*;

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
        // Exceptions: Custom -> "General" -> General, Special -> "00000" -> Special
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
