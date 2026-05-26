use super::*;
use crate::hierarchy::{GroupHierarchy, build_group_hierarchy};
use crate::types::{
    FieldId, PivotHeader, PivotRenderedBounds, RelativePosition, ShowValuesAsBaseItem,
};

// ===================================================================
// Test Helpers
// ===================================================================

/// Create a PivotHeader for testing.
fn make_header(key: &str, value: CellValue, field_id: &str, depth: usize) -> PivotHeader {
    PivotHeader {
        key: key.to_string(),
        value,
        field_id: FieldId::from(field_id),
        depth,
        span: 1,
        is_expandable: false,
        is_expanded: true,
        is_subtotal: false,
        is_grand_total: false,
        parent_key: None,
        child_keys: None,
    }
}

/// Create a data row.
fn make_data_row(key: &str, headers: Vec<PivotHeader>, values: Vec<CellValue>) -> PivotRow {
    let depth = headers.last().map_or(0, |h| h.depth);
    PivotRow {
        key: key.to_string(),
        headers,
        values,
        depth,
        is_subtotal: false,
        is_grand_total: false,
        source_row_indices: None,
    }
}

/// Create a subtotal row.
fn make_subtotal_row(
    key: &str,
    headers: Vec<PivotHeader>,
    depth: usize,
    values: Vec<CellValue>,
) -> PivotRow {
    PivotRow {
        key: key.to_string(),
        headers,
        values,
        depth,
        is_subtotal: true,
        is_grand_total: false,
        source_row_indices: None,
    }
}

/// Create a grand total row.
fn make_grand_total_row(values: Vec<CellValue>) -> PivotRow {
    PivotRow {
        key: "__grand_total__".to_string(),
        headers: vec![],
        values,
        depth: 0,
        is_subtotal: false,
        is_grand_total: true,
        source_row_indices: None,
    }
}

/// Shorthand to create PivotGrandTotals.
fn make_grand_totals(row: Option<Vec<CellValue>>) -> PivotGrandTotals {
    PivotGrandTotals {
        grand: row.clone(),
        row,
        column: None,
        row_label: None,
    }
}

/// Helper to extract a number from CellValue.
fn num(v: &CellValue) -> f64 {
    match v {
        CellValue::Number(n) => n.get(),
        other => panic!("Expected Number, got {:?}", other),
    }
}

/// Helper to check that a CellValue is Null.
fn is_null(v: &CellValue) -> bool {
    matches!(v, CellValue::Null)
}

/// Assert approximate floating-point equality.
fn assert_approx(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() < tolerance,
        "Expected {} to be approximately {} (tolerance {})",
        actual,
        expected,
        tolerance
    );
}

// ---- Standard 2-level test data (Region > Product) ----

/// Build a 2-level hierarchy: Region > Product
///
/// Structure:
///   Row 0: East / Widget  = 100
///   Row 1: East / Gadget  = 200
///   Row 2: East subtotal  = 300
///   Row 3: West / Widget  = 150
///   Row 4: West / Gadget  = 250
///   Row 5: West subtotal  = 400
///   Row 6: Grand total    = 700
fn make_two_level_test_data() -> (Vec<PivotRow>, GroupHierarchy, PivotGrandTotals) {
    let field_names = vec!["Region".to_string(), "Product".to_string()];

    let rows = vec![
        make_data_row(
            "east\x00widget",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header(
                    "east\x00widget",
                    CellValue::Text("Widget".into()),
                    "Product",
                    1,
                ),
            ],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "east\x00gadget",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header(
                    "east\x00gadget",
                    CellValue::Text("Gadget".into()),
                    "Product",
                    1,
                ),
            ],
            vec![CellValue::number(200.0)],
        ),
        make_subtotal_row(
            "east__SUBTOTAL__",
            vec![make_header(
                "east",
                CellValue::Text("East Total".into()),
                "Region",
                0,
            )],
            0,
            vec![CellValue::number(300.0)],
        ),
        make_data_row(
            "west\x00widget",
            vec![
                make_header("west", CellValue::Text("West".into()), "Region", 0),
                make_header(
                    "west\x00widget",
                    CellValue::Text("Widget".into()),
                    "Product",
                    1,
                ),
            ],
            vec![CellValue::number(150.0)],
        ),
        make_data_row(
            "west\x00gadget",
            vec![
                make_header("west", CellValue::Text("West".into()), "Region", 0),
                make_header(
                    "west\x00gadget",
                    CellValue::Text("Gadget".into()),
                    "Product",
                    1,
                ),
            ],
            vec![CellValue::number(250.0)],
        ),
        make_subtotal_row(
            "west__SUBTOTAL__",
            vec![make_header(
                "west",
                CellValue::Text("West Total".into()),
                "Region",
                0,
            )],
            0,
            vec![CellValue::number(400.0)],
        ),
        make_grand_total_row(vec![CellValue::number(700.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(700.0)]));

    (rows, hierarchy, grand_totals)
}

/// Build a flat (single-level) test data set.
///
/// Structure:
///   Row 0: Q1 = 100
///   Row 1: Q2 = 150
///   Row 2: Q3 = 200
///   Row 3: Q4 = 50
///   Row 4: Grand total = 500
fn make_flat_test_data() -> (Vec<PivotRow>, GroupHierarchy, PivotGrandTotals) {
    let field_names = vec!["Quarter".to_string()];

    let rows = vec![
        make_data_row(
            "q1",
            vec![make_header(
                "q1",
                CellValue::Text("Q1".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "q2",
            vec![make_header(
                "q2",
                CellValue::Text("Q2".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(150.0)],
        ),
        make_data_row(
            "q3",
            vec![make_header(
                "q3",
                CellValue::Text("Q3".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(200.0)],
        ),
        make_data_row(
            "q4",
            vec![make_header(
                "q4",
                CellValue::Text("Q4".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(50.0)],
        ),
        make_grand_total_row(vec![CellValue::number(500.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(500.0)]));

    (rows, hierarchy, grand_totals)
}

// ===================================================================
// Flat Pivot Tests (backward compatibility)
// ===================================================================

#[test]
fn test_percent_of_grand_total_flat() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();
    // Total = 500
    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfGrandTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Q1: 100/500 = 0.2
    assert_approx(num(&rows[0].values[0]), 0.2, 1e-10);
    // Q2: 150/500 = 0.3
    assert_approx(num(&rows[1].values[0]), 0.3, 1e-10);
    // Q3: 200/500 = 0.4
    assert_approx(num(&rows[2].values[0]), 0.4, 1e-10);
    // Q4: 50/500 = 0.1
    assert_approx(num(&rows[3].values[0]), 0.1, 1e-10);
}

#[test]
fn test_percent_of_grand_total_whole_result_no_column_pivot() {
    let (rows, hierarchy, grand_totals) = make_flat_test_data();
    let mut result = PivotTableResult {
        column_headers: vec![],
        rows,
        grand_totals,
        source_row_count: 4,
        rendered_bounds: PivotRenderedBounds {
            total_rows: 6,
            total_cols: 2,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 1,
        },
        measure_descriptors: Vec::new(),
        value_records: Vec::new(),
        errors: None,
    };

    apply_show_values_as_to_result(
        &mut result,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfGrandTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &hierarchy,
    );

    assert_approx(num(&result.rows[0].values[0]), 0.2, 1e-10);
    assert_approx(num(&result.rows[1].values[0]), 0.3, 1e-10);
    assert_eq!(
        result.grand_totals.row.as_ref().map(|row| num(&row[0])),
        Some(1.0)
    );
    assert_eq!(
        result
            .grand_totals
            .grand
            .as_ref()
            .map(|grand| num(&grand[0])),
        Some(1.0)
    );
}

#[test]
fn test_percent_of_grand_total_whole_result_row_and_column_totals() {
    let field_names = vec!["Region".to_string()];
    let rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(10.0), CellValue::number(30.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(20.0), CellValue::number(40.0)],
        ),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let mut result = PivotTableResult {
        column_headers: vec![],
        rows,
        grand_totals: PivotGrandTotals {
            row: Some(vec![CellValue::number(30.0), CellValue::number(70.0)]),
            column: Some(vec![
                vec![CellValue::number(40.0)],
                vec![CellValue::number(60.0)],
            ]),
            grand: Some(vec![CellValue::number(100.0)]),
            row_label: None,
        },
        source_row_count: 2,
        rendered_bounds: PivotRenderedBounds {
            total_rows: 4,
            total_cols: 4,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 2,
        },
        measure_descriptors: Vec::new(),
        value_records: Vec::new(),
        errors: None,
    };

    apply_show_values_as_to_result(
        &mut result,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfGrandTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &hierarchy,
    );

    assert_approx(num(&result.rows[0].values[0]), 0.1, 1e-10);
    assert_approx(num(&result.rows[0].values[1]), 0.3, 1e-10);
    assert_approx(num(&result.rows[1].values[0]), 0.2, 1e-10);
    assert_approx(num(&result.rows[1].values[1]), 0.4, 1e-10);
    let row = result.grand_totals.row.as_ref().expect("row grand totals");
    assert_approx(num(&row[0]), 0.3, 1e-10);
    assert_approx(num(&row[1]), 0.7, 1e-10);
    let column = result
        .grand_totals
        .column
        .as_ref()
        .expect("column grand totals");
    assert_approx(num(&column[0][0]), 0.4, 1e-10);
    assert_approx(num(&column[1][0]), 0.6, 1e-10);
    assert_eq!(
        result
            .grand_totals
            .grand
            .as_ref()
            .map(|grand| num(&grand[0])),
        Some(1.0)
    );
}

#[test]
fn test_percent_of_grand_total_zero() {
    let field_names = vec!["Item".to_string()];
    let mut rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::number(0.0)],
        ),
        make_grand_total_row(vec![CellValue::number(0.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(0.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfGrandTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // All should be Null (division by zero grand total)
    assert!(is_null(&rows[0].values[0]));
}

#[test]
fn test_running_total_flat() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_eq!(num(&rows[0].values[0]), 100.0);
    assert_eq!(num(&rows[1].values[0]), 250.0);
    assert_eq!(num(&rows[2].values[0]), 450.0);
    assert_eq!(num(&rows[3].values[0]), 500.0);
}

#[test]
fn test_percent_running_total_flat() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentRunningTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // 100/500 = 0.2, 250/500 = 0.5, 450/500 = 0.9, 500/500 = 1.0
    assert_approx(num(&rows[0].values[0]), 0.2, 1e-10);
    assert_approx(num(&rows[1].values[0]), 0.5, 1e-10);
    assert_approx(num(&rows[2].values[0]), 0.9, 1e-10);
    assert_approx(num(&rows[3].values[0]), 1.0, 1e-10);
}

#[test]
fn test_difference_previous_flat() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert!(is_null(&rows[0].values[0])); // No previous
    assert_eq!(num(&rows[1].values[0]), 50.0); // 150 - 100
    assert_eq!(num(&rows[2].values[0]), 50.0); // 200 - 150
    assert_eq!(num(&rows[3].values[0]), -150.0); // 50 - 200
}

#[test]
fn test_difference_next_flat() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Next,
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_eq!(num(&rows[0].values[0]), -50.0); // 100 - 150
    assert_eq!(num(&rows[1].values[0]), -50.0); // 150 - 200
    assert_eq!(num(&rows[2].values[0]), 150.0); // 200 - 50
    assert!(is_null(&rows[3].values[0])); // No next
}

#[test]
fn test_percent_difference_previous_flat() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentDifference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert!(is_null(&rows[0].values[0])); // No previous
    assert_approx(num(&rows[1].values[0]), 0.5, 1e-10); // (150-100)/100
    // (200-150)/150 = 0.333...
    assert_approx(num(&rows[2].values[0]), 1.0 / 3.0, 1e-10);
}

#[test]
fn test_percent_difference_zero_base() {
    let field_names = vec!["Item".to_string()];
    let mut rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::number(0.0)],
        ),
        make_data_row(
            "b",
            vec![make_header("b", CellValue::Text("B".into()), "Item", 0)],
            vec![CellValue::number(100.0)],
        ),
        make_grand_total_row(vec![CellValue::number(100.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(100.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentDifference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Division by zero -> Null
    assert!(is_null(&rows[1].values[0]));
}

#[test]
fn test_rank_ascending_flat() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();
    // Values: 100, 150, 200, 50

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankAscending,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Ascending: 50=1, 100=2, 150=3, 200=4
    assert_eq!(num(&rows[0].values[0]), 2.0); // 100 -> rank 2
    assert_eq!(num(&rows[1].values[0]), 3.0); // 150 -> rank 3
    assert_eq!(num(&rows[2].values[0]), 4.0); // 200 -> rank 4
    assert_eq!(num(&rows[3].values[0]), 1.0); // 50 -> rank 1
}

#[test]
fn test_rank_descending_flat() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankDescending,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Descending: 200=1, 150=2, 100=3, 50=4
    assert_eq!(num(&rows[0].values[0]), 3.0); // 100 -> rank 3
    assert_eq!(num(&rows[1].values[0]), 2.0); // 150 -> rank 2
    assert_eq!(num(&rows[2].values[0]), 1.0); // 200 -> rank 1
    assert_eq!(num(&rows[3].values[0]), 4.0); // 50 -> rank 4
}

#[test]
fn test_rank_ascending_with_ties() {
    let field_names = vec!["Item".to_string()];
    let mut rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "b",
            vec![make_header("b", CellValue::Text("B".into()), "Item", 0)],
            vec![CellValue::number(200.0)],
        ),
        make_data_row(
            "c",
            vec![make_header("c", CellValue::Text("C".into()), "Item", 0)],
            vec![CellValue::number(100.0)],
        ),
        make_grand_total_row(vec![CellValue::number(400.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(400.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankAscending,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Both 100s should be rank 1, 200 should be rank 3 (competition ranking)
    assert_eq!(num(&rows[0].values[0]), 1.0);
    assert_eq!(num(&rows[2].values[0]), 1.0);
    assert_eq!(num(&rows[1].values[0]), 3.0);
}

#[test]
fn test_index_flat() {
    // 2 columns, 1 value field.
    // Row 1: [40, 60], row total = 100
    // Row 2: [60, 40], row total = 100
    // Col totals: [100, 100], Grand total: 200
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(40.0), CellValue::number(60.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(60.0), CellValue::number(40.0)],
        ),
        make_grand_total_row(vec![CellValue::number(200.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(200.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Index,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Index = (Value * GT) / (RT * CT)
    // east/col0: (40 * 200) / (100 * 100) = 0.8
    assert_approx(num(&rows[0].values[0]), 0.8, 1e-10);
    // east/col1: (60 * 200) / (100 * 100) = 1.2
    assert_approx(num(&rows[0].values[1]), 1.2, 1e-10);
    // west/col0: (60 * 200) / (100 * 100) = 1.2
    assert_approx(num(&rows[1].values[0]), 1.2, 1e-10);
    // west/col1: (40 * 200) / (100 * 100) = 0.8
    assert_approx(num(&rows[1].values[1]), 0.8, 1e-10);
}

#[test]
fn test_percent_of_row_total_flat() {
    // 2 columns, 1 value field
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(40.0), CellValue::number(60.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(75.0), CellValue::number(25.0)],
        ),
        make_grand_total_row(vec![CellValue::number(200.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(200.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfRowTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_approx(num(&rows[0].values[0]), 0.4, 1e-10);
    assert_approx(num(&rows[0].values[1]), 0.6, 1e-10);
    assert_approx(num(&rows[1].values[0]), 0.75, 1e-10);
    assert_approx(num(&rows[1].values[1]), 0.25, 1e-10);
}

#[test]
fn test_percent_of_column_total_flat() {
    // 2 columns, 1 value field
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(40.0), CellValue::number(30.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(60.0), CellValue::number(70.0)],
        ),
        make_grand_total_row(vec![CellValue::number(200.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(200.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfColumnTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Col 0: 40/(40+60)=0.4, 60/(40+60)=0.6
    assert_approx(num(&rows[0].values[0]), 0.4, 1e-10);
    assert_approx(num(&rows[1].values[0]), 0.6, 1e-10);
    // Col 1: 30/(30+70)=0.3, 70/(30+70)=0.7
    assert_approx(num(&rows[0].values[1]), 0.3, 1e-10);
    assert_approx(num(&rows[1].values[1]), 0.7, 1e-10);
}

#[test]
fn test_no_calculation_noop() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();
    let original_val = rows[0].values[0].clone();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::NoCalculation,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_eq!(rows[0].values[0], original_val);
}

#[test]
fn test_empty_configs_noop() {
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();
    let original_val = rows[0].values[0].clone();

    apply_show_values_as_with_hierarchy(&mut rows, &[], &grand_totals, &hierarchy);

    assert_eq!(rows[0].values[0], original_val);
}

// ===================================================================
// Hierarchical Pivot Tests (THE CORE BUG FIXES)
// ===================================================================

#[test]
fn test_running_total_resets_at_region_boundary() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();
    // East: Widget=100, Gadget=200
    // West: Widget=150, Gadget=250

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: None, // defaults to innermost = Product level
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Within East group: 100, 100+200=300
    assert_eq!(num(&rows[0].values[0]), 100.0);
    assert_eq!(num(&rows[1].values[0]), 300.0);
    // Within West group: RESET! 150, 150+250=400
    assert_eq!(num(&rows[3].values[0]), 150.0);
    assert_eq!(num(&rows[4].values[0]), 400.0);
}

#[test]
fn test_running_total_global_with_base_field_region() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: Some(FieldId::from("Region")),
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // At depth 0 (Region level), all rows are in one group (root).
    // Running total across all data rows: 100, 300, 450, 700
    assert_eq!(num(&rows[0].values[0]), 100.0);
    assert_eq!(num(&rows[1].values[0]), 300.0);
    assert_eq!(num(&rows[3].values[0]), 450.0);
    assert_eq!(num(&rows[4].values[0]), 700.0);
}

#[test]
fn test_percent_running_total_resets_at_group_boundary() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentRunningTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Grand total = 700
    // East group running: 100, 300 -> 100/700, 300/700
    assert_approx(num(&rows[0].values[0]), 1.0 / 7.0, 1e-10);
    assert_approx(num(&rows[1].values[0]), 3.0 / 7.0, 1e-10);
    // West group running: RESET! 150, 400 -> 150/700, 400/700
    assert_approx(num(&rows[3].values[0]), 1.5 / 7.0, 1e-10);
    assert_approx(num(&rows[4].values[0]), 4.0 / 7.0, 1e-10);
}

#[test]
fn test_rank_scoped_within_each_region() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();
    // East: Widget=100, Gadget=200
    // West: Widget=150, Gadget=250

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankDescending,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Within East: Gadget(200)=1, Widget(100)=2
    assert_eq!(num(&rows[0].values[0]), 2.0); // East/Widget
    assert_eq!(num(&rows[1].values[0]), 1.0); // East/Gadget
    // Within West: Gadget(250)=1, Widget(150)=2
    assert_eq!(num(&rows[3].values[0]), 2.0); // West/Widget
    assert_eq!(num(&rows[4].values[0]), 1.0); // West/Gadget
}

#[test]
fn test_rank_global_with_base_field_region() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankDescending,
                base_field: Some(FieldId::from("Region")),
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // At depth 0 (Region), all data rows in one group.
    // Descending: 250=1, 200=2, 150=3, 100=4
    assert_eq!(num(&rows[0].values[0]), 4.0); // East/Widget=100
    assert_eq!(num(&rows[1].values[0]), 2.0); // East/Gadget=200
    assert_eq!(num(&rows[3].values[0]), 3.0); // West/Widget=150
    assert_eq!(num(&rows[4].values[0]), 1.0); // West/Gadget=250
}

#[test]
fn test_difference_previous_does_not_cross_region_boundary() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East/Widget: no previous in East group -> Null
    assert!(is_null(&rows[0].values[0]));
    // East/Gadget: previous is East/Widget -> 200 - 100 = 100
    assert_eq!(num(&rows[1].values[0]), 100.0);
    // West/Widget: no previous in West group -> Null (NOT East/Gadget!)
    assert!(is_null(&rows[3].values[0]));
    // West/Gadget: previous is West/Widget -> 250 - 150 = 100
    assert_eq!(num(&rows[4].values[0]), 100.0);
}

#[test]
fn test_difference_next_does_not_cross_region_boundary() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Next,
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East/Widget: next is East/Gadget -> 100 - 200 = -100
    assert_eq!(num(&rows[0].values[0]), -100.0);
    // East/Gadget: no next in East group -> Null (NOT West/Widget!)
    assert!(is_null(&rows[1].values[0]));
    // West/Widget: next is West/Gadget -> 150 - 250 = -100
    assert_eq!(num(&rows[3].values[0]), -100.0);
    // West/Gadget: no next in West group -> Null
    assert!(is_null(&rows[4].values[0]));
}

#[test]
fn test_difference_specific_scoped_to_parent() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Specific {
                    value: CellValue::Text("Widget".into()),
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East/Widget vs East/Widget: 100 - 100 = 0
    assert_eq!(num(&rows[0].values[0]), 0.0);
    // East/Gadget vs East/Widget: 200 - 100 = 100
    assert_eq!(num(&rows[1].values[0]), 100.0);
    // West/Widget vs West/Widget: 150 - 150 = 0
    assert_eq!(num(&rows[3].values[0]), 0.0);
    // West/Gadget vs West/Widget: 250 - 150 = 100
    assert_eq!(num(&rows[4].values[0]), 100.0);
}

#[test]
fn test_difference_specific_not_found_in_group() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Specific {
                    value: CellValue::Text("Nonexistent".into()),
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // No item named "Nonexistent" -> all Null
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[1].values[0]));
    assert!(is_null(&rows[3].values[0]));
    assert!(is_null(&rows[4].values[0]));
}

#[test]
fn test_percent_of_parent_row_total_uses_hierarchy() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();
    // East subtotal = 300, West subtotal = 400

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East/Widget: 100/300 = 0.333...
    assert_approx(num(&rows[0].values[0]), 1.0 / 3.0, 1e-10);
    // East/Gadget: 200/300 = 0.666...
    assert_approx(num(&rows[1].values[0]), 2.0 / 3.0, 1e-10);
    // West/Widget: 150/400 = 0.375
    assert_approx(num(&rows[3].values[0]), 0.375, 1e-10);
    // West/Gadget: 250/400 = 0.625
    assert_approx(num(&rows[4].values[0]), 0.625, 1e-10);
}

#[test]
fn test_percent_of_parent_row_total_uses_raw_sibling_total_without_subtotals() {
    let field_names = vec!["Region".to_string(), "City".to_string()];
    let mut rows = vec![
        make_data_row(
            "north\x00nyc",
            vec![
                make_header("north", CellValue::Text("North".into()), "Region", 0),
                make_header("north\x00nyc", CellValue::Text("NYC".into()), "City", 1),
            ],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "north\x00boston",
            vec![
                make_header("north", CellValue::Text("North".into()), "Region", 0),
                make_header(
                    "north\x00boston",
                    CellValue::Text("Boston".into()),
                    "City",
                    1,
                ),
            ],
            vec![CellValue::number(150.0)],
        ),
        make_data_row(
            "south\x00miami",
            vec![
                make_header("south", CellValue::Text("South".into()), "Region", 0),
                make_header("south\x00miami", CellValue::Text("Miami".into()), "City", 1),
            ],
            vec![CellValue::number(200.0)],
        ),
        make_data_row(
            "south\x00dallas",
            vec![
                make_header("south", CellValue::Text("South".into()), "Region", 0),
                make_header(
                    "south\x00dallas",
                    CellValue::Text("Dallas".into()),
                    "City",
                    1,
                ),
            ],
            vec![CellValue::number(250.0)],
        ),
        make_grand_total_row(vec![CellValue::number(700.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(700.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_approx(num(&rows[0].values[0]), 0.4, 1e-10);
    assert_approx(num(&rows[1].values[0]), 0.6, 1e-10);
    assert_approx(num(&rows[2].values[0]), 200.0 / 450.0, 1e-10);
    assert_approx(num(&rows[3].values[0]), 250.0 / 450.0, 1e-10);
}

#[test]
fn test_percent_of_parent_column_total_uses_hierarchy() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();
    // East subtotal = 300, West subtotal = 400

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentColumnTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // For single-column data, parent column total = subtotal value for that column
    // East/Widget: 100/300 = 0.333...
    assert_approx(num(&rows[0].values[0]), 1.0 / 3.0, 1e-10);
    // East/Gadget: 200/300 = 0.666...
    assert_approx(num(&rows[1].values[0]), 2.0 / 3.0, 1e-10);
    // West/Widget: 150/400 = 0.375
    assert_approx(num(&rows[3].values[0]), 0.375, 1e-10);
    // West/Gadget: 250/400 = 0.625
    assert_approx(num(&rows[4].values[0]), 0.625, 1e-10);
}

// ===================================================================
// 3-Level Hierarchy Tests (Region > State > City)
// ===================================================================

fn make_three_level_test_data() -> (Vec<PivotRow>, GroupHierarchy, PivotGrandTotals) {
    let field_names = vec![
        "Region".to_string(),
        "State".to_string(),
        "City".to_string(),
    ];

    let rows = vec![
        // Row 0: East / NY / NYC = 500
        make_data_row(
            "east\x00ny\x00nyc",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header("east\x00ny", CellValue::Text("NY".into()), "State", 1),
                make_header(
                    "east\x00ny\x00nyc",
                    CellValue::Text("NYC".into()),
                    "City",
                    2,
                ),
            ],
            vec![CellValue::number(500.0)],
        ),
        // Row 1: East / NY / Buffalo = 100
        make_data_row(
            "east\x00ny\x00buf",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header("east\x00ny", CellValue::Text("NY".into()), "State", 1),
                make_header(
                    "east\x00ny\x00buf",
                    CellValue::Text("Buffalo".into()),
                    "City",
                    2,
                ),
            ],
            vec![CellValue::number(100.0)],
        ),
        // Row 2: East / NY subtotal = 600
        make_subtotal_row(
            "east\x00ny__SUBTOTAL__",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header("east\x00ny", CellValue::Text("NY Total".into()), "State", 1),
            ],
            1,
            vec![CellValue::number(600.0)],
        ),
        // Row 3: East / CT / Hartford = 80
        make_data_row(
            "east\x00ct\x00hart",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header("east\x00ct", CellValue::Text("CT".into()), "State", 1),
                make_header(
                    "east\x00ct\x00hart",
                    CellValue::Text("Hartford".into()),
                    "City",
                    2,
                ),
            ],
            vec![CellValue::number(80.0)],
        ),
        // Row 4: East / CT subtotal = 80
        make_subtotal_row(
            "east\x00ct__SUBTOTAL__",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header("east\x00ct", CellValue::Text("CT Total".into()), "State", 1),
            ],
            1,
            vec![CellValue::number(80.0)],
        ),
        // Row 5: East subtotal = 680
        make_subtotal_row(
            "east__SUBTOTAL__",
            vec![make_header(
                "east",
                CellValue::Text("East Total".into()),
                "Region",
                0,
            )],
            0,
            vec![CellValue::number(680.0)],
        ),
        // Row 6: West / CA / LA = 400
        make_data_row(
            "west\x00ca\x00la",
            vec![
                make_header("west", CellValue::Text("West".into()), "Region", 0),
                make_header("west\x00ca", CellValue::Text("CA".into()), "State", 1),
                make_header("west\x00ca\x00la", CellValue::Text("LA".into()), "City", 2),
            ],
            vec![CellValue::number(400.0)],
        ),
        // Row 7: West / CA subtotal = 400
        make_subtotal_row(
            "west\x00ca__SUBTOTAL__",
            vec![
                make_header("west", CellValue::Text("West".into()), "Region", 0),
                make_header("west\x00ca", CellValue::Text("CA Total".into()), "State", 1),
            ],
            1,
            vec![CellValue::number(400.0)],
        ),
        // Row 8: West subtotal = 400
        make_subtotal_row(
            "west__SUBTOTAL__",
            vec![make_header(
                "west",
                CellValue::Text("West Total".into()),
                "Region",
                0,
            )],
            0,
            vec![CellValue::number(400.0)],
        ),
        // Row 9: Grand total = 1080
        make_grand_total_row(vec![CellValue::number(1080.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(1080.0)]));

    (rows, hierarchy, grand_totals)
}

#[test]
fn test_three_level_running_total_innermost() {
    let (mut rows, hierarchy, grand_totals) = make_three_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: None, // innermost = City (depth 2)
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East/NY group: NYC=500, Buffalo=100 -> 500, 600
    assert_eq!(num(&rows[0].values[0]), 500.0);
    assert_eq!(num(&rows[1].values[0]), 600.0);
    // East/CT group: Hartford=80 -> 80 (single item)
    assert_eq!(num(&rows[3].values[0]), 80.0);
    // West/CA group: LA=400 -> 400 (single item)
    assert_eq!(num(&rows[6].values[0]), 400.0);
}

#[test]
fn test_three_level_running_total_at_state_level() {
    let (mut rows, hierarchy, grand_totals) = make_three_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: Some(FieldId::from("State")),
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // At depth 1 (State), siblings share the same Region parent.
    // East group (children at depth 1 under "east"): NYC=500, Buffalo=100, Hartford=80
    // -> 500, 600, 680
    assert_eq!(num(&rows[0].values[0]), 500.0);
    assert_eq!(num(&rows[1].values[0]), 600.0);
    assert_eq!(num(&rows[3].values[0]), 680.0);
    // West group (children at depth 1 under "west"): LA=400 -> 400
    assert_eq!(num(&rows[6].values[0]), 400.0);
}

#[test]
fn test_three_level_rank_at_city_level() {
    let (mut rows, hierarchy, grand_totals) = make_three_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankDescending,
                base_field: None, // innermost = City
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East/NY: NYC(500) = 1, Buffalo(100) = 2
    assert_eq!(num(&rows[0].values[0]), 1.0);
    assert_eq!(num(&rows[1].values[0]), 2.0);
    // East/CT: Hartford(80) = 1 (only item)
    assert_eq!(num(&rows[3].values[0]), 1.0);
    // West/CA: LA(400) = 1 (only item)
    assert_eq!(num(&rows[6].values[0]), 1.0);
}

#[test]
fn test_three_level_difference_previous_at_city_level() {
    let (mut rows, hierarchy, grand_totals) = make_three_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: None,
                base_item: Some(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East/NY/NYC: no previous at depth 2 under east/ny -> Null
    assert!(is_null(&rows[0].values[0]));
    // East/NY/Buffalo: previous is NYC -> 100 - 500 = -400
    assert_eq!(num(&rows[1].values[0]), -400.0);
    // East/CT/Hartford: no previous at depth 2 under east/ct -> Null
    assert!(is_null(&rows[3].values[0]));
    // West/CA/LA: no previous at depth 2 under west/ca -> Null
    assert!(is_null(&rows[6].values[0]));
}

#[test]
fn test_three_level_percent_of_parent_row_total() {
    let (mut rows, hierarchy, grand_totals) = make_three_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                base_field: None, // innermost = City, parent = State
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Parent of City = State subtotal
    // East/NY/NYC: 500/600 = 0.833...
    assert_approx(num(&rows[0].values[0]), 5.0 / 6.0, 1e-10);
    // East/NY/Buffalo: 100/600 = 0.166...
    assert_approx(num(&rows[1].values[0]), 1.0 / 6.0, 1e-10);
    // East/CT/Hartford: 80/80 = 1.0
    assert_approx(num(&rows[3].values[0]), 1.0, 1e-10);
    // West/CA/LA: 400/400 = 1.0
    assert_approx(num(&rows[6].values[0]), 1.0, 1e-10);
}

// ===================================================================
// Multi-Column Multi-Value Tests
// ===================================================================

#[test]
fn test_multi_column_running_total() {
    // 2 columns, 1 value field.
    let field_names = vec!["Quarter".to_string()];
    let mut rows = vec![
        make_data_row(
            "q1",
            vec![make_header(
                "q1",
                CellValue::Text("Q1".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(10.0), CellValue::number(100.0)],
        ),
        make_data_row(
            "q2",
            vec![make_header(
                "q2",
                CellValue::Text("Q2".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(20.0), CellValue::number(200.0)],
        ),
        make_data_row(
            "q3",
            vec![make_header(
                "q3",
                CellValue::Text("Q3".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(30.0), CellValue::number(300.0)],
        ),
        make_grand_total_row(vec![CellValue::number(60.0), CellValue::number(600.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(660.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Column 0 running: 10, 30, 60
    assert_eq!(num(&rows[0].values[0]), 10.0);
    assert_eq!(num(&rows[1].values[0]), 30.0);
    assert_eq!(num(&rows[2].values[0]), 60.0);
    // Column 1 running: 100, 300, 600
    assert_eq!(num(&rows[0].values[1]), 100.0);
    assert_eq!(num(&rows[1].values[1]), 300.0);
    assert_eq!(num(&rows[2].values[1]), 600.0);
}

#[test]
fn test_multi_value_field_transforms() {
    // 1 column, 2 value fields.
    // Values layout: [sales_0, units_0] per row
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(300.0), CellValue::number(30.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(200.0), CellValue::number(20.0)],
        ),
        make_data_row(
            "north",
            vec![make_header(
                "north",
                CellValue::Text("North".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(300.0), CellValue::number(40.0)],
        ),
        make_grand_total_row(vec![CellValue::number(800.0), CellValue::number(90.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![
        CellValue::number(800.0),
        CellValue::number(90.0),
    ]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[
            (
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfGrandTotal,
                    base_field: None,
                    base_item: None,
                },
            ),
            (
                1,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::RankDescending,
                    base_field: None,
                    base_item: None,
                },
            ),
        ],
        &grand_totals,
        &hierarchy,
    );

    // Sales: percent of grand total (800)
    assert_approx(num(&rows[0].values[0]), 0.375, 1e-10); // 300/800
    assert_approx(num(&rows[1].values[0]), 0.25, 1e-10); // 200/800

    // Units: rank descending (40 > 30 > 20)
    assert_eq!(num(&rows[0].values[1]), 2.0); // 30 = rank 2
    assert_eq!(num(&rows[1].values[1]), 3.0); // 20 = rank 3
    assert_eq!(num(&rows[2].values[1]), 1.0); // 40 = rank 1
}

// ===================================================================
// Edge Cases
// ===================================================================

#[test]
fn test_single_data_row_all_transforms() {
    let field_names = vec!["Item".to_string()];
    let rows = vec![
        make_data_row(
            "only",
            vec![make_header(
                "only",
                CellValue::Text("Only".into()),
                "Item",
                0,
            )],
            vec![CellValue::number(42.0)],
        ),
        make_grand_total_row(vec![CellValue::number(42.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(42.0)]));

    // RunningTotal: single item -> same value
    {
        let mut r = rows.clone();
        apply_show_values_as_with_hierarchy(
            &mut r,
            &[(
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::RunningTotal,
                    base_field: None,
                    base_item: None,
                },
            )],
            &grand_totals,
            &hierarchy,
        );
        assert_eq!(num(&r[0].values[0]), 42.0);
    }

    // Rank: single item -> rank 1
    {
        let mut r = rows.clone();
        apply_show_values_as_with_hierarchy(
            &mut r,
            &[(
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::RankAscending,
                    base_field: None,
                    base_item: None,
                },
            )],
            &grand_totals,
            &hierarchy,
        );
        assert_eq!(num(&r[0].values[0]), 1.0);
    }

    // Difference Previous: no previous -> Null
    {
        let mut r = rows.clone();
        apply_show_values_as_with_hierarchy(
            &mut r,
            &[(
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::Difference,
                    base_field: None,
                    base_item: Some(ShowValuesAsBaseItem::Relative {
                        position: RelativePosition::Previous,
                    }),
                },
            )],
            &grand_totals,
            &hierarchy,
        );
        assert!(is_null(&r[0].values[0]));
    }

    // PercentOfGrandTotal: 42/42 = 1.0
    {
        let mut r = rows.clone();
        apply_show_values_as_with_hierarchy(
            &mut r,
            &[(
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfGrandTotal,
                    base_field: None,
                    base_item: None,
                },
            )],
            &grand_totals,
            &hierarchy,
        );
        assert_approx(num(&r[0].values[0]), 1.0, 1e-10);
    }
}

#[test]
fn test_all_zeros_division_produces_null() {
    let field_names = vec!["Item".to_string()];
    let rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::number(0.0)],
        ),
        make_data_row(
            "b",
            vec![make_header("b", CellValue::Text("B".into()), "Item", 0)],
            vec![CellValue::number(0.0)],
        ),
        make_grand_total_row(vec![CellValue::number(0.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(0.0)]));

    // PercentOfGrandTotal with zero grand total -> all Null
    {
        let mut r = rows.clone();
        apply_show_values_as_with_hierarchy(
            &mut r,
            &[(
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfGrandTotal,
                    base_field: None,
                    base_item: None,
                },
            )],
            &grand_totals,
            &hierarchy,
        );
        assert!(is_null(&r[0].values[0]));
        assert!(is_null(&r[1].values[0]));
    }

    // PercentRunningTotal with zero grand total -> all Null
    {
        let mut r = rows.clone();
        apply_show_values_as_with_hierarchy(
            &mut r,
            &[(
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentRunningTotal,
                    base_field: None,
                    base_item: None,
                },
            )],
            &grand_totals,
            &hierarchy,
        );
        assert!(is_null(&r[0].values[0]));
        assert!(is_null(&r[1].values[0]));
    }

    // Index with zero grand total -> all Null
    {
        let mut r = rows.clone();
        apply_show_values_as_with_hierarchy(
            &mut r,
            &[(
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::Index,
                    base_field: None,
                    base_item: None,
                },
            )],
            &grand_totals,
            &hierarchy,
        );
        assert!(is_null(&r[0].values[0]));
        assert!(is_null(&r[1].values[0]));
    }
}

#[test]
fn test_base_field_none_defaults_to_innermost() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    // With base_field=None, running total should reset at innermost level (Product)
    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East group resets: 100, 300
    assert_eq!(num(&rows[0].values[0]), 100.0);
    assert_eq!(num(&rows[1].values[0]), 300.0);
    // West group resets: 150, 400
    assert_eq!(num(&rows[3].values[0]), 150.0);
    assert_eq!(num(&rows[4].values[0]), 400.0);
}

#[test]
fn test_running_total_with_nulls() {
    let field_names = vec!["Item".to_string()];
    let mut rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "b",
            vec![make_header("b", CellValue::Text("B".into()), "Item", 0)],
            vec![CellValue::Null],
        ),
        make_data_row(
            "c",
            vec![make_header("c", CellValue::Text("C".into()), "Item", 0)],
            vec![CellValue::number(200.0)],
        ),
        make_grand_total_row(vec![CellValue::number(300.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(300.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RunningTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    assert_eq!(num(&rows[0].values[0]), 100.0);
    assert_eq!(num(&rows[1].values[0]), 100.0); // Null doesn't add
    assert_eq!(num(&rows[2].values[0]), 300.0);
}

#[test]
fn test_percent_of_grand_total_includes_subtotals() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfGrandTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East subtotal: 300/700 = 0.42857...
    assert_approx(num(&rows[2].values[0]), 3.0 / 7.0, 1e-10);
    // West subtotal: 400/700 = 0.57142...
    assert_approx(num(&rows[5].values[0]), 4.0 / 7.0, 1e-10);
    // Grand total: 700/700 = 1.0
    assert_approx(num(&rows[6].values[0]), 1.0, 1e-10);
}

#[test]
fn test_column_total_skips_grand_total_row() {
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(40.0), CellValue::number(30.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(60.0), CellValue::number(70.0)],
        ),
        make_grand_total_row(vec![CellValue::number(200.0), CellValue::number(200.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(200.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfColumnTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Col 0 total = 100 (40+60). East: 0.4, West: 0.6
    assert_approx(num(&rows[0].values[0]), 0.4, 1e-10);
    assert_approx(num(&rows[1].values[0]), 0.6, 1e-10);
    // Grand total row should NOT be modified (skipped)
    assert_eq!(num(&rows[2].values[0]), 200.0);
}

#[test]
fn test_difference_with_base_field_across_groups() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    // Use base_field="Region" to navigate at depth 0 (all data rows are in one group)
    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: Some(FieldId::from("Region")),
                base_item: Some(ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // At depth 0, all data rows are in one global group: [0, 1, 3, 4]
    // Row 0 (East/Widget=100): no previous -> Null
    assert!(is_null(&rows[0].values[0]));
    // Row 1 (East/Gadget=200): previous is row 0 (100) -> 200-100=100
    assert_eq!(num(&rows[1].values[0]), 100.0);
    // Row 3 (West/Widget=150): previous is row 1 (200) -> 150-200=-50
    assert_eq!(num(&rows[3].values[0]), -50.0);
    // Row 4 (West/Gadget=250): previous is row 3 (150) -> 250-150=100
    assert_eq!(num(&rows[4].values[0]), 100.0);
}

#[test]
fn test_specific_base_item_with_base_field() {
    let (mut rows, hierarchy, grand_totals) = make_two_level_test_data();

    // Use base_field="Region" (depth 0) with Specific("East/Widget header value?")
    // At depth 0, we match on the depth-0 header value.
    // But the specific value is matched against the header at the resolved depth.
    // At depth 0, the rows are [East/Widget, East/Gadget, West/Widget, West/Gadget]
    // and the header at depth 0 is "East" or "West".
    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Difference,
                base_field: Some(FieldId::from("Region")),
                base_item: Some(ShowValuesAsBaseItem::Specific {
                    value: CellValue::Text("East".into()),
                }),
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // At depth 0, all data rows are siblings.
    // find_sibling_by_value looks at header at depth 0.
    // "East" matches rows 0 and 1 (both have "East" at depth 0).
    // The first match (row 0, East/Widget=100) is the base.
    // Row 0: 100 - 100 = 0
    assert_eq!(num(&rows[0].values[0]), 0.0);
    // Row 1: 200 - 100 = 100
    assert_eq!(num(&rows[1].values[0]), 100.0);
    // Row 3 (West/Widget): 150 - 100 = 50
    assert_eq!(num(&rows[3].values[0]), 50.0);
    // Row 4 (West/Gadget): 250 - 100 = 150
    assert_eq!(num(&rows[4].values[0]), 150.0);
}

// ===================================================================
// Coverage gap tests: Non-Number cell fallback
// ===================================================================

/// Build test data with non-numeric (Text/Null) values in the value column.
fn make_non_numeric_test_data() -> (Vec<PivotRow>, GroupHierarchy, PivotGrandTotals) {
    let field_names = vec!["Item".to_string()];
    let rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::Text("hello".into())],
        ),
        make_data_row(
            "b",
            vec![make_header("b", CellValue::Text("B".into()), "Item", 0)],
            vec![CellValue::Null],
        ),
        make_data_row(
            "c",
            vec![make_header("c", CellValue::Text("C".into()), "Item", 0)],
            vec![CellValue::number(100.0)],
        ),
        make_grand_total_row(vec![CellValue::number(100.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(100.0)]));

    (rows, hierarchy, grand_totals)
}

#[test]
fn test_percent_of_grand_total_non_number_fallback() {
    let (mut rows, hierarchy, grand_totals) = make_non_numeric_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfGrandTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Text and Null values should become Null
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[1].values[0]));
    // Numeric value should be computed: 100/100 = 1.0
    assert_approx(num(&rows[2].values[0]), 1.0, 1e-10);
}

#[test]
fn test_percent_of_column_total_non_number_fallback() {
    let (mut rows, hierarchy, grand_totals) = make_non_numeric_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfColumnTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Text and Null should become Null
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[1].values[0]));
    // Only C has a numeric value; col total = 100 -> 100/100 = 1.0
    assert_approx(num(&rows[2].values[0]), 1.0, 1e-10);
}

#[test]
fn test_percent_of_row_total_non_number_fallback() {
    let (mut rows, hierarchy, grand_totals) = make_non_numeric_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfRowTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Non-numeric values -> Null
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[1].values[0]));
}

#[test]
fn test_percent_of_parent_row_total_non_number_fallback() {
    let (mut rows, hierarchy, grand_totals) = make_non_numeric_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Non-numeric values -> Null
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[1].values[0]));
}

#[test]
fn test_percent_of_parent_column_total_non_number_fallback() {
    let (mut rows, hierarchy, grand_totals) = make_non_numeric_test_data();

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentColumnTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Non-numeric values -> Null
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[1].values[0]));
}

// ===================================================================
// Coverage gap tests: Root-level parent handling (depth 0)
// ===================================================================

#[test]
fn test_percent_of_parent_row_total_single_level_uses_grand_total() {
    // Single row field (flat pivot): at depth 0, parent_depth=None,
    // should fall back to grand total.
    let (mut rows, hierarchy, grand_totals) = make_flat_test_data();
    // Grand total = 500

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // At depth 0, parent is None -> uses grand total (500)
    // Q1: 100/500 = 0.2
    assert_approx(num(&rows[0].values[0]), 0.2, 1e-10);
    // Q2: 150/500 = 0.3
    assert_approx(num(&rows[1].values[0]), 0.3, 1e-10);
    // Q3: 200/500 = 0.4
    assert_approx(num(&rows[2].values[0]), 0.4, 1e-10);
    // Q4: 50/500 = 0.1
    assert_approx(num(&rows[3].values[0]), 0.1, 1e-10);
}

#[test]
fn test_percent_of_parent_column_total_single_level_uses_column_total() {
    // Single row field (flat pivot): at depth 0, parent_depth=None,
    // should fall back to column total.
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(40.0), CellValue::number(60.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(60.0), CellValue::number(40.0)],
        ),
        make_grand_total_row(vec![CellValue::number(200.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(200.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::PercentOfParentColumnTotal,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // At depth 0, parent is None -> uses column total
    // Col 0 total: 40+60=100, Col 1 total: 60+40=100
    // east/col0: 40/100 = 0.4
    assert_approx(num(&rows[0].values[0]), 0.4, 1e-10);
    // east/col1: 60/100 = 0.6
    assert_approx(num(&rows[0].values[1]), 0.6, 1e-10);
    // west/col0: 60/100 = 0.6
    assert_approx(num(&rows[1].values[0]), 0.6, 1e-10);
    // west/col1: 40/100 = 0.4
    assert_approx(num(&rows[1].values[1]), 0.4, 1e-10);
}

// ===================================================================
// Coverage gap tests: Rank with non-numeric values
// ===================================================================

#[test]
fn test_rank_ascending_with_null_values() {
    let field_names = vec!["Item".to_string()];
    let mut rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::number(300.0)],
        ),
        make_data_row(
            "b",
            vec![make_header("b", CellValue::Text("B".into()), "Item", 0)],
            vec![CellValue::Null],
        ),
        make_data_row(
            "c",
            vec![make_header("c", CellValue::Text("C".into()), "Item", 0)],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "d",
            vec![make_header("d", CellValue::Text("D".into()), "Item", 0)],
            vec![CellValue::Text("N/A".into())],
        ),
        make_grand_total_row(vec![CellValue::number(400.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(400.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankAscending,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Ascending rank: 100=1, 300=2. Null/Text -> Null
    assert_eq!(num(&rows[0].values[0]), 2.0); // 300 -> rank 2
    assert!(is_null(&rows[1].values[0])); // Null stays Null
    assert_eq!(num(&rows[2].values[0]), 1.0); // 100 -> rank 1
    assert!(is_null(&rows[3].values[0])); // Text stays Null
}

#[test]
fn test_rank_descending_all_null() {
    let field_names = vec!["Item".to_string()];
    let mut rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::Null],
        ),
        make_data_row(
            "b",
            vec![make_header("b", CellValue::Text("B".into()), "Item", 0)],
            vec![CellValue::Null],
        ),
        make_grand_total_row(vec![CellValue::number(0.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(0.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::RankDescending,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // All null -> all stay Null
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[1].values[0]));
}

// ===================================================================
// Coverage gap tests: Index with missing row/column total
// ===================================================================

#[test]
fn test_index_with_zero_row_total() {
    // Row with all-zero values: row total = 0 -> index = Null
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(0.0), CellValue::number(0.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(60.0), CellValue::number(40.0)],
        ),
        make_grand_total_row(vec![CellValue::number(100.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(100.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Index,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // East has row total = 0 -> Null (row_total returns None when 0)
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[0].values[1]));
}

#[test]
fn test_index_with_zero_column_total() {
    // Column with all-zero values: column total = 0 -> index = Null
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(0.0), CellValue::number(100.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(0.0), CellValue::number(100.0)],
        ),
        make_grand_total_row(vec![CellValue::number(200.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(200.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Index,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Column 0 total = 0 -> Null for both rows in col 0
    assert!(is_null(&rows[0].values[0]));
    assert!(is_null(&rows[1].values[0]));
}

#[test]
fn test_index_with_zero_grand_total() {
    let field_names = vec!["Region".to_string()];
    let mut rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "Region",
                0,
            )],
            vec![CellValue::number(0.0)],
        ),
        make_grand_total_row(vec![CellValue::number(0.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(0.0)]));

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[(
            0,
            ShowValuesAsConfig {
                calculation_type: ShowValuesAs::Index,
                base_field: None,
                base_item: None,
            },
        )],
        &grand_totals,
        &hierarchy,
    );

    // Grand total = 0 -> set_all_values_to_null
    assert!(is_null(&rows[0].values[0]));
}

// ===================================================================
// Coverage gap: NoCalculation mixed with real transforms
// ===================================================================

#[test]
fn test_no_calculation_mixed_with_transform() {
    // When one value placement has NoCalculation and another has a real
    // transform, the NoCalculation values should remain unchanged while
    // the other is transformed.
    let field_names = vec!["Item".to_string()];
    let mut rows = vec![
        make_data_row(
            "a",
            vec![make_header("a", CellValue::Text("A".into()), "Item", 0)],
            vec![CellValue::number(100.0), CellValue::number(200.0)],
        ),
        make_data_row(
            "b",
            vec![make_header("b", CellValue::Text("B".into()), "Item", 0)],
            vec![CellValue::number(300.0), CellValue::number(400.0)],
        ),
        make_grand_total_row(vec![CellValue::number(400.0), CellValue::number(600.0)]),
    ];
    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = PivotGrandTotals {
        row: Some(vec![CellValue::number(400.0), CellValue::number(600.0)]),
        column: None,
        grand: Some(vec![CellValue::number(400.0), CellValue::number(600.0)]),
        row_label: None,
    };

    apply_show_values_as_with_hierarchy(
        &mut rows,
        &[
            (
                0,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::NoCalculation,
                    base_field: None,
                    base_item: None,
                },
            ),
            (
                1,
                ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfGrandTotal,
                    base_field: None,
                    base_item: None,
                },
            ),
        ],
        &grand_totals,
        &hierarchy,
    );

    // Value 0 (NoCalculation): unchanged
    assert_eq!(num(&rows[0].values[0]), 100.0);
    assert_eq!(num(&rows[1].values[0]), 300.0);
    // Value 1 (PercentOfGrandTotal): 200/600, 400/600
    assert_approx(num(&rows[0].values[1]), 2.0 / 6.0, 1e-10);
    assert_approx(num(&rows[1].values[1]), 4.0 / 6.0, 1e-10);
}

// ============================================================================
// ShowValuesAs regression tests (moved from pivot_bug_repro_tests.rs)
// ============================================================================

fn cv_text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn cv_num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn make_regression_config(
    fields: Vec<crate::types::PivotField>,
    placements: Vec<crate::types::PivotFieldPlacement>,
    filters: Vec<crate::types::PivotFilter>,
) -> crate::types::PivotTableConfig {
    crate::types::PivotTableConfig {
        schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: "pivot1".to_string(),
        name: "Test Pivot".to_string(),
        source_sheet_id: None,
        source_sheet_name: "sheet1".to_string(),
        source_range: crate::types::CellRange::new(0, 0, 8, 4),
        output_sheet_name: "sheet1".to_string(),
        output_location: crate::types::OutputLocation { row: 0, col: 0 },
        fields,
        placements,
        filters,
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
    }
}

/// PercentOfParentRowTotal must output fractions (0.0-1.0), not multiplied by 100.
#[test]
fn percent_of_parent_row_outputs_fraction_not_times_100() {
    use crate::engine::{compute_with_show_values_as, detect_fields};
    use crate::types::{
        AggregateFunction, AxisPlacement, PivotFieldPlacement, PlacementBase, ShowValuesAs,
        ShowValuesAsConfig, ValuePlacement,
    };

    let data = vec![
        vec![cv_text("ServiceLine"), cv_text("Type"), cv_text("EmpID")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E1")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E2")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E3")],
        vec![cv_text("SOC"), cv_text("Offshore"), cv_text("E4")],
        vec![cv_text("Non-COGS"), cv_text("Direct"), cv_text("E5")],
        vec![cv_text("Non-COGS"), cv_text("Direct"), cv_text("E6")],
    ];

    let fields = detect_fields(&data);
    let config = make_regression_config(
        fields.clone(),
        vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[0].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
            }),
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[1].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 1,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: Some(false),
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: fields[2].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: Some("Count".to_string()),
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::CountA,
                number_format: None,
                show_values_as: None,
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: fields[2].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 1,
                    display_name: Some("% Of Total".to_string()),
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::CountA,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let result = compute_with_show_values_as(&config, &data, None);
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    for row in &result.rows {
        if row.key.contains("Direct") && row.depth == 1 {
            let pct_value = match &row.values[1] {
                CellValue::Number(n) => n.get(),
                other => panic!("Expected number for % field, got {:?}", other),
            };
            assert!(
                pct_value < 1.1,
                "PercentOfParentRowTotal must output fractions (0.0-1.0), got {}",
                pct_value,
            );
            if row
                .headers
                .iter()
                .any(|h| matches!(&h.value, CellValue::Text(t) if t.as_ref().contains("SOC")))
                || row.key.contains("SOC")
            {
                assert!(
                    (pct_value - 0.75).abs() < 0.001,
                    "SOC>Direct: expected 0.75 (3/4), got {}",
                    pct_value,
                );
            }
            break;
        }
    }
}

/// PercentOfParentRowTotal basic: each child row should be a fraction of parent subtotal.
#[test]
fn show_values_as_percent_of_parent_row_basic() {
    use crate::engine::{compute_with_show_values_as, detect_fields};
    use crate::types::{
        AggregateFunction, AxisPlacement, PivotFieldPlacement, PlacementBase, ShowValuesAs,
        ShowValuesAsConfig, ValuePlacement,
    };

    let data = vec![
        vec![cv_text("Region"), cv_text("City"), cv_text("Sales")],
        vec![cv_text("East"), cv_text("NYC"), cv_num(300.0)],
        vec![cv_text("East"), cv_text("Boston"), cv_num(200.0)],
        vec![cv_text("West"), cv_text("LA"), cv_num(400.0)],
        vec![cv_text("West"), cv_text("SF"), cv_num(100.0)],
    ];

    let fields = detect_fields(&data);
    let config = make_regression_config(
        fields.clone(),
        vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[0].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: Some(true),
            }),
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[1].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 1,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: Some(false),
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: fields[2].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: Some("% of Region".to_string()),
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let result = compute_with_show_values_as(&config, &data, None);
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    for row in &result.rows {
        if row.is_subtotal || row.is_grand_total {
            continue;
        }
        let key = &row.key;
        let expected = if key.contains("NYC") {
            Some(0.6)
        } else if key.contains("Boston") {
            Some(0.4)
        } else if key.contains("LA") {
            Some(0.8)
        } else if key.contains("SF") {
            Some(0.2)
        } else {
            None
        };
        if let Some(expected) = expected {
            let value = match &row.values[0] {
                CellValue::Number(n) => n.get(),
                other => panic!("key={}: expected number, got {:?}", key, other),
            };
            assert!(
                (value - expected).abs() < 0.001,
                "key={}: expected {} (fraction), got {}",
                key,
                expected,
                value,
            );
        }
    }
}
