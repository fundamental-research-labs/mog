use super::support::*;
use super::*;

#[test]
fn test_validate_no_schema_returns_valid() {
    let (storage, sid, gi) = storage_with_sheet();
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        0,
        "hello",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::None);
}
#[test]
fn test_validate_column_schema_number_valid() {
    let (storage, sid, gi) = storage_with_sheet();
    let schema = ColumnSchema {
        id: String::new(),
        name: String::new(),
        schema_type: SchemaType::Number,
        constraints: Some(SchemaConstraints {
            min: Some(0.0),
            max: Some(100.0),
            ..Default::default()
        }),
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        5,
        0,
        "50",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::Strict);
}
#[test]
fn test_validate_column_schema_number_invalid() {
    let (storage, sid, gi) = storage_with_sheet();
    let schema = ColumnSchema {
        id: String::new(),
        name: String::new(),
        schema_type: SchemaType::Number,
        constraints: Some(SchemaConstraints {
            min: Some(0.0),
            max: Some(100.0),
            ..Default::default()
        }),
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        5,
        0,
        "200",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(!result.valid);
    assert!(result.error_message.is_some());
    assert_eq!(result.enforcement, EnforcementLevel::Strict);
}
#[test]
fn test_validate_range_schema_valid() {
    let (storage, sid, gi) = storage_with_sheet();
    let rs = make_range_schema("rs-val");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Position (5, 3) is inside range 0:0..10:5
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        5,
        3,
        "50",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::Strict);
}
#[test]
fn test_validate_range_schema_invalid_with_ui() {
    let (storage, sid, gi) = storage_with_sheet();
    let rs = make_range_schema("rs-inv");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Value 200 exceeds max 100
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        5,
        3,
        "200",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(!result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::Strict);
    assert_eq!(result.error_message, Some("Must be 0-100".to_string()));
    assert_eq!(result.error_title, Some("Invalid".to_string()));
}
#[test]
fn test_validate_empty_value_always_valid() {
    let (storage, sid, gi) = storage_with_sheet();
    let schema = ColumnSchema {
        id: String::new(),
        name: String::new(),
        schema_type: SchemaType::Number,
        constraints: Some(SchemaConstraints {
            min: Some(10.0),
            ..Default::default()
        }),
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        0,
        "",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(result.valid);
}
#[test]
fn test_validate_range_schema_outside_range() {
    let (storage, sid, gi) = storage_with_sheet();
    let rs = make_range_schema("rs-outside");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Position (50, 50) is outside range 0:0..10:5
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        50,
        50,
        "999",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::None);
}
#[test]
fn test_validate_not_a_number() {
    let (storage, sid, gi) = storage_with_sheet();
    let schema = ColumnSchema {
        id: String::new(),
        name: String::new(),
        schema_type: SchemaType::Number,
        constraints: Some(SchemaConstraints::default()),
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        0,
        "not_a_number",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(!result.valid);
    assert!(result.error_message.is_some());
}
#[test]
fn test_validate_column_schema_priority_over_range() {
    let (storage, sid, gi) = storage_with_sheet();

    // Column 2 has a Number schema.
    let col_schema = ColumnSchema {
        id: "col-prio".to_string(),
        name: String::new(),
        schema_type: SchemaType::Number,
        constraints: None,
        distribution: None,
        description: None,
    };
    set_column_schema(
        storage.doc(),
        storage.sheets(),
        &sid,
        2,
        &col_schema,
        Some(&gi),
    )
    .unwrap();

    // Range schema covering column 2 (rows 0-10, cols 0-5) demands String type
    // with Warning enforcement (different from column schema's hardcoded Strict).
    let range_schema = RangeSchema {
        id: "rs-conflict".to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "10:5".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::String),
            constraints: None,
        },
        enforcement: Some(EnforcementLevel::Warning),
        ui: None,
    };
    set_range_schema(storage.doc(), storage.sheets(), &sid, &range_schema).unwrap();

    // "42" is a valid number — column schema (Number, Strict) takes priority.
    // If range schema (String, Warning) had won instead, enforcement would be Warning.
    // Asserting Strict proves the column schema path was taken.
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        5,
        2,
        "42",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::Strict);
}
#[test]
fn test_validate_range_enforcement_warning() {
    let (storage, sid, gi) = storage_with_sheet();

    let range_schema = RangeSchema {
        id: "rs-warn".to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "10:5".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: None,
        },
        enforcement: Some(EnforcementLevel::Warning),
        ui: None,
    };
    set_range_schema(storage.doc(), storage.sheets(), &sid, &range_schema).unwrap();

    // "abc" is not a number — should fail but with Warning enforcement.
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        3,
        3,
        "abc",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(!result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::Warning);
}
#[test]
fn test_validate_range_enforcement_info_from_none() {
    // `EnforcementLevel::None` has no OOXML equivalent and round-trips to
    // `Info` through the canonical range-backed validation store (via
    // `EnforcementLevel` → `ErrorStyle::Information` →
    // `EnforcementLevel::Info`). This is expected: XLSX `errorStyle` is
    // stop/warning/information only, so None can't survive the trip.
    let (storage, sid, gi) = storage_with_sheet();

    let range_schema = RangeSchema {
        id: "rs-none-enf".to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "10:5".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: None,
        },
        enforcement: Some(EnforcementLevel::None),
        ui: None,
    };
    set_range_schema(storage.doc(), storage.sheets(), &sid, &range_schema).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        3,
        3,
        "abc",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(!result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::Info);
}
#[test]
fn test_validate_cell_value_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        0,
        "hello",
        None,
        &empty_mirror(),
    );
    assert!(result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::None);
}
