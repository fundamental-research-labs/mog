use crate::types::SchemaType;
use crate::validator::validate;

use super::helpers::*;

#[test]
fn valid_email() {
    let schema = make_schema(SchemaType::Email);
    let result = validate(&text("user@example.com"), &schema);
    assert!(result.valid);
    assert!(result.errors.is_empty());
}

#[test]
fn invalid_email() {
    let schema = make_schema(SchemaType::Email);
    let result = validate(&text("not-email"), &schema);
    assert!(result.coerced_value.is_some() || !result.valid);
}

#[test]
fn valid_url_text() {
    let schema = make_schema(SchemaType::Url);
    assert!(validate(&text("https://example.com"), &schema).valid);
}

#[test]
fn valid_phone_text() {
    let schema = make_schema(SchemaType::Phone);
    assert!(validate(&text("+1-555-555-5555"), &schema).valid);
}

#[test]
fn valid_percentage_text() {
    let schema = make_schema(SchemaType::Percentage);
    assert!(validate(&text("50%"), &schema).valid);
}

#[test]
fn numeric_text_passes_percentage_schema() {
    let schema = make_schema(SchemaType::Percentage);
    assert!(validate(&text("0.5"), &schema).valid);
}

#[test]
fn valid_currency_text() {
    let schema = make_schema(SchemaType::Currency);
    assert!(validate(&text("$1,234.56"), &schema).valid);
}

#[test]
fn valid_integer_text() {
    let schema = make_schema(SchemaType::Integer);
    assert!(validate(&text("42"), &schema).valid);
}

#[test]
fn float_text_coerces_to_integer_schema() {
    let schema = make_schema(SchemaType::Integer);
    let result = validate(&text("3.14"), &schema);
    assert!(result.valid);
    assert!(result.coerced_value.is_some());
}

#[test]
fn float_text_with_zero_fract_passes_integer_schema() {
    let schema = make_schema(SchemaType::Integer);
    assert!(validate(&text("5.0"), &schema).valid);
}

#[test]
fn valid_date_text() {
    let schema = make_schema(SchemaType::Date);
    assert!(validate(&text("2024-12-11"), &schema).valid);
}

#[test]
fn invalid_date_text() {
    let schema = make_schema(SchemaType::Date);
    assert!(!validate(&text("not-a-date"), &schema).valid);
}

#[test]
fn valid_time_text() {
    let schema = make_schema(SchemaType::Time);
    assert!(validate(&text("14:30"), &schema).valid);
}

#[test]
fn numeric_text_passes_time_schema() {
    let schema = make_schema(SchemaType::Time);
    assert!(validate(&text("0.5"), &schema).valid);
}

#[test]
fn invalid_time_text_fails() {
    let schema = make_schema(SchemaType::Time);
    assert!(!validate(&text("not-a-time"), &schema).valid);
}

#[test]
fn non_numeric_text_fails_percentage() {
    let schema = make_schema(SchemaType::Percentage);
    assert!(!validate(&text("abc"), &schema).valid);
}

#[test]
fn non_currency_text_fails_currency() {
    let schema = make_schema(SchemaType::Currency);
    assert!(!validate(&text("abc"), &schema).valid);
}
