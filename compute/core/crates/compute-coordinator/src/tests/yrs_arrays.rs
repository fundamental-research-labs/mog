use super::fixtures::{client_doc_from_join, do_pull, do_push, join};
use crate::SyncCoordinator;
use yrs::{Array, ArrayPrelim, Doc, Map, MapRef, Transact};

/// Helper: create a canonical schema on a client doc (simulates client-side init_canonical_schema).
/// Creates a sheets map with a single "Sheet1" containing a colOrder YArray with `num_cols` entries.
fn create_client_schema(doc: &Doc, num_cols: u32) {
    let sheets: MapRef = doc.get_or_insert_map("sheets");
    let mut txn = doc.transact_mut();
    let sheet_map = sheets.insert(&mut txn, "Sheet1", yrs::MapPrelim::default());
    let col_order = sheet_map.insert(&mut txn, "colOrder", ArrayPrelim::default());
    for i in 0..num_cols {
        col_order.push_back(&mut txn, format!("col_{}", i));
    }
}

/// Helper: get the coordinator's doc as a fresh Doc (since coord.doc is private).
fn coord_state_as_doc(coord: &SyncCoordinator) -> Doc {
    let doc = Doc::new();
    compute_collab::apply_update(&doc, &coord.full_state()).unwrap();
    doc
}

/// Helper: read the colOrder YArray length for the first sheet in a doc.
fn read_col_order_len(doc: &Doc) -> u32 {
    let sheets: MapRef = doc.get_or_insert_map("sheets");
    let txn = doc.transact();
    // Find the first sheet key
    for (key, value) in sheets.iter(&txn) {
        if let yrs::Out::YMap(sheet_map) = value {
            if let Some(yrs::Out::YArray(arr)) = sheet_map.get(&txn, "colOrder") {
                return arr.len(&txn);
            }
        }
        let _ = key; // use the first sheet
        break;
    }
    0
}

/// Helper: push_back a value to the colOrder YArray of the first sheet in a doc.
fn push_col_order(doc: &Doc, value: &str) {
    let sheets: MapRef = doc.get_or_insert_map("sheets");
    let mut txn = doc.transact_mut();
    for (_key, val) in sheets.iter(&txn) {
        if let yrs::Out::YMap(sheet_map) = val {
            if let Some(yrs::Out::YArray(arr)) = sheet_map.get(&txn, "colOrder") {
                arr.push_back(&mut txn, value);
                return;
            }
        }
        break;
    }
}

#[test]
fn col_order_push_back_syncs_to_coordinator() {
    // This test reproduces the AA+ column sync bug:
    // When an engine auto-expands colOrder (push_back to YArray),
    // does the expansion survive a push→pull cycle?
    //
    // The coordinator starts empty — the first client seeds the schema
    // (this matches production: init_canonical_schema runs client-side).

    let mut coord = SyncCoordinator::empty();

    // Coordinator starts empty — no schema pre-initialized
    let coord_doc_initial = coord_state_as_doc(&coord);
    let coord_cols_initial = read_col_order_len(&coord_doc_initial);
    assert_eq!(
        coord_cols_initial, 0,
        "coordinator should start empty (no pre-initialized schema)"
    );

    // Alice joins and gets the (empty) full state, then creates schema client-side
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    create_client_schema(&doc_a, 26);
    assert_eq!(
        read_col_order_len(&doc_a),
        26,
        "alice should start with 26 cols after client-side schema init"
    );

    // Alice pushes her schema to the coordinator (first client seeds it)
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Alice pushes back 2 new entries to colOrder (simulating auto-expansion to col 28)
    push_col_order(&doc_a, "new_col_26");
    push_col_order(&doc_a, "new_col_27");
    assert_eq!(
        read_col_order_len(&doc_a),
        28,
        "alice should now have 28 cols locally"
    );

    // Alice pushes to coordinator
    let push_result = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    assert!(
        push_result.server_diff.len() <= 2,
        "no server diff expected (alice is first)"
    );

    // Check coordinator's colOrder length (via full_state → fresh doc)
    let coord_doc_after = coord_state_as_doc(&coord);
    let coord_cols_after = read_col_order_len(&coord_doc_after);
    assert_eq!(
        coord_cols_after, 28,
        "coordinator should have 28 colOrder entries after alice's push, but got {}",
        coord_cols_after
    );

    // Bob joins and should see 28 columns
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);
    assert_eq!(
        read_col_order_len(&doc_b),
        28,
        "bob should see 28 cols after joining"
    );
}

#[test]
fn col_order_push_back_syncs_via_pull() {
    // Variant: alice pushes colOrder expansion, bob pulls it.
    // Coordinator starts empty — first client seeds schema.

    let mut coord = SyncCoordinator::empty();

    // Alice joins, creates schema client-side, and pushes to seed coordinator
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    create_client_schema(&doc_a, 26);
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Bob joins and gets the seeded schema from coordinator
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Both have 26 cols
    assert_eq!(read_col_order_len(&doc_a), 26);
    assert_eq!(read_col_order_len(&doc_b), 26);

    // Alice expands colOrder to 28
    push_col_order(&doc_a, "col_26");
    push_col_order(&doc_a, "col_27");
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Bob pulls
    do_pull(&coord, "bob", &doc_b);

    assert_eq!(
        read_col_order_len(&doc_b),
        28,
        "bob should have 28 cols after pulling alice's expansion"
    );
}

/// Minimal pure-Yrs test: push_back to a nested YArray, sync via diff.
/// No coordinator, no schema — just raw Yrs operations.
#[test]
fn yrs_nested_yarray_push_back_syncs() {
    // Doc A: create a map containing a YArray with 3 entries
    let doc_a = Doc::new();
    let root = doc_a.get_or_insert_map("root");
    {
        let mut txn = doc_a.transact_mut();
        let arr = root.insert(&mut txn, "arr", ArrayPrelim::default());
        arr.push_back(&mut txn, "a");
        arr.push_back(&mut txn, "b");
        arr.push_back(&mut txn, "c");
    }

    // Doc B: created from Doc A's state
    let sv_a = compute_collab::encode_full_state(&doc_a);
    let doc_b = Doc::new();
    compute_collab::apply_update(&doc_b, &sv_a).unwrap();

    // Verify Doc B has 3 entries
    {
        let root_b = doc_b.get_or_insert_map("root");
        let txn = doc_b.transact();
        let arr = root_b.get(&txn, "arr").unwrap();
        if let yrs::Out::YArray(arr) = arr {
            assert_eq!(arr.len(&txn), 3, "doc_b should have 3 entries");
        } else {
            panic!("expected YArray");
        }
    }

    // Doc B pushes back 2 new entries
    {
        let root_b = doc_b.get_or_insert_map("root");
        let mut txn = doc_b.transact_mut();
        let arr = root_b.get(&txn, "arr").unwrap();
        if let yrs::Out::YArray(arr) = arr {
            arr.push_back(&mut txn, "d");
            arr.push_back(&mut txn, "e");
        }
    }

    // Encode diff from Doc B vs Doc A's state vector
    let sv_a_vec = compute_collab::encode_state_vector(&doc_a);
    let diff = compute_collab::encode_diff(&doc_b, &sv_a_vec).unwrap();
    assert!(
        diff.len() > 2,
        "diff should be non-trivial: {} bytes",
        diff.len()
    );

    // Apply diff to Doc A
    compute_collab::apply_update(&doc_a, &diff).unwrap();

    // Doc A should now have 5 entries
    {
        let txn = doc_a.transact();
        let arr = root.get(&txn, "arr").unwrap();
        if let yrs::Out::YArray(arr) = arr {
            assert_eq!(
                arr.len(&txn),
                5,
                "doc_a should have 5 entries after applying doc_b's diff, got {}",
                arr.len(&txn)
            );
        }
    }
}
