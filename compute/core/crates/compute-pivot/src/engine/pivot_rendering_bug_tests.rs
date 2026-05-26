//! Tests reproducing pivot rendering bugs found in file Y0c9pyTq.
//!
//! These tests exercise the compute engine's output structure for scenarios
//! that cause rendering mismatches when laid out on a spreadsheet grid.
//!
//! Bug 1: When all row items are filtered out, `result.rows` is empty, so
//!         renderers compute `row_header_cols = 0`. But row fields still exist,
//!         meaning column headers get shifted left by the number of row fields.
//!
//! Bug 2: The "Values" label placement in the column header area doesn't account
//!         for the row_header_cols correctly, and doesn't respect gridDropZones.
//!
//! Bug 3: Grand total label is hardcoded as "Grand Total" instead of using a
//!         configurable `grand_total_caption` from the PivotTableConfig.
//!
//! Tests marked with `#[ignore]` are expected to fail until the bugs are fixed.
//! Run with `cargo test -p compute-pivot pivot_rendering_bug -- --ignored` to see failures.

use std::collections::HashMap;

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

// ========================================================================
// Rendering simulation helper
// ========================================================================

/// Simulate the pivot_render logic inline to produce a cell grid.
/// This duplicates the renderer's layout algorithm so we can test it within
/// the compute-pivot crate without depending on formula-eval.
fn simulate_render(
    result: &PivotTableResult,
    config: &PivotTableConfig,
    anchor_row: u32,
    anchor_col: u32,
    first_data_row_hint: u32,
) -> HashMap<(u32, u32), CellValue> {
    let mut cells = HashMap::new();

    let layout_form = config
        .layout
        .as_ref()
        .and_then(|l| l.layout_form.clone())
        .unwrap_or(LayoutForm::Compact);

    // FIX: Use the engine's rendered_bounds instead of deriving from result.rows
    let row_header_cols = result.rendered_bounds.first_data_col;

    let engine_header_rows = result.column_headers.len() as u32;
    let xlsx_header_rows = first_data_row_hint;
    let extra_label_rows = xlsx_header_rows.saturating_sub(engine_header_rows);

    // BUG 2 LOCATION: "Values" label placement
    if extra_label_rows > 0 {
        let column_placements = config.column_placements();
        if column_placements.is_empty() && !result.column_headers.is_empty() {
            cells.insert(
                (anchor_row, anchor_col + row_header_cols),
                CellValue::Text("Values".into()),
            );
        }

        // Row field name labels
        let label_row = anchor_row + extra_label_rows + engine_header_rows.saturating_sub(1);
        let row_placements = config.row_placements();
        match layout_form {
            LayoutForm::Compact => {
                if !row_placements.is_empty() {
                    cells.insert(
                        (label_row, anchor_col),
                        CellValue::Text("Row Labels".into()),
                    );
                }
            }
            _ => {
                for (i, rp) in row_placements.iter().enumerate() {
                    let name = config
                        .get_field(rp.field_id().as_str())
                        .map(|f| f.name.clone())
                        .unwrap_or_default();
                    if !name.is_empty() {
                        cells.insert(
                            (label_row, anchor_col + i as u32),
                            CellValue::Text(name.into()),
                        );
                    }
                }
            }
        }
    }

    // Column header values
    for (level_idx, col_header) in result.column_headers.iter().enumerate() {
        let row = anchor_row + extra_label_rows + level_idx as u32;
        let mut col_offset = 0u32;
        for header in &col_header.headers {
            let col = anchor_col + row_header_cols + col_offset;
            cells.insert((row, col), header.value.clone());
            col_offset += header.span as u32;
        }
    }

    // Grand total row
    let num_col_header_rows = xlsx_header_rows;
    if let Some(ref row_totals) = result.grand_totals.row {
        let row = anchor_row + num_col_header_rows + result.rows.len() as u32;
        // FIX: Use row_label from the engine result
        let gt_label = result
            .grand_totals
            .row_label
            .as_deref()
            .unwrap_or("Grand Total");
        cells.insert((row, anchor_col), CellValue::Text(gt_label.into()));
        for (v_idx, value) in row_totals.iter().enumerate() {
            let col = anchor_col + row_header_cols + v_idx as u32;
            if *value != CellValue::Null {
                cells.insert((row, col), value.clone());
            }
        }
    }

    cells
}

// ========================================================================
// Bug 1: row_header_cols is 0 when all items are filtered out
// ========================================================================

/// Reproduces Bug 1: column headers are shifted left because row_header_cols=0
/// when all items are filtered.
///
/// This test SHOULD FAIL because the rendering logic produces incorrect cell
/// positions when result.rows is empty but row fields exist.
#[test]
fn bug1_column_headers_shifted_when_all_items_filtered() {
    let data = vec![
        vec![cv_text("Category"), cv_text("Year"), cv_text("Value")],
        vec![cv_text("A"), cv_text("2024"), cv_num(100.0)],
        vec![cv_text("A"), cv_text("2025"), cv_num(200.0)],
        vec![cv_text("B"), cv_text("2024"), cv_num(300.0)],
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
            id: FieldId::from("year"),
            name: "Year".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("value"),
            name: "Value".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let placements = vec![
        make_placement("year", PivotFieldArea::Row, 0, None),
        make_placement("category", PivotFieldArea::Filter, 0, None),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("value"),
                placement_id: crate::types::PlacementId::default(),
                position: 0,
                display_name: Some("Number of tenants".to_string()),
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: AggregateFunction::Count,
            number_format: None,
            show_values_as: None,
        }),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("value"),
                placement_id: crate::types::PlacementId::default(),
                position: 1,
                display_name: Some("Total SF Expiring".to_string()),
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
                field_id: FieldId::from("value"),
                placement_id: crate::types::PlacementId::default(),
                position: 2,
                display_name: Some("Sum of SF % Share".to_string()),
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: AggregateFunction::Sum,
            number_format: None,
            show_values_as: None,
        }),
    ];

    // Filter that excludes ALL rows
    let filters = vec![PivotFilter {
        field_id: FieldId::from("category"),
        include_values: Some(vec![cv_text("Nonexistent")]),
        exclude_values: None,
        condition: None,
        top_bottom: None,
        show_items_with_no_data: None,
    }];

    let mut config = make_base_config(fields, placements, filters);
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: None,
        layout_form: Some(LayoutForm::Outline),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.rows.is_empty(), "Precondition: all rows filtered");

    // Simulate rendering: anchor at (6, 0), firstDataRow=2 (matching Y0c9pyTq)
    let cells = simulate_render(&result, &config, 6, 0, 2);

    // Expected layout (matching Excel for Y0c9pyTq):
    //   Row 6: (6,0)=null  (6,1)="Values" label (or null for gridDropZones)
    //   Row 7: (7,0)="Year"  (7,1)="Number of tenants"  (7,2)="Total SF..."  (7,3)="Sum of..."
    //   Row 8: (8,0)="Totals"  (8,1)=value  (8,2)=value  (8,3)=value

    // ASSERT: column header "Number of tenants" should be at (7, 1), not (7, 0)
    // This assertion FAILS because row_header_cols=0 puts it at (7, 0) instead.
    let first_value_header = cells.get(&(7, 1));
    assert_eq!(
        first_value_header,
        Some(&CellValue::Text("Number of tenants".into())),
        "First value header should be at column 1 (after row header column), \
         but Bug 1 puts it at column 0. Got at (7,1): {:?}, at (7,0): {:?}",
        cells.get(&(7, 1)),
        cells.get(&(7, 0))
    );

    // ASSERT: Row field name "Year" should appear at (7, 0)
    let row_field_label = cells.get(&(7, 0));
    assert_eq!(
        row_field_label,
        Some(&CellValue::Text("Year".into())),
        "Row field name 'Year' should be at (7, 0), got {:?}",
        row_field_label
    );
}

/// Control test: when rows exist, the rendering produces correct layout.
#[test]
fn bug1_control_rendering_correct_with_data_rows() {
    let data = sample_sales_data();
    let mut config = build_spreadjs_config(
        "bug1_control",
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
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: None,
        layout_form: Some(LayoutForm::Outline),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));

    // row_header_cols should be 1 (from max(row.headers.len()))
    let max_headers = result
        .rows
        .iter()
        .map(|r| r.headers.len())
        .max()
        .unwrap_or(0);
    assert_eq!(
        max_headers, 1,
        "Control: row headers present when data exists"
    );

    // Rendering should put value headers at column 1+
    let cells = simulate_render(&result, &config, 0, 0, 1);
    // First value header at (0, 1)
    let first_header = cells.get(&(0, 1));
    assert!(
        first_header.is_some(),
        "Control: first value header should be at column 1, got cells: {:?}",
        cells.keys().filter(|k| k.0 == 0).collect::<Vec<_>>()
    );
}

// ========================================================================
// Bug 2: "Values" label at wrong position
// ========================================================================

/// The "Values" label is placed at (anchor_row, anchor_col + row_header_cols).
/// When row_header_cols=0 (Bug 1), it goes at the origin cell instead of offset.
/// Additionally, with gridDropZones=1, Excel omits this label entirely.
#[test]
fn bug2_values_label_at_wrong_position() {
    let data = vec![
        vec![cv_text("Year"), cv_text("Value")],
        vec![cv_text("2024"), cv_num(100.0)],
        vec![cv_text("2025"), cv_num(200.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("year"),
            name: "Year".to_string(),
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

    let placements = vec![
        make_placement("year", PivotFieldArea::Row, 0, None),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("value"),
                placement_id: crate::types::PlacementId::default(),
                position: 0,
                display_name: Some("Count of Value".to_string()),
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: AggregateFunction::Count,
            number_format: None,
            show_values_as: None,
        }),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("value"),
                placement_id: crate::types::PlacementId::default(),
                position: 1,
                display_name: Some("Sum of Value".to_string()),
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: AggregateFunction::Sum,
            number_format: None,
            show_values_as: None,
        }),
    ];

    // Filter out everything
    let filters = vec![PivotFilter {
        field_id: FieldId::from("year"),
        include_values: Some(vec![cv_text("Nonexistent")]),
        exclude_values: None,
        condition: None,
        top_bottom: None,
        show_items_with_no_data: None,
    }];

    let mut config = make_base_config(fields, placements, filters);
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: None,
        layout_form: Some(LayoutForm::Outline),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    let cells = simulate_render(&result, &config, 6, 0, 2);

    // In Y0c9pyTq with gridDropZones=1, the origin cell (6, 0) should be null.
    // Currently the renderer puts "Values" there because row_header_cols=0.
    //
    // Expected: (6, 0) = null (for gridDropZones), or (6, 1) = "Values" label
    // Actual:   (6, 0) = "Values"
    let origin_cell = cells.get(&(6, 0));
    assert_ne!(
        origin_cell,
        Some(&CellValue::Text("Values".into())),
        "Origin cell (6,0) should NOT contain 'Values' label — \
         it should be null (gridDropZones) or the label should be at (6,1). \
         Got: {:?}",
        origin_cell
    );
}

// ========================================================================
// Bug 3: Grand total caption is not configurable
// ========================================================================

/// The renderer hardcodes "Grand Total" as the label. OOXML allows customizing
/// this via `grandTotalCaption` attribute.
///
/// This test fails because PivotTableLayout has no `grand_total_caption` field,
/// and the renderer can't use a custom label.
#[test]
fn bug3_grand_total_caption_not_customizable() {
    let data = sample_sales_data();
    let mut config = build_spreadjs_config(
        "bug3_caption",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![],
        &data,
    );
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: None,
        layout_form: Some(LayoutForm::Outline),
        grand_total_caption: Some("Totals".to_string()),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    let cells = simulate_render(&result, &config, 0, 0, 1);

    // Find the grand total label cell (last row, column 0)
    let gt_row = result.rows.len() as u32 + 1; // +1 for header row
    let gt_label = cells.get(&(gt_row, 0));

    // With grand_total_caption set to "Totals", the renderer should use it.
    assert_eq!(
        gt_label,
        Some(&CellValue::Text("Totals".into())),
        "Grand total label should be 'Totals' (from grand_total_caption), got {:?}",
        gt_label
    );
}

// ========================================================================
// Supporting tests that pass (control cases)
// ========================================================================

/// Verify that multiple value fields with no column fields produce correct
/// column headers in the compute result.
#[test]
fn values_in_columns_produces_correct_column_headers() {
    let data = vec![
        vec![cv_text("Year"), cv_text("Tenants"), cv_text("SF")],
        vec![cv_text("2024"), cv_num(5.0), cv_num(10000.0)],
        vec![cv_text("2025"), cv_num(8.0), cv_num(15000.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("year"),
            name: "Year".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("tenants"),
            name: "Tenants".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sf"),
            name: "SF".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let placements = vec![
        make_placement("year", PivotFieldArea::Row, 0, None),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("tenants"),
                placement_id: crate::types::PlacementId::default(),
                position: 0,
                display_name: Some("Number of tenants".to_string()),
            },
            source: crate::types::PivotValueSource::Field {
                field_id: crate::types::FieldId::default(),
            },
            aggregate_function: AggregateFunction::Count,
            number_format: None,
            show_values_as: None,
        }),
        PivotFieldPlacement::Value(ValuePlacement {
            base: PlacementBase {
                field_id: FieldId::from("sf"),
                placement_id: crate::types::PlacementId::default(),
                position: 1,
                display_name: Some("Total SF Expiring".to_string()),
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
    let result = compute(&config, &data, Some(&expand_all()));

    assert_eq!(result.column_headers.len(), 1);
    let names: Vec<String> = result.column_headers[0]
        .headers
        .iter()
        .map(|h| match &h.value {
            CellValue::Text(s) => s.to_string(),
            other => format!("{:?}", other),
        })
        .collect();

    assert_eq!(names, vec!["Number of tenants", "Total SF Expiring"],);
}

/// Verifies that rendered_bounds.first_data_col correctly reflects row field count
/// even when all rows are filtered out (previously this info was lost).
#[test]
fn rendered_bounds_correct_with_empty_rows() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "metadata_check",
        &spreadjs_sales_fields(),
        &["Region", "Product"],
        &[],
        &[("Sales", AggregateFunction::Sum)],
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: Some(vec![cv_text("Nonexistent")]),
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: None,
        }],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.rows.is_empty());

    // Old approach would give 0 — but rendered_bounds has the correct answer
    assert_eq!(
        result.rendered_bounds.first_data_col, 1,
        "rendered_bounds.first_data_col should be 1 for compact layout with row fields \
         (compact collapses multiple row fields into 1 column)"
    );
}
