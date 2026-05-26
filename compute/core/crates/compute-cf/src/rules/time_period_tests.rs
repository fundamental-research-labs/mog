use super::*;
use value_types::FiniteF64;
use value_types::date_serial::date_to_serial;

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

/// Helper: make a NaiveDate.
fn d(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

// -----------------------------------------------------------------------
// excel_serial_to_date tests
// -----------------------------------------------------------------------

#[test]
fn test_serial_1_is_jan_1_1900() {
    assert_eq!(excel_serial_to_date(1.0), Some(d(1900, 1, 1)));
}

#[test]
fn test_serial_59_is_feb_28_1900() {
    assert_eq!(excel_serial_to_date(59.0), Some(d(1900, 2, 28)));
}

#[test]
fn test_serial_60_is_fake_feb_29_1900() {
    // Serial 60 is the fake Feb 29, 1900 (Lotus bug).
    // Our implementation maps it to Mar 1, 1900 (same as serial 61).
    let result = excel_serial_to_date(60.0);
    assert!(result.is_some());
    // The exact mapping is implementation-defined; the existing code maps it to Mar 1.
    assert_eq!(result, Some(d(1900, 3, 1)));
}

#[test]
fn test_serial_61_is_mar_1_1900() {
    assert_eq!(excel_serial_to_date(61.0), Some(d(1900, 3, 1)));
}

#[test]
fn test_serial_44927_is_jan_1_2023() {
    // Excel serial 44927 = Jan 1, 2023
    assert_eq!(excel_serial_to_date(44927.0), Some(d(2023, 1, 1)));
}

#[test]
fn test_serial_44926_is_dec_31_2022() {
    // Excel serial 44926 = Dec 31, 2022
    assert_eq!(excel_serial_to_date(44926.0), Some(d(2022, 12, 31)));
}

#[test]
fn test_serial_0_returns_dec_31_1899() {
    // Excel serial 0 = "January 0, 1900" (fictional).
    // The upstream serial_to_date maps it to Dec 31, 1899.
    // Note: is_valid_excel_date() rejects serial 0, so evaluate_time_period()
    // never reaches this code path — serial 0 is excluded at the validation layer.
    assert_eq!(excel_serial_to_date(0.0), Some(d(1899, 12, 31)));
}

#[test]
fn test_negative_serial_returns_none() {
    assert_eq!(excel_serial_to_date(-5.0), None);
}

// -----------------------------------------------------------------------
// is_valid_excel_date tests
// -----------------------------------------------------------------------

#[test]
fn test_valid_excel_date() {
    assert!(is_valid_excel_date(1.0));
    assert!(is_valid_excel_date(44927.0));
    assert!(is_valid_excel_date(2958465.0));
}

#[test]
fn test_invalid_excel_date() {
    assert!(!is_valid_excel_date(0.0));
    assert!(!is_valid_excel_date(-1.0));
    assert!(!is_valid_excel_date(f64::NAN));
    assert!(!is_valid_excel_date(f64::INFINITY));
    assert!(!is_valid_excel_date(2958466.0));
}

// -----------------------------------------------------------------------
// get_date_period_range tests
// -----------------------------------------------------------------------
//
// Using Wednesday, 2023-03-15 as the reference "now" date.
// That week (Sun-based): Sun 2023-03-12 .. Sat 2023-03-18
// Q1 2023: Jan 1 .. Mar 31

#[test]
fn test_period_yesterday() {
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::Yesterday, now).unwrap();
    assert_eq!(start, d(2023, 3, 14));
    assert_eq!(end, d(2023, 3, 14));
}

#[test]
fn test_period_today() {
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::Today, now).unwrap();
    assert_eq!(start, d(2023, 3, 15));
    assert_eq!(end, d(2023, 3, 15));
}

#[test]
fn test_period_tomorrow() {
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::Tomorrow, now).unwrap();
    assert_eq!(start, d(2023, 3, 16));
    assert_eq!(end, d(2023, 3, 16));
}

#[test]
fn test_period_last_7_days() {
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::Last7Days, now).unwrap();
    assert_eq!(start, d(2023, 3, 9)); // 15 - 6 = 9
    assert_eq!(end, d(2023, 3, 15));
}

#[test]
fn test_period_last_week() {
    // now = Wed 2023-03-15, this week starts Sun 2023-03-12
    // last week: Sun 2023-03-05 .. Sat 2023-03-11
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::LastWeek, now).unwrap();
    assert_eq!(start, d(2023, 3, 5));
    assert_eq!(end, d(2023, 3, 11));
}

#[test]
fn test_period_this_week() {
    // now = Wed 2023-03-15, this week: Sun 2023-03-12 .. Sat 2023-03-18
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::ThisWeek, now).unwrap();
    assert_eq!(start, d(2023, 3, 12));
    assert_eq!(end, d(2023, 3, 18));
}

#[test]
fn test_period_next_week() {
    // now = Wed 2023-03-15, next week: Sun 2023-03-19 .. Sat 2023-03-25
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::NextWeek, now).unwrap();
    assert_eq!(start, d(2023, 3, 19));
    assert_eq!(end, d(2023, 3, 25));
}

#[test]
fn test_period_last_month() {
    // now = 2023-03-15, last month: Feb 1 .. Feb 28, 2023
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::LastMonth, now).unwrap();
    assert_eq!(start, d(2023, 2, 1));
    assert_eq!(end, d(2023, 2, 28));
}

#[test]
fn test_period_this_month() {
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::ThisMonth, now).unwrap();
    assert_eq!(start, d(2023, 3, 1));
    assert_eq!(end, d(2023, 3, 31));
}

#[test]
fn test_period_next_month() {
    // now = 2023-03-15, next month: Apr 1 .. Apr 30, 2023
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::NextMonth, now).unwrap();
    assert_eq!(start, d(2023, 4, 1));
    assert_eq!(end, d(2023, 4, 30));
}

#[test]
fn test_period_last_quarter() {
    // now = 2023-03-15 (Q1), last quarter: Q4 2022 = Oct 1 .. Dec 31, 2022
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::LastQuarter, now).unwrap();
    assert_eq!(start, d(2022, 10, 1));
    assert_eq!(end, d(2022, 12, 31));
}

#[test]
fn test_period_this_quarter() {
    // now = 2023-03-15 (Q1), Q1 2023 = Jan 1 .. Mar 31
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::ThisQuarter, now).unwrap();
    assert_eq!(start, d(2023, 1, 1));
    assert_eq!(end, d(2023, 3, 31));
}

#[test]
fn test_period_next_quarter() {
    // now = 2023-03-15 (Q1), next quarter: Q2 2023 = Apr 1 .. Jun 30
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::NextQuarter, now).unwrap();
    assert_eq!(start, d(2023, 4, 1));
    assert_eq!(end, d(2023, 6, 30));
}

#[test]
fn test_period_last_year() {
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::LastYear, now).unwrap();
    assert_eq!(start, d(2022, 1, 1));
    assert_eq!(end, d(2022, 12, 31));
}

#[test]
fn test_period_this_year() {
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::ThisYear, now).unwrap();
    assert_eq!(start, d(2023, 1, 1));
    assert_eq!(end, d(2023, 12, 31));
}

#[test]
fn test_period_next_year() {
    let now = d(2023, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::NextYear, now).unwrap();
    assert_eq!(start, d(2024, 1, 1));
    assert_eq!(end, d(2024, 12, 31));
}

// -----------------------------------------------------------------------
// Edge case: now is a Sunday (start of week)
// -----------------------------------------------------------------------

#[test]
fn test_period_this_week_on_sunday() {
    // 2023-03-12 is a Sunday
    let now = d(2023, 3, 12);
    let (start, end) = get_date_period_range(&DatePeriod::ThisWeek, now).unwrap();
    assert_eq!(start, d(2023, 3, 12));
    assert_eq!(end, d(2023, 3, 18));
}

#[test]
fn test_period_this_week_on_saturday() {
    // 2023-03-18 is a Saturday
    let now = d(2023, 3, 18);
    let (start, end) = get_date_period_range(&DatePeriod::ThisWeek, now).unwrap();
    assert_eq!(start, d(2023, 3, 12));
    assert_eq!(end, d(2023, 3, 18));
}

// -----------------------------------------------------------------------
// Edge case: month boundaries and leap years
// -----------------------------------------------------------------------

#[test]
fn test_period_last_month_from_january() {
    // now = 2023-01-15, last month = Dec 2022
    let now = d(2023, 1, 15);
    let (start, end) = get_date_period_range(&DatePeriod::LastMonth, now).unwrap();
    assert_eq!(start, d(2022, 12, 1));
    assert_eq!(end, d(2022, 12, 31));
}

#[test]
fn test_period_next_month_from_december() {
    // now = 2023-12-15, next month = Jan 2024
    let now = d(2023, 12, 15);
    let (start, end) = get_date_period_range(&DatePeriod::NextMonth, now).unwrap();
    assert_eq!(start, d(2024, 1, 1));
    assert_eq!(end, d(2024, 1, 31));
}

#[test]
fn test_period_last_month_feb_leap_year() {
    // now = 2024-03-15, last month = Feb 2024 (leap year: 29 days)
    let now = d(2024, 3, 15);
    let (start, end) = get_date_period_range(&DatePeriod::LastMonth, now).unwrap();
    assert_eq!(start, d(2024, 2, 1));
    assert_eq!(end, d(2024, 2, 29));
}

// -----------------------------------------------------------------------
// evaluate_time_period tests
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_today_match() {
    let now = d(2023, 3, 15);
    let serial = date_to_serial(&now);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::Today, now));
}

#[test]
fn test_evaluate_today_no_match() {
    let now = d(2023, 3, 15);
    let yesterday = d(2023, 3, 14);
    let serial = date_to_serial(&yesterday);
    let value = CellValue::number(serial);

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

#[test]
fn test_evaluate_yesterday_match() {
    let now = d(2023, 3, 15);
    let yesterday = d(2023, 3, 14);
    let serial = date_to_serial(&yesterday);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::Yesterday, now));
}

#[test]
fn test_evaluate_tomorrow_match() {
    let now = d(2023, 3, 15);
    let tomorrow = d(2023, 3, 16);
    let serial = date_to_serial(&tomorrow);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::Tomorrow, now));
}

#[test]
fn test_evaluate_last_7_days_boundary_start() {
    let now = d(2023, 3, 15);
    // 6 days ago (Mar 9) should be included
    let start_date = d(2023, 3, 9);
    let serial = date_to_serial(&start_date);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::Last7Days, now));
}

#[test]
fn test_evaluate_last_7_days_boundary_before() {
    let now = d(2023, 3, 15);
    // 7 days ago (Mar 8) should NOT be included
    let before = d(2023, 3, 8);
    let serial = date_to_serial(&before);
    let value = CellValue::number(serial);

    assert!(!evaluate_time_period(&value, &DatePeriod::Last7Days, now));
}

#[test]
fn test_evaluate_this_week_match() {
    let now = d(2023, 3, 15); // Wednesday
    // Sunday of this week (Mar 12) should match
    let sunday = d(2023, 3, 12);
    let serial = date_to_serial(&sunday);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::ThisWeek, now));
}

#[test]
fn test_evaluate_this_week_no_match() {
    let now = d(2023, 3, 15); // Wednesday
    // Previous Saturday (Mar 11) should NOT match
    let prev_sat = d(2023, 3, 11);
    let serial = date_to_serial(&prev_sat);
    let value = CellValue::number(serial);

    assert!(!evaluate_time_period(&value, &DatePeriod::ThisWeek, now));
}

#[test]
fn test_evaluate_this_month_match() {
    let now = d(2023, 3, 15);
    let first = d(2023, 3, 1);
    let serial = date_to_serial(&first);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::ThisMonth, now));
}

#[test]
fn test_evaluate_this_quarter_match() {
    let now = d(2023, 3, 15);
    let jan1 = d(2023, 1, 1);
    let serial = date_to_serial(&jan1);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::ThisQuarter, now));
}

#[test]
fn test_evaluate_this_year_match() {
    let now = d(2023, 3, 15);
    let dec31 = d(2023, 12, 31);
    let serial = date_to_serial(&dec31);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::ThisYear, now));
}

#[test]
fn test_evaluate_this_year_no_match() {
    let now = d(2023, 3, 15);
    let prev_year = d(2022, 12, 31);
    let serial = date_to_serial(&prev_year);
    let value = CellValue::number(serial);

    assert!(!evaluate_time_period(&value, &DatePeriod::ThisYear, now));
}

// -----------------------------------------------------------------------
// Non-numeric values return false
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_text_returns_none() {
    let now = d(2023, 3, 15);
    let value = CellValue::Text("2023-03-15".into());

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

#[test]
fn test_evaluate_boolean_returns_none() {
    let now = d(2023, 3, 15);
    let value = CellValue::Boolean(true);

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

#[test]
fn test_evaluate_null_returns_none() {
    let now = d(2023, 3, 15);
    let value = CellValue::Null;

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

// -----------------------------------------------------------------------
// Invalid serial dates return false
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_zero_serial_returns_none() {
    let now = d(2023, 3, 15);
    let value = n(0.0);

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

#[test]
fn test_evaluate_negative_serial_returns_none() {
    let now = d(2023, 3, 15);
    let value = n(-100.0);

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

#[test]
fn test_evaluate_nan_returns_none() {
    let now = d(2023, 3, 15);
    let value = CellValue::number(f64::NAN);

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

#[test]
fn test_evaluate_infinity_returns_none() {
    let now = d(2023, 3, 15);
    let value = CellValue::number(f64::INFINITY);

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

#[test]
fn test_evaluate_too_large_serial_returns_none() {
    let now = d(2023, 3, 15);
    let value = n(3000000.0);

    assert!(!evaluate_time_period(&value, &DatePeriod::Today, now));
}

// -----------------------------------------------------------------------
// Fractional serial dates (time component) should still match the date
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_fractional_serial_matches_date() {
    let now = d(2023, 3, 15);
    let serial = date_to_serial(&now);
    // Add a time component (noon = 0.5)
    let value = CellValue::number(serial + 0.5);

    // serial_to_date floors the value, so the date portion should still be today.
    assert!(evaluate_time_period(&value, &DatePeriod::Today, now));
}

// -----------------------------------------------------------------------
// Quarter edge cases
// -----------------------------------------------------------------------

#[test]
fn test_period_last_quarter_from_q2() {
    // now in Q2 (2023-05-15), last quarter = Q1 (Jan 1 .. Mar 31)
    let now = d(2023, 5, 15);
    let (start, end) = get_date_period_range(&DatePeriod::LastQuarter, now).unwrap();
    assert_eq!(start, d(2023, 1, 1));
    assert_eq!(end, d(2023, 3, 31));
}

#[test]
fn test_period_next_quarter_from_q4() {
    // now in Q4 (2023-11-15), next quarter = Q1 2024 (Jan 1 .. Mar 31)
    let now = d(2023, 11, 15);
    let (start, end) = get_date_period_range(&DatePeriod::NextQuarter, now).unwrap();
    assert_eq!(start, d(2024, 1, 1));
    assert_eq!(end, d(2024, 3, 31));
}

#[test]
fn test_period_last_quarter_from_q1() {
    // now in Q1 (2023-02-15), last quarter = Q4 2022 (Oct 1 .. Dec 31)
    let now = d(2023, 2, 15);
    let (start, end) = get_date_period_range(&DatePeriod::LastQuarter, now).unwrap();
    assert_eq!(start, d(2022, 10, 1));
    assert_eq!(end, d(2022, 12, 31));
}

// -----------------------------------------------------------------------
// Edge case: day clamping across months (Jan 31 -> LastMonth = Dec 31)
// -----------------------------------------------------------------------

#[test]
fn test_period_last_month_day_clamping_31_to_30() {
    // now = 2023-07-31, last month = Jun (30 days). Should be Jun 1..Jun 30.
    let now = d(2023, 7, 31);
    let (start, end) = get_date_period_range(&DatePeriod::LastMonth, now).unwrap();
    assert_eq!(start, d(2023, 6, 1));
    assert_eq!(end, d(2023, 6, 30));
}

#[test]
fn test_period_last_month_day_clamping_31_to_28() {
    // now = 2023-03-31, last month = Feb 2023 (non-leap: 28 days). Should be Feb 1..Feb 28.
    let now = d(2023, 3, 31);
    let (start, end) = get_date_period_range(&DatePeriod::LastMonth, now).unwrap();
    assert_eq!(start, d(2023, 2, 1));
    assert_eq!(end, d(2023, 2, 28));
}

#[test]
fn test_period_last_month_day_clamping_31_to_29_leap() {
    // now = 2024-03-31, last month = Feb 2024 (leap: 29 days). Should be Feb 1..Feb 29.
    let now = d(2024, 3, 31);
    let (start, end) = get_date_period_range(&DatePeriod::LastMonth, now).unwrap();
    assert_eq!(start, d(2024, 2, 1));
    assert_eq!(end, d(2024, 2, 29));
}

// -----------------------------------------------------------------------
// Edge case: year boundaries
// -----------------------------------------------------------------------

#[test]
fn test_period_yesterday_jan_1() {
    // now = 2023-01-01, yesterday = Dec 31, 2022
    let now = d(2023, 1, 1);
    let (start, end) = get_date_period_range(&DatePeriod::Yesterday, now).unwrap();
    assert_eq!(start, d(2022, 12, 31));
    assert_eq!(end, d(2022, 12, 31));
}

#[test]
fn test_period_tomorrow_dec_31() {
    // now = 2023-12-31, tomorrow = Jan 1, 2024
    let now = d(2023, 12, 31);
    let (start, end) = get_date_period_range(&DatePeriod::Tomorrow, now).unwrap();
    assert_eq!(start, d(2024, 1, 1));
    assert_eq!(end, d(2024, 1, 1));
}

#[test]
fn test_period_last_7_days_across_year_boundary() {
    // now = 2023-01-03, last 7 days = Dec 28, 2022..Jan 3, 2023
    let now = d(2023, 1, 3);
    let (start, end) = get_date_period_range(&DatePeriod::Last7Days, now).unwrap();
    assert_eq!(start, d(2022, 12, 28));
    assert_eq!(end, d(2023, 1, 3));
}

// -----------------------------------------------------------------------
// Edge case: week boundary spanning month/year
// -----------------------------------------------------------------------

#[test]
fn test_period_this_week_spanning_month() {
    // 2023-01-01 is a Sunday. This week spans Jan 1..Jan 7.
    let now = d(2023, 1, 1);
    let (start, end) = get_date_period_range(&DatePeriod::ThisWeek, now).unwrap();
    assert_eq!(start, d(2023, 1, 1));
    assert_eq!(end, d(2023, 1, 7));
}

#[test]
fn test_period_last_week_at_start_of_year() {
    // now = 2023-01-01 (Sunday). Last week: Dec 25..Dec 31, 2022
    let now = d(2023, 1, 1);
    let (start, end) = get_date_period_range(&DatePeriod::LastWeek, now).unwrap();
    assert_eq!(start, d(2022, 12, 25));
    assert_eq!(end, d(2022, 12, 31));
}

// -----------------------------------------------------------------------
// Edge case: quarter transitions at year boundary
// -----------------------------------------------------------------------

#[test]
fn test_period_next_quarter_from_q4_2023() {
    // now = 2023-10-01 (Q4), next quarter = Q1 2024 (Jan 1..Mar 31)
    let now = d(2023, 10, 1);
    let (start, end) = get_date_period_range(&DatePeriod::NextQuarter, now).unwrap();
    assert_eq!(start, d(2024, 1, 1));
    assert_eq!(end, d(2024, 3, 31));
}

// -----------------------------------------------------------------------
// evaluate_time_period: boundary match tests
// -----------------------------------------------------------------------

#[test]
fn test_evaluate_last_month_first_day() {
    // now = 2023-03-15, last month = Feb. Feb 1 should match.
    let now = d(2023, 3, 15);
    let feb1 = d(2023, 2, 1);
    let serial = date_to_serial(&feb1);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::LastMonth, now));
}

#[test]
fn test_evaluate_last_month_last_day() {
    // now = 2023-03-15, last month = Feb. Feb 28 should match.
    let now = d(2023, 3, 15);
    let feb28 = d(2023, 2, 28);
    let serial = date_to_serial(&feb28);
    let value = CellValue::number(serial);

    assert!(evaluate_time_period(&value, &DatePeriod::LastMonth, now));
}

#[test]
fn test_evaluate_last_month_day_before() {
    // now = 2023-03-15, last month = Feb. Jan 31 should NOT match.
    let now = d(2023, 3, 15);
    let jan31 = d(2023, 1, 31);
    let serial = date_to_serial(&jan31);
    let value = CellValue::number(serial);

    assert!(!evaluate_time_period(&value, &DatePeriod::LastMonth, now));
}

#[test]
fn test_evaluate_last_month_day_after() {
    // now = 2023-03-15, last month = Feb. Mar 1 should NOT match.
    let now = d(2023, 3, 15);
    let mar1 = d(2023, 3, 1);
    let serial = date_to_serial(&mar1);
    let value = CellValue::number(serial);

    assert!(!evaluate_time_period(&value, &DatePeriod::LastMonth, now));
}
