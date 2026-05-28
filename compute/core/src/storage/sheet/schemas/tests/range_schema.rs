use super::support::*;
use super::*;

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
#[test]
fn test_set_range_schema_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    let rs = make_range_schema("rs-err");
    let result = set_range_schema(storage.doc(), storage.sheets(), &sid, &rs);
    assert!(result.is_err());
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
