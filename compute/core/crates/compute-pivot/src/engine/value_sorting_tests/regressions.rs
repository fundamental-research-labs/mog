use super::*;

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
