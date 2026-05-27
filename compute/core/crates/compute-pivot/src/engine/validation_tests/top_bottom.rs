use super::*;

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
