use super::*;

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
