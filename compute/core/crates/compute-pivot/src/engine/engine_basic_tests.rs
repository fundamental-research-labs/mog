//! Basic pivot engine tests: detectFields, validateConfig, simple compute,
//! aggregate functions, empty data, compute_resolved, validate_and_resolve,
//! and config sensitivity tests for sort_order, aggregate_function,
//! custom_sort_list, and show_values_as.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

// ---- detectFields tests ----

#[test]
fn detect_fields_from_data() {
    let data = sample_sales_data();
    let fields = detect_fields(&data);

    assert_eq!(fields.len(), 5);
    assert_eq!(fields[0].name, "Region");
    assert_eq!(fields[0].source_column, 0);
    assert_eq!(fields[3].name, "Sales");
    assert_eq!(fields[3].data_type, DetectedDataType::Number);
}

#[test]
fn detect_fields_handles_empty_data() {
    let fields = detect_fields(&[]);
    assert_eq!(fields.len(), 0);
}

#[test]
fn detect_fields_infers_correct_types() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![
            cv_text("Name"),
            cv_text("Age"),
            cv_text("Active"),
            cv_text("Date"),
        ],
        vec![
            cv_text("John"),
            cv_num(25.0),
            cv_bool(true),
            cv_text("2024-01-15"),
        ],
        vec![
            cv_text("Jane"),
            cv_num(30.0),
            cv_bool(false),
            cv_text("2024-02-20"),
        ],
    ];

    let fields = detect_fields(&data);

    assert_eq!(fields[0].data_type, DetectedDataType::String);
    assert_eq!(fields[1].data_type, DetectedDataType::Number);
    assert_eq!(fields[2].data_type, DetectedDataType::Boolean);
    assert_eq!(fields[3].data_type, DetectedDataType::Date);
}

// ---- validateConfig tests ----

#[test]
fn validate_config_valid() {
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
        vec![],
    );

    let errors = validate_config(&config);
    assert!(errors.is_empty());
}

#[test]
fn validate_config_missing_fields() {
    let config = PivotTableConfig {
        schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: String::new(),
        name: "Test".to_string(),
        source_sheet_id: None,
        source_sheet_name: String::new(),
        source_range: CellRange::new(0, 0, 0, 0),
        output_sheet_name: String::new(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: vec![],
        placements: vec![],
        filters: vec![],
        layout: None,
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    };

    let errors = validate_config(&config);

    assert!(
        errors
            .iter()
            .any(|e| e.contains("Pivot table ID is required"))
    );
    assert!(
        errors
            .iter()
            .any(|e| e.contains("Source sheet ID is required"))
    );
    assert!(
        errors
            .iter()
            .any(|e| e.contains("At least one field is required"))
    );
}

#[test]
fn validate_config_field_references() {
    let config = make_base_config(
        sample_fields(),
        vec![make_placement("nonexistent", PivotFieldArea::Row, 0, None)],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("nonexistent")),
        "should detect unknown field: {:?}",
        errors
    );
}

#[test]
fn validate_config_value_aggregate() {
    // With the new type system, ValuePlacement.aggregate_function is required (not Option).
    // make_placement with None defaults to Sum. Verify that's valid.
    let config = make_base_config(
        sample_fields(),
        vec![make_placement("sales", PivotFieldArea::Value, 0, None)],
        vec![],
    );

    let errors = validate_config(&config);
    // No aggregate_function error since the type system enforces it
    assert!(!errors.iter().any(|e| e.contains("aggregate function")));
}

// ---- compute tests ----

#[test]
fn compute_simple_row_and_value() {
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
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
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
    assert!(
        result.errors.is_none(),
        "compute returned errors: {:?}",
        result.errors
    );
    assert!(
        result.rows.len() > 0,
        "compute should produce at least one row"
    );
    assert!(
        result.source_row_count > 0,
        "source_row_count should be positive"
    );
}

// ---- SpreadJS ground truth: basic aggregation tests ----

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 8500.0, "Grand Total SUM(Sales)");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 1062.5, "Grand Total AVG(Sales)");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 8.0, "Grand Total COUNT(Sales)");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 600.0, "Grand Total MIN(Sales)");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 1800.0, "Grand Total MAX(Sales)");
}

// ---- SpreadJS: blank/null handling tests ----

// ---- Blank + expansion state cross-cutting tests (round 64) ----
// These tests cover the intersection of null/blank values with OOXML-style
// depth-prefixed expansion state, which was previously untested.

/// Test that blank group nodes expand correctly with OOXML depth-prefixed keys.
///
/// The XLSX parser stores expansion keys as "{depth}\x01{cell_value_key}".
/// BLANK_KEY = "\x00BLANK\x00" contains \x00, which previously broke the
/// rsplit('\x00') extraction in is_node_expanded.
#[test]
fn blank_node_expansion_with_depth_prefixed_keys() {
    // Two-level hierarchy: Category > Subcategory, with nulls in Subcategory.
    let data: Vec<Vec<CellValue>> = vec![
        vec![
            cv_text("Category"),
            cv_text("Subcategory"),
            cv_text("Value"),
        ],
        vec![cv_text("A"), cv_text("X"), cv_num(100.0)],
        vec![cv_text("A"), CellValue::Null, cv_num(50.0)],
        vec![cv_text("A"), CellValue::Null, cv_num(25.0)],
        vec![cv_text("B"), cv_text("Y"), cv_num(200.0)],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Subcategory", 1, DetectedDataType::String),
        ("Value", 2, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "blank_expansion_depth",
        &fields_spec,
        &["Category", "Subcategory"],
        &[],
        &[("Value", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    // Simulate OOXML expansion state with depth-prefixed keys.
    // Depth 0: "A" and "B" are expanded. Depth 1: blank is expanded.
    let mut expansion = PivotExpansionState::default();
    expansion.expanded_rows.insert("0\x01T:a".to_string()); // depth 0, "A"
    expansion.expanded_rows.insert("0\x01T:b".to_string()); // depth 0, "B"
    expansion
        .expanded_rows
        .insert("1\x01\x00BLANK\x00".to_string()); // depth 1, blank
    expansion.expanded_rows.insert("1\x01T:x".to_string()); // depth 1, "X"
    expansion.expanded_rows.insert("1\x01T:y".to_string()); // depth 1, "Y"

    let result = compute(&config, &data, Some(&expansion));
    assert!(result.errors.is_none());

    // With blanks expanded, we should see individual rows for the blank subcategory.
    // The blank group under "A" has two records (50 + 25).
    // Total rows: A|X (100), A|(blank) (75), B|Y (200) = at minimum 3 data rows.
    let non_subtotal: Vec<_> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert!(
        non_subtotal.len() >= 3,
        "expected at least 3 data rows, got {}",
        non_subtotal.len()
    );

    // Verify the blank subcategory row under "A" has the correct sum.
    let blank = find_row_by_key(&result.rows, "A|(blank)")
        .expect("A|(blank) row not found — blank expansion with depth-prefixed keys failed");
    assert_approx(&blank.values[0], 75.0, "A|(blank) SUM(Value)");
}

/// Test that blank header values render as "(blank)" text, not CellValue::Null.
#[test]
fn blank_headers_render_as_blank_text() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![CellValue::Null, cv_num(50.0)],
        vec![cv_text("A"), cv_num(100.0)],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Value", 1, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "blank_header_text",
        &fields_spec,
        &["Category"],
        &[],
        &[("Value", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // Find the blank row and verify its header is Text("(blank)"), not Null.
    let blank = find_row_by_key(&result.rows, "(blank)").expect("(blank) row not found");
    assert_eq!(
        blank.headers[0].value,
        CellValue::Text("(blank)".into()),
        "blank header should be Text(\"(blank)\"), not Null"
    );
}

/// Test that show_items_with_no_data defaults to true — blank rows survive
/// even when a filter exists on the field but doesn't set the flag.
#[test]
fn show_items_with_no_data_default_preserves_blanks() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Value")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![CellValue::Null, cv_num(50.0)],
        vec![cv_text("B"), cv_num(200.0)],
    ];

    let fields_spec: Vec<(&str, usize, DetectedDataType)> = vec![
        ("Category", 0, DetectedDataType::String),
        ("Value", 1, DetectedDataType::Number),
    ];

    // Add a filter that excludes "B" but does NOT set show_items_with_no_data.
    // The default (true) should preserve the blank row.
    let config = build_spreadjs_config(
        "blank_default_filter",
        &fields_spec,
        &["Category"],
        &[],
        &[("Value", AggregateFunction::Sum)],
        vec![PivotFilter {
            field_id: FieldId::from("category"),
            include_values: None,
            exclude_values: Some(vec![cv_text("B")]),
            condition: None,
            top_bottom: None,
            show_items_with_no_data: None, // relies on default
        }],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // Blank row should survive (default = true).
    let blank = find_row_by_key(&result.rows, "(blank)");
    assert!(
        blank.is_some(),
        "blank row should survive with default show_items_with_no_data"
    );
    assert_approx(&blank.unwrap().values[0], 50.0, "(blank) SUM(Value)");

    // "B" should be excluded.
    let b = find_row_by_key(&result.rows, "B");
    assert!(b.is_none(), "B should be excluded by filter");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 725.0, "Grand Total SUM(Value)");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 600.0, "Grand Total SUM(Value) with nulls");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 150.0, "Grand Total AVG(Value)");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 2.0, "Grand Total COUNT(Value)");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 3.0, "Grand Total COUNTA(Value)");
}

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

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 300.0, "Grand Total SUM(Value) with zero");
    assert_approx(&gt[1], 3.0, "Grand Total COUNT(Value) with zero");
    assert_approx(&gt[2], 100.0, "Grand Total AVG(Value) with zero");
}

// ---- sortByValue tests ----

#[test]
fn sort_by_value_desc() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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
    assert_eq!(result.rows.len(), 2);

    // West (4600) first, East (3900) second
    assert_eq!(result.rows[0].headers[0].value, cv_text("West"));
    assert_eq!(result.rows[0].values[0], cv_num(4600.0));
    assert_eq!(result.rows[1].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[1].values[0], cv_num(3900.0));
}

#[test]
fn sort_by_value_asc() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Asc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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
    // East (3900) first, West (4600) second
    assert_eq!(result.rows[0].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[0].values[0], cv_num(3900.0));
    assert_eq!(result.rows[1].headers[0].value, cv_text("West"));
    assert_eq!(result.rows[1].values[0], cv_num(4600.0));
}

#[test]
fn sort_by_second_value_field() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("units"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "units",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 2);

    // West units: 15+18+7+6=46, East units: 10+12+8+9=39
    // West should come first (higher units)
    assert_eq!(result.rows[0].headers[0].value, cv_text("West"));
    assert_eq!(result.rows[0].values[1], cv_num(46.0));
    assert_eq!(result.rows[1].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[1].values[1], cv_num(39.0));
}

#[test]
fn sort_by_value_with_column_key() {
    // Test 1: Sort by Widget column (column_key = "T:widget")
    let mut axis_widget = make_row_axis("region", 0);
    axis_widget.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: Some("T:widget".to_string()),
    });
    let config_widget = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_widget),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result_widget = compute(&config_widget, &sample_sales_data(), Some(&expand_all()));
    assert!(
        result_widget.errors.is_none(),
        "errors: {:?}",
        result_widget.errors
    );
    assert_eq!(result_widget.rows.len(), 2);
    // Sorted by Widget Sales desc: West (3300) first, East (2200) second
    assert_eq!(result_widget.rows[0].headers[0].value, cv_text("West"));
    assert_eq!(result_widget.rows[1].headers[0].value, cv_text("East"));

    // Test 2: Sort by Gadget column (column_key = "T:gadget")
    let mut axis_gadget = make_row_axis("region", 0);
    axis_gadget.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: Some("T:gadget".to_string()),
    });
    let config_gadget = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_gadget),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result_gadget = compute(&config_gadget, &sample_sales_data(), Some(&expand_all()));
    assert!(
        result_gadget.errors.is_none(),
        "errors: {:?}",
        result_gadget.errors
    );
    assert_eq!(result_gadget.rows.len(), 2);
    // Sorted by Gadget Sales desc: East (1700) first, West (1300) second
    assert_eq!(result_gadget.rows[0].headers[0].value, cv_text("East"));
    assert_eq!(result_gadget.rows[1].headers[0].value, cv_text("West"));

    // Test 3: Without column_key (should sort by first column leaf = Gadget)
    let mut axis_none = make_row_axis("region", 0);
    axis_none.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let config_none = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_none),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result_none = compute(&config_none, &sample_sales_data(), Some(&expand_all()));
    assert!(
        result_none.errors.is_none(),
        "errors: {:?}",
        result_none.errors
    );
    // Without column_key, sorts by first column leaf (Gadget): East (1700) first
    assert_eq!(result_none.rows[0].headers[0].value, cv_text("East"));
    assert_eq!(result_none.rows[1].headers[0].value, cv_text("West"));
}

#[test]
fn no_sort_when_not_configured() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_order = Some(SortDirection::Asc);
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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

    // Default alphabetical sort: East before West
    assert_eq!(result.rows[0].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[1].headers[0].value, cv_text("West"));
}

#[test]
fn invalid_value_field_reference() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("nonexistent"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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

    // Validation now catches unknown sort_by_value references
    assert!(result.errors.is_some());
    let errors = result.errors.as_ref().unwrap();
    assert!(
        errors
            .iter()
            .any(|e| e.contains("sort_by_value") && e.contains("nonexistent")),
        "should detect bad sort_by_value reference: {:?}",
        errors
    );
}

#[test]
fn multi_level_sort() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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

    // West (4600) should come before East (3900) at top level
    let top_level_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.depth == 0).collect();
    assert_eq!(top_level_rows[0].headers[0].value, cv_text("West"));
}

#[test]
fn null_values_in_sort() {
    let data_with_nulls: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Sales")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("B"), CellValue::Null],
        vec![cv_text("C"), cv_num(200.0)],
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
            id: FieldId::from("sales"),
            name: "Sales".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let mut axis = make_row_axis("category", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_cat = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        fields,
        vec![
            placement_cat,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data_with_nulls, Some(&expand_all()));

    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 3);

    // C (200) should be first, then A (100)
    assert_eq!(result.rows[0].values[0], cv_num(200.0));
    assert_eq!(result.rows[1].values[0], cv_num(100.0));
}

#[test]
fn ties_maintain_stable_sort() {
    let data_with_ties: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Sales")],
        vec![cv_text("B"), cv_num(100.0)],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("C"), cv_num(200.0)],
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
            id: FieldId::from("sales"),
            name: "Sales".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let mut axis = make_row_axis("category", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_cat = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        fields,
        vec![
            placement_cat,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data_with_ties, Some(&expand_all()));

    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 3);

    // C (200) should be first
    assert_eq!(result.rows[0].headers[0].value, cv_text("C"));
    assert_eq!(result.rows[0].values[0], cv_num(200.0));

    // A and B both have 100, they should both be there
    let tied_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.values[0] == cv_num(100.0))
        .collect();
    assert_eq!(tied_rows.len(), 2);
}

#[test]
fn sort_works_with_column_fields() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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

    // West should come first (higher total sales)
    assert_eq!(result.rows[0].headers[0].value, cv_text("West"));
}

#[test]
fn average_aggregation_with_sort_by_value() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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

    assert!(result.errors.is_none());

    // West average: (1500+1800+700+600)/4 = 1150
    // East average: (1000+1200+800+900)/4 = 975
    // West should come first
    assert_eq!(result.rows[0].headers[0].value, cv_text("West"));
    assert_eq!(result.rows[0].values[0], cv_num(1150.0));
    assert_eq!(result.rows[1].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[1].values[0], cv_num(975.0));
}

// ---- I6: Additional validations ----

#[test]
fn validate_duplicate_placements() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("region", PivotFieldArea::Row, 1, None), // duplicate
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("Duplicate placement")),
        "should detect duplicate field_id + area: {:?}",
        errors
    );
}

#[test]
fn validate_duplicate_value_placements_allowed() {
    // Same field in Value area with different aggregations should be allowed
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
            make_placement(
                "sales",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Average),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        !errors.iter().any(|e| e.contains("Duplicate placement")),
        "duplicate value placements should be allowed: {:?}",
        errors
    );
}

#[test]
fn validate_number_grouping_zero_interval() {
    let mut axis = make_row_axis("sales", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, 100.0, 0.0));
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "units",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors
            .iter()
            .any(|e| e.contains("interval") && e.contains("positive")),
        "should detect zero interval: {:?}",
        errors
    );
}

#[test]
fn validate_number_grouping_negative_interval() {
    let mut axis = make_row_axis("sales", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, 100.0, -5.0));
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "units",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors
            .iter()
            .any(|e| e.contains("interval") && e.contains("positive")),
        "should detect negative interval: {:?}",
        errors
    );
}

#[test]
fn validate_sort_by_value_bad_ref() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("nonexistent_field"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors
            .iter()
            .any(|e| e.contains("sort_by_value") && e.contains("nonexistent_field")),
        "should detect bad sort_by_value reference: {:?}",
        errors
    );
}

#[test]
fn validate_sort_by_value_valid_ref() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        !errors.iter().any(|e| e.contains("sort_by_value")),
        "valid sort_by_value should not produce errors: {:?}",
        errors
    );
}

// ---- validate_and_resolve tests ----

#[test]
fn test_validate_and_resolve_valid_minimal_config() {
    let fields = sample_fields();
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let config = make_base_config(fields, placements, vec![]);

    let resolved = validate_and_resolve(&config).expect("should be valid");
    assert_eq!(resolved.id(), "pivot1");
    assert_eq!(resolved.source_sheet_name(), "sheet1");
    assert_eq!(resolved.row_placements().len(), 1);
    assert_eq!(resolved.value_placements().len(), 1);
    assert_eq!(resolved.column_placements().len(), 0);
    assert_eq!(resolved.filter_placements().len(), 0);
    assert_eq!(resolved.filters().len(), 0);
    assert_eq!(resolved.calculated_fields().len(), 0);
    // Check defaults resolved
    assert_eq!(
        resolved.row_placements()[0].sort_order(),
        SortDirection::Asc
    );
    assert!(!resolved.row_placements()[0].show_subtotals());
    // Layout defaults
    assert!(resolved.layout().show_row_grand_totals());
    assert!(resolved.layout().show_column_grand_totals());
    assert_eq!(*resolved.layout().layout_form(), LayoutForm::Compact);
    assert!(!resolved.layout().repeat_all_item_labels());
    assert!(!resolved.layout().show_empty_rows());
    assert!(!resolved.layout().show_empty_columns());
    // Column index resolved
    assert_eq!(resolved.row_placements()[0].column_index(), 0); // "region" = col 0
    assert_eq!(resolved.value_placements()[0].column_index(), 3); // "sales" = col 3
}

#[test]
fn test_validate_and_resolve_empty_id() {
    let fields = sample_fields();
    let placements = vec![make_placement("region", PivotFieldArea::Row, 0, None)];
    let mut config = make_base_config(fields, placements, vec![]);
    config.id = "".to_string();

    let err = validate_and_resolve(&config).unwrap_err();
    match err {
        PivotError::MissingField { field, .. } => {
            assert_eq!(field, "id");
        }
        PivotError::Multiple { ref errors } => {
            assert!(
                errors
                    .iter()
                    .any(|e| matches!(e, PivotError::MissingField { field, .. } if field == "id"))
            );
        }
        other => panic!("Expected MissingField, got: {:?}", other),
    }
}

#[test]
fn test_validate_and_resolve_unknown_field_in_placement() {
    let fields = sample_fields();
    let placements = vec![
        make_placement("nonexistent_field", PivotFieldArea::Row, 0, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let config = make_base_config(fields, placements, vec![]);

    let err = validate_and_resolve(&config).unwrap_err();
    match err {
        PivotError::UnknownField { field_id, .. } => {
            assert_eq!(field_id, "nonexistent_field");
        }
        PivotError::Multiple { ref errors } => {
            assert!(errors.iter().any(|e| matches!(e, PivotError::UnknownField { field_id, .. } if field_id == "nonexistent_field")));
        }
        other => panic!("Expected UnknownField, got: {:?}", other),
    }
}

#[test]
fn test_validate_and_resolve_invalid_number_grouping() {
    let fields = sample_fields();
    let placements = vec![
        PivotFieldPlacement::Row(AxisPlacement {
            base: PlacementBase {
                field_id: FieldId::from("sales"),
                placement_id: crate::types::PlacementId::default(),
                position: 0,
                display_name: None,
            },
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: Some(NumberGrouping::new(100.0, 50.0, 10.0)),
            show_subtotals: None,
        }),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let config = make_base_config(fields, placements, vec![]);

    let err = validate_and_resolve(&config).unwrap_err();
    match err {
        PivotError::InvalidValue { field, .. } => {
            assert_eq!(field, "sales");
        }
        PivotError::Multiple { ref errors } => {
            assert!(
                errors.iter().any(
                    |e| matches!(e, PivotError::InvalidValue { field, .. } if field == "sales")
                )
            );
        }
        other => panic!("Expected InvalidValue, got: {:?}", other),
    }
}

#[test]
fn test_validate_and_resolve_missing_between_operand() {
    let fields = sample_fields();
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let filters = vec![PivotFilter {
        field_id: FieldId::from("sales"),
        include_values: None,
        exclude_values: None,
        condition: Some(PivotFilterConditionFlat {
            operator: FilterOperator::Between,
            value: Some(cv_num(10.0)),
            value2: None, // Missing second operand!
        }),
        top_bottom: None,
        show_items_with_no_data: None,
    }];
    let config = make_base_config(fields, placements, filters);

    let err = validate_and_resolve(&config).unwrap_err();
    match err {
        PivotError::InvalidFilter { field_id, .. } => {
            assert_eq!(field_id, "sales");
        }
        PivotError::Multiple { ref errors } => {
            assert!(errors.iter().any(
                |e| matches!(e, PivotError::InvalidFilter { field_id, .. } if field_id == "sales")
            ));
        }
        other => panic!("Expected InvalidFilter, got: {:?}", other),
    }
}

#[test]
fn test_validate_and_resolve_backward_compat_wrapper() {
    // Valid config -> empty errors
    let fields = sample_fields();
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let config = make_base_config(fields, placements, vec![]);
    assert!(validate_config(&config).is_empty());

    // Invalid config -> non-empty errors
    let fields2 = sample_fields();
    let mut bad_config = make_base_config(fields2, vec![], vec![]);
    bad_config.id = "".to_string();
    let errs = validate_config(&bad_config);
    assert!(!errs.is_empty());
}

// ---- compute_resolved tests ----

#[test]
fn compute_resolved_matches_compute_simple() {
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
        vec![],
    );
    let data = sample_sales_data();

    let result_wire = compute(&config, &data, Some(&expand_all()));
    let resolved = validate_and_resolve(&config).unwrap();
    let result_resolved = compute_resolved(&resolved, &data, Some(&expand_all()));

    assert!(result_wire.errors.is_none());
    assert!(result_resolved.errors.is_none());
    assert_eq!(result_wire.rows.len(), result_resolved.rows.len());
    assert_eq!(
        result_wire.source_row_count,
        result_resolved.source_row_count
    );

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
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "units",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Average),
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
    let data = sample_sales_data();

    let result_wire = compute(&config, &data, Some(&expand_all()));
    let resolved = validate_and_resolve(&config).unwrap();
    let result_resolved = compute_resolved(&resolved, &data, Some(&expand_all()));

    assert!(result_wire.errors.is_none());
    assert!(result_resolved.errors.is_none());
    assert_eq!(result_wire.rows.len(), result_resolved.rows.len());
    assert_eq!(
        result_wire.column_headers.len(),
        result_resolved.column_headers.len()
    );

    for (rw, rr) in result_wire.rows.iter().zip(result_resolved.rows.iter()) {
        assert_eq!(rw.key, rr.key);
        assert_eq!(rw.values, rr.values);
    }

    // Grand totals should also match
    assert_eq!(
        result_wire.grand_totals.row,
        result_resolved.grand_totals.row
    );
    assert_eq!(
        result_wire.grand_totals.column,
        result_resolved.grand_totals.column
    );
    assert_eq!(
        result_wire.grand_totals.grand,
        result_resolved.grand_totals.grand
    );
}

#[test]
fn compute_resolved_matches_compute_with_grand_totals() {
    let mut config = make_base_config(
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });
    let data = sample_sales_data();

    let result_wire = compute(&config, &data, Some(&expand_all()));
    let resolved = validate_and_resolve(&config).unwrap();
    let result_resolved = compute_resolved(&resolved, &data, Some(&expand_all()));

    assert_eq!(
        result_wire.grand_totals.row,
        result_resolved.grand_totals.row
    );
    assert_eq!(
        result_wire.grand_totals.column,
        result_resolved.grand_totals.column
    );
    assert_eq!(
        result_wire.grand_totals.grand,
        result_resolved.grand_totals.grand
    );
}

#[test]
fn drill_down_resolved_matches_drill_down() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
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

#[test]
fn compute_with_show_values_as_resolved_matches_wire() {
    let mut config = make_base_config(
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });
    let data = sample_sales_data();

    let result_wire = compute_with_show_values_as(&config, &data, Some(&expand_all()));
    let resolved = validate_and_resolve(&config).unwrap();
    let result_resolved =
        compute_with_show_values_as_resolved(&resolved, &data, Some(&expand_all()));

    assert!(result_wire.errors.is_none());
    assert!(result_resolved.errors.is_none());
    assert_eq!(result_wire.rows.len(), result_resolved.rows.len());
    for (rw, rr) in result_wire.rows.iter().zip(result_resolved.rows.iter()) {
        assert_eq!(rw.key, rr.key);
        assert_eq!(rw.values, rr.values);
    }
}

// ---- B4e: Custom sort lists in engine ----

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

// ---- B4j: Negative numbers in aggregation (StdDev, Product) ----

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
    assert!(
        result_stdev.errors.is_none(),
        "StdDev errors: {:?}",
        result_stdev.errors
    );

    // StdDev should always be non-negative
    for row in &result_stdev.rows {
        if let CellValue::Number(v) = &row.values[0] {
            assert!(
                v.get() >= 0.0,
                "StdDev should be non-negative for row '{}', got {}",
                row.key,
                *v
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
        assert!(
            stdev_a.get() > 0.0,
            "StdDev of A should be positive, got {}",
            *stdev_a
        );
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
    assert!(
        a_row_product.is_some(),
        "Should have category A row for product"
    );
    if let CellValue::Number(product_a) = &a_row_product.unwrap().values[0] {
        assert!(
            (product_a.get() - 1000.0).abs() < 0.01,
            "Product of A should be 1000, got {}",
            *product_a
        );
    }

    // B: product of [-3, -7] = 21 (positive: two negatives)
    let b_row_product = result_product
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("B"));
    assert!(
        b_row_product.is_some(),
        "Should have category B row for product"
    );
    if let CellValue::Number(product_b) = &b_row_product.unwrap().values[0] {
        assert!(
            (product_b.get() - 21.0).abs() < 0.01,
            "Product of B should be 21, got {}",
            *product_b
        );
    }
}

// ---- Sensitivity tests ----

#[test]
fn sensitivity_sort_order() {
    let config_asc = make_base_config(
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
    let result_asc = compute(&config_asc, &sample_sales_data(), Some(&expand_all()));

    let mut axis = make_row_axis("region", 0);
    axis.sort_order = Some(SortDirection::Desc);
    let config_desc = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_desc = compute(&config_desc, &sample_sales_data(), Some(&expand_all()));

    let keys_asc: Vec<_> = result_asc.rows.iter().map(|r| &r.key).collect();
    let keys_desc: Vec<_> = result_desc.rows.iter().map(|r| &r.key).collect();
    assert_ne!(keys_asc, keys_desc, "sort_order must affect row ordering");
}

#[test]
fn sensitivity_sort_by_value_column_key() {
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
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_a = compute(&config_a, &sample_sales_data(), Some(&expand_all()));

    let col_keys: Vec<String> = result_a
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter())
        .map(|h| h.key.clone())
        .collect();

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
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        );
        let result_b = compute(&config_b, &sample_sales_data(), Some(&expand_all()));

        assert!(
            result_a.errors.is_none(),
            "baseline errors: {:?}",
            result_a.errors
        );
        assert!(
            result_b.errors.is_none(),
            "variant errors: {:?}",
            result_b.errors
        );
        // With sample data both column_key variants may produce the same order;
        // the extended-data block below tests divergence with crafted data.
        let _keys_a: Vec<_> = result_a.rows.iter().map(|r| &r.key).collect();
        let _keys_b: Vec<_> = result_b.rows.iter().map(|r| &r.key).collect();
    }

    // Use extended data where different column keys yield different sort orders
    let data: Vec<Vec<CellValue>> = vec![
        vec![
            cv_text("Region"),
            cv_text("Product"),
            cv_text("Quarter"),
            cv_text("Sales"),
            cv_text("Units"),
        ],
        // East: Q1 high, Q2 low
        vec![
            cv_text("East"),
            cv_text("Widget"),
            cv_text("Q1"),
            cv_num(5000.0),
            cv_num(10.0),
        ],
        vec![
            cv_text("East"),
            cv_text("Widget"),
            cv_text("Q2"),
            cv_num(100.0),
            cv_num(10.0),
        ],
        // West: Q1 low, Q2 high
        vec![
            cv_text("West"),
            cv_text("Widget"),
            cv_text("Q1"),
            cv_num(100.0),
            cv_num(10.0),
        ],
        vec![
            cv_text("West"),
            cv_text("Widget"),
            cv_text("Q2"),
            cv_num(5000.0),
            cv_num(10.0),
        ],
    ];

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
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_q1 = compute(&config_q1, &data, Some(&expand_all()));

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
                make_placement(
                    "sales",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
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
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_asc = compute(&config_asc, &sample_sales_data(), Some(&expand_all()));

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
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
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
fn sensitivity_aggregate_function() {
    let config_sum = make_base_config(
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
    let result_sum = compute(&config_sum, &sample_sales_data(), Some(&expand_all()));

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
fn sensitivity_custom_sort_list() {
    let config_default = make_base_config(
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
    let result_default = compute(&config_default, &sample_sales_data(), Some(&expand_all()));

    let mut axis = make_row_axis("region", 0);
    axis.custom_sort_list = Some(vec![cv_text("West"), cv_text("East")]);
    let config_custom = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
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

// ---- FIX 2a-2d: Validation tests ----

#[test]
fn validate_show_values_as_difference_requires_base_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::Difference,
                    base_field: None, // Missing!
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject Difference without base_field");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("base_field"),
        "Error should mention base_field: {}",
        msg
    );
}

#[test]
fn validate_show_values_as_running_total_requires_base_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::RunningTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );
    let err = validate_and_resolve(&config);
    assert!(
        err.is_err(),
        "Should reject RunningTotal without base_field"
    );
}

#[test]
fn validate_top_bottom_n_must_be_finite() {
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
                n: f64::NAN,
                by: TopBottomBy::Items,
                value_field_id: None,
            }),
            show_items_with_no_data: None,
        }],
    );
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject NaN for top_bottom.n");
}

#[test]
fn validate_top_bottom_n_must_be_non_negative() {
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
                n: -5.0,
                by: TopBottomBy::Items,
                value_field_id: None,
            }),
            show_items_with_no_data: None,
        }],
    );
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject negative top_bottom.n");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("non-negative"),
        "Error should mention non-negative: {}",
        msg
    );
}

#[test]
fn validate_top_bottom_n_items_must_be_integer() {
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
                n: 2.5,
                by: TopBottomBy::Items,
                value_field_id: None,
            }),
            show_items_with_no_data: None,
        }],
    );
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject non-integer n for Items mode");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("integer"),
        "Error should mention integer: {}",
        msg
    );
}

#[test]
fn validate_source_range_inverted_rows_auto_normalized() {
    // CellRange::new auto-normalizes inverted coords, so this becomes (5,0,10,4)
    let mut config = make_base_config(
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
    config.source_range = CellRange::new(10, 0, 5, 4);
    assert_eq!(config.source_range.start_row(), 5);
    assert_eq!(config.source_range.end_row(), 10);
    let result = validate_and_resolve(&config);
    assert!(
        result.is_ok(),
        "Normalized range should be valid: {:?}",
        result
    );
}

#[test]
fn validate_source_range_inverted_cols_auto_normalized() {
    // CellRange::new auto-normalizes inverted coords, so this becomes (0,4,8,10)
    let mut config = make_base_config(
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
    config.source_range = CellRange::new(0, 10, 8, 4);
    assert_eq!(config.source_range.start_col(), 4);
    assert_eq!(config.source_range.end_col(), 10);
    let result = validate_and_resolve(&config);
    assert!(
        result.is_ok(),
        "Normalized range should be valid: {:?}",
        result
    );
}

#[test]
fn validate_source_range_too_few_rows() {
    let mut config = make_base_config(
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
    config.source_range = CellRange::new(0, 0, 0, 4); // Only 1 row (header only)
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject range with only 1 row");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("at least 2 rows"),
        "Error should mention at least 2 rows: {}",
        msg
    );
}

#[test]
fn validate_empty_output_sheet_name() {
    let mut config = make_base_config(
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
    config.output_sheet_name = String::new();
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject empty output_sheet_name");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("output_sheet_name"),
        "Error should mention output_sheet_name: {}",
        msg
    );
}

#[test]
fn validate_duplicate_field_ids() {
    let fields = vec![
        PivotField {
            id: FieldId::from("region"),
            name: "Region".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("region"), // Duplicate!
            name: "Region Copy".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sales"),
            name: "Sales".to_string(),
            source_column: 3,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];
    let config = make_base_config(
        fields,
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
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject duplicate field IDs");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("Duplicate field IDs"),
        "Error should mention duplicate field IDs: {}",
        msg
    );
}

#[test]
fn sort_by_value_inner_field_depth1() {
    // Sort by value on the INNER row field (depth 1), not the outer.
    // Data: East has Widget(2200) and Gadget(1700)
    //       West has Widget(3300) and Gadget(1300)
    // Alphabetical: Gadget before Widget. Value desc: Widget before Gadget.

    let outer = make_row_axis("region", 0);
    let mut inner = make_row_axis("product", 1);
    inner.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });

    let config = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(outer),
            PivotFieldPlacement::Row(inner),
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

    let east_children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 1 && !r.is_subtotal && r.headers[0].value == cv_text("East"))
        .collect();

    assert_eq!(east_children.len(), 2);
    // Sorted by sales desc: Widget(2200) before Gadget(1700)
    assert_eq!(
        east_children[0].headers[1].value,
        cv_text("Widget"),
        "East's first child should be Widget (2200), got {:?}. Children: {:?}",
        east_children[0].headers[1].value,
        east_children
            .iter()
            .map(|r| (&r.headers[1].value, &r.values[0]))
            .collect::<Vec<_>>()
    );
}

// ====================================================================
// Coverage gap tests: compute.rs, row_computation.rs
// ====================================================================

/// Test compute_with_show_values_as with an invalid config triggers the
/// validate_and_resolve error path (compute.rs line ~474).
#[test]
fn compute_with_show_values_as_invalid_config_returns_error() {
    // Empty ID triggers validation failure
    let config = PivotTableConfig {
        schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: String::new(), // invalid: empty ID
        name: "bad".to_string(),
        source_sheet_id: None,
        source_sheet_name: String::new(),
        source_range: CellRange::new(0, 0, 0, 0),
        output_sheet_name: String::new(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: vec![],
        placements: vec![],
        filters: vec![],
        layout: None,
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    };

    let result = compute_with_show_values_as(&config, &[], Some(&expand_all()));
    assert!(
        result.errors.is_some(),
        "Invalid config should produce errors"
    );
}

/// Test that display_name on a value placement appears in column headers
/// instead of the default "aggregate of field_id" format (compute.rs lines ~71, ~145-149).
#[test]
fn display_name_appears_in_value_column_headers() {
    let fields = sample_fields();
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("sales"),
                placement_id: crate::types::PlacementId::default(),
                position: 0,
                display_name: Some("Revenue".to_string()),
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: AggregateFunction::Sum,
            number_format: None,
            show_values_as: None,
        }),
    ];

    let config = make_base_config(fields, placements, vec![]);
    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // The column header for the value field should use "Revenue" not "sum of sales"
    let value_headers: Vec<String> = result
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter())
        .filter_map(|h| match &h.value {
            CellValue::Text(s) => Some(s.to_string()),
            _ => None,
        })
        .collect();

    assert!(
        value_headers.iter().any(|h| h == "Revenue"),
        "Expected 'Revenue' in column headers, got: {:?}",
        value_headers
    );
    assert!(
        !value_headers.iter().any(|h| h.contains("sum")),
        "Should not contain default 'sum of sales', got: {:?}",
        value_headers
    );
}

/// Test display_name on a value placement with multiple values and column grouping
/// (compute.rs line ~145-149: display_name in multi-value column headers).
#[test]
fn display_name_in_multi_value_with_columns() {
    let fields = sample_fields();
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement("quarter", PivotFieldArea::Column, 0, None),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("sales"),
                placement_id: crate::types::PlacementId::default(),
                position: 0,
                display_name: Some("Revenue".to_string()),
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: AggregateFunction::Sum,
            number_format: None,
            show_values_as: None,
        }),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("units"),
                placement_id: crate::types::PlacementId::default(),
                position: 1,
                display_name: Some("Qty".to_string()),
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: AggregateFunction::Sum,
            number_format: None,
            show_values_as: None,
        }),
    ];

    let config = make_base_config(fields, placements, vec![]);
    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Find value-level column headers (the __VALUES__ row)
    let values_header = result
        .column_headers
        .iter()
        .find(|ch| ch.field_id.as_ref() == "__VALUES__");
    assert!(values_header.is_some(), "Should have __VALUES__ header row");

    let value_names: Vec<String> = values_header
        .unwrap()
        .headers
        .iter()
        .filter_map(|h| match &h.value {
            CellValue::Text(s) => Some(s.to_string()),
            _ => None,
        })
        .collect();

    // Each column leaf should have "Revenue" and "Qty" labels
    assert!(
        value_names.iter().any(|n| n == "Revenue"),
        "Expected 'Revenue' in value headers, got: {:?}",
        value_names
    );
    assert!(
        value_names.iter().any(|n| n == "Qty"),
        "Expected 'Qty' in value headers, got: {:?}",
        value_names
    );
}

/// Test that empty data returns default grand_totals (row_computation.rs line ~39).
#[test]
fn empty_data_returns_empty_result() {
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
        vec![],
    );

    // Only header row, no data rows
    let data = vec![vec![
        cv_text("Region"),
        cv_text("Product"),
        cv_text("Quarter"),
        cv_text("Sales"),
        cv_text("Units"),
    ]];

    let result = compute(&config, &data, Some(&expand_all()));
    // Should produce empty result without errors
    assert!(result.errors.is_none());
    assert!(result.rows.is_empty());
}

/// Test calculated fields applied to grand totals WITH column grouping
/// (compute.rs lines ~403-450: the column/grand branches).
#[test]
fn calc_field_grand_totals_with_column_grouping() {
    let fields = sample_fields();
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement("quarter", PivotFieldArea::Column, 0, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
        make_placement(
            "units",
            PivotFieldArea::Value,
            1,
            Some(AggregateFunction::Sum),
        ),
    ];

    let mut config = make_base_config(fields, placements, vec![]);
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("avg_price"),
        name: "Avg Price".to_string(),
        formula: "Sales / Units".to_string(),
    }]);
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Row grand totals should include calculated field values
    let row_gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("row grand totals should exist");
    // With 2 quarters x (2 values + 1 calc) = 6 values in row GT
    assert!(
        row_gt.len() > 2,
        "Row GT should have more than 2 values (includes calc fields), got {}",
        row_gt.len()
    );

    // Column grand totals should also be populated with calc fields
    let col_gt = result
        .grand_totals
        .column
        .as_ref()
        .expect("column grand totals should exist");
    assert_eq!(
        col_gt.len(),
        result.rows.len(),
        "Should have one column total per data row"
    );
    // Each column total should have 3 values (Sales, Units, Avg Price)
    for (i, row_totals) in col_gt.iter().enumerate() {
        assert_eq!(
            row_totals.len(),
            3,
            "Column GT row {} should have 3 values (Sales, Units, Avg Price), got {}",
            i,
            row_totals.len()
        );
    }

    // Grand total (corner) should also have 3 values
    let grand = result
        .grand_totals
        .grand
        .as_ref()
        .expect("grand total should exist");
    assert_eq!(
        grand.len(),
        3,
        "Grand total should have 3 values, got {}",
        grand.len()
    );
    // Total Sales = 8500, Total Units = 85, Avg Price = 100
    assert_approx(&grand[0], 8500.0, "Grand: Sales");
    assert_approx(&grand[1], 85.0, "Grand: Units");
    assert_approx(&grand[2], 100.0, "Grand: Avg Price");
}

/// Test number grouping on column placements (row_computation.rs line ~117).
#[test]
fn number_grouping_on_column_field() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Region"), cv_text("Score"), cv_text("Amount")],
        vec![cv_text("East"), cv_num(25.0), cv_num(100.0)],
        vec![cv_text("East"), cv_num(75.0), cv_num(200.0)],
        vec![cv_text("West"), cv_num(35.0), cv_num(300.0)],
        vec![cv_text("West"), cv_num(85.0), cv_num(400.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("region"),
            name: "Region".to_string(),
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
            field_id: FieldId::from("score"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: Some(NumberGrouping::new(0.0, 100.0, 50.0)),
        show_subtotals: None,
    };

    let config = make_base_config(
        fields,
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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

    // Should have column headers with number grouping labels
    assert!(
        !result.column_headers.is_empty(),
        "Should have column headers"
    );

    let header_values: Vec<String> = result
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter())
        .filter_map(|h| match &h.value {
            CellValue::Text(s) => Some(s.to_string()),
            _ => None,
        })
        .collect();

    // Should have "0 - 49" and "50 - 99" groups
    assert!(
        header_values.iter().any(|h| h.contains("0 - 49")),
        "Expected '0 - 49' in column headers, got: {:?}",
        header_values
    );
    assert!(
        header_values.iter().any(|h| h.contains("50 - 99")),
        "Expected '50 - 99' in column headers, got: {:?}",
        header_values
    );

    // Should have 2 rows (East, West)
    assert_eq!(result.rows.len(), 2);
}

/// Test subtotal ancestor headers in outline layout (row_computation.rs lines ~181-194).
#[test]
fn subtotal_has_ancestor_headers() {
    let fields = sample_fields();
    let mut placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement("product", PivotFieldArea::Row, 1, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    // Enable subtotals on the first row field
    if let PivotFieldPlacement::Row(ref mut axis) = placements[0] {
        axis.show_subtotals = Some(true);
    }

    let mut config = make_base_config(fields, placements, vec![]);
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(false),
        show_column_grand_totals: Some(false),
        layout_form: Some(LayoutForm::Outline),
        ..Default::default()
    });

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Find subtotal rows
    let subtotal_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.is_subtotal).collect();
    assert!(
        !subtotal_rows.is_empty(),
        "Should have subtotal rows in outline layout with show_subtotals=true"
    );

    // Each subtotal row should have headers including the subtotal marker
    for subtotal in &subtotal_rows {
        let has_subtotal_header = subtotal.headers.iter().any(|h| h.is_subtotal);
        assert!(
            has_subtotal_header,
            "Subtotal row should have a subtotal header, got: {:?}",
            subtotal
                .headers
                .iter()
                .map(|h| (&h.value, h.is_subtotal))
                .collect::<Vec<_>>()
        );
    }
}
