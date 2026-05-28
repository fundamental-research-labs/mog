use super::helpers::now_date;
use crate::filter_resolve::compute_date_range;
use crate::types::DynamicFilterRule;
use chrono::{NaiveDate, Weekday};

#[test]
fn test_compute_date_range_today() {
    let now = now_date();
    let (start, end) = compute_date_range(&DynamicFilterRule::Today, now, Weekday::Sun).unwrap();
    assert_eq!(start, now);
    assert_eq!(end, now);
}

#[test]
fn test_compute_date_range_yesterday_and_tomorrow() {
    let now = now_date();
    let (ystart, yend) =
        compute_date_range(&DynamicFilterRule::Yesterday, now, Weekday::Sun).unwrap();
    assert_eq!(ystart, NaiveDate::from_ymd_opt(2024, 6, 14).unwrap());
    assert_eq!(yend, NaiveDate::from_ymd_opt(2024, 6, 14).unwrap());

    let (tstart, tend) =
        compute_date_range(&DynamicFilterRule::Tomorrow, now, Weekday::Sun).unwrap();
    assert_eq!(tstart, NaiveDate::from_ymd_opt(2024, 6, 16).unwrap());
    assert_eq!(tend, NaiveDate::from_ymd_opt(2024, 6, 16).unwrap());
}

#[test]
fn test_compute_date_range_this_week_sunday_start() {
    let now = now_date();
    let (start, end) = compute_date_range(&DynamicFilterRule::ThisWeek, now, Weekday::Sun).unwrap();
    assert_eq!(start, NaiveDate::from_ymd_opt(2024, 6, 9).unwrap());
    assert_eq!(end, NaiveDate::from_ymd_opt(2024, 6, 15).unwrap());
}

#[test]
fn test_compute_date_range_week_variants() {
    let now = now_date();
    let (last_start, last_end) =
        compute_date_range(&DynamicFilterRule::LastWeek, now, Weekday::Sun).unwrap();
    assert_eq!(last_start, NaiveDate::from_ymd_opt(2024, 6, 2).unwrap());
    assert_eq!(last_end, NaiveDate::from_ymd_opt(2024, 6, 8).unwrap());

    let (next_start, next_end) =
        compute_date_range(&DynamicFilterRule::NextWeek, now, Weekday::Sun).unwrap();
    assert_eq!(next_start, NaiveDate::from_ymd_opt(2024, 6, 16).unwrap());
    assert_eq!(next_end, NaiveDate::from_ymd_opt(2024, 6, 22).unwrap());

    let (mon_start, mon_end) =
        compute_date_range(&DynamicFilterRule::ThisWeek, now, Weekday::Mon).unwrap();
    assert_eq!(mon_start, NaiveDate::from_ymd_opt(2024, 6, 10).unwrap());
    assert_eq!(mon_end, NaiveDate::from_ymd_opt(2024, 6, 16).unwrap());
}

#[test]
fn test_compute_date_range_month_variants() {
    let now = now_date();
    let (this_start, this_end) =
        compute_date_range(&DynamicFilterRule::ThisMonth, now, Weekday::Sun).unwrap();
    assert_eq!(this_start, NaiveDate::from_ymd_opt(2024, 6, 1).unwrap());
    assert_eq!(this_end, NaiveDate::from_ymd_opt(2024, 6, 30).unwrap());

    let (last_start, last_end) =
        compute_date_range(&DynamicFilterRule::LastMonth, now, Weekday::Sun).unwrap();
    assert_eq!(last_start, NaiveDate::from_ymd_opt(2024, 5, 1).unwrap());
    assert_eq!(last_end, NaiveDate::from_ymd_opt(2024, 5, 31).unwrap());

    let (next_start, next_end) =
        compute_date_range(&DynamicFilterRule::NextMonth, now, Weekday::Sun).unwrap();
    assert_eq!(next_start, NaiveDate::from_ymd_opt(2024, 7, 1).unwrap());
    assert_eq!(next_end, NaiveDate::from_ymd_opt(2024, 7, 31).unwrap());
}

#[test]
fn test_compute_date_range_quarter_variants() {
    let now = now_date();
    let (this_start, this_end) =
        compute_date_range(&DynamicFilterRule::ThisQuarter, now, Weekday::Sun).unwrap();
    assert_eq!(this_start, NaiveDate::from_ymd_opt(2024, 4, 1).unwrap());
    assert_eq!(this_end, NaiveDate::from_ymd_opt(2024, 6, 30).unwrap());

    let (last_start, last_end) =
        compute_date_range(&DynamicFilterRule::LastQuarter, now, Weekday::Sun).unwrap();
    assert_eq!(last_start, NaiveDate::from_ymd_opt(2024, 1, 1).unwrap());
    assert_eq!(last_end, NaiveDate::from_ymd_opt(2024, 3, 31).unwrap());

    let (next_start, next_end) =
        compute_date_range(&DynamicFilterRule::NextQuarter, now, Weekday::Sun).unwrap();
    assert_eq!(next_start, NaiveDate::from_ymd_opt(2024, 7, 1).unwrap());
    assert_eq!(next_end, NaiveDate::from_ymd_opt(2024, 9, 30).unwrap());
}

#[test]
fn test_compute_date_range_this_year() {
    let now = now_date();
    let (start, end) = compute_date_range(&DynamicFilterRule::ThisYear, now, Weekday::Sun).unwrap();
    assert_eq!(start, NaiveDate::from_ymd_opt(2024, 1, 1).unwrap());
    assert_eq!(end, NaiveDate::from_ymd_opt(2024, 12, 31).unwrap());
}

#[test]
fn test_compute_date_range_year_variants() {
    let now = now_date();
    let (last_start, last_end) =
        compute_date_range(&DynamicFilterRule::LastYear, now, Weekday::Sun).unwrap();
    assert_eq!(last_start, NaiveDate::from_ymd_opt(2023, 1, 1).unwrap());
    assert_eq!(last_end, NaiveDate::from_ymd_opt(2023, 12, 31).unwrap());

    let (next_start, next_end) =
        compute_date_range(&DynamicFilterRule::NextYear, now, Weekday::Sun).unwrap();
    assert_eq!(next_start, NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
    assert_eq!(next_end, NaiveDate::from_ymd_opt(2025, 12, 31).unwrap());
}

#[test]
fn test_compute_date_range_year_boundary_last_quarter() {
    let now = NaiveDate::from_ymd_opt(2025, 2, 10).unwrap();
    let (start, end) =
        compute_date_range(&DynamicFilterRule::LastQuarter, now, Weekday::Sun).unwrap();
    assert_eq!(start, NaiveDate::from_ymd_opt(2024, 10, 1).unwrap());
    assert_eq!(end, NaiveDate::from_ymd_opt(2024, 12, 31).unwrap());
}

#[test]
fn test_compute_date_range_non_date_rules_keep_fallback() {
    let now = now_date();
    assert_eq!(
        compute_date_range(&DynamicFilterRule::AboveAverage, now, Weekday::Sun),
        Some((now, now))
    );
    assert_eq!(
        compute_date_range(&DynamicFilterRule::BelowAverage, now, Weekday::Sun),
        Some((now, now))
    );
}
