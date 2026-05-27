use super::super::*;
use super::common::*;
use crate::hierarchy::{GroupHierarchy, build_group_hierarchy};

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
