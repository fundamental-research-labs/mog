mod support;

use compute_collab::{apply_update, encode_full_state};
use support::{realistic_bootstrap, root_maps_only_bootstrap, sheet_order_len, sheet_order_string};
use yrs::{Array, Doc, Map, Transact};

// These tests document the IndexedDB/provider replay bug class: local eager
// workbook-child inserts can LWW-shadow replayed foreign updates. Root maps
// are interned by name and merge cleanly, but nested values under `workbook`
// are normal map entries. When two sessions independently insert the same
// child key, yrs Map LWW chooses one visible struct and writes attached to the
// loser can become unreachable through `workbook.get(KEY)`.

#[test]
fn provider_replay_realistic_bootstrap_clash() {
    let doc_a = Doc::new();
    realistic_bootstrap(&doc_a);
    {
        let workbook = doc_a.get_or_insert_map("workbook");
        let mut txn = doc_a.transact_mut();
        let order: yrs::ArrayRef = match workbook.get(&txn, "sheetOrder") {
            Some(yrs::Out::YArray(a)) => a,
            other => panic!("expected sheetOrder array, got {:?}", other.is_some()),
        };
        order.push_back(&mut txn, yrs::Any::String(std::sync::Arc::from("sheet-a")));
    }
    let p1 = encode_full_state(&doc_a);

    let doc_b = Doc::new();
    realistic_bootstrap(&doc_b);
    apply_update(&doc_b, &p1).expect("apply ok");

    let len = sheet_order_len(&doc_b);
    assert!(
        len == 0 || len == 1,
        "realistic bootstrap clash visibility is LWW-determined; got len={len}"
    );
}

#[test]
fn provider_replay_production_path() {
    let doc1 = Doc::new();
    root_maps_only_bootstrap(&doc1);
    {
        let workbook = doc1.get_or_insert_map("workbook");
        let mut txn = doc1.transact_mut();
        let order: yrs::ArrayRef = match workbook.get(&txn, "sheetOrder") {
            Some(yrs::Out::YArray(a)) => a,
            _ => workbook.insert(&mut txn, "sheetOrder", yrs::ArrayPrelim::default()),
        };
        order.push_back(&mut txn, yrs::Any::String(std::sync::Arc::from("sheet-a")));
    }
    let p1 = encode_full_state(&doc1);

    let doc2 = Doc::new();
    root_maps_only_bootstrap(&doc2);
    apply_update(&doc2, &p1).expect("apply ok");

    assert_eq!(sheet_order_len(&doc2), 1, "sheet-a should be visible");
}

#[test]
fn provider_replay_root_stores_merge() {
    let doc_a = Doc::new();
    {
        let _workbook = doc_a.get_or_insert_map("workbook");
        let order = doc_a.get_or_insert_array("sheetOrder");
        let mut txn = doc_a.transact_mut();
        order.push_back(&mut txn, yrs::Any::String(std::sync::Arc::from("a")));
    }
    let p1 = encode_full_state(&doc_a);

    let doc_b = Doc::new();
    {
        let _workbook = doc_b.get_or_insert_map("workbook");
        let _order = doc_b.get_or_insert_array("sheetOrder");
    }
    apply_update(&doc_b, &p1).expect("apply ok");

    let order = doc_b.get_or_insert_array("sheetOrder");
    let txn = doc_b.transact();
    assert_eq!(order.len(&txn), 1, "root array should merge");
}

#[test]
fn provider_replay_idempotent_bootstrap_still_clashes() {
    fn idempotent_bootstrap(doc: &Doc) {
        let workbook = doc.get_or_insert_map("workbook");
        let mut txn = doc.transact_mut();
        if workbook.get(&txn, "sheetOrder").is_none() {
            workbook.insert(&mut txn, "sheetOrder", yrs::ArrayPrelim::default());
        }
        if workbook.get(&txn, "workbookSettings").is_none() {
            workbook.insert(
                &mut txn,
                "workbookSettings",
                yrs::MapPrelim::from([] as [(&str, yrs::Any); 0]),
            );
        }
    }

    let doc_a = Doc::new();
    idempotent_bootstrap(&doc_a);
    {
        let workbook = doc_a.get_or_insert_map("workbook");
        let mut txn = doc_a.transact_mut();
        let order: yrs::ArrayRef = match workbook.get(&txn, "sheetOrder") {
            Some(yrs::Out::YArray(a)) => a,
            _ => unreachable!(),
        };
        order.push_back(&mut txn, yrs::Any::String(std::sync::Arc::from("a")));
    }
    let p1 = encode_full_state(&doc_a);

    let doc_b = Doc::new();
    idempotent_bootstrap(&doc_b);
    apply_update(&doc_b, &p1).expect("apply ok");

    let len = sheet_order_len(&doc_b);
    assert!(
        len == 0 || len == 1,
        "idempotent bootstrap remains LWW-determined; got len={len}"
    );
}

#[test]
fn provider_replay_two_root_siblings_documents_yrs_lww_shadow() {
    let doc_a = Doc::new();
    {
        let workbook = doc_a.get_or_insert_map("workbook");
        let mut txn = doc_a.transact_mut();
        let order = workbook.insert(&mut txn, "sheetOrder", yrs::ArrayPrelim::default());
        workbook.insert(
            &mut txn,
            "workbookSettings",
            yrs::MapPrelim::from([] as [(&str, yrs::Any); 0]),
        );
        order.push_back(&mut txn, yrs::Any::String(std::sync::Arc::from("a")));
    }
    let p1 = encode_full_state(&doc_a);

    let doc_b = Doc::new();
    {
        let workbook = doc_b.get_or_insert_map("workbook");
        let mut txn = doc_b.transact_mut();
        workbook.insert(&mut txn, "sheetOrder", yrs::ArrayPrelim::default());
        workbook.insert(
            &mut txn,
            "workbookSettings",
            yrs::MapPrelim::from([] as [(&str, yrs::Any); 0]),
        );
    }
    apply_update(&doc_b, &p1).expect("apply ok");

    let len = sheet_order_len(&doc_b);
    assert!(
        len == 0 || len == 1,
        "yrs Map LWW visible array length should be 0 or 1; got len={len}"
    );
}

#[test]
fn cached_root_mapref_sees_post_apply_merge() {
    let doc_a = Doc::new();
    {
        let workbook = doc_a.get_or_insert_map("workbook");
        let mut txn = doc_a.transact_mut();
        let order = workbook.insert(&mut txn, "sheetOrder", yrs::ArrayPrelim::default());
        order.push_back(&mut txn, yrs::Any::String(std::sync::Arc::from("hello")));
    }
    let p1 = encode_full_state(&doc_a);

    let doc_b = Doc::new();
    let cached_workbook = doc_b.get_or_insert_map("workbook");

    apply_update(&doc_b, &p1).expect("apply ok");

    let txn = doc_b.transact();
    match cached_workbook.get(&txn, "sheetOrder") {
        Some(yrs::Out::YArray(arr)) => {
            assert_eq!(
                arr.len(&txn),
                1,
                "cached workbook MapRef must see sheetOrder merged from apply_update",
            );
        }
        other => panic!(
            "cached workbook MapRef did not see sheetOrder post-apply, got {:?}",
            other.is_some()
        ),
    }
}

#[test]
fn provider_replay_after_independent_bootstrap() {
    let doc_a = Doc::new();
    {
        let workbook = doc_a.get_or_insert_map("workbook");
        let mut txn = doc_a.transact_mut();
        let order = workbook.insert(&mut txn, "sheetOrder", yrs::ArrayPrelim::default());
        order.push_back(&mut txn, yrs::Any::String(std::sync::Arc::from("hello")));
    }
    let p1 = encode_full_state(&doc_a);

    let doc_b = Doc::new();
    {
        let _workbook = doc_b.get_or_insert_map("workbook");
    }

    apply_update(&doc_b, &p1).expect("apply should succeed");

    assert_eq!(sheet_order_len(&doc_b), 1);
    assert_eq!(sheet_order_string(&doc_b, 0), "hello");
}
