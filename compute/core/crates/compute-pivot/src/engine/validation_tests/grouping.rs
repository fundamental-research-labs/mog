use super::*;

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
