use compute_collab::{
    apply_update, encode_diff, encode_full_state, encode_state_vector, subscribe_update_v1,
};
use std::sync::{Arc, Mutex};
use yrs::{Doc, GetString, Map, Text, Transact};

#[test]
fn subscribe_receives_every_update() {
    let doc = Doc::new();
    let captured: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_for_cb = Arc::clone(&captured);
    let _sub = subscribe_update_v1(&doc, move |bytes| {
        captured_for_cb.lock().unwrap().push(bytes.to_vec());
    });

    for value in ["a", "b", "c"] {
        let text = doc.get_or_insert_text("content");
        let mut txn = doc.transact_mut();
        text.push(&mut txn, value);
    }

    let updates = captured.lock().unwrap().clone();
    assert_eq!(
        updates.len(),
        3,
        "subscribe_update_v1 must fire exactly once per commit",
    );

    let replay = Doc::new();
    for update in &updates {
        apply_update(&replay, update).expect("replay each update");
    }
    let text = replay.get_or_insert_text("content");
    let txn = replay.transact();
    assert_eq!(text.get_string(&txn), "abc");
}

#[test]
fn subscribe_bulk_transaction_fires_once() {
    let doc = Doc::new();
    let map = doc.get_or_insert_map("cells");
    let captured: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_for_cb = Arc::clone(&captured);
    let _sub = subscribe_update_v1(&doc, move |bytes| {
        captured_for_cb.lock().unwrap().push(bytes.to_vec());
    });

    {
        let mut txn = doc.transact_mut();
        for i in 0..10_000u32 {
            let key: Arc<str> = Arc::from(format!("cell_{i}").as_str());
            map.insert(&mut txn, key, "v");
        }
    }

    let updates = captured.lock().unwrap().clone();
    assert_eq!(
        updates.len(),
        1,
        "bulk transaction with 10K mutations must fire callback exactly once",
    );

    let replay = Doc::new();
    apply_update(&replay, &updates[0]).expect("replay bulk update");
    let replay_map = replay.get_or_insert_map("cells");
    let txn = replay.transact();
    assert_eq!(replay_map.len(&txn), 10_000);
}

#[test]
fn subscribe_does_not_fire_on_readonly_ops() {
    let doc = Doc::new();
    {
        let text = doc.get_or_insert_text("content");
        let mut txn = doc.transact_mut();
        text.push(&mut txn, "data");
    }

    let fire_count: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
    let fire_count_for_cb = Arc::clone(&fire_count);
    let _sub = subscribe_update_v1(&doc, move |_bytes| {
        *fire_count_for_cb.lock().unwrap() += 1;
    });

    let _sv = encode_state_vector(&doc);
    let _full = encode_full_state(&doc);
    let _diff = encode_diff(&doc, &encode_state_vector(&doc)).unwrap();

    assert_eq!(
        *fire_count.lock().unwrap(),
        0,
        "read-only ops must not fire the update_v1 callback",
    );
}
