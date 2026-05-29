//! Basic pivot engine tests that have not yet moved into focused test modules.

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

// ---- sortByValue tests ----

// ---- I6: Additional validations ----

// ---- validate_and_resolve tests ----

// ---- compute_resolved tests ----

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

// ---- B4j: Negative numbers in aggregation (StdDev, Product) ----

// ---- Sensitivity tests ----

// ---- FIX 2a-2d: Validation tests ----

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
        data_on_rows: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_header_row: None,
        first_data_col: None,
        rows_per_page: None,
        cols_per_page: None,
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
