use super::*;

#[test]
fn custom_sort_list_no_phantom_rows_for_absent_values() {
    // Data: TermType > Reason, Count of employees
    let data = vec![
        vec![cv_text("TermType"), cv_text("Reason"), cv_text("EmpID")],
        vec![
            cv_text("Involuntary"),
            cv_text("Poor Job Performance"),
            cv_text("E1"),
        ],
        vec![
            cv_text("Involuntary"),
            cv_text("Violation of Company Policy"),
            cv_text("E2"),
        ],
        vec![
            cv_text("Voluntary"),
            cv_text("Contract Ended"),
            cv_text("E3"),
        ],
        vec![
            cv_text("Voluntary"),
            cv_text("Dissatisfied with Job"),
            cv_text("E4"),
        ],
        vec![
            cv_text("Voluntary"),
            cv_text("Family Reasons"),
            cv_text("E5"),
        ],
    ];

    let fields = vec![
        PivotField {
            id: FieldId::from("term_type"),
            name: "TermType".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("reason"),
            name: "Reason".to_string(),
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

    // Custom sort list for TermType with an extra value "-" that doesn't exist in data
    let row_tt = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("term_type"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: Some(vec![
            cv_text("-"), // NOT in data — should NOT create a row
            cv_text("Involuntary"),
            cv_text("Voluntary"),
        ]),
        sort_by_value: None,
        date_grouping: None,
        number_grouping: None,
        show_subtotals: Some(true),
    });

    // Custom sort list for Reason with many extra values not in data
    let row_reason = PivotFieldPlacement::Row(AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("reason"),
            placement_id: crate::types::PlacementId::default(),
            position: 1,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: Some(vec![
            cv_text("Poor Job Performance"),
            cv_text("Violation of Company Policy"),
            cv_text("Workforce Reduction"), // NOT in data
            cv_text("Contract Ended"),
            cv_text("Dissatisfied with Job"),
            cv_text("Family Reasons"),
            cv_text("Higher Compensation"), // NOT in data
            cv_text("Relocation"),          // NOT in data
        ]),
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

    let config = make_base_config(fields, vec![row_tt, row_reason, value_count], vec![]);
    let result = compute(&config, &data, Some(&expand_all()));

    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    // Count only non-subtotal rows
    let data_rows: Vec<&PivotRow> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .collect();

    // The custom sort list includes "-" for TermType and 3 extra Reasons
    // that don't exist in the data. These should NOT produce rows.
    // Expected: 2 TermType parents + 5 leaf rows = 7 data rows
    // (2 Involuntary reasons + 3 Voluntary reasons)
    // Bug: extra phantom rows appear for "-", "Workforce Reduction", etc.
    let phantom_rows: Vec<&&PivotRow> = data_rows
        .iter()
        .filter(|r| {
            r.headers.iter().any(|h| match &h.value {
                CellValue::Text(s) => {
                    s.as_ref() == "-"
                        || s.as_ref() == "Workforce Reduction"
                        || s.as_ref() == "Higher Compensation"
                        || s.as_ref() == "Relocation"
                }
                _ => false,
            })
        })
        .collect();

    assert!(
        phantom_rows.is_empty(),
        "Custom sort list items not in data should NOT create phantom rows. Found {} phantom rows: {:?}",
        phantom_rows.len(),
        phantom_rows.iter().map(|r| &r.headers).collect::<Vec<_>>()
    );

    // Total data rows should be exactly the ones in the source data
    // 2 depth-0 (Involuntary, Voluntary) + 5 depth-1 (reasons) = 7
    assert_eq!(
        data_rows.len(),
        7,
        "Should have exactly 7 data rows (2 parents + 5 leaves), got {}",
        data_rows.len()
    );
}
#[test]
fn custom_sort_list_not_reversed_by_desc_direction() {
    // Scenario: pivot with custom sort [IC, Associate, Manager, Director, Principal]
    // and sortType="descending". Excel keeps items in custom order; our engine
    // was reversing them among themselves.
    let data = vec![
        vec![cv_text("Role"), cv_text("Count")],
        vec![cv_text("IC"), cv_num(100.0)],
        vec![cv_text("Associate"), cv_num(50.0)],
        vec![cv_text("Manager"), cv_num(30.0)],
        vec![cv_text("Director"), cv_num(10.0)],
        vec![cv_text("Principal"), cv_num(5.0)],
    ];

    let fields = detect_fields(&data);
    let config = make_base_config(
        fields.clone(),
        vec![
            PivotFieldPlacement::Row(AxisPlacement {
                base: PlacementBase {
                    field_id: fields[0].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                sort_order: Some(SortDirection::Desc),
                custom_sort_list: Some(vec![
                    cv_text("IC"),
                    cv_text("Associate"),
                    cv_text("Manager"),
                    cv_text("Director"),
                    cv_text("Principal"),
                ]),
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: Some(false),
            }),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: fields[1].id.clone(),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: None,
            }),
        ],
        vec![],
    );

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let row_labels: Vec<String> = result
        .rows
        .iter()
        .filter(|r| !r.is_subtotal && !r.is_grand_total)
        .map(|r| match &r.headers[0].value {
            CellValue::Text(s) => s.to_string(),
            other => format!("{:?}", other),
        })
        .collect();

    // Custom sort list defines absolute order — direction must NOT reverse it.
    // Director and Principal must NOT be swapped.
    assert_eq!(
        row_labels,
        vec!["IC", "Associate", "Manager", "Director", "Principal"],
        "Custom sort list order must be preserved regardless of sort direction.\n\
         Bug: descending direction was reversing custom list indices,\n\
         swapping Director and Principal."
    );
}

// ============================================================================
// sort_by_value with column_key targets a specific column
// ============================================================================
// Corpus file mWzMdU: autoSortScope specifies sort by FY2024 column.
// Data is designed so FY2022 and FY2024 have opposite sort orders.
