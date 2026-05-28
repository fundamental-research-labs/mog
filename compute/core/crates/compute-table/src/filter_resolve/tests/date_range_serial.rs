use super::helpers::{now_date, ymd_to_serial_date};
use crate::filter_resolve::compute_date_range_serial;
use crate::types::DynamicFilterRule;
use chrono::Weekday;

// The kernel bridge compares against date cells stored as Excel serials, so
// these outputs must stay in the same number space rather than Unix millis.

#[test]
fn test_compute_date_range_serial_today() {
    let now = now_date();
    let (start, end) =
        compute_date_range_serial(&DynamicFilterRule::Today, now, Weekday::Sun).unwrap();
    let s = ymd_to_serial_date(2024, 6, 15);
    assert_eq!(start, s);
    assert_eq!(end, s);
}

#[test]
fn test_compute_date_range_serial_this_week() {
    let now = now_date();
    let (start, end) =
        compute_date_range_serial(&DynamicFilterRule::ThisWeek, now, Weekday::Sun).unwrap();
    assert_eq!(start, ymd_to_serial_date(2024, 6, 9));
    assert_eq!(end, ymd_to_serial_date(2024, 6, 15));
}

#[test]
fn test_compute_date_range_serial_last_month() {
    let now = now_date();
    let (start, end) =
        compute_date_range_serial(&DynamicFilterRule::LastMonth, now, Weekday::Sun).unwrap();
    assert_eq!(start, ymd_to_serial_date(2024, 5, 1));
    assert_eq!(end, ymd_to_serial_date(2024, 5, 31));
}

#[test]
fn test_compute_date_range_serial_year_to_date_alias_this_year() {
    let now = now_date();
    let (start, end) =
        compute_date_range_serial(&DynamicFilterRule::ThisYear, now, Weekday::Sun).unwrap();
    assert_eq!(start, ymd_to_serial_date(2024, 1, 1));
    assert_eq!(end, ymd_to_serial_date(2024, 12, 31));
}

#[test]
fn test_compute_date_range_serial_yesterday_and_tomorrow() {
    let now = now_date();
    let (ystart, yend) =
        compute_date_range_serial(&DynamicFilterRule::Yesterday, now, Weekday::Sun).unwrap();
    assert_eq!(ystart, ymd_to_serial_date(2024, 6, 14));
    assert_eq!(yend, ymd_to_serial_date(2024, 6, 14));

    let (tstart, tend) =
        compute_date_range_serial(&DynamicFilterRule::Tomorrow, now, Weekday::Sun).unwrap();
    assert_eq!(tstart, ymd_to_serial_date(2024, 6, 16));
    assert_eq!(tend, ymd_to_serial_date(2024, 6, 16));
}

#[test]
fn test_compute_date_range_serial_returns_none_for_above_below_average() {
    let now = now_date();
    assert!(
        compute_date_range_serial(&DynamicFilterRule::AboveAverage, now, Weekday::Sun).is_none()
    );
    assert!(
        compute_date_range_serial(&DynamicFilterRule::BelowAverage, now, Weekday::Sun).is_none()
    );
}

#[test]
fn test_compute_date_range_serial_monday_week_start() {
    let now = now_date();
    let (start, end) =
        compute_date_range_serial(&DynamicFilterRule::ThisWeek, now, Weekday::Mon).unwrap();
    assert_eq!(start, ymd_to_serial_date(2024, 6, 10));
    assert_eq!(end, ymd_to_serial_date(2024, 6, 16));
}
