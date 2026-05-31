use super::*;

#[test]
fn ties_maintain_stable_sort() {
    let data_with_ties: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Sales")],
        vec![cv_text("B"), cv_num(100.0)],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("C"), cv_num(200.0)],
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
            id: FieldId::from("sales"),
            name: "Sales".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let mut axis = make_row_axis("category", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_cat = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        fields,
        vec![
            placement_cat,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data_with_ties, Some(&expand_all()));

    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 3);

    // C (200) should be first
    assert_eq!(result.rows[0].headers[0].value, cv_text("C"));
    assert_eq!(result.rows[0].values[0], cv_num(200.0));

    // A and B both have 100, they should both be there
    let tied_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.values[0] == cv_num(100.0))
        .collect();
    assert_eq!(tied_rows.len(), 2);

    // Ties should be ordered alphabetically ascending (stable sort over alphabetical pre-sort)
    assert_eq!(result.rows[1].headers[0].value, cv_text("A"));
    assert_eq!(result.rows[2].headers[0].value, cv_text("B"));
}
/// When sort_by_value is configured and two groups have the same aggregated
/// value, the engine should use the custom_sort_list (items-array order) as the
/// tiebreaker. The engine correctly handles this when custom_sort_list is provided.
///
/// FIX APPLIED: pivot_convert's resolve_sort() now always builds custom_sort_list
/// from the items array, even when sortType is explicit (ascending/descending).
/// Previously it would return early with no custom list, causing alphabetical ties.
#[test]
fn sort_by_value_tiebreaker_preserves_custom_sort_order() {
    // 4 departments, two pairs with the same count.
    let data = vec![
        vec![cv_text("Dept"), cv_text("EmpID")],
        // Marketing: 3 employees
        vec![cv_text("Marketing"), cv_text("E1")],
        vec![cv_text("Marketing"), cv_text("E2")],
        vec![cv_text("Marketing"), cv_text("E3")],
        // Infrastructure & Security: 3 employees (same count as Marketing)
        vec![cv_text("Infrastructure & Security"), cv_text("E4")],
        vec![cv_text("Infrastructure & Security"), cv_text("E5")],
        vec![cv_text("Infrastructure & Security"), cv_text("E6")],
        // Finance: 2 employees
        vec![cv_text("Finance"), cv_text("E7")],
        vec![cv_text("Finance"), cv_text("E8")],
        // Legal: 2 employees (same count as Finance)
        vec![cv_text("Legal"), cv_text("E9")],
        vec![cv_text("Legal"), cv_text("E10")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("dept"),
            name: "Dept".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // After the fix in pivot_convert, resolve_sort() now always builds the
    // custom_sort_list from the items array, even when sortType is explicit.
    // This provides the items-order tiebreaker for sort_by_value.
    let row_dept = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("dept"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None, // Cleared because sort_by_value is present
        custom_sort_list: Some(vec![
            cv_text("Marketing"),
            cv_text("Infrastructure & Security"),
            cv_text("Finance"),
            cv_text("Legal"),
        ]),
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_id"),
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
    });

    let config = make_base_config(fields, vec![row_dept, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(result.rows.len(), 4);

    // With no custom_sort_list, the grouper sorts alphabetically.
    // Stable sort preserves this for ties, giving:
    //   Finance (2), Infrastructure & Security (3), Legal (2), Marketing (3) → alphabetical
    //   After sort_by_value desc: I&S (3), Marketing (3), Finance (2), Legal (2)
    // But Excel expects: Marketing (3), I&S (3), Finance (2), Legal (2)
    //
    // THIS TEST SHOULD FAIL — it documents the bug.
    // The fix is in pivot_convert to pass custom_sort_list from items array.
    assert_eq!(
        result.rows[0].headers[0].value,
        cv_text("Marketing"),
        "Marketing (count=3) should come before I&S (count=3) — items-order tiebreaker"
    );
    assert_eq!(
        result.rows[1].headers[0].value,
        cv_text("Infrastructure & Security"),
        "I&S (count=3) should come after Marketing — later in items order"
    );
    assert_eq!(
        result.rows[2].headers[0].value,
        cv_text("Finance"),
        "Finance (count=2) should come before Legal (count=2) — items-order tiebreaker"
    );
    assert_eq!(
        result.rows[3].headers[0].value,
        cv_text("Legal"),
        "Legal (count=2) should come after Finance — later in items order"
    );
}
#[test]
fn sort_by_value_four_way_tie_uses_items_order() {
    let data = vec![
        vec![cv_text("Dept"), cv_text("EmpID")],
        // Privacy: 2 employees
        vec![cv_text("Privacy"), cv_text("E1")],
        vec![cv_text("Privacy"), cv_text("E2")],
        // CMMC: 2 employees (same count)
        vec![cv_text("CMMC"), cv_text("E3")],
        vec![cv_text("CMMC"), cv_text("E4")],
        // Legal: 2 employees (same count)
        vec![cv_text("Legal"), cv_text("E5")],
        vec![cv_text("Legal"), cv_text("E6")],
        // Operations: 2 employees (same count)
        vec![cv_text("Operations"), cv_text("E7")],
        vec![cv_text("Operations"), cv_text("E8")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("dept"),
            name: "Dept".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // After the fix, pivot_convert provides items-order custom_sort_list.
    let row_dept = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("dept"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: Some(vec![
            cv_text("Privacy"),
            cv_text("CMMC"),
            cv_text("Legal"),
            cv_text("Operations"),
        ]),
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_id"),
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
    });

    let config = make_base_config(fields, vec![row_dept, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(result.rows.len(), 4);

    // All have count=2. Without custom_sort_list, our engine sorts alphabetically:
    //   CMMC, Legal, Operations, Privacy
    // But Excel expects items-array order: Privacy, CMMC, Legal, Operations
    //
    // THIS TEST SHOULD FAIL — it documents the bug.
    assert_eq!(
        result.rows[0].headers[0].value,
        cv_text("Privacy"),
        "Privacy should be first — all tied, expected items-order tiebreaker"
    );
    assert_eq!(
        result.rows[1].headers[0].value,
        cv_text("CMMC"),
        "CMMC should be second per items order"
    );
    assert_eq!(
        result.rows[2].headers[0].value,
        cv_text("Legal"),
        "Legal should be third per items order"
    );
    assert_eq!(
        result.rows[3].headers[0].value,
        cv_text("Operations"),
        "Operations should be fourth per items order"
    );
}
#[test]
fn sort_by_value_custom_sort_list_as_tiebreaker() {
    // Same data as bug5 but WITHOUT explicitly setting custom_sort_list on the
    // AxisPlacement. Instead, we check that when the grouper creates nodes,
    // it uses the custom_sort_list order even if sort_by_value will re-sort later.
    //
    // This mimics what happens in real XLSX files where pivot_convert produces
    // both custom_sort_list (from shared_items) AND sort_by_value (from autoSortScope).
    // Currently pivot_convert DOES pass both, but the engine doesn't use the
    // custom_sort_list as a pre-sort before applying sort_by_value.

    let data = vec![
        vec![cv_text("Dept"), cv_text("EmpID")],
        // Sustainability: 1 employee
        vec![cv_text("Sustainability"), cv_text("E1")],
        // Strategic Sourcing: 1 employee (same count)
        vec![cv_text("Strategic Sourcing"), cv_text("E2")],
        // Project Opal: 1 employee (same count)
        vec![cv_text("Project Opal"), cv_text("E3")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("dept"),
            name: "Dept".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // After the fix, pivot_convert provides items-order custom_sort_list.
    let row_dept = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("dept"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: Some(vec![
            cv_text("Sustainability"),
            cv_text("Strategic Sourcing"),
            cv_text("Project Opal"),
        ]),
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_id"),
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
    });

    let config = make_base_config(fields, vec![row_dept, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(result.rows.len(), 3);

    // All have count=1, so sort_by_value doesn't differentiate.
    // Ties should be broken by custom_sort_list order.
    assert_eq!(
        result.rows[0].headers[0].value,
        cv_text("Sustainability"),
        "All count=1: Sustainability should be first per custom_sort_list order"
    );
    assert_eq!(
        result.rows[1].headers[0].value,
        cv_text("Strategic Sourcing"),
        "All count=1: Strategic Sourcing should be second per custom_sort_list order"
    );
    assert_eq!(
        result.rows[2].headers[0].value,
        cv_text("Project Opal"),
        "All count=1: Project Opal should be third per custom_sort_list order"
    );
}
/// Verify that sort-by-value with many tied items produces deterministic,
/// correctly-aligned output: each item's aggregated values must appear
/// at that item's row position regardless of input data order.
#[test]
fn sort_by_value_tiebreak_alignment() {
    // Sort by a metric descending. Most items have SortMetric=0.
    let data: Vec<Vec<CellValue>> = vec![
        vec![
            cv_text("Item"),
            cv_text("MetricA"),
            cv_text("ReportedMetricA"),
            cv_text("SortMetric"),
        ],
        // Non-zero sort metrics.
        vec![
            cv_text("Item 01"),
            cv_num(5265.0),
            cv_num(68445.0),
            cv_num(63180.0),
        ],
        vec![
            cv_text("Item 07"),
            cv_num(100.0),
            cv_num(100.0),
            cv_num(-4862.0),
        ],
        vec![
            cv_text("Item 08"),
            cv_num(500.0),
            cv_num(500.0),
            cv_num(-18119.25),
        ],
        // Zero metric — different MetricA values make misalignment visible.
        vec![
            cv_text("Item 02"),
            cv_num(1772.16),
            cv_num(1772.16),
            cv_num(0.0),
        ],
        vec![
            cv_text("Item 03"),
            cv_num(11692.80),
            cv_num(11692.80),
            cv_num(0.0),
        ],
        vec![
            cv_text("Item 04"),
            cv_num(127682.25),
            cv_num(127682.25),
            cv_num(0.0),
        ],
        vec![cv_text("Item 05"), cv_num(0.0), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Item 06"), cv_num(0.0), cv_num(0.0), cv_num(0.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("item"),
            name: "Item".into(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("metric_a"),
            name: "MetricA".into(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("reported_metric_a"),
            name: "ReportedMetricA".into(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sort_metric"),
            name: "SortMetric".into(),
            source_column: 3,
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

    let config = make_base_config(
        fields,
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement(
                "metric_a",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "reported_metric_a",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "sort_metric",
                PivotFieldArea::Value,
                2,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(result.rows.len(), 8);

    // Row 0: highest sort metric.
    assert_eq!(result.rows[0].headers[0].value, cv_text("Item 01"));
    assert_approx(&result.rows[0].values[0], 5265.0, "Item 01 MetricA");
    assert_approx(&result.rows[0].values[2], 63180.0, "Item 01 SortMetric");

    // Rows 1-5: zero-metric items in alphabetical order.
    let zero_labels: Vec<String> = result.rows[1..=5]
        .iter()
        .map(|r| match &r.headers[0].value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("expected text"),
        })
        .collect();
    assert_eq!(
        zero_labels,
        vec!["Item 02", "Item 03", "Item 04", "Item 05", "Item 06"],
        "zero-metric items alphabetically ordered"
    );

    // Critically: each item's MetricA must match its own data, not be shifted.
    let item_02 = find_row_by_key(&result.rows, "Item 02").unwrap();
    assert_approx(&item_02.values[0], 1772.16, "Item 02 MetricA aligned");

    let item_04 = find_row_by_key(&result.rows, "Item 04").unwrap();
    assert_approx(&item_04.values[0], 127682.25, "Item 04 MetricA aligned");

    let item_03 = find_row_by_key(&result.rows, "Item 03").unwrap();
    assert_approx(&item_03.values[0], 11692.80, "Item 03 MetricA aligned");

    // Rows 6-7: negative sort metrics, descending.
    assert_eq!(result.rows[6].headers[0].value, cv_text("Item 07"));
    assert_eq!(result.rows[7].headers[0].value, cv_text("Item 08"));
}
/// Verify that the sort-by-value result is identical regardless of input data order.
/// This catches non-determinism from HashMap seeds or unstable sorts.
#[test]
fn sort_by_value_deterministic_across_input_orders() {
    let fields = vec![
        PivotField {
            id: FieldId::from("loc"),
            name: "Loc".into(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("val"),
            name: "Val".into(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let make_config = || {
        let mut axis = make_row_axis("loc", 0);
        axis.sort_by_value = Some(SortByValueConfig {
            value_field_id: FieldId::from("val"),
            order: SortDirection::Desc,
            column_key: None,
        });
        make_base_config(
            fields.clone(),
            vec![
                PivotFieldPlacement::Row(axis),
                make_placement(
                    "val",
                    PivotFieldArea::Value,
                    0,
                    Some(AggregateFunction::Sum),
                ),
            ],
            vec![],
        )
    };

    // Data in one order
    let data_order1: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Loc"), cv_text("Val")],
        vec![cv_text("Alpha"), cv_num(0.0)],
        vec![cv_text("Beta"), cv_num(0.0)],
        vec![cv_text("Gamma"), cv_num(100.0)],
        vec![cv_text("Delta"), cv_num(0.0)],
    ];

    // Same data, different input order
    let data_order2: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Loc"), cv_text("Val")],
        vec![cv_text("Delta"), cv_num(0.0)],
        vec![cv_text("Gamma"), cv_num(100.0)],
        vec![cv_text("Alpha"), cv_num(0.0)],
        vec![cv_text("Beta"), cv_num(0.0)],
    ];

    let result1 = compute(&make_config(), &data_order1, Some(&expand_all()));
    let result2 = compute(&make_config(), &data_order2, Some(&expand_all()));

    assert!(result1.errors.is_none());
    assert!(result2.errors.is_none());

    let labels1: Vec<String> = result1
        .rows
        .iter()
        .map(|r| match &r.headers[0].value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("expected text"),
        })
        .collect();

    let labels2: Vec<String> = result2
        .rows
        .iter()
        .map(|r| match &r.headers[0].value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("expected text"),
        })
        .collect();

    assert_eq!(
        labels1, labels2,
        "Sort order must be identical regardless of input data order.\n  Order 1: {:?}\n  Order 2: {:?}",
        labels1, labels2
    );

    // Both should produce: Gamma(100), Alpha(0), Beta(0), Delta(0)
    assert_eq!(labels1, vec!["Gamma", "Alpha", "Beta", "Delta"]);
}
