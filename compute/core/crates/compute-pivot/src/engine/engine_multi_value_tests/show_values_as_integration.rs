use super::*;

// ---- ShowValuesAs tests ----

#[test]
fn b4a_compute_with_show_values_as_percent_of_grand_total() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfGrandTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let result = compute_with_show_values_as(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(result.rows.len(), 2);

    let mut total = 0.0;
    for row in &result.rows {
        if let CellValue::Number(v) = &row.values[0] {
            total += v.get();
        }
    }
    assert!(
        (total - 1.0).abs() < 0.005,
        "Percentages should sum to ~1.0 (fractional scale matching Excel), got {}",
        total
    );

    for row in &result.rows {
        if let CellValue::Number(v) = &row.values[0] {
            assert!(
                v.get() > 0.0,
                "Percentage should be positive, got {}",
                v.get()
            );
        }
    }
}

#[test]
fn b4g_percent_difference_next_base_item() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Category"), cv_text("Sales")],
        vec![cv_text("A"), cv_num(100.0)],
        vec![cv_text("B"), cv_num(200.0)],
        vec![cv_text("C"), cv_num(300.0)],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("category"),
            name: "Category".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sales"),
            name: "Sales".to_string(),
            source_column: 1,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];

    let config = make_base_config(
        fields,
        vec![
            make_placement("category", PivotFieldArea::Row, 0, None),
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
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentDifference,
                    base_field: Some(FieldId::from("category")),
                    base_item: Some(ShowValuesAsBaseItem::Relative {
                        position: RelativePosition::Next,
                    }),
                }),
            }),
        ],
        vec![],
    );

    let result = compute_with_show_values_as(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);
    assert_eq!(result.rows.len(), 3);

    let last_row = &result.rows[result.rows.len() - 1];
    assert_eq!(
        last_row.values[0],
        CellValue::Null,
        "Last row in '% Difference From Next' should be Null (no next item exists)"
    );
}

#[test]
fn b4h_percent_of_row_total_hierarchical() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("quarter", PivotFieldArea::Column, 0, None),
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
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfRowTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let result = compute_with_show_values_as(&config, &sample_sales_data(), Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let leaf_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    for row in &leaf_rows {
        let row_sum: f64 = row
            .values
            .iter()
            .filter_map(|v| match v {
                CellValue::Number(n) if n.is_finite() => Some(n.get()),
                _ => None,
            })
            .sum();

        if row_sum > 0.0 {
            assert!(
                (row_sum - 1.0).abs() < 0.01,
                "Row '{}' values should sum to ~1.0 (fractional scale matching Excel), got {}",
                row.key,
                row_sum,
            );
        }
    }
}

// ---- Sensitivity tests ----

#[test]
fn sensitivity_show_values_as() {
    let config_raw = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    let result_raw =
        compute_with_show_values_as(&config_raw, &sample_sales_data(), Some(&expand_all()));

    let config_pct = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfGrandTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );
    let result_pct =
        compute_with_show_values_as(&config_pct, &sample_sales_data(), Some(&expand_all()));

    let values_raw: Vec<_> = result_raw.rows.iter().map(|r| &r.values).collect();
    let values_pct: Vec<_> = result_pct.rows.iter().map(|r| &r.values).collect();
    assert_ne!(
        values_raw, values_pct,
        "show_values_as must affect computed values"
    );
}
