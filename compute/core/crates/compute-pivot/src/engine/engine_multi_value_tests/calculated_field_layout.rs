use super::*;

#[test]
fn test_calculated_field_with_grand_totals() {
    let mut config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("avg_price"),
            name: "Avg Price".to_string(),
            formula: "Sales / Units".to_string(),
        }],
    );
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let row_gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("row grand totals should exist");
    assert_eq!(row_gt.len(), 3, "3 values: Sales, Units, Avg Price");
    assert_eq!(row_gt[0], cv_num(8500.0), "Row GT: Sales");
    assert_eq!(row_gt[1], cv_num(85.0), "Row GT: Units");
    assert_eq!(row_gt[2], cv_num(100.0), "Row GT: Avg Price");

    // Column grand totals are suppressed when no column grouping fields exist.
    assert!(
        result.grand_totals.column.is_none(),
        "Column grand totals should be suppressed when no column grouping fields exist"
    );

    let grand_gt = result
        .grand_totals
        .grand
        .as_ref()
        .expect("grand total should exist");
    assert_eq!(grand_gt.len(), 3);
    assert_eq!(grand_gt[0], cv_num(8500.0), "Grand: Sales");
    assert_eq!(grand_gt[1], cv_num(85.0), "Grand: Units");
    assert_eq!(grand_gt[2], cv_num(100.0), "Grand: Avg Price");
}

#[test]
fn test_calculated_field_with_subtotals() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.show_subtotals = Some(true);

    let placements = vec![
        PivotFieldPlacement::Row(region_axis),
        make_placement("product", PivotFieldArea::Row, 1, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
        make_placement(
            "units",
            PivotFieldArea::Value,
            1,
            Some(AggregateFunction::Sum),
        ),
    ];

    let mut config = make_base_config(sample_fields(), placements, vec![]);
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("avg_price"),
        name: "Avg Price".to_string(),
        formula: "Sales / Units".to_string(),
    }]);

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let subtotal_rows: Vec<&PivotRow> = result.rows.iter().filter(|r| r.is_subtotal).collect();
    assert!(
        !subtotal_rows.is_empty(),
        "Should have subtotal rows when subtotals are enabled"
    );

    for st_row in &subtotal_rows {
        assert_eq!(
            st_row.values.len(),
            3,
            "Subtotal row '{}' should have 3 values (2 regular + 1 calc), got {}",
            st_row.key,
            st_row.values.len()
        );
        assert_ne!(
            st_row.values[2],
            CellValue::Null,
            "Subtotal calc field should not be Null for row '{}'",
            st_row.key
        );
    }
}

#[test]
fn test_calculated_field_with_column_grouping() {
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![("quarter", 2)],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("avg_price"),
            name: "Avg Price".to_string(),
            formula: "Sales / Units".to_string(),
        }],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    for row in &result.rows {
        assert_eq!(
            row.values.len(),
            6,
            "With 2 columns, expected 6 values (2*(2+1)), got {} for row '{}'",
            row.values.len(),
            row.key
        );
    }

    let east_row = result
        .rows
        .iter()
        .find(|r| {
            r.headers
                .iter()
                .any(|h| h.value == CellValue::Text("East".into()))
        })
        .expect("East row not found");

    let num_stride = 3;
    for col in 0..2 {
        let sales = &east_row.values[col * num_stride];
        let units = &east_row.values[col * num_stride + 1];
        let avg = &east_row.values[col * num_stride + 2];

        if let (CellValue::Number(s), CellValue::Number(u), CellValue::Number(a)) =
            (sales, units, avg)
        {
            let expected_avg = s.get() / u.get();
            assert!(
                (a.get() - expected_avg).abs() < 1e-10,
                "Column {}: expected avg_price {}, got {}",
                col,
                expected_avg,
                *a
            );
        } else {
            panic!(
                "Column {}: expected all Numbers, got Sales={:?}, Units={:?}, Avg={:?}",
                col, sales, units, avg
            );
        }
    }
}
