//! Number-format contracts, including literal-separated fractions and calendar epochs.
use compute_formats::{format_number, format_number_with_date_system};

#[test]
fn scales_and_digit_alignment_compose() {
    for (value, code, expected) in [
        (123.45, "0,0.00%%", "1,234,500.00%%"),
        (-123.45, "0,0.00%%", "-1,234,500.00%%"),
        (1234567.0, "#,.#,", "1.2"),
        (-1234567.0, "#,.#,", "-1.2"),
        (1234567.0, ",#", ",1234567"),
        (-1234567.0, ",0", "-,1234567"),
        (1234567.0, "?,?????????", "    1,234,567"),
        (1.1, "|?.??|", "|1.1 |"),
        (-1.1, "|??.??|", "-| 1.1 |"),
        (0.25, "0\\%", "0%"),
        (0.25, "0%", "25%"),
        (12.0, r#"#/"0""#, "12/0"),
    ] {
        assert_eq!(format_number(value, code), expected, "{value} {code}");
    }
}

#[test]
fn dates_use_workbook_epoch_without_changing_elapsed_or_numeric_values() {
    assert_eq!(
        format_number_with_date_system(0.0, "yyyy-mm-dd", true),
        "1904-01-01"
    );
    assert_eq!(
        format_number_with_date_system(0.0, "yyyy-mm-dd", false),
        "1900-01-00"
    );
    assert_eq!(format_number_with_date_system(0.5, "[h]:mm", true), "12:00");
    assert_eq!(format_number_with_date_system(0.5, "0.00", true), "0.50");
    assert_eq!(
        format_number_with_date_system(36191.0, "ddd-mmm-yyy", true),
        "Sat-Feb-2003"
    );
    assert_eq!(
        format_number_with_date_system(36191.0, "ddd-mmm-yy", true),
        "Sat-Feb-03"
    );
}

#[test]
fn fractional_seconds_round_at_requested_precision_and_keep_marker_case() {
    let serial = 36191.0 + (4.0 * 3600.0 + 5.0 * 60.0 + 6.009) / 86400.0;
    for (code, expected) in [
        ("h:m:s.00 A/P", "4:5:6.01 A"),
        ("hh:mm:ss.000 am/pm", "04:05:06.009 AM"),
        ("hh:mm:ss a/p", "04:05:06 a"),
        ("h:m:s.00", "4:5:6.01"),
    ] {
        assert_eq!(format_number_with_date_system(serial, code, true), expected);
    }
    assert_eq!(format_number(0.75, "h a/p"), "6 p");
    assert_eq!(format_number(0.75, "h a/P"), "6 P");
    let boundary = 45000.0 + 86399.9996 / 86400.0;
    assert_eq!(
        format_number(boundary, "yyyy-mm-dd hh:mm:ss.000"),
        "2023-03-16 00:00:00.000"
    );
}

#[test]
fn fractions_keep_literal_positions_and_improper_numerators() {
    for (value, code, expected) in [
        (23.75, "|#-#-#\\:#/#|", "|-2-3:3/4|"),
        (0.75, "|#-#-#\\:#/#|", "|--3/4|"),
        (0.0, "|#-#-#\\:#/#|", "|--0|"),
        (23.75, "|#\\:#=/=#|", "|23:3=/=4|"),
        (23.75, "|#\\:? ?#/#|", "|2:3  3/4|"),
        (23.75, "|#\\:? ?0#/000", "|2:3  03/004"),
        (0.0, "|#\\:? ?0#/000", "|:0  00/001"),
        (0.75, "|?\\:?0=/=#|", "|   3=/=4|"),
        (3.75, "|#_#/#|", "|15 /4|"),
        (0.0, "|#_#/#|", "|0 /1|"),
        (3.75, "|#_?=/=?|", "|15 =/=4|"),
    ] {
        assert_eq!(format_number(value, code), expected, "{value} {code}");
    }
}

#[test]
fn mixed_fraction_zero_and_alignment_contract_matrix() {
    // Each row is integer/numerator placeholder, with denominator #, ? or 0.
    // A mandatory numerator forces 0/1; optional fractions disappear, while
    // any ? reserves the fractional field's full width.
    let expected_zero = [
        ["0", "0      ", "0"],
        ["0      ", "0      ", "0      "],
        ["0=/=1", "0=/=1", "0=/=1"],
        ["0      ", "0      ", "0      "],
        ["0      ", "0      ", "0      "],
        ["0:0=/=1", "0:0=/=1", "0:0=/=1"],
        ["0", "0      ", "0"],
        ["0      ", "0      ", "0      "],
        ["0:0=/=1", "0:0=/=1", "0:0=/=1"],
    ];
    let expected_fraction = [
        "3=/=4", " 3=/=4", "3=/=4", "  3=/=4", "  3=/=4", "  3=/=4", "0:3=/=4", "0:3=/=4",
        "0:3=/=4",
    ];
    for (i, integer) in ['#', '?', '0'].iter().enumerate() {
        for (j, numerator) in ['#', '?', '0'].iter().enumerate() {
            for (k, denominator) in ['#', '?', '0'].iter().enumerate() {
                let code = format!("|{integer}\\:{numerator}=/={denominator}|");
                let index = 3 * i + j;
                assert_eq!(
                    format_number(0.0, &code),
                    format!("|{}|", expected_zero[index][k]),
                    "{code}"
                );
                for value in [0.75, -0.75] {
                    let sign = if value < 0.0 { "-" } else { "" };
                    assert_eq!(
                        format_number(value, &code),
                        format!("{sign}|{}|", expected_fraction[index]),
                        "{value} {code}"
                    );
                }
            }
        }
    }
}

#[test]
fn gregorian_era_year_tokens_are_distinct_from_scientific_exponents() {
    use compute_formats::{has_date_tokens, is_date_format, is_time_only_format};
    // Excel's cached result for TEXT(28313,"ee-mm-dd").
    for format in ["e-mm-dd", "ee-mm-dd", "E-mm-dd", "EE-mm-dd"] {
        assert_eq!(format_number(28313., format), "1977-07-07");
    }
    for format in ["e", "ee", "E", "EE"] {
        assert_eq!(format_number(28313., format), "1977");
        assert!(is_date_format(format));
        assert!(has_date_tokens(format));
    }
    assert_eq!(
        format_number_with_date_system(26851., "ee-mm-dd", true),
        "1977-07-07"
    );
    assert!(!is_time_only_format("ee h:mm"));
    assert_eq!(format_number(1234., "0.00E+00"), "1.23E+03");
    assert_eq!(format_number(0.01234, "0.00E-00"), "1.23E-02");
    for format in ["0.00E+00", "0.00e-00", r#"0"ee""#, r"0\e", "General"] {
        assert!(!is_date_format(format), "{format}");
        assert!(!has_date_tokens(format), "{format}");
    }
    assert_eq!(format_number(12., r#"0"ee""#), "12ee");
    assert_eq!(format_number(12., r"0\e"), "12e");
    for format in ["0E0", "0e0", "0EE0", "0ee0", "E0", "e0"] {
        let marker = if format.contains('E') { 'E' } else { 'e' };
        assert!(format_number(42., format).contains(marker), "{format}");
        assert!(!is_date_format(format), "{format}");
    }
    assert_eq!(
        format_number(28313., "ee-mm-dd hh:mm:ss.000"),
        "1977-07-07 00:00:00.000"
    );
}
