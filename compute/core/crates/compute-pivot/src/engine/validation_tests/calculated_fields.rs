use super::*;

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
