//! First-principles date/time formatting tests.
//!
//! Every expected value here is derived from the Excel specification and manual
//! calculation — NOT by running the current code.  If the code has a bug, these
//! tests should catch it.

use compute_formats::*;

// =========================================================================
// Helpers
// =========================================================================

fn fmt(value: f64, code: &str) -> String {
    format_number(value, code)
}

fn fmt_locale(value: f64, code: &str, locale: &CultureInfo) -> String {
    format_number_with_locale(value, code, locale)
}

// =========================================================================
// 1. Date serial boundaries
// =========================================================================

#[test]
fn serial_0_is_january_0_1900() {
    // Excel TEXT(0, "mm/dd/yyyy") => "01/00/1900"
    assert_eq!(fmt(0.0, "mm/dd/yyyy"), "01/00/1900");
}

#[test]
fn serial_1_is_january_1_1900() {
    assert_eq!(fmt(1.0, "mm/dd/yyyy"), "01/01/1900");
    assert_eq!(fmt(1.0, "yyyy-mm-dd"), "1900-01-01");
}

#[test]
fn serial_2_is_january_2_1900() {
    assert_eq!(fmt(2.0, "mm/dd/yyyy"), "01/02/1900");
}

#[test]
fn serial_59_is_february_28_1900() {
    // Jan has 31 days -> serial 31 = Jan 31.  Feb 1 = serial 32, Feb 28 = serial 59.
    assert_eq!(fmt(59.0, "mm/dd/yyyy"), "02/28/1900");
}

#[test]
fn serial_60_is_fake_february_29_1900_lotus_bug() {
    // 1900 was NOT a leap year, but Excel (inheriting Lotus 1-2-3's bug)
    // treats serial 60 as Feb 29, 1900.
    assert_eq!(fmt(60.0, "mm/dd/yyyy"), "02/29/1900");
}

#[test]
fn serial_61_is_march_1_1900() {
    assert_eq!(fmt(61.0, "mm/dd/yyyy"), "03/01/1900");
}

#[test]
fn serial_31_is_january_31_1900() {
    assert_eq!(fmt(31.0, "mm/dd/yyyy"), "01/31/1900");
}

#[test]
fn serial_32_is_february_1_1900() {
    assert_eq!(fmt(32.0, "mm/dd/yyyy"), "02/01/1900");
}

// =========================================================================
// 2. Known date serials (computed from first principles)
// =========================================================================

// Reference: January 1, 2024 = serial 45292 (well-known value).

#[test]
fn jan_1_2024_serial_45292() {
    assert_eq!(fmt(45292.0, "mm/dd/yyyy"), "01/01/2024");
    assert_eq!(fmt(45292.0, "yyyy-mm-dd"), "2024-01-01");
}

#[test]
fn dec_31_2023_serial_45291() {
    // Day before Jan 1, 2024.
    assert_eq!(fmt(45291.0, "mm/dd/yyyy"), "12/31/2023");
}

#[test]
fn feb_29_2024_leap_day() {
    // 2024 IS a leap year. Jan 1 2024 = 45292, so Jan has 31 days -> Jan 31 = 45322.
    // Feb 1 = 45323, Feb 29 = 45323 + 28 = 45351.
    assert_eq!(fmt(45351.0, "mm/dd/yyyy"), "02/29/2024");
}

#[test]
fn jan_1_2000_serial_36526() {
    // From first principles:
    // Jan 1 1900 = 1.
    // Years 1900-1999 = 100 years.
    // 365 * 100 = 36500, plus leap years in that range.
    // Leap years (divisible by 4, not 100, or 400): 1904,1908,...,1996 = 24 real leap years.
    // Plus the Lotus bug adds 1 extra day (fake Feb 29 1900).
    // So serial = 36500 + 24 + 1 (Lotus) + 1 (serial 1 = Jan 1) = 36526.
    assert_eq!(fmt(36526.0, "mm/dd/yyyy"), "01/01/2000");
}

#[test]
fn serial_44927_is_jan_1_2023() {
    // From the spec: serial 44927 = January 1, 2023.
    assert_eq!(fmt(44927.0, "yyyy-mm-dd"), "2023-01-01");
}

// =========================================================================
// 3. AM/PM boundaries
// =========================================================================

#[test]
fn midnight_is_12_00_am() {
    // Time 0.0 = midnight = 12:00:00 AM
    assert_eq!(fmt(0.0, "h:mm:ss AM/PM"), "12:00:00 AM");
}

#[test]
fn noon_is_12_00_pm() {
    // Time 0.5 = noon = 12:00:00 PM
    assert_eq!(fmt(0.5, "h:mm:ss AM/PM"), "12:00:00 PM");
}

#[test]
fn just_after_midnight_12_01_am() {
    // 1 minute = 1/(24*60) = 1/1440
    let one_minute = 1.0 / 1440.0;
    assert_eq!(fmt(one_minute, "h:mm AM/PM"), "12:01 AM");
}

#[test]
fn one_pm() {
    // 1:00 PM = 13/24
    let serial = 13.0 / 24.0;
    assert_eq!(fmt(serial, "h:mm AM/PM"), "1:00 PM");
}

#[test]
fn just_before_midnight_11_59_pm() {
    // 23:59 = 23*60+59 minutes from midnight = 1439/1440
    let serial = 1439.0 / 1440.0;
    assert_eq!(fmt(serial, "h:mm AM/PM"), "11:59 PM");
}

#[test]
fn twelve_fifty_nine_pm() {
    // 12:59 PM = (12*60 + 59) / 1440 = 779/1440
    let serial = 779.0 / 1440.0;
    assert_eq!(fmt(serial, "h:mm AM/PM"), "12:59 PM");
}

#[test]
fn am_pm_with_date() {
    // Jan 1, 2024 at noon
    assert_eq!(fmt(45292.5, "mm/dd/yyyy h:mm AM/PM"), "01/01/2024 12:00 PM");
}

#[test]
fn twenty_four_hour_format() {
    // 1:00 PM in 24-hour format
    let serial = 13.0 / 24.0;
    assert_eq!(fmt(serial, "hh:mm"), "13:00");
}

#[test]
fn midnight_in_24_hour_format() {
    assert_eq!(fmt(0.0, "hh:mm:ss"), "00:00:00");
}

// =========================================================================
// 4. Elapsed time
// =========================================================================

#[test]
fn elapsed_hours_one_and_half_days() {
    // 1.5 days = 36 hours
    assert_eq!(fmt(1.5, "[h]:mm:ss"), "36:00:00");
}

#[test]
fn elapsed_hours_zero() {
    assert_eq!(fmt(0.0, "[h]:mm:ss"), "0:00:00");
}

#[test]
fn elapsed_minutes_half_day() {
    // 0.5 days = 12 hours = 720 minutes
    assert_eq!(fmt(0.5, "[mm]:ss"), "720:00");
}

#[test]
fn elapsed_seconds_half_day() {
    // 0.5 days = 43200 seconds
    assert_eq!(fmt(0.5, "[ss]"), "43200");
}

#[test]
fn elapsed_hours_large_value() {
    // 10 days = 240 hours
    assert_eq!(fmt(10.0, "[h]:mm:ss"), "240:00:00");
}

#[test]
fn elapsed_hours_fractional() {
    // 0.25 days = 6 hours
    assert_eq!(fmt(0.25, "[h]:mm:ss"), "6:00:00");
}

#[test]
fn elapsed_hours_with_minutes_and_seconds() {
    // 1 hour, 30 minutes, 45 seconds
    // = (1*3600 + 30*60 + 45) / 86400
    // = 5445 / 86400
    let serial = 5445.0 / 86400.0;
    assert_eq!(fmt(serial, "[h]:mm:ss"), "1:30:45");
}

// =========================================================================
// 5. Month and day names
// =========================================================================

// For month names we use serial values for the 1st of each month in 2024.
// Jan 1, 2024 = 45292.  We add the cumulative days for each month.

#[test]
fn full_month_names_mmmm() {
    let months = [
        (45292.0, "January"),   // Jan 1 2024
        (45323.0, "February"),  // Feb 1 2024 (31 days in Jan)
        (45352.0, "March"),     // Mar 1 2024 (29 days in Feb, leap year)
        (45383.0, "April"),     // Apr 1 (31 days in Mar)
        (45413.0, "May"),       // May 1 (30 days in Apr)
        (45444.0, "June"),      // Jun 1 (31 days in May)
        (45474.0, "July"),      // Jul 1 (30 days in Jun)
        (45505.0, "August"),    // Aug 1 (31 days in Jul)
        (45536.0, "September"), // Sep 1 (31 days in Aug)
        (45566.0, "October"),   // Oct 1 (30 days in Sep)
        (45597.0, "November"),  // Nov 1 (31 days in Oct)
        (45627.0, "December"),  // Dec 1 (30 days in Nov)
    ];
    for (serial, expected) in months {
        assert_eq!(
            fmt(serial, "mmmm"),
            expected,
            "serial {serial} should be {expected}"
        );
    }
}

#[test]
fn abbreviated_month_names_mmm() {
    let months = [
        (45292.0, "Jan"),
        (45323.0, "Feb"),
        (45352.0, "Mar"),
        (45383.0, "Apr"),
        (45413.0, "May"),
        (45444.0, "Jun"),
        (45474.0, "Jul"),
        (45505.0, "Aug"),
        (45536.0, "Sep"),
        (45566.0, "Oct"),
        (45597.0, "Nov"),
        (45627.0, "Dec"),
    ];
    for (serial, expected) in months {
        assert_eq!(
            fmt(serial, "mmm"),
            expected,
            "serial {serial} should be {expected}"
        );
    }
}

#[test]
fn first_letter_month_names_mmmmm() {
    let months = [
        (45292.0, "J"), // January
        (45323.0, "F"), // February
        (45352.0, "M"), // March
        (45383.0, "A"), // April
        (45413.0, "M"), // May
        (45444.0, "J"), // June
        (45474.0, "J"), // July
        (45505.0, "A"), // August
        (45536.0, "S"), // September
        (45566.0, "O"), // October
        (45597.0, "N"), // November
        (45627.0, "D"), // December
    ];
    for (serial, expected) in months {
        assert_eq!(
            fmt(serial, "mmmmm"),
            expected,
            "serial {serial} should be {expected}"
        );
    }
}

#[test]
fn full_day_names_dddd() {
    // Jan 1, 2024 is a Monday.  We test 7 consecutive days.
    let days = [
        (45292.0, "Monday"),
        (45293.0, "Tuesday"),
        (45294.0, "Wednesday"),
        (45295.0, "Thursday"),
        (45296.0, "Friday"),
        (45297.0, "Saturday"),
        (45298.0, "Sunday"),
    ];
    for (serial, expected) in days {
        assert_eq!(
            fmt(serial, "dddd"),
            expected,
            "serial {serial} should be {expected}"
        );
    }
}

#[test]
fn abbreviated_day_names_ddd() {
    let days = [
        (45292.0, "Mon"),
        (45293.0, "Tue"),
        (45294.0, "Wed"),
        (45295.0, "Thu"),
        (45296.0, "Fri"),
        (45297.0, "Sat"),
        (45298.0, "Sun"),
    ];
    for (serial, expected) in days {
        assert_eq!(
            fmt(serial, "ddd"),
            expected,
            "serial {serial} should be {expected}"
        );
    }
}

// =========================================================================
// 6. The m/mm ambiguity: month vs. minute
// =========================================================================

#[test]
fn m_alone_is_month() {
    // Serial 45292 = Jan 1 2024, month = 1
    assert_eq!(fmt(45292.0, "m"), "1");
}

#[test]
fn mm_alone_is_month_zero_padded() {
    assert_eq!(fmt(45292.0, "mm"), "01");
}

#[test]
fn m_after_h_is_minute() {
    // 0.5 = noon, 0 minutes
    assert_eq!(fmt(0.5, "h:m"), "12:0");
}

#[test]
fn mm_after_hh_is_minute_zero_padded() {
    assert_eq!(fmt(0.5, "hh:mm"), "12:00");
}

#[test]
fn m_before_ss_is_minute() {
    // 90 seconds = 1 minute 30 seconds = 90/86400
    let serial = 90.0 / 86400.0;
    assert_eq!(fmt(serial, "m:ss"), "1:30");
}

#[test]
fn m_between_h_and_s_is_minute() {
    // 1 hour, 30 minutes, 0 seconds = (1*3600+30*60)/86400 = 5400/86400
    let serial = 5400.0 / 86400.0;
    assert_eq!(fmt(serial, "h:mm:ss"), "1:30:00");
}

#[test]
fn m_in_date_context_is_month() {
    // "yyyy/mm/dd" — no h or s nearby, so mm = month
    assert_eq!(fmt(45292.0, "yyyy/mm/dd"), "2024/01/01");
}

#[test]
fn m_in_mixed_date_time_format() {
    // "mm/dd/yyyy hh:mm:ss" — first mm is month, second mm (after hh) is minute
    // Jan 1 2024 at 13:30:00 = 45292 + 13.5/24
    let serial = 45292.0 + 13.5 / 24.0;
    assert_eq!(fmt(serial, "mm/dd/yyyy hh:mm:ss"), "01/01/2024 13:30:00");
}

// =========================================================================
// 7. Locale-aware formatting
// =========================================================================

#[test]
fn german_full_month_names() {
    let de = get_culture("de-DE");
    let expected = [
        (45292.0, "Januar"),
        (45323.0, "Februar"),
        (45352.0, "M\u{00e4}rz"), // März
        (45383.0, "April"),
        (45413.0, "Mai"),
        (45444.0, "Juni"),
        (45474.0, "Juli"),
        (45505.0, "August"),
        (45536.0, "September"),
        (45566.0, "Oktober"),
        (45597.0, "November"),
        (45627.0, "Dezember"),
    ];
    for (serial, name) in expected {
        assert_eq!(
            fmt_locale(serial, "mmmm", &de),
            name,
            "serial {serial} should be {name} in German"
        );
    }
}

#[test]
fn german_abbreviated_month_names() {
    let de = get_culture("de-DE");
    // Spot-check a few
    assert_eq!(fmt_locale(45352.0, "mmm", &de), "M\u{00e4}r"); // Mär
    assert_eq!(fmt_locale(45566.0, "mmm", &de), "Okt");
    assert_eq!(fmt_locale(45627.0, "mmm", &de), "Dez");
}

#[test]
fn japanese_am_pm() {
    let ja = get_culture("ja-JP");
    // Midnight = 午前 12:00
    assert_eq!(
        fmt_locale(0.0, "AM/PM h:mm", &ja),
        "\u{5348}\u{524d} 12:00" // 午前 12:00
    );
    // Noon = 午後 12:00
    assert_eq!(
        fmt_locale(0.5, "AM/PM h:mm", &ja),
        "\u{5348}\u{5f8c} 12:00" // 午後 12:00
    );
}

#[test]
fn german_date_with_separator() {
    let de = get_culture("de-DE");
    // German uses "." as date separator.
    // "dd/mm/yyyy" with de-DE locale should use "." separator.
    // However, format codes with literal "/" may or may not be locale-replaced.
    // The explicit format "dd.mm.yyyy" should definitely work:
    assert_eq!(fmt_locale(45292.0, "dd.mm.yyyy", &de), "01.01.2024");
}

// =========================================================================
// 8. Detection functions
// =========================================================================

#[test]
fn is_date_format_positive_cases() {
    assert!(is_date_format("mm/dd/yyyy"));
    assert!(is_date_format("yyyy-mm-dd"));
    assert!(is_date_format("d-mmm-yy"));
    assert!(is_date_format("dddd, mmmm d, yyyy"));
    assert!(is_date_format("h:mm:ss"));
    assert!(is_date_format("hh:mm AM/PM"));
    assert!(is_date_format("[h]:mm:ss"));
    assert!(is_date_format("mm/dd/yyyy hh:mm"));
}

#[test]
fn is_date_format_negative_cases() {
    assert!(!is_date_format("General"));
    assert!(!is_date_format(""));
    assert!(!is_date_format("#,##0.00"));
    assert!(!is_date_format("0.00%"));
    assert!(!is_date_format("@"));
    assert!(!is_date_format("0.00E+00"));
}

#[test]
fn is_time_only_format_cases() {
    assert!(is_time_only_format("h:mm:ss"));
    assert!(is_time_only_format("hh:mm AM/PM"));
    assert!(is_time_only_format("[h]:mm:ss"));
    assert!(is_time_only_format("h:mm"));

    // Date+time is NOT time-only
    assert!(!is_time_only_format("mm/dd/yyyy hh:mm"));
    assert!(!is_time_only_format("yyyy-mm-dd"));
    assert!(!is_time_only_format("General"));
}

#[test]
fn has_date_tokens_cases() {
    assert!(has_date_tokens("yyyy-mm-dd"));
    assert!(has_date_tokens("d-mmm"));
    assert!(has_date_tokens("dddd"));
    assert!(has_date_tokens("yy"));

    assert!(!has_date_tokens("h:mm:ss"));
    assert!(!has_date_tokens("[h]:mm"));
    assert!(!has_date_tokens("#,##0"));
}

#[test]
fn has_time_tokens_cases() {
    assert!(has_time_tokens("h:mm:ss"));
    assert!(has_time_tokens("hh:mm"));
    assert!(has_time_tokens("[h]:mm:ss"));
    assert!(has_time_tokens("h:mm AM/PM"));

    assert!(!has_time_tokens("yyyy-mm-dd"));
    assert!(!has_time_tokens("#,##0"));
}

#[test]
fn is_date_format_with_escaped_chars() {
    // Escaped characters should NOT trigger date detection.
    // "\d" is just a literal "d", not a day token.
    assert!(!is_date_format("\\d"));
    assert!(!is_date_format("\\h"));
    assert!(!is_date_format("\\y"));

    // Quoted strings should not trigger date detection either.
    assert!(!is_date_format("\"days\""));
    assert!(!is_date_format("\"hours\""));
}

#[test]
fn is_date_format_positive() {
    assert!(is_date_format("mm/dd/yyyy"));
    assert!(is_date_format("h:mm:ss"));
    assert!(is_date_format("yyyy"));
}

// =========================================================================
// 9. Additional edge cases
// =========================================================================

#[test]
fn date_with_d_and_dd_formatting() {
    // d = day without leading zero, dd = with leading zero
    // Jan 1, 2024 = 45292
    assert_eq!(fmt(45292.0, "d"), "1");
    assert_eq!(fmt(45292.0, "dd"), "01");

    // Jan 15, 2024 = 45292 + 14 = 45306
    assert_eq!(fmt(45306.0, "d"), "15");
    assert_eq!(fmt(45306.0, "dd"), "15");
}

#[test]
fn year_formats() {
    assert_eq!(fmt(45292.0, "yy"), "24");
    assert_eq!(fmt(45292.0, "yyyy"), "2024");

    // 1900
    assert_eq!(fmt(1.0, "yyyy"), "1900");
    assert_eq!(fmt(1.0, "yy"), "00");
}

#[test]
fn month_numeric_formats() {
    // m = month without leading zero, mm = with leading zero
    // November 15, 2024: Jan 1 = 45292, +31(Jan rest) = ...
    // Actually let's use serial for Nov 1, 2024 = 45597 (from our month table), + 14 = 45611
    assert_eq!(fmt(45597.0, "m"), "11");
    assert_eq!(fmt(45292.0, "m"), "1");
    assert_eq!(fmt(45292.0, "mm"), "01");
}

#[test]
fn serial_0_time_is_midnight() {
    // The time portion of serial 0 is 0.0, which is midnight.
    assert_eq!(fmt(0.0, "h:mm:ss AM/PM"), "12:00:00 AM");
}

#[test]
fn fractional_seconds_precision() {
    // 1 second = 1/86400
    let one_sec = 1.0 / 86400.0;
    assert_eq!(fmt(one_sec, "h:mm:ss"), "0:00:01");
}

#[test]
fn date_and_time_combined() {
    // Jan 1, 2024 at 3:30:00 PM = 45292 + 15.5/24
    let serial = 45292.0 + 15.5 / 24.0;
    assert_eq!(
        fmt(serial, "yyyy-mm-dd h:mm:ss AM/PM"),
        "2024-01-01 3:30:00 PM"
    );
}

#[test]
fn elapsed_minutes_with_seconds() {
    // 1 hour, 2 minutes, 3 seconds = 3723 seconds = 3723/86400
    let serial = 3723.0 / 86400.0;
    assert_eq!(fmt(serial, "[mm]:ss"), "62:03");
}

#[test]
fn elapsed_seconds_small_value() {
    // 90 seconds = 90/86400
    let serial = 90.0 / 86400.0;
    assert_eq!(fmt(serial, "[ss]"), "90");
}
