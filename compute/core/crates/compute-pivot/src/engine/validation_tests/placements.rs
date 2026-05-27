use super::*;

#[test]
fn validate_config_field_references() {
    let config = make_base_config(
        sample_fields(),
        vec![make_placement("nonexistent", PivotFieldArea::Row, 0, None)],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("nonexistent")),
        "should detect unknown field: {:?}",
        errors
    );
}

#[test]
fn validate_duplicate_placements() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("region", PivotFieldArea::Row, 1, None), // duplicate
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("Duplicate placement")),
        "should detect duplicate field_id + area: {:?}",
        errors
    );
}

#[test]
fn validate_duplicate_value_placements_allowed() {
    // Same field in Value area with different aggregations should be allowed
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
                "sales",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Average),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        !errors.iter().any(|e| e.contains("Duplicate placement")),
        "duplicate value placements should be allowed: {:?}",
        errors
    );
}

#[test]
fn validate_sort_by_value_bad_ref() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("nonexistent_field"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors
            .iter()
            .any(|e| e.contains("sort_by_value") && e.contains("nonexistent_field")),
        "should detect bad sort_by_value reference: {:?}",
        errors
    );
}

#[test]
fn validate_sort_by_value_valid_ref() {
    let mut axis = make_row_axis("region", 0);
    axis.sort_by_value = Some(SortByValueConfig {
        value_field_id: FieldId::from("sales"),
        order: SortDirection::Desc,
        column_key: None,
    });
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        !errors.iter().any(|e| e.contains("sort_by_value")),
        "valid sort_by_value should not produce errors: {:?}",
        errors
    );
}

// ---- Calculated field validation ----

#[test]
fn test_validate_and_resolve_unknown_field_in_placement() {
    let fields = sample_fields();
    let placements = vec![
        make_placement("nonexistent_field", PivotFieldArea::Row, 0, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let config = make_base_config(fields, placements, vec![]);

    let err = validate_and_resolve(&config).unwrap_err();
    match err {
        PivotError::UnknownField { field_id, .. } => {
            assert_eq!(field_id, "nonexistent_field");
        }
        PivotError::Multiple { ref errors } => {
            assert!(errors.iter().any(|e| matches!(e, PivotError::UnknownField { field_id, .. } if field_id == "nonexistent_field")));
        }
        other => panic!("Expected UnknownField, got: {:?}", other),
    }
}

#[test]
fn validate_duplicate_field_ids() {
    let fields = vec![
        PivotField {
            id: FieldId::from("region"),
            name: "Region".to_string(),
            source_column: 0,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("region"), // Duplicate!
            name: "Region Copy".to_string(),
            source_column: 1,
            data_type: DetectedDataType::String,
            ..Default::default()
        },
        PivotField {
            id: FieldId::from("sales"),
            name: "Sales".to_string(),
            source_column: 3,
            data_type: DetectedDataType::Number,
            ..Default::default()
        },
    ];
    let config = make_base_config(
        fields,
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
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject duplicate field IDs");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("Duplicate field IDs"),
        "Error should mention duplicate field IDs: {}",
        msg
    );
}

// ========================================================================
// Additional coverage: number_grouping edge cases
// ========================================================================

#[test]
fn validate_unknown_field_in_column_placement() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("nonexistent", PivotFieldArea::Column, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("nonexistent") && msg.contains("column"),
        "Should flag unknown field in column placement: {}",
        msg
    );
}

// ========================================================================
// Additional coverage: filter placement with unknown field
// ========================================================================

#[test]
fn validate_unknown_field_in_filter_placement() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement("nonexistent", PivotFieldArea::Filter, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("nonexistent"),
        "Should flag unknown field in filter placement: {}",
        msg
    );
}

// ========================================================================
// Additional coverage: ShowValuesAs variants requiring base_field
// ========================================================================

#[test]
fn validate_sort_by_value_bad_ref_on_column() {
    let axis = AxisPlacement {
        base: PlacementBase {
            field_id: FieldId::from("quarter"),
            placement_id: crate::types::PlacementId::default(),
            position: 0,
            display_name: None,
        },
        sort_order: None,
        custom_sort_list: None,
        sort_by_value: Some(SortByValueConfig {
            value_field_id: FieldId::from("nonexistent_val"),
            order: SortDirection::Asc,
            column_key: None,
        }),
        date_grouping: None,
        number_grouping: None,
        show_subtotals: None,
    };
    let placement = PivotFieldPlacement::Column(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            placement,
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("sort_by_value") && msg.contains("nonexistent_val"),
        "Should detect bad sort_by_value on column: {}",
        msg
    );
}
