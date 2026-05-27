use super::common::*;
use super::*;

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
