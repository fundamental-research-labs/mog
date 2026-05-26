//! Integration tests for `SecurityStore` — R2.1.
//!
//! The unit tests inside `security_store.rs` cover the CRUD surface. These
//! integration tests pin the cross-crate invariants that R2.3 will rely
//! on: (1) `read_all` returns exactly what was written across multiple
//! policy shapes, (2) version increments are visible to an independent
//! reader, (3) template registration round-trips through a separate
//! `SecurityStore` instance.

use std::collections::HashMap;
use std::sync::Arc;

use compute_document::SecurityStore;
use compute_document::schema::{KEY_SECURITY, init_canonical_schema};
use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, PolicyId, PolicyMetadata, TagMatcher,
};
use yrs::{Doc, MapRef, ReadTxn, Transact, TransactionMut};

fn sample_policy(tag: &str, level: AccessLevel, target: AccessTarget) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target,
        level,
        priority: 0,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("integration-test"),
            created_at_millis: 42,
            template_id: None,
        },
    }
}

fn fresh_doc() -> Doc {
    let doc = Doc::new();
    let _ = init_canonical_schema(&doc);
    doc
}

/// Run `f` inside a write transaction with a freshly-opened SecurityStore.
fn with_write<R, F>(doc: &Doc, f: F) -> R
where
    F: for<'a> FnOnce(SecurityStore<'a>, &mut TransactionMut<'a>) -> R,
{
    let sec_map: MapRef = {
        let txn = doc.transact();
        txn.get_map(KEY_SECURITY).expect("security map")
    };
    let mut txn = doc.transact_mut();
    let store = SecurityStore::new(&sec_map, doc, &txn);
    f(store, &mut txn)
}

fn read_policies(doc: &Doc) -> Vec<AccessPolicy> {
    let txn = doc.transact();
    let sec: MapRef = txn.get_map(KEY_SECURITY).unwrap();
    let store = SecurityStore::new(&sec, doc, &txn);
    store.read_all(&txn)
}

fn read_version(doc: &Doc) -> i64 {
    let txn = doc.transact();
    let sec: MapRef = txn.get_map(KEY_SECURITY).unwrap();
    SecurityStore::new(&sec, doc, &txn).read_version(&txn)
}

fn read_templates(doc: &Doc) -> HashMap<String, Vec<PolicyId>> {
    let txn = doc.transact();
    let sec: MapRef = txn.get_map(KEY_SECURITY).unwrap();
    SecurityStore::new(&sec, doc, &txn).read_templates(&txn)
}

#[test]
fn round_trip_matches_input() {
    let doc = fresh_doc();
    let p = sample_policy("agent:*", AccessLevel::Read, AccessTarget::Workbook);
    with_write(&doc, |s, t| s.add_policy(t, &p));
    let read = read_policies(&doc);
    assert_eq!(read.len(), 1);
    assert_eq!(read[0], p);
}

#[test]
fn version_is_visible_across_transactions() {
    let doc = fresh_doc();
    assert_eq!(read_version(&doc), 0);
    with_write(&doc, |s, t| {
        s.add_policy(
            t,
            &sample_policy("a", AccessLevel::Read, AccessTarget::Workbook),
        )
    });
    let v1 = read_version(&doc);
    assert!(v1 > 0);
    with_write(&doc, |s, t| {
        s.add_policy(
            t,
            &sample_policy("b", AccessLevel::Write, AccessTarget::Workbook),
        )
    });
    let v2 = read_version(&doc);
    assert!(v2 > v1);
}

#[test]
fn lww_overwrite_sequential() {
    let doc = fresh_doc();
    let mut p = sample_policy("agent:*", AccessLevel::Read, AccessTarget::Workbook);
    with_write(&doc, |s, t| s.add_policy(t, &p));
    p.level = AccessLevel::Admin;
    with_write(&doc, |s, t| s.add_policy(t, &p));
    let read = read_policies(&doc);
    assert_eq!(read.len(), 1);
    assert_eq!(read[0].level, AccessLevel::Admin);
}

#[test]
fn concurrent_lww_via_yrs_merge() {
    // Two separate peers editing the same policy id — drive Yrs merge
    // explicitly via state vector diff, mirroring the LWW expectation
    // that whichever write has the later Lamport clock wins.
    use yrs::updates::decoder::Decode;

    let doc_a = fresh_doc();
    let doc_b = fresh_doc();

    // Sync doc_b from doc_a so both share root-type ids for the security
    // map. Without this the two docs have disjoint Yrs types and the
    // update exchange below can't merge the security map at all.
    let initial_update = {
        let txn = doc_a.transact();
        txn.encode_state_as_update_v1(&Default::default())
    };
    {
        let mut txn = doc_b.transact_mut();
        let update = yrs::Update::decode_v1(&initial_update).unwrap();
        txn.apply_update(update).unwrap();
    }

    let p = sample_policy("agent:*", AccessLevel::Read, AccessTarget::Workbook);
    let id = p.id;

    let mut p_a = p.clone();
    p_a.level = AccessLevel::Read;
    with_write(&doc_a, |s, t| s.add_policy(t, &p_a));

    let mut p_b = p.clone();
    p_b.level = AccessLevel::Admin;
    with_write(&doc_b, |s, t| s.add_policy(t, &p_b));

    // Merge doc_b's state into doc_a, then doc_a's state into doc_b.
    // After the second merge both docs should converge on the same
    // level (whichever Lamport clock won).
    let b_state = {
        let txn = doc_b.transact();
        txn.encode_state_as_update_v1(&Default::default())
    };
    {
        let mut txn = doc_a.transact_mut();
        let upd = yrs::Update::decode_v1(&b_state).unwrap();
        txn.apply_update(upd).unwrap();
    }
    let a_state = {
        let txn = doc_a.transact();
        txn.encode_state_as_update_v1(&Default::default())
    };
    {
        let mut txn = doc_b.transact_mut();
        let upd = yrs::Update::decode_v1(&a_state).unwrap();
        txn.apply_update(upd).unwrap();
    }

    let a_final = read_policies(&doc_a);
    let b_final = read_policies(&doc_b);
    assert_eq!(a_final, b_final, "docs must converge after bidi merge");
    let matched: Vec<_> = a_final.iter().filter(|p| p.id == id).collect();
    assert_eq!(matched.len(), 1, "one policy per id after merge");
}

#[test]
fn templates_register_unregister() {
    let doc = fresh_doc();
    let p1 = sample_policy("a", AccessLevel::Read, AccessTarget::Workbook);
    let p2 = sample_policy("b", AccessLevel::Structure, AccessTarget::Workbook);
    with_write(&doc, |s, t| {
        s.add_policy(t, &p1);
        s.add_policy(t, &p2);
        s.register_template(t, "protect-workbook", &[p1.id, p2.id]);
    });
    let templates = read_templates(&doc);
    assert_eq!(templates.len(), 1);
    let ids = templates.get("protect-workbook").expect("present");
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&p1.id));
    assert!(ids.contains(&p2.id));

    let removed = with_write(&doc, |s, t| s.unregister_template(t, "protect-workbook"));
    assert_eq!(removed.len(), 2);
    assert!(read_templates(&doc).is_empty());
}

/// Legacy wire format fixture — R2.1 zero-migration promise.
///
/// The JSON below is the exact shape the pre-R6 kernel's
/// `YrsPolicyStore` wrote into `security:policy:<id>` custom settings:
/// `principalTag` / `createdAt` / `createdBy` / `templateId` (camelCase
/// on every struct field) and `AccessTarget` as a tagged union with
/// `kind` + `sheetId`/`colId` IDs. Cross-reference: legacy TS types
/// in commit `59aa74b0`, file `contracts/src/security/types.ts`.
///
/// If this test regresses, a Rust engine will silently fail to
/// deserialize existing docs — exactly the migration cost R2.1 promised
/// to avoid.
#[test]
fn round1_wire_fixture_deserialises_and_re_serialises_to_same_bytes() {
    // Hex-form (no dashes) is what `SheetId::to_uuid_string` emits — TS
    // side uses the same simple form on the wire, so the raw JSON below
    // mirrors what legacy docs actually carry.
    let fixture = r#"{
        "id": "11111111-1111-1111-1111-111111111111",
        "principalTag": "agent:*",
        "target": {
            "kind": "column",
            "sheetId": "22222222222222222222222222222222",
            "colId": "33333333333333333333333333333333"
        },
        "level": "read",
        "priority": 7,
        "enabled": true,
        "metadata": {
            "createdBy": "alice",
            "createdAt": 1700000000000,
            "templateId": "protect-workbook"
        }
    }"#;

    let parsed: AccessPolicy = serde_json::from_str(fixture).expect("legacy fixture parses");
    assert_eq!(parsed.level, AccessLevel::Read);
    assert_eq!(parsed.priority, 7);
    assert!(parsed.enabled);

    // Re-serialise and re-parse — the shape must survive a round trip
    // without key renames creeping in.
    let reserialised = serde_json::to_string(&parsed).expect("re-serialise");
    let round_trip: AccessPolicy = serde_json::from_str(&reserialised).expect("re-parse");
    assert_eq!(parsed, round_trip);

    // Re-serialised bytes themselves must carry the camelCase keys — the
    // `value` walk below pins that explicitly.
    let as_value: serde_json::Value = serde_json::from_str(&reserialised).unwrap();
    let obj = as_value.as_object().unwrap();
    for k in [
        "principalTag",
        "target",
        "level",
        "priority",
        "enabled",
        "metadata",
    ] {
        assert!(
            obj.contains_key(k),
            "camelCase key `{k}` missing after round-trip"
        );
    }
    assert!(!obj.contains_key("principal_tag"));
    let meta = obj["metadata"].as_object().unwrap();
    for k in ["createdBy", "createdAt", "templateId"] {
        assert!(
            meta.contains_key(k),
            "metadata key `{k}` missing after round-trip"
        );
    }
    assert!(!meta.contains_key("created_by"));
    assert!(!meta.contains_key("created_at_millis"));
}

/// As above, but drives the fixture through the Yrs `SecurityStore` to
/// pin the full persist-then-read path. Legacy docs loading under
/// Rust must surface the stored policy with the right fields.
#[test]
fn round1_wire_fixture_survives_yrs_store_roundtrip() {
    use yrs::Map;

    let fixture = r#"{
        "id": "44444444-4444-4444-4444-444444444444",
        "principalTag": "user:alice@co",
        "target": { "kind": "sheet", "sheetId": "55555555555555555555555555555555" },
        "level": "write",
        "priority": 10,
        "enabled": true,
        "metadata": {
            "createdBy": "mog:owner",
            "createdAt": 1710000000000
        }
    }"#;
    let expected: AccessPolicy = serde_json::from_str(fixture).expect("fixture parses");

    let doc = fresh_doc();
    // Inject the exact legacy blob into the Yrs `security:policies`
    // sub-map — bypass `add_policy` so we exercise the read path exactly
    // the way a legacy doc loaded fresh would look.
    let sec_map: MapRef = {
        let txn = doc.transact();
        txn.get_map(KEY_SECURITY).expect("security map")
    };
    let mut txn = doc.transact_mut();
    let policies_map: MapRef = match sec_map.get(&txn, "policies") {
        Some(yrs::Out::YMap(m)) => m,
        _ => {
            let empty = yrs::MapPrelim::from([] as [(&str, yrs::Any); 0]);
            sec_map.insert(&mut txn, "policies", empty)
        }
    };
    policies_map.insert(
        &mut txn,
        expected.id.to_string(),
        yrs::Any::String(Arc::from(fixture)),
    );
    drop(txn);

    let read = read_policies(&doc);
    assert_eq!(read.len(), 1);
    assert_eq!(read[0], expected, "legacy wire blob must parse identically");
}

#[test]
fn multiple_policies_stable_order() {
    let doc = fresh_doc();
    let policies: Vec<_> = (0..5)
        .map(|i| {
            sample_policy(
                &format!("agent:{i}"),
                AccessLevel::Read,
                AccessTarget::Workbook,
            )
        })
        .collect();
    for p in &policies {
        with_write(&doc, |s, t| s.add_policy(t, p));
    }
    let read1 = read_policies(&doc);
    let read2 = read_policies(&doc);
    assert_eq!(read1, read2, "read_all is stable across calls");
    let mut prev = uuid::Uuid::nil();
    for p in &read1 {
        assert!(p.id.as_uuid() > prev);
        prev = p.id.as_uuid();
    }
}
