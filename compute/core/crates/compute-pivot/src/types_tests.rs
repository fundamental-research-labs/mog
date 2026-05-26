use super::types::PivotTableDefExt;
use super::types::*;
use cell_types::SheetId;
use value_types::CellValue;

// ---- 4a: FieldId ----

#[test]
fn field_id_from_string() {
    let id = FieldId::from("sales".to_string());
    assert_eq!(&*id, "sales");
    assert_eq!(id.to_string(), "sales");
}

#[test]
fn field_id_from_str() {
    let id = FieldId::from("region");
    assert_eq!(&*id, "region");
}

#[test]
fn field_id_serde_transparent() {
    let id = FieldId::from("test_field");
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, r#""test_field""#);
    let deserialized: FieldId = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, id);
}

#[test]
fn field_id_equality_and_hash() {
    use std::collections::HashSet;
    let id1 = FieldId::from("sales");
    let id2 = FieldId::from("sales");
    let id3 = FieldId::from("region");
    assert_eq!(id1, id2);
    assert_ne!(id1, id3);
    let mut set = HashSet::new();
    set.insert(id1.clone());
    assert!(set.contains(&id2));
    assert!(!set.contains(&id3));
}

// ---- 4b/4c: PivotFieldPlacement enum serde round-trip ----

#[test]
fn placement_row_serde_roundtrip() {
    let placement = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("region"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Region".to_string()),
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: Some(true),
    });
    let json = serde_json::to_string(&placement).unwrap();
    assert!(json.contains(r#""area":"row""#));
    let deserialized: PivotFieldPlacement = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, placement);
    assert!(deserialized.is_row());
    assert!(!deserialized.is_value());
}

#[test]
fn placement_value_serde_roundtrip() {
    let placement = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("sales"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        source: crate::types::PivotValueSource::Field {
            field_id: FieldId::from("sales"),
        },
        aggregate_function: AggregateFunction::Sum,
        number_format: Some("#,##0.00".to_string()),
        show_values_as: None,
    });
    let json = serde_json::to_string(&placement).unwrap();
    assert!(json.contains(r#""area":"value""#));
    assert!(json.contains(r#""aggregateFunction":"sum""#));
    let deserialized: PivotFieldPlacement = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, placement);
    assert!(deserialized.is_value());
}

#[test]
fn placement_column_serde_roundtrip() {
    let placement = PivotFieldPlacement::Column(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("quarter"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Desc),
        custom_sort_list: Some(vec![
            CellValue::Text("Q1".into()),
            CellValue::Text("Q2".into()),
        ]),
        sort_by_value: None,
        date_grouping: Some(DateGrouping::Quarter),
        number_grouping: None,
        show_subtotals: None,
    });
    let json = serde_json::to_string(&placement).unwrap();
    let deserialized: PivotFieldPlacement = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, placement);
    assert!(deserialized.is_column());
}

#[test]
fn placement_filter_serde_roundtrip() {
    let placement = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::from("category"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Product Category".to_string()),
        },
    });
    let json = serde_json::to_string(&placement).unwrap();
    let deserialized: PivotFieldPlacement = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, placement);
    assert!(deserialized.is_filter());
}

// ---- 4b: From conversions flat <-> typed ----

#[test]
fn flat_to_typed_row() {
    let flat = PivotFieldPlacementFlat {
        field_id: FieldId::from("region"),
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
    };
    let typed = PivotFieldPlacement::from(flat);
    assert!(typed.is_row());
    assert_eq!(typed.field_id(), &FieldId::from("region"));
}

#[test]
fn flat_to_typed_value_defaults_aggregate_to_sum() {
    let flat = PivotFieldPlacementFlat {
        field_id: FieldId::from("sales"),
        placement_id: crate::types::PlacementId::default(),
        calculated_field_id: None,
        area: PivotFieldArea::Value,
        position: 0,
        aggregate_function: None, // Missing! Should default to Sum.
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
        display_name: None,
        number_format: None,
        show_values_as: None,
    };
    let typed = PivotFieldPlacement::from(flat);
    match &typed {
        PivotFieldPlacement::Value(v) => {
            assert_eq!(v.aggregate_function, AggregateFunction::Sum);
        }
        _ => panic!("Expected Value placement"),
    }
}

#[test]
fn typed_to_flat_roundtrip() {
    let typed = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("sales"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Total Sales".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: FieldId::from("sales"),
        },
        aggregate_function: AggregateFunction::Average,
        number_format: Some("#,##0".to_string()),
        show_values_as: None,
    });
    let flat = PivotFieldPlacementFlat::from(typed.clone());
    let roundtripped = PivotFieldPlacement::from(flat);
    assert_eq!(roundtripped, typed);
}

// ---- Value placement without aggregate_function can't exist (compile-time guarantee) ----
// This test documents the guarantee. ValuePlacement requires aggregate_function
// as a non-optional field, so omitting it is a compile error. We verify the type
// requires it by constructing a valid one.
#[test]
fn value_placement_requires_aggregate_function() {
    let vp = ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("sales"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Sum, // This field is NOT Option
        number_format: None,
        show_values_as: None,
    };
    // The fact that this compiles proves aggregate_function is required.
    assert_eq!(vp.aggregate_function, AggregateFunction::Sum);
}

// ---- 4d: PivotFilterCondition serde round-trip ----

#[test]
fn filter_condition_nullary_serde() {
    let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank);
    let json = serde_json::to_string(&cond).unwrap();
    let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, cond);
}

#[test]
fn filter_condition_unary_serde() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Equals,
        value: CellValue::number(42.0),
    };
    let json = serde_json::to_string(&cond).unwrap();
    let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, cond);
}

#[test]
fn filter_condition_binary_serde() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::Between,
        value: CellValue::number(10.0),
        value2: CellValue::number(20.0),
    };
    let json = serde_json::to_string(&cond).unwrap();
    let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, cond);
}

#[test]
fn filter_condition_contains_text_serde() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Contains,
        value: CellValue::Text("widget".into()),
    };
    let json = serde_json::to_string(&cond).unwrap();
    let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, cond);
}

#[test]
fn filter_condition_all_nullary_variants() {
    for cond in [
        PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank),
        PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank),
        PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage),
        PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage),
    ] {
        let json = serde_json::to_string(&cond).unwrap();
        let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, cond);
    }
}

// ---- 4d: PivotFilterCondition flat conversion round-trip ----

#[test]
fn filter_condition_flat_to_typed_roundtrip() {
    let flat = PivotFilterConditionFlat {
        operator: FilterOperator::Between,
        value: Some(CellValue::number(10.0)),
        value2: Some(CellValue::number(50.0)),
    };
    let typed = PivotFilterCondition::from_flat(flat.clone());
    match &typed {
        PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value,
            value2,
        } => {
            assert_eq!(*value, CellValue::number(10.0));
            assert_eq!(*value2, CellValue::number(50.0));
        }
        _ => panic!("Expected Binary Between"),
    }
    let back_to_flat = PivotFilterConditionFlat::from(typed);
    assert_eq!(back_to_flat, flat);
}

#[test]
fn filter_condition_flat_nullary_roundtrip() {
    let flat = PivotFilterConditionFlat {
        operator: FilterOperator::IsBlank,
        value: None,
        value2: None,
    };
    let typed = PivotFilterCondition::from_flat(flat.clone());
    assert_eq!(
        typed,
        PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank)
    );
    let back = PivotFilterConditionFlat::from(typed);
    assert_eq!(back, flat);
}

// ---- 4f: ShowValuesAsBaseItem serde ----

#[test]
fn show_values_as_base_item_relative_previous() {
    let item = ShowValuesAsBaseItem::Relative {
        position: RelativePosition::Previous,
    };
    let json = serde_json::to_string(&item).unwrap();
    let deserialized: ShowValuesAsBaseItem = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, item);
}

#[test]
fn show_values_as_base_item_relative_next() {
    let item = ShowValuesAsBaseItem::Relative {
        position: RelativePosition::Next,
    };
    let json = serde_json::to_string(&item).unwrap();
    let deserialized: ShowValuesAsBaseItem = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, item);
}

#[test]
fn show_values_as_base_item_specific_text() {
    let item = ShowValuesAsBaseItem::Specific {
        value: CellValue::Text("Widget".into()),
    };
    let json = serde_json::to_string(&item).unwrap();
    let deserialized: ShowValuesAsBaseItem = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, item);
}

#[test]
fn show_values_as_base_item_specific_number() {
    let item = ShowValuesAsBaseItem::Specific {
        value: CellValue::number(42.0),
    };
    let json = serde_json::to_string(&item).unwrap();
    let deserialized: ShowValuesAsBaseItem = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, item);
}

// ---- 4f: SortDirection ----

#[test]
fn sort_direction_serde() {
    let asc = SortDirection::Asc;
    let desc = SortDirection::Desc;
    assert_eq!(serde_json::to_string(&asc).unwrap(), r#""asc""#);
    assert_eq!(serde_json::to_string(&desc).unwrap(), r#""desc""#);
    assert_eq!(
        serde_json::from_str::<SortDirection>(r#""asc""#).unwrap(),
        SortDirection::Asc
    );
    assert_eq!(
        serde_json::from_str::<SortDirection>(r#""desc""#).unwrap(),
        SortDirection::Desc
    );
}

#[test]
fn sort_direction_default_is_asc() {
    assert_eq!(SortDirection::default(), SortDirection::Asc);
}

// ---- 4g: AggregateFunction variant naming with serde rename ----

#[test]
fn aggregate_function_serde_names() {
    // Verify the serde rename aliases work correctly
    assert_eq!(
        serde_json::to_string(&AggregateFunction::CountA).unwrap(),
        r#""counta""#
    );
    assert_eq!(
        serde_json::to_string(&AggregateFunction::CountUnique).unwrap(),
        r#""countunique""#
    );
    assert_eq!(
        serde_json::to_string(&AggregateFunction::StdDev).unwrap(),
        r#""stdev""#
    );
    assert_eq!(
        serde_json::to_string(&AggregateFunction::StdDevP).unwrap(),
        r#""stdevp""#
    );
    assert_eq!(
        serde_json::to_string(&AggregateFunction::VarP).unwrap(),
        r#""varp""#
    );

    // Verify deserialization from the lowercase names
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""counta""#).unwrap(),
        AggregateFunction::CountA
    );
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""countunique""#).unwrap(),
        AggregateFunction::CountUnique
    );
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""stdev""#).unwrap(),
        AggregateFunction::StdDev
    );
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""stdevp""#).unwrap(),
        AggregateFunction::StdDevP
    );
    assert_eq!(
        serde_json::from_str::<AggregateFunction>(r#""varp""#).unwrap(),
        AggregateFunction::VarP
    );
}

// ---- 4g: NumberGrouping::validate() ----

#[test]
fn number_grouping_validate_valid() {
    let ng = NumberGrouping::new(0.0, 100.0, 10.0);
    assert!(ng.validate().is_ok());
}

#[test]
fn number_grouping_validate_zero_interval() {
    let ng = NumberGrouping::new(0.0, 100.0, 0.0);
    assert!(ng.validate().is_err());
    assert!(ng.validate().unwrap_err().contains("positive"));
}

#[test]
fn number_grouping_validate_negative_interval() {
    let ng = NumberGrouping::new(0.0, 100.0, -5.0);
    assert!(ng.validate().is_err());
}

#[test]
fn number_grouping_validate_end_less_than_start() {
    let ng = NumberGrouping::new(100.0, 0.0, 10.0);
    assert!(ng.validate().is_err());
    assert!(ng.validate().unwrap_err().contains("greater than start"));
}

#[test]
fn number_grouping_validate_end_equals_start() {
    let ng = NumberGrouping::new(50.0, 50.0, 10.0);
    assert!(ng.validate().is_err());
}

#[test]
fn number_grouping_validate_nan_start() {
    let ng = NumberGrouping::new(f64::NAN, 100.0, 10.0);
    assert!(ng.validate().is_err());
    assert!(ng.validate().unwrap_err().contains("finite"));
}

#[test]
fn number_grouping_validate_infinity_end() {
    let ng = NumberGrouping::new(0.0, f64::INFINITY, 10.0);
    assert!(ng.validate().is_err());
}

#[test]
fn number_grouping_validate_nan_interval() {
    let ng = NumberGrouping::new(0.0, 100.0, f64::NAN);
    assert!(ng.validate().is_err());
}

// ---- 4g: PivotExpansionState with HashSet ----

#[test]
fn expansion_state_serialize_as_arrays() {
    let mut state = PivotExpansionState::default();
    state.expanded_rows.insert("East".to_string());
    state.expanded_rows.insert("West".to_string());
    let json = serde_json::to_string(&state).unwrap();
    // Should serialize as arrays, not objects
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(v["expandedRows"].is_array());
    assert!(v["expandedColumns"].is_array());
}

#[test]
fn expansion_state_deserialize_from_hashset_array() {
    let json = r#"{"expandedRows": ["East", "West"], "expandedColumns": []}"#;
    let state: PivotExpansionState = serde_json::from_str(json).unwrap();
    assert!(state.expanded_rows.contains("East"));
    assert!(state.expanded_rows.contains("West"));
    assert_eq!(state.expanded_rows.len(), 2);
    assert!(state.expanded_columns.is_empty());
}

#[test]
fn expansion_state_deserialize_from_legacy_hashmap() {
    let json =
        r#"{"expandedRows": {"East": true, "West": true, "North": false}, "expandedColumns": {}}"#;
    let state: PivotExpansionState = serde_json::from_str(json).unwrap();
    assert!(state.expanded_rows.contains("East"));
    assert!(state.expanded_rows.contains("West"));
    // "North" has value false, so it should NOT be in the set
    assert!(!state.expanded_rows.contains("North"));
    assert_eq!(state.expanded_rows.len(), 2);
}

#[test]
fn expansion_state_deserialize_empty() {
    let json = r#"{}"#;
    let state: PivotExpansionState = serde_json::from_str(json).unwrap();
    assert!(state.expanded_rows.is_empty());
    assert!(state.expanded_columns.is_empty());
}

// ---- 4g: PivotTopBottomFilter.n with alias "count" ----

#[test]
fn top_bottom_filter_n_field() {
    let json = r#"{"type":"top","n":5,"by":"items"}"#;
    let filter: PivotTopBottomFilter = serde_json::from_str(json).unwrap();
    assert_eq!(filter.n, 5.0);
    assert_eq!(filter.filter_type, TopBottomType::Top);
}

#[test]
fn top_bottom_filter_count_alias() {
    // Legacy format uses "count" instead of "n"
    let json = r#"{"type":"top","count":10,"by":"percent"}"#;
    let filter: PivotTopBottomFilter = serde_json::from_str(json).unwrap();
    assert_eq!(filter.n, 10.0);
    assert_eq!(filter.by, TopBottomBy::Percent);
}

#[test]
fn top_bottom_filter_fractional_percent() {
    let json = r#"{"type":"top","n":33.33,"by":"percent"}"#;
    let filter: PivotTopBottomFilter = serde_json::from_str(json).unwrap();
    assert!((filter.n - 33.33).abs() < f64::EPSILON);
    assert_eq!(filter.by, TopBottomBy::Percent);
}

// ---- 4g: SortByValueConfig with column_key ----

#[test]
fn sort_by_value_config_with_column_key() {
    let config = SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: Some("Q2".to_string()),
    };
    let json = serde_json::to_string(&config).unwrap();
    assert!(json.contains(r#""columnKey":"Q2""#));
    let deserialized: SortByValueConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, config);
}

#[test]
fn sort_by_value_config_without_column_key() {
    let json = r#"{"valueFieldId":"sales","order":"asc"}"#;
    let config: SortByValueConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.value_field_id, FieldId::from("sales"));
    assert_eq!(config.order, SortDirection::Asc);
    assert!(config.column_key.is_none());
}

// ---- 4g: PivotField.source_column is u32 ----

#[test]
fn pivot_field_source_column_u32() {
    let field = PivotField {
        id: FieldId::from("sales"),
        name: "Sales".to_string(),
        source_column: 5,
        data_type: DetectedDataType::Number,
        ..Default::default()
    };
    let json = serde_json::to_string(&field).unwrap();
    let deserialized: PivotField = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.source_column, 5u32);
}

// ---- PivotFieldPlacement helper methods ----

#[test]
fn placement_helper_methods() {
    let row = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("region"),
            placement_id: crate::types::PlacementId::default(),
            position: 2,
            display_name: Some("My Region".to_string()),
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });
    assert_eq!(row.field_id(), &FieldId::from("region"));
    assert_eq!(row.position(), 2);
    assert_eq!(row.display_name(), Some("My Region"));
    assert!(row.is_row());
    assert!(!row.is_column());
    assert!(!row.is_value());
    assert!(!row.is_filter());
}

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
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
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
        created_at: Some(1234567890.0),
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    };
    let json = serde_json::to_string(&config).unwrap();
    let deserialized: PivotTableConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, config);
}

// ---- RelativePosition serde ----

#[test]
fn relative_position_serde() {
    assert_eq!(
        serde_json::to_string(&RelativePosition::Previous).unwrap(),
        r#""previous""#
    );
    assert_eq!(
        serde_json::to_string(&RelativePosition::Next).unwrap(),
        r#""next""#
    );
    assert_eq!(
        serde_json::from_str::<RelativePosition>(r#""previous""#).unwrap(),
        RelativePosition::Previous
    );
    assert_eq!(
        serde_json::from_str::<RelativePosition>(r#""next""#).unwrap(),
        RelativePosition::Next
    );
}

// ---- reorder_placement tests ----

/// Helper to create a minimal PivotTableConfig for reorder tests.
fn make_reorder_config(placements: Vec<PivotFieldPlacement>) -> PivotTableConfig {
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
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    }
}

fn make_row(field_id: &str, position: usize) -> PivotFieldPlacement {
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

fn make_column(field_id: &str, position: usize) -> PivotFieldPlacement {
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

fn make_value(field_id: &str, position: usize) -> PivotFieldPlacement {
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

#[test]
fn reorder_placement_within_same_area() {
    // Three row fields: A(0), B(1), C(2). Move A to position 2 (end).
    let mut config =
        make_reorder_config(vec![make_row("A", 0), make_row("B", 1), make_row("C", 2)]);

    // field_index 0 is "A" at row position 0
    assert!(config.reorder_placement(0, PivotFieldArea::Row, 2));

    let rows = config.row_placements();
    assert_eq!(rows.len(), 3);
    // After reorder: B(0), C(1), A(2) — because A gets position=2, B stays 1->0, C stays 2->1
    // Actually: A is removed (index 0), B and C remain. A is pushed back with position=2.
    // Reindex: B(pos=1), C(pos=2), A(pos=2) sorted by position -> B(1), C(2), A(2).
    // Stable sort: B comes first at pos 1 -> 0, then C at pos 2 -> 1, then A at pos 2 -> 2.
    assert_eq!(rows[0].field_id(), &FieldId::from("B"));
    assert_eq!(rows[0].position(), 0);
    assert_eq!(rows[1].field_id(), &FieldId::from("C"));
    assert_eq!(rows[1].position(), 1);
    assert_eq!(rows[2].field_id(), &FieldId::from("A"));
    assert_eq!(rows[2].position(), 2);
}

#[test]
fn reorder_placement_move_to_beginning() {
    // Three row fields: A(0), B(1), C(2). Move C to position 0.
    let mut config =
        make_reorder_config(vec![make_row("A", 0), make_row("B", 1), make_row("C", 2)]);

    // field_index 2 is "C"
    assert!(config.reorder_placement(2, PivotFieldArea::Row, 0));

    let rows = config.row_placements();
    assert_eq!(rows.len(), 3);
    // C gets position 0. A has position 0, B has position 1.
    // Sort by position: C(0), A(0), B(1). C is after A,B in the vec (appended), but
    // A is at index 0, B at index 1, C appended at index 2 in the vec.
    // area_indices sorted by position: C(0), A(0), B(1) — but stable by vec order:
    // A is at vec index 0 (pos 0), B at vec index 1 (pos 1), C at vec index 2 (pos 0).
    // sort_by_key is stable, so among pos=0: A(vec idx 0) before C(vec idx 2).
    // Result: A(0), C(1), B(2)
    assert_eq!(rows[0].field_id(), &FieldId::from("A"));
    assert_eq!(rows[1].field_id(), &FieldId::from("C"));
    assert_eq!(rows[2].field_id(), &FieldId::from("B"));
}

#[test]
fn reorder_placement_move_to_different_area() {
    // Row: A(0), B(1). Column: C(0). Move B from row to column at position 0.
    let mut config = make_reorder_config(vec![
        make_row("A", 0),
        make_row("B", 1),
        make_column("C", 0),
    ]);

    // field_index 1 is "B" (row)
    assert!(config.reorder_placement(1, PivotFieldArea::Column, 0));

    let rows = config.row_placements();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field_id(), &FieldId::from("A"));
    assert_eq!(rows[0].position(), 0);

    let cols = config.column_placements();
    assert_eq!(cols.len(), 2);
    // B gets position 0, C has position 0. Sort stable: C(vec idx) before B(appended).
    assert_eq!(cols[0].field_id(), &FieldId::from("C"));
    assert_eq!(cols[0].position(), 0);
    assert_eq!(cols[1].field_id(), &FieldId::from("B"));
    assert_eq!(cols[1].position(), 1);
}

#[test]
fn reorder_placement_move_to_value_area_defaults_aggregate() {
    // Row: A(0). Move A to value area — should get default Sum aggregate.
    let mut config = make_reorder_config(vec![make_row("A", 0)]);

    assert!(config.reorder_placement(0, PivotFieldArea::Value, 0));

    let values = config.value_placements();
    assert_eq!(values.len(), 1);
    assert_eq!(values[0].field_id(), &FieldId::from("A"));
    assert!(values[0].is_value());
    assert_eq!(values[0].aggregate_function(), Some(AggregateFunction::Sum));
}

#[test]
fn reorder_placement_position_clamping() {
    // Row: A(0), B(1). Move A to position 100 (way out of bounds).
    let mut config = make_reorder_config(vec![make_row("A", 0), make_row("B", 1)]);

    assert!(config.reorder_placement(0, PivotFieldArea::Row, 100));

    let rows = config.row_placements();
    assert_eq!(rows.len(), 2);
    // B has position 1, A has position 100. Sort: B(1) then A(100). Reindex: B(0), A(1).
    assert_eq!(rows[0].field_id(), &FieldId::from("B"));
    assert_eq!(rows[0].position(), 0);
    assert_eq!(rows[1].field_id(), &FieldId::from("A"));
    assert_eq!(rows[1].position(), 1);
}

#[test]
fn reorder_placement_field_not_found() {
    let mut config = make_reorder_config(vec![make_row("A", 0)]);
    // Index 5 is out of bounds
    assert!(!config.reorder_placement(5, PivotFieldArea::Row, 0));
    // Config unchanged
    assert_eq!(config.placements.len(), 1);
}

#[test]
fn reorder_placement_multiple_moves_in_sequence() {
    // Row: A(0), B(1). Value: C(0).
    // 1. Move A to column area at position 0.
    // 2. Move C from value to row area at position 0.
    let mut config =
        make_reorder_config(vec![make_row("A", 0), make_row("B", 1), make_value("C", 0)]);

    // Move A (index 0) to column
    assert!(config.reorder_placement(0, PivotFieldArea::Column, 0));

    // After move 1: rows=[B(0)], columns=[A(0)], values=[C(0)]
    assert_eq!(config.row_placements().len(), 1);
    assert_eq!(config.row_placements()[0].field_id(), &FieldId::from("B"));
    assert_eq!(config.column_placements().len(), 1);
    assert_eq!(
        config.column_placements()[0].field_id(),
        &FieldId::from("A")
    );
    assert_eq!(config.value_placements().len(), 1);

    // Now find C's index in the placements vec. It should still be a value placement.
    let c_index = config
        .placements
        .iter()
        .position(|p| p.field_id() == &FieldId::from("C"))
        .unwrap();

    // Move C to row area at position 0
    assert!(config.reorder_placement(c_index, PivotFieldArea::Row, 0));

    // After move 2: rows=[B, C] (C at pos 0, B at pos 0 — stable: B first then C)
    let rows = config.row_placements();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].field_id(), &FieldId::from("B"));
    assert_eq!(rows[1].field_id(), &FieldId::from("C"));

    // Values should be empty now
    assert_eq!(config.value_placements().len(), 0);

    // Column still has A
    assert_eq!(config.column_placements().len(), 1);
    assert_eq!(
        config.column_placements()[0].field_id(),
        &FieldId::from("A")
    );
}

#[test]
fn reorder_placement_preserves_value_aggregate_on_same_area_move() {
    // Value field with Average aggregate — moving within value area should preserve it.
    let mut config = make_reorder_config(vec![
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
            aggregate_function: AggregateFunction::Average,
            number_format: Some("#,##0".to_string()),
            show_values_as: None,
        }),
        make_value("cost", 1),
    ]);

    // Move "sales" (index 0) to position 1 within value area
    assert!(config.reorder_placement(0, PivotFieldArea::Value, 1));

    let values = config.value_placements();
    assert_eq!(values.len(), 2);
    // cost was at position 1, sales gets position 1. Stable: cost first.
    assert_eq!(values[0].field_id(), &FieldId::from("cost"));
    assert_eq!(values[1].field_id(), &FieldId::from("sales"));
    // Average aggregate should be preserved
    assert_eq!(
        values[1].aggregate_function(),
        Some(AggregateFunction::Average)
    );
}

#[test]
fn into_area_preserves_aggregate_when_moving_value_to_value() {
    // This is a no-op — same area
    let placement = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("x"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Max,
        number_format: None,
        show_values_as: None,
    });

    let moved = placement.into_area(PivotFieldArea::Value);
    assert_eq!(moved.aggregate_function(), Some(AggregateFunction::Max));
}

#[test]
fn into_area_axis_to_value_defaults_to_sum() {
    let placement = make_row("x", 0);
    let moved = placement.into_area(PivotFieldArea::Value);
    assert!(moved.is_value());
    assert_eq!(moved.aggregate_function(), Some(AggregateFunction::Sum));
}

#[test]
fn into_area_value_to_row_loses_aggregate() {
    let placement = make_value("x", 0);
    let moved = placement.into_area(PivotFieldArea::Row);
    assert!(moved.is_row());
    assert_eq!(moved.aggregate_function(), None);
}

// ============================================================
// Additional coverage tests
// ============================================================

// ---- FieldId: new(), Deref, Display, AsRef<str> ----

#[test]
fn field_id_new() {
    let id = FieldId::new("revenue");
    assert_eq!(id.as_str(), "revenue");
}

#[test]
fn field_id_new_from_string() {
    let id = FieldId::new(String::from("cost"));
    assert_eq!(id.as_str(), "cost");
}

#[test]
fn field_id_deref_str_methods() {
    let id = FieldId::new("Hello World");
    // Deref to str lets us call str methods directly
    assert!(id.starts_with("Hello"));
    assert!(id.contains("World"));
    assert_eq!(id.len(), 11);
    assert!(!id.is_empty());
}

#[test]
fn field_id_display() {
    let id = FieldId::new("my_field");
    let displayed = format!("{}", id);
    assert_eq!(displayed, "my_field");
}

#[test]
fn field_id_as_ref_str() {
    let id = FieldId::new("test_ref");
    let s: &str = id.as_ref();
    assert_eq!(s, "test_ref");
}

// ---- PivotError Display impls ----

#[test]
fn error_display_missing_field() {
    let err = PivotError::MissingField {
        field: "name".to_string(),
        message: "must not be empty".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Missing field 'name': must not be empty");
}

#[test]
fn error_display_unknown_field() {
    let err = PivotError::UnknownField {
        field_id: "bad_id".to_string(),
        context: "row placement at index 0".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Unknown field 'bad_id': row placement at index 0");
}

#[test]
fn error_display_invalid_value() {
    let err = PivotError::InvalidValue {
        field: "source_range.start_row".to_string(),
        message: "must be non-negative".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(
        msg,
        "Invalid value for 'source_range.start_row': must be non-negative"
    );
}

#[test]
fn error_display_invalid_filter() {
    let err = PivotError::InvalidFilter {
        field_id: "region".to_string(),
        message: "missing operand".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Invalid filter on 'region': missing operand");
}

#[test]
fn error_display_duplicate_placement() {
    let err = PivotError::DuplicatePlacement {
        field_id: "sales".to_string(),
        area: "Row".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Duplicate placement: field 'sales' in area 'Row'");
}

#[test]
fn error_display_invalid_formula() {
    let err = PivotError::InvalidFormula {
        field_id: "calc1".to_string(),
        message: "unexpected token ')'".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Invalid formula for 'calc1': unexpected token ')'");
}

#[test]
fn error_display_validation_error() {
    let err = PivotError::ValidationError {
        message: "duplicate pivot table IDs".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Validation error: duplicate pivot table IDs");
}

#[test]
fn error_display_multiple() {
    let err = PivotError::Multiple {
        errors: vec![
            PivotError::MissingField {
                field: "name".to_string(),
                message: "required".to_string(),
            },
            PivotError::UnknownField {
                field_id: "xyz".to_string(),
                context: "placement".to_string(),
            },
        ],
    };
    let msg = format!("{}", err);
    assert!(msg.starts_with("2 validation errors: "));
    assert!(msg.contains("Missing field 'name': required"));
    assert!(msg.contains("; Unknown field 'xyz': placement"));
}

#[test]
fn error_display_multiple_empty() {
    let err = PivotError::Multiple { errors: vec![] };
    let msg = format!("{}", err);
    assert_eq!(msg, "0 validation errors: ");
}

#[test]
fn error_implements_std_error() {
    let err = PivotError::ValidationError {
        message: "test".to_string(),
    };
    // Verify it implements std::error::Error by using it as a trait object
    let _: &dyn std::error::Error = &err;
    // source() should return None (default impl)
    assert!(std::error::Error::source(&err).is_none());
}

// ---- placement predicates and accessors ----

#[test]
fn placement_is_column_true() {
    let p = make_column("quarter", 0);
    assert!(p.is_column());
    assert!(!p.is_row());
    assert!(!p.is_value());
    assert!(!p.is_filter());
}

#[test]
fn placement_is_value_true() {
    let p = make_value("sales", 0);
    assert!(p.is_value());
    assert!(!p.is_row());
    assert!(!p.is_column());
    assert!(!p.is_filter());
}

#[test]
fn placement_is_filter_true() {
    let p = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new("cat"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
    });
    assert!(p.is_filter());
    assert!(!p.is_row());
    assert!(!p.is_column());
    assert!(!p.is_value());
}

#[test]
fn placement_as_axis_row() {
    let p = make_row("region", 0);
    let axis = p.as_axis().expect("Row should return Some from as_axis");
    assert_eq!(axis.base.field_id, FieldId::new("region"));
}

#[test]
fn placement_as_axis_column() {
    let p = make_column("quarter", 1);
    let axis = p.as_axis().expect("Column should return Some from as_axis");
    assert_eq!(axis.base.position, 1);
}

#[test]
fn placement_as_axis_returns_none_for_value() {
    let p = make_value("sales", 0);
    assert!(p.as_axis().is_none());
}

#[test]
fn placement_as_axis_returns_none_for_filter() {
    let p = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new("f"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
    });
    assert!(p.as_axis().is_none());
}

#[test]
fn placement_as_value_returns_some_for_value() {
    let p = make_value("sales", 0);
    let vp = p
        .as_value()
        .expect("Value should return Some from as_value");
    assert_eq!(vp.aggregate_function, AggregateFunction::Sum);
}

#[test]
fn placement_as_value_returns_none_for_row() {
    let p = make_row("region", 0);
    assert!(p.as_value().is_none());
}

#[test]
fn placement_base_mut_modifies_position() {
    let mut p = make_row("region", 0);
    p.base_mut().position = 5;
    assert_eq!(p.position(), 5);
}

#[test]
fn placement_base_mut_modifies_display_name() {
    let mut p = make_value("sales", 0);
    assert!(p.display_name().is_none());
    p.base_mut().display_name = Some("Total Sales".to_string());
    assert_eq!(p.display_name(), Some("Total Sales"));
}

#[test]
fn placement_base_mut_filter() {
    let mut p = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new("cat"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
    });
    p.base_mut().position = 3;
    assert_eq!(p.position(), 3);
}

#[test]
fn placement_base_mut_column() {
    let mut p = make_column("quarter", 0);
    p.base_mut().display_name = Some("Q".to_string());
    assert_eq!(p.display_name(), Some("Q"));
}

#[test]
fn placement_aggregate_function_value() {
    let p = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::new("x"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Average,
        number_format: None,
        show_values_as: None,
    });
    assert_eq!(p.aggregate_function(), Some(AggregateFunction::Average));
}

#[test]
fn placement_aggregate_function_row_returns_none() {
    let p = make_row("x", 0);
    assert_eq!(p.aggregate_function(), None);
}

#[test]
fn placement_aggregate_function_column_returns_none() {
    let p = make_column("x", 0);
    assert_eq!(p.aggregate_function(), None);
}

#[test]
fn placement_aggregate_function_filter_returns_none() {
    let p = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new("x"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
    });
    assert_eq!(p.aggregate_function(), None);
}

// ---- into_area: all area transitions ----

#[test]
fn into_area_row_to_column() {
    let p = make_row("region", 0);
    let moved = p.into_area(PivotFieldArea::Column);
    assert!(moved.is_column());
    assert_eq!(moved.field_id(), &FieldId::new("region"));
}

#[test]
fn into_area_row_to_filter() {
    let p = make_row("region", 0);
    let moved = p.into_area(PivotFieldArea::Filter);
    assert!(moved.is_filter());
    assert_eq!(moved.field_id(), &FieldId::new("region"));
}

#[test]
fn into_area_column_to_row() {
    let p = make_column("quarter", 0);
    let moved = p.into_area(PivotFieldArea::Row);
    assert!(moved.is_row());
}

#[test]
fn into_area_column_to_value() {
    let p = make_column("amount", 0);
    let moved = p.into_area(PivotFieldArea::Value);
    assert!(moved.is_value());
    assert_eq!(moved.aggregate_function(), Some(AggregateFunction::Sum));
}

#[test]
fn into_area_column_to_filter() {
    let p = make_column("quarter", 0);
    let moved = p.into_area(PivotFieldArea::Filter);
    assert!(moved.is_filter());
}

#[test]
fn into_area_filter_to_row() {
    let p = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new("cat"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
    });
    let moved = p.into_area(PivotFieldArea::Row);
    assert!(moved.is_row());
}

#[test]
fn into_area_filter_to_column() {
    let p = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new("cat"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
    });
    let moved = p.into_area(PivotFieldArea::Column);
    assert!(moved.is_column());
}

#[test]
fn into_area_filter_to_value() {
    let p = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new("amount"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
    });
    let moved = p.into_area(PivotFieldArea::Value);
    assert!(moved.is_value());
    assert_eq!(moved.aggregate_function(), Some(AggregateFunction::Sum));
}

#[test]
fn into_area_value_to_column() {
    let p = make_value("sales", 0);
    let moved = p.into_area(PivotFieldArea::Column);
    assert!(moved.is_column());
    assert_eq!(moved.aggregate_function(), None);
}

#[test]
fn into_area_value_to_filter() {
    let p = make_value("sales", 0);
    let moved = p.into_area(PivotFieldArea::Filter);
    assert!(moved.is_filter());
}

#[test]
fn into_area_value_preserves_agg_when_moving_value_to_value() {
    // Same area is a no-op, aggregate preserved
    let p = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::new("sales"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Count,
        number_format: Some("#,##0".to_string()),
        show_values_as: None,
    });
    let moved = p.into_area(PivotFieldArea::Value);
    assert_eq!(moved.aggregate_function(), Some(AggregateFunction::Count));
}

#[test]
fn into_area_same_area_noop_row() {
    let p = make_row("region", 3);
    let moved = p.clone().into_area(PivotFieldArea::Row);
    assert_eq!(moved, p);
}

#[test]
fn into_area_same_area_noop_filter() {
    let p = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new("cat"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: Some("Category".to_string()),
        },
    });
    let moved = p.clone().into_area(PivotFieldArea::Filter);
    assert_eq!(moved, p);
}

// ---- config: get_field ----

fn make_test_config_with_fields() -> PivotTableConfig {
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
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    }
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
            cache_id: None,
            ref_range: None,
            first_data_row: None,
            first_data_col: None,
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
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
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

// ---- reorder_placement: move to filter area ----

fn make_filter(field_id: &str, position: usize) -> PivotFieldPlacement {
    PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::new(field_id),
            placement_id: crate::types::PlacementId::default(),
            position,
            display_name: None,
        },
    })
}

#[test]
fn reorder_placement_row_to_filter() {
    let mut config = make_reorder_config(vec![make_row("A", 0), make_row("B", 1)]);
    assert!(config.reorder_placement(0, PivotFieldArea::Filter, 0));

    let rows = config.row_placements();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field_id(), &FieldId::new("B"));

    let filters = config.get_placements_for_area(PivotFieldArea::Filter);
    assert_eq!(filters.len(), 1);
    assert_eq!(filters[0].field_id(), &FieldId::new("A"));
    assert!(filters[0].is_filter());
}

#[test]
fn reorder_placement_filter_to_value() {
    let mut config = make_reorder_config(vec![make_filter("A", 0)]);
    assert!(config.reorder_placement(0, PivotFieldArea::Value, 0));

    let values = config.value_placements();
    assert_eq!(values.len(), 1);
    assert_eq!(values[0].field_id(), &FieldId::new("A"));
    assert_eq!(values[0].aggregate_function(), Some(AggregateFunction::Sum));
}

#[test]
fn reorder_placement_preserves_value_agg_when_moving_value_to_row() {
    // Moving Value->Row should lose the aggregate (into_area handles this)
    let mut config = make_reorder_config(vec![PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::new("sales"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Max,
        number_format: None,
        show_values_as: None,
    })]);

    assert!(config.reorder_placement(0, PivotFieldArea::Row, 0));
    let rows = config.row_placements();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].is_row());
    assert_eq!(rows[0].aggregate_function(), None);
}

// ---- placement area() ----

#[test]
fn placement_area_returns_correct_area() {
    assert_eq!(make_row("a", 0).area(), PivotFieldArea::Row);
    assert_eq!(make_column("b", 0).area(), PivotFieldArea::Column);
    assert_eq!(make_value("c", 0).area(), PivotFieldArea::Value);
    assert_eq!(make_filter("d", 0).area(), PivotFieldArea::Filter);
}

#[test]
fn roundtrip_flat_typed_flat_value() {
    let original = PivotFieldPlacementFlat {
        field_id: FieldId::from("amount"),
        placement_id: crate::types::PlacementId::default(),
        calculated_field_id: None,
        area: PivotFieldArea::Value,
        position: 0,
        aggregate_function: Some(AggregateFunction::Max),
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
        display_name: Some("Max Amount".to_string()),
        number_format: Some("#,##0".to_string()),
        show_values_as: Some(ShowValuesAsConfig {
            calculation_type: ShowValuesAs::PercentOfGrandTotal,
            base_field: None,
            base_item: None,
        }),
    };
    let typed = PivotFieldPlacement::from(original.clone());
    let roundtripped = PivotFieldPlacementFlat::from(typed);
    assert_eq!(roundtripped, original);
}

#[test]
fn roundtrip_flat_typed_flat_filter() {
    let original = PivotFieldPlacementFlat {
        field_id: FieldId::from("category"),
        placement_id: crate::types::PlacementId::default(),
        calculated_field_id: None,
        area: PivotFieldArea::Filter,
        position: 5,
        aggregate_function: None,
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
        display_name: Some("Cat".to_string()),
        number_format: None,
        show_values_as: None,
    };
    let typed = PivotFieldPlacement::from(original.clone());
    let roundtripped = PivotFieldPlacementFlat::from(typed);
    assert_eq!(roundtripped, original);
}

// ---- Roundtrip: Typed -> Flat -> Typed preserves all fields ----

#[test]
fn roundtrip_typed_flat_typed_row() {
    let original = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("region"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Custom Name".to_string()),
        },
        sort_order: Some(SortDirection::Desc),
        custom_sort_list: Some(vec![CellValue::number(1.0), CellValue::number(2.0)]),
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("sales"),
            order: SortDirection::Asc,
            column_key: None,
        }),
        date_grouping: Some(DateGrouping::Year),
        number_grouping: Some(NumberGrouping::new(10.0, 200.0, 25.0)),
        show_subtotals: Some(true),
    });
    let flat = PivotFieldPlacementFlat::from(original.clone());
    let roundtripped = PivotFieldPlacement::from(flat);
    assert_eq!(roundtripped, original);
}

#[test]
fn roundtrip_typed_flat_typed_column() {
    let original = PivotFieldPlacement::Column(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("quarter"),
            placement_id: crate::types::PlacementId::default(),
            position: 3,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: Some(vec![
            CellValue::Text("Q1".into()),
            CellValue::Text("Q4".into()),
        ]),
        sort_by_value: None,
        date_grouping: Some(DateGrouping::Quarter),
        number_grouping: None,
        show_subtotals: Some(false),
    });
    let flat = PivotFieldPlacementFlat::from(original.clone());
    let roundtripped = PivotFieldPlacement::from(flat);
    assert_eq!(roundtripped, original);
}

#[test]
fn roundtrip_typed_flat_typed_filter() {
    let original = PivotFieldPlacement::Filter(FilterPlacement {
        base: PlacementBase {
            field_id: FieldId::from("status"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Status Filter".to_string()),
        },
    });
    let flat = PivotFieldPlacementFlat::from(original.clone());
    let roundtripped = PivotFieldPlacement::from(flat);
    assert_eq!(roundtripped, original);
}

// ---- Edge case: Value area with no aggregate_function defaults to Sum ----

#[test]
fn flat_to_typed_value_no_aggregate_defaults_sum() {
    let flat = PivotFieldPlacementFlat {
        field_id: FieldId::from("revenue"),
        placement_id: crate::types::PlacementId::default(),
        calculated_field_id: None,
        area: PivotFieldArea::Value,
        position: 0,
        aggregate_function: None,
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
        display_name: Some("Revenue".to_string()),
        number_format: Some("#,##0".to_string()),
        show_values_as: None,
    };
    let typed = PivotFieldPlacement::from(flat);
    match &typed {
        PivotFieldPlacement::Value(v) => {
            assert_eq!(v.aggregate_function, AggregateFunction::Sum);
            // display_name and number_format should still be preserved
            assert_eq!(v.base.display_name.as_deref(), Some("Revenue"));
            assert_eq!(v.number_format.as_deref(), Some("#,##0"));
        }
        _ => panic!("Expected Value placement"),
    }
}
