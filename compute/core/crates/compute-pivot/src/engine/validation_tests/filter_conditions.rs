use super::*;

#[test]
fn test_validate_and_resolve_missing_between_operand() {
    let fields = sample_fields();
    let placements = vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement(
            "sales",
            PivotFieldArea::Value,
            0,
            Some(AggregateFunction::Sum),
        ),
    ];
    let filters = vec![PivotFilter {
        field_id: FieldId::from("sales"),
        include_values: None,
        exclude_values: None,
        condition: Some(PivotFilterConditionFlat {
            operator: FilterOperator::Between,
            value: Some(cv_num(10.0)),
            value2: None, // Missing second operand!
        }),
        top_bottom: None,
        show_items_with_no_data: None,
    }];
    let config = make_base_config(fields, placements, filters);

    let err = validate_and_resolve(&config).unwrap_err();
    match err {
        PivotError::InvalidFilter { field_id, .. } => {
            assert_eq!(field_id, "sales");
        }
        PivotError::Multiple { ref errors } => {
            assert!(errors.iter().any(
                |e| matches!(e, PivotError::InvalidFilter { field_id, .. } if field_id == "sales")
            ));
        }
        other => panic!("Expected InvalidFilter, got: {:?}", other),
    }
}

#[test]
fn validate_filter_condition_nullary_is_blank() {
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
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::IsBlank,
                value: None,
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let resolved = validate_and_resolve(&config).expect("IsBlank should be valid without operands");
    assert!(resolved.filters()[0].condition().is_some());
}

#[test]
fn validate_filter_condition_nullary_is_not_blank() {
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
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::IsNotBlank,
                value: None,
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let resolved =
        validate_and_resolve(&config).expect("IsNotBlank should be valid without operands");
    assert!(resolved.filters()[0].condition().is_some());
}

#[test]
fn validate_filter_condition_nullary_above_average() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::AboveAverage,
                value: None,
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let resolved =
        validate_and_resolve(&config).expect("AboveAverage should be valid without operands");
    assert!(resolved.filters()[0].condition().is_some());
}

#[test]
fn validate_filter_condition_nullary_below_average() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::BelowAverage,
                value: None,
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let resolved =
        validate_and_resolve(&config).expect("BelowAverage should be valid without operands");
    assert!(resolved.filters()[0].condition().is_some());
}

#[test]
fn validate_filter_condition_unary_equals_missing_value() {
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
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::Equals,
                value: None, // Missing!
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("requires a value operand"),
        "Should reject Equals without value: {}",
        msg
    );
}

#[test]
fn validate_filter_condition_unary_contains_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::Contains,
                value: Some(cv_text("East")),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let resolved = validate_and_resolve(&config).expect("Contains with value should be valid");
    assert!(resolved.filters()[0].condition().is_some());
}

#[test]
fn validate_filter_condition_unary_starts_with_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::StartsWith,
                value: Some(cv_text("E")),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    validate_and_resolve(&config).expect("StartsWith with value should be valid");
}

#[test]
fn validate_filter_condition_unary_ends_with_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::EndsWith,
                value: Some(cv_text("st")),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    validate_and_resolve(&config).expect("EndsWith with value should be valid");
}

#[test]
fn validate_filter_condition_unary_not_contains_missing_value() {
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
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::NotContains,
                value: None,
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("requires a value operand"),
        "Should reject NotContains without value: {}",
        msg
    );
}

#[test]
fn validate_filter_condition_unary_greater_than_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::GreaterThan,
                value: Some(cv_num(100.0)),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    validate_and_resolve(&config).expect("GreaterThan with value should be valid");
}

#[test]
fn validate_filter_condition_unary_less_than_or_equal_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::LessThanOrEqual,
                value: Some(cv_num(500.0)),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    validate_and_resolve(&config).expect("LessThanOrEqual with value should be valid");
}

#[test]
fn validate_filter_condition_unary_greater_than_or_equal_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::GreaterThanOrEqual,
                value: Some(cv_num(100.0)),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    validate_and_resolve(&config).expect("GreaterThanOrEqual with value should be valid");
}

#[test]
fn validate_filter_condition_unary_less_than_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::LessThan,
                value: Some(cv_num(500.0)),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    validate_and_resolve(&config).expect("LessThan with value should be valid");
}

#[test]
fn validate_filter_condition_unary_not_equals_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("region"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::NotEquals,
                value: Some(cv_text("East")),
                value2: None,
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    validate_and_resolve(&config).expect("NotEquals with value should be valid");
}

#[test]
fn validate_filter_condition_binary_between_valid() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::Between,
                value: Some(cv_num(10.0)),
                value2: Some(cv_num(100.0)),
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    validate_and_resolve(&config).expect("Between with both values should be valid");
}

#[test]
fn validate_filter_condition_binary_not_between_missing_value() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::NotBetween,
                value: None, // Missing!
                value2: Some(cv_num(100.0)),
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("requires a value operand"),
        "Should reject NotBetween without value: {}",
        msg
    );
}

#[test]
fn validate_filter_condition_binary_not_between_missing_value2() {
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
        vec![PivotFilter {
            field_id: FieldId::from("sales"),
            include_values: None,
            exclude_values: None,
            condition: Some(PivotFilterConditionFlat {
                operator: FilterOperator::NotBetween,
                value: Some(cv_num(10.0)),
                value2: None, // Missing!
            }),
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("requires a value2 operand"),
        "Should reject NotBetween without value2: {}",
        msg
    );
}

// ========================================================================
// Additional coverage: top_bottom referencing unknown value field
// ========================================================================

#[test]
fn validate_filter_unknown_field() {
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
        vec![PivotFilter {
            field_id: FieldId::from("nonexistent_filter_field"),
            include_values: None,
            exclude_values: None,
            condition: None,
            top_bottom: None,
            show_items_with_no_data: None,
        }],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("nonexistent_filter_field"),
        "Should flag unknown field in filter: {}",
        msg
    );
}

// ========================================================================
// Additional coverage: empty source_sheet_name
// ========================================================================
