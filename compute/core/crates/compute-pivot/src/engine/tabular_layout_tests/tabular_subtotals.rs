use super::*;

/// 2 row fields, tabular, with subtotals on the outer (Region) field.
#[test]
fn tabular_with_subtotals() {
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
    config.layout = Some(layout_with_form(LayoutForm::Tabular));

    let result = compute(&config, &sample_sales_data(), Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_with_subtotals");

    let subtotal_rows = subtotal_rows(&result);
    assert!(
        !subtotal_rows.is_empty(),
        "tabular with subtotals should produce subtotal rows"
    );

    let east_subtotal = subtotal_with_outer_header(&subtotal_rows, "East");
    assert!(east_subtotal.is_some(), "should find East subtotal");
    assert_approx(&east_subtotal.unwrap().values[0], 3900.0, "East subtotal");

    let west_subtotal = subtotal_with_outer_header(&subtotal_rows, "West");
    assert!(west_subtotal.is_some(), "should find West subtotal");
    assert_approx(&west_subtotal.unwrap().values[0], 4600.0, "West subtotal");
}

#[test]
fn tabular_subtotal_null_in_unused_header() {
    let data = vec![
        vec![cv_text("Dept"), cv_text("Type"), cv_text("EmpID")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E1")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E2")],
        vec![cv_text("SOC"), cv_text("Offshore"), cv_text("E3")],
        vec![cv_text("FedRAMP"), cv_text("Direct"), cv_text("E4")],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("dept"),
            name: "Dept".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("type"),
            name: "Type".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("emp_id"),
            name: "EmpID".to_string(),
            source_column: 2,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
    ];

    let row_dept = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("dept"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: Some(SortDirection::Desc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: Some(true),
    });

    let row_type = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("type"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: Some(SortDirection::Asc),
        custom_sort_list: None,
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    });

    let value_count = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("emp_id"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Count".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::CountA,
        number_format: None,
        show_values_as: None,
    });

    let mut config = make_base_config(fields, vec![row_dept, row_type, value_count], vec![]);
    config.layout = Some(PivotTableLayout {
        layout_form: Some(LayoutForm::Tabular),
        show_row_grand_totals: Some(true),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_subtotal_null_in_unused_header");

    let subtotal_rows = subtotal_rows(&result);
    assert!(
        !subtotal_rows.is_empty(),
        "should have subtotal rows in tabular layout"
    );

    for st in &subtotal_rows {
        if st.headers.len() >= 2 {
            let inner_header_value = &st.headers[1].value;
            assert_eq!(
                *inner_header_value,
                CellValue::Null,
                "Subtotal row '{}' should have Null in inner header column, got {:?}",
                st.headers[0].value,
                inner_header_value
            );
        }
    }
}
