//! Tests for validateConfig / config validation and validate_and_resolve.

use super::test_helpers::*;
use super::*;
use crate::types::*;

// ---- validateConfig tests ----

#[test]
fn validate_config_valid() {
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
        vec![],
    );

    let errors = validate_config(&config);
    assert!(errors.is_empty());
}

#[test]
fn validate_config_missing_fields() {
    let config = PivotTableConfig {
        schema_version: crate::types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: String::new(),
        name: "Test".to_string(),
        source_sheet_id: None,
        source_sheet_name: String::new(),
        source_range: CellRange::new(0, 0, 0, 0),
        output_sheet_name: String::new(),
        output_location: OutputLocation { row: 0, col: 0 },
        fields: vec![],
        placements: vec![],
        filters: vec![],
        layout: None,
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id: None,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    };

    let errors = validate_config(&config);

    assert!(
        errors
            .iter()
            .any(|e| e.contains("Pivot table ID is required"))
    );
    assert!(
        errors
            .iter()
            .any(|e| e.contains("Source sheet ID is required"))
    );
    assert!(
        errors
            .iter()
            .any(|e| e.contains("At least one field is required"))
    );
}

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
fn validate_value_placement_referencing_calculated_field_is_accepted() {
    // Regression: pivot-calculated-field app-eval scenario was failing with
    // "value placement references unknown field 'Profit'" because the TS API
    // adds a value placement so readPivot/queryPivot can list calculated
    // fields in the Values zone. The Rust validator must accept it
    // (computation goes through apply_calc_fields_to_values, not the regular
    // ResolvedValuePlacement path).
    let mut config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "sales",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
            // Introspection placement for the calculated field — same shape
            // the TS kernel API emits when addCalculatedField runs.
            make_placement(
                "profit",
                PivotFieldArea::Value,
                1,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("profit"),
        name: "Profit".to_string(),
        formula: "Sales - 0".to_string(),
    }]);

    let resolved = validate_and_resolve(&config)
        .expect("config with calculated-field placement should validate");
    // Calculated-field placement must NOT be added to value_placements
    // (those drive regular aggregations; calculated fields go through
    // apply_calc_fields_to_values).
    assert_eq!(
        resolved.value_placements.len(),
        1,
        "regular value placements: only `sales`, not the calculated `profit`"
    );
    assert_eq!(resolved.calculated_fields.len(), 1);
    assert_eq!(resolved.calculated_fields[0].field_id.as_ref(), "profit");
}

#[test]
fn validate_value_placement_unknown_field_still_rejected_when_no_calc_field_match() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            make_placement(
                "not_a_field",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );
    // No calculated_fields override — purely unknown reference must error.
    let result = validate_and_resolve(&config);
    assert!(
        result.is_err(),
        "unknown value-placement field should still be rejected"
    );
}

#[test]
fn validate_config_value_aggregate() {
    // With the new type system, ValuePlacement.aggregate_function is required (not Option).
    // make_placement with None defaults to Sum. Verify that's valid.
    let config = make_base_config(
        sample_fields(),
        vec![make_placement("sales", PivotFieldArea::Value, 0, None)],
        vec![],
    );

    let errors = validate_config(&config);
    // No aggregate_function error since the type system enforces it
    assert!(!errors.iter().any(|e| e.contains("aggregate function")));
}

// ---- I6: Additional validations ----

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
fn validate_number_grouping_zero_interval() {
    let mut axis = make_row_axis("sales", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, 100.0, 0.0));
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "units",
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
            .any(|e| e.contains("interval") && e.contains("positive")),
        "should detect zero interval: {:?}",
        errors
    );
}

#[test]
fn validate_number_grouping_negative_interval() {
    let mut axis = make_row_axis("sales", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, 100.0, -5.0));
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "units",
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
            .any(|e| e.contains("interval") && e.contains("positive")),
        "should detect negative interval: {:?}",
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
fn test_calculated_field_validation_error() {
    let mut config = make_base_config(
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
        vec![],
    );
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("bad_calc"),
        name: "Bad Calc".to_string(),
        formula: "Sales +* Units".to_string(), // Invalid syntax
    }]);

    let errors = validate_config(&config);
    assert!(
        errors
            .iter()
            .any(|e| e.contains("Bad Calc") && e.contains("formula error")),
        "Should have validation error for invalid formula: {:?}",
        errors
    );
}

#[test]
fn test_calculated_field_empty_formula_validation() {
    let mut config = make_base_config(
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
        vec![],
    );
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("empty_calc"),
        name: "Empty".to_string(),
        formula: String::new(),
    }]);

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("empty formula")),
        "Should flag empty formula: {:?}",
        errors
    );
}

// ========================================================================
// validate_and_resolve tests
// ========================================================================

#[test]
fn test_validate_and_resolve_valid_minimal_config() {
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
    let config = make_base_config(fields, placements, vec![]);

    let resolved = validate_and_resolve(&config).expect("should be valid");
    assert_eq!(resolved.id(), "pivot1");
    assert_eq!(resolved.source_sheet_name(), "sheet1");
    assert_eq!(resolved.row_placements().len(), 1);
    assert_eq!(resolved.value_placements().len(), 1);
    assert_eq!(resolved.column_placements().len(), 0);
    assert_eq!(resolved.filter_placements().len(), 0);
    assert_eq!(resolved.filters().len(), 0);
    assert_eq!(resolved.calculated_fields().len(), 0);
    // Check defaults resolved
    assert_eq!(
        resolved.row_placements()[0].sort_order(),
        SortDirection::Asc
    );
    assert!(!resolved.row_placements()[0].show_subtotals());
    // Layout defaults
    assert!(resolved.layout().show_row_grand_totals());
    assert!(resolved.layout().show_column_grand_totals());
    assert_eq!(*resolved.layout().layout_form(), LayoutForm::Compact);
    assert!(!resolved.layout().repeat_all_item_labels());
    assert!(!resolved.layout().show_empty_rows());
    assert!(!resolved.layout().show_empty_columns());
    // Column index resolved
    assert_eq!(resolved.row_placements()[0].column_index(), 0); // "region" = col 0
    assert_eq!(resolved.value_placements()[0].column_index(), 3); // "sales" = col 3
}

#[test]
fn test_validate_and_resolve_empty_id() {
    let fields = sample_fields();
    let placements = vec![make_placement("region", PivotFieldArea::Row, 0, None)];
    let mut config = make_base_config(fields, placements, vec![]);
    config.id = "".to_string();

    let err = validate_and_resolve(&config).unwrap_err();
    match err {
        PivotError::MissingField { field, .. } => {
            assert_eq!(field, "id");
        }
        PivotError::Multiple { ref errors } => {
            assert!(
                errors
                    .iter()
                    .any(|e| matches!(e, PivotError::MissingField { field, .. } if field == "id"))
            );
        }
        other => panic!("Expected MissingField, got: {:?}", other),
    }
}

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
fn test_validate_and_resolve_invalid_number_grouping() {
    let fields = sample_fields();
    let placements = vec![
        PivotFieldPlacement::Row(AxisPlacement {
            base: PlacementBase {
                field_id: FieldId::from("sales"),
                placement_id: crate::types::PlacementId::default(),
                position: 0,
                display_name: None,
            },
            sort_order: None,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: Some(NumberGrouping::new(100.0, 50.0, 10.0)),
            show_subtotals: None,
        }),
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
        PivotError::InvalidValue { field, .. } => {
            assert_eq!(field, "sales");
        }
        PivotError::Multiple { ref errors } => {
            assert!(
                errors.iter().any(
                    |e| matches!(e, PivotError::InvalidValue { field, .. } if field == "sales")
                )
            );
        }
        other => panic!("Expected InvalidValue, got: {:?}", other),
    }
}

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
fn test_validate_and_resolve_backward_compat_wrapper() {
    // Valid config -> empty errors
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
    let config = make_base_config(fields, placements, vec![]);
    assert!(validate_config(&config).is_empty());

    // Invalid config -> non-empty errors
    let fields2 = sample_fields();
    let mut bad_config = make_base_config(fields2, vec![], vec![]);
    bad_config.id = "".to_string();
    let errs = validate_config(&bad_config);
    assert!(!errs.is_empty());
}

// ---- FIX 2a: ShowValuesAs base_field validation ----

#[test]
fn validate_show_values_as_difference_requires_base_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::Difference,
                    base_field: None, // Missing!
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject Difference without base_field");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("base_field"),
        "Error should mention base_field: {}",
        msg
    );
}

#[test]
fn validate_show_values_as_running_total_requires_base_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::RunningTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );
    let err = validate_and_resolve(&config);
    assert!(
        err.is_err(),
        "Should reject RunningTotal without base_field"
    );
}

// ---- FIX 2b: top_bottom.n validation ----

#[test]
fn validate_top_bottom_n_must_be_finite() {
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
            condition: None,
            top_bottom: Some(PivotTopBottomFilter {
                filter_type: TopBottomType::Top,
                n: f64::NAN,
                by: TopBottomBy::Items,
                value_field_id: None,
            }),
            show_items_with_no_data: None,
        }],
    );
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject NaN for top_bottom.n");
}

#[test]
fn validate_top_bottom_n_must_be_non_negative() {
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
            condition: None,
            top_bottom: Some(PivotTopBottomFilter {
                filter_type: TopBottomType::Top,
                n: -5.0,
                by: TopBottomBy::Items,
                value_field_id: None,
            }),
            show_items_with_no_data: None,
        }],
    );
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject negative top_bottom.n");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("non-negative"),
        "Error should mention non-negative: {}",
        msg
    );
}

#[test]
fn validate_top_bottom_n_items_must_be_integer() {
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
            condition: None,
            top_bottom: Some(PivotTopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 2.5,
                by: TopBottomBy::Items,
                value_field_id: None,
            }),
            show_items_with_no_data: None,
        }],
    );
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject non-integer n for Items mode");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("integer"),
        "Error should mention integer: {}",
        msg
    );
}

// ---- FIX 2c: source_range validation ----

#[test]
fn validate_source_range_inverted_rows_auto_normalized() {
    // CellRange::new auto-normalizes inverted coords
    let mut config = make_base_config(
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
        vec![],
    );
    config.source_range = CellRange::new(10, 0, 5, 4);
    assert_eq!(config.source_range.start_row(), 5);
    assert_eq!(config.source_range.end_row(), 10);
    let result = validate_and_resolve(&config);
    assert!(
        result.is_ok(),
        "Normalized range should be valid: {:?}",
        result
    );
}

#[test]
fn validate_source_range_inverted_cols_auto_normalized() {
    // CellRange::new auto-normalizes inverted coords
    let mut config = make_base_config(
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
        vec![],
    );
    config.source_range = CellRange::new(0, 10, 8, 4);
    assert_eq!(config.source_range.start_col(), 4);
    assert_eq!(config.source_range.end_col(), 10);
    let result = validate_and_resolve(&config);
    assert!(
        result.is_ok(),
        "Normalized range should be valid: {:?}",
        result
    );
}

#[test]
fn validate_source_range_too_few_rows() {
    let mut config = make_base_config(
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
        vec![],
    );
    config.source_range = CellRange::new(0, 0, 0, 4); // Only 1 row (header only)
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject range with only 1 row");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("at least 2 rows"),
        "Error should mention at least 2 rows: {}",
        msg
    );
}

// ---- FIX 2d: empty output_sheet_name ----

#[test]
fn validate_empty_output_sheet_name() {
    let mut config = make_base_config(
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
        vec![],
    );
    config.output_sheet_name = String::new();
    let err = validate_and_resolve(&config);
    assert!(err.is_err(), "Should reject empty output_sheet_name");
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("output_sheet_name"),
        "Error should mention output_sheet_name: {}",
        msg
    );
}

// ---- Duplicate field IDs ----

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
fn validate_number_grouping_nan_start() {
    let mut axis = make_row_axis("sales", 0);
    axis.number_grouping = Some(NumberGrouping::new(f64::NAN, 100.0, 10.0));
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "units",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("finite")),
        "should detect NaN start: {:?}",
        errors
    );
}

#[test]
fn validate_number_grouping_infinite_end() {
    let mut axis = make_row_axis("sales", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, f64::INFINITY, 10.0));
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "units",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("finite")),
        "should detect infinite end: {:?}",
        errors
    );
}

#[test]
fn validate_number_grouping_nan_interval() {
    let mut axis = make_row_axis("sales", 0);
    axis.number_grouping = Some(NumberGrouping::new(0.0, 100.0, f64::NAN));
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "units",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("finite")),
        "should detect NaN interval: {:?}",
        errors
    );
}

#[test]
fn validate_number_grouping_neg_infinity_start() {
    let mut axis = make_row_axis("sales", 0);
    axis.number_grouping = Some(NumberGrouping::new(f64::NEG_INFINITY, 100.0, 10.0));
    let placement = PivotFieldPlacement::Row(axis);

    let config = make_base_config(
        sample_fields(),
        vec![
            placement,
            make_placement(
                "units",
                PivotFieldArea::Value,
                0,
                Some(AggregateFunction::Sum),
            ),
        ],
        vec![],
    );

    let errors = validate_config(&config);
    assert!(
        errors.iter().any(|e| e.contains("finite")),
        "should detect -Infinity start: {:?}",
        errors
    );
}

// ========================================================================
// Additional coverage: calculated field edge cases
// ========================================================================

#[test]
fn validate_calculated_field_empty_id() {
    let mut config = make_base_config(
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
        vec![],
    );
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from(""),
        name: "Some Name".to_string(),
        formula: "Sales + Units".to_string(),
    }]);

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("Calculated field ID is required"),
        "Should flag empty calc field ID: {}",
        msg
    );
}

#[test]
fn validate_calculated_field_empty_name() {
    let mut config = make_base_config(
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
        vec![],
    );
    config.calculated_fields = Some(vec![CalculatedField {
        field_id: CalculatedFieldId::from("calc1"),
        name: String::new(),
        formula: "Sales + Units".to_string(),
    }]);

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("empty name"),
        "Should flag empty calc field name: {}",
        msg
    );
}

// ========================================================================
// Additional coverage: filter condition operators
// ========================================================================

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
fn validate_top_bottom_unknown_value_field() {
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
            condition: None,
            top_bottom: Some(PivotTopBottomFilter {
                filter_type: TopBottomType::Top,
                n: 5.0,
                by: TopBottomBy::Items,
                value_field_id: Some(FieldId::from("nonexistent_value")),
            }),
            show_items_with_no_data: None,
        }],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("nonexistent_value"),
        "Should flag unknown value field in top_bottom: {}",
        msg
    );
}

#[test]
fn validate_top_bottom_n_infinity() {
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
            condition: None,
            top_bottom: Some(PivotTopBottomFilter {
                filter_type: TopBottomType::Bottom,
                n: f64::INFINITY,
                by: TopBottomBy::Percent,
                value_field_id: None,
            }),
            show_items_with_no_data: None,
        }],
    );

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("finite"),
        "Should reject Infinity for top_bottom.n: {}",
        msg
    );
}

// ========================================================================
// Additional coverage: filter referencing unknown field
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

#[test]
fn validate_empty_source_sheet_name() {
    let mut config = make_base_config(
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
        vec![],
    );
    config.source_sheet_name = String::new();

    let err = validate_and_resolve(&config).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("source_sheet_id"),
        "Should flag missing source identity: {}",
        msg
    );
}

// ========================================================================
// Additional coverage: column placement with unknown field
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
fn validate_show_values_as_percent_difference_requires_base_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentDifference,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let err = validate_and_resolve(&config);
    assert!(
        err.is_err(),
        "Should reject PercentDifference without base_field"
    );
    let msg = err.unwrap_err().to_string();
    assert!(
        msg.contains("base_field"),
        "Error should mention base_field: {}",
        msg
    );
}

#[test]
fn validate_show_values_as_rank_ascending_requires_base_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::RankAscending,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let err = validate_and_resolve(&config);
    assert!(
        err.is_err(),
        "Should reject RankAscending without base_field"
    );
}

#[test]
fn validate_show_values_as_rank_descending_requires_base_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::RankDescending,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let err = validate_and_resolve(&config);
    assert!(
        err.is_err(),
        "Should reject RankDescending without base_field"
    );
}

#[test]
fn validate_show_values_as_percent_running_total_requires_base_field() {
    let config = make_base_config(
        sample_fields(),
        vec![
            make_placement("region", PivotFieldArea::Row, 0, None),
            PivotFieldPlacement::Value(ValuePlacement {
                base: PlacementBase {
                    field_id: FieldId::from("sales"),
                    placement_id: crate::types::PlacementId::default(),
                    position: 0,
                    display_name: None,
                },
                source: crate::types::PivotValueSource::Field {
                    field_id: crate::types::FieldId::default(),
                },
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: Some(ShowValuesAsConfig {
                    calculation_type: ShowValuesAs::PercentRunningTotal,
                    base_field: None,
                    base_item: None,
                }),
            }),
        ],
        vec![],
    );

    let err = validate_and_resolve(&config);
    assert!(
        err.is_err(),
        "Should reject PercentRunningTotal without base_field"
    );
}

// ========================================================================
// Additional coverage: multiple errors returned together
// ========================================================================

#[test]
fn validate_multiple_errors_at_once() {
    let mut config = make_base_config(
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
        vec![],
    );
    config.id = String::new();
    config.source_sheet_name = String::new();
    config.output_sheet_name = String::new();

    let err = validate_and_resolve(&config).unwrap_err();
    match err {
        PivotError::Multiple { ref errors } => {
            assert!(
                errors.len() >= 3,
                "Should have at least 3 errors for empty id, source identity, output_sheet_name: {:?}",
                errors
            );
        }
        _ => {
            // Single error is also ok if they happen to merge
        }
    }
}

// ========================================================================
// Additional coverage: no placements at all (valid config, just fields)
// ========================================================================

#[test]
fn validate_config_with_no_placements() {
    let config = make_base_config(
        sample_fields(),
        vec![], // No placements
        vec![],
    );

    // Should still validate — just no data output
    let resolved =
        validate_and_resolve(&config).expect("Config with no placements should be valid");
    assert_eq!(resolved.row_placements().len(), 0);
    assert_eq!(resolved.column_placements().len(), 0);
    assert_eq!(resolved.value_placements().len(), 0);
    assert_eq!(resolved.filter_placements().len(), 0);
}

// ========================================================================
// Additional coverage: sort_by_value on a column placement
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
