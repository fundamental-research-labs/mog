use super::*;

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
