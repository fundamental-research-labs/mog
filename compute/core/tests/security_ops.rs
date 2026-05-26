//! R5.1 — integration tests for the engine's `wb_security_*` ops.
//!
//! These tests hit the `YrsComputeEngine` directly (no dispatch, no
//! ComputeService) so the bridging contract — attenuation, Yrs write,
//! observer-driven `active` flip, template bookkeeping — is exercised
//! in isolation. The outer delegate-layer pre-check (bridge::write
//! gating) is covered by R3's primitive tests and R7.1's end-to-end
//! tests; here we focus on what the engine method body owns:
//! attenuation + Yrs mutation + event emission.

use std::sync::Arc;

use compute_core::storage::engine::YrsComputeEngine;
use compute_security::{
    AccessLevel, AccessPolicy, AccessPolicyPatch, AccessTarget, PolicyId, PolicyMetadata,
    PrincipalPool, PrincipalTag, SecurityEvent, TagMatcher, Template,
};
use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

const SHEET1_UUID: &str = "11111111-1111-1111-1111-111111111111";

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

fn workbook_policy(tag: &str, level: AccessLevel) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target: AccessTarget::Workbook,
        level,
        priority: 10,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("r5-test"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

fn owner_principal(pool: &PrincipalPool) -> compute_security::Principal {
    pool.intern(std::iter::once(PrincipalTag::from("mog:owner")))
}

fn agent_principal(pool: &PrincipalPool) -> compute_security::Principal {
    pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")))
}

// Tag-list equivalents for bridge-surface calls that trade `Vec<String>`
// (the wire form for non-serialisable `Principal`).
fn owner_tags() -> Vec<String> {
    vec!["mog:owner".to_string()]
}

fn agent_tags() -> Vec<String> {
    vec!["agent:copilot".to_string()]
}

#[test]
fn add_policy_owner_succeeds_and_activates() {
    // Owner principal on an empty doc has Admin workbook-level access via
    // the default-for-owner rule; attenuation passes, Yrs write fires the
    // observer, and `active` flips true.
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);
    assert!(
        !engine.security().is_active(),
        "empty doc should start inactive"
    );

    let policy = workbook_policy("agent:*", AccessLevel::Read);
    let expected_id = policy.id;
    let id = engine
        .wb_security_add_policy(policy, &owner)
        .expect("owner add_policy");
    assert_eq!(id, expected_id, "returned id must match the input");
    assert!(
        engine.security().is_active(),
        "first policy flips active true"
    );

    let events = engine.wb_security_drain_events();
    assert!(
        events
            .iter()
            .any(|e| matches!(e, SecurityEvent::PolicyAdded { .. })),
        "PolicyAdded must be emitted"
    );
}

#[test]
fn add_policy_attenuation_violation() {
    // Seed a Write-level policy so the caller's ceiling is Write, then
    // try to add an Admin-level policy. The attenuation guard inside
    // wb_security_add_policy rejects before touching Yrs.
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);

    // Owner-authored baseline — restricts agent:copilot to Write on workbook.
    engine
        .wb_security_add_policy(workbook_policy("agent:copilot", AccessLevel::Write), &owner)
        .expect("seed write policy");

    // Drain events from the seed so the next assertion is clean.
    let _ = engine.wb_security_drain_events();

    let caller = agent_principal(&pool);
    let err = engine
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Admin), &caller)
        .expect_err("attenuation must reject Admin from Write caller");
    let msg = format!("{err}");
    assert!(
        msg.to_lowercase().contains("attenuation") || msg.to_lowercase().contains("security"),
        "error must surface attenuation: {msg}"
    );
    // Post-failure: no PolicyAdded event for the failed call.
    let events = engine.wb_security_drain_events();
    assert!(
        events.is_empty(),
        "failed add must not emit PolicyAdded: {events:?}"
    );
}

#[test]
fn remove_policy_emits_event_and_deactivates_on_last() {
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);

    let policy = workbook_policy("agent:*", AccessLevel::Read);
    let id = engine.wb_security_add_policy(policy, &owner).expect("add");
    let _ = engine.wb_security_drain_events();

    engine
        .wb_security_remove_policy(id, &owner)
        .expect("remove");
    assert!(
        !engine.security().is_active(),
        "removing the last policy must flip active false"
    );
    let events = engine.wb_security_drain_events();
    assert!(
        events
            .iter()
            .any(|e| matches!(e, SecurityEvent::PolicyRemoved { id: rid } if *rid == id)),
        "PolicyRemoved with the removed id must be emitted: {events:?}"
    );
}

#[test]
fn update_policy_changes_level_and_bumps_version() {
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);

    let policy = workbook_policy("agent:*", AccessLevel::Read);
    let id = engine.wb_security_add_policy(policy, &owner).expect("add");
    let v_before = engine.security().policy_version();
    let _ = engine.wb_security_drain_events();

    let patch = AccessPolicyPatch {
        level: Some(AccessLevel::Write),
        ..Default::default()
    };
    engine
        .wb_security_update_policy(id, patch, &owner)
        .expect("update");
    let v_after = engine.security().policy_version();
    assert!(
        v_after > v_before,
        "policy_version must advance on update: {v_before} -> {v_after}"
    );

    let policies = engine.wb_security_list_policies();
    let updated = policies
        .iter()
        .find(|p| p.id == id)
        .expect("policy still present");
    assert_eq!(updated.level, AccessLevel::Write, "level must be patched");
}

#[test]
fn list_policies_returns_current_set() {
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);

    let p1 = workbook_policy("agent:a", AccessLevel::Read);
    let p2 = workbook_policy("agent:b", AccessLevel::Write);
    engine.wb_security_add_policy(p1.clone(), &owner).unwrap();
    engine.wb_security_add_policy(p2.clone(), &owner).unwrap();

    let listed = engine.wb_security_list_policies();
    assert_eq!(listed.len(), 2, "both policies listed: {listed:?}");
    assert!(listed.iter().any(|p| p.id == p1.id));
    assert!(listed.iter().any(|p| p.id == p2.id));
}

#[test]
fn effective_access_reports_caller_ceiling() {
    // Baseline: caller has no policies → default is None for non-owner.
    // Attenuation invariant (R1): effective_access(caller, Workbook) is
    // the caller's ceiling for granting new policies.
    let engine = fresh_engine();
    let level = engine.wb_security_effective_access(AccessTarget::Workbook, agent_tags());
    assert_eq!(
        level,
        AccessLevel::None,
        "non-owner on empty doc defaults to None"
    );

    let owner_level = engine.wb_security_effective_access(AccessTarget::Workbook, owner_tags());
    assert_eq!(owner_level, AccessLevel::Admin, "owner defaults to Admin");
}

#[test]
fn explain_access_shape_fields_populated() {
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);
    engine
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read), &owner)
        .unwrap();

    let expl = engine.wb_security_explain_access(AccessTarget::Workbook, agent_tags());
    // effective_tags contains the caller's explicit tag plus the derived
    // mog:non-owner (because the caller isn't owner).
    assert!(
        expl.effective_tags
            .iter()
            .any(|t| t.as_str() == "agent:copilot"),
        "effective_tags must include explicit: {:?}",
        expl.effective_tags
    );
    assert!(
        expl.effective_tags
            .iter()
            .any(|t| t.as_str() == "mog:non-owner"),
        "effective_tags must include derived non-owner: {:?}",
        expl.effective_tags
    );
    // The policy matched, so `matched_policy` and `sorted_policies` are
    // non-empty; level is Read because the policy grants Read.
    assert_eq!(expl.level, AccessLevel::Read, "{:?}", expl);
    assert!(expl.matched_policy.is_some());
    assert!(!expl.sorted_policies.is_empty());
}

#[test]
fn apply_template_protect_workbook_creates_policy_with_metadata() {
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);

    let created = engine
        .wb_security_apply_template(Template::ProtectWorkbook, &owner)
        .expect("apply_template");
    assert_eq!(created.len(), 1, "ProtectWorkbook emits exactly one policy");

    let listed = engine.wb_security_list_policies();
    let generated = listed
        .iter()
        .find(|p| created.contains(&p.id))
        .expect("generated policy must be in list");
    let tmpl_id = generated
        .metadata
        .template_id
        .as_deref()
        .expect("template_id metadata must be stamped");
    assert_eq!(tmpl_id, "protect-workbook");

    // R5.4 — apply_template emits one PolicyAdded event per generated policy.
    let events = engine.wb_security_drain_events();
    let added_count = events
        .iter()
        .filter(|e| matches!(e, SecurityEvent::PolicyAdded { .. }))
        .count();
    assert_eq!(
        added_count,
        created.len(),
        "one PolicyAdded per template policy: {events:?}"
    );
}

#[test]
fn remove_template_removes_its_policies() {
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);

    let created = engine
        .wb_security_apply_template(Template::ProtectWorkbook, &owner)
        .unwrap();
    let before = engine.wb_security_list_policies().len();
    assert_eq!(before, 1);

    engine
        .wb_security_remove_template("protect-workbook".to_string(), &owner)
        .expect("remove_template");
    let after = engine.wb_security_list_policies();
    for pid in &created {
        assert!(
            !after.iter().any(|p| p.id == *pid),
            "generated policy {pid} must be gone after remove_template"
        );
    }
}

#[test]
fn attenuation_invariant_write_caller_cannot_grant_admin() {
    // Direct attenuation check via effective_access + add_policy path.
    // The caller has Write ceiling (via a Write-granting policy); adding
    // an Admin policy must fail.
    let mut engine = fresh_engine();
    let pool = PrincipalPool::new();
    let owner = owner_principal(&pool);

    // Give agent:copilot Write on workbook.
    engine
        .wb_security_add_policy(workbook_policy("agent:copilot", AccessLevel::Write), &owner)
        .unwrap();

    let caller = agent_principal(&pool);
    let ceiling = engine.wb_security_effective_access(AccessTarget::Workbook, agent_tags());
    assert_eq!(ceiling, AccessLevel::Write, "ceiling must be Write");

    // Caller tries to promote to Admin — rejected by attenuation.
    let res =
        engine.wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Admin), &caller);
    assert!(res.is_err(), "Write caller cannot grant Admin");
}
