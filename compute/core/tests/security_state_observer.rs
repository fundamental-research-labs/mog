//! Observer wiring + seed-on-load invariants for `SecurityState` (R2.3).
//!
//! Pins down two invariants:
//! 1. A snapshot loaded from Yrs state that already contains policies
//!    arrives with `active == true` without any further mutation. This
//!    is the "seed on load" behaviour from ARCHITECTURE.md §6.1.
//! 2. A write to the `security` map through the typed `SecurityStore`
//!    propagates through the Yrs `observe_deep` subscription, rebuilds
//!    the `PolicyEngine`, and flips `active` to `true`.

use std::sync::Arc;

use compute_core::storage::engine::YrsComputeEngine;
use compute_document::SecurityStore;
use compute_document::schema::KEY_SECURITY;
use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, PolicyId, PolicyMetadata, TagMatcher,
};
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};
use yrs::{MapRef, ReadTxn, Transact};

const SHEET1_UUID: &str = "22222222-2222-2222-2222-222222222222";

fn fresh_engine() -> YrsComputeEngine {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 5,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    engine
}

fn sample_policy() -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse("agent:*"),
        target: AccessTarget::Workbook,
        level: AccessLevel::Read,
        priority: 0,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("observer-test"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

#[test]
fn empty_engine_is_inactive() {
    let engine = fresh_engine();
    assert!(!engine.security().is_active());
}

#[test]
fn write_through_yrs_flips_active_via_observer() {
    let engine = fresh_engine();
    assert!(!engine.security().is_active());
    let v0 = engine.security().policy_version();

    let doc = engine.storage().doc().clone();
    let sec_map: MapRef = {
        let txn = doc.transact();
        txn.get_map(KEY_SECURITY).expect("sec map")
    };
    {
        let mut txn = doc.transact_mut();
        let store = SecurityStore::new(&sec_map, &doc, &txn);
        store.add_policy(&mut txn, &sample_policy());
    }

    // The Yrs `observe_deep` callback runs synchronously at txn commit,
    // so by the time `transact_mut` returns the observer has already
    // called `reload_policies_from_yrs`.
    assert!(
        engine.security().is_active(),
        "observer must flip active on policy add"
    );
    assert!(
        engine.security().policy_version() > v0,
        "observer must bump policy_version"
    );
}

#[test]
fn remove_last_policy_flips_active_false() {
    let engine = fresh_engine();
    let doc = engine.storage().doc().clone();
    let sec_map: MapRef = {
        let txn = doc.transact();
        txn.get_map(KEY_SECURITY).expect("sec map")
    };
    let p = sample_policy();
    let pid = p.id;
    {
        let mut txn = doc.transact_mut();
        SecurityStore::new(&sec_map, &doc, &txn).add_policy(&mut txn, &p);
    }
    assert!(engine.security().is_active());
    {
        let mut txn = doc.transact_mut();
        SecurityStore::new(&sec_map, &doc, &txn).remove_policy(&mut txn, pid);
    }
    assert!(
        !engine.security().is_active(),
        "removing the last policy must flip active back to false"
    );
}

/// Remote-CRDT-sync smoke test for R2.3 step 5 (`PoliciesReloaded`).
///
/// Two engines, two separate Yrs docs: the observer on engine B must
/// fire when engine A's security map state is applied. SDK consumers
/// that poll `wb_security_drain_events` need this event — otherwise
/// they have no way of learning a remote peer just changed policies.
///
/// The test also pins the emission ordering: reading
/// `engine.security().is_active()` after observing the event returns
/// the new value, because `publish_policies` pushes the event AFTER
/// the `ArcSwap` + `active` stores complete.
#[test]
fn remote_sync_emits_policies_reloaded_on_receiver() {
    use yrs::updates::decoder::Decode;
    use yrs::updates::encoder::Encode as _;

    let engine_a = fresh_engine();
    let engine_b = fresh_engine();

    // Sync root-type ids so Yrs merge sees the same security MapRef
    // across both docs — without this, state-vector diffs land in
    // disjoint map trees and the observer on B never fires.
    let initial_state = {
        let txn = engine_a.storage().doc().transact();
        txn.encode_state_as_update_v1(&Default::default())
    };
    {
        let mut txn = engine_b.storage().doc().transact_mut();
        txn.apply_update(yrs::Update::decode_v1(&initial_state).unwrap())
            .unwrap();
    }

    // B starts empty.
    let _ = engine_b.wb_security_drain_events(); // flush any seed events
    let b_version_before = engine_b.security().policy_version();

    // Write on A.
    {
        let doc_a = engine_a.storage().doc().clone();
        let sec_map: MapRef = {
            let txn = doc_a.transact();
            txn.get_map(KEY_SECURITY).expect("sec map")
        };
        let mut txn = doc_a.transact_mut();
        SecurityStore::new(&sec_map, &doc_a, &txn).add_policy(&mut txn, &sample_policy());
    }

    // Send A's state to B.
    let update_from_a = {
        let txn = engine_a.storage().doc().transact();
        txn.encode_state_as_update_v1(&Default::default())
    };
    {
        let mut txn = engine_b.storage().doc().transact_mut();
        txn.apply_update(yrs::Update::decode_v1(&update_from_a).unwrap())
            .unwrap();
    }

    // B's observer must have fired during the commit of the
    // `apply_update` txn; engine.active and policy_version must be up
    // to date, and `wb_security_drain_events` must return at least one
    // `PoliciesReloaded` event covering the transition.
    assert!(
        engine_b.security().is_active(),
        "remote sync must activate the receiver"
    );
    assert!(engine_b.security().policy_version() > b_version_before);

    let events = engine_b.wb_security_drain_events();
    let reloaded = events
        .iter()
        .find(|e| matches!(e, compute_security::SecurityEvent::PoliciesReloaded { .. }));
    assert!(
        reloaded.is_some(),
        "receiver must emit PoliciesReloaded on remote CRDT sync — got {events:?}"
    );
    if let Some(compute_security::SecurityEvent::PoliciesReloaded {
        policy_version_after,
        active,
        ..
    }) = reloaded
    {
        assert!(
            *active,
            "PoliciesReloaded.active must reflect the post-publish flag"
        );
        assert_eq!(
            *policy_version_after,
            engine_b.security().policy_version(),
            "policy_version_after must match the engine's live counter after emission"
        );
    }
}

#[test]
fn seed_on_load_activates_when_snapshot_has_policy() {
    // Build an engine, add a policy, encode to Yrs state, rehydrate —
    // the rehydrated engine must be `active` on the first call,
    // without any further mutation to drive an observer event.
    let engine = fresh_engine();
    let doc = engine.storage().doc().clone();
    let sec_map: MapRef = {
        let txn = doc.transact();
        txn.get_map(KEY_SECURITY).expect("sec map")
    };
    {
        let mut txn = doc.transact_mut();
        SecurityStore::new(&sec_map, &doc, &txn).add_policy(&mut txn, &sample_policy());
    }
    assert!(engine.security().is_active());

    let state = {
        let txn = doc.transact();
        txn.encode_state_as_update_v1(&Default::default())
    };
    let (fresh, _) = YrsComputeEngine::from_yrs_state(&state).expect("from_yrs_state");
    assert!(
        fresh.security().is_active(),
        "a rehydrated engine must observe its snapshot's policies via seed-on-load"
    );
}
