use super::helpers::{cv_num, cv_text, start_of_day_ms};
use crate::filter::evaluate_column_filter;
use crate::types::{
    ConditionFilter, DynamicFilter, DynamicFilterRule, FilterCriteria, FilterLogic, FilterOperator,
    TableFilterCondition,
};
use crate::visibility::compose_bitmaps;
use chrono::{NaiveDate, Weekday};

#[test]
fn test_dynamic_date_filter_today() {
    // Dynamic date filters use millisecond timestamps in the resolved condition.
    let data = vec![
        cv_num(start_of_day_ms(2024, 1, 1)),
        cv_num(start_of_day_ms(2024, 1, 2)),
        cv_num(start_of_day_ms(2024, 1, 3)),
        cv_num(start_of_day_ms(2024, 1, 4)),
        cv_num(start_of_day_ms(2024, 1, 5)),
    ];

    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::Today,
    });
    let now = NaiveDate::from_ymd_opt(2024, 1, 3).unwrap();
    let bitmap = evaluate_column_filter(&criteria, &data, None, Some(now), Some(Weekday::Sun));

    assert_eq!(bitmap, vec![0, 0, 1, 0, 0]);
}

#[test]
fn test_dynamic_date_filter_this_week() {
    let data = vec![
        cv_num(start_of_day_ms(2024, 1, 1)),
        cv_num(start_of_day_ms(2024, 1, 2)),
        cv_num(start_of_day_ms(2024, 1, 6)),
        cv_num(start_of_day_ms(2024, 1, 7)),
        cv_num(start_of_day_ms(2024, 1, 8)),
    ];

    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::ThisWeek,
    });
    let now = NaiveDate::from_ymd_opt(2024, 1, 3).unwrap();
    let bitmap = evaluate_column_filter(&criteria, &data, None, Some(now), Some(Weekday::Sun));

    assert_eq!(bitmap, vec![1, 1, 1, 0, 0]);
}

#[test]
fn test_multi_column_filter_composition() {
    let col_a_data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0), cv_num(40.0)];
    let col_b_data = vec![
        cv_text("apple"),
        cv_text("banana"),
        cv_text("cherry"),
        cv_text("date"),
    ];

    let filter_a = ConditionFilter {
        conditions: vec![TableFilterCondition {
            operator: FilterOperator::GreaterThan,
            value: cv_num(15.0),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let filter_b = ConditionFilter {
        conditions: vec![TableFilterCondition {
            operator: FilterOperator::Contains,
            value: cv_text("a"),
            value2: None,
        }],
        logic: FilterLogic::And,
    };

    let bitmap_a = evaluate_column_filter(
        &FilterCriteria::Condition(filter_a),
        &col_a_data,
        None,
        None,
        None,
    );
    let bitmap_b = evaluate_column_filter(
        &FilterCriteria::Condition(filter_b),
        &col_b_data,
        None,
        None,
        None,
    );

    assert_eq!(bitmap_a, vec![0, 1, 1, 1]);
    assert_eq!(bitmap_b, vec![1, 1, 0, 1]);
    assert_eq!(compose_bitmaps(&[&bitmap_a, &bitmap_b]), vec![0, 1, 0, 1]);
}
