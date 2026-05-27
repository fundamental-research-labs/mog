use super::helpers::*;
use super::*;

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
