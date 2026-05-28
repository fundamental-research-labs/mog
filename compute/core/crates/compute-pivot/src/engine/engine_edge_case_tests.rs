//! Edge case tests for the pivot engine compute function.
//!
//! Tests: empty data, header-only, single row, all-null values,
//! filter excluding everything, CountA vs Count on text,
//! multiple value fields, large column field.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

// ========================================================================
// 1. compute_empty_data — compute with empty Vec (no rows at all)
// ========================================================================

#[test]
fn compute_empty_data() {
    let data: Vec<Vec<CellValue>> = vec![];
    let config = build_spreadjs_config(
        "empty",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    // With empty data, validation may error (source_range has 0 rows) or
    // compute returns an empty result.
    assert!(
        result.rows.is_empty(),
        "Empty data should produce no rows, got {}",
        result.rows.len()
    );
}

// ========================================================================
// 2. compute_header_only — compute with just the header row, no data rows
// ========================================================================

#[test]
fn compute_header_only() {
    let data = vec![vec![
        cv_text("Region"),
        cv_text("Product"),
        cv_text("Quarter"),
        cv_text("Sales"),
        cv_text("Units"),
    ]];
    let config = build_spreadjs_config(
        "header_only",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(
        result.rows.is_empty(),
        "Header-only data should produce no data rows, got {}",
        result.rows.len()
    );
    assert_eq!(result.source_row_count, 0);
}

// ========================================================================
// 3. compute_single_row — compute with one data row
// ========================================================================

#[test]
fn compute_single_row() {
    let data = vec![
        vec![
            cv_text("Region"),
            cv_text("Product"),
            cv_text("Quarter"),
            cv_text("Sales"),
            cv_text("Units"),
        ],
        vec![
            cv_text("East"),
            cv_text("Widget"),
            cv_text("Q1"),
            cv_num(1000.0),
            cv_num(10.0),
        ],
    ];
    let config = build_spreadjs_config(
        "single_row",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert_eq!(result.source_row_count, 1);

    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(data_rows.len(), 1, "Should have exactly one data row");

    let row = data_rows[0];
    assert_eq!(row.headers[0].value, cv_text("East"));
    assert_approx(&row.values[0], 1000.0, "single row sales sum");
}

// ========================================================================
// 4. compute_all_null_values — all value cells are Null
// ========================================================================

#[test]
fn compute_all_null_values() {
    let data = vec![
        vec![cv_text("Region"), cv_text("Sales")],
        vec![cv_text("East"), CellValue::Null],
        vec![cv_text("West"), CellValue::Null],
        vec![cv_text("East"), CellValue::Null],
    ];

    let fields_spec = vec![
        ("Region", 0, DetectedDataType::String),
        ("Sales", 1, DetectedDataType::Number),
    ];
    let config = build_spreadjs_config(
        "all_null",
        &fields_spec,
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    // Should not panic, and should produce rows for East and West
    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(data_rows.len(), 2, "Should have rows for East and West");

    // Sum of nulls should be 0 or Null
    for row in &data_rows {
        match &row.values[0] {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 0.0).abs() < 1e-5,
                    "Sum of null values should be 0, got {}",
                    n
                );
            }
            CellValue::Null => {
                // Also acceptable
            }
            other => {
                panic!(
                    "Expected Number(0) or Null for sum of null values, got {:?}",
                    other
                );
            }
        }
    }
}

// ========================================================================
// 5. compute_with_filter_excluding_everything
// ========================================================================

#[test]
fn compute_with_filter_excluding_everything() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "filter_all_out",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: Some(vec![cv_text("Nonexistent Region")]),
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: None,
        }],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert!(
        data_rows.is_empty(),
        "Filter excluding everything should produce no data rows, got {}",
        data_rows.len()
    );
}

// ========================================================================
// 6. compute_counta_vs_count_on_text
// ========================================================================

#[test]
fn compute_counta_vs_count_on_text() {
    // CountA counts non-empty cells; Count counts numeric cells only.
    // On a text-only field, Count should be 0 while CountA should be non-zero.
    let data = vec![
        vec![cv_text("Category"), cv_text("Name"), cv_text("Score")],
        vec![cv_text("A"), cv_text("Alice"), cv_num(90.0)],
        vec![cv_text("A"), cv_text("Bob"), cv_num(85.0)],
        vec![cv_text("B"), cv_text("Charlie"), cv_num(70.0)],
    ];

    let fields_spec = vec![
        ("Category", 0, DetectedDataType::String),
        ("Name", 1, DetectedDataType::String),
        ("Score", 2, DetectedDataType::Number),
    ];

    // CountA on text field "Name"
    let config_counta = build_spreadjs_config(
        "counta_text",
        &fields_spec,
        &["Category"],
        &[],
        &[("Name", AggregateFunction::CountA)],
        vec![],
        &data,
    );

    let result_counta = compute(&config_counta, &data, Some(&expand_all()));
    let row_a = find_row_by_key(&result_counta.rows, "a").expect("Should find category A");
    // CountA on text field "Name" for category A should be 2 (Alice, Bob)
    assert_approx(&row_a.values[0], 2.0, "CountA of text for category A");

    // Count on text field "Name" — should be 0 (Count only counts numbers)
    let config_count = build_spreadjs_config(
        "count_text",
        &fields_spec,
        &["Category"],
        &[],
        &[("Name", AggregateFunction::Count)],
        vec![],
        &data,
    );

    let result_count = compute(&config_count, &data, Some(&expand_all()));
    let row_a_count = find_row_by_key(&result_count.rows, "a").expect("Should find category A");
    match &row_a_count.values[0] {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 0.0).abs() < 1e-5,
                "Count of text field should be 0, got {}",
                n
            );
        }
        CellValue::Null => {
            // Also acceptable — no numbers to count
        }
        other => {
            panic!(
                "Expected Number(0) or Null for Count of text, got {:?}",
                other
            );
        }
    }
}

// ========================================================================
// 7. compute_with_multiple_value_fields — test with 3 value fields
// ========================================================================

#[test]
fn compute_with_multiple_value_fields() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "multi_value",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[
            ("Sales", AggregateFunction::Sum),
            ("Sales", AggregateFunction::Average),
            ("Units", AggregateFunction::Sum),
        ],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    let east_row = find_row_by_key(&result.rows, "east").expect("Should find East row");

    // East has: 1000, 1200, 800, 900 in Sales
    assert_approx(&east_row.values[0], 3900.0, "East Sum of Sales");
    assert_approx(&east_row.values[1], 975.0, "East Average of Sales");

    // East has: 10, 12, 8, 9 in Units
    assert_approx(&east_row.values[2], 39.0, "East Sum of Units");

    let west_row = find_row_by_key(&result.rows, "west").expect("Should find West row");
    // West has: 1500, 1800, 700, 600 in Sales
    assert_approx(&west_row.values[0], 4600.0, "West Sum of Sales");
    assert_approx(&west_row.values[1], 1150.0, "West Average of Sales");
    // West has: 15, 18, 7, 6 in Units
    assert_approx(&west_row.values[2], 46.0, "West Sum of Units");
}

// ========================================================================
// 8. compute_large_column_field — column field with many unique values (20+)
// ========================================================================

#[test]
fn compute_large_column_field() {
    // Build data with 25 unique column values
    let mut data = vec![vec![cv_text("Row"), cv_text("Col"), cv_text("Value")]];
    for i in 0..25 {
        data.push(vec![
            cv_text("A"),
            cv_text(&format!("C{:02}", i)),
            cv_num((i + 1) as f64 * 10.0),
        ]);
    }

    let fields_spec = vec![
        ("Row", 0, DetectedDataType::String),
        ("Col", 1, DetectedDataType::String),
        ("Value", 2, DetectedDataType::Number),
    ];

    let config = build_spreadjs_config(
        "large_col",
        &fields_spec,
        &["Row"],
        &["Col"],
        &[("Value", AggregateFunction::Sum)],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));

    // Should have column headers for all 25 unique values
    assert!(
        !result.column_headers.is_empty(),
        "Should have column headers"
    );
    // The first column header level should have 25 unique values
    let col_count = result.column_headers[0].headers.len();
    assert!(
        col_count >= 25,
        "Should have at least 25 column values, got {}",
        col_count
    );

    // Row "A" should have data
    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(data_rows.len(), 1, "Should have 1 data row for 'A'");

    // Check that the total values array length matches: 25 columns * 1 value field = 25 values
    assert_eq!(
        data_rows[0].values.len(),
        25,
        "Should have 25 value cells (one per column)"
    );
}

// ============================================================================
// Mixed-type aggregation tests (moved from pivot_bug_repro_tests.rs)
// ============================================================================
//
// Known discrepancy: Excel produces #NUM! for mixed-type groups, we skip
// non-numeric values and aggregate the numerics. This is intentional — see
// test comments for rationale.

/// Bug repro: AVERAGE of purely numeric category should be a valid number.
/// This test should PASS — it validates baseline behavior.
#[test]
fn mixed_type_average_pure_numeric_produces_valid_number() {
    let data = mixed_type_amount_data();
    let config = mixed_type_avg_config();
    let result = compute(&config, &data, Some(&expand_all()));

    let groceries = find_row_by_key(&result.rows, "Groceries").expect("should find Groceries row");

    // Groceries: avg(-50, -30, -20) = -33.333...
    assert_approx(
        &groceries.values[0],
        -100.0 / 3.0,
        "Groceries average (all numeric)",
    );
}

/// Known discrepancy: Excel produces #NUM! for mixed-type groups, we average the numerics.
/// Banking has amounts: -100 (num), 200 (num), "2,650.00" (text).
/// Excel: #NUM!. Mog: avg(-100, 200) = 50.0 — we skip text, which is more useful.
#[test]
fn mixed_types_average_skips_text_values() {
    let data = mixed_type_amount_data();
    let config = mixed_type_avg_config();
    let result = compute(&config, &data, Some(&expand_all()));

    let banking = find_row_by_key(&result.rows, "Banking").expect("should find Banking row");

    // We intentionally diverge from Excel here: avg of the 2 numeric values.
    assert_approx(&banking.values[0], 50.0, "Banking average (numerics only)");
}

/// Known discrepancy: all-text group produces Null (blank), not #NUM!.
/// Rent has amounts: "1,400.00" (text), "1,400.00" (text) — zero numerics.
/// Excel: #NUM!. Mog: Null (no numeric values to average).
#[test]
fn mixed_types_average_all_text_produces_null() {
    let data = mixed_type_amount_data();
    let config = mixed_type_avg_config();
    let result = compute(&config, &data, Some(&expand_all()));

    let rent = find_row_by_key(&result.rows, "Rent").expect("should find Rent row");

    assert_eq!(
        rent.values[0],
        CellValue::Null,
        "Rent average (all text → Null)"
    );
}

/// Known discrepancy: grand total averages only numeric values across all groups.
/// Excel: #NUM! (because some records have text). Mog: avg of all numerics = 0.0.
#[test]
fn mixed_types_average_grand_total_skips_text() {
    let data = mixed_type_amount_data();
    let config = mixed_type_avg_config();
    let result = compute(&config, &data, Some(&expand_all()));

    let row_totals = result
        .grand_totals
        .row
        .as_ref()
        .expect("should have grand totals");
    // avg(-50, -30, -20, -100, 200) = 0.0
    assert_approx(&row_totals[0], 0.0, "Grand total average (numerics only)");
}

/// Known discrepancy: SUM also skips text values instead of producing #NUM!.
#[test]
fn mixed_types_sum_skips_text_values() {
    let data = mixed_type_amount_data();
    let fields = mixed_type_fields();
    let placements = vec![
        make_placement("category", PivotFieldArea::Row, 0, None),
        make_placement(
            "amount",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let mut config = make_base_config(fields, placements, vec![]);
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(false),
        layout_form: Some(LayoutForm::Tabular),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));

    let groceries = find_row_by_key(&result.rows, "Groceries").expect("should find Groceries row");
    assert_approx(&groceries.values[0], -100.0, "Groceries sum (all numeric)");

    // Excel: #NUM!. Mog: sum(-100, 200) = 100.0
    let banking = find_row_by_key(&result.rows, "Banking").expect("should find Banking row");
    assert_approx(
        &banking.values[0],
        100.0,
        "Banking sum (numerics only, text skipped)",
    );
}

// ============================================================================
// Aggregation: COUNT (numeric only) vs COUNTA (non-blank, all types)
// ============================================================================
//
// The wire-format `AggregateFunction` enum keeps the engine-neutral split
// between `Count` (Excel COUNT — numeric only) and `CountA` (Excel COUNTA
// — non-blank including text). This makes the contract crisp at the
// bridge: enum values map 1:1 to engine semantics; the user-facing TS
// `PivotAggregation` vocabulary handles the Excel UI conventions
// (where Count = COUNTA) without any reverse-mapping table on the wire.

#[test]
fn aggregate_count_vs_counta_distinct_semantics() {
    // OrderId column has 4 numbers, 1 text, 1 blank.
    //   COUNTA (non-blank) => 5
    //   COUNT  (numeric)   => 4
    let fields = vec![
        PivotField {
            id: FieldId::from("col0"),
            name: "Region".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("col1"),
            name: "OrderId".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    let data = vec![
        vec![cv_text("Region"), cv_text("OrderId")],
        vec![cv_text("North"), cv_num(1.0)],
        vec![cv_text("North"), cv_num(2.0)],
        vec![cv_text("North"), cv_text("A3")],
        vec![cv_text("South"), cv_num(4.0)],
        vec![cv_text("South"), cv_num(5.0)],
        vec![cv_text("North"), CellValue::Null],
    ];

    // COUNTA — counts all 5 non-blank cells (4 numbers + 1 text).
    let placements_a = vec![
        make_placement("col0", PivotFieldArea::Row, 0, None),
        make_placement(
            "col1",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::CountA),
        ),
    ];
    let config_a = make_base_config(fields.clone(), placements_a, vec![]);
    let result_a = compute(&config_a, &data, Some(&expand_all()));
    let gt_a = result_a.grand_totals.row.as_ref().expect("counta gt");
    assert_eq!(gt_a[0], cv_num(5.0), "COUNTA grand total = 5 (non-blank)");

    // COUNT — counts only the 4 numeric cells.
    let placements_c = vec![
        make_placement("col0", PivotFieldArea::Row, 0, None),
        make_placement(
            "col1",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Count),
        ),
    ];
    let config_c = make_base_config(fields, placements_c, vec![]);
    let result_c = compute(&config_c, &data, Some(&expand_all()));
    let gt_c = result_c.grand_totals.row.as_ref().expect("count gt");
    assert_eq!(gt_c[0], cv_num(4.0), "COUNT grand total = 4 (numbers only)");
}
