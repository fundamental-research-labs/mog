use super::common::*;
use super::*;
use value_types::FiniteF64;

// ---- PivotTableConfig helper methods ----

#[test]
fn config_get_placements_for_area() {
    let config = PivotTableConfig {
        schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: "test".to_string(),
        name: "Test".to_string(),
        source_sheet_id: None,
        source_sheet_name: "sheet1".to_string(),
        source_range: CellRange::new(0, 0, 10, 3),
        output_sheet_name: "sheet2".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: vec![],
        placements: vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: FieldId::from("region"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
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
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: FieldId::from("product"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 1,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
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
    };

    let rows = config.row_placements();
    assert_eq!(rows.len(), 2);
    // Should be sorted by position
    assert_eq!(rows[0].field_id(), &FieldId::from("region"));
    assert_eq!(rows[1].field_id(), &FieldId::from("product"));

    let values = config.value_placements();
    assert_eq!(values.len(), 1);
    assert_eq!(values[0].field_id(), &FieldId::from("sales"));

    let columns = config.column_placements();
    assert_eq!(columns.len(), 0);
}

// ---- Complete PivotTableConfig serde ----

#[test]
fn pivot_table_config_serde_roundtrip() {
    let config = PivotTableConfig {
        schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: "pivot1".to_string(),
        name: "Sales Pivot".to_string(),
        source_sheet_id: None,
        source_sheet_name: "sheet1".to_string(),
        source_range: CellRange::new(0, 0, 100, 5),
        output_sheet_name: "sheet2".to_string(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: vec![PivotField {
            id: FieldId::from("region"),
            name: "Region".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        }],
        placements: vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: FieldId::from("region"),
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
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
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
        filters: vec![],
        layout: None,
        style: None,
        data_options: None,
        created_at: Some(FiniteF64::must(1234567890.0)),
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
    let json = serde_json::to_string(&config).unwrap();
    let deserialized: PivotTableConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, config);
}

#[test]
fn config_get_field_found() {
    let config = make_test_config_with_fields();
    let field = config.get_field("region").expect("should find region");
    assert_eq!(field.name, "Region");
    assert_eq!(field.source_column, 0);
}

#[test]
fn config_get_field_not_found() {
    let config = make_test_config_with_fields();
    assert!(config.get_field("nonexistent").is_none());
}

#[test]
fn config_value_placements_sorted() {
    let config = make_test_config_with_fields();
    let values = config.value_placements();
    assert_eq!(values.len(), 2);
    assert_eq!(values[0].field_id(), &FieldId::new("sales"));
    assert_eq!(values[0].position(), 0);
    assert_eq!(values[1].field_id(), &FieldId::new("cost"));
    assert_eq!(values[1].position(), 1);
}

#[test]
fn config_row_placements_returns_rows() {
    let config = make_test_config_with_fields();
    let rows = config.row_placements();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field_id(), &FieldId::new("region"));
}

#[test]
fn config_column_placements_returns_columns() {
    let config = make_test_config_with_fields();
    let cols = config.column_placements();
    assert_eq!(cols.len(), 1);
    assert_eq!(cols[0].field_id(), &FieldId::new("quarter"));
}

#[test]
fn config_get_placements_for_area_filter_empty() {
    let config = make_test_config_with_fields();
    let filters = config.get_placements_for_area(PivotFieldArea::Filter);
    assert!(filters.is_empty());
}

// ---- config: from_flat_placements / to_flat_placements ----

#[test]
fn config_from_flat_placements() {
    let flats = vec![
        PivotFieldPlacementFlat {
            field_id: FieldId::new("region"),
            placement_id: crate::types::PlacementId::default(),
            calculated_field_id: None,
            area: PivotFieldArea::Row,
            position: 0,
            aggregate_function: None,
            sort_order: Some(SortDirection::Asc),
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
            display_name: None,
            number_format: None,
            show_values_as: None,
        },
        PivotFieldPlacementFlat {
            field_id: FieldId::new("sales"),
            placement_id: crate::types::PlacementId::default(),
            calculated_field_id: None,
            area: PivotFieldArea::Value,
            position: 0,
            aggregate_function: Some(AggregateFunction::Sum),
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: None,
            display_name: None,
            number_format: None,
            show_values_as: None,
        },
    ];
    let typed = PivotTableConfig::from_flat_placements(flats);
    assert_eq!(typed.len(), 2);
    assert!(typed[0].is_row());
    assert!(typed[1].is_value());
}

#[test]
fn config_to_flat_placements() {
    let typed = vec![make_row("region", 0), make_value("sales", 0)];
    let flats = PivotTableConfig::to_flat_placements(&typed);
    assert_eq!(flats.len(), 2);
    assert_eq!(flats[0].area, PivotFieldArea::Row);
    assert_eq!(flats[0].field_id, FieldId::new("region"));
    assert_eq!(flats[1].area, PivotFieldArea::Value);
    assert_eq!(flats[1].field_id, FieldId::new("sales"));
    assert_eq!(flats[1].aggregate_function, Some(AggregateFunction::Sum));
}

#[test]
fn config_flat_roundtrip_preserves_all_areas() {
    let typed = vec![
        make_row("a", 0),
        make_column("b", 0),
        make_value("c", 0),
        PivotFieldPlacement::Filter(FilterPlacement {
            base: PlacementBase {
                field_id: FieldId::new("d"),
                placement_id: crate::types::PlacementId::default(),
                position: 0,
                display_name: None,
            },
        }),
    ];
    let flats = PivotTableConfig::to_flat_placements(&typed);
    let roundtripped = PivotTableConfig::from_flat_placements(flats);
    assert_eq!(roundtripped.len(), 4);
    assert!(roundtripped[0].is_row());
    assert!(roundtripped[1].is_column());
    assert!(roundtripped[2].is_value());
    assert!(roundtripped[3].is_filter());
}
