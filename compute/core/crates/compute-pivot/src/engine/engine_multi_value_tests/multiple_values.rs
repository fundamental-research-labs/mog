use super::*;

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
