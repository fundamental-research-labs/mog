use super::*;
use crate::identity::GridIndex;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use std::sync::Arc;

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

/// Helper: create a storage with one sheet.
fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let (storage, sid, gi, _mirror) = storage_with_sheet_and_mirror();
    (storage, sid, gi)
}

fn storage_with_sheet_and_mirror() -> (YrsStorage, SheetId, GridIndex, crate::mirror::CellMirror) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi, mirror)
}

/// Default mirror for tests that don't exercise the formula path.
fn empty_mirror() -> crate::mirror::CellMirror {
    crate::mirror::CellMirror::new()
}

/// Count validation rule entries in the Range-backed store.
fn validation_rule_count(storage: &YrsStorage, sid: &SheetId) -> usize {
    get_range_schemas_for_sheet(storage.doc(), storage.sheets(), sid).len()
}

// -----------------------------------------------------------------------
// 1. position_in_range tests
// -----------------------------------------------------------------------

#[test]
fn test_position_in_range_inside() {
    let rr = IdentityRangeSchemaRef {
        start_id: "0:0".to_string(),
        end_id: "10:5".to_string(),
        sheet_id: None,
    };
    assert!(position_in_range(0, 0, &rr));
    assert!(position_in_range(5, 3, &rr));
    assert!(position_in_range(10, 5, &rr));
}

#[test]
fn test_position_in_range_outside() {
    let rr = IdentityRangeSchemaRef {
        start_id: "2:2".to_string(),
        end_id: "5:5".to_string(),
        sheet_id: None,
    };
    assert!(!position_in_range(0, 0, &rr));
    assert!(!position_in_range(1, 3, &rr));
    assert!(!position_in_range(6, 3, &rr));
    assert!(!position_in_range(3, 6, &rr));
}

#[test]
fn test_position_in_range_reversed_start_end() {
    let rr = IdentityRangeSchemaRef {
        start_id: "10:5".to_string(),
        end_id: "0:0".to_string(),
        sheet_id: None,
    };
    assert!(position_in_range(5, 3, &rr));
}

#[test]
fn test_position_in_range_unparseable() {
    let rr = IdentityRangeSchemaRef {
        start_id: "abc".to_string(),
        end_id: "def".to_string(),
        sheet_id: None,
    };
    assert!(!position_in_range(0, 0, &rr));
}

// -----------------------------------------------------------------------
// 2. Column schema CRUD
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// 3. Range schema CRUD (now backed by properties/dataValidations)
// -----------------------------------------------------------------------

fn make_range_schema(id: &str) -> RangeSchema {
    RangeSchema {
        id: id.to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "10:5".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: Some(RangeSchemaUi {
            show_dropdown: None,
            error_message: Some(ErrorMessage {
                title: Some("Invalid".to_string()),
                message: Some("Must be 0-100".to_string()),
            }),
            input_message: Some(InputMessage {
                title: Some("Enter value".to_string()),
                message: Some("0 to 100".to_string()),
            }),
        }),
    }
}

#[test]
fn test_set_and_get_range_schema() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-1");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    let fetched = get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-1").expect("rs-1");
    // The view-layer id round-trips because "rs-1" is stored as the spec's uid.
    assert_eq!(fetched.id, "rs-1");
    assert_eq!(fetched.ranges, rs.ranges);
    assert_eq!(fetched.schema.schema_type, rs.schema.schema_type);
    assert_eq!(fetched.enforcement, rs.enforcement);
}

#[test]
fn test_get_range_schema_missing() {
    let (storage, sid, _gi) = storage_with_sheet();
    assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "nope").is_none());
}

#[test]
fn test_get_range_schemas_for_sheet() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs1 = make_range_schema("rs-1");
    let rs2 = make_range_schema("rs-2");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs1).unwrap();
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs2).unwrap();

    let all = get_range_schemas_for_sheet(storage.doc(), storage.sheets(), &sid);
    assert_eq!(all.len(), 2);
    let ids: Vec<&str> = all.iter().map(|r| r.id.as_str()).collect();
    assert!(ids.contains(&"rs-1"));
    assert!(ids.contains(&"rs-2"));
}

#[test]
fn test_get_range_schemas_for_sheet_empty() {
    let (storage, sid, _gi) = storage_with_sheet();
    let all = get_range_schemas_for_sheet(storage.doc(), storage.sheets(), &sid);
    assert!(all.is_empty());
}

#[test]
fn test_update_range_schema() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-upd");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    let mut updated = rs.clone();
    updated.enforcement = Some(EnforcementLevel::Warning);
    update_range_schema(storage.doc(), storage.sheets(), &sid, "rs-upd", &updated).unwrap();

    let fetched =
        get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-upd").expect("present");
    assert_eq!(fetched.enforcement, Some(EnforcementLevel::Warning));
    // Updating in place must not duplicate the entry.
    assert_eq!(validation_rule_count(&storage, &sid), 1);
}

#[test]
fn test_delete_range_schema() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-del");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();
    assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-del").is_some());

    delete_range_schema(storage.doc(), storage.sheets(), &sid, "rs-del");
    assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-del").is_none());
    assert_eq!(validation_rule_count(&storage, &sid), 0);
}

#[test]
fn test_delete_range_schema_noop() {
    let (storage, sid, _gi) = storage_with_sheet();
    // Should not panic
    delete_range_schema(storage.doc(), storage.sheets(), &sid, "nonexistent");
}

// -----------------------------------------------------------------------
// 3b. Concurrent-edit CRDT semantics
// -----------------------------------------------------------------------

/// Build a RangeSchema that targets a specific row:col range and carries
/// a stable uid.
fn range_schema_at(id: &str, start: &str, end: &str) -> RangeSchema {
    RangeSchema {
        id: id.to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: start.to_string(),
            end_id: end.to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    }
}

/// Sync `src` state into `dst` by exchanging state-vector-based diffs.
/// Uses the same pattern as the sync layer and floating_objects tests.
fn sync_storage(src: &YrsStorage, dst: &YrsStorage) {
    use yrs::updates::decoder::Decode;
    let sv = dst.doc().transact().state_vector();
    let update = src.doc().transact().encode_diff_v1(&sv);
    let decoded = yrs::Update::decode_v1(&update).expect("decode update");
    dst.doc()
        .transact_mut()
        .apply_update(decoded)
        .expect("apply update");
}

/// Clone a YrsStorage at the given SheetId so two docs share identical
/// baseline state before diverging.
fn clone_storage(src: &YrsStorage) -> YrsStorage {
    use yrs::updates::decoder::Decode;
    let update = src
        .doc()
        .transact()
        .encode_diff_v1(&yrs::StateVector::default());
    let decoded = yrs::Update::decode_v1(&update).expect("decode update");
    let storage2 = YrsStorage::new();
    storage2
        .doc()
        .transact_mut()
        .apply_update(decoded)
        .expect("apply update");
    storage2
}

/// Collect spec ids from a storage's data-validations view.
fn view_ids(storage: &YrsStorage, sid: &SheetId) -> Vec<String> {
    get_range_schemas_for_sheet(storage.doc(), storage.sheets(), sid)
        .into_iter()
        .map(|r| r.id)
        .collect()
}

#[test]
fn test_update_preserves_entries() {
    // Insert A then B; update A; both entries still present.
    let (storage, sid, _gi) = storage_with_sheet();
    let a = range_schema_at("rs-A", "0:0", "0:0");
    let b = range_schema_at("rs-B", "1:0", "1:0");

    set_range_schema(storage.doc(), storage.sheets(), &sid, &a).unwrap();
    set_range_schema(storage.doc(), storage.sheets(), &sid, &b).unwrap();
    let mut ids = view_ids(&storage, &sid);
    ids.sort();
    assert_eq!(ids, vec!["rs-A", "rs-B"]);

    // Mutate A's enforcement and update by id.
    let mut a2 = a.clone();
    a2.enforcement = Some(EnforcementLevel::Warning);
    update_range_schema(storage.doc(), storage.sheets(), &sid, "rs-A", &a2).unwrap();

    // Both entries still present and the field was actually updated.
    let mut ids = view_ids(&storage, &sid);
    ids.sort();
    assert_eq!(ids, vec!["rs-A", "rs-B"]);
    let fetched = get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-A").expect("rs-A");
    assert_eq!(fetched.enforcement, Some(EnforcementLevel::Warning));
    assert_eq!(validation_rule_count(&storage, &sid), 2);
}

#[test]
fn test_concurrent_insert_disjoint_ranges_merge() {
    // Two peers insert different specs simultaneously on disjoint cells.
    // Both must survive the merge. The Range-backed store uses Y.Map
    // entries with distinct keys, so concurrent inserts merge cleanly.
    let (storage1, sid, _gi) = storage_with_sheet();
    let storage2 = clone_storage(&storage1);

    // Concurrently insert different specs on each storage.
    let a = range_schema_at("rs-A", "0:0", "0:0"); // A1
    let b = range_schema_at("rs-B", "0:1", "0:1"); // B1
    set_range_schema(storage1.doc(), storage1.sheets(), &sid, &a).unwrap();
    set_range_schema(storage2.doc(), storage2.sheets(), &sid, &b).unwrap();

    // Cross-sync both directions.
    sync_storage(&storage1, &storage2);
    sync_storage(&storage2, &storage1);

    let mut ids1 = view_ids(&storage1, &sid);
    let mut ids2 = view_ids(&storage2, &sid);
    ids1.sort();
    ids2.sort();
    assert_eq!(ids1, vec!["rs-A".to_string(), "rs-B".to_string()]);
    assert_eq!(ids2, vec!["rs-A".to_string(), "rs-B".to_string()]);

    // Both peers converge to exactly two entries.
    assert_eq!(validation_rule_count(&storage1, &sid), 2);
    assert_eq!(validation_rule_count(&storage2, &sid), 2);
}

#[test]
fn test_concurrent_update_converges() {
    // Two peers start from the same spec, then each updates a different
    // field. After sync, both peers converge to the same state (LWW on
    // the JSON rule body in `validationRules`).
    let (storage1, sid, _gi) = storage_with_sheet();
    let seed = range_schema_at("rs-seed", "0:0", "10:5");
    set_range_schema(storage1.doc(), storage1.sheets(), &sid, &seed).unwrap();

    // Fork post-seed so both docs share the spec.
    let storage2 = clone_storage(&storage1);
    assert_eq!(validation_rule_count(&storage1, &sid), 1);
    assert_eq!(validation_rule_count(&storage2, &sid), 1);

    // Peer 1: update enforcement → Warning.
    let mut u1 = seed.clone();
    u1.enforcement = Some(EnforcementLevel::Warning);
    update_range_schema(storage1.doc(), storage1.sheets(), &sid, "rs-seed", &u1).unwrap();

    // Peer 2: update schema.constraints.max → 200.0.
    let mut u2 = seed.clone();
    if let Some(c) = u2.schema.constraints.as_mut() {
        c.max = Some(200.0);
    }
    update_range_schema(storage2.doc(), storage2.sheets(), &sid, "rs-seed", &u2).unwrap();

    sync_storage(&storage1, &storage2);
    sync_storage(&storage2, &storage1);

    // Both converge to a single spec.
    assert_eq!(validation_rule_count(&storage1, &sid), 1);
    assert_eq!(validation_rule_count(&storage2, &sid), 1);

    // CRDT convergence: both peers agree on the same state.
    let r1 = get_range_schema(storage1.doc(), storage1.sheets(), &sid, "rs-seed")
        .expect("rs-seed on storage1");
    let r2 = get_range_schema(storage2.doc(), storage2.sheets(), &sid, "rs-seed")
        .expect("rs-seed on storage2");
    assert_eq!(r1.enforcement, r2.enforcement);
    assert_eq!(r1.schema.constraints, r2.schema.constraints);
}

#[test]
fn test_concurrent_delete_and_update_converges() {
    // P0 deletes spec X, P1 updates a field on spec X. After sync, both
    // peers converge. With the Range-backed store, the delete removes
    // range entries and rule body; the update recreates them. LWW on the
    // Y.Map keys determines which wins.
    let (storage1, sid, _gi) = storage_with_sheet();
    let seed = range_schema_at("rs-del-upd", "0:0", "10:5");
    set_range_schema(storage1.doc(), storage1.sheets(), &sid, &seed).unwrap();
    let storage2 = clone_storage(&storage1);

    // P0: delete.
    delete_range_schema(storage1.doc(), storage1.sheets(), &sid, "rs-del-upd");
    // P1: update (set enforcement → Warning).
    let mut u = seed.clone();
    u.enforcement = Some(EnforcementLevel::Warning);
    update_range_schema(storage2.doc(), storage2.sheets(), &sid, "rs-del-upd", &u).unwrap();

    sync_storage(&storage1, &storage2);
    sync_storage(&storage2, &storage1);

    // CRDT convergence: both storages agree on the final view.
    let ids1 = view_ids(&storage1, &sid);
    let ids2 = view_ids(&storage2, &sid);
    assert_eq!(ids1, ids2);
    let len1 = validation_rule_count(&storage1, &sid);
    let len2 = validation_rule_count(&storage2, &sid);
    assert_eq!(len1, len2);
}

// -----------------------------------------------------------------------
// 3a. Locking tests — the duplicate-storage fix
// -----------------------------------------------------------------------

#[test]
fn test_set_range_schema_stores_single_entry() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-single");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Exactly one stored ValidationSpec — no parallel rangeSchemas store.
    assert_eq!(validation_rule_count(&storage, &sid), 1);
}

#[test]
fn test_multiple_range_schemas_yield_n_entries_not_2n() {
    let (storage, sid, _gi) = storage_with_sheet();
    let n = 5;
    for i in 0..n {
        set_range_schema(
            storage.doc(),
            storage.sheets(),
            &sid,
            &make_range_schema(&format!("rs-{i}")),
        )
        .unwrap();
    }
    assert_eq!(validation_rule_count(&storage, &sid), n);
    // View layer also reports exactly n entries.
    let view = get_range_schemas_for_sheet(storage.doc(), storage.sheets(), &sid);
    assert_eq!(view.len(), n as usize);
}

// -----------------------------------------------------------------------
// 4. validate_cell_value
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// 5. str_to_cell_value unit tests
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// 6. Serde roundtrip
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// 7. Edge cases / error paths
// -----------------------------------------------------------------------

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
fn test_set_range_schema_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    let rs = make_range_schema("rs-err");
    let result = set_range_schema(storage.doc(), storage.sheets(), &sid, &rs);
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
fn test_update_range_schema_nonexistent_creates() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-new");
    update_range_schema(storage.doc(), storage.sheets(), &sid, "rs-new", &rs).unwrap();

    let fetched = get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-new");
    assert!(fetched.is_some());
    assert_eq!(validation_rule_count(&storage, &sid), 1);
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

// -----------------------------------------------------------------------
// W3. Column schema takes priority over range schema
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// W4. Non-Strict enforcement levels
// -----------------------------------------------------------------------

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
    // `Info` through the canonical `properties/dataValidations` store
    // (via `EnforcementLevel` → `ErrorStyle::Information` →
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

// -----------------------------------------------------------------------
// Custom-formula validation: editor commit path uses pending value
// -----------------------------------------------------------------------

fn make_custom_formula_range_schema(
    id: &str,
    formula: &str,
    ranges: Vec<IdentityRangeSchemaRef>,
) -> RangeSchema {
    RangeSchema {
        id: id.to_string(),
        created_at: 1700000000,
        ranges,
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Any),
            constraints: Some(SchemaConstraints {
                formula: Some(formula.to_string()),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    }
}

#[test]
fn custom_formula_accepts_truthy_typed_value() {
    let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
    let rs = make_custom_formula_range_schema(
        "rs-custom-truthy",
        "=ISNUMBER(E1)",
        vec![IdentityRangeSchemaRef {
            start_id: "0:4".to_string(),
            end_id: "4:4".to_string(),
            sheet_id: None,
        }],
    );
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        4,
        "42",
        Some(&gi),
        &mirror,
    );
    assert!(result.valid, "Numeric '42' must satisfy ISNUMBER");
}

#[test]
fn custom_formula_rejects_falsy_typed_value() {
    let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
    let rs = make_custom_formula_range_schema(
        "rs-custom-falsy",
        "=ISNUMBER(E1)",
        vec![IdentityRangeSchemaRef {
            start_id: "0:4".to_string(),
            end_id: "4:4".to_string(),
            sheet_id: None,
        }],
    );
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        1,
        4,
        "hello",
        Some(&gi),
        &mirror,
    );
    assert!(
        !result.valid,
        "Text 'hello' must fail ISNUMBER and reject the commit"
    );
    assert_eq!(result.enforcement, EnforcementLevel::Strict);
}

#[test]
fn custom_formula_shifts_relative_refs_per_row() {
    // =ISNUMBER(E1) on E1:E5 must evaluate as ISNUMBER(E2) for row 1, etc.
    // The pending typed value is what gets fed to the (shifted) reference.
    let (storage, sid, gi, mirror) = storage_with_sheet_and_mirror();
    let rs = make_custom_formula_range_schema(
        "rs-custom-shift",
        "=ISNUMBER(E1)",
        vec![IdentityRangeSchemaRef {
            start_id: "0:4".to_string(),
            end_id: "4:4".to_string(),
            sheet_id: None,
        }],
    );
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Row 2 (E3): typing "3.14" shifts the formula to ISNUMBER(E3) and the
    // pending override at E3 supplies the number; ISNUMBER returns TRUE.
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        2,
        4,
        "3.14",
        Some(&gi),
        &mirror,
    );
    assert!(result.valid);
}

// -----------------------------------------------------------------------
// Phase 5D: Range-backed validation tests
// -----------------------------------------------------------------------

#[test]
fn phase5d_set_range_schema_creates_validation_ranges() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-5d-1");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Range-backed store has the entry.
    assert_eq!(validation_rule_count(&storage, &sid), 1);
    let fetched =
        get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-1").expect("rs-5d-1");
    assert_eq!(fetched.id, "rs-5d-1");
}

#[test]
fn phase5d_set_range_schema_clears_imported_declared_count_metadata() {
    let (storage, sid, _gi) = storage_with_sheet();
    {
        let mut txn = storage.doc().transact_mut();
        let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
        meta.insert(&mut txn, KEY_DV_DECLARED_COUNT, 2_i64);
    }

    let rs = make_range_schema("rs-5d-clear-count");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    let txn = storage.doc().transact();
    let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
    assert!(meta.get(&txn, KEY_DV_DECLARED_COUNT).is_none());
}

#[test]
fn phase5d_delete_range_schema_cleans_up_ranges() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-5d-del");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    assert_eq!(validation_rule_count(&storage, &sid), 1);
    delete_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-del");

    // Range-backed store cleaned up.
    assert_eq!(validation_rule_count(&storage, &sid), 0);
    // View layer confirms deletion.
    assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-del").is_none());
}

#[test]
fn phase5d_delete_range_schema_clears_imported_declared_count_metadata() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-5d-del-count");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();
    {
        let mut txn = storage.doc().transact_mut();
        let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
        meta.insert(&mut txn, KEY_DV_DECLARED_COUNT, 2_i64);
    }

    delete_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-del-count");

    let txn = storage.doc().transact();
    let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
    assert!(meta.get(&txn, KEY_DV_DECLARED_COUNT).is_none());
}

#[test]
fn phase5d_multiple_range_schemas_independent_delete() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs1 = make_range_schema("rs-5d-a");
    let rs2 = make_range_schema("rs-5d-b");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs1).unwrap();
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs2).unwrap();

    assert_eq!(validation_rule_count(&storage, &sid), 2);

    // Delete one, keep the other.
    delete_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-a");
    assert_eq!(validation_rule_count(&storage, &sid), 1);
    assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-a").is_none());
    assert!(get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-b").is_some());
}

#[test]
fn phase5d_update_range_schema_replaces_ranges() {
    let (storage, sid, _gi) = storage_with_sheet();
    let rs = make_range_schema("rs-5d-upd");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Update enforcement.
    let mut updated = rs.clone();
    updated.enforcement = Some(EnforcementLevel::Warning);
    update_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-upd", &updated).unwrap();

    // Still only one entry in the store.
    assert_eq!(validation_rule_count(&storage, &sid), 1);

    // Updated field is reflected.
    let fetched =
        get_range_schema(storage.doc(), storage.sheets(), &sid, "rs-5d-upd").expect("rs-5d-upd");
    assert_eq!(fetched.enforcement, Some(EnforcementLevel::Warning));
}

#[test]
fn phase5d_single_cell_validation() {
    let (storage, sid, gi) = storage_with_sheet();

    // Single-cell validation at A1 (0:0 to 0:0).
    let rs = RangeSchema {
        id: "rs-single-cell".to_string(),
        created_at: 0,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "0:0".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(1.0),
                max: Some(10.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    };
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    // Cell A1 (0,0) should be validated.
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        0,
        "5",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(result.valid);

    // Cell A2 (1,0) should NOT be validated (outside single-cell range).
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        1,
        0,
        "999",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::None);
}

#[test]
fn phase5d_first_match_semantics() {
    // Two overlapping validation rules. First match wins.
    let (storage, sid, gi) = storage_with_sheet();

    // Rule 1: A1:A10, Number 0-100
    let rs1 = RangeSchema {
        id: "rs-first".to_string(),
        created_at: 0,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "9:0".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    };

    // Rule 2: A1:A10, Number 0-200 (more permissive, but second)
    let rs2 = RangeSchema {
        id: "rs-second".to_string(),
        created_at: 0,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "9:0".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(200.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Warning),
        ui: None,
    };

    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs1).unwrap();
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs2).unwrap();

    // Value 150 passes rule 2 (0-200) but fails rule 1 (0-100).
    // First-match semantics: rule 1 wins, result is FAIL with Strict enforcement.
    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        0,
        "150",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(!result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::Strict);

    // Updating the first rule must preserve its priority.
    let mut rs1_updated = rs1.clone();
    rs1_updated.enforcement = Some(EnforcementLevel::Warning);
    update_range_schema(
        storage.doc(),
        storage.sheets(),
        &sid,
        "rs-first",
        &rs1_updated,
    )
    .unwrap();

    let result = validate_cell_value(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        0,
        "150",
        Some(&gi),
        &empty_mirror(),
    );
    assert!(!result.valid);
    assert_eq!(result.enforcement, EnforcementLevel::Warning);
}
