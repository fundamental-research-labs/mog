use super::fixtures::*;
use crate::SyncCoordinator;

#[test]
fn two_participants_sync() {
    let mut coord = SyncCoordinator::new();

    // Alice joins, edits, pushes
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    insert_into_map(&doc_a, "sheet", "A1", "42");
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Bob joins, pulls
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Bob should already have Alice's data from the join full_state
    assert_eq!(read_map_key(&doc_b, "sheet", "A1").as_deref(), Some("42"));
}

#[test]
fn bidirectional_sync() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Alice edits and pushes
    insert_into_map(&doc_a, "sheet", "A1", "alice_val");
    let pr_a = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr_a.server_diff).unwrap();

    // Bob edits and pushes
    insert_into_map(&doc_b, "sheet", "B1", "bob_val");
    let pr_b = do_push(&mut coord, "bob", &doc_b, &[]).unwrap();
    compute_collab::apply_update(&doc_b, &pr_b.server_diff).unwrap();

    // Alice pulls to get Bob's changes
    do_pull(&coord, "alice", &doc_a);

    // Both should see both values
    assert_eq!(
        read_map_key(&doc_a, "sheet", "A1").as_deref(),
        Some("alice_val")
    );
    assert_eq!(
        read_map_key(&doc_a, "sheet", "B1").as_deref(),
        Some("bob_val")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("alice_val")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "B1").as_deref(),
        Some("bob_val")
    );
}

#[test]
fn three_way_convergence() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);
    let jr_c = join(&mut coord, "carol");
    let doc_c = client_doc_from_join(&jr_c);

    // Each participant edits a different key
    insert_into_map(&doc_a, "sheet", "A1", "from_alice");
    insert_into_map(&doc_b, "sheet", "B1", "from_bob");
    insert_into_map(&doc_c, "sheet", "C1", "from_carol");

    // All push
    let pr_a = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr_a.server_diff).unwrap();
    let pr_b = do_push(&mut coord, "bob", &doc_b, &[]).unwrap();
    compute_collab::apply_update(&doc_b, &pr_b.server_diff).unwrap();
    let pr_c = do_push(&mut coord, "carol", &doc_c, &[]).unwrap();
    compute_collab::apply_update(&doc_c, &pr_c.server_diff).unwrap();

    // All pull to converge
    do_pull(&coord, "alice", &doc_a);
    do_pull(&coord, "bob", &doc_b);
    do_pull(&coord, "carol", &doc_c);

    // Verify convergence: all three see all three values
    for (name, doc) in [("alice", &doc_a), ("bob", &doc_b), ("carol", &doc_c)] {
        assert_eq!(
            read_map_key(doc, "sheet", "A1").as_deref(),
            Some("from_alice"),
            "{name} missing A1"
        );
        assert_eq!(
            read_map_key(doc, "sheet", "B1").as_deref(),
            Some("from_bob"),
            "{name} missing B1"
        );
        assert_eq!(
            read_map_key(doc, "sheet", "C1").as_deref(),
            Some("from_carol"),
            "{name} missing C1"
        );
    }
}

#[test]
fn push_returns_server_diff() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Alice pushes first
    insert_into_map(&doc_a, "sheet", "A1", "alice_data");
    do_push(&mut coord, "alice", &doc_a, &[]).unwrap();

    // Bob pushes -- the server_diff should contain Alice's changes
    insert_into_map(&doc_b, "sheet", "B1", "bob_data");
    let pr_b = do_push(&mut coord, "bob", &doc_b, &[]).unwrap();

    // Apply server_diff to Bob's doc
    compute_collab::apply_update(&doc_b, &pr_b.server_diff).unwrap();

    // Bob should now see Alice's data via the server_diff
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("alice_data")
    );
}

#[test]
fn pull_when_up_to_date() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    insert_into_map(&doc_a, "sheet", "A1", "data");
    let pr = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr.server_diff).unwrap();

    // Pull when already up to date — applying the diff should not change data
    let sv = compute_collab::encode_state_vector(&doc_a);
    let diff = coord.pull(&"alice".to_string(), &sv).unwrap();
    let doc_before = client_doc_from_join(&jr_a);
    compute_collab::apply_update(&doc_before, &pr.server_diff).unwrap();

    // Apply the "empty" diff
    compute_collab::apply_update(&doc_a, &diff).unwrap();

    // Data should be unchanged
    assert_eq!(
        read_map_key(&doc_a, "sheet", "A1").as_deref(),
        Some("data"),
        "pulling when up to date should not change data"
    );
}

#[test]
fn push_empty_update() {
    let mut coord = SyncCoordinator::new();
    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);

    // Push without making any changes — empty updates are valid in Yrs
    let result = do_push(&mut coord, "alice", &doc_a, &[]);
    assert!(
        result.is_ok(),
        "pushing an empty update should succeed: {result:?}"
    );
}

#[test]
fn multiple_sequential_pushes() {
    let mut coord = SyncCoordinator::new();

    let jr_a = join(&mut coord, "alice");
    let doc_a = client_doc_from_join(&jr_a);
    let jr_b = join(&mut coord, "bob");
    let doc_b = client_doc_from_join(&jr_b);

    // Push 1
    insert_into_map(&doc_a, "sheet", "A1", "first");
    let pr1 = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr1.server_diff).unwrap();
    do_pull(&coord, "bob", &doc_b);
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("first")
    );

    // Push 2
    insert_into_map(&doc_a, "sheet", "A2", "second");
    let pr2 = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr2.server_diff).unwrap();
    do_pull(&coord, "bob", &doc_b);
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("first")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A2").as_deref(),
        Some("second")
    );

    // Push 3
    insert_into_map(&doc_a, "sheet", "A3", "third");
    let pr3 = do_push(&mut coord, "alice", &doc_a, &[]).unwrap();
    compute_collab::apply_update(&doc_a, &pr3.server_diff).unwrap();
    do_pull(&coord, "bob", &doc_b);
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A1").as_deref(),
        Some("first")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A2").as_deref(),
        Some("second")
    );
    assert_eq!(
        read_map_key(&doc_b, "sheet", "A3").as_deref(),
        Some("third")
    );
}
