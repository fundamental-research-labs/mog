use super::super::*;

fn cv_text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn cv_num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn make_regression_config(
    fields: Vec<crate::types::PivotField>,
    placements: Vec<crate::types::PivotFieldPlacement>,
    filters: Vec<crate::types::PivotFilter>,
) -> crate::types::PivotTableConfig {
    crate::types::PivotTableConfig {
        schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: "pivot1".to_string(),
        name: "Test Pivot".to_string(),
        source_sheet_id: None,
        source_sheet_name: "sheet1".to_string(),
        source_range: crate::types::CellRange::new(0, 0, 8, 4),
        output_sheet_name: "sheet1".to_string(),
        output_location: crate::types::OutputLocation { row: 0, col: 0 },
        fields,
        placements,
        filters,
        layout: None,
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        data_on_rows: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_header_row: None,
        first_data_col: None,
        rows_per_page: None,
        cols_per_page: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    }
}

/// PercentOfParentRowTotal must output fractions (0.0-1.0), not multiplied by 100.
#[test]
fn percent_of_parent_row_outputs_fraction_not_times_100() {
    use crate::engine::{compute_with_show_values_as, detect_fields};
    use crate::types::{
        AggregateFunction, AxisPlacement, PivotFieldPlacement, PlacementBase, ShowValuesAs,
        ShowValuesAsConfig, ValuePlacement,
    };

    let data = vec![
        vec![cv_text("ServiceLine"), cv_text("Type"), cv_text("EmpID")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E1")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E2")],
        vec![cv_text("SOC"), cv_text("Direct"), cv_text("E3")],
        vec![cv_text("SOC"), cv_text("Offshore"), cv_text("E4")],
        vec![cv_text("Non-COGS"), cv_text("Direct"), cv_text("E5")],
        vec![cv_text("Non-COGS"), cv_text("Direct"), cv_text("E6")],
    ];

    let fields = detect_fields(&data);
    let config = make_regression_config(
        fields.clone(),
        vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[0].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
            }),
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[1].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 1,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: Some(false),
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: fields[2].id.clone(),
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
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: fields[2].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 1,
                    display_name: Some("% Of Total".to_string()),
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::CountA,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let result = compute_with_show_values_as(&config, &data, None);
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    for row in &result.rows {
        if row.key.contains("Direct") && row.depth == 1 {
            let pct_value = match &row.values[1] {
                CellValue::Number(n) => n.get(),
                other => panic!("Expected number for % field, got {:?}", other),
            };
            assert!(
                pct_value < 1.1,
                "PercentOfParentRowTotal must output fractions (0.0-1.0), got {}",
                pct_value,
            );
            if row
                .headers
                .iter()
                .any(|h| matches!(&h.value, CellValue::Text(t) if t.as_ref().contains("SOC")))
                || row.key.contains("SOC")
            {
                assert!(
                    (pct_value - 0.75).abs() < 0.001,
                    "SOC>Direct: expected 0.75 (3/4), got {}",
                    pct_value,
                );
            }
            break;
        }
    }
}

/// PercentOfParentRowTotal basic: each child row should be a fraction of parent subtotal.
#[test]
fn show_values_as_percent_of_parent_row_basic() {
    use crate::engine::{compute_with_show_values_as, detect_fields};
    use crate::types::{
        AggregateFunction, AxisPlacement, PivotFieldPlacement, PlacementBase, ShowValuesAs,
        ShowValuesAsConfig, ValuePlacement,
    };

    let data = vec![
        vec![cv_text("Region"), cv_text("City"), cv_text("Sales")],
        vec![cv_text("East"), cv_text("NYC"), cv_num(300.0)],
        vec![cv_text("East"), cv_text("Boston"), cv_num(200.0)],
        vec![cv_text("West"), cv_text("LA"), cv_num(400.0)],
        vec![cv_text("West"), cv_text("SF"), cv_num(100.0)],
    ];

    let fields = detect_fields(&data);
    let config = make_regression_config(
        fields.clone(),
        vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[0].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: Some(true),
            }),
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[1].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 1,
                    display_name: None,
                },
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: Some(false),
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: fields[2].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: Some("% of Region".to_string()),
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentOfParentRowTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let result = compute_with_show_values_as(&config, &data, None);
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    for row in &result.rows {
        if row.is_subtotal || row.is_grand_total {
            continue;
        }
        let key = &row.key;
        let expected = if key.contains("NYC") {
            Some(0.6)
        } else if key.contains("Boston") {
            Some(0.4)
        } else if key.contains("LA") {
            Some(0.8)
        } else if key.contains("SF") {
            Some(0.2)
        } else {
            None
        };
        if let Some(expected) = expected {
            let value = match &row.values[0] {
                CellValue::Number(n) => n.get(),
                other => panic!("key={}: expected number, got {:?}", key, other),
            };
            assert!(
                (value - expected).abs() < 0.001,
                "key={}: expected {} (fraction), got {}",
                key,
                expected,
                value,
            );
        }
    }
}
