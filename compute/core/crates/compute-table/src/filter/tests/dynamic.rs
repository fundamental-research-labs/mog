use super::fixtures::*;
use super::*;

#[test]
fn test_dynamic_above_average() {
    use crate::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::AboveAverage,
    });
    // Average of [10, 20, 30, 40, 50] = 30
    // BUG FIX: uses >= so 30 IS included
    let data = vec![
        cv_num(10.0),
        cv_num(20.0),
        cv_num(30.0),
        cv_num(40.0),
        cv_num(50.0),
    ];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    // Above average (>= 30): 30, 40, 50
    assert_eq!(bitmap, vec![0, 0, 1, 1, 1]);
}

#[test]
fn test_dynamic_below_average() {
    use crate::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::BelowAverage,
    });
    // Average = 30
    // BUG FIX: uses <= so 30 IS included
    let data = vec![
        cv_num(10.0),
        cv_num(20.0),
        cv_num(30.0),
        cv_num(40.0),
        cv_num(50.0),
    ];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    // Below average (<= 30): 10, 20, 30
    assert_eq!(bitmap, vec![1, 1, 1, 0, 0]);
}

#[test]
fn test_dynamic_above_average_ignores_non_numeric() {
    use crate::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::AboveAverage,
    });
    // Numeric values: 10, 20, 30. Average = 20.
    let data = vec![
        cv_num(10.0),
        cv_text("text"),
        cv_num(20.0),
        cv_null(),
        cv_num(30.0),
    ];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    // Above average (>= 20): 20, 30
    assert_eq!(bitmap, vec![0, 0, 1, 0, 1]);
}

#[test]
fn test_dynamic_below_average_all_non_numeric() {
    use crate::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::BelowAverage,
    });
    let data = vec![cv_text("a"), cv_null(), cv_text("b")];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    assert_eq!(bitmap, vec![0, 0, 0]);
}

#[test]
fn test_dynamic_above_average_single_value() {
    use crate::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::AboveAverage,
    });
    // Average of [10] = 10. With >= fix, 10 IS included.
    let data = vec![cv_num(10.0)];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    assert_eq!(bitmap, vec![1]);
}
