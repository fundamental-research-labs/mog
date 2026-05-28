use super::helpers::{end_of_day_ms, extract_range, now_date, start_of_day_ms};
use crate::filter_resolve::test_resolve_date_range_filter_for_rule;
use crate::types::DynamicFilterRule;
use chrono::{NaiveDate, Weekday};

#[test]
fn test_ms_today() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::Today,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 6, 15));
    assert_eq!(end, end_of_day_ms(2024, 6, 15));
}

#[test]
fn test_ms_yesterday() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::Yesterday,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 6, 14));
    assert_eq!(end, end_of_day_ms(2024, 6, 14));
}

#[test]
fn test_ms_tomorrow() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::Tomorrow,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 6, 16));
    assert_eq!(end, end_of_day_ms(2024, 6, 16));
}

#[test]
fn test_ms_this_month() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::ThisMonth,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 6, 1));
    assert_eq!(end, end_of_day_ms(2024, 6, 30));
}

#[test]
fn test_ms_last_month() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::LastMonth,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 5, 1));
    assert_eq!(end, end_of_day_ms(2024, 5, 31));
}

#[test]
fn test_ms_next_month() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::NextMonth,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 7, 1));
    assert_eq!(end, end_of_day_ms(2024, 7, 31));
}

#[test]
fn test_ms_this_year() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::ThisYear,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 1, 1));
    assert_eq!(end, end_of_day_ms(2024, 12, 31));
}

#[test]
fn test_ms_last_year() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::LastYear,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2023, 1, 1));
    assert_eq!(end, end_of_day_ms(2023, 12, 31));
}

#[test]
fn test_ms_next_year() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::NextYear,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2025, 1, 1));
    assert_eq!(end, end_of_day_ms(2025, 12, 31));
}

#[test]
fn test_ms_this_quarter_q2() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::ThisQuarter,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 4, 1));
    assert_eq!(end, end_of_day_ms(2024, 6, 30));
}

#[test]
fn test_ms_last_quarter_q1() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::LastQuarter,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 1, 1));
    assert_eq!(end, end_of_day_ms(2024, 3, 31));
}

#[test]
fn test_ms_next_quarter_q3() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::NextQuarter,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 7, 1));
    assert_eq!(end, end_of_day_ms(2024, 9, 30));
}

#[test]
fn test_ms_this_week_sunday_start() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::ThisWeek,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 6, 9));
    assert_eq!(end, end_of_day_ms(2024, 6, 15));
}

#[test]
fn test_ms_last_week() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::LastWeek,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 6, 2));
    assert_eq!(end, end_of_day_ms(2024, 6, 8));
}

#[test]
fn test_ms_next_week() {
    let result = test_resolve_date_range_filter_for_rule(
        &DynamicFilterRule::NextWeek,
        now_date(),
        Weekday::Sun,
    );
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 6, 16));
    assert_eq!(end, end_of_day_ms(2024, 6, 22));
}

#[test]
fn test_ms_last_month_january_wraps_to_december() {
    let now = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
    let result =
        test_resolve_date_range_filter_for_rule(&DynamicFilterRule::LastMonth, now, Weekday::Sun);
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 12, 1));
    assert_eq!(end, end_of_day_ms(2024, 12, 31));
}

#[test]
fn test_ms_last_quarter_q1_wraps_to_q4() {
    let now = NaiveDate::from_ymd_opt(2025, 2, 10).unwrap();
    let result =
        test_resolve_date_range_filter_for_rule(&DynamicFilterRule::LastQuarter, now, Weekday::Sun);
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 10, 1));
    assert_eq!(end, end_of_day_ms(2024, 12, 31));
}

#[test]
fn test_ms_next_month_december_wraps_to_january() {
    let now = NaiveDate::from_ymd_opt(2024, 12, 15).unwrap();
    let result =
        test_resolve_date_range_filter_for_rule(&DynamicFilterRule::NextMonth, now, Weekday::Sun);
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2025, 1, 1));
    assert_eq!(end, end_of_day_ms(2025, 1, 31));
}

#[test]
fn test_ms_this_week_spans_month_boundary() {
    let now = NaiveDate::from_ymd_opt(2025, 3, 31).unwrap();
    let result =
        test_resolve_date_range_filter_for_rule(&DynamicFilterRule::ThisWeek, now, Weekday::Sun);
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2025, 3, 30));
    assert_eq!(end, end_of_day_ms(2025, 4, 5));
}

#[test]
fn test_ms_last_week_year_boundary() {
    let now = NaiveDate::from_ymd_opt(2025, 1, 3).unwrap();
    let result =
        test_resolve_date_range_filter_for_rule(&DynamicFilterRule::LastWeek, now, Weekday::Sun);
    let (start, end) = extract_range(&result.unwrap());
    assert_eq!(start, start_of_day_ms(2024, 12, 22));
    assert_eq!(end, end_of_day_ms(2024, 12, 28));
}
