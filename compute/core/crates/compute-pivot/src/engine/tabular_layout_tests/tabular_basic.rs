use super::*;

/// 2 row fields (Region, Product), Value=Sum(Sales), tabular layout.
/// All rows should be leaf-level with 2 headers each.
#[test]
fn tabular_basic_two_level() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_basic_two_level");

    let rows = leaf_rows(&result);
    assert_eq!(rows.len(), 4, "expected 4 leaf rows, got {}", rows.len());

    for row in &rows {
        assert_eq!(
            row.headers.len(),
            2,
            "row {:?} should have 2 headers, got {}",
            row.key,
            row.headers.len()
        );
    }

    let east_widget = find_row_by_key(&result.rows, "East|Widget");
    assert!(east_widget.is_some(), "should find East|Widget row");
    assert_approx(&east_widget.unwrap().values[0], 2200.0, "East Widget sales");

    let east_gadget = find_row_by_key(&result.rows, "East|Gadget");
    assert!(east_gadget.is_some(), "should find East|Gadget row");
    assert_approx(&east_gadget.unwrap().values[0], 1700.0, "East Gadget sales");

    let west_widget = find_row_by_key(&result.rows, "West|Widget");
    assert!(west_widget.is_some(), "should find West|Widget row");
    assert_approx(&west_widget.unwrap().values[0], 3300.0, "West Widget sales");

    let west_gadget = find_row_by_key(&result.rows, "West|Gadget");
    assert!(west_gadget.is_some(), "should find West|Gadget row");
    assert_approx(&west_gadget.unwrap().values[0], 1300.0, "West Gadget sales");
}

/// 3 row fields (Region, Product, Quarter) in tabular layout.
#[test]
fn tabular_three_level() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("quarter", PivotFieldArea::Row, 2, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_three_level");

    let rows = leaf_rows(&result);
    assert_eq!(rows.len(), 8, "expected 8 leaf rows for 3-level tabular");

    for row in &rows {
        assert_eq!(
            row.headers.len(),
            3,
            "3-level tabular row {:?} should have 3 headers, got {}",
            row.key,
            row.headers.len()
        );
    }

    let east_widget_q1 = find_row_by_key(&result.rows, "East|Widget|Q1");
    assert!(east_widget_q1.is_some(), "should find East|Widget|Q1");
    assert_approx(
        &east_widget_q1.unwrap().values[0],
        1000.0,
        "East Widget Q1 sales",
    );
}

/// Verify no group header row exists at depth==0 in 2-level tabular.
#[test]
fn tabular_no_group_header_rows() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_no_group_header_rows");

    let depth0_data_rows: Vec<&PivotRow> = data_rows(&result)
        .into_iter()
        .filter(|r| r.depth == 0)
        .collect();

    assert!(
        depth0_data_rows.is_empty(),
        "tabular layout should not emit group header rows at depth 0, found {} rows: {:?}",
        depth0_data_rows.len(),
        depth0_data_rows.iter().map(|r| &r.key).collect::<Vec<_>>()
    );
}

/// Tabular layout with column fields; column structure should be unaffected.
#[test]
fn tabular_with_column_fields() {
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("product", PivotFieldArea::Row, 1, None),
            make_placement("quarter", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_with_column_fields");

    assert!(
        !result.column_headers.is_empty(),
        "column headers should be present with tabular layout"
    );

    let all_col_values: Vec<&CellValue> = result
        .column_headers
        .iter()
        .flat_map(|ch| ch.headers.iter().map(|h| &h.value))
        .collect();
    let has_q1 = all_col_values.iter().any(|v| **v == cv_text("Q1"));
    let has_q2 = all_col_values.iter().any(|v| **v == cv_text("Q2"));
    assert!(has_q1, "should have Q1 column");
    assert!(has_q2, "should have Q2 column");

    let rows = leaf_rows(&result);
    assert_eq!(rows.len(), 4, "should have 4 leaf rows with column fields");

    for row in &rows {
        assert_eq!(row.headers.len(), 2, "each row should have 2 row headers");
    }
}
