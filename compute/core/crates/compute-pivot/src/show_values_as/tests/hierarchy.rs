use super::super::*;
use super::common::*;
use crate::hierarchy::build_group_hierarchy;
use crate::types::{FieldId, RelativePosition, ShowValuesAsBaseItem};

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
