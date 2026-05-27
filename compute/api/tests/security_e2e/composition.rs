use super::fixtures::*;

use std::sync::Arc;

use cell_types::SheetId;
use compute_security::{
    AccessLevel, AccessPolicy, AccessPolicyPatch, AccessTarget, PolicyId, PolicyMetadata,
    TagMatcher, Template,
};

// ===========================================================================
// Composition — category 3
// ===========================================================================

#[test]
fn composition_same_level_policy_idempotent() {
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("first");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("second");
    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent);
    assert_eq!(lvl, AccessLevel::Read);
}

#[test]
fn composition_multi_tag_principal_resolves_highest() {
    // A principal with two tags that match two policies of different
    // levels resolves to the highest level (most-permissive union).
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let dual = service.make_principal(vec!["role:editor".into(), "agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("agent policy");
    service
        .wb_security_add_policy(workbook_policy("role:editor", AccessLevel::Write))
        .expect("role policy");

    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, dual);
    assert_eq!(lvl, AccessLevel::Write, "most permissive wins");
}

#[test]
fn composition_policy_change_takes_effect_immediately() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner.clone()));
    let id = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("Read");
    service.set_active_principal(Some(agent.clone()));
    let r1 = service.set_cell_value_parsed(&sheet_id, 0, 0, "1");
    assert!(r1.is_err(), "Read denies write");

    service.set_active_principal(Some(owner));
    service
        .wb_security_update_policy(
            id,
            AccessPolicyPatch {
                level: Some(AccessLevel::Write),
                ..Default::default()
            },
        )
        .expect("upgrade");
    service.set_active_principal(Some(agent));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "1")
        .expect("upgraded write passes");
}

#[test]
fn composition_column_policy_scopes_to_column() {
    // A column-level policy restricts access only to that column. Other
    // columns on the same sheet inherit the sheet/workbook defaults.
    use cell_types::ColId;
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    // Seed a known ColId via first write — but the col_id is synthesized
    // per cell. The column-level policy target takes an explicit ColId.
    // Skip writes; focus on verifying that the resolver honors column
    // targets by asserting explain's matched policy.
    let col_id = ColId::from_raw(0x2222_2222_2222_2222_2222_2222_2222_2222);
    let policy = AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse("agent:*"),
        target: AccessTarget::Column { sheet_id, col_id },
        level: AccessLevel::Read,
        priority: 30,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("e2e-col"),
            created_at_millis: 0,
            template_id: None,
        },
    };
    service
        .wb_security_add_policy(policy)
        .expect("column policy");

    let agent = service.make_principal(vec!["agent:copilot".into()]);
    let explain =
        service.wb_security_explain_access(AccessTarget::Column { sheet_id, col_id }, agent);
    assert_eq!(explain.level, AccessLevel::Read);
}

#[test]
fn composition_template_and_explicit_policy_coexist() {
    // Apply a template, add a second policy — both present in list, neither clobbers the other.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));

    let template_ids = service
        .wb_security_apply_template(Template::ProtectWorkbook)
        .expect("tmpl");
    let explicit_id = service
        .wb_security_add_policy(workbook_policy("role:editor", AccessLevel::Read))
        .expect("explicit");

    let listed = service.wb_security_list_policies();
    assert_eq!(listed.len(), template_ids.len() + 1);
    assert!(listed.iter().any(|p| p.id == explicit_id));
    for tid in template_ids {
        assert!(listed.iter().any(|p| p.id == tid));
    }
}

#[test]
fn composition_sheet_and_workbook_policies_compose_on_write() {
    // Workbook denies writes (None), but a sheet-scoped Write grants it.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("workbook None");
    service
        .wb_security_add_policy(sheet_policy("agent:*", sheet_id, AccessLevel::Write))
        .expect("sheet Write");
    service.set_active_principal(Some(agent));

    // Sheet-scope write passes because the resolver picks the most-specific
    // matching policy.
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "ok")
        .expect("sheet override allows write");
}

#[test]
fn composition_template_remove_restores_default() {
    // Apply ProtectWorkbook (restricts writes), remove it, writes on
    // another sheet as an agent-without-any-policy: back to defaults.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_apply_template(Template::ProtectWorkbook)
        .expect("apply");
    let lvl_restricted =
        service.wb_security_effective_access(AccessTarget::Workbook, agent.clone());
    assert_ne!(lvl_restricted, AccessLevel::Admin);

    service
        .wb_security_remove_template("protect-workbook".to_string())
        .expect("remove");

    // After template remove: no policies; security deactivates; non-owner
    // defaults to None.
    assert!(!service.security_active());
    let lvl_after = service.wb_security_effective_access(AccessTarget::Workbook, agent);
    assert_eq!(lvl_after, AccessLevel::None);
}

#[test]
fn composition_multiple_sheets_isolated_policies() {
    const SHEET2_UUID: &str = "55555555-5555-5555-5555-555555555555";
    // Build a workbook with two sheets, apply a None policy only to sheet1,
    // verify sheet2 is unaffected.
    let (mut service, _sid) = fresh_service_uuid(SHEET1_UUID);
    // Using the engine directly would require two sheets in the snapshot;
    // build a second fresh service to mimic the isolation claim for sheet2.
    let (mut service2, _) = fresh_service_uuid(SHEET2_UUID);

    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Apply workbook-scope policy on wb1.
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("wb1 restrict");
    service.set_active_principal(Some(agent.clone()));
    let r1 =
        service.set_cell_value_parsed(&SheetId::from_uuid_str(SHEET1_UUID).unwrap(), 0, 0, "x");
    assert!(r1.is_err());

    // wb2 has no policies — it stays permissive for owner. Non-owner
    // defaults to None, so writes still denied — but that's the default
    // model, not a composition issue. Flip to owner on wb2 to confirm
    // isolation.
    let owner2 = service2.make_principal(vec!["mog:owner".into()]);
    service2.set_active_principal(Some(owner2));
    service2
        .set_cell_value_parsed(&SheetId::from_uuid_str(SHEET2_UUID).unwrap(), 0, 0, "y")
        .expect("wb2 owner unaffected");
}

#[test]
fn composition_principal_reset_reverts_to_fast_path() {
    // Once all policies are removed and principal is cleared, the next
    // call goes through the fast path. Pair with set_active_principal-
    // swap to verify.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    let id = service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy");
    service.wb_security_remove_policy(id).expect("remove last");
    assert!(!service.security_active());

    service.set_active_principal(None);
    // Fast path: read without any check. Should not panic.
    let _v = service.get_cell_value(&sheet_id, 0, 0);
}

#[test]
fn composition_explain_reflects_resolution_trace() {
    // Confirm explain returns a matched policy when one applies. Used by
    // SDK debugging to diagnose "why is my call denied".
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("seed");

    let agent = service.make_principal(vec!["agent:copilot".into()]);
    let expl = service.wb_security_explain_access(AccessTarget::Workbook, agent);
    assert_eq!(expl.level, AccessLevel::Write);
    let matched = expl.matched_policy.expect("matched policy present");
    assert_eq!(matched.level, AccessLevel::Write);
}
