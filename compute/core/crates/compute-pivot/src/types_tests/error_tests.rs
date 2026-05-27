use super::*;

// ---- PivotError Display impls ----

#[test]
fn error_display_missing_field() {
    let err = PivotError::MissingField {
        field: "name".to_string(),
        message: "must not be empty".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Missing field 'name': must not be empty");
}

#[test]
fn error_display_unknown_field() {
    let err = PivotError::UnknownField {
        field_id: "bad_id".to_string(),
        context: "row placement at index 0".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Unknown field 'bad_id': row placement at index 0");
}

#[test]
fn error_display_invalid_value() {
    let err = PivotError::InvalidValue {
        field: "source_range.start_row".to_string(),
        message: "must be non-negative".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(
        msg,
        "Invalid value for 'source_range.start_row': must be non-negative"
    );
}

#[test]
fn error_display_invalid_filter() {
    let err = PivotError::InvalidFilter {
        field_id: "region".to_string(),
        message: "missing operand".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Invalid filter on 'region': missing operand");
}

#[test]
fn error_display_duplicate_placement() {
    let err = PivotError::DuplicatePlacement {
        field_id: "sales".to_string(),
        area: "Row".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Duplicate placement: field 'sales' in area 'Row'");
}

#[test]
fn error_display_invalid_formula() {
    let err = PivotError::InvalidFormula {
        field_id: "calc1".to_string(),
        message: "unexpected token ')'".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Invalid formula for 'calc1': unexpected token ')'");
}

#[test]
fn error_display_validation_error() {
    let err = PivotError::ValidationError {
        message: "duplicate pivot table IDs".to_string(),
    };
    let msg = format!("{}", err);
    assert_eq!(msg, "Validation error: duplicate pivot table IDs");
}

#[test]
fn error_display_multiple() {
    let err = PivotError::Multiple {
        errors: vec![
            PivotError::MissingField {
                field: "name".to_string(),
                message: "required".to_string(),
            },
            PivotError::UnknownField {
                field_id: "xyz".to_string(),
                context: "placement".to_string(),
            },
        ],
    };
    let msg = format!("{}", err);
    assert!(msg.starts_with("2 validation errors: "));
    assert!(msg.contains("Missing field 'name': required"));
    assert!(msg.contains("; Unknown field 'xyz': placement"));
}

#[test]
fn error_display_multiple_empty() {
    let err = PivotError::Multiple { errors: vec![] };
    let msg = format!("{}", err);
    assert_eq!(msg, "0 validation errors: ");
}

#[test]
fn error_implements_std_error() {
    let err = PivotError::ValidationError {
        message: "test".to_string(),
    };
    // Verify it implements std::error::Error by using it as a trait object
    let _: &dyn std::error::Error = &err;
    // source() should return None (default impl)
    assert!(std::error::Error::source(&err).is_none());
}
