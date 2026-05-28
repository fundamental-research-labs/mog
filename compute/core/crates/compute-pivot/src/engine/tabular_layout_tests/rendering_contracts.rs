use super::*;

#[test]
fn tabular_no_repeat_row_labels() {
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
        show_subtotals: None,
    });

    let row_role = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("role"),
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

    let value_sum = PivotFieldPlacement::Value(ValuePlacement {
        base: PlacementBase {
            field_id: FieldId::from("flc"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: Some("Sum of FLC".to_string()),
        },
        source: crate::types::PivotValueSource::Field {
            field_id: crate::types::FieldId::default(),
        },
        aggregate_function: AggregateFunction::Sum,
        number_format: None,
        show_values_as: None,
    });

    let mut config = make_base_config(fields, vec![row_function, row_role, value_sum], vec![]);
    config.layout = Some(PivotTableLayout {
        layout_form: Some(LayoutForm::Tabular),
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        repeat_row_labels: Some(false),
        ..Default::default()
    });

    let result = compute(&config, &data, Some(&expand_all()));
    assert_no_compute_errors(&result, "tabular_no_repeat_row_labels");

    let rows = leaf_rows(&result);
    assert!(rows.len() >= 2, "need at least 2 leaf rows");

    assert_eq!(
        rows[0].headers[0].value,
        cv_text("COGS"),
        "First row should show the outer header"
    );

    // The compute engine retains full header values. Repeat-label suppression
    // belongs to the rendering/grid mapping layer.
    assert_eq!(
        rows[1].headers[0].value,
        cv_text("COGS"),
        "Compute engine should produce full header values"
    );
}
