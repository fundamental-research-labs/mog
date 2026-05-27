use super::super::*;
use super::common::*;
use crate::hierarchy::{GroupHierarchy, build_group_hierarchy};
use crate::types::{FieldId, RelativePosition, ShowValuesAsBaseItem};

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
