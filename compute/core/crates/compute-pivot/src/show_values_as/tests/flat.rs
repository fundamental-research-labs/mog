use super::super::*;
use super::common::*;
use crate::hierarchy::build_group_hierarchy;
use crate::types::{PivotRenderedBounds, RelativePosition, ShowValuesAsBaseItem};

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
