use super::*;
use value_types::CellValue;

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
