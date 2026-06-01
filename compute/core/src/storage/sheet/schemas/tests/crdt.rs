use super::support::*;
use super::*;

fn one_sheet_snapshot(sheet_id: &str) -> snapshot_types::WorkbookSnapshot {
    snapshot_types::WorkbookSnapshot {
        sheets: vec![snapshot_types::SheetSnapshot {
            id: sheet_id.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
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
fn test_engine_set_range_schema_uses_partitioned_range_ids() {
    let sheet_uuid = "550e8400-e29b-41d4-a716-446655440000";
    let sheet_id = SheetId::from_uuid_str(sheet_uuid).unwrap();
    let (mut engine, _) =
        crate::storage::engine::YrsComputeEngine::from_snapshot(one_sheet_snapshot(sheet_uuid))
            .unwrap();

    let schema = range_schema_at("rs-engine", "0:0", "0:0");
    engine.set_range_schema(&sheet_id, &schema).unwrap();

    let state = engine.sync_full_state();
    let storage = YrsStorage::from_yrs_state(&state).unwrap();
    let snapshot =
        crate::storage::engine::construction::build_workbook_snapshot_from_yrs(&storage).unwrap();
    let range_id = snapshot.sheets[0].ranges[0].range_id.as_u128();

    assert_ne!(
        range_id >> 64,
        0,
        "engine range-schema writes must not use the local-only range-id partition",
    );
}

#[test]
fn test_concurrent_insert_disjoint_ranges_merge() {
    // Two peers insert different specs simultaneously on disjoint cells.
    // Both must survive the merge. The Range-backed store uses Y.Map
    // entries with distinct keys, so concurrent inserts merge cleanly.
    let (storage1, sid, _gi) = storage_with_sheet();
    let storage2 = clone_storage(&storage1);
    let server = clone_storage(&storage1);
    let alloc1 = cell_types::IdAllocator::with_client_partition(storage1.doc().client_id());
    let alloc2 = cell_types::IdAllocator::with_client_partition(storage2.doc().client_id());

    // Concurrently insert different specs on each storage.
    let a = range_schema_at("rs-A", "0:0", "0:0"); // A1
    let b = range_schema_at("rs-B", "0:1", "0:1"); // B1
    set_range_schema_with_alloc(storage1.doc(), storage1.sheets(), &sid, &a, &alloc1).unwrap();
    set_range_schema_with_alloc(storage2.doc(), storage2.sheets(), &sid, &b, &alloc2).unwrap();

    // Fan both concurrent peer updates into an authoritative server document,
    // then pull the merged state back to both peers. This mirrors the network
    // collaboration path used by colab-eval.
    sync_storage(&storage1, &server);
    sync_storage(&storage2, &server);
    sync_storage(&server, &storage1);
    sync_storage(&server, &storage2);

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
