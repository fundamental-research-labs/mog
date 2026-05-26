//! Filter integration tests: include/exclude lists, condition filters,
//! topN filters, show_items_with_no_data, and related sensitivity tests.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

// ---- Basic filter tests ----

#[test]
fn compute_applies_filters() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: Some(vec![cv_text("East")]),
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].headers[0].value, cv_text("East"));
}

// ---- SpreadJS filter tests ----

#[test]
fn spreadjs_filter_include() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "filter_include",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![PivotFilter {
            field_id: FieldId::from("product"),
            include_values: Some(vec![cv_text("Widget")]),
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: None,
        }],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    assert_eq!(result.rows.len(), 2, "should have 2 rows after filter");

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 2200.0, "East SUM(Sales) filtered");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 3300.0, "West SUM(Sales) filtered");

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 5500.0, "Grand Total SUM(Sales) filtered");
}

#[test]
fn spreadjs_filter_exclude() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "filter_exclude",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![PivotFilter {
            field_id: FieldId::from("quarter"),
            include_values: None,
            exclude_values: Some(vec![cv_text("Q2")]),
            condition: None,
            top_bottom: None,
            show_items_with_no_data: None,
        }],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    assert_eq!(
        result.rows.len(),
        2,
        "should have 2 rows after exclude filter"
    );

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 1800.0, "East SUM(Sales) Q1 only");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 2200.0, "West SUM(Sales) Q1 only");

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 4000.0, "Grand Total SUM(Sales) Q1 only");
}

// ---- B4i: TopBottom with N=0 ----

#[test]
fn b4i_top_bottom_filter_n_zero() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: Some(PivotTopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 0.0,
                by: TopBottomBy::Items,
                value_field_id: None,
            }),
            show_items_with_no_data: None,
        }],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(
        result.rows.len(),
        0,
        "Top 0 items should return no rows, got {}",
        result.rows.len()
    );
}

// ---- Sensitivity tests ----

#[test]
fn sensitivity_filter_condition() {
    let config_no_filter = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_no_filter = compute(&config_no_filter, &sample_sales_data(), Some(&expand_all()));

    let config_filtered = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::GreaterThan,
                value: Some(cv_num(1000.0)),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );
    let result_filtered = compute(&config_filtered, &sample_sales_data(), Some(&expand_all()));

    assert!(
        result_filtered.rows.len() < result_no_filter.rows.len(),
        "filter_condition must reduce row count: filtered={}, unfiltered={}",
        result_filtered.rows.len(),
        result_no_filter.rows.len(),
    );
}

#[test]
fn sensitivity_include_exclude_list() {
    let config_no_filter = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_no_filter = compute(&config_no_filter, &sample_sales_data(), Some(&expand_all()));

    let config_include = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: Some(vec![cv_text("East")]),
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );
    let result_include = compute(&config_include, &sample_sales_data(), Some(&expand_all()));

    assert!(
        result_include.rows.len() < result_no_filter.rows.len(),
        "include_exclude_list must reduce row count: included={}, unfiltered={}",
        result_include.rows.len(),
        result_no_filter.rows.len(),
    );
}

#[test]
fn sensitivity_top_bottom_filter() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Amount")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("A"), cv_num(200.0)],
        vec![cv_text("B"), cv_num(50.0)],
        vec![cv_text("C"), cv_num(10.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("category"),
            name: "Category".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let config_no_filter = make_base_config(
        fields.clone(),
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement(
                "amount",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_no_filter = compute(&config_no_filter, &data, Some(&expand_all()));
    assert_eq!(
        result_no_filter.rows.len(),
        3,
        "unfiltered should have 3 category rows"
    );

    let config_top = make_base_config(
        fields,
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement(
                "amount",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![PivotFilter {
            field_id: FieldId::from("category"),
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: Some(PivotTopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 1.0,
                by: TopBottomBy::Items,
                value_field_id: Some(FieldId::from("amount")),
            }),
            show_items_with_no_data: None,
        }],
    );
    let result_top = compute(&config_top, &data, Some(&expand_all()));

    assert!(
        result_top.rows.len() < result_no_filter.rows.len(),
        "top_bottom_filter must reduce row count: top={}, unfiltered={}",
        result_top.rows.len(),
        result_no_filter.rows.len(),
    );
}

#[test]
fn sensitivity_show_items_with_no_data() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(10.0)],
        vec![CellValue::Null, cv_num(20.0)],
        vec![cv_text("B"), cv_num(30.0)],
        vec![cv_text(""), cv_num(40.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("category"),
            name: "Category".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("value"),
            name: "Value".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let config_hide = make_base_config(
        fields.clone(),
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![PivotFilter {
            field_id: FieldId::from("category"),
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: Some(false),
        }],
    );
    let result_hide = compute(&config_hide, &data, Some(&expand_all()));

    let config_show = make_base_config(
        fields,
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![PivotFilter {
            field_id: FieldId::from("category"),
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: Some(true),
        }],
    );
    let result_show = compute(&config_show, &data, Some(&expand_all()));

    assert_ne!(
        result_hide.rows.len(),
        result_show.rows.len(),
        "show_items_with_no_data must affect row count: hide={}, show={}",
        result_hide.rows.len(),
        result_show.rows.len(),
    );
}
