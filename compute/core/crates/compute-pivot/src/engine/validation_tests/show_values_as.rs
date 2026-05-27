use super::*;

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
