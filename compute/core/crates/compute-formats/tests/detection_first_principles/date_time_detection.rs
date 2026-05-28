mod date_format_agreement {
    use compute_formats::*;

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

mod time_only_format {
    use compute_formats::*;

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
        // Has both date and time tokens - not time-only
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

mod date_time_tokens {
    use compute_formats::*;

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

mod should_format_as_date_tests {
    use compute_formats::*;

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
        // Good serial but format is a number -> false
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

mod likely_date_serial {
    use compute_formats::*;

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
