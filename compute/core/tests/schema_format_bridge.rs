//! Integration tests for schema::format_bridge

use compute_core::schema::format_bridge::infer_schema_from_format;
use compute_core::schema::types::SchemaType;

#[test]
fn percentage_format() {
    assert_eq!(infer_schema_from_format("0%"), Some(SchemaType::Percentage));
    assert_eq!(
        infer_schema_from_format("0.00%"),
        Some(SchemaType::Percentage)
    );
}

#[test]
fn currency_format() {
    assert_eq!(
        infer_schema_from_format("$#,##0.00"),
        Some(SchemaType::Currency)
    );
    assert_eq!(
        infer_schema_from_format("€#,##0.00"),
        Some(SchemaType::Currency)
    );
    assert_eq!(
        infer_schema_from_format("[$USD] #,##0.00"),
        Some(SchemaType::Currency)
    );
}

#[test]
fn date_format() {
    assert_eq!(infer_schema_from_format("m/d/yyyy"), Some(SchemaType::Date));
    assert_eq!(
        infer_schema_from_format("yyyy-mm-dd"),
        Some(SchemaType::Date)
    );
    assert_eq!(infer_schema_from_format("d-mmm-yy"), Some(SchemaType::Date));
}

#[test]
fn time_format() {
    assert_eq!(
        infer_schema_from_format("h:mm AM/PM"),
        Some(SchemaType::Time)
    );
    assert_eq!(infer_schema_from_format("h:mm:ss"), Some(SchemaType::Time));
    assert_eq!(infer_schema_from_format("hh:mm"), Some(SchemaType::Time));
}

#[test]
fn integer_format() {
    assert_eq!(infer_schema_from_format("#,##0"), Some(SchemaType::Integer));
    assert_eq!(infer_schema_from_format("0"), Some(SchemaType::Integer));
}

#[test]
fn number_format() {
    assert_eq!(infer_schema_from_format("0.00"), Some(SchemaType::Number));
    assert_eq!(
        infer_schema_from_format("#,##0.00"),
        Some(SchemaType::Number)
    );
}

#[test]
fn general_format() {
    assert_eq!(infer_schema_from_format("General"), None);
    assert_eq!(infer_schema_from_format(""), None);
}

#[test]
fn text_format() {
    assert_eq!(infer_schema_from_format("@"), Some(SchemaType::String));
}

#[test]
fn scientific_format() {
    assert_eq!(
        infer_schema_from_format("0.00E+00"),
        Some(SchemaType::Number)
    );
}

#[test]
fn round_trip_currency() {
    let code = SchemaType::Currency.default_format_code().unwrap();
    assert_eq!(infer_schema_from_format(code), Some(SchemaType::Currency));
}

#[test]
fn round_trip_percentage() {
    let code = SchemaType::Percentage.default_format_code().unwrap();
    assert_eq!(infer_schema_from_format(code), Some(SchemaType::Percentage));
}

#[test]
fn round_trip_date() {
    let code = SchemaType::Date.default_format_code().unwrap();
    assert_eq!(infer_schema_from_format(code), Some(SchemaType::Date));
}

#[test]
fn round_trip_time() {
    let code = SchemaType::Time.default_format_code().unwrap();
    assert_eq!(infer_schema_from_format(code), Some(SchemaType::Time));
}

#[test]
fn round_trip_integer() {
    let code = SchemaType::Integer.default_format_code().unwrap();
    assert_eq!(infer_schema_from_format(code), Some(SchemaType::Integer));
}

#[test]
fn quoted_percent_not_percentage() {
    // "%" in quotes is literal text, not a percentage format
    assert_ne!(
        infer_schema_from_format("0\"%\""),
        Some(SchemaType::Percentage)
    );
}
