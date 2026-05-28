use super::support::*;
use super::*;

#[test]
fn test_get_column_schema_none_initially() {
    let (storage, sid, gi) = storage_with_sheet();
    assert!(get_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).is_none());
}
#[test]
fn test_set_and_get_column_schema() {
    let (storage, sid, gi) = storage_with_sheet();
    let schema = ColumnSchema {
        id: "col-schema-1".to_string(),
        name: "Amount".to_string(),
        schema_type: SchemaType::Number,
        constraints: Some(SchemaConstraints {
            min: Some(0.0),
            max: Some(1000.0),
            ..Default::default()
        }),
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 2, &schema, Some(&gi)).unwrap();
    let fetched = get_column_schema(storage.doc(), storage.sheets(), &sid, 2, Some(&gi));
    assert!(fetched.is_some());
    assert_eq!(fetched.unwrap(), schema);
}
#[test]
fn test_set_column_schema_overwrite() {
    let (storage, sid, gi) = storage_with_sheet();
    let schema1 = ColumnSchema {
        id: "cs-1".to_string(),
        name: "V1".to_string(),
        schema_type: SchemaType::String,
        constraints: None,
        distribution: None,
        description: None,
    };
    let schema2 = ColumnSchema {
        id: "cs-2".to_string(),
        name: "V2".to_string(),
        schema_type: SchemaType::Number,
        constraints: None,
        distribution: None,
        description: None,
    };
    set_column_schema(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        &schema1,
        Some(&gi),
    )
    .unwrap();
    set_column_schema(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        &schema2,
        Some(&gi),
    )
    .unwrap();
    let fetched = get_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).unwrap();
    assert_eq!(fetched, schema2);
}
#[test]
fn test_clear_column_schema() {
    let (storage, sid, gi) = storage_with_sheet();
    let schema = ColumnSchema {
        id: "cs-clear".to_string(),
        name: String::new(),
        schema_type: SchemaType::String,
        constraints: None,
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 3, &schema, Some(&gi)).unwrap();
    assert!(get_column_schema(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)).is_some());

    clear_column_schema(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)).unwrap();
    assert!(get_column_schema(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)).is_none());
}
#[test]
fn test_clear_column_schema_noop_when_missing() {
    let (storage, sid, gi) = storage_with_sheet();
    let result = clear_column_schema(storage.doc(), storage.sheets(), &sid, 99, Some(&gi));
    assert!(result.is_ok());
}
#[test]
fn test_get_all_column_schemas() {
    let (storage, sid, gi) = storage_with_sheet();
    let s1 = ColumnSchema {
        id: "a".to_string(),
        name: String::new(),
        schema_type: SchemaType::Number,
        constraints: None,
        distribution: None,
        description: None,
    };
    let s2 = ColumnSchema {
        id: "b".to_string(),
        name: String::new(),
        schema_type: SchemaType::String,
        constraints: None,
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &s1, Some(&gi)).unwrap();
    set_column_schema(storage.doc(), storage.sheets(), &sid, 3, &s2, Some(&gi)).unwrap();

    let all = get_all_column_schemas(storage.doc(), storage.sheets(), &sid, Some(&gi));
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].0, 0);
    assert_eq!(all[0].1, s1);
    assert_eq!(all[1].0, 3);
    assert_eq!(all[1].1, s2);
}
#[test]
fn test_get_all_column_schemas_empty() {
    let (storage, sid, gi) = storage_with_sheet();
    let all = get_all_column_schemas(storage.doc(), storage.sheets(), &sid, Some(&gi));
    assert!(all.is_empty());
}
#[test]
fn test_set_column_schema_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    let schema = ColumnSchema {
        id: String::new(),
        name: String::new(),
        schema_type: SchemaType::Any,
        constraints: None,
        distribution: None,
        description: None,
    };
    let result = set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, None);
    assert!(result.is_err());
}
#[test]
fn test_get_all_column_schemas_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    let all = get_all_column_schemas(storage.doc(), storage.sheets(), &sid, None);
    assert!(all.is_empty());
}
#[test]
fn test_column_schema_with_any_type_no_constraints() {
    let (storage, sid, gi) = storage_with_sheet();
    let schema = ColumnSchema {
        id: "empty".to_string(),
        name: String::new(),
        schema_type: SchemaType::Any,
        constraints: None,
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &schema, Some(&gi)).unwrap();
    let fetched = get_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).unwrap();
    assert_eq!(fetched, schema);
}
#[test]
fn test_multiple_column_schemas_independent() {
    let (storage, sid, gi) = storage_with_sheet();
    let s1 = ColumnSchema {
        id: "s1".to_string(),
        name: String::new(),
        schema_type: SchemaType::Number,
        constraints: None,
        distribution: None,
        description: None,
    };
    let s2 = ColumnSchema {
        id: "s2".to_string(),
        name: String::new(),
        schema_type: SchemaType::String,
        constraints: None,
        distribution: None,
        description: None,
    };
    set_column_schema(storage.doc(), storage.sheets(), &sid, 0, &s1, Some(&gi)).unwrap();
    set_column_schema(storage.doc(), storage.sheets(), &sid, 1, &s2, Some(&gi)).unwrap();

    // Clear col 0 should not affect col 1
    clear_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).unwrap();
    assert!(get_column_schema(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)).is_none());
    assert_eq!(
        get_column_schema(storage.doc(), storage.sheets(), &sid, 1, Some(&gi)).unwrap(),
        s2
    );
}
