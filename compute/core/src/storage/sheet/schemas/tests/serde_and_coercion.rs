use super::support::*;
use super::*;

#[test]
fn test_str_to_cell_value_number() {
    let cv = str_to_cell_value("42.5");
    assert!(matches!(cv, value_types::CellValue::Number(_)));
}
#[test]
fn test_str_to_cell_value_bool() {
    assert!(matches!(
        str_to_cell_value("true"),
        value_types::CellValue::Boolean(true)
    ));
    assert!(matches!(
        str_to_cell_value("false"),
        value_types::CellValue::Boolean(false)
    ));
}
#[test]
fn test_str_to_cell_value_text() {
    assert!(matches!(
        str_to_cell_value("hello"),
        value_types::CellValue::Text(_)
    ));
}
#[test]
fn test_str_to_cell_value_empty() {
    assert!(matches!(str_to_cell_value(""), value_types::CellValue::Text(ref s) if s.is_empty()));
}
#[test]
fn test_column_schema_serde_roundtrip() {
    let schema = ColumnSchema {
        id: "test".to_string(),
        name: "Name".to_string(),
        schema_type: SchemaType::String,
        constraints: Some(SchemaConstraints {
            min_length: Some(1),
            max_length: Some(50),
            allow_blank: Some(false),
            ..Default::default()
        }),
        distribution: None,
        description: None,
    };
    let json = serde_json::to_string(&schema).unwrap();
    let parsed: ColumnSchema = serde_json::from_str(&json).unwrap();
    assert_eq!(schema, parsed);
}
#[test]
fn test_range_schema_serde_roundtrip() {
    let rs = make_range_schema("serde-test");
    let json = serde_json::to_string(&rs).unwrap();
    let parsed: RangeSchema = serde_json::from_str(&json).unwrap();
    assert_eq!(rs, parsed);
}
