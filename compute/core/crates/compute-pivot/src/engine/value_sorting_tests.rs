//! Tests for sort-by-value functionality.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

// ---- sortByValue tests ----

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
fn sort_by_value_with_column_key() {
    // Setup: Region (row), Product (column), Sum of Sales (value)
    // Data layout per row after pivoting (Product has Gadget, Widget as column leaves):
    //   East: Gadget Sales = 800+900 = 1700, Widget Sales = 1000+1200 = 2200
    //   West: Gadget Sales = 700+600 = 1300, Widget Sales = 1500+1800 = 3300
    //
    // Sort by Widget column's values (descending):
    //   West (3300) should come first, East (2200) second.
    //
    // Sort by Gadget column's values (descending):
    //   East (1700) should come first, West (1300) second.
    //
    // Without column_key fix (Bug B1), both would sort by the first column leaf
    // (Gadget, alphabetically first), making the Widget sort behave identically
    // to Gadget sort.

    // Test 1: Sort by Widget column (column_key = "T:widget")
    let mut axis_widget = make_row_axis("region", 0);
    axis_widget.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: Some("T:widget".to_string()),
    });
    let config_widget = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_widget),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result_widget = compute(&config_widget, &sample_sales_data(), Some(&expand_all()));
    assert!(
        result_widget.errors.is_none(),
        "errors: {:?}",
        result_widget.errors
    );
    assert_eq!(result_widget.rows.len(), 2);
    // Sorted by Widget Sales desc: West (3300) first, East (2200) second
    assert_eq!(result_widget.rows[0].headers[0].value, cv_text("West"));
    assert_eq!(result_widget.rows[1].headers[0].value, cv_text("East"));

    // Test 2: Sort by Gadget column (column_key = "T:gadget")
    let mut axis_gadget = make_row_axis("region", 0);
    axis_gadget.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: Some("T:gadget".to_string()),
    });
    let config_gadget = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_gadget),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result_gadget = compute(&config_gadget, &sample_sales_data(), Some(&expand_all()));
    assert!(
        result_gadget.errors.is_none(),
        "errors: {:?}",
        result_gadget.errors
    );
    assert_eq!(result_gadget.rows.len(), 2);
    // Sorted by Gadget Sales desc: East (1700) first, West (1300) second
    assert_eq!(result_gadget.rows[0].headers[0].value, cv_text("East"));
    assert_eq!(result_gadget.rows[1].headers[0].value, cv_text("West"));

    // Test 3: Without column_key (should sort by first column leaf = Gadget)
    let mut axis_none = make_row_axis("region", 0);
    axis_none.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let config_none = make_base_config(
        sample_fields(),
        vec![
            PivotFieldPlacement::Row(axis_none),
            make_placement("product", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result_none = compute(&config_none, &sample_sales_data(), Some(&expand_all()));
    assert!(
        result_none.errors.is_none(),
        "errors: {:?}",
        result_none.errors
    );
    // Without column_key, sorts by first column leaf (Gadget): East (1700) first
    assert_eq!(result_none.rows[0].headers[0].value, cv_text("East"));
    assert_eq!(result_none.rows[1].headers[0].value, cv_text("West"));
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
fn multi_level_sort() {
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
            make_placement("product", PivotFieldArea::Row, 1, None),
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

    // West (4600) should come before East (3900) at top level
    let top_level_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.depth == 0).collect();
    assert_eq!(top_level_rows[0].headers[0].value, cv_text("West"));
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

/// Regression test reproducing the 81vtSE corpus mismatch.
///
/// Models a pivot table with many locations sorted descending by a "variance" field.
/// Most locations have variance=0, so tiebreaking determines their order.
/// The sort-by-value sort must produce deterministic, alphabetical tiebreaking
/// among items with equal aggregated values.
///
/// Bug: formula-eval corpus mode showed 31 mismatches because the standalone
/// pivot computation (from OOXML cache records) produced a different row order
/// than Excel's cached output. The engine's alphabetical tiebreaker among tied
/// values is deterministic but may differ from Excel's order.
#[test]
fn sort_by_value_many_ties_deterministic_order() {
    // 20 locations, most with variance=0, sorted by variance descending.
    // This models the 81vtSE "Variances by Location" pivot table.
    let data: Vec<Vec<CellValue>> = vec![
        vec![
            cv_text("Location"),
            cv_text("InvValue"),
            cv_text("Variance"),
        ],
        // Locations with nonzero variance
        vec![cv_text("Nazareth"), cv_num(5265.0), cv_num(63180.0)],
        vec![cv_text("Shelby"), cv_num(100.0), cv_num(-4862.0)],
        vec![cv_text("Austin"), cv_num(500.0), cv_num(-18119.25)],
        vec![cv_text("Rialto"), cv_num(200.0), cv_num(-194907.75)],
        // Locations with variance=0 (ties)
        vec![cv_text("Perrysburg"), cv_num(1772.16), cv_num(0.0)],
        vec![cv_text("Litchfield Park"), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Boxborough"), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Springfield"), cv_num(11692.80), cv_num(0.0)],
        vec![cv_text("Consignment"), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Millstone"), cv_num(125488.0), cv_num(0.0)],
        vec![cv_text("Dripping Springs"), cv_num(127682.25), cv_num(0.0)],
        vec![cv_text("North Brunswick"), cv_num(3852.0), cv_num(0.0)],
        vec![cv_text("Eastvale"), cv_num(0.0), cv_num(0.0)],
        vec![cv_text("Elizabeth"), cv_num(3852.0), cv_num(0.0)],
        vec![cv_text("Fontana"), cv_num(0.0), cv_num(0.0)],
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
            id: FieldId::from("inv_value"),
            name: "InvValue".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("variance"),
            name: "Variance".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let mut axis = make_row_axis("location", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("variance"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_loc = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        fields,
        vec![
            placement_loc,
            make_placement(
                "inv_value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "variance",
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

    // Verify primary sort by variance descending
    assert_eq!(result.rows[0].headers[0].value, cv_text("Nazareth"));
    assert_approx(&result.rows[0].values[1], 63180.0, "Nazareth variance");

    // All zero-variance locations should come next, in alphabetical order (stable tiebreaker)
    let zero_variance_rows: Vec<&str> = result
        .rows
        .iter()
        .filter(|r| r.values[1] == cv_num(0.0))
        .map(|r| match &r.headers[0].value {
            CellValue::Text(s) => s.as_ref(),
            _ => panic!("expected text header"),
        })
        .collect();

    assert_eq!(
        zero_variance_rows,
        vec![
            "Boxborough",
            "Consignment",
            "Dripping Springs",
            "Eastvale",
            "Elizabeth",
            "Fontana",
            "Litchfield Park",
            "Millstone",
            "North Brunswick",
            "Perrysburg",
            "Springfield",
        ],
        "Zero-variance locations must be in alphabetical order (stable tiebreaker)"
    );

    // Verify each zero-variance location has correct InvValue (not shifted by wrong sort)
    let perrysburg = find_row_by_key(&result.rows, "Perrysburg").unwrap();
    assert_approx(&perrysburg.values[0], 1772.16, "Perrysburg InvValue");
    assert_approx(&perrysburg.values[1], 0.0, "Perrysburg Variance");

    let dripping = find_row_by_key(&result.rows, "Dripping Springs").unwrap();
    assert_approx(&dripping.values[0], 127682.25, "Dripping Springs InvValue");

    // Negative variance locations should come last, in descending order
    let last_row = &result.rows[14];
    assert_eq!(last_row.headers[0].value, cv_text("Rialto"));
    assert_approx(&last_row.values[1], -194907.75, "Rialto variance");
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
fn preserves_subtotals_after_sort() {
    let mut axis = make_row_axis("region", 0);
    axis.show_subtotals = Some(true);
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
            make_placement("product", PivotFieldArea::Row, 1, None),
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

    // Check that subtotals exist
    let subtotal_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.is_subtotal).collect();
    assert!(!subtotal_rows.is_empty());

    // Each subtotal should appear after its parent's children
    for subtotal in &subtotal_rows {
        let parent_key = subtotal.key.replace(SUBTOTAL_SUFFIX, "");
        let parent_index = result.rows.iter().position(|r| r.key == parent_key);
        let subtotal_index = result.rows.iter().position(|r| r.key == subtotal.key);
        assert!(subtotal_index.unwrap() > parent_index.unwrap());
    }
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

// ============================================================================
// Sort-by-value regression tests (moved from pivot_bug_repro_tests.rs)
// ============================================================================

#[test]
fn sort_by_value_inner_row_field_compact_layout() {
    let data = census_data();
    let fields = census_fields();

    // Row field 0: Function (no sort_by_value, just alphabetical)
    let row_function = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("function"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // Row field 1: Role (sort_by_value desc on CountA of EmployeeID)
    let row_role = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("role"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("employee_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // Value: CountA of EmployeeID
    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("employee_id"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Count of EmployeeID".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::CountA,
        number_format: None,
        show_values_as: None,
    });

    let config = make_base_config(fields, vec![row_function, row_role, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Get the leaf rows (depth 1 = Role level) for COGS function
    let leaf_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total && r.depth == 1)
        .collect();

    // Debug: print actual order
    eprintln!("=== Bug 1: Inner sort_by_value (compact) ===");
    for r in &leaf_rows {
        let role = &r.headers.last().unwrap().value;
        let count = &r.values[0];
        eprintln!("  Role: {:?}, Count: {:?}", role, count);
    }

    assert_eq!(leaf_rows.len(), 4, "should have 4 role rows under COGS");

    // Expected order: IC (5), Manager (3), Principal (2), Director (1) — desc by count
    assert_eq!(
        leaf_rows[0].headers.last().unwrap().value,
        cv_text("IC"),
        "IC (count=5) should be first when sorted by count desc"
    );
    assert_eq!(
        leaf_rows[1].headers.last().unwrap().value,
        cv_text("Manager"),
        "Manager (count=3) should be second"
    );
    assert_eq!(
        leaf_rows[2].headers.last().unwrap().value,
        cv_text("Principal"),
        "Principal (count=2) should be third"
    );
    assert_eq!(
        leaf_rows[3].headers.last().unwrap().value,
        cv_text("Director"),
        "Director (count=1) should be last"
    );
}

#[test]
fn sort_by_value_both_row_field_depths() {
    // Data: ServiceLine > EmploymentType, Count of employees
    let data = vec![
        vec![cv_text("ServiceLine"), cv_text("EmpType"), cv_text("EmpID")],
        // SOC: 5 total (Direct=3, Contractor=2)
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E1")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E2")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E3")],
        vec![cv_text("SOC"), cv_text("Contractor"), cv_text("E4")],
        vec![cv_text("SOC"), cv_text("Contractor"), cv_text("E5")],
        // FedRAMP: 3 total (Offshore=2, Direct=1)
        vec![cv_text("FedRAMP"), cv_text("Offshore"), cv_text("E6")],
        vec![cv_text("FedRAMP"), cv_text("Offshore"), cv_text("E7")],
        vec![cv_text("FedRAMP"), cv_text("Direct"), cv_text("E8")],
        // CMMC: 1 total (Direct=1)
        vec![cv_text("CMMC"), cv_text("Direct"), cv_text("E9")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("service_line"),
            name: "ServiceLine".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_type"),
            name: "EmpType".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // Both row fields sort by value desc
    let row_sl = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("service_line"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let row_et = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_type"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
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

    let config = make_base_config(fields, vec![row_sl, row_et, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Debug output
    eprintln!("=== Bug 1b: Both depths sort_by_value ===");
    for r in &result.rows {
        let indent = "  ".repeat(r.depth);
        let label = r
            .headers
            .last()
            .map(|h| format!("{:?}", h.value))
            .unwrap_or_default();
        let val = r
            .values
            .first()
            .map(|v| format!("{:?}", v))
            .unwrap_or_default();
        let kind = if r.is_subtotal { " [subtotal]" } else { "" };
        eprintln!("  {}{} = {}{}", indent, label, val, kind);
    }

    // Depth-0 order: SOC (5), FedRAMP (3), CMMC (1) — desc by total count
    let depth0: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 0 && !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(depth0.len(), 3);
    assert_eq!(
        depth0[0].headers[0].value,
        cv_text("SOC"),
        "SOC (5 employees) should be first"
    );
    assert_eq!(
        depth0[1].headers[0].value,
        cv_text("FedRAMP"),
        "FedRAMP (3 employees) should be second"
    );
    assert_eq!(
        depth0[2].headers[0].value,
        cv_text("CMMC"),
        "CMMC (1 employee) should be third"
    );

    // Within SOC: Direct (3) before Contractor (2)
    let soc_children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 1 && !r.is_subtotal && r.key.starts_with("T:soc"))
        .collect();
    assert_eq!(soc_children.len(), 2);
    assert_eq!(
        soc_children[0].headers.last().unwrap().value,
        cv_text("Direct"),
        "Within SOC, Direct (3) should be before Contractor (2)"
    );
    assert_eq!(
        soc_children[1].headers.last().unwrap().value,
        cv_text("Contractor"),
        "Within SOC, Contractor (2) should be after Direct (3)"
    );
}

#[test]
fn sort_by_value_column_field_desc() {
    // Data: Role (row), ServiceLine (column), EmployeeID (value count)
    let data = vec![
        vec![cv_text("Role"), cv_text("ServiceLine"), cv_text("EmpID")],
        // SOC: 5 employees
        vec![cv_text("IC"), cv_text("SOC"), cv_text("E1")],
        vec![cv_text("IC"), cv_text("SOC"), cv_text("E2")],
        vec![cv_text("IC"), cv_text("SOC"), cv_text("E3")],
        vec![cv_text("Manager"), cv_text("SOC"), cv_text("E4")],
        vec![cv_text("Manager"), cv_text("SOC"), cv_text("E5")],
        // FedRAMP: 3 employees
        vec![cv_text("IC"), cv_text("FedRAMP"), cv_text("E6")],
        vec![cv_text("Manager"), cv_text("FedRAMP"), cv_text("E7")],
        vec![cv_text("IC"), cv_text("FedRAMP"), cv_text("E8")],
        // CMMC: 1 employee
        vec![cv_text("IC"), cv_text("CMMC"), cv_text("E9")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("role"),
            name: "Role".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("service_line"),
            name: "ServiceLine".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    let row_role = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("role"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // Column field: ServiceLine sorted by value desc
    let col_sl = PivotFieldPlacement::Column(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("service_line"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
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

    let config = make_base_config(fields, vec![row_role, col_sl, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Debug output
    eprintln!("=== Bug 2: Column sort_by_value ===");
    eprintln!("  Column headers: {:?}", result.column_headers);

    // Column headers should be sorted by count desc: SOC (5), FedRAMP (3), CMMC (1)
    assert!(
        !result.column_headers.is_empty(),
        "should have column headers"
    );
    let col_labels: Vec<&CellValue> = result
        .column_headers
        .last() // last level = leaf level
        .unwrap()
        .headers
        .iter()
        .map(|h| &h.value)
        .collect();

    assert_eq!(
        col_labels[0],
        &cv_text("SOC"),
        "SOC (5 employees) should be first column (sorted by count desc)"
    );
    assert_eq!(
        col_labels[1],
        &cv_text("FedRAMP"),
        "FedRAMP (3 employees) should be second column"
    );
    assert_eq!(
        col_labels[2],
        &cv_text("CMMC"),
        "CMMC (1 employee) should be third column"
    );
}

#[test]
fn custom_sort_list_no_phantom_rows_for_absent_values() {
    // Data: TermType > Reason, Count of employees
    let data = vec![
        vec![cv_text("TermType"), cv_text("Reason"), cv_text("EmpID")],
        vec![
            cv_text("Involuntary"),
            cv_text("Poor Job Performance"),
            cv_text("E1"),
        ],
        vec![
            cv_text("Involuntary"),
            cv_text("Violation of Company Policy"),
            cv_text("E2"),
        ],
        vec![
            cv_text("Voluntary"),
            cv_text("Contract Ended"),
            cv_text("E3"),
        ],
        vec![
            cv_text("Voluntary"),
            cv_text("Dissatisfied with Job"),
            cv_text("E4"),
        ],
        vec![
            cv_text("Voluntary"),
            cv_text("Family Reasons"),
            cv_text("E5"),
        ],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("term_type"),
            name: "TermType".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("reason"),
            name: "Reason".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // Custom sort list for TermType with an extra value "-" that doesn't exist in data
    let row_tt = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("term_type"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: Some(vec![
            cv_text("-"), // NOT in data — should NOT create a row
            cv_text("Involuntary"),
            cv_text("Voluntary"),
        ]),
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: Some(true),
    });

    // Custom sort list for Reason with many extra values not in data
    let row_reason = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("reason"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: Some(vec![
            cv_text("Poor Job Performance"),
            cv_text("Violation of Company Policy"),
            cv_text("Workforce Reduction"), // NOT in data
            cv_text("Contract Ended"),
            cv_text("Dissatisfied with Job"),
            cv_text("Family Reasons"),
            cv_text("Higher Compensation"), // NOT in data
            cv_text("Relocation"),          // NOT in data
        ]),
        sort_by_value: None,
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

    let config = make_base_config(fields, vec![row_tt, row_reason, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Debug output
    eprintln!("=== Bug 3: Custom sort phantom rows ===");
    for r in &result.rows {
        let indent = "  ".repeat(r.depth);
        let label = r
            .headers
            .iter()
            .map(|h| format!("{:?}", h.value))
            .collect::<Vec<_>>()
            .join(" > ");
        let val = r
            .values
            .first()
            .map(|v| format!("{:?}", v))
            .unwrap_or_default();
        let kind = if r.is_subtotal { " [subtotal]" } else { "" };
        eprintln!("  {}{} = {}{}", indent, label, val, kind);
    }

    // Count only non-subtotal rows
    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    // The custom sort list includes "-" for TermType and 3 extra Reasons
    // that don't exist in the data. These should NOT produce rows.
    // Expected: 2 TermType parents + 5 leaf rows = 7 data rows
    // (2 Involuntary reasons + 3 Voluntary reasons)
    // Bug: extra phantom rows appear for "-", "Workforce Reduction", etc.
    let phantom_rows: Vec<&&PivotRow> = data_rows
        .iter()
        .filter(|r| {
            r.headers.iter().any(|h| match &h.value {
                CellValue::Text(s) => {
                    s.as_ref() == "-"
                        || s.as_ref() == "Workforce Reduction"
                        || s.as_ref() == "Higher Compensation"
                        || s.as_ref() == "Relocation"
                }
                _ => false,
            })
        })
        .collect();

    assert!(
        phantom_rows.is_empty(),
        "Custom sort list items not in data should NOT create phantom rows. Found {} phantom rows: {:?}",
        phantom_rows.len(),
        phantom_rows.iter().map(|r| &r.headers).collect::<Vec<_>>()
    );

    // Total data rows should be exactly the ones in the source data
    // 2 depth-0 (Involuntary, Voluntary) + 5 depth-1 (reasons) = 7
    assert_eq!(
        data_rows.len(),
        7,
        "Should have exactly 7 data rows (2 parents + 5 leaves), got {}",
        data_rows.len()
    );
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

    eprintln!("=== Bug 5: Count on text field ===");
    for r in &result.rows {
        eprintln!("  {:?} = {:?}", r.headers[0].value, r.values[0]);
    }

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

    eprintln!("=== Bug 5: Sort-by-value tiebreaker (no custom_sort_list) ===");
    for r in &result.rows {
        eprintln!("  {:?} = {:?}", r.headers[0].value, r.values[0]);
    }

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

    eprintln!("=== Bug 5b: Four-way tie (no custom_sort_list) ===");
    for r in &result.rows {
        eprintln!("  {:?} = {:?}", r.headers[0].value, r.values[0]);
    }

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

    eprintln!("=== Bug 7: Custom sort list as tiebreaker ===");
    for r in &result.rows {
        eprintln!("  {:?} = {:?}", r.headers[0].value, r.values[0]);
    }

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

#[test]
fn sort_by_value_hierarchical_tiebreaker_with_subtotals() {
    // Mimics MuihIu PivotTable1: tabular layout, 2 row fields, both with
    // sort_by_value(Desc), and subtotals enabled on the outer field.
    //
    // The outer field has groups with tied counts. With subtotals, the
    // tiebreaker order affects both the group header position AND the
    // subtotal row position.

    let data = vec![
        vec![cv_text("Dept"), cv_text("Type"), cv_text("EmpID")],
        // Marketing: Direct=1
        vec![cv_text("Marketing"), cv_text("Direct"), cv_text("E1")],
        // Infrastructure: Direct=1 (same total as Marketing)
        vec![cv_text("Infrastructure"), cv_text("Direct"), cv_text("E2")],
        // SOC: Direct=3, Offshore=1 (highest total)
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E3")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E4")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E5")],
        vec![cv_text("SOC"), cv_text("Offshore"), cv_text("E6")],
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
            id: FieldId::from("type"),
            name: "Type".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    // Outer row field: Dept, sort_by_value desc, with custom_sort_list tiebreaker
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
            cv_text("Marketing"),
            cv_text("Infrastructure"),
            cv_text("SOC"),
        ]),
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("emp_id"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: Some(true),
    });

    // Inner row field: Type, sort_by_value desc
    let row_type = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("type"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
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

    let mut config = make_base_config(fields, vec![row_dept, row_type, value_count], vec![]);
    config.layout = Some(PivotTableLayout {
        layout_form: Some(LayoutForm::Tabular),
        show_row_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    eprintln!("=== Bug 8: Hierarchical sort tiebreaker with subtotals ===");
    for r in &result.rows {
        let indent = if r.is_subtotal { "  " } else { "" };
        let headers_str: Vec<String> = r.headers.iter().map(|h| format!("{:?}", h.value)).collect();
        eprintln!(
            "  {}d{} [{}] = {:?}",
            indent,
            r.depth,
            headers_str.join(", "),
            r.values.first()
        );
    }

    // Expected tabular row order:
    // 1. SOC | Direct (3)        ← SOC has 4 total, highest
    // 2. SOC | Offshore (1)
    // 3. SOC Total
    // 4. Marketing | Direct (1)  ← Marketing=1, Infra=1, tied — Marketing first per custom_sort_list
    // 5. Marketing Total
    // 6. Infrastructure | Direct (1)
    // 7. Infrastructure Total

    // Verify depth-0 order: SOC (4), then Marketing (1), then Infrastructure (1)
    // Find the first non-subtotal depth-0 rows to check order
    let first_leaf = result.rows.iter().find(|r| r.depth == 1 && !r.is_subtotal);
    assert!(first_leaf.is_some(), "should have leaf rows");

    // The first leaf should be under SOC (highest count)
    let first = first_leaf.unwrap();
    assert_eq!(
        first.headers[0].value,
        cv_text("SOC"),
        "First group should be SOC (count=4, highest)"
    );

    // After SOC's subtotal, the next leaf should be under Marketing (tied with Infrastructure, but first in custom_sort_list)
    let non_soc_leaves: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 1 && !r.is_subtotal && r.headers[0].value != cv_text("SOC"))
        .collect();

    assert!(
        non_soc_leaves.len() >= 2,
        "should have leaves for Marketing and Infrastructure"
    );
    assert_eq!(
        non_soc_leaves[0].headers[0].value,
        cv_text("Marketing"),
        "Marketing (count=1) should come before Infrastructure (count=1) — tiebreaker: custom_sort_list"
    );
    assert_eq!(
        non_soc_leaves[1].headers[0].value,
        cv_text("Infrastructure"),
        "Infrastructure (count=1) should come after Marketing — later in custom_sort_list"
    );
}

#[test]
fn sort_by_value_with_column_key_multi_level() {
    // Data: BusinessUnit (row), FiscalYear (column), Amount (value)
    // FY2023 and FY2024 have very different distributions than FY2022.
    let data = vec![
        vec![
            cv_text("BusinessUnit"),
            cv_text("FiscalYear"),
            cv_text("Amount"),
        ],
        // Alpha: FY2022=100, FY2023=500, FY2024=50 (small in 2024)
        vec![cv_text("Alpha"), cv_text("2022"), cv_num(100.0)],
        vec![cv_text("Alpha"), cv_text("2023"), cv_num(500.0)],
        vec![cv_text("Alpha"), cv_text("2024"), cv_num(50.0)],
        // Beta: FY2022=200, FY2023=100, FY2024=300 (largest in 2024)
        vec![cv_text("Beta"), cv_text("2022"), cv_num(200.0)],
        vec![cv_text("Beta"), cv_text("2023"), cv_num(100.0)],
        vec![cv_text("Beta"), cv_text("2024"), cv_num(300.0)],
        // Gamma: FY2022=300, FY2023=200, FY2024=150 (middle in 2024)
        vec![cv_text("Gamma"), cv_text("2022"), cv_num(300.0)],
        vec![cv_text("Gamma"), cv_text("2023"), cv_num(200.0)],
        vec![cv_text("Gamma"), cv_text("2024"), cv_num(150.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("bu"),
            name: "BusinessUnit".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("fy"),
            name: "FiscalYear".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    // Row: BusinessUnit, sorted by value DESC using column_key="T:2024"
    let row_bu = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("bu"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("amount"),
            order: SortDirection::Desc,
            column_key: Some("T:2024".to_string()),
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    // Column: FiscalYear
    let col_fy = make_placement("fy", PivotFieldArea::Column, 0, None);

    // Value: Sum of Amount
    let val_amount = make_placement(
        "amount",
        PivotFieldArea::Value,
        0,
        Some(AggregateFunction::Sum),
    );

    let config = make_base_config(fields, vec![row_bu, col_fy, val_amount], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Debug output
    eprintln!("=== Bug 9: sort_by_value with column_key ===");
    eprintln!("  Column headers: {:?}", result.column_headers);
    for r in &result.rows {
        let label = r
            .headers
            .last()
            .map(|h| format!("{:?}", h.value))
            .unwrap_or_default();
        let vals: Vec<String> = r.values.iter().map(|v| format!("{:?}", v)).collect();
        let kind = if r.is_grand_total {
            " [grand total]"
        } else {
            ""
        };
        eprintln!("  {} = [{}]{}", label, vals.join(", "), kind);
    }

    // When sorted by FY2024 DESC: Beta (300) > Gamma (150) > Alpha (50)
    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    assert_eq!(data_rows.len(), 3);
    assert_eq!(
        data_rows[0].headers[0].value,
        cv_text("Beta"),
        "Beta (FY2024=300) should be first when sorted by FY2024 desc"
    );
    assert_eq!(
        data_rows[1].headers[0].value,
        cv_text("Gamma"),
        "Gamma (FY2024=150) should be second"
    );
    assert_eq!(
        data_rows[2].headers[0].value,
        cv_text("Alpha"),
        "Alpha (FY2024=50) should be third"
    );
}

#[test]
fn sort_by_value_column_key_multi_level_compact() {
    // Mimics mWzMdU: 5-level compact pivot with sort-by-value using column_key.
    // Row fields: Group > Segment > BU > Channel > Product
    // Column field: Year (2022, 2023, 2024)
    // Value: Sum of Amount
    // BU field sorted DESC by FY2024 values (column_key)
    //
    // Key scenario: BU sort order differs between FY2022 and FY2024.
    // Without column_key, engine sorts by first column (FY2022) = wrong order.

    let data = vec![
        vec![
            cv_text("Group"),
            cv_text("Segment"),
            cv_text("BU"),
            cv_text("Channel"),
            cv_text("Product"),
            cv_text("Year"),
            cv_text("Amount"),
        ],
        // Group=Corp, Segment=Power, BU=Motors
        //   FY2022=10, FY2023=20, FY2024=90 (largest BU in 2024)
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Motors"),
            cv_text("Direct"),
            cv_text("Pump-A"),
            cv_text("2022"),
            cv_num(10.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Motors"),
            cv_text("Direct"),
            cv_text("Pump-A"),
            cv_text("2023"),
            cv_num(20.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Motors"),
            cv_text("Direct"),
            cv_text("Pump-A"),
            cv_text("2024"),
            cv_num(90.0),
        ],
        // Group=Corp, Segment=Power, BU=HVAC
        //   FY2022=80, FY2023=50, FY2024=30 (smallest BU in 2024)
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("HVAC"),
            cv_text("OEM"),
            cv_text("Fan-X"),
            cv_text("2022"),
            cv_num(80.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("HVAC"),
            cv_text("OEM"),
            cv_text("Fan-X"),
            cv_text("2023"),
            cv_num(50.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("HVAC"),
            cv_text("OEM"),
            cv_text("Fan-X"),
            cv_text("2024"),
            cv_num(30.0),
        ],
        // Group=Corp, Segment=Power, BU=Combustion
        //   FY2022=50, FY2023=60, FY2024=60 (middle BU in 2024)
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Combustion"),
            cv_text("Direct"),
            cv_text("Burner-1"),
            cv_text("2022"),
            cv_num(50.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Combustion"),
            cv_text("Direct"),
            cv_text("Burner-1"),
            cv_text("2023"),
            cv_num(60.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Combustion"),
            cv_text("Direct"),
            cv_text("Burner-1"),
            cv_text("2024"),
            cv_num(60.0),
        ],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("group"),
            name: "Group".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("segment"),
            name: "Segment".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("bu"),
            name: "BU".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("channel"),
            name: "Channel".to_string(),
            source_column: 3,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("product"),
            name: "Product".to_string(),
            source_column: 4,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("year"),
            name: "Year".to_string(),
            source_column: 5,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".to_string(),
            source_column: 6,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    // 5 row fields, BU at depth 2 has sort_by_value with column_key
    let row_group = make_placement("group", PivotFieldArea::Row, 0, None);
    let row_segment = make_placement("segment", PivotFieldArea::Row, 1, None);

    // BU: sort by value DESC, specifically by FY2024 column
    let row_bu = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("bu"),
            placement_id: crate::types::PlacementId::default(),
            position: 2,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("amount"),
            order: SortDirection::Desc,
            column_key: Some("T:2024".to_string()),
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let row_channel = make_placement("channel", PivotFieldArea::Row, 3, None);
    let row_product = make_placement("product", PivotFieldArea::Row, 4, None);

    let col_year = make_placement("year", PivotFieldArea::Column, 0, None);
    let val_amount = make_placement(
        "amount",
        PivotFieldArea::Value,
        0,
        Some(AggregateFunction::Sum),
    );

    let config = make_base_config(
        fields,
        vec![
            row_group,
            row_segment,
            row_bu,
            row_channel,
            row_product,
            col_year,
            val_amount,
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Debug output
    eprintln!("=== Bug 11: Multi-level sort_by_value with column_key ===");
    for r in &result.rows {
        let indent = "  ".repeat(r.depth);
        let label = r
            .headers
            .last()
            .map(|h| format!("{:?}", h.value))
            .unwrap_or_default();
        let vals: Vec<String> = r.values.iter().map(|v| format!("{:?}", v)).collect();
        let kind = if r.is_subtotal {
            " [subtotal]"
        } else if r.is_grand_total {
            " [grand total]"
        } else {
            ""
        };
        eprintln!("  {}{} = [{}]{}", indent, label, vals.join(", "), kind);
    }

    // BU rows at depth 2, sorted by FY2024 DESC:
    //   Motors (90) > Combustion (60) > HVAC (30)
    let bu_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 2 && !r.is_subtotal && !r.is_grand_total)
        .collect();

    assert_eq!(bu_rows.len(), 3, "should have 3 BU rows");
    assert_eq!(
        bu_rows[0].headers.last().unwrap().value,
        cv_text("Motors"),
        "Motors (FY2024=90) should be first when sorted by FY2024 desc"
    );
    assert_eq!(
        bu_rows[1].headers.last().unwrap().value,
        cv_text("Combustion"),
        "Combustion (FY2024=60) should be second"
    );
    assert_eq!(
        bu_rows[2].headers.last().unwrap().value,
        cv_text("HVAC"),
        "HVAC (FY2024=30) should be third"
    );
}

/// Verify that sort-by-value with many tied items produces deterministic,
/// correctly-aligned output: each location's aggregated values must appear
/// at that location's row position regardless of input data order.
#[test]
fn sort_by_value_tiebreak_alignment() {
    // Simplified model of the 81vtSE pivot: Location → Sum(InvValue), Sum(Variance)
    // Sort by Variance descending. Most locations have Variance=0.
    let data: Vec<Vec<CellValue>> = vec![
        vec![
            cv_text("Location"),
            cv_text("InvValue"),
            cv_text("ReportedInv"),
            cv_text("Variance"),
        ],
        // Non-zero variance
        vec![
            cv_text("Nazareth"),
            cv_num(5265.0),
            cv_num(68445.0),
            cv_num(63180.0),
        ],
        vec![
            cv_text("Shelby"),
            cv_num(100.0),
            cv_num(100.0),
            cv_num(-4862.0),
        ],
        vec![
            cv_text("Austin"),
            cv_num(500.0),
            cv_num(500.0),
            cv_num(-18119.25),
        ],
        // Zero variance — different InvValue each (this is what makes misalignment visible)
        vec![
            cv_text("Perrysburg"),
            cv_num(1772.16),
            cv_num(1772.16),
            cv_num(0.0),
        ],
        vec![
            cv_text("Springfield"),
            cv_num(11692.80),
            cv_num(11692.80),
            cv_num(0.0),
        ],
        vec![
            cv_text("Dripping Springs"),
            cv_num(127682.25),
            cv_num(127682.25),
            cv_num(0.0),
        ],
        vec![cv_text("Boxborough"), cv_num(0.0), cv_num(0.0), cv_num(0.0)],
        vec![
            cv_text("Consignment"),
            cv_num(0.0),
            cv_num(0.0),
            cv_num(0.0),
        ],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("location"),
            name: "Location".into(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("inv_value"),
            name: "InvValue".into(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("reported_inv"),
            name: "ReportedInv".into(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("variance"),
            name: "Variance".into(),
            source_column: 3,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let mut axis = make_row_axis("location", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("variance"),
        order: SortDirection::Desc,
        column_key: None,
    });

    let config = make_base_config(
        fields,
        vec![
            PivotFieldPlacement::Row(axis),
            make_placement(
                "inv_value",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "reported_inv",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Sum),
            ),
            make_placement(
                "variance",
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

    // Row 0: Nazareth (highest variance: 63180)
    assert_eq!(result.rows[0].headers[0].value, cv_text("Nazareth"));
    assert_approx(&result.rows[0].values[0], 5265.0, "Nazareth InvValue");
    assert_approx(&result.rows[0].values[2], 63180.0, "Nazareth Variance");

    // Rows 1-5: zero-variance items in alphabetical order
    let zero_labels: Vec<String> = result.rows[1..=5]
        .iter()
        .map(|r| match &r.headers[0].value {
            CellValue::Text(s) => s.to_string(),
            _ => panic!("expected text"),
        })
        .collect();
    assert_eq!(
        zero_labels,
        vec![
            "Boxborough",
            "Consignment",
            "Dripping Springs",
            "Perrysburg",
            "Springfield"
        ],
        "zero-variance items alphabetically ordered"
    );

    // Critically: each location's InvValue must match its own data, not be shifted
    let perrysburg = find_row_by_key(&result.rows, "Perrysburg").unwrap();
    assert_approx(
        &perrysburg.values[0],
        1772.16,
        "Perrysburg InvValue aligned",
    );

    let dripping = find_row_by_key(&result.rows, "Dripping Springs").unwrap();
    assert_approx(
        &dripping.values[0],
        127682.25,
        "Dripping Springs InvValue aligned",
    );

    let springfield = find_row_by_key(&result.rows, "Springfield").unwrap();
    assert_approx(
        &springfield.values[0],
        11692.80,
        "Springfield InvValue aligned",
    );

    // Rows 6-7: negative variance, descending (Shelby > Austin)
    assert_eq!(result.rows[6].headers[0].value, cv_text("Shelby"));
    assert_eq!(result.rows[7].headers[0].value, cv_text("Austin"));
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

#[test]
fn custom_sort_list_not_reversed_by_desc_direction() {
    // Scenario: pivot with custom sort [IC, Associate, Manager, Director, Principal]
    // and sortType="descending". Excel keeps items in custom order; our engine
    // was reversing them among themselves.
    let data = vec![
        vec![cv_text("Role"), cv_text("Count")],
        vec![cv_text("IC"), cv_num(100.0)],
        vec![cv_text("Associate"), cv_num(50.0)],
        vec![cv_text("Manager"), cv_num(30.0)],
        vec![cv_text("Director"), cv_num(10.0)],
        vec![cv_text("Principal"), cv_num(5.0)],
    ];

    let fields = detect_fields(&data);
    let config = make_base_config(
        fields.clone(),
        vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[0].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                sort_order: Some(SortDirection::Desc),
                custom_sort_list: Some(vec![
                    cv_text("IC"),
                    cv_text("Associate"),
                    cv_text("Manager"),
                    cv_text("Director"),
                    cv_text("Principal"),
                ]),
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: Some(false),
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: fields[1].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: None,
            }),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let row_labels: Vec<String> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .map(|r| match &r.headers[0].value {
            CellValue::Text(s) => s.to_string(),
            other => format!("{:?}", other),
        })
        .collect();

    // Custom sort list defines absolute order — direction must NOT reverse it.
    // Director and Principal must NOT be swapped.
    assert_eq!(
        row_labels,
        vec!["IC", "Associate", "Manager", "Director", "Principal"],
        "Custom sort list order must be preserved regardless of sort direction.\n\
         Bug: descending direction was reversing custom list indices,\n\
         swapping Director and Principal."
    );
}

// ============================================================================
// sort_by_value with column_key targets a specific column
// ============================================================================
// Corpus file mWzMdU: autoSortScope specifies sort by FY2024 column.
// Data is designed so FY2022 and FY2024 have opposite sort orders.

/// Helper: shared data for column_key tests.
fn column_key_test_data() -> (Vec<Vec<CellValue>>, Vec<PivotField>) {
    let data = vec![
        vec![cv_text("BU"), cv_text("Year"), cv_text("Amount")],
        // Alpha: FY2022=100, FY2024=50 (smallest in 2024, middle in 2022)
        vec![cv_text("Alpha"), cv_text("2022"), cv_num(100.0)],
        vec![cv_text("Alpha"), cv_text("2023"), cv_num(500.0)],
        vec![cv_text("Alpha"), cv_text("2024"), cv_num(50.0)],
        // Beta: FY2022=200, FY2024=300 (largest in 2024, middle in 2022)
        vec![cv_text("Beta"), cv_text("2022"), cv_num(200.0)],
        vec![cv_text("Beta"), cv_text("2023"), cv_num(100.0)],
        vec![cv_text("Beta"), cv_text("2024"), cv_num(300.0)],
        // Gamma: FY2022=300, FY2024=150 (middle in 2024, largest in 2022)
        vec![cv_text("Gamma"), cv_text("2022"), cv_num(300.0)],
        vec![cv_text("Gamma"), cv_text("2023"), cv_num(200.0)],
        vec![cv_text("Gamma"), cv_text("2024"), cv_num(150.0)],
    ];
    let fields = vec![
        PivotField {
            id: FieldId::from("bu"),
            name: "BU".into(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("year"),
            name: "Year".into(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".into(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];
    (data, fields)
}

#[test]
fn sort_by_value_with_column_key_sorts_by_specified_column() {
    let (data, fields) = column_key_test_data();

    let row_bu = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("bu"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("amount"),
            order: SortDirection::Desc,
            column_key: Some("T:2024".to_string()),
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let config = make_base_config(
        fields,
        vec![
            row_bu,
            make_placement("year", PivotFieldArea::Column, 0, None),
            make_placement(
                "amount",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(rows.len(), 3);

    // Sorted by FY2024 DESC: Beta(300) > Gamma(150) > Alpha(50)
    assert_eq!(rows[0].headers[0].value, cv_text("Beta"));
    assert_eq!(rows[1].headers[0].value, cv_text("Gamma"));
    assert_eq!(rows[2].headers[0].value, cv_text("Alpha"));
}

#[test]
fn sort_by_value_without_column_key_falls_back_to_first_column() {
    let (data, fields) = column_key_test_data();

    let row_bu = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("bu"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("amount"),
            order: SortDirection::Desc,
            column_key: None, // No column specified — falls back to first column (FY2022)
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let config = make_base_config(
        fields,
        vec![
            row_bu,
            make_placement("year", PivotFieldArea::Column, 0, None),
            make_placement(
                "amount",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(rows.len(), 3);

    // No column_key → sorts by first column leaf (FY2022) DESC: Gamma(300) > Beta(200) > Alpha(100)
    assert_eq!(rows[0].headers[0].value, cv_text("Gamma"));
    assert_eq!(rows[1].headers[0].value, cv_text("Beta"));
    assert_eq!(rows[2].headers[0].value, cv_text("Alpha"));
}

// ============================================================================
// Explicit collapse-all expansion state collapses all groups
// ============================================================================

#[test]
fn explicit_collapse_all_state_collapses_all_groups() {
    let data = vec![
        vec![
            cv_text("Division"),
            cv_text("Department"),
            cv_text("Salary"),
        ],
        vec![cv_text("Engineering"), cv_text("Backend"), cv_num(120000.0)],
        vec![
            cv_text("Engineering"),
            cv_text("Frontend"),
            cv_num(105000.0),
        ],
        vec![cv_text("Sales"), cv_text("Enterprise"), cv_num(90000.0)],
        vec![cv_text("Sales"), cv_text("SMB"), cv_num(85000.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("div"),
            name: "Division".into(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("dept"),
            name: "Department".into(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sal"),
            name: "Salary".into(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let config = make_base_config(
        fields,
        vec![
            make_placement("div", PivotFieldArea::Row, 0, None),
            make_placement("dept", PivotFieldArea::Row, 1, None),
            make_placement(
                "sal",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    // Explicit collapse-all: non-empty set with sentinel key makes all real keys absent → collapsed
    let collapse_all = PivotExpansionState {
        expanded_rows: std::collections::HashSet::from(["__COLLAPSE_ALL__".to_string()]),
        expanded_columns: std::collections::HashSet::new(),
        expanded_row_keys: Vec::new(),
        expanded_column_keys: Vec::new(),
    };
    let result = compute(&config, &data, Some(&collapse_all));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let children: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth >= 1 && !r.is_subtotal && !r.is_grand_total)
        .collect();

    assert!(
        children.is_empty(),
        "explicit collapse-all should hide all depth>=1 rows, found {}",
        children.len()
    );

    // Top-level division rows should still appear
    let top_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 0 && !r.is_subtotal && !r.is_grand_total)
        .collect();
    assert_eq!(
        top_rows.len(),
        2,
        "should have Engineering and Sales at depth 0"
    );
}

// ============================================================================
// Multi-level sort_by_value with column_key at inner depth
// ============================================================================
// 5-level hierarchy where BU (depth 2) sorts by FY2024.
// FY2022 and FY2024 have opposite BU orderings.

#[test]
fn sort_by_value_multi_level_with_column_key_at_inner_depth() {
    let data = vec![
        vec![
            cv_text("Group"),
            cv_text("Segment"),
            cv_text("BU"),
            cv_text("Channel"),
            cv_text("Product"),
            cv_text("Year"),
            cv_text("Amount"),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Motors"),
            cv_text("Direct"),
            cv_text("Pump-A"),
            cv_text("2022"),
            cv_num(10.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Motors"),
            cv_text("Direct"),
            cv_text("Pump-A"),
            cv_text("2023"),
            cv_num(20.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Motors"),
            cv_text("Direct"),
            cv_text("Pump-A"),
            cv_text("2024"),
            cv_num(90.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("HVAC"),
            cv_text("OEM"),
            cv_text("Fan-X"),
            cv_text("2022"),
            cv_num(80.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("HVAC"),
            cv_text("OEM"),
            cv_text("Fan-X"),
            cv_text("2023"),
            cv_num(50.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("HVAC"),
            cv_text("OEM"),
            cv_text("Fan-X"),
            cv_text("2024"),
            cv_num(30.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Combustion"),
            cv_text("Direct"),
            cv_text("Burner-1"),
            cv_text("2022"),
            cv_num(50.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Combustion"),
            cv_text("Direct"),
            cv_text("Burner-1"),
            cv_text("2023"),
            cv_num(60.0),
        ],
        vec![
            cv_text("Corp"),
            cv_text("Power"),
            cv_text("Combustion"),
            cv_text("Direct"),
            cv_text("Burner-1"),
            cv_text("2024"),
            cv_num(60.0),
        ],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("group"),
            name: "Group".into(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("segment"),
            name: "Segment".into(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("bu"),
            name: "BU".into(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("channel"),
            name: "Channel".into(),
            source_column: 3,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("product"),
            name: "Product".into(),
            source_column: 4,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("year"),
            name: "Year".into(),
            source_column: 5,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("amount"),
            name: "Amount".into(),
            source_column: 6,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let row_bu = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("bu"),
            placement_id: crate::types::PlacementId::default(),
            position: 2,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("amount"),
            order: SortDirection::Desc,
            column_key: Some("T:2024".to_string()),
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let config = make_base_config(
        fields,
        vec![
            make_placement("group", PivotFieldArea::Row, 0, None),
            make_placement("segment", PivotFieldArea::Row, 1, None),
            row_bu,
            make_placement("channel", PivotFieldArea::Row, 3, None),
            make_placement("product", PivotFieldArea::Row, 4, None),
            make_placement("year", PivotFieldArea::Column, 0, None),
            make_placement(
                "amount",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let bu_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| r.depth == 2 && !r.is_subtotal && !r.is_grand_total)
        .collect();

    assert_eq!(bu_rows.len(), 3);
    // By FY2024 DESC: Motors(90) > Combustion(60) > HVAC(30)
    assert_eq!(bu_rows[0].headers.last().unwrap().value, cv_text("Motors"));
    assert_eq!(
        bu_rows[1].headers.last().unwrap().value,
        cv_text("Combustion")
    );
    assert_eq!(bu_rows[2].headers.last().unwrap().value, cv_text("HVAC"));
}
