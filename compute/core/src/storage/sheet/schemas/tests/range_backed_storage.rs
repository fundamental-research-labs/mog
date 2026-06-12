use super::support::*;
use super::*;

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
        meta.insert(&mut txn, "dataValidations", yrs::ArrayPrelim::default());
        meta.insert(&mut txn, "x14DataValidations", yrs::ArrayPrelim::default());
        meta.insert(&mut txn, KEY_DV_DECLARED_COUNT, 2_i64);
        meta.insert(&mut txn, "x14DvDeclaredCount", 1_i64);
    }

    let rs = make_range_schema("rs-5d-clear-count");
    set_range_schema(storage.doc(), storage.sheets(), &sid, &rs).unwrap();

    let txn = storage.doc().transact();
    let meta = get_properties_map(&txn, storage.sheets(), &sid).expect("sheet meta");
    assert!(meta.get(&txn, "dataValidations").is_none());
    assert!(meta.get(&txn, "x14DataValidations").is_none());
    assert!(meta.get(&txn, KEY_DV_DECLARED_COUNT).is_none());
    assert!(meta.get(&txn, "x14DvDeclaredCount").is_none());
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
