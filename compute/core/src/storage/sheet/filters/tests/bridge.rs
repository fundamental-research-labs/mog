use super::super::bridge::column_filter_to_table_criteria;
use super::super::{ColumnFilter, FilterCondition, FilterLogic, FilterOperator};
use value_types::{CellValue, FiniteF64};

fn eval_column_filter(criteria: &ColumnFilter, data: &[CellValue]) -> Vec<bool> {
    let table_criteria = column_filter_to_table_criteria(criteria);
    let bitmap =
        compute_table::filter::evaluate_column_filter(&table_criteria, data, None, None, None);
    bitmap.iter().map(|&b| b == 1).collect()
}

#[test]
fn test_condition_is_blank() {
    let data = vec![
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::Text("hello".into()),
    ];

    let blank_filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::IsBlank,
            value: None,
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let result = eval_column_filter(&blank_filter, &data);
    assert_eq!(result, vec![true, true, false]);

    let not_blank_filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::IsNotBlank,
            value: None,
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let result = eval_column_filter(&not_blank_filter, &data);
    assert_eq!(result, vec![false, false, true]);
}

#[test]
fn test_condition_string_operators() {
    let data = vec![CellValue::Text("Hello World".into())];

    let contains = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::Contains,
            value: Some(CellValue::from("world")),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&contains, &data), vec![true]);

    let not_contains = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::NotContains,
            value: Some(CellValue::from("xyz")),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&not_contains, &data), vec![true]);

    let starts = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::BeginsWith,
            value: Some(CellValue::from("hello")),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&starts, &data), vec![true]);

    let ends = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::EndsWith,
            value: Some(CellValue::from("world")),
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&ends, &data), vec![true]);
}

#[test]
fn test_condition_between() {
    let data = vec![
        CellValue::Number(FiniteF64::must(50.0)),
        CellValue::Number(FiniteF64::must(75.0)),
        CellValue::Number(FiniteF64::must(150.0)),
    ];

    let between = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::Between,
            value: Some(CellValue::number(40.0)),
            value2: Some(CellValue::number(100.0)),
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&between, &data), vec![true, true, false]);

    let not_between = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::NotBetween,
            value: Some(CellValue::number(40.0)),
            value2: Some(CellValue::number(100.0)),
        }],
        logic: FilterLogic::And,
    };
    assert_eq!(
        eval_column_filter(&not_between, &data),
        vec![false, false, true]
    );
}

#[test]
fn test_value_filter_case_insensitive() {
    let data = vec![CellValue::Text("Apple".into())];

    let filter1 = ColumnFilter::Values {
        values: vec![serde_json::Value::String("apple".to_string())],
        include_blanks: false,
    };
    assert_eq!(eval_column_filter(&filter1, &data), vec![true]);

    let filter2 = ColumnFilter::Values {
        values: vec![serde_json::Value::String("APPLE".to_string())],
        include_blanks: false,
    };
    assert_eq!(eval_column_filter(&filter2, &data), vec![true]);

    let filter3 = ColumnFilter::Values {
        values: vec![serde_json::Value::String("Banana".to_string())],
        include_blanks: false,
    };
    assert_eq!(eval_column_filter(&filter3, &data), vec![false]);
}

#[test]
fn test_value_filter_blanks() {
    let data = vec![CellValue::Null, CellValue::Text("".into())];

    // include_blanks: true
    let filter_with_blanks = ColumnFilter::Values {
        values: vec![serde_json::json!("Apple")],
        include_blanks: true,
    };
    let result = eval_column_filter(&filter_with_blanks, &data);
    assert_eq!(result, vec![true, true]);

    // include_blanks: false
    let filter_no_blanks = ColumnFilter::Values {
        values: vec![serde_json::json!("Apple")],
        include_blanks: false,
    };
    let result = eval_column_filter(&filter_no_blanks, &data);
    assert_eq!(result, vec![false, false]);
}

#[test]
fn test_condition_filter_or_logic() {
    let data = vec![CellValue::Number(FiniteF64::must(10.0))];

    let conditions = vec![
        FilterCondition {
            operator: FilterOperator::Equals,
            value: Some(CellValue::number(10.0)),
            value2: None,
        },
        FilterCondition {
            operator: FilterOperator::Equals,
            value: Some(CellValue::number(20.0)),
            value2: None,
        },
    ];

    // OR: 10 == 10 -> true
    let or_filter = ColumnFilter::Condition {
        conditions: conditions.clone(),
        logic: FilterLogic::Or,
    };
    assert_eq!(eval_column_filter(&or_filter, &data), vec![true]);

    // AND: 10 == 10 && 10 == 20 -> false
    let and_filter = ColumnFilter::Condition {
        conditions,
        logic: FilterLogic::And,
    };
    assert_eq!(eval_column_filter(&and_filter, &data), vec![false]);
}

#[test]
fn test_condition_above_below_average() {
    // Data: 80, 20, text. Average of numeric values = 50.
    let data = vec![
        CellValue::Number(FiniteF64::must(80.0)),
        CellValue::Number(FiniteF64::must(20.0)),
        CellValue::Text("text".into()),
    ];

    // AboveAverage via Condition operator (converted to DynamicFilter internally)
    let above_filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::AboveAverage,
            value: None,
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let result = eval_column_filter(&above_filter, &data);
    // 80 > 50 (above avg), 20 < 50 (not above), "text" (not numeric, not above)
    assert_eq!(result, vec![true, false, false]);

    // BelowAverage via Condition operator
    let below_filter = ColumnFilter::Condition {
        conditions: vec![FilterCondition {
            operator: FilterOperator::BelowAverage,
            value: None,
            value2: None,
        }],
        logic: FilterLogic::And,
    };
    let result = eval_column_filter(&below_filter, &data);
    // 80 > 50 (not below), 20 < 50 (below avg), "text" (not numeric, not below)
    assert_eq!(result, vec![false, true, false]);
}
