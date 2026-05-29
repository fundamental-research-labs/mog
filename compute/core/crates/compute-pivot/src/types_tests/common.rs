use super::*;

// ---- reorder_placement tests ----

/// Helper to create a minimal PivotTableConfig for reorder tests.
pub(super) fn make_reorder_config(placements: Vec<PivotFieldPlacement>) -> PivotTableConfig {
    PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id: "test".to_string(),
        name: "Test".to_string(),
        source_sheet_id: None,
        source_sheet_name: "sheet1".to_string(),
        source_range: CellRange::new(0, 0, 10, 5),
        output_sheet_name: "sheet2".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: vec![],
        placements,
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
    }
}

pub(super) fn make_row(field_id: &str, position: usize) -> PivotFieldPlacement {
    PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from(field_id),
            placement_id: crate::types::PlacementId::default(),
            position,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    })
}

pub(super) fn make_column(field_id: &str, position: usize) -> PivotFieldPlacement {
    PivotFieldPlacement::Column(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from(field_id),
            placement_id: crate::types::PlacementId::default(),
            position,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    })
}

pub(super) fn make_value(field_id: &str, position: usize) -> PivotFieldPlacement {
    PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from(field_id),
            placement_id: crate::types::PlacementId::default(),
            position,
            display_name: None,
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Sum,
        number_format: None,
        show_values_as: None,
    })
}

// ---- reorder_placement: move to filter area ----

pub(super) fn make_filter(field_id: &str, position: usize) -> PivotFieldPlacement {
    PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new(field_id),
            placement_id: crate::types::PlacementId::default(),
            position,
            display_name: None,
        },
    })
}

// ---- config: get_field ----

pub(super) fn make_test_config_with_fields() -> PivotTableConfig {
    PivotTableConfig {
        schema_version: PIVOT_CONFIG_SCHEMA_VERSION,
        id: "test".to_string(),
        name: "Test Pivot".to_string(),
        source_sheet_id: None,
        source_sheet_name: "sheet1".to_string(),
        source_range: CellRange::new(0, 0, 100, 3),
        output_sheet_name: "sheet2".to_string(),
        output_location: OutputLocation { row: 5, col: 2 },
        fields: vec![
            PivotField {
                id: FieldId::new("region"),
                name: "Region".to_string(),
                source_column: 0,
                data_type: DetectedDataType::String,
                ..Default::default()
            },
            PivotField {
                id: FieldId::new("quarter"),
                name: "Quarter".to_string(),
                source_column: 1,
                data_type: DetectedDataType::String,
                ..Default::default()
            },
            PivotField {
                id: FieldId::new("sales"),
                name: "Sales".to_string(),
                source_column: 2,
                data_type: DetectedDataType::Number,
                ..Default::default()
            },
            PivotField {
                id: FieldId::new("cost"),
                name: "Cost".to_string(),
                source_column: 3,
                data_type: DetectedDataType::Number,
                ..Default::default()
            },
        ],
        placements: vec![
            make_row("region", 0),
            make_column("quarter", 0),
            make_value("sales", 0),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::new("cost"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 1,
                    display_name: Some("Total Cost".to_string()),
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Average,
                number_format: None,
                show_values_as: None,
            }),
        ],
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
    }
}
