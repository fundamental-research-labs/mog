use crate::types::{ConditionFilter, FilterCriteria};
use chrono::NaiveDate;
use value_types::{CellValue, FiniteF64, date_to_serial};

pub(super) fn cv_num(n: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(n))
}

pub(super) fn cv_text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

pub(super) fn cv_null() -> CellValue {
    CellValue::Null
}

pub(super) fn as_condition(fc: &FilterCriteria) -> &ConditionFilter {
    match fc {
        FilterCriteria::Condition(cf) => cf,
        _ => panic!("Expected ConditionFilter, got {:?}", fc),
    }
}

pub(super) fn start_of_day_ms(year: i32, month: u32, day: u32) -> f64 {
    NaiveDate::from_ymd_opt(year, month, day)
        .unwrap()
        .and_hms_milli_opt(0, 0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis() as f64
}

pub(super) fn end_of_day_ms(year: i32, month: u32, day: u32) -> f64 {
    NaiveDate::from_ymd_opt(year, month, day)
        .unwrap()
        .and_hms_milli_opt(23, 59, 59, 999)
        .unwrap()
        .and_utc()
        .timestamp_millis() as f64
}

pub(super) fn extract_range(cf: &ConditionFilter) -> (f64, f64) {
    assert_eq!(cf.conditions.len(), 1);
    let start = match &cf.conditions[0].value {
        CellValue::Number(v) => v.get(),
        _ => panic!("Expected Number"),
    };
    let end = match cf.conditions[0].value2.as_ref().unwrap() {
        CellValue::Number(v) => v.get(),
        _ => panic!("Expected Number"),
    };
    (start, end)
}

pub(super) fn now_date() -> NaiveDate {
    NaiveDate::from_ymd_opt(2024, 6, 15).unwrap()
}

pub(super) fn ymd_to_serial_date(y: i32, m: u32, d: u32) -> f64 {
    date_to_serial(&NaiveDate::from_ymd_opt(y, m, d).unwrap())
}
