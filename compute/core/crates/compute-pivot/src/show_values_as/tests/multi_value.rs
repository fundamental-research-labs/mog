use super::super::*;
use super::common::*;
use crate::hierarchy::build_group_hierarchy;

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
