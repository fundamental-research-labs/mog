use crate::types::{SchemaConstraints, SchemaType, ValidationErrorCode};
use crate::validator::validate;

use super::helpers::*;

#[test]
fn date_schema_accepts_serial_number() {
    let schema = make_schema(SchemaType::Date);
    assert!(validate(&num(44927.0), &schema).valid);
    assert!(validate(&num(1.0), &schema).valid);
    assert!(validate(&num(0.0), &schema).valid);
}

#[test]
fn time_schema_accepts_fractional_day() {
    let schema = make_schema(SchemaType::Time);
    assert!(validate(&num(0.5), &schema).valid);
    assert!(validate(&num(0.0), &schema).valid);
    assert!(validate(&num(0.99), &schema).valid);
}

#[test]
fn numeric_constraints_on_currency_text() {
    let schema = make_schema_with_constraints(
        SchemaType::Currency,
        SchemaConstraints {
            min: Some(0.0),
            max: Some(1000.0),
            ..Default::default()
        },
    );
    assert!(
        validate(&text("$500"), &schema).valid,
        "$500 should be within 0-1000"
    );
}

#[test]
fn numeric_constraints_on_currency_number() {
    let schema = make_schema_with_constraints(
        SchemaType::Currency,
        SchemaConstraints {
            max: Some(100.0),
            ..Default::default()
        },
    );
    assert!(
        !validate(&num(200.0), &schema).valid,
        "200.0 exceeds max 100 for currency"
    );
}

#[test]
fn date_text_within_min_max_serials() {
    let schema = make_schema_with_constraints(
        SchemaType::Date,
        SchemaConstraints {
            min: Some(46023.0),
            max: Some(46387.0),
            ..Default::default()
        },
    );
    assert!(validate(&text("2026-06-15"), &schema).valid);
}

#[test]
fn date_text_below_min_serial_fails() {
    let schema = make_schema_with_constraints(
        SchemaType::Date,
        SchemaConstraints {
            min: Some(46023.0),
            max: Some(46387.0),
            ..Default::default()
        },
    );
    let result = validate(&text("2025-12-31"), &schema);
    assert!(!result.valid, "2025-12-31 below min 2026-01-01 should fail");
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::MinValue)
    );
}

#[test]
fn date_text_above_max_serial_fails() {
    let schema = make_schema_with_constraints(
        SchemaType::Date,
        SchemaConstraints {
            min: Some(46023.0),
            max: Some(46387.0),
            ..Default::default()
        },
    );
    let result = validate(&text("2027-01-01"), &schema);
    assert!(!result.valid, "2027-01-01 above max 2026-12-31 should fail");
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.code == ValidationErrorCode::MaxValue)
    );
}

#[test]
fn date_serial_below_min_fails() {
    let schema = make_schema_with_constraints(
        SchemaType::Date,
        SchemaConstraints {
            min: Some(46023.0),
            ..Default::default()
        },
    );
    let result = validate(&num(46022.0), &schema);
    assert!(!result.valid);
}

#[test]
fn date_time_text_flooring_for_date_bounds() {
    let schema = make_schema_with_constraints(
        SchemaType::Date,
        SchemaConstraints {
            min: Some(46023.0),
            max: Some(46023.0),
            ..Default::default()
        },
    );
    assert!(validate(&text("2026-01-01T23:59:59"), &schema).valid);
}

#[test]
fn percentage_text_numeric_extraction_for_bounds() {
    let schema = make_schema_with_constraints(
        SchemaType::Percentage,
        SchemaConstraints {
            min: Some(0.25),
            max: Some(0.75),
            ..Default::default()
        },
    );
    assert!(validate(&text("50%"), &schema).valid);
    assert!(!validate(&text("80%"), &schema).valid);
}

#[test]
fn plain_numeric_percentage_text_uses_percentage_coercion_for_bounds() {
    let schema = make_schema_with_constraints(
        SchemaType::Percentage,
        SchemaConstraints {
            min: Some(0.25),
            max: Some(0.75),
            ..Default::default()
        },
    );
    assert!(validate(&text("0.5"), &schema).valid);
    assert!(validate(&text("50"), &schema).valid);
    assert!(!validate(&text("80"), &schema).valid);
}
