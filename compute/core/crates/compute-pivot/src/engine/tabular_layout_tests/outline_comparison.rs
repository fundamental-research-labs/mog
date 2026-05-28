use super::*;

/// Outline layout with 2 row fields; group header rows should exist.
#[test]
fn outline_basic_two_level() {
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
    config.layout = Some(layout_with_form(LayoutForm::Outline));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "outline_basic_two_level");

    let rows = data_rows(&result);

    let depth0_rows: Vec<&&PivotRow> = rows.iter().filter(|r| r.depth == 0).collect();
    assert!(
        !depth0_rows.is_empty(),
        "outline layout should have group header rows at depth 0"
    );

    let depth1_rows: Vec<&&PivotRow> = rows.iter().filter(|r| r.depth == 1).collect();
    assert_eq!(depth1_rows.len(), 4, "should have 4 leaf product rows");

    for row in &depth0_rows {
        assert_eq!(
            row.headers.len(),
            1,
            "outline group header should have 1 header, got {}",
            row.headers.len()
        );
    }

    for row in &depth1_rows {
        assert_eq!(
            row.headers.len(),
            2,
            "outline leaf row should have 2 headers, got {}",
            row.headers.len()
        );
    }
}

/// Outline layout with subtotals.
#[test]
fn outline_with_subtotals() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.show_subtotals = Some(true);
    let placement_region = PivotFieldPlacement::Row(region_axis);

    let mut config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
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
    config.layout = Some(layout_with_form(LayoutForm::Outline));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "outline_with_subtotals");

    let subtotal_rows = subtotal_rows(&result);
    assert!(
        !subtotal_rows.is_empty(),
        "outline with subtotals should produce subtotal rows"
    );

    let east_sub = subtotal_with_outer_header(&subtotal_rows, "East");
    assert!(east_sub.is_some(), "should find East subtotal");
    assert_approx(
        &east_sub.unwrap().values[0],
        3900.0,
        "outline East subtotal",
    );

    let west_sub = subtotal_with_outer_header(&subtotal_rows, "West");
    assert!(west_sub.is_some(), "should find West subtotal");
    assert_approx(
        &west_sub.unwrap().values[0],
        4600.0,
        "outline West subtotal",
    );
}
