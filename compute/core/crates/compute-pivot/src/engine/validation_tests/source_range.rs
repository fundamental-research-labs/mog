use super::*;

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
