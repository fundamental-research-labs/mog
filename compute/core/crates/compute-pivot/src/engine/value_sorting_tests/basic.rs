use super::*;

#[test]
fn sort_by_value_desc() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 2);

    // West (4600) first, East (3900) second
    assert_eq!(result.rows[0].headers[0].value, cv_text("West"));
    assert_eq!(result.rows[0].values[0], cv_num(4600.0));
    assert_eq!(result.rows[1].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[1].values[0], cv_num(3900.0));
}
#[test]
fn sort_by_value_asc() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Asc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    // East (3900) first, West (4600) second
    assert_eq!(result.rows[0].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[0].values[0], cv_num(3900.0));
    assert_eq!(result.rows[1].headers[0].value, cv_text("West"));
    assert_eq!(result.rows[1].values[0], cv_num(4600.0));
}
#[test]
fn sort_by_second_value_field() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("units"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "units",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 2);

    // West units: 15+18+7+6=46, East units: 10+12+8+9=39
    // West should come first (higher units)
    assert_eq!(result.rows[0].headers[0].value, cv_text("West"));
    assert_eq!(result.rows[0].values[1], cv_num(46.0));
    assert_eq!(result.rows[1].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[1].values[1], cv_num(39.0));
}
#[test]
fn no_sort_when_not_configured() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_order = Some(SortDirection::Asc);
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    // Default alphabetical sort: East before West
    assert_eq!(result.rows[0].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[1].headers[0].value, cv_text("West"));
}
#[test]
fn invalid_value_field_reference() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("nonexistent"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    // Validation now catches unknown sort_by_value references
    assert!(result.errors.is_some());
    let errors = result.errors.as_ref().unwrap();
    assert!(
        errors
            .iter()
            .any(|e| e.contains("sort_by_value") && e.contains("nonexistent")),
        "should detect bad sort_by_value reference: {:?}",
        errors
    );
}
#[test]
fn null_values_in_sort() {
    let data_with_nulls: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Sales")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("B"), CellValue::Null],
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

    let result = compute(&config, &data_with_nulls, Some(&expand_all()));

    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 3);

    // C (200) should be first, then A (100)
    assert_eq!(result.rows[0].values[0], cv_num(200.0));
    assert_eq!(result.rows[1].values[0], cv_num(100.0));
}
/// Test that sort_by_value with multiple value fields sorts by the correct field,
/// and that the non-sort value fields have correct values at each row position.
///
/// This catches the bug where wrong sort order causes InvValue to appear at wrong
/// cell positions (e.g., Boxborough's InvValue=0 appearing at Perrysburg's row).
#[test]
fn sort_by_value_values_at_correct_positions() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Location"), cv_text("Revenue"), cv_text("Profit")],
        vec![cv_text("NYC"), cv_num(5000.0), cv_num(100.0)],
        vec![cv_text("LA"), cv_num(3000.0), cv_num(100.0)],
        vec![cv_text("Chicago"), cv_num(7000.0), cv_num(100.0)],
        vec![cv_text("Boston"), cv_num(1000.0), cv_num(100.0)],
        vec![cv_text("Denver"), cv_num(9000.0), cv_num(200.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("location"),
            name: "Location".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("revenue"),
            name: "Revenue".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("profit"),
            name: "Profit".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    // Sort by Profit descending — Denver(200) first, then 4 tied at 100
    let mut axis = make_row_axis("location", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("profit"),
        order: SortDirection::Desc,
        column_key: None,
    });

    let config = make_base_config(
        fields,
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement(
                "revenue",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "profit",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 5);

    // Denver (profit=200) comes first
    assert_eq!(result.rows[0].headers[0].value, cv_text("Denver"));
    assert_approx(&result.rows[0].values[0], 9000.0, "Denver revenue");
    assert_approx(&result.rows[0].values[1], 200.0, "Denver profit");

    // Tied at profit=100: alphabetical order = Boston, Chicago, LA, NYC
    assert_eq!(result.rows[1].headers[0].value, cv_text("Boston"));
    assert_approx(&result.rows[1].values[0], 1000.0, "Boston revenue");

    assert_eq!(result.rows[2].headers[0].value, cv_text("Chicago"));
    assert_approx(&result.rows[2].values[0], 7000.0, "Chicago revenue");

    assert_eq!(result.rows[3].headers[0].value, cv_text("LA"));
    assert_approx(&result.rows[3].values[0], 3000.0, "LA revenue");

    assert_eq!(result.rows[4].headers[0].value, cv_text("NYC"));
    assert_approx(&result.rows[4].values[0], 5000.0, "NYC revenue");
}
#[test]
fn sort_works_with_column_fields() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    assert!(!result.column_headers.is_empty());

    // West should come first (higher total sales)
    assert_eq!(result.rows[0].headers[0].value, cv_text("West"));
}
#[test]
fn average_aggregation_with_sort_by_value() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Average),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());

    // West average: (1500+1800+700+600)/4 = 1150
    // East average: (1000+1200+800+900)/4 = 975
    // West should come first
    assert_eq!(result.rows[0].headers[0].value, cv_text("West"));
    assert_eq!(result.rows[0].values[0], cv_num(1150.0));
    assert_eq!(result.rows[1].headers[0].value, cv_text("East"));
    assert_eq!(result.rows[1].values[0], cv_num(975.0));
}
#[test]
fn sort_by_value_count_on_text_field_returns_null() {
    let data = vec![
        vec![cv_text("Dept"), cv_text("Level"), cv_text("Name")],
        // Engineering: 4 people (most)
        vec![cv_text("Eng"), cv_text("Senior"), cv_text("Alice")],
        vec![cv_text("Eng"), cv_text("Senior"), cv_text("Bob")],
        vec![cv_text("Eng"), cv_text("Junior"), cv_text("Carol")],
        vec![cv_text("Eng"), cv_text("Junior"), cv_text("Dave")],
        // Sales: 2 people
        vec![cv_text("Sales"), cv_text("Senior"), cv_text("Eve")],
        vec![cv_text("Sales"), cv_text("Junior"), cv_text("Frank")],
        // HR: 1 person (least)
        vec![cv_text("HR"), cv_text("Senior"), cv_text("Grace")],
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
            id: FieldId::from("level"),
            name: "Level".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("name"),
            name: "Name".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // sort_by_value with Count (numeric-only) on a TEXT field — this is the bug path
    // In the real XLSX, OOXML "count" subtotal gets mapped to AggregateFunction::Count
    // instead of CountA, causing sort values to be Null for text fields.
    let row_dept = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("dept"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("name"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // NOTE: Using Count (numeric-only) — this is what the OOXML importer produces.
    // The bug is that Count returns Null for text values, so sort_by_value has no effect.
    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("name"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Count of Name".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Count, // BUG: should be CountA
        number_format: None,
        show_values_as: None,
    });

    let config = make_base_config(fields.clone(), vec![row_dept, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // BUG DEMONSTRATION: Count (numeric-only) returns Null for all text values,
    // so sort has no effect and rows stay in alphabetical order.
    // If this test PASSES, it means the sort_by_value is broken (no-op due to Null values).
    // When fixed (Count→CountA), the order should be Eng (4), Sales (2), HR (1).

    // Check that Count on text produces Null values (demonstrating the bug)
    let all_null = result
        .rows
        .iter()
        .all(|r| matches!(r.values[0], CellValue::Null));
    assert!(
        all_null,
        "BUG CONFIRMED: Count (numeric-only) on text field should return Null for all groups. \
         If this assertion fails, the Count→CountA fix may have been applied."
    );

    // Once the Count→CountA mapping is fixed in pivot_convert.rs:609,
    // this assertion should hold:
    // assert_eq!(result.rows[0].headers[0].value, cv_text("Eng"), "Eng (4) first");
    // assert_eq!(result.rows[1].headers[0].value, cv_text("Sales"), "Sales (2) second");
    // assert_eq!(result.rows[2].headers[0].value, cv_text("HR"), "HR (1) third");
}
#[test]
fn sort_by_value_counta_on_text_field_works() {
    let data = vec![
        vec![cv_text("Dept"), cv_text("Level"), cv_text("Name")],
        vec![cv_text("Eng"), cv_text("Senior"), cv_text("Alice")],
        vec![cv_text("Eng"), cv_text("Senior"), cv_text("Bob")],
        vec![cv_text("Eng"), cv_text("Junior"), cv_text("Carol")],
        vec![cv_text("Eng"), cv_text("Junior"), cv_text("Dave")],
        vec![cv_text("Sales"), cv_text("Senior"), cv_text("Eve")],
        vec![cv_text("Sales"), cv_text("Junior"), cv_text("Frank")],
        vec![cv_text("HR"), cv_text("Senior"), cv_text("Grace")],
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
            id: FieldId::from("level"),
            name: "Level".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("name"),
            name: "Name".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    let row_dept = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("dept"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("name"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // CountA — the CORRECT mapping for OOXML "count" subtotal
    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("name"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Count of Name".to_string()),
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

    // CountA correctly counts text values, so sort_by_value works
    assert_eq!(result.rows.len(), 3);
    assert_eq!(
        result.rows[0].headers[0].value,
        cv_text("Eng"),
        "Eng (4) first"
    );
    assert_eq!(result.rows[0].values[0], cv_num(4.0));
    assert_eq!(
        result.rows[1].headers[0].value,
        cv_text("Sales"),
        "Sales (2) second"
    );
    assert_eq!(result.rows[1].values[0], cv_num(2.0));
    assert_eq!(
        result.rows[2].headers[0].value,
        cv_text("HR"),
        "HR (1) third"
    );
    assert_eq!(result.rows[2].values[0], cv_num(1.0));
}
