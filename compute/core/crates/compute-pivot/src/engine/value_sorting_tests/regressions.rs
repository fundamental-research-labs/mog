use super::*;

/// Regression test for a pivot with many tied values.
///
/// Models a pivot table with many items sorted descending by a metric field.
/// Most items have metric=0, so tiebreaking determines their order.
/// The sort-by-value sort must produce deterministic, alphabetical tiebreaking
/// among items with equal aggregated values.
#[test]
fn sort_by_value_many_ties_deterministic_order() {
    // 15 items, most with metric=0, sorted by metric descending.
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Item"), cv_text("MetricA"), cv_text("SortMetric")],
        // Items with nonzero sort metrics.
        vec![cv_text("Item 01"), cv_num(5265.0), cv_num(63180.0)],
        vec![cv_text("Item 14"), cv_num(100.0), cv_num(-4862.0)],
        vec![cv_text("Item 15"), cv_num(500.0), cv_num(-18119.25)],
        vec![cv_text("Item 16"), cv_num(200.0), cv_num(-194907.75)],
        // Items with sort metric=0 (ties).
        vec![cv_text("Item 02"), cv_num(1772.16), cv_num(0.0)],
        vec![cv_text("Item 03"), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Item 04"), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Item 05"), cv_num(11692.80), cv_num(0.0)],
        vec![cv_text("Item 06"), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Item 07"), cv_num(125488.0), cv_num(0.0)],
        vec![cv_text("Item 08"), cv_num(127682.25), cv_num(0.0)],
        vec![cv_text("Item 09"), cv_num(3852.0), cv_num(0.0)],
        vec![cv_text("Item 10"), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Item 11"), cv_num(3852.0), cv_num(0.0)],
        vec![cv_text("Item 12"), cv_num(0.0), cv_num(0.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("item"),
            name: "Item".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("metric_a"),
            name: "MetricA".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sort_metric"),
            name: "SortMetric".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let mut axis = make_row_axis("item", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sort_metric"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_item = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        fields,
        vec![
            placement_item,
            make_placement(
                "metric_a",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "sort_metric",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 15);

    // Verify primary sort by metric descending.
    assert_eq!(result.rows[0].headers[0].value, cv_text("Item 01"));
    assert_approx(&result.rows[0].values[1], 63180.0, "Item 01 sort metric");

    // All zero-metric items should come next, in alphabetical order (stable tiebreaker).
    let zero_metric_rows: Vec<&str> = result
        .rows
        .iter()
        .filter(|r| r.values[1] == cv_num(0.0))
        .map(|r| match &r.headers[0].value {
            CellValue::Text(s) => s.as_ref(),
            _ => panic!("expected text header"),
        })
        .collect();

    assert_eq!(
        zero_metric_rows,
        vec![
            "Item 02", "Item 03", "Item 04", "Item 05", "Item 06", "Item 07", "Item 08", "Item 09",
            "Item 10", "Item 11", "Item 12",
        ],
        "Zero-metric items must be in alphabetical order (stable tiebreaker)"
    );

    // Verify each zero-metric item has the correct MetricA value (not shifted by wrong sort).
    let item_02 = find_row_by_key(&result.rows, "Item 02").unwrap();
    assert_approx(&item_02.values[0], 1772.16, "Item 02 MetricA");
    assert_approx(&item_02.values[1], 0.0, "Item 02 SortMetric");

    let item_08 = find_row_by_key(&result.rows, "Item 08").unwrap();
    assert_approx(&item_08.values[0], 127682.25, "Item 08 MetricA");

    // Negative metric items should come last, in descending order.
    let last_row = &result.rows[14];
    assert_eq!(last_row.headers[0].value, cv_text("Item 16"));
    assert_approx(&last_row.values[1], -194907.75, "Item 16 sort metric");
}
