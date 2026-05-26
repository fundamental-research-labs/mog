//! Multi-level row/column grouping, date/number grouping, and related
//! sensitivity tests.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

// ---- Multi-level grouping ----

#[test]
fn compute_multiple_row_fields() {
    let config = make_base_config(
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

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    // 2 regions x 2 products = 4 leaf rows plus 2 parent rows = at least 4
    assert!(result.rows.len() >= 4);
}

#[test]
fn compute_column_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    assert!(!result.column_headers.is_empty());

    // Each row should have 2 values (Q1 and Q2)
    assert_eq!(result.rows[0].values.len(), 2);
}

// ---- SpreadJS ground truth: grouping tests ----

#[test]
fn spreadjs_two_row_fields() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "two_row_fields",
        &spreadjs_sales_fields(),
        &["Region", "Product"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let east_gadget = find_row_by_key(&result.rows, "East|Gadget").expect("East|Gadget not found");
    assert_approx(&east_gadget.values[0], 1700.0, "East|Gadget SUM(Sales)");

    let east_widget = find_row_by_key(&result.rows, "East|Widget").expect("East|Widget not found");
    assert_approx(&east_widget.values[0], 2200.0, "East|Widget SUM(Sales)");

    let west_gadget = find_row_by_key(&result.rows, "West|Gadget").expect("West|Gadget not found");
    assert_approx(&west_gadget.values[0], 1300.0, "West|Gadget SUM(Sales)");

    let west_widget = find_row_by_key(&result.rows, "West|Widget").expect("West|Widget not found");
    assert_approx(&west_widget.values[0], 3300.0, "West|Widget SUM(Sales)");

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 8500.0, "Grand Total SUM(Sales)");
}

#[test]
fn spreadjs_row_and_column_field() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "row_and_column_field",
        &spreadjs_sales_fields(),
        &["Region"],
        &["Quarter"],
        &[("Sales", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    assert!(
        !result.column_headers.is_empty(),
        "column_headers should not be empty"
    );

    let quarter_header = &result.column_headers[0];
    let col_values: Vec<String> = quarter_header
        .headers
        .iter()
        .map(|h| match &h.value {
            CellValue::Text(s) => s.to_string(),
            _ => String::new(),
        })
        .collect();

    let q1_idx = col_values
        .iter()
        .position(|v| v == "Q1")
        .expect("Q1 not found in column headers");
    let q2_idx = col_values
        .iter()
        .position(|v| v == "Q2")
        .expect("Q2 not found in column headers");

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[q1_idx], 1800.0, "East Q1");
    assert_approx(&east.values[q2_idx], 2100.0, "East Q2");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[q1_idx], 2200.0, "West Q1");
    assert_approx(&west.values[q2_idx], 2400.0, "West Q2");

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    let gt_sum: f64 = gt
        .iter()
        .filter_map(|v| match v {
            CellValue::Number(n) => Some(n.get()),
            _ => None,
        })
        .sum();
    assert!(
        (gt_sum - 8500.0).abs() < 1e-5,
        "Grand Total sum should be 8500, got {}",
        gt_sum
    );
}

// ---- B4b: Column-only pivot (no row fields) ----

#[test]
fn b4b_column_only_pivot_no_row_fields() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert!(
        !result.column_headers.is_empty(),
        "Should have column headers"
    );

    if !result.rows.is_empty() {
        let row_values: Vec<f64> = result.rows[0]
            .values
            .iter()
            .filter_map(|v| match v {
                CellValue::Number(n) => Some(n.get()),
                _ => None,
            })
            .collect();
        assert!(!row_values.is_empty(), "Row should have aggregated values");
    }
}

// ---- B4d: Multiple column fields (2+ levels) ----

#[test]
fn b4d_multiple_column_fields_two_levels() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("product", PivotFieldArea::Row, 0, None),
            make_placement("region", PivotFieldArea::Column, 0, None),
            make_placement("quarter", PivotFieldArea::Column, 1, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    assert!(
        result.column_headers.len() >= 2,
        "Should have at least 2 column header levels, got {}",
        result.column_headers.len()
    );

    for row in &result.rows {
        assert!(
            row.values.len() >= 4,
            "Each row should have >= 4 values for 2x2 column leaves, got {}",
            row.values.len()
        );
    }

    let widget_row = result
        .rows
        .iter()
        .find(|r| r.headers.iter().any(|h| h.value == cv_text("Widget")));
    assert!(widget_row.is_some(), "Should have a Widget row");
    let widget_total: f64 = widget_row
        .unwrap()
        .values
        .iter()
        .filter_map(|v| match v {
            CellValue::Number(n) => Some(n.get()),
            _ => None,
        })
        .sum();
    assert!(
        (widget_total - 5500.0).abs() < 0.01,
        "Widget total should be 5500, got {}",
        widget_total
    );
}

// ---- B4f: Date grouping on column fields ----

#[test]
fn b4f_date_grouping_on_column_fields() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Date"), cv_text("Amount")],
        vec![cv_text("A"), cv_num(45292.0), cv_num(100.0)],
        vec![cv_text("A"), cv_num(45323.0), cv_num(200.0)],
        vec![cv_text("B"), cv_num(45292.0), cv_num(300.0)],
        vec![cv_text("B"), cv_num(45352.0), cv_num(400.0)],
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
            id: FieldId::from("date"),
            name: "Date".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Date,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let col_axis = AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("date"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: Some(DateGrouping::Month),
        number_grouping: None,
        show_subtotals: None,
    };

    let config = make_base_config(
        fields,
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Column(col_axis),
            make_placement(
                "amount",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    assert!(
        !result.column_headers.is_empty(),
        "Should have column headers for date grouping"
    );

    let all_header_values: Vec<String> = result
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter())
        .filter_map(|h| match &h.value {
            CellValue::Text(s) => Some(s.to_string()),
            _ => None,
        })
        .collect();

    assert!(
        !all_header_values.is_empty(),
        "Column headers should have text values for months"
    );
}

// ---- B4k: Date/number grouping with NaN/Infinity input ----

#[test]
fn b4k_number_grouping_nan_infinity_input() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Score")],
        vec![cv_text("A"), cv_num(f64::NAN)],
        vec![cv_text("B"), cv_num(f64::INFINITY)],
        vec![cv_text("C"), cv_num(f64::NEG_INFINITY)],
        vec![cv_text("D"), cv_num(50.0)],
        vec![cv_text("E"), cv_num(75.0)],
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
            id: FieldId::from("score"),
            name: "Score".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let axis = AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("score"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: Some(NumberGrouping::new(0.0, 100.0, 25.0)),
        show_subtotals: None,
    };

    let config = make_base_config(
        fields,
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement(
                "category",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::CountA),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    assert!(
        !result.rows.is_empty(),
        "Should produce at least some rows for valid numeric groups"
    );
}

// ---- Sensitivity tests ----

#[test]
fn sensitivity_date_grouping() {
    use chrono::NaiveDate;
    use value_types::date_serial::date_to_serial;

    let jan15 = date_to_serial(&NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
    let jun20 = date_to_serial(&NaiveDate::from_ymd_opt(2024, 6, 20).unwrap());
    let dec05 = date_to_serial(&NaiveDate::from_ymd_opt(2024, 12, 5).unwrap());

    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Date"), cv_text("Value")],
        vec![cv_num(jan15), cv_num(100.0)],
        vec![cv_num(jun20), cv_num(200.0)],
        vec![cv_num(dec05), cv_num(300.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("date"),
            name: "Date".to_string(),
            source_column: 0,
            data_type: DetectedDataType::Date,
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

    let config_none = make_base_config(
        fields.clone(),
        vec![
            make_placement("date", PivotFieldArea::Row, 0, None),
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_none = compute(&config_none, &data, Some(&expand_all()));

    let mut axis = make_row_axis("date", 0);
    axis.date_grouping = Some(DateGrouping::Year);
    let config_year = make_base_config(
        fields,
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_year = compute(&config_year, &data, Some(&expand_all()));

    let headers_none: Vec<_> = result_none
        .rows
        .iter()
        .map(|r| r.headers[0].value.clone())
        .collect();
    let headers_year: Vec<_> = result_year
        .rows
        .iter()
        .map(|r| r.headers[0].value.clone())
        .collect();
    assert_ne!(
        headers_none, headers_year,
        "date_grouping must affect row headers"
    );
    assert_eq!(result_none.rows.len(), 3, "ungrouped should have 3 rows");
    assert_eq!(result_year.rows.len(), 1, "year-grouped should have 1 row");
}

#[test]
fn sensitivity_number_grouping() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Score"), cv_text("Count")],
        vec![cv_num(15.0), cv_num(1.0)],
        vec![cv_num(25.0), cv_num(1.0)],
        vec![cv_num(35.0), cv_num(1.0)],
        vec![cv_num(75.0), cv_num(1.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("score"),
            name: "Score".to_string(),
            source_column: 0,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("count"),
            name: "Count".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let config_none = make_base_config(
        fields.clone(),
        vec![
            make_placement("score", PivotFieldArea::Row, 0, None),
            make_placement(
                "count",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_none = compute(&config_none, &data, Some(&expand_all()));

    let mut axis = make_row_axis("score", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, 100.0, 50.0));
    let config_grouped = make_base_config(
        fields,
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement(
                "count",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_grouped = compute(&config_grouped, &data, Some(&expand_all()));

    let headers_none: Vec<_> = result_none
        .rows
        .iter()
        .map(|r| r.headers[0].value.clone())
        .collect();
    let headers_grouped: Vec<_> = result_grouped
        .rows
        .iter()
        .map(|r| r.headers[0].value.clone())
        .collect();
    assert_ne!(
        headers_none, headers_grouped,
        "number_grouping must affect row headers"
    );
    assert_eq!(result_none.rows.len(), 4, "ungrouped should have 4 rows");
    assert!(
        result_grouped.rows.len() < result_none.rows.len(),
        "grouped should have fewer rows than ungrouped"
    );
}
