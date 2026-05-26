//! Tests for detect_fields / field type detection.

use super::*;
use crate::engine::test_helpers::*;
use value_types::CellValue;

// ---- US date format detection ----

#[test]
fn detect_fields_us_date_m_d_yyyy() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Date")],
        vec![cv_text("1/5/2024")],
        vec![cv_text("12/31/2024")],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Date);
}

#[test]
fn detect_fields_us_date_mm_dd_yy() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Date")],
        vec![cv_text("01/05/24")],
        vec![cv_text("12/31/99")],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Date);
}

#[test]
fn detect_fields_us_date_mm_dd_yyyy() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Date")],
        vec![cv_text("01/15/2024")],
        vec![cv_text("02/20/2024")],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Date);
}

// ---- is_us_date_format edge cases ----

#[test]
fn is_us_date_format_edge_cases() {
    // empty string
    assert!(!is_us_date_format(""));
    // no slash
    assert!(!is_us_date_format("12312024"));
    // one slash only
    assert!(!is_us_date_format("12/31"));
    // starts with non-digit
    assert!(!is_us_date_format("A/1/2024"));
    // 3-digit year (invalid: only 2 or 4 digit years are valid)
    assert!(!is_us_date_format("1/1/202"));
    // 5-digit year (too many digits)
    assert!(!is_us_date_format("1/1/20240"));
    // 1-digit year (invalid: only 2 or 4 digit years are valid)
    assert!(!is_us_date_format("1/1/2"));
    // trailing characters
    assert!(!is_us_date_format("1/1/2024x"));
}

// ---- Boolean values ----

#[test]
fn detect_fields_boolean_column() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Active")],
        vec![cv_bool(true)],
        vec![cv_bool(false)],
        vec![cv_bool(true)],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Boolean);
}

// ---- Error values ----

#[test]
fn detect_fields_error_column() {
    use value_types::CellError;
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Errors")],
        vec![CellValue::Error(CellError::Div0, None)],
        vec![CellValue::Error(CellError::Na, None)],
        vec![CellValue::Error(CellError::Value, None)],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Error);
}

// ---- Mixed types with tie-breaking ----

#[test]
fn detect_fields_tie_number_beats_date() {
    // 1 Number, 1 Date -> tie at count=1 each -> Number wins (priority 0 < 1)
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Mixed")],
        vec![cv_num(42.0)],
        vec![cv_text("2024-01-01")],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Number);
}

#[test]
fn detect_fields_tie_date_beats_string() {
    // 1 Date, 1 String -> tie at count=1 each -> Date wins (priority 1 < 2)
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Mixed")],
        vec![cv_text("2024-01-01")],
        vec![cv_text("hello")],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Date);
}

#[test]
fn detect_fields_tie_string_beats_boolean() {
    // 1 String, 1 Boolean -> tie at count=1 each -> String wins (priority 2 < 3)
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Mixed")],
        vec![cv_text("hello")],
        vec![cv_bool(true)],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::String);
}

#[test]
fn detect_fields_majority_wins_over_priority() {
    // 3 Strings, 1 Number -> String wins by count despite lower priority
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Col")],
        vec![cv_text("a")],
        vec![cv_text("b")],
        vec![cv_text("c")],
        vec![cv_num(1.0)],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::String);
}

// ---- Null headers → "Column N" ----

#[test]
fn detect_fields_null_headers_generate_column_names() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![CellValue::Null, CellValue::Null, cv_text("Name")],
        vec![cv_num(1.0), cv_num(2.0), cv_text("Alice")],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields.len(), 3);
    assert_eq!(fields[0].name, "Column 1");
    assert_eq!(fields[1].name, "Column 2");
    assert_eq!(fields[2].name, "Name");
}

// ---- All-null column values → default to String ----

#[test]
fn detect_fields_all_null_values_default_to_string() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Empty")],
        vec![CellValue::Null],
        vec![CellValue::Null],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::String);
}

// ---- Header-only data (no data rows) ----

#[test]
fn detect_fields_header_only_no_data_rows() {
    let data: Vec<Vec<CellValue>> = vec![vec![cv_text("A"), cv_text("B")]];
    let fields = detect_fields(&data);
    assert_eq!(fields.len(), 2);
    assert_eq!(fields[0].name, "A");
    assert_eq!(fields[1].name, "B");
    // No data rows -> infer_column_type on empty -> default to String
    assert_eq!(fields[0].data_type, DetectedDataType::String);
    assert_eq!(fields[1].data_type, DetectedDataType::String);
}

// ---- Array cell values ----

#[test]
fn detect_fields_array_values_detected_as_string() {
    use std::sync::Arc;
    use value_types::CellArray;

    let arr = CellArray::new(vec![cv_num(1.0), cv_num(2.0)], 2);
    let data: Vec<Vec<CellValue>> =
        vec![vec![cv_text("Data")], vec![CellValue::Array(Arc::new(arr))]];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::String);
}

// ---- YYYY-MM-DD date detection ----

#[test]
fn detect_fields_iso_date_format() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Date")],
        vec![cv_text("2024-01-15")],
        vec![cv_text("2023-12-31")],
        vec![cv_text("2025-06-30")],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Date);
}

#[test]
fn detect_fields_iso_date_with_suffix_still_date() {
    // "2024-01-15T10:30:00" starts with YYYY-MM-DD and is >= 10 chars, so it matches
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("DateTime")],
        vec![cv_text("2024-01-15T10:30:00")],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Date);
}

// ---- Field ID and source_column mapping ----

#[test]
fn detect_fields_assigns_sequential_field_ids() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("A"), cv_text("B"), cv_text("C")],
        vec![cv_num(1.0), cv_text("x"), cv_bool(true)],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].id, FieldId::from("field_0"));
    assert_eq!(fields[1].id, FieldId::from("field_1"));
    assert_eq!(fields[2].id, FieldId::from("field_2"));
    assert_eq!(fields[0].source_column, 0);
    assert_eq!(fields[1].source_column, 1);
    assert_eq!(fields[2].source_column, 2);
}

// ---- Ragged rows (shorter than headers) ----

#[test]
fn detect_fields_ragged_rows_treated_as_null() {
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("A"), cv_text("B"), cv_text("C")],
        vec![cv_num(1.0)],               // missing columns 1, 2
        vec![cv_num(2.0), cv_text("x")], // missing column 2
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields.len(), 3);
    assert_eq!(fields[0].data_type, DetectedDataType::Number);
    // Column 1: one "x" and one Null -> String wins
    assert_eq!(fields[1].data_type, DetectedDataType::String);
    // Column 2: all Null -> defaults to String
    assert_eq!(fields[2].data_type, DetectedDataType::String);
}

// ---- Empty values (Null) are ignored in type counting ----

#[test]
fn detect_fields_nulls_dont_count_toward_type() {
    // 2 Numbers, 3 Nulls -> Number should still win (Nulls = Empty, ignored)
    let data: Vec<Vec<CellValue>> = vec![
        vec![cv_text("Val")],
        vec![cv_num(1.0)],
        vec![CellValue::Null],
        vec![CellValue::Null],
        vec![CellValue::Null],
        vec![cv_num(2.0)],
    ];
    let fields = detect_fields(&data);
    assert_eq!(fields[0].data_type, DetectedDataType::Number);
}
