use super::*;

// ============================================================================
// Calculated field — per-group evaluation with field-id ≠ field-name
// ============================================================================
//
// Regression: in the live API the kernel synthesises field IDs like `col0`,
// `col1`, … that differ from the source-column header text the user typed
// the formula against (`Sales`, `Quantity`, …). Earlier `Measure.name` was
// pinned to `display_name` (typically `None`), so the relational engine's
// case-insensitive lookup fell through to `measure.id` (= the synthetic
// `col0`/`col1`) — which doesn't match the formula identifiers either.
// Result: per-group calc fields returned `Null` and only the grand total
// happened to compute correctly. The TS harness papered over this with a
// JS `Function()` evaluator. The fix wires the source field **name**
// through `Measure.name` so the relational engine's per-node evaluator
// resolves the formula against the per-group aggregated values.

#[test]
fn calculated_field_per_group_with_synthetic_ids() {
    // Two groups, one calc field defined as Sales / Quantity.
    // North: Sum(Sales)=700, Sum(Quantity)=10  ⇒ ratio = 70.0
    // South: Sum(Sales)=1200, Sum(Quantity)=8  ⇒ ratio = 150.0
    let fields = vec![
        PivotField {
            id: FieldId::from("col0"),
            name: "Region".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("col1"),
            name: "Sales".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("col2"),
            name: "Quantity".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let placements = vec![
        make_placement("col0", PivotFieldArea::Row, 0, None),
        make_placement(
            "col1",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
        make_placement(
            "col2",
            PivotFieldArea::Value,
            1,
            Some(AggregateFunction::Sum),
        ),
    ];

    let mut config = make_base_config(fields, placements, vec![]);
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("ratio"),
        name: "AvgPrice".to_string(),
        formula: "Sales / Quantity".to_string(),
    }]);

    let data = vec![
        vec![cv_text("Region"), cv_text("Sales"), cv_text("Quantity")],
        vec![cv_text("North"), cv_num(500.0), cv_num(7.0)],
        vec![cv_text("North"), cv_num(200.0), cv_num(3.0)],
        vec![cv_text("South"), cv_num(800.0), cv_num(5.0)],
        vec![cv_text("South"), cv_num(400.0), cv_num(3.0)],
    ];

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Each row should have 3 values: Sales sum, Quantity sum, calc ratio.
    let north = result
        .rows
        .iter()
        .find(|r| r.headers.iter().any(|h| h.value == cv_text("North")))
        .expect("North row missing");
    assert_eq!(north.values.len(), 3, "North needs 2 measures + 1 calc");
    assert_eq!(north.values[0], cv_num(700.0), "North Sum(Sales)");
    assert_eq!(north.values[1], cv_num(10.0), "North Sum(Quantity)");
    assert_eq!(north.values[2], cv_num(70.0), "North ratio per-group");

    let south = result
        .rows
        .iter()
        .find(|r| r.headers.iter().any(|h| h.value == cv_text("South")))
        .expect("South row missing");
    assert_eq!(south.values[0], cv_num(1200.0), "South Sum(Sales)");
    assert_eq!(south.values[1], cv_num(8.0), "South Sum(Quantity)");
    assert_eq!(south.values[2], cv_num(150.0), "South ratio per-group");

    // Grand total should still get the aggregate-then-divide answer:
    // Sum(Sales)=1900, Sum(Quantity)=18 ⇒ 105.555...
    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("missing grand total row");
    assert_eq!(gt.len(), 3);
    if let CellValue::Number(n) = &gt[2] {
        assert!(
            (n.get() - 1900.0 / 18.0).abs() < 1e-10,
            "Grand total ratio should be Sum(Sales)/Sum(Quantity); got {n}"
        );
    } else {
        panic!("grand total ratio expected Number, got {:?}", gt[2]);
    }
}

#[test]
fn calculated_field_per_group_division_by_zero_produces_null() {
    // North: Quantity=0 ⇒ Null per-group; South: normal ratio.
    let fields = vec![
        PivotField {
            id: FieldId::from("col0"),
            name: "Region".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("col1"),
            name: "Sales".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("col2"),
            name: "Quantity".to_string(),
            source_column: 2,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let placements = vec![
        make_placement("col0", PivotFieldArea::Row, 0, None),
        make_placement(
            "col1",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
        make_placement(
            "col2",
            PivotFieldArea::Value,
            1,
            Some(AggregateFunction::Sum),
        ),
    ];

    let mut config = make_base_config(fields, placements, vec![]);
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("ratio"),
        name: "AvgPrice".to_string(),
        formula: "Sales / Quantity".to_string(),
    }]);

    let data = vec![
        vec![cv_text("Region"), cv_text("Sales"), cv_text("Quantity")],
        vec![cv_text("North"), cv_num(500.0), cv_num(0.0)],
        vec![cv_text("South"), cv_num(800.0), cv_num(4.0)],
    ];

    let result = compute(&config, &data, Some(&expand_all()));
    let north = result
        .rows
        .iter()
        .find(|r| r.headers.iter().any(|h| h.value == cv_text("North")))
        .expect("North");
    assert_eq!(
        north.values[2],
        CellValue::Null,
        "North divides by zero, should be Null"
    );
    let south = result
        .rows
        .iter()
        .find(|r| r.headers.iter().any(|h| h.value == cv_text("South")))
        .expect("South");
    assert_eq!(south.values[2], cv_num(200.0));
}
