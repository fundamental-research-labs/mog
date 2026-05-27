use super::super::*;
use super::common::*;
use crate::hierarchy::build_group_hierarchy;
use crate::types::{FieldId, RelativePosition, ShowValuesAsBaseItem};

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
