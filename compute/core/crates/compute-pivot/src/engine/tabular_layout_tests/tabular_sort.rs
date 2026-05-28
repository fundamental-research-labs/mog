use super::*;

/// Tabular with sort_by_value on the outer field (Region, depth 0).
#[test]
fn tabular_sort_by_value_depth0() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
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
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_sort_by_value_depth0");

    let rows = data_rows(&result);
    assert_eq!(rows.len(), 4);

    assert_eq!(
        rows[0].headers[0].value,
        cv_text("West"),
        "West (4600 total) should come before East (3900) in desc sort"
    );
    assert_eq!(
        rows.last().unwrap().headers[0].value,
        cv_text("East"),
        "East (3900 total) should come last in desc sort"
    );
}

/// Tabular with sort_by_value on the inner field (Product, depth 1).
#[test]
fn tabular_sort_by_value_depth1() {
    let mut product_axis = make_row_axis("product", 1);
    product_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_product = PivotFieldPlacement::Row(product_axis);

    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            placement_product,
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
    assert_no_compute_errors(&result, "tabular_sort_by_value_depth1");

    let rows = data_rows(&result);
    for row in &rows {
        assert_eq!(row.depth, 1);
    }

    let east_rows: Vec<&&PivotRow> = rows
        .iter()
        .filter(|r| r.headers[0].value == cv_text("East"))
        .collect();
    assert_eq!(east_rows.len(), 2);
    assert_eq!(
        east_rows[0].headers[1].value,
        cv_text("Widget"),
        "East Widget (2200) should come before East Gadget (1700) in desc sort"
    );
    assert_eq!(east_rows[1].headers[1].value, cv_text("Gadget"));

    let west_rows: Vec<&&PivotRow> = rows
        .iter()
        .filter(|r| r.headers[0].value == cv_text("West"))
        .collect();
    assert_eq!(west_rows.len(), 2);
    assert_eq!(
        west_rows[0].headers[1].value,
        cv_text("Widget"),
        "West Widget (3300) should come before West Gadget (1300) in desc sort"
    );
    assert_eq!(west_rows[1].headers[1].value, cv_text("Gadget"));
}

/// Tabular with sort_by_value on both row fields.
#[test]
fn tabular_sort_both_depths() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_region = PivotFieldPlacement::Row(region_axis);

    let mut product_axis = make_row_axis("product", 1);
    product_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement_product = PivotFieldPlacement::Row(product_axis);

    let mut config = make_base_config(
        sample_fields(),
        vec![
            placement_region,
            placement_product,
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
    assert_no_compute_errors(&result, "tabular_sort_both_depths");

    let rows = data_rows(&result);
    assert_eq!(rows.len(), 4);

    assert_eq!(rows[0].headers[0].value, cv_text("West"));
    assert_eq!(rows[0].headers[1].value, cv_text("Widget"));
    assert_eq!(rows[1].headers[0].value, cv_text("West"));
    assert_eq!(rows[1].headers[1].value, cv_text("Gadget"));
    assert_eq!(rows[2].headers[0].value, cv_text("East"));
    assert_eq!(rows[2].headers[1].value, cv_text("Widget"));
    assert_eq!(rows[3].headers[0].value, cv_text("East"));
    assert_eq!(rows[3].headers[1].value, cv_text("Gadget"));
}

/// Tabular sort ascending; East(3900) should come before West(4600).
#[test]
fn tabular_sort_asc() {
    let mut region_axis = make_row_axis("region", 0);
    region_axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Asc,
        column_key: None,
    });
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
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_sort_asc");

    let rows = data_rows(&result);

    assert_eq!(rows[0].headers[0].value, cv_text("East"));
    assert_eq!(rows.last().unwrap().headers[0].value, cv_text("West"));
}

#[test]
fn tabular_sort_by_value_alignment() {
    let data = census_data();
    let fields = census_fields();

    let row_function = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("function"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: Some(true),
    });

    let row_role = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("role"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("flc"),
            order: SortDirection::Desc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_avg = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("flc"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Avg FLC".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Average,
        number_format: None,
        show_values_as: None,
    });

    let mut config = make_base_config(fields, vec![row_function, row_role, value_avg], vec![]);
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &data, Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_sort_by_value_alignment");

    let rows = leaf_rows(&result);

    for row in &rows {
        assert_eq!(
            row.headers.len(),
            2,
            "Tabular leaf rows should have 2 headers, got {} for row with key '{}'",
            row.headers.len(),
            row.key
        );

        for (i, val) in row.values.iter().enumerate() {
            match val {
                CellValue::Number(_) | CellValue::Null => {}
                other => panic!(
                    "Value at index {} should be numeric, got {:?} for row key '{}'",
                    i, other, row.key
                ),
            }
        }
    }

    assert_eq!(
        rows[0].headers[1].value,
        cv_text("Director"),
        "Director (avg FLC 150000) should be first"
    );
    assert_eq!(
        rows[1].headers[1].value,
        cv_text("Principal"),
        "Principal (avg FLC 122500) should be second"
    );
}
