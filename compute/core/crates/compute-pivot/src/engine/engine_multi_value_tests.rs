//! Multiple value fields, calculated fields, show_values_as transforms,
//! and related sensitivity tests.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

// ---- Multiple value fields ----

#[test]
fn compute_multiple_value_fields() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
        ],
        vec![],
    );

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));

    assert!(result.errors.is_none());
    // Each row should have 2 values (sales, units)
    assert_eq!(result.rows[0].values.len(), 2);

    // East: Sales=3900, Units=39
    let east_row = result
        .rows
        .iter()
        .find(|r| r.headers[0].value == cv_text("East"))
        .unwrap();
    assert_eq!(east_row.values[0], cv_num(3900.0));
    assert_eq!(east_row.values[1], cv_num(39.0));
}

// ---- SpreadJS: multiple value fields ----

#[test]
fn spreadjs_multiple_value_fields() {
    let data = sample_sales_data();
    let config = build_spreadjs_config(
        "multiple_value_fields",
        &spreadjs_sales_fields(),
        &["Region"],
        &[],
        &[
            ("Sales", AggregateFunction::Sum),
            ("Units", AggregateFunction::Sum),
        ],
        vec![],
        &data,
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    let east = find_row_by_key(&result.rows, "East").expect("East row not found");
    assert_approx(&east.values[0], 3900.0, "East SUM(Sales)");
    assert_approx(&east.values[1], 39.0, "East SUM(Units)");

    let west = find_row_by_key(&result.rows, "West").expect("West row not found");
    assert_approx(&west.values[0], 4600.0, "West SUM(Sales)");
    assert_approx(&west.values[1], 46.0, "West SUM(Units)");

    let gt = result
        .grand_totals
        .row
        .as_ref()
        .expect("grand totals missing");
    assert_approx(&gt[0], 8500.0, "Grand Total SUM(Sales)");
    assert_approx(&gt[1], 85.0, "Grand Total SUM(Units)");
}

// ---- Calculated field tests ----

#[test]
fn test_calculated_field_basic() {
    let config = make_config_with_calc_fields(
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

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(
        result.errors.is_none(),
        "Expected no errors: {:?}",
        result.errors
    );

    for row in &result.rows {
        assert_eq!(
            row.values.len(),
            3,
            "Expected 3 values per row (2 regular + 1 calc), got {} for row key '{}'",
            row.values.len(),
            row.key
        );
    }

    // East: Sales=3900, Units=39, AvgPrice=100
    let east_row = result
        .rows
        .iter()
        .find(|r| {
            r.headers
                .iter()
                .any(|h| h.value == CellValue::Text("East".into()))
        })
        .expect("East row not found");
    assert_eq!(east_row.values[0], cv_num(3900.0), "East Sales");
    assert_eq!(east_row.values[1], cv_num(39.0), "East Units");
    assert_eq!(
        east_row.values[2],
        cv_num(100.0),
        "East Avg Price = 3900/39"
    );

    // West: Sales=4600, Units=46, AvgPrice=100
    let west_row = result
        .rows
        .iter()
        .find(|r| {
            r.headers
                .iter()
                .any(|h| h.value == CellValue::Text("West".into()))
        })
        .expect("West row not found");
    assert_eq!(west_row.values[0], cv_num(4600.0), "West Sales");
    assert_eq!(west_row.values[1], cv_num(46.0), "West Units");
    assert_eq!(
        west_row.values[2],
        cv_num(100.0),
        "West Avg Price = 4600/46"
    );
}

#[test]
fn test_calculated_field_complex_formula() {
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("margin"),
            name: "Margin".to_string(),
            formula: "(Sales - Units) / Sales * 100".to_string(),
        }],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // East: Sales=3900, Units=39 => (3900-39)/3900*100 = 99.0
    let east_row = result
        .rows
        .iter()
        .find(|r| {
            r.headers
                .iter()
                .any(|h| h.value == CellValue::Text("East".into()))
        })
        .expect("East row not found");

    if let CellValue::Number(n) = &east_row.values[2] {
        assert!((n.get() - 99.0).abs() < 1e-10, "Expected ~99.0, got {}", n);
    } else {
        panic!(
            "Expected Number for calc field, got {:?}",
            east_row.values[2]
        );
    }
}

#[test]
fn test_calculated_field_division_by_zero() {
    let data = vec![
        vec![
            cv_text("Region"),
            cv_text("Product"),
            cv_text("Quarter"),
            cv_text("Sales"),
            cv_text("Units"),
        ],
        vec![
            cv_text("East"),
            cv_text("Widget"),
            cv_text("Q1"),
            cv_num(1000.0),
            cv_num(0.0),
        ],
        vec![
            cv_text("East"),
            cv_text("Widget"),
            cv_text("Q2"),
            cv_num(1200.0),
            cv_num(0.0),
        ],
        vec![
            cv_text("West"),
            cv_text("Widget"),
            cv_text("Q1"),
            cv_num(1500.0),
            cv_num(15.0),
        ],
    ];

    let config = make_config_with_calc_fields(
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

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    // East: Units=0, so division by zero => Null
    let east_row = result
        .rows
        .iter()
        .find(|r| {
            r.headers
                .iter()
                .any(|h| h.value == CellValue::Text("East".into()))
        })
        .expect("East row not found");
    assert_eq!(
        east_row.values[2],
        CellValue::Null,
        "Division by zero should produce Null"
    );

    // West: Units=15, Sales=1500, AvgPrice=100
    let west_row = result
        .rows
        .iter()
        .find(|r| {
            r.headers
                .iter()
                .any(|h| h.value == CellValue::Text("West".into()))
        })
        .expect("West row not found");
    assert_eq!(west_row.values[2], cv_num(100.0), "West Avg Price");
}

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
fn test_calculated_field_validation_error() {
    let mut config = make_base_config(
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
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("bad_calc"),
        name: "Bad Calc".to_string(),
        formula: "Sales +* Units".to_string(), // Invalid syntax
    }]);

    let errors = validate_config(&config);
    assert!(
        errors
            .iter()
            .any(|e| e.contains("Bad Calc") && e.contains("formula error")),
        "Should have validation error for invalid formula: {:?}",
        errors
    );
}

#[test]
fn test_calculated_field_unknown_field_ref() {
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![CalculatedField {
            field_id: CalculatedFieldId::from("calc1"),
            name: "Calc".to_string(),
            formula: "Revenue / Units".to_string(), // "Revenue" doesn't match "Sales"
        }],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(
        result.errors.is_none(),
        "Unknown field ref should not cause error"
    );

    for row in &result.rows {
        assert_eq!(
            row.values[2],
            CellValue::Null,
            "Calc field with unknown ref should be Null for row '{}'",
            row.key
        );
    }
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
fn test_no_calculated_fields_regression() {
    let config = make_base_config(
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

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    for row in &result.rows {
        assert_eq!(
            row.values.len(),
            1,
            "No calc fields: expected 1 value per row, got {}",
            row.values.len()
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
    assert_eq!(east_row.values[0], cv_num(3900.0));
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

#[test]
fn test_calculated_field_empty_formula_validation() {
    let mut config = make_base_config(
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
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("empty_calc"),
        name: "Empty".to_string(),
        formula: String::new(),
    }]);

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("empty formula")),
        "Should flag empty formula: {:?}",
        errors
    );
}

#[test]
fn test_calculated_field_multiple_calc_fields() {
    let config = make_config_with_calc_fields(
        vec![("region", 0)],
        vec![],
        vec![
            ("sales", 3, AggregateFunction::Sum),
            ("units", 4, AggregateFunction::Sum),
        ],
        vec![
            CalculatedField {
                field_id: CalculatedFieldId::from("avg_price"),
                name: "Avg Price".to_string(),
                formula: "Sales / Units".to_string(),
            },
            CalculatedField {
                field_id: CalculatedFieldId::from("total"),
                name: "Total".to_string(),
                formula: "Sales + Units".to_string(),
            },
        ],
    );

    let data = sample_sales_data();
    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());

    for row in &result.rows {
        assert_eq!(
            row.values.len(),
            4,
            "Expected 4 values, got {} for row '{}'",
            row.values.len(),
            row.key
        );
    }

    // East: Sales=3900, Units=39, AvgPrice=100, Total=3939
    let east_row = result
        .rows
        .iter()
        .find(|r| {
            r.headers
                .iter()
                .any(|h| h.value == CellValue::Text("East".into()))
        })
        .expect("East row not found");
    assert_eq!(east_row.values[2], cv_num(100.0), "East Avg Price");
    assert_eq!(east_row.values[3], cv_num(3939.0), "East Total");
}

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

#[test]
fn sensitivity_calculated_fields() {
    let config_none = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
        ],
        vec![],
    );
    let result_none = compute(&config_none, &sample_sales_data(), Some(&expand_all()));

    let mut config_calc = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
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
        ],
        vec![],
    );
    config_calc.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("avg_price"),
        name: "Avg Price".to_string(),
        formula: "Sales / Units".to_string(),
    }]);
    let result_calc = compute(&config_calc, &sample_sales_data(), Some(&expand_all()));

    assert!(
        result_calc.rows[0].values.len() > result_none.rows[0].values.len(),
        "calculated_fields must add additional values: with_calc={}, without={}",
        result_calc.rows[0].values.len(),
        result_none.rows[0].values.len(),
    );
}

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

// ============================================================================
// Filter type coercion at the engine boundary
// ============================================================================

#[test]
fn filter_include_text_value_matches_number_cells() {
    // Cell values stored as Number(2024.0); filter typed by user as "2024".
    // The relational engine should treat the textual filter value as
    // matching numeric cells with the same value, without the kernel having
    // to pre-coerce strings to numbers.
    let fields = vec![
        PivotField {
            id: FieldId::from("col0"),
            name: "Year".to_string(),
            source_column: 0,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("col1"),
            name: "Revenue".to_string(),
            source_column: 1,
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
        make_placement("col0", PivotFieldArea::Filter, 0, None),
    ];

    let filters = vec![PivotFilter {
        field_id: FieldId::from("col0"),
        // Textual filter value — must match Number cells.
        include_values: Some(vec![cv_text("2024")]),
        exclude_values: None,
        condition: None,
        top_bottom: None,
        show_items_with_no_data: None,
    }];

    let config = make_base_config(fields, placements, filters);

    let data = vec![
        vec![cv_text("Year"), cv_text("Revenue")],
        vec![cv_num(2023.0), cv_num(100.0)],
        vec![cv_num(2024.0), cv_num(300.0)],
        vec![cv_num(2024.0), cv_num(50.0)],
    ];

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Only 2024 rows survive; group total is 350.
    assert_eq!(result.rows.len(), 1, "exactly one surviving Year group");
    let row = &result.rows[0];
    assert_eq!(row.values[0], cv_num(350.0));
}

#[test]
fn filter_include_number_value_matches_text_cells() {
    // Inverse direction: numeric filter value should also match text cells
    // whose content parses to the same number.
    let fields = vec![
        PivotField {
            id: FieldId::from("col0"),
            name: "Code".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("col1"),
            name: "Revenue".to_string(),
            source_column: 1,
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
        make_placement("col0", PivotFieldArea::Filter, 0, None),
    ];

    let filters = vec![PivotFilter {
        field_id: FieldId::from("col0"),
        include_values: Some(vec![cv_num(100.0)]),
        exclude_values: None,
        condition: None,
        top_bottom: None,
        show_items_with_no_data: None,
    }];

    let config = make_base_config(fields, placements, filters);
    let data = vec![
        vec![cv_text("Code"), cv_text("Revenue")],
        vec![cv_text("100"), cv_num(50.0)],
        vec![cv_text("200"), cv_num(75.0)],
    ];

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none());
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].values[0], cv_num(50.0));
}

#[test]
fn filter_exclude_text_value_excludes_number_cells() {
    // Exclude `"2023"` (text) should drop Number(2023.0) cells too.
    let fields = vec![
        PivotField {
            id: FieldId::from("col0"),
            name: "Year".to_string(),
            source_column: 0,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("col1"),
            name: "Revenue".to_string(),
            source_column: 1,
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
        make_placement("col0", PivotFieldArea::Filter, 0, None),
    ];

    let filters = vec![PivotFilter {
        field_id: FieldId::from("col0"),
        include_values: None,
        exclude_values: Some(vec![cv_text("2023")]),
        condition: None,
        top_bottom: None,
        show_items_with_no_data: None,
    }];

    let config = make_base_config(fields, placements, filters);
    let data = vec![
        vec![cv_text("Year"), cv_text("Revenue")],
        vec![cv_num(2023.0), cv_num(100.0)],
        vec![cv_num(2024.0), cv_num(300.0)],
    ];

    let result = compute(&config, &data, Some(&expand_all()));
    assert_eq!(result.rows.len(), 1, "2023 must be excluded");
    assert_eq!(result.rows[0].values[0], cv_num(300.0));
}

#[test]
fn filter_strings_with_same_textual_value_still_match() {
    // Sanity check that the type-tolerant matching does not break ordinary
    // text-vs-text filtering: include `"North"` against text cells.
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
            name: "Revenue".to_string(),
            source_column: 1,
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
        make_placement("col0", PivotFieldArea::Filter, 0, None),
    ];

    let filters = vec![PivotFilter {
        field_id: FieldId::from("col0"),
        include_values: Some(vec![cv_text("North")]),
        exclude_values: None,
        condition: None,
        top_bottom: None,
        show_items_with_no_data: None,
    }];

    let config = make_base_config(fields, placements, filters);
    let data = vec![
        vec![cv_text("Region"), cv_text("Revenue")],
        vec![cv_text("North"), cv_num(100.0)],
        vec![cv_text("South"), cv_num(200.0)],
    ];

    let result = compute(&config, &data, Some(&expand_all()));
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].values[0], cv_num(100.0));
}

// ============================================================================
// Aggregation: COUNT (numeric only) vs COUNTA (non-blank, all types)
// ============================================================================
//
// The wire-format `AggregateFunction` enum keeps the engine-neutral split
// between `Count` (Excel COUNT — numeric only) and `CountA` (Excel COUNTA
// — non-blank including text). This makes the contract crisp at the
// bridge: enum values map 1:1 to engine semantics; the user-facing TS
// `PivotAggregation` vocabulary handles the Excel UI conventions
// (where Count = COUNTA) without any reverse-mapping table on the wire.

#[test]
fn aggregate_count_vs_counta_distinct_semantics() {
    // OrderId column has 4 numbers, 1 text, 1 blank.
    //   COUNTA (non-blank) => 5
    //   COUNT  (numeric)   => 4
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
            name: "OrderId".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    let data = vec![
        vec![cv_text("Region"), cv_text("OrderId")],
        vec![cv_text("North"), cv_num(1.0)],
        vec![cv_text("North"), cv_num(2.0)],
        vec![cv_text("North"), cv_text("A3")],
        vec![cv_text("South"), cv_num(4.0)],
        vec![cv_text("South"), cv_num(5.0)],
        vec![cv_text("North"), CellValue::Null],
    ];

    // COUNTA — counts all 5 non-blank cells (4 numbers + 1 text).
    let placements_a = vec![
        make_placement("col0", PivotFieldArea::Row, 0, None),
        make_placement(
            "col1",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::CountA),
        ),
    ];
    let config_a = make_base_config(fields.clone(), placements_a, vec![]);
    let result_a = compute(&config_a, &data, Some(&expand_all()));
    let gt_a = result_a.grand_totals.row.as_ref().expect("counta gt");
    assert_eq!(gt_a[0], cv_num(5.0), "COUNTA grand total = 5 (non-blank)");

    // COUNT — counts only the 4 numeric cells.
    let placements_c = vec![
        make_placement("col0", PivotFieldArea::Row, 0, None),
        make_placement(
            "col1",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Count),
        ),
    ];
    let config_c = make_base_config(fields, placements_c, vec![]);
    let result_c = compute(&config_c, &data, Some(&expand_all()));
    let gt_c = result_c.grand_totals.row.as_ref().expect("count gt");
    assert_eq!(gt_c[0], cv_num(4.0), "COUNT grand total = 4 (numbers only)");
}
