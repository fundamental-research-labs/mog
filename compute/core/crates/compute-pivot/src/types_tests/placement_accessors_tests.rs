use super::common::*;
use super::*;

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

// ---- placement area() ----

#[test]
fn placement_area_returns_correct_area() {
    assert_eq!(make_row("a", 0).area(), PivotFieldArea::Row);
    assert_eq!(make_column("b", 0).area(), PivotFieldArea::Column);
    assert_eq!(make_value("c", 0).area(), PivotFieldArea::Value);
    assert_eq!(make_filter("d", 0).area(), PivotFieldArea::Filter);
}
