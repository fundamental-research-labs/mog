use super::test_support::*;
use super::*;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Origin, Transact};

#[test]
fn test_store_and_read_cf_rule_body() {
    let (storage, sheet_id) = storage_with_sheet();
    let fmt = make_format(
        "cf-body-1",
        &sheet_id,
        vec![rng(0, 0, 5, 5)],
        vec![make_rule("r1", 1)],
    );
    assert!(store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "rule-key-1",
        &fmt
    ));
    let result = read_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "rule-key-1",
    );
    assert!(result.is_some());
    let read_fmt = result.unwrap();
    assert_eq!(read_fmt.id, "cf-body-1");
    assert_eq!(read_fmt.rules.len(), 1);
    assert_eq!(read_fmt.rules[0].id(), "r1");
}

#[test]
fn test_read_cf_rule_body_nonexistent() {
    let (storage, sheet_id) = storage_with_sheet();
    assert!(
        read_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "nonexistent"
        )
        .is_none()
    );
}

#[test]
fn test_remove_cf_rule_body() {
    let (storage, sheet_id) = storage_with_sheet();
    let fmt = make_format(
        "cf-rm",
        &sheet_id,
        vec![rng(0, 0, 5, 5)],
        vec![make_rule("r1", 1)],
    );
    store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "rule-rm",
        &fmt,
    );
    assert!(remove_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "rule-rm"
    ));
    assert!(
        read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "rule-rm").is_none()
    );
}

#[test]
fn test_list_cf_rule_body_keys() {
    let (storage, sheet_id) = storage_with_sheet();
    let fmt_a = make_format(
        "cf-a",
        &sheet_id,
        vec![rng(0, 0, 5, 5)],
        vec![make_rule("r1", 1)],
    );
    let fmt_b = make_format(
        "cf-b",
        &sheet_id,
        vec![rng(10, 10, 15, 15)],
        vec![make_rule("r2", 2)],
    );
    store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "key-a",
        &fmt_a,
    );
    store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "key-b",
        &fmt_b,
    );
    let mut keys = list_cf_rule_body_keys(storage.doc(), &storage.sheets_ref(), &sheet_id);
    keys.sort();
    assert_eq!(keys, vec!["key-a".to_string(), "key-b".to_string()]);
}

#[test]
fn test_multi_region_shared_rule_body() {
    let (storage, sheet_id) = storage_with_sheet();
    let fmt = make_format(
        "shared-cf",
        &sheet_id,
        vec![rng(0, 0, 5, 5), rng(10, 10, 15, 15)],
        vec![make_rule("r1", 1), make_rule("r2", 2)],
    );
    store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "shared-rule",
        &fmt,
    );
    let result = read_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "shared-rule",
    )
    .unwrap();
    assert_eq!(result.rules.len(), 2);
    assert_eq!(result.rules[0].priority(), 1);
    assert_eq!(result.rules[1].priority(), 2);
}

#[test]
fn test_cf_priority_ordering_preserved() {
    let (storage, sheet_id) = storage_with_sheet();
    let fmt = make_format(
        "pri-cf",
        &sheet_id,
        vec![rng(0, 0, 5, 5)],
        vec![
            make_rule("r3", 30),
            make_rule("r1", 10),
            make_rule("r2", 20),
        ],
    );
    store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "pri-rule",
        &fmt,
    );
    let result =
        read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "pri-rule").unwrap();
    assert_eq!(result.rules[0].priority(), 30);
    assert_eq!(result.rules[1].priority(), 10);
    assert_eq!(result.rules[2].priority(), 20);
}

#[test]
fn test_orphan_gc_deletes_unreferenced_rule() {
    let (storage, sheet_id) = storage_with_sheet();
    ensure_range_bindings_map(&storage, &sheet_id);
    let fmt = make_format(
        "orphan-cf",
        &sheet_id,
        vec![rng(0, 0, 5, 5)],
        vec![make_rule("r1", 1)],
    );
    store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "orphan-rule",
        &fmt,
    );
    assert!(gc_orphan_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "orphan-rule"
    ));
    assert!(
        read_cf_rule_body(
            storage.doc(),
            &storage.sheets_ref(),
            &sheet_id,
            "orphan-rule"
        )
        .is_none()
    );
}

#[test]
fn test_orphan_gc_retains_referenced_rule() {
    let (storage, sheet_id) = storage_with_sheet();
    ensure_range_bindings_map(&storage, &sheet_id);
    let fmt = make_format(
        "ref-cf",
        &sheet_id,
        vec![rng(0, 0, 5, 5)],
        vec![make_rule("r1", 1)],
    );
    store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "ref-rule",
        &fmt,
    );
    {
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let bindings_map = get_range_bindings_map(&storage, &sheet_id, &txn);
        let binding = compute_document::range::CfBinding {
            rule_ref: "ref-rule".to_string(),
        };
        compute_document::range::write_cf_binding(
            &mut txn,
            &bindings_map,
            &cell_types::RangeId::from_raw(0x42),
            &binding,
        );
    }
    assert!(!gc_orphan_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "ref-rule"
    ));
    assert!(
        read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "ref-rule").is_some()
    );
}

#[test]
fn test_deletion_lifecycle() {
    let (storage, sheet_id) = storage_with_sheet();
    ensure_range_bindings_map(&storage, &sheet_id);
    let fmt = make_format(
        "lc-cf",
        &sheet_id,
        vec![rng(0, 0, 5, 5)],
        vec![make_rule("r1", 1)],
    );
    store_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "lc-rule",
        &fmt,
    );
    // Two bindings reference the same rule
    {
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let bm = get_range_bindings_map(&storage, &sheet_id, &txn);
        let b = compute_document::range::CfBinding {
            rule_ref: "lc-rule".to_string(),
        };
        compute_document::range::write_cf_binding(
            &mut txn,
            &bm,
            &cell_types::RangeId::from_raw(0xA),
            &b,
        );
        compute_document::range::write_cf_binding(
            &mut txn,
            &bm,
            &cell_types::RangeId::from_raw(0xB),
            &b,
        );
    }
    // Delete one region — rule persists
    {
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let bm = get_range_bindings_map(&storage, &sheet_id, &txn);
        compute_document::range::remove_range_binding(
            &mut txn,
            &bm,
            &cell_types::RangeId::from_raw(0xA),
        );
    }
    assert!(!gc_orphan_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "lc-rule"
    ));
    assert!(
        read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "lc-rule").is_some()
    );
    // Delete last region — GC removes rule
    {
        let mut txn = storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let bm = get_range_bindings_map(&storage, &sheet_id, &txn);
        compute_document::range::remove_range_binding(
            &mut txn,
            &bm,
            &cell_types::RangeId::from_raw(0xB),
        );
    }
    assert!(gc_orphan_cf_rule_body(
        storage.doc(),
        &storage.sheets_ref(),
        &sheet_id,
        "lc-rule"
    ));
    assert!(
        read_cf_rule_body(storage.doc(), &storage.sheets_ref(), &sheet_id, "lc-rule").is_none()
    );
}
