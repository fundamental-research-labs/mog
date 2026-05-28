mod parse_date_input_tests {
    use compute_formats::*;

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
        // 0-29 -> 2000s
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
        // 30-99 -> 1900s
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

mod prepare_value_tests {
    use compute_formats::*;

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
