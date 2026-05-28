use compute_collab::{apply_update, encode_full_state, flush_undo_capture};
use std::collections::HashSet;
use std::sync::Arc;
use yrs::sync::Clock;
use yrs::undo::{Options as UndoOptions, UndoManager};
use yrs::{Doc, Map, Origin, Transact};

#[test]
fn flush_undo_capture_breaks_merge_window() {
    struct StepClock(std::sync::atomic::AtomicU64);
    impl Clock for StepClock {
        fn now(&self) -> u64 {
            self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1
        }
    }

    let user_origin: &[u8] = b"user";
    let doc = Doc::new();
    let map = doc.get_or_insert_map("cells");
    let mut tracked = HashSet::new();
    tracked.insert(Origin::from(user_origin));
    let opts = UndoOptions {
        capture_timeout_millis: 100,
        tracked_origins: tracked,
        capture_transaction: None,
        timestamp: Arc::new(StepClock(std::sync::atomic::AtomicU64::new(0))) as Arc<dyn Clock>,
    };
    let mut mgr: UndoManager<()> = UndoManager::with_scope_and_options(&doc, &map, opts);

    {
        let mut txn = doc.transact_mut_with(user_origin);
        map.insert(&mut txn, "A1", "first");
    }
    assert_eq!(mgr.undo_stack().len(), 1);

    {
        let mut txn = doc.transact_mut_with(user_origin);
        map.insert(&mut txn, "A2", "second");
    }
    assert_eq!(
        mgr.undo_stack().len(),
        1,
        "without flush, consecutive commits inside the merge window extend the last item",
    );

    flush_undo_capture(&mut mgr);

    {
        let mut txn = doc.transact_mut_with(user_origin);
        map.insert(&mut txn, "A3", "third");
    }
    assert_eq!(
        mgr.undo_stack().len(),
        2,
        "flush_undo_capture must force the next commit to start a fresh stack item",
    );
}

#[test]
fn flush_undo_capture_makes_entries_visible_to_full_state() {
    struct ZeroClock;
    impl Clock for ZeroClock {
        fn now(&self) -> u64 {
            0
        }
    }

    let user_origin: &[u8] = b"user";
    let doc = Doc::new();
    let map = doc.get_or_insert_map("cells");
    let mut tracked = HashSet::new();
    tracked.insert(Origin::from(user_origin));
    let opts = UndoOptions {
        capture_timeout_millis: 1_000,
        tracked_origins: tracked,
        capture_transaction: None,
        timestamp: Arc::new(ZeroClock) as Arc<dyn Clock>,
    };
    let mut mgr: UndoManager<()> = UndoManager::with_scope_and_options(&doc, &map, opts);

    {
        let mut txn = doc.transact_mut_with(user_origin);
        map.insert(&mut txn, "A1", "in-flight");
    }

    flush_undo_capture(&mut mgr);

    let full = encode_full_state(&doc);
    let fresh = Doc::new();
    apply_update(&fresh, &full).expect("apply full state");
    let fresh_map = fresh.get_or_insert_map("cells");
    let txn = fresh.transact();
    assert!(
        fresh_map.get(&txn, "A1").is_some(),
        "post-flush encode_full_state must include the journal entry",
    );
}

#[test]
fn undo_round_trip_through_flush_encode_apply() {
    struct ZeroClock;
    impl Clock for ZeroClock {
        fn now(&self) -> u64 {
            0
        }
    }

    let user_origin: &[u8] = b"user";
    let doc = Doc::new();
    let map = doc.get_or_insert_map("cells");
    let mut tracked = HashSet::new();
    tracked.insert(Origin::from(user_origin));
    let opts = UndoOptions {
        capture_timeout_millis: 1_000,
        tracked_origins: tracked,
        capture_transaction: None,
        timestamp: Arc::new(ZeroClock) as Arc<dyn Clock>,
    };
    let mut mgr: UndoManager<()> = UndoManager::with_scope_and_options(&doc, &map, opts);

    {
        let mut txn = doc.transact_mut_with(user_origin);
        map.insert(&mut txn, "A1", "user-edit");
    }
    assert!(mgr.can_undo(), "edit was tracked");

    flush_undo_capture(&mut mgr);
    let snapshot = encode_full_state(&doc);

    let fresh_doc = Doc::new();
    let fresh_map = fresh_doc.get_or_insert_map("cells");
    apply_update(&fresh_doc, &snapshot).expect("hydrate from snapshot");
    let txn = fresh_doc.transact();
    assert!(
        fresh_map.get(&txn, "A1").is_some(),
        "hydrated doc must contain the edit",
    );
}
