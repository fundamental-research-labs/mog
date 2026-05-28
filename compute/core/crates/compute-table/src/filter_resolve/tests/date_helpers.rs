use crate::filter_resolve::{
    test_add_months, test_end_of_month, test_quarter, test_start_of_week, test_subtract_months,
};
use chrono::{NaiveDate, Weekday};

#[test]
fn test_quarter_function() {
    assert_eq!(test_quarter(1), 1);
    assert_eq!(test_quarter(3), 1);
    assert_eq!(test_quarter(4), 2);
    assert_eq!(test_quarter(6), 2);
    assert_eq!(test_quarter(7), 3);
    assert_eq!(test_quarter(9), 3);
    assert_eq!(test_quarter(10), 4);
    assert_eq!(test_quarter(12), 4);
}

#[test]
fn test_end_of_month_various() {
    assert_eq!(
        test_end_of_month(2024, 2).unwrap(),
        NaiveDate::from_ymd_opt(2024, 2, 29).unwrap()
    );
    assert_eq!(
        test_end_of_month(2023, 2).unwrap(),
        NaiveDate::from_ymd_opt(2023, 2, 28).unwrap()
    );
    assert_eq!(
        test_end_of_month(2024, 6).unwrap(),
        NaiveDate::from_ymd_opt(2024, 6, 30).unwrap()
    );
    assert_eq!(
        test_end_of_month(2024, 12).unwrap(),
        NaiveDate::from_ymd_opt(2024, 12, 31).unwrap()
    );
}

#[test]
fn test_start_of_week_sunday_start() {
    let d = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
    let start = test_start_of_week(d, Weekday::Sun);
    assert_eq!(start, NaiveDate::from_ymd_opt(2024, 6, 9).unwrap());
}

#[test]
fn test_start_of_week_monday_start() {
    let d = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
    let start = test_start_of_week(d, Weekday::Mon);
    assert_eq!(start, NaiveDate::from_ymd_opt(2024, 6, 10).unwrap());
}

#[test]
fn test_subtract_months_wraps_year() {
    assert_eq!(test_subtract_months(2025, 1, 1), (2024, 12));
    assert_eq!(test_subtract_months(2025, 1, 3), (2024, 10));
    assert_eq!(test_subtract_months(2024, 3, 3), (2023, 12));
}

#[test]
fn test_add_months_wraps_year() {
    assert_eq!(test_add_months(2024, 12, 1), (2025, 1));
    assert_eq!(test_add_months(2024, 10, 3), (2025, 1));
    assert_eq!(test_add_months(2024, 6, 3), (2024, 9));
}
