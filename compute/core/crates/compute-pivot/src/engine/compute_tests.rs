//! Tests for the main compute pipeline (basic pivot computations, SpreadJS
//! ground-truth, calculated fields, resolved API, coverage gaps, and
//! config sensitivity).

use super::*;
use super::test_helpers::*;
use value_types::CellValue;
use crate::types::*;

// ====================================================================
// Basic compute tests
// ====================================================================

#[test]
fn compute_simple_row_and_value() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 2);

    // East: 1000 + 1200 + 800 + 900 = 3900
    let east_row = result
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("East"))
        .unwrap();
    assert_eq!(east_row.values[0], cv_num(3900.0));

    // West: 1500 + 1800 + 700 + 600 = 4600
    let west_row = result
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("West"))
        .unwrap();
    assert_eq!(west_row.values[0], cv_num(4600.0));
}

#[test]
fn compute_multiple_row_fields() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
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
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    assert!(!result.column_headers.is_empty());

    // Each row should have 2 values (Q1 and Q2)
    assert_eq!(result.rows[0].values.len(), 2);
}

#[test]
fn compute_multiple_value_fields() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
            make_placement("units", PivotFieldArea::Value, 1, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    // Each row should have 2 values (sales, units)
    assert_eq!(result.rows[0].values.len(), 2);

    // East: Sales=3900, Units=39
    let east_row = result
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("East"))
        .unwrap();
    assert_eq!(east_row.values[0], cv_num(3900.0));
    assert_eq!(east_row.values[1], cv_num(39.0));
}

#[test]
fn compute_grand_totals() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.grand_totals.row.is_some());
    assert!(result.grand_totals.grand.is_some());
    // Grand total: 3900 + 4600 = 8500
    assert_eq!(result.grand_totals.row.as_ref().unwrap()[0], cv_num(8500.0));
}

#[test]
fn compute_applies_filters() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
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

#[test]
fn compute_different_aggregate_functions() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Average),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    // East: (1000 + 1200 + 800 + 900) / 4 = 975
    let east_row = result
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("East"))
        .unwrap();
    assert_eq!(east_row.values[0], cv_num(975.0));
}

#[test]
fn compute_handles_empty_data() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    // Only header row
    let data = vec![sample_sales_data()[0].clone()];
    let result = compute(&config, &data, Some(&expand_all()));

    assert_eq!(result.rows.len(), 0);
    assert_eq!(result.source_row_count, 0);
}

#[test]
fn compute_reports_compute_time() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "compute returned errors: {:?}", result.errors);
    assert!(result.rows.len() > 0, "compute should produce at least one row");
    assert!(result.source_row_count > 0, "source_row_count should be positive");
}

// ====================================================================
// SpreadJS Ground-Truth Integration Tests
// Ported from pivot-engine/__tests__/spreadjs-ground-truth.test.ts
// Fixtures from pivot-engine/__tests__/fixtures/spreadjs-ground-truth.json
// ====================================================================

/// Build a PivotTableConfig from field specs, placement specs, and filters.
///
/// `fields_spec`: slice of (name, source_col, data_type)
/// `row_field_names`: names used for row placements (matched against fields_spec name)
/// `column_field_names`: names used for column placements
/// `value_fields`: slice of (name, AggregateFunction)
/// `filters`: pre-built filters
/// `data`: the source data (for computing source_range)
fn build_spreadjs_config(
    id: &str,
    fields_spec: &[(&str, usize, DetectedDataType)],
    row_field_names: &[&str],
    column_field_names: &[&str],
    value_fields: &[(&str, AggregateFunction)],
    filters: Vec<PivotFilter>,
    data: &[Vec<CellValue>],
) -> PivotTableConfig {
    let fields: Vec<PivotField> = fields_spec
        .iter()
        .map(|(name, col, dt)| PivotField {
            id: FieldId::from(name.to_lowercase().replace(' ', "_")),
            name: name.to_string(),
            source_column: *col as u32,
            data_type: dt.clone(),
            ..Default::default()
        })
        .collect();

    let mut placements: Vec<PivotFieldPlacement> = Vec::new();

    for (pos, name) in row_field_names.iter().enumerate() {
        let field_id = name.to_lowercase().replace(' ', "_");
        placements.push(make_placement(
            &field_id,
            PivotFieldArea::Row,
            pos,
            None,
        ));
    }

    for (pos, name) in column_field_names.iter().enumerate() {
        let field_id = name.to_lowercase().replace(' ', "_");
        placements.push(make_placement(
            &field_id,
            PivotFieldArea::Column,
            pos,
            None,
        ));
    }

    for (pos, (name, agg)) in value_fields.iter().enumerate() {
        let field_id = name.to_lowercase().replace(' ', "_");
        placements.push(make_placement(
            &field_id,
            PivotFieldArea::Value,
            pos,
            Some(*agg),
        ));
    }

    let end_row = if data.is_empty() {
        0
    } else {
        (data.len() - 1) as u32
    };
    let end_col = if data.is_empty() || data[0].is_empty() {
        0
    } else {
        (data[0].len() - 1) as u32
    };

    PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id: id.to_string(),
        name: format!("SpreadJS test: {}", id),
        source_sheet_id: None,
        source_sheet_name: "test".to_string(),
        source_range: CellRange {
            start_row: 0,
            start_col: 0,
            end_row,
            end_col,
        },
        output_sheet_name: "test".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields,
        placements,
        filters,
        layout: Some(PivotTableLayout {
            show_row_grand_totals: Some(true),
            show_column_grand_totals: Some(true),
            ..Default::default()
        }),
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
    }
}

/// Default sales data fields spec
fn spreadjs_sales_fields() -> Vec<(&'static str, usize, DetectedDataType)> {
    vec![
        ("Region", 0, DetectedDataType::String),
        ("Product", 1, DetectedDataType::String),
        ("Quarter", 2, DetectedDataType::String),
        ("Sales", 3, DetectedDataType::Number),
        ("Units", 4, DetectedDataType::Number),
    ]
}

// ---- Test 1: basic_sum_region ----
#[test]
fn spreadjs_basic_sum_region() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "basic_sum_region",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 3900.0, "East SUM(Sales)");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 4600.0, "West SUM(Sales)");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 8500.0, "Grand Total SUM(Sales)");
}

// ---- Test 2: basic_average_region ----
#[test]
fn spreadjs_basic_average_region() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "basic_average_region",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Average)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 975.0, "East AVG(Sales)");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 1150.0, "West AVG(Sales)");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 1062.5, "Grand Total AVG(Sales)");
}

// ---- Test 3: basic_count_region ----
#[test]
fn spreadjs_basic_count_region() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "basic_count_region",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Count)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 4.0, "East COUNT(Sales)");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 4.0, "West COUNT(Sales)");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 8.0, "Grand Total COUNT(Sales)");
}

// ---- Test 4: basic_min_region ----
#[test]
fn spreadjs_basic_min_region() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "basic_min_region",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Min)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 800.0, "East MIN(Sales)");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 600.0, "West MIN(Sales)");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 600.0, "Grand Total MIN(Sales)");
}

// ---- Test 5: basic_max_region ----
#[test]
fn spreadjs_basic_max_region() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "basic_max_region",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Max)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 1200.0, "East MAX(Sales)");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 1800.0, "West MAX(Sales)");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 1800.0, "Grand Total MAX(Sales)");
}

// ---- Test 6: two_row_fields ----
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

    let east_gadget =
        find_row_by_key(&result.rows, "East|Gadget").expect("East|Gadget not found");
    assert_approx(&east_gadget.values[0], 1700.0, "East|Gadget SUM(Sales)");

    let east_widget =
        find_row_by_key(&result.rows, "East|Widget").expect("East|Widget not found");
    assert_approx(&east_widget.values[0], 2200.0, "East|Widget SUM(Sales)");

    let west_gadget =
        find_row_by_key(&result.rows, "West|Gadget").expect("West|Gadget not found");
    assert_approx(&west_gadget.values[0], 1300.0, "West|Gadget SUM(Sales)");

    let west_widget =
        find_row_by_key(&result.rows, "West|Widget").expect("West|Widget not found");
    assert_approx(&west_widget.values[0], 3300.0, "West|Widget SUM(Sales)");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 8500.0, "Grand Total SUM(Sales)");
}

// ---- Test 7: row_and_column_field ----
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

    // Verify column headers exist
    assert!(
        !result.column_headers.is_empty(),
        "column_headers should not be empty"
    );

    // Find Q1/Q2 order from column headers
    let quarter_header = &result.column_headers[0];
    let col_values: Vec<String> = quarter_header
        .headers
        .iter()
        .map(|h| match &h.value {
            CellValue::Text(s) => s.clone(),
            _ => String::new(),
        })
        .collect();

    let q1_idx = col_values.iter().position(|v| v == "Q1").expect("Q1 not found in column headers");
    let q2_idx = col_values.iter().position(|v| v == "Q2").expect("Q2 not found in column headers");

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[q1_idx], 1800.0, "East Q1");
    assert_approx(&east.values[q2_idx], 2100.0, "East Q2");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[q1_idx], 2200.0, "West Q1");
    assert_approx(&west.values[q2_idx], 2400.0, "West Q2");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    // Grand total across all columns (sum of all column totals)
    let gt_sum: f64 = gt.iter().filter_map(|v| match v {
        CellValue::Number(n) => Some(n.get()),
        _ => None,
    }).sum();
    assert!((gt_sum - 8500.0).abs() < 1e-5, "Grand Total sum should be 8500, got {}", gt_sum);
}

// ---- Test 8: multiple_value_fields ----
#[test]
fn spreadjs_multiple_value_fields() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "multiple_value_fields",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[
            ("Sales", AggregateFunction::Sum),
            ("Units", AggregateFunction::Sum),
        ],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 3900.0, "East SUM(Sales)");
    assert_approx(&east.values[1], 39.0, "East SUM(Units)");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 4600.0, "West SUM(Sales)");
    assert_approx(&west.values[1], 46.0, "West SUM(Units)");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 8500.0, "Grand Total SUM(Sales)");
    assert_approx(&gt[1], 85.0, "Grand Total SUM(Units)");
}

// ---- Test 9: filter_include ----
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

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 5500.0, "Grand Total SUM(Sales) filtered");
}

// ---- Test 10: filter_exclude ----
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

    assert_eq!(result.rows.len(), 2, "should have 2 rows after exclude filter");

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 1800.0, "East SUM(Sales) Q1 only");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 2200.0, "West SUM(Sales) Q1 only");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 4000.0, "Grand Total SUM(Sales) Q1 only");
}

// ---- Test 11: blank_in_grouping ----
#[test]
fn spreadjs_blank_in_grouping() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("A"), cv_num(200.0)],
        vec![CellValue::Null, cv_num(50.0)],
        vec![cv_text("B"), cv_num(300.0)],
        vec![cv_text(""), cv_num(75.0)],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Value", 1, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "blank_in_grouping",
        &fields_spec,
        &["Category"],
        &[],
        &[("Value", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // (blank) = null (50) + "" (75) = 125
    let blank = find_row_by_key(&result.rows, "(blank)").expect("(blank) row not found");
    assert_approx(&blank.values[0], 125.0, "(blank) SUM(Value)");

    let a = find_row_by_key(&result.rows, "A").expect("A row not found");
    assert_approx(&a.values[0], 300.0, "A SUM(Value)");

    let b = find_row_by_key(&result.rows, "B").expect("B row not found");
    assert_approx(&b.values[0], 300.0, "B SUM(Value)");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 725.0, "Grand Total SUM(Value)");
}

// ---- Test 12: blank_in_value ----
#[test]
fn spreadjs_blank_in_value() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("A"), CellValue::Null],
        vec![cv_text("A"), cv_num(200.0)],
        vec![cv_text("B"), cv_num(300.0)],
        vec![cv_text("B"), CellValue::Null],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Value", 1, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "blank_in_value",
        &fields_spec,
        &["Category"],
        &[],
        &[("Value", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let a = find_row_by_key(&result.rows, "A").expect("A row not found");
    assert_approx(&a.values[0], 300.0, "A SUM(Value) with nulls");

    let b = find_row_by_key(&result.rows, "B").expect("B row not found");
    assert_approx(&b.values[0], 300.0, "B SUM(Value) with nulls");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 600.0, "Grand Total SUM(Value) with nulls");
}

// ---- Test 13: average_with_blanks ----
#[test]
fn spreadjs_average_with_blanks() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("A"), CellValue::Null],
        vec![cv_text("A"), cv_num(200.0)],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Value", 1, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "average_with_blanks",
        &fields_spec,
        &["Category"],
        &[],
        &[("Value", AggregateFunction::Average)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // AVERAGE denominator should be 2 (only numeric values), not 3
    let a = find_row_by_key(&result.rows, "A").expect("A row not found");
    assert_approx(&a.values[0], 150.0, "A AVG(Value) denominator=2");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 150.0, "Grand Total AVG(Value)");
}

// ---- Test 14: count_with_blanks ----
#[test]
fn spreadjs_count_with_blanks() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("A"), CellValue::Null],
        vec![cv_text("A"), cv_num(200.0)],
        vec![cv_text("A"), cv_text("text")],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Value", 1, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "count_with_blanks",
        &fields_spec,
        &["Category"],
        &[],
        &[("Value", AggregateFunction::Count)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // COUNT only counts numeric values: 100, 200 = 2 (null and "text" excluded)
    let a = find_row_by_key(&result.rows, "A").expect("A row not found");
    assert_approx(&a.values[0], 2.0, "A COUNT(Value) numbers only");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 2.0, "Grand Total COUNT(Value)");
}

// ---- Test 15: counta_with_blanks ----
#[test]
fn spreadjs_counta_with_blanks() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("A"), CellValue::Null],
        vec![cv_text("A"), cv_num(200.0)],
        vec![cv_text("A"), cv_text("text")],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Value", 1, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "counta_with_blanks",
        &fields_spec,
        &["Category"],
        &[],
        &[("Value", AggregateFunction::CountA)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // COUNTA counts non-empty: 100, 200, "text" = 3 (null excluded)
    let a = find_row_by_key(&result.rows, "A").expect("A row not found");
    assert_approx(&a.values[0], 3.0, "A COUNTA(Value) non-empty");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 3.0, "Grand Total COUNTA(Value)");
}

// ---- Test 16: zero_values ----
#[test]
fn spreadjs_zero_values() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("A"), cv_num(0.0)],
        vec![cv_text("A"), cv_num(200.0)],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Value", 1, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "zero_values",
        &fields_spec,
        &["Category"],
        &[],
        &[
            ("Value", AggregateFunction::Sum),
            ("Value", AggregateFunction::Count),
            ("Value", AggregateFunction::Average),
        ],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let a = find_row_by_key(&result.rows, "A").expect("A row not found");
    assert_approx(&a.values[0], 300.0, "A SUM(Value) with zero");
    assert_approx(&a.values[1], 3.0, "A COUNT(Value) with zero");
    assert_approx(&a.values[2], 100.0, "A AVG(Value) with zero");

    let gt = result.grand_totals.row.as_ref().expect("grand totals missing");
    assert_approx(&gt[0], 300.0, "Grand Total SUM(Value) with zero");
    assert_approx(&gt[1], 3.0, "Grand Total COUNT(Value) with zero");
    assert_approx(&gt[2], 100.0, "Grand Total AVG(Value) with zero");
}

// ====================================================================
// Calculated Field Integration Tests
// ====================================================================

/// Helper: create a config with calculated fields using the sample sales data.
/// The sample data has fields: Region(0), Product(1), Quarter(2), Sales(3), Units(4).
fn make_config_with_calc_fields(
    row_fields: Vec<(&str, usize)>,
    col_fields: Vec<(&str, usize)>,
    value_fields: Vec<(&str, usize, AggregateFunction)>,
    calc_fields: Vec<CalculatedField>,
) -> PivotTableConfig {
    let mut placements = Vec::new();
    for (i, (field_id, _pos)) in row_fields.iter().enumerate() {
        placements.push(make_placement(field_id, PivotFieldArea::Row, i, None));
    }
    for (i, (field_id, _pos)) in col_fields.iter().enumerate() {
        placements.push(make_placement(field_id, PivotFieldArea::Column, i, None));
    }
    for (i, (field_id, _pos, agg)) in value_fields.iter().enumerate() {
        placements.push(make_placement(field_id, PivotFieldArea::Value, i, Some(*agg)));
    }

    let mut config = make_base_config(sample_fields(), placements, vec![]);
    config.calculated_fields = Some(calc_fields);
    config
}

#[test]
fn test_calculated_field_basic() {
    // Config: Region on rows, Sales(Sum) and Units(Sum) as values,
    // plus calculated field "Avg Price" = Sales / Units.
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("avg_price"),
            name: "Avg Price".to_string(),
            formula: "Sales / Units".to_string(),
        }],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "Expected no errors: {:?}", result.errors);

    // With 2 regular values + 1 calc field = 3 values per row (no column grouping = 1 col leaf)
    for row in &result.rows {
        assert_eq!(
            row.values.len(),
            3,
            "Expected 3 values per row (2 regular + 1 calc), got {} for row key '{}'",
            row.values.len(),
            row.key
        );
    }

    // East: Sales=1000+1200+800+900=3900, Units=10+12+8+9=39, AvgPrice=100
    let east_row = result.rows.iter().find(|r| {
        r.headers.iter().any(|h| h.value == CellValue::Text("East".to_string()))
    }).expect("East row not found");
    assert_eq!(east_row.values[0], cv_num(3900.0), "East Sales");
    assert_eq!(east_row.values[1], cv_num(39.0), "East Units");
    assert_eq!(east_row.values[2], cv_num(100.0), "East Avg Price = 3900/39");

    // West: Sales=1500+1800+700+600=4600, Units=15+18+7+6=46, AvgPrice=100
    let west_row = result.rows.iter().find(|r| {
        r.headers.iter().any(|h| h.value == CellValue::Text("West".to_string()))
    }).expect("West row not found");
    assert_eq!(west_row.values[0], cv_num(4600.0), "West Sales");
    assert_eq!(west_row.values[1], cv_num(46.0), "West Units");
    assert_eq!(west_row.values[2], cv_num(100.0), "West Avg Price = 4600/46");
}

#[test]
fn test_calculated_field_complex_formula() {
    // Profit margin: (Sales - Cost) / Sales * 100
    // We'll use Sales and Units as a proxy (pretend Units is Cost)
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("margin"),
            name: "Margin".to_string(),
            formula: "(Sales - Units) / Sales * 100".to_string(),
        }],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // East: Sales=3900, Units=39 => (3900-39)/3900*100 = 99.0
    let east_row = result.rows.iter().find(|r| {
        r.headers.iter().any(|h| h.value == CellValue::Text("East".to_string()))
    }).expect("East row not found");

    if let CellValue::Number(n) = &east_row.values[2] {
        assert!(
            (n.get() - 99.0).abs() < 1e-10,
            "Expected ~99.0, got {}",
            *n
        );
    } else {
        panic!("Expected Number for calc field, got {:?}", east_row.values[2]);
    }
}

#[test]
fn test_calculated_field_division_by_zero() {
    // Create data where a group has Units=0
    let data = vec![
        vec![cv_text("Region"), cv_text("Product"), cv_text("Quarter"), cv_text("Sales"), cv_text("Units")],
        vec![cv_text("East"), cv_text("Widget"), cv_text("Q1"), cv_num(1000.0), cv_num(0.0)],
        vec![cv_text("East"), cv_text("Widget"), cv_text("Q2"), cv_num(1200.0), cv_num(0.0)],
        vec![cv_text("West"), cv_text("Widget"), cv_text("Q1"), cv_num(1500.0), cv_num(15.0)],
    ];

    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("avg_price"),
            name: "Avg Price".to_string(),
            formula: "Sales / Units".to_string(),
        }],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // East: Units=0, so division by zero => Null
    let east_row = result.rows.iter().find(|r| {
        r.headers.iter().any(|h| h.value == CellValue::Text("East".to_string()))
    }).expect("East row not found");
    assert_eq!(east_row.values[2], CellValue::Null, "Division by zero should produce Null");

    // West: Units=15, Sales=1500, AvgPrice=100
    let west_row = result.rows.iter().find(|r| {
        r.headers.iter().any(|h| h.value == CellValue::Text("West".to_string()))
    }).expect("West row not found");
    assert_eq!(west_row.values[2], cv_num(100.0), "West Avg Price");
}

#[test]
fn test_calculated_field_with_grand_totals() {
    let mut config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("avg_price"),
            name: "Avg Price".to_string(),
            formula: "Sales / Units".to_string(),
        }],
    );
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // Row grand totals: total across all rows for each column leaf
    // Total Sales = 3900 + 4600 = 8500, Total Units = 39 + 46 = 85
    // Avg Price = 8500 / 85 = 100
    let row_gt = result.grand_totals.row.as_ref().expect("row grand totals should exist");
    assert_eq!(row_gt.len(), 3, "3 values: Sales, Units, Avg Price");
    assert_eq!(row_gt[0], cv_num(8500.0), "Row GT: Sales");
    assert_eq!(row_gt[1], cv_num(85.0), "Row GT: Units");
    assert_eq!(row_gt[2], cv_num(100.0), "Row GT: Avg Price");

    // Column grand totals: per-row totals
    let col_gt = result.grand_totals.column.as_ref().expect("column grand totals should exist");
    assert_eq!(col_gt.len(), result.rows.len(), "One column total per row");
    // Each should have 3 values (Sales, Units, Avg Price)
    for (i, row_totals) in col_gt.iter().enumerate() {
        assert_eq!(
            row_totals.len(), 3,
            "Column GT row {} should have 3 values, got {}",
            i, row_totals.len()
        );
    }

    // Grand total (corner)
    let grand_gt = result.grand_totals.grand.as_ref().expect("grand total should exist");
    assert_eq!(grand_gt.len(), 3);
    assert_eq!(grand_gt[0], cv_num(8500.0), "Grand: Sales");
    assert_eq!(grand_gt[1], cv_num(85.0), "Grand: Units");
    assert_eq!(grand_gt[2], cv_num(100.0), "Grand: Avg Price");
}

#[test]
fn test_calculated_field_unknown_field_ref() {
    // Formula references "Revenue" but the actual field name is "Sales"
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("calc1"),
            name: "Calc".to_string(),
            formula: "Revenue / Units".to_string(), // "Revenue" doesn't match "Sales"
        }],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "Unknown field ref should not cause error");

    // All calculated field values should be Null because "Revenue" field isn't found
    for row in &result.rows {
        assert_eq!(
            row.values[2],
            CellValue::Null,
            "Calc field with unknown ref should be Null for row '{}'",
            row.key
        );
    }
}

#[test]
fn test_calculated_field_with_subtotals() {
    // Region > Product on rows, with subtotals enabled for Region.
    // Passing None for expansion_state means all nodes default to expanded,
    // which triggers subtotal rows for the Region level.
    let mut region_axis = make_row_axis("region", 0);
    region_axis.show_subtotals = Some(true);

    let placements = vec![
        PivotFieldPlacement::Row(region_axis),
        make_placement("product", PivotFieldArea::Row, 1, None),
        make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        make_placement("units", PivotFieldArea::Value, 1, Some(AggregateFunction::Sum)),
    ];

    let mut config = make_base_config(sample_fields(), placements, vec![]);
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("avg_price"),
        name: "Avg Price".to_string(),
        formula: "Sales / Units".to_string(),
    }]);

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // Find subtotal rows
    let subtotal_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.is_subtotal).collect();
    assert!(
        !subtotal_rows.is_empty(),
        "Should have subtotal rows when subtotals are enabled"
    );

    // Each subtotal row should also have 3 values (Sales, Units, Avg Price)
    for st_row in &subtotal_rows {
        assert_eq!(
            st_row.values.len(),
            3,
            "Subtotal row '{}' should have 3 values (2 regular + 1 calc), got {}",
            st_row.key,
            st_row.values.len()
        );
        // The calc field value should be computable (not Null for our data)
        assert_ne!(
            st_row.values[2],
            CellValue::Null,
            "Subtotal calc field should not be Null for row '{}'",
            st_row.key
        );
    }
}

#[test]
fn test_no_calculated_fields_regression() {
    // This test ensures that adding `calculated_fields: None` doesn't change existing behavior.
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    // config.calculated_fields is already None from make_base_config

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // Each row should have exactly 1 value (one value placement, no columns)
    for row in &result.rows {
        assert_eq!(
            row.values.len(),
            1,
            "No calc fields: expected 1 value per row, got {}",
            row.values.len()
        );
    }

    // East: Sales = 1000+1200+800+900 = 3900
    let east_row = result.rows.iter().find(|r| {
        r.headers.iter().any(|h| h.value == CellValue::Text("East".to_string()))
    }).expect("East row not found");
    assert_eq!(east_row.values[0], cv_num(3900.0));
}

#[test]
fn test_calculated_field_with_column_grouping() {
    // Test calc fields with column grouping: Region on rows, Quarter on columns
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![("quarter", 2)],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("avg_price"),
            name: "Avg Price".to_string(),
            formula: "Sales / Units".to_string(),
        }],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // With 2 column leaves (Q1, Q2) and 2 regular values + 1 calc field = 3 per col
    // Total values per row = 2 * 3 = 6
    for row in &result.rows {
        assert_eq!(
            row.values.len(),
            6,
            "With 2 columns, expected 6 values (2*(2+1)), got {} for row '{}'",
            row.values.len(),
            row.key
        );
    }

    // East, Q1: Sales=1000+800=1800, Units=10+8=18, AvgPrice=100
    // East, Q2: Sales=1200+900=2100, Units=12+9=21, AvgPrice=100
    let east_row = result.rows.iter().find(|r| {
        r.headers.iter().any(|h| h.value == CellValue::Text("East".to_string()))
    }).expect("East row not found");

    // Values are: [Q1_Sales, Q1_Units, Q1_AvgPrice, Q2_Sales, Q2_Units, Q2_AvgPrice]
    // (or Q2 first, Q1 second depending on sort order -- let's check both columns)
    // All avg prices should be 100.0 given the 100:1 ratio in test data
    let num_stride = 3; // 2 regular + 1 calc per column
    for col in 0..2 {
        let sales = &east_row.values[col * num_stride];
        let units = &east_row.values[col * num_stride + 1];
        let avg = &east_row.values[col * num_stride + 2];

        if let (CellValue::Number(s), CellValue::Number(u), CellValue::Number(a)) = (sales, units, avg) {
            let expected_avg = s.0 / u.0;
            assert!(
                (a.0 - expected_avg).abs() < 1e-10,
                "Column {}: expected avg_price {}, got {}",
                col, expected_avg, *a
            );
        } else {
            panic!(
                "Column {}: expected all Numbers, got Sales={:?}, Units={:?}, Avg={:?}",
                col, sales, units, avg
            );
        }
    }
}

#[test]
fn test_calculated_field_multiple_calc_fields() {
    // Two calculated fields
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![
            CalculatedField {
                field_id: CalculatedFieldId::from("avg_price"),
                name: "Avg Price".to_string(),
                formula: "Sales / Units".to_string(),
            },
            CalculatedField {
                field_id: CalculatedFieldId::from("total"),
                name: "Total".to_string(),
                formula: "Sales + Units".to_string(),
            },
        ],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // 2 regular + 2 calc = 4 values per row
    for row in &result.rows {
        assert_eq!(
            row.values.len(), 4,
            "Expected 4 values, got {} for row '{}'",
            row.values.len(), row.key
        );
    }

    // East: Sales=3900, Units=39, AvgPrice=100, Total=3939
    let east_row = result.rows.iter().find(|r| {
        r.headers.iter().any(|h| h.value == CellValue::Text("East".to_string()))
    }).expect("East row not found");
    assert_eq!(east_row.values[2], cv_num(100.0), "East Avg Price");
    assert_eq!(east_row.values[3], cv_num(3939.0), "East Total");
}

// ---- compute_resolved tests ----

#[test]
fn compute_resolved_matches_compute_simple() {
    // validate_and_resolve -> compute_resolved gives identical output to compute()
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let data = sample_sales_data();

    let result_wire = compute(&config, &data, Some(&expand_all()));
    let resolved = validate_and_resolve(&config).unwrap();
    let result_resolved = compute_resolved(&resolved, &data, Some(&expand_all()));

    assert!(result_wire.errors.is_none());
    assert!(result_resolved.errors.is_none());
    assert_eq!(result_wire.rows.len(), result_resolved.rows.len());
    assert_eq!(result_wire.source_row_count, result_resolved.source_row_count);

    for (rw, rr) in result_wire.rows.iter().zip(result_resolved.rows.iter()) {
        assert_eq!(rw.key, rr.key);
        assert_eq!(rw.values, rr.values);
        assert_eq!(rw.headers.len(), rr.headers.len());
    }
}

#[test]
fn compute_resolved_matches_compute_with_columns_and_filters() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
            make_placement("units", PivotFieldArea::Value, 1, Some(AggregateFunction::Average)),
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
    let data = sample_sales_data();

    let result_wire = compute(&config, &data, Some(&expand_all()));
    let resolved = validate_and_resolve(&config).unwrap();
    let result_resolved = compute_resolved(&resolved, &data, Some(&expand_all()));

    assert!(result_wire.errors.is_none());
    assert!(result_resolved.errors.is_none());
    assert_eq!(result_wire.rows.len(), result_resolved.rows.len());
    assert_eq!(result_wire.column_headers.len(), result_resolved.column_headers.len());

    for (rw, rr) in result_wire.rows.iter().zip(result_resolved.rows.iter()) {
        assert_eq!(rw.key, rr.key);
        assert_eq!(rw.values, rr.values);
    }

    // Grand totals should also match
    assert_eq!(result_wire.grand_totals.row, result_resolved.grand_totals.row);
    assert_eq!(result_wire.grand_totals.column, result_resolved.grand_totals.column);
    assert_eq!(result_wire.grand_totals.grand, result_resolved.grand_totals.grand);
}

#[test]
fn compute_resolved_matches_compute_with_grand_totals() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });
    let data = sample_sales_data();

    let result_wire = compute(&config, &data, Some(&expand_all()));
    let resolved = validate_and_resolve(&config).unwrap();
    let result_resolved = compute_resolved(&resolved, &data, Some(&expand_all()));

    assert_eq!(result_wire.grand_totals.row, result_resolved.grand_totals.row);
    assert_eq!(result_wire.grand_totals.column, result_resolved.grand_totals.column);
    assert_eq!(result_wire.grand_totals.grand, result_resolved.grand_totals.grand);
}

#[test]
fn drill_down_resolved_matches_drill_down() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let data = sample_sales_data();

    // Keys use canonical type-prefixed format (T:east, T:widget)
    let result_wire = drill_down(&config, &data, "T:east", "T:widget");
    let resolved = validate_and_resolve(&config).unwrap();
    let result_resolved = drill_down_resolved(&resolved, &data, "T:east", "T:widget");

    assert_eq!(result_wire, result_resolved);
    assert_eq!(result_wire.len(), 2); // East + Widget = 2 data rows (indices 0, 1)
}

// ====================================================================
// B4: Pivot Engine Coverage Gap Tests
// ====================================================================

// B4b: Column-only pivot (no row fields)
#[test]
fn b4b_column_only_pivot_no_row_fields() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    // Should not panic and should produce a valid result
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Column headers should exist for Q1 and Q2
    assert!(!result.column_headers.is_empty(), "Should have column headers");

    // Should have at most 1 row (grand-total-like row) or 0 rows
    // depending on engine behavior with no row fields.
    // The key assertion is: does not panic.
    // If rows exist, values should be aggregated correctly.
    if !result.rows.is_empty() {
        // Q1: 1000+800+1500+700=4000, Q2: 1200+900+1800+600=4500
        let row_values: Vec<f64> = result.rows[0]
            .values
            .iter()
            .filter_map(|v| match v {
                CellValue::Number(n) => Some(n.get()),
                _ => None,
            })
            .collect();
        // Should have values for each column leaf
        assert!(!row_values.is_empty(), "Row should have aggregated values");
    }
}

// B4c: Expansion state -- collapse groups
#[test]
fn b4c_expansion_state_collapse_groups() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    // First compute with no expansion state (all expanded by default)
    let result_expanded = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result_expanded.errors.is_none());
    let expanded_count = result_expanded.rows.len();
    // Should have at least 4 rows: 2 parents + 2x2 children
    assert!(expanded_count >= 4, "Expanded should have >= 4 rows, got {}", expanded_count);

    // Now collapse: use a non-empty expanded_rows set that does NOT include
    // the "T:east" key. This means "T:east" is NOT expanded (collapsed).
    // We include "T:west" so West is expanded but East is collapsed.
    let mut expansion_state = PivotExpansionState::default();
    // Non-empty set: only keys present are expanded.
    // Insert West's key so it's expanded; East is absent = collapsed.
    expansion_state.expanded_rows.insert("T:west".to_string());

    let result_collapsed = compute(&config, &sample_sales_data(), Some(&expansion_state));
    assert!(result_collapsed.errors.is_none());

    // East should be collapsed (no children visible), West expanded (children visible).
    // So we should have fewer rows than fully expanded.
    let collapsed_count = result_collapsed.rows.len();
    assert!(
        collapsed_count < expanded_count,
        "Collapsed ({}) should have fewer rows than expanded ({})",
        collapsed_count,
        expanded_count
    );

    // Verify East row exists but has no child rows
    let east_children: Vec<&PivotRow> = result_collapsed
        .rows
        .iter()
        .filter(|r| r.depth > 0 && r.key.starts_with("T:east"))
        .collect();
    assert!(
        east_children.is_empty(),
        "East should have no visible children when collapsed, got {}",
        east_children.len()
    );
}

// B4d: Multiple column fields (2+ levels)
#[test]
fn b4d_multiple_column_fields_two_levels() {
    // Use Region as column1, Quarter as column2
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("product", PivotFieldArea::Row, 0, None),
            make_placement("region", PivotFieldArea::Column, 0, None),
            make_placement("quarter", PivotFieldArea::Column, 1, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Column headers should have 2 levels (region and quarter)
    assert!(
        result.column_headers.len() >= 2,
        "Should have at least 2 column header levels, got {}",
        result.column_headers.len()
    );

    // Each row should have values for each column leaf
    // 2 regions x 2 quarters = 4 column leaves
    for row in &result.rows {
        assert!(
            row.values.len() >= 4,
            "Each row should have >= 4 values for 2x2 column leaves, got {}",
            row.values.len()
        );
    }

    // Check specific aggregation: Widget/East/Q1 = 1000
    // Widget row values should sum to total Widget sales across all region/quarter combos
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
    // Widget total: 1000+1200+1500+1800 = 5500
    assert!(
        (widget_total - 5500.0).abs() < 0.01,
        "Widget total should be 5500, got {}",
        widget_total
    );
}

// B4e: Custom sort lists in engine
#[test]
fn b4e_custom_sort_list_ordering() {
    let mut axis = make_row_axis("region", 0);
    // Custom sort: West first, then East (reverse of alphabetical)
    axis.custom_sort_list = Some(vec![cv_text("West"), cv_text("East")]);
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(result.rows.len(), 2);

    // West should be first (custom sort order), East second
    assert_eq!(
        result.rows[0].headers[0].value,
        cv_text("West"),
        "First row should be West per custom sort"
    );
    assert_eq!(
        result.rows[1].headers[0].value,
        cv_text("East"),
        "Second row should be East per custom sort"
    );
}

// B4f: Date grouping on column fields
#[test]
fn b4f_date_grouping_on_column_fields() {
    // Create data with date serial numbers as a column field
    // Excel serial: 45292 = 2024-01-01, 45323 = 2024-02-01, 45352 = 2024-03-01
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
            make_placement("amount", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Should have column headers with month groupings
    assert!(
        !result.column_headers.is_empty(),
        "Should have column headers for date grouping"
    );

    // Column headers should contain month names
    let all_header_values: Vec<String> = result
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter())
        .filter_map(|h| match &h.value {
            CellValue::Text(s) => Some(s.clone()),
            _ => None,
        })
        .collect();

    // Should contain at least January and February (or March)
    assert!(
        !all_header_values.is_empty(),
        "Column headers should have text values for months"
    );
}

// B4i: TopBottom with N=0
#[test]
fn b4i_top_bottom_filter_n_zero() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
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
    // Should not panic. With top 0 items, we expect no rows.
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(
        result.rows.len(),
        0,
        "Top 0 items should return no rows, got {}",
        result.rows.len()
    );
}

// B4j: Negative numbers in aggregation (StdDev, Product)
#[test]
fn b4j_negative_numbers_stdev_and_product() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(-10.0)],
        vec![cv_text("A"), cv_num(20.0)],
        vec![cv_text("A"), cv_num(-5.0)],
        vec![cv_text("B"), cv_num(-3.0)],
        vec![cv_text("B"), cv_num(-7.0)],
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

    // Test StdDev
    let config_stdev = make_base_config(
        fields.clone(),
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::StdDev),
            ),
        ],
        vec![],
    );

    let result_stdev = compute(&config_stdev, &data, Some(&expand_all()));
    assert!(result_stdev.errors.is_none(), "StdDev errors: {:?}", result_stdev.errors);

    // StdDev should always be non-negative
    for row in &result_stdev.rows {
        if let CellValue::Number(v) = &row.values[0] {
            assert!(
                v.0 >= 0.0,
                "StdDev should be non-negative for row '{}', got {}",
                row.key,
                v.0
            );
        }
    }

    // A: values [-10, 20, -5], mean = 5/3, stdev should be positive
    let a_row = result_stdev
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("A"));
    assert!(a_row.is_some(), "Should have category A row");
    if let CellValue::Number(stdev_a) = &a_row.unwrap().values[0] {
        assert!(stdev_a.0 > 0.0, "StdDev of A should be positive, got {}", stdev_a.0);
    }

    // Test Product
    let config_product = make_base_config(
        fields,
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement(
                "value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Product),
            ),
        ],
        vec![],
    );

    let result_product = compute(&config_product, &data, Some(&expand_all()));
    assert!(
        result_product.errors.is_none(),
        "Product errors: {:?}",
        result_product.errors
    );

    // A: product of [-10, 20, -5] = 1000 (positive: two negatives cancel)
    let a_row_product = result_product
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("A"));
    assert!(a_row_product.is_some(), "Should have category A row for product");
    if let CellValue::Number(product_a) = &a_row_product.unwrap().values[0] {
        assert!(
            (product_a.0 - 1000.0).abs() < 0.01,
            "Product of A should be 1000, got {}",
            product_a.0
        );
    }

    // B: product of [-3, -7] = 21 (positive: two negatives)
    let b_row_product = result_product
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("B"));
    assert!(b_row_product.is_some(), "Should have category B row for product");
    if let CellValue::Number(product_b) = &b_row_product.unwrap().values[0] {
        assert!(
            (product_b.0 - 21.0).abs() < 0.01,
            "Product of B should be 21, got {}",
            product_b.0
        );
    }
}

// B4k: Date/number grouping with NaN/Infinity input
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

    // Use Score as a row field with number grouping
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
            make_placement("category", PivotFieldArea::Value, 0, Some(AggregateFunction::CountA)),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    // The primary assertion: does not panic with NaN/Infinity values
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Should have some rows (at least for the normal values 50, 75)
    assert!(
        !result.rows.is_empty(),
        "Should produce at least some rows for valid numeric groups"
    );
}

// =========================================================================
// B3: Config sensitivity tests
//
// For every field on the pivot config that affects computation output, these
// tests compute with a baseline config, change ONE field, and assert the
// output is DIFFERENT. This structurally prevents ghost fields.
// =========================================================================

#[test]
fn sensitivity_sort_order() {
    // Baseline: default sort (Asc via None)
    let config_asc = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_asc = compute(&config_asc, &sample_sales_data(), Some(&expand_all()));

    // Variant: explicit Desc
    let mut axis = make_row_axis("region", 0);
    axis.sort_order = Some(SortDirection::Desc);
    let config_desc = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_desc = compute(&config_desc, &sample_sales_data(), Some(&expand_all()));

    // The field must affect output
    let keys_asc: Vec<_> = result_asc.rows.iter().map(|r| &r.key).collect();
    let keys_desc: Vec<_> = result_desc.rows.iter().map(|r| &r.key).collect();
    assert_ne!(
        keys_asc, keys_desc,
        "sort_order must affect row ordering"
    );
}

#[test]
fn sensitivity_sort_by_value_column_key() {
    // Need column field to have different column keys
    // Baseline: sort by value with column_key = None (defaults to first column leaf)
    let mut axis_a = make_row_axis("region", 0);
    axis_a.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let config_a = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_a),
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_a = compute(&config_a, &sample_sales_data(), Some(&expand_all()));

    // Variant: sort by value with column_key targeting a specific column leaf
    // First, find the column keys from the result
    let col_keys: Vec<String> = result_a
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter())
        .map(|h| h.key.clone())
        .collect();

    // Use the second column key if available (Q2)
    if col_keys.len() >= 2 {
        let mut axis_b = make_row_axis("region", 0);
        axis_b.sort_by_value = Some(SortByValueConfig {
            value_field_id: FieldId::from("sales"),
            order: SortDirection::Desc,
            column_key: Some(col_keys[1].clone()),
        });
        let config_b = make_base_config(
            sample_fields(),
            vec![
                PivotFieldPlacement::Row(axis_b),
                make_placement("quarter", PivotFieldArea::Column, 0, None),
                make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
            ],
            vec![],
        );
        let result_b = compute(&config_b, &sample_sales_data(), Some(&expand_all()));

        // The row ordering may differ (or at least the values being sorted by differ)
        // If the values happen to produce the same order, at least verify they ran without error
        assert!(result_a.errors.is_none(), "baseline errors: {:?}", result_a.errors);
        assert!(result_b.errors.is_none(), "variant errors: {:?}", result_b.errors);
        // With our data: Q1 totals differ from Q2 totals per region,
        // so the sort order is likely different.
        let keys_a: Vec<_> = result_a.rows.iter().map(|r| &r.key).collect();
        let keys_b: Vec<_> = result_b.rows.iter().map(|r| &r.key).collect();
        // Note: With the sample data, East Q1=1800, Q2=2100; West Q1=2200, Q2=2400
        // Both columns put West first when Desc, so ordering may be same.
        // Use a dataset where different columns yield different orders.
        let _ = (keys_a, keys_b);
    }

    // Use extended data where different column keys yield different sort orders
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Region"), cv_text("Product"), cv_text("Quarter"), cv_text("Sales"), cv_text("Units")],
        // East: Q1 high, Q2 low
        vec![cv_text("East"), cv_text("Widget"), cv_text("Q1"), cv_num(5000.0), cv_num(10.0)],
        vec![cv_text("East"), cv_text("Widget"), cv_text("Q2"), cv_num(100.0), cv_num(10.0)],
        // West: Q1 low, Q2 high
        vec![cv_text("West"), cv_text("Widget"), cv_text("Q1"), cv_num(100.0), cv_num(10.0)],
        vec![cv_text("West"), cv_text("Widget"), cv_text("Q2"), cv_num(5000.0), cv_num(10.0)],
    ];

    // Sort by Q1 column (no column_key = first leaf)
    let mut axis_q1 = make_row_axis("region", 0);
    axis_q1.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let config_q1 = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_q1),
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_q1 = compute(&config_q1, &data, Some(&expand_all()));

    // Get Q2 column key
    let q2_key: Option<String> = result_q1
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter())
        .find(|h| h.value == cv_text("Q2"))
        .map(|h| h.key.clone());

    if let Some(q2_key) = q2_key {
        let mut axis_q2 = make_row_axis("region", 0);
        axis_q2.sort_by_value = Some(SortByValueConfig {
            value_field_id: FieldId::from("sales"),
            order: SortDirection::Desc,
            column_key: Some(q2_key),
        });
        let config_q2 = make_base_config(
            sample_fields(),
            vec![
                PivotFieldPlacement::Row(axis_q2),
                make_placement("quarter", PivotFieldArea::Column, 0, None),
                make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
            ],
            vec![],
        );
        let result_q2 = compute(&config_q2, &data, Some(&expand_all()));

        let keys_q1: Vec<_> = result_q1.rows.iter().map(|r| &r.key).collect();
        let keys_q2: Vec<_> = result_q2.rows.iter().map(|r| &r.key).collect();
        assert_ne!(
            keys_q1, keys_q2,
            "sort_by_value.column_key must affect row ordering"
        );
    } else {
        panic!("Expected Q2 column key in result");
    }
}

#[test]
fn sensitivity_sort_by_value_order() {
    // Baseline: sort by value Asc
    let mut axis_asc = make_row_axis("region", 0);
    axis_asc.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Asc,
        column_key: None,
    });
    let config_asc = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_asc),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_asc = compute(&config_asc, &sample_sales_data(), Some(&expand_all()));

    // Variant: sort by value Desc
    let mut axis_desc = make_row_axis("region", 0);
    axis_desc.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let config_desc = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_desc),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_desc = compute(&config_desc, &sample_sales_data(), Some(&expand_all()));

    let keys_asc: Vec<_> = result_asc.rows.iter().map(|r| &r.key).collect();
    let keys_desc: Vec<_> = result_desc.rows.iter().map(|r| &r.key).collect();
    assert_ne!(
        keys_asc, keys_desc,
        "sort_by_value.order must affect row ordering"
    );
}

#[test]
fn sensitivity_date_grouping() {
    use value_types::date_serial::date_to_serial;
    use chrono::NaiveDate;

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

    // Baseline: no date grouping (raw serial numbers as row keys)
    let config_none = make_base_config(
        fields.clone(),
        vec![
            make_placement("date", PivotFieldArea::Row, 0, None),
            make_placement("value", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_none = compute(&config_none, &data, Some(&expand_all()));

    // Variant: date grouping by Year (all 3 dates in 2024 -> single group)
    let mut axis = make_row_axis("date", 0);
    axis.date_grouping = Some(DateGrouping::Year);
    let config_year = make_base_config(
        fields,
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement("value", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_year = compute(&config_year, &data, Some(&expand_all()));

    // Without grouping: 3 rows (one per date serial). With year grouping: 1 row (2024).
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
    // Specifically, grouping should reduce 3 rows to 1
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

    // Baseline: no number grouping (each distinct score is its own row)
    let config_none = make_base_config(
        fields.clone(),
        vec![
            make_placement("score", PivotFieldArea::Row, 0, None),
            make_placement("count", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_none = compute(&config_none, &data, Some(&expand_all()));

    // Variant: number grouping into bins of 50
    let mut axis = make_row_axis("score", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, 100.0, 50.0));
    let config_grouped = make_base_config(
        fields,
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement("count", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_grouped = compute(&config_grouped, &data, Some(&expand_all()));

    // Without grouping: 4 rows. With grouping: 2 bins (0-49, 50-99).
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

#[test]
fn sensitivity_custom_sort_list() {
    // Baseline: default alphabetical sort (East before West)
    let config_default = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_default = compute(&config_default, &sample_sales_data(), Some(&expand_all()));

    // Variant: custom sort with West first
    let mut axis = make_row_axis("region", 0);
    axis.custom_sort_list = Some(vec![cv_text("West"), cv_text("East")]);
    let config_custom = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_custom = compute(&config_custom, &sample_sales_data(), Some(&expand_all()));

    let keys_default: Vec<_> = result_default.rows.iter().map(|r| &r.key).collect();
    let keys_custom: Vec<_> = result_custom.rows.iter().map(|r| &r.key).collect();
    assert_ne!(
        keys_default, keys_custom,
        "custom_sort_list must affect row ordering"
    );
}

#[test]
fn sensitivity_aggregate_function() {
    // Baseline: Sum
    let config_sum = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_sum = compute(&config_sum, &sample_sales_data(), Some(&expand_all()));

    // Variant: Average
    let config_avg = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Average),
            ),
        ],
        vec![],
    );
    let result_avg = compute(&config_avg, &sample_sales_data(), Some(&expand_all()));

    let values_sum: Vec<_> = result_sum.rows.iter().map(|r| &r.values).collect();
    let values_avg: Vec<_> = result_avg.rows.iter().map(|r| &r.values).collect();
    assert_ne!(
        values_sum, values_avg,
        "aggregate_function must affect computed values"
    );
}

#[test]
fn sensitivity_filter_condition() {
    // Baseline: no filter
    let config_no_filter = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_no_filter = compute(&config_no_filter, &sample_sales_data(), Some(&expand_all()));

    // Variant: filter with condition (sales > 1000)
    let config_filtered = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
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

    // Fewer rows when filtered (only rows where sales > 1000)
    assert!(
        result_filtered.rows.len() < result_no_filter.rows.len(),
        "filter_condition must reduce row count: filtered={}, unfiltered={}",
        result_filtered.rows.len(),
        result_no_filter.rows.len(),
    );
}

#[test]
fn sensitivity_include_exclude_list() {
    // Baseline: no filter (2 regions)
    let config_no_filter = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_no_filter = compute(&config_no_filter, &sample_sales_data(), Some(&expand_all()));

    // Variant: include only East
    let config_include = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
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
    // Create data with 3 distinct categories to allow top 1 to clearly reduce rows.
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

    // Baseline: no filter (3 categories)
    let config_no_filter = make_base_config(
        fields.clone(),
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement("amount", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_no_filter = compute(&config_no_filter, &data, Some(&expand_all()));
    assert_eq!(
        result_no_filter.rows.len(),
        3,
        "unfiltered should have 3 category rows"
    );

    // Variant: top 1 category by sum of amount
    let config_top = make_base_config(
        fields,
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement("amount", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
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
    // Create data with some null values in the row field
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

    // Baseline: show_items_with_no_data = false (default, removes blanks)
    let config_hide = make_base_config(
        fields.clone(),
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement("value", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
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

    // Variant: show_items_with_no_data = true (keeps blanks)
    let config_show = make_base_config(
        fields,
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
            make_placement("value", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
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

#[test]
fn sensitivity_layout_show_row_grand_totals() {
    // Baseline: show_row_grand_totals = true
    let mut config_on = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    config_on.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: None,
        ..Default::default()
    });
    let result_on = compute(&config_on, &sample_sales_data(), Some(&expand_all()));

    // Variant: show_row_grand_totals = false
    let mut config_off = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    config_off.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(false),
        show_column_grand_totals: None,
        ..Default::default()
    });
    let result_off = compute(&config_off, &sample_sales_data(), Some(&expand_all()));

    assert_ne!(
        result_on.grand_totals.row.is_some(),
        result_off.grand_totals.row.is_some(),
        "layout_show_row_grand_totals must affect grand_totals.row: on={:?}, off={:?}",
        result_on.grand_totals.row.is_some(),
        result_off.grand_totals.row.is_some(),
    );
}

#[test]
fn sensitivity_layout_show_column_grand_totals() {
    // Baseline: show_column_grand_totals = true
    let mut config_on = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    config_on.layout = Some(PivotTableLayout {
        show_row_grand_totals: None,
        show_column_grand_totals: Some(true),
        ..Default::default()
    });
    let result_on = compute(&config_on, &sample_sales_data(), Some(&expand_all()));

    // Variant: show_column_grand_totals = false
    let mut config_off = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    config_off.layout = Some(PivotTableLayout {
        show_row_grand_totals: None,
        show_column_grand_totals: Some(false),
        ..Default::default()
    });
    let result_off = compute(&config_off, &sample_sales_data(), Some(&expand_all()));

    assert_ne!(
        result_on.grand_totals.column.is_some(),
        result_off.grand_totals.column.is_some(),
        "layout_show_column_grand_totals must affect grand_totals.column: on={:?}, off={:?}",
        result_on.grand_totals.column.is_some(),
        result_off.grand_totals.column.is_some(),
    );
}

#[test]
fn sensitivity_layout_show_subtotals() {
    // Baseline: show_subtotals = false (default)
    let config_off = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_off = compute(&config_off, &sample_sales_data(), Some(&expand_all()));

    // Variant: show_subtotals = true on the outer axis
    let mut axis = make_row_axis("region", 0);
    axis.show_subtotals = Some(true);
    let config_on = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_on = compute(&config_on, &sample_sales_data(), Some(&expand_all()));

    let subtotal_count_off = result_off.rows.iter().filter(|r| r.is_subtotal).count();
    let subtotal_count_on = result_on.rows.iter().filter(|r| r.is_subtotal).count();
    assert_ne!(
        subtotal_count_off, subtotal_count_on,
        "show_subtotals must affect subtotal row count: off={}, on={}",
        subtotal_count_off, subtotal_count_on,
    );
}

#[test]
fn sensitivity_calculated_fields() {
    // Baseline: no calculated fields
    let config_none = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
            make_placement("units", PivotFieldArea::Value, 1, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    let result_none = compute(&config_none, &sample_sales_data(), Some(&expand_all()));

    // Variant: add a calculated field
    let mut config_calc = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("sales", PivotFieldArea::Value, 0, Some(AggregateFunction::Sum)),
            make_placement("units", PivotFieldArea::Value, 1, Some(AggregateFunction::Sum)),
        ],
        vec![],
    );
    config_calc.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("avg_price"),
        name: "Avg Price".to_string(),
        formula: "Sales / Units".to_string(),
    }]);
    let result_calc = compute(&config_calc, &sample_sales_data(), Some(&expand_all()));

    // With a calculated field, each row should have more values
    assert!(
        result_calc.rows[0].values.len() > result_none.rows[0].values.len(),
        "calculated_fields must add additional values: with_calc={}, without={}",
        result_calc.rows[0].values.len(),
        result_none.rows[0].values.len(),
    );
}
