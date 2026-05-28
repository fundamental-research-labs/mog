mod support;

use compute_collab::{
    apply_update, decode_state_vector, encode_diff, encode_full_state, encode_state_vector,
};
use support::{doc_with_text, read_text};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, GetString, ReadTxn, Text, Transact, Update};

#[test]
fn state_vector_roundtrip() {
    let doc = doc_with_text("hello");
    let encoded = encode_state_vector(&doc);

    assert!(!encoded.is_empty());
    let sv = decode_state_vector(&encoded).expect("decode should succeed");
    assert_eq!(sv.encode_v1(), encoded);
}

#[test]
fn update_encode_decode_roundtrip() {
    let doc = doc_with_text("roundtrip test");
    let full = encode_full_state(&doc);

    assert!(!full.is_empty());
    let update = Update::decode_v1(&full).expect("update decode should succeed");

    let doc2 = Doc::new();
    {
        let mut txn = doc2.transact_mut();
        txn.apply_update(update).expect("apply should succeed");
    }
    assert_eq!(read_text(&doc2), "roundtrip test");
}

#[test]
fn two_doc_one_way_sync() {
    let doc1 = doc_with_text("one way");
    let doc2 = Doc::new();

    let sv2 = encode_state_vector(&doc2);
    let diff = encode_diff(&doc1, &sv2).expect("encode_diff should succeed");
    apply_update(&doc2, &diff).expect("apply_update should succeed");

    assert_eq!(read_text(&doc2), "one way");
}

#[test]
fn bidirectional_sync() {
    let doc1 = Doc::with_options(yrs::Options {
        client_id: 1,
        ..Default::default()
    });
    let doc2 = Doc::with_options(yrs::Options {
        client_id: 2,
        ..Default::default()
    });

    {
        let text1 = doc1.get_or_insert_text("content");
        let mut txn = doc1.transact_mut();
        text1.push(&mut txn, "Hello");
    }
    {
        let text2 = doc2.get_or_insert_text("content");
        let mut txn = doc2.transact_mut();
        text2.push(&mut txn, "World");
    }

    let sv2 = encode_state_vector(&doc2);
    let diff_1_to_2 = encode_diff(&doc1, &sv2).expect("diff 1->2");
    apply_update(&doc2, &diff_1_to_2).expect("apply 1->2");

    let sv1 = encode_state_vector(&doc1);
    let diff_2_to_1 = encode_diff(&doc2, &sv1).expect("diff 2->1");
    apply_update(&doc1, &diff_2_to_1).expect("apply 2->1");

    let text1 = read_text(&doc1);
    let text2 = read_text(&doc2);
    assert_eq!(text1, text2, "docs must converge after bidirectional sync");
    assert!(text1.contains("Hello"), "merged text must contain Hello");
    assert!(text1.contains("World"), "merged text must contain World");
}

#[test]
fn empty_doc_sync() {
    let doc1 = Doc::new();
    let doc2 = Doc::new();

    let sv2 = encode_state_vector(&doc2);
    let diff = encode_diff(&doc1, &sv2).expect("diff from empty doc");
    apply_update(&doc2, &diff).expect("apply empty diff");

    let full = encode_full_state(&doc1);
    apply_update(&doc2, &full).expect("apply empty full state");
}

#[test]
fn full_state_to_new_doc() {
    let doc1 = doc_with_text("initial data");

    {
        let text = doc1.get_or_insert_text("content");
        let mut txn = doc1.transact_mut();
        text.push(&mut txn, " plus more");
    }

    let full = encode_full_state(&doc1);
    let doc2 = Doc::new();
    apply_update(&doc2, &full).expect("apply full state");

    assert_eq!(read_text(&doc2), "initial data plus more");
}

#[test]
fn concurrent_edits_converge() {
    let doc1 = Doc::with_options(yrs::Options {
        client_id: 10,
        ..Default::default()
    });
    let doc2 = Doc::with_options(yrs::Options {
        client_id: 20,
        ..Default::default()
    });
    let doc3 = Doc::with_options(yrs::Options {
        client_id: 30,
        ..Default::default()
    });

    for (doc, value) in [(&doc1, "A"), (&doc2, "B"), (&doc3, "C")] {
        let text = doc.get_or_insert_text("content");
        let mut txn = doc.transact_mut();
        text.push(&mut txn, value);
    }

    for _ in 0..2 {
        for (src, dst) in [(&doc1, &doc2), (&doc2, &doc3), (&doc3, &doc1)] {
            let sv_dst = encode_state_vector(dst);
            let diff = encode_diff(src, &sv_dst).expect("encode_diff");
            apply_update(dst, &diff).expect("apply_update");
        }
    }

    let t1 = read_text(&doc1);
    let t2 = read_text(&doc2);
    let t3 = read_text(&doc3);

    assert_eq!(t1, t2, "doc1 and doc2 must converge");
    assert_eq!(t2, t3, "doc2 and doc3 must converge");
    assert!(t1.contains('A'), "merged text must contain A");
    assert!(t1.contains('B'), "merged text must contain B");
    assert!(t1.contains('C'), "merged text must contain C");
}

#[test]
fn incremental_sync_sends_only_missing_changes() {
    let doc1 = Doc::with_options(yrs::Options {
        client_id: 100,
        ..Default::default()
    });
    let doc2 = Doc::with_options(yrs::Options {
        client_id: 200,
        ..Default::default()
    });

    {
        let text = doc1.get_or_insert_text("content");
        let mut txn = doc1.transact_mut();
        text.push(&mut txn, "first");
    }
    let sv2 = encode_state_vector(&doc2);
    let diff1 = encode_diff(&doc1, &sv2).expect("diff phase 1");
    apply_update(&doc2, &diff1).expect("apply phase 1");
    assert_eq!(read_text(&doc2), "first");

    {
        let text = doc1.get_or_insert_text("content");
        let mut txn = doc1.transact_mut();
        text.push(&mut txn, " second");
    }
    let sv2_after = encode_state_vector(&doc2);
    let diff2 = encode_diff(&doc1, &sv2_after).expect("diff phase 2");

    let full = encode_full_state(&doc1);
    assert!(
        diff2.len() <= full.len(),
        "incremental diff ({}) should not exceed full state ({})",
        diff2.len(),
        full.len()
    );

    apply_update(&doc2, &diff2).expect("apply phase 2");
    assert_eq!(read_text(&doc2), "first second");
}

#[test]
fn state_vector_advances_after_update() {
    let doc = Doc::new();
    let sv_before = encode_state_vector(&doc);

    {
        let text = doc.get_or_insert_text("content");
        let mut txn = doc.transact_mut();
        text.push(&mut txn, "change");
    }

    let sv_after = encode_state_vector(&doc);
    assert_ne!(
        sv_before, sv_after,
        "state vector must advance after local edit"
    );

    let doc2 = Doc::new();
    let full = encode_full_state(&doc);
    apply_update(&doc2, &full).expect("apply");
    let sv_doc2 = encode_state_vector(&doc2);

    let diff = encode_diff(&doc, &sv_doc2).expect("diff after full sync");
    let new_doc = Doc::new();
    apply_update(&new_doc, &diff).expect("apply empty diff");
    assert_eq!(
        read_text(&new_doc),
        "",
        "diff after full sync should carry no new content"
    );
}

#[test]
fn state_vector_roundtrips_through_diff_apply() {
    let doc1 = Doc::with_options(yrs::Options {
        client_id: 1,
        ..Default::default()
    });
    let doc2 = Doc::with_options(yrs::Options {
        client_id: 2,
        ..Default::default()
    });

    {
        let text = doc1.get_or_insert_text("content");
        let mut txn = doc1.transact_mut();
        text.push(&mut txn, "round-trip");
    }

    let sv2 = encode_state_vector(&doc2);
    let diff = encode_diff(&doc1, &sv2).expect("encode_diff");
    apply_update(&doc2, &diff).expect("apply_update");

    let text2 = doc2.get_or_insert_text("content");
    let txn = doc2.transact();
    assert_eq!(text2.get_string(&txn), "round-trip");

    let sv2_after = encode_state_vector(&doc2);
    let diff_empty = encode_diff(&doc1, &sv2_after).expect("encode_diff after sync");
    let probe = Doc::new();
    apply_update(&probe, &diff_empty).expect("apply empty diff");
    assert_eq!(
        read_text(&probe),
        "",
        "second diff after sync should carry no new content",
    );
}
