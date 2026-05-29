use super::common::*;
use super::*;
use cell_types::SheetId;

// ---- config: to_pivot_table_def ----

#[test]
fn config_to_pivot_table_def_basic() {
    let config = make_test_config_with_fields();
    let output_sheet_id = SheetId::from_raw(42);
    let bounds = PivotRenderedBounds {
        total_rows: 20,
        total_cols: 10,
        first_data_row: 2,
        first_data_col: 1,
        num_data_cols: 0,
    };
    let def = config.to_pivot_table_def(&bounds, &output_sheet_id);

    assert_eq!(def.id, config.id);
    assert_eq!(def.name, "Test Pivot");
    assert_eq!(def.sheet, output_sheet_id.to_uuid_string());
    assert_eq!(def.start_row, 5);
    assert_eq!(def.start_col, 2);
    // end = start + total - 1
    assert_eq!(def.end_row, 5 + 20 - 1);
    assert_eq!(def.end_col, 2 + 10 - 1);
    assert_eq!(def.rendered_rows, Some(20));
    assert_eq!(def.rendered_cols, Some(10));
    assert_eq!(def.first_data_row, 2);
    assert_eq!(def.first_data_col, 1);
    assert_eq!(def.data_on_rows, false);
}

#[test]
fn config_to_pivot_table_def_empty_bounds_stays_empty() {
    let config = make_test_config_with_fields();
    let output_sheet_id = SheetId::from_raw(42);
    let bounds = PivotRenderedBounds {
        total_rows: 0,
        total_cols: 0,
        first_data_row: 0,
        first_data_col: 0,
        num_data_cols: 0,
    };
    let def = config.to_pivot_table_def(&bounds, &output_sheet_id);

    assert_eq!(def.rendered_rows, Some(0));
    assert_eq!(def.rendered_cols, Some(0));
    assert!(def.is_empty_rendered_region());
}

#[test]
fn config_to_pivot_table_def_data_field_names_with_display_name() {
    let config = make_test_config_with_fields();
    let bounds = PivotRenderedBounds {
        total_rows: 10,
        total_cols: 5,
        first_data_row: 1,
        first_data_col: 1,
        num_data_cols: 0,
    };
    let def = config.to_pivot_table_def(&bounds, &SheetId::from_raw(42));

    // First value placement ("sales") has no display_name -> "Sum of Sales"
    // Second value placement ("cost") has display_name "Total Cost"
    assert_eq!(def.data_field_names.len(), 2);
    assert_eq!(def.data_field_names[0], "Sum of Sales");
    assert_eq!(def.data_field_names[1], "Total Cost");
}

#[test]
fn config_to_pivot_table_def_cache_field_names() {
    let config = make_test_config_with_fields();
    let bounds = PivotRenderedBounds {
        total_rows: 10,
        total_cols: 5,
        first_data_row: 1,
        first_data_col: 1,
        num_data_cols: 0,
    };
    let def = config.to_pivot_table_def(&bounds, &SheetId::from_raw(42));

    assert_eq!(
        def.cache_field_names,
        vec!["Region", "Quarter", "Sales", "Cost"]
    );
}

#[test]
fn config_to_pivot_table_def_row_and_col_field_indices() {
    let config = make_test_config_with_fields();
    let bounds = PivotRenderedBounds {
        total_rows: 10,
        total_cols: 5,
        first_data_row: 1,
        first_data_col: 1,
        num_data_cols: 0,
    };
    let def = config.to_pivot_table_def(&bounds, &SheetId::from_raw(42));

    // "region" is fields[0], so row_field_indices = [0]
    assert_eq!(def.row_field_indices, vec![0]);
    // "quarter" is fields[1], so col_field_indices = [1]
    assert_eq!(def.col_field_indices, vec![1]);
}

#[test]
fn config_to_pivot_table_def_agg_labels_in_data_field_names() {
    // Test all aggregate function labels through to_pivot_table_def
    let agg_cases = vec![
        (AggregateFunction::Sum, "Sum of Sales"),
        (AggregateFunction::Count, "Count of Sales"),
        (AggregateFunction::CountA, "Count of Sales"),
        (AggregateFunction::CountUnique, "Count of Sales"),
        (AggregateFunction::Average, "Average of Sales"),
        (AggregateFunction::Min, "Min of Sales"),
        (AggregateFunction::Max, "Max of Sales"),
        (AggregateFunction::Product, "Product of Sales"),
        (AggregateFunction::StdDev, "StdDev of Sales"),
        (AggregateFunction::StdDevP, "StdDevP of Sales"),
        (AggregateFunction::Var, "Var of Sales"),
        (AggregateFunction::VarP, "VarP of Sales"),
    ];
    let bounds = PivotRenderedBounds {
        total_rows: 10,
        total_cols: 5,
        first_data_row: 1,
        first_data_col: 1,
        num_data_cols: 0,
    };

    for (agg, expected_label) in agg_cases {
        let config = PivotTableConfig {
            schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
            id: "test".to_string(),
            name: "T".to_string(),
            source_sheet_id: None,
            source_sheet_name: "s1".to_string(),
            source_range: CellRange::new(0, 0, 10, 1),
            output_sheet_name: "s2".to_string(),
            output_location: OutputLocation { row: 0, col: 0 },
            fields: vec![PivotField {
                id: FieldId::new("sales"),
                name: "Sales".to_string(),
                source_column: 0,
                data_type: DetectedDataType::Number,
                ..Default::default()
            }],
            placements: vec![PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::new("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: agg,
                number_format: None,
                show_values_as: None,
            })],
            filters: vec![],
            layout: None,
            style: None,
            data_options: None,
            created_at: None,
            updated_at: None,
            calculated_fields: None,
            allow_multiple_filters_per_field: None,
            auto_format: None,
            preserve_formatting: None,
            data_on_rows: None,
            cache_id: None,
            ref_range: None,
            first_data_row: None,
            first_header_row: None,
            first_data_col: None,
            rows_per_page: None,
            cols_per_page: None,
            row_items: Vec::new(),
            col_items: Vec::new(),
        };

        let def = config.to_pivot_table_def(&bounds, &SheetId::from_raw(42));
        assert_eq!(
            def.data_field_names[0], expected_label,
            "Failed for aggregate {:?}",
            agg
        );
    }
}

#[test]
fn config_to_pivot_table_def_unknown_field_shows_question_mark() {
    // Value placement references a field_id not in the fields list
    let config = PivotTableConfig {
        schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: "test".to_string(),
        name: "T".to_string(),
        source_sheet_id: None,
        source_sheet_name: "s1".to_string(),
        source_range: CellRange::new(0, 0, 10, 1),
        output_sheet_name: "s2".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: vec![], // no fields!
        placements: vec![make_value("ghost", 0)],
        filters: vec![],
        layout: None,
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        data_on_rows: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_header_row: None,
        first_data_col: None,
        rows_per_page: None,
        cols_per_page: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    };
    let bounds = PivotRenderedBounds {
        total_rows: 5,
        total_cols: 3,
        first_data_row: 1,
        first_data_col: 1,
        num_data_cols: 0,
    };
    let def = config.to_pivot_table_def(&bounds, &SheetId::from_raw(42));
    assert_eq!(def.data_field_names[0], "Sum of ?");
}
