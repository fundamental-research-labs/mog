use super::fixtures::*;

use compute_security::{AccessLevel, AccessTarget};

// ===========================================================================
// `AmbiguityDetected` event emission
// ===========================================================================
//
// Ambiguities surface at two sites. A single emission site would silently drop
// one class:
// - Matrix-build time carries per-column warnings that `evaluate`
//   never sees (cell/range gating reads the matrix directly).
// - `PolicyEngine::evaluate` carries workbook/sheet-scope warnings that
//   the matrix never touches (the matrix is only for per-sheet scopes).
//
// Dedup is scoped to the current `policy_version`; a policy mutation
// bumps the counter and clears the set so a re-introduced ambiguity
// re-emits.

#[test]
fn ambiguity_emitted_on_matrix_publish() {
    // Two sheet-scope policies tied on every sort dimension (same tag
    // matcher, same target, same priority) with different levels. An
    // `active_matrix` build for the agent principal resolves the
    // sheet target through the same sort + clamp path `evaluate` uses
    // and carries the tie forward as a matrix `AmbiguityWarning`; the
    // matrix-build emission site at `SecurityState::active_matrix`
    // turns that warning into an `AmbiguityDetected` event. The test
    // intentionally does NOT call `wb_security_effective_access` or
    // `wb_security_explain_access` — only a cell-scope read, which
    // forces the matrix build.
    //
    // Note on scope choice: per-column ambiguities would require the
    // column to be registered in the grid index (`position_of(col_id)`
    // must resolve), and synthesising a known ColId that matches the
    // grid layout from a black-box test is fragile. Sheet-scope ties
    // reach matrix warnings (engine.rs:174-178) unconditionally and
    // exercise the same emission code path.
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent_tags: Vec<String> = vec!["agent:copilot".into()];

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(sheet_policy("agent:*", sheet_id, AccessLevel::Read))
        .expect("tied #1");
    service
        .wb_security_add_policy(sheet_policy("agent:*", sheet_id, AccessLevel::Write))
        .expect("tied #2");
    service.set_active_principal(Some(agent_tags));
    // Flush crud events so only the matrix-build emission remains.
    let _ = service.wb_security_drain_events();

    // A cell-scope read forces an `active_matrix` build — that's the
    // trigger for R9.2's matrix-publish emission.
    let _ = service.get_cell_value(&sheet_id, 0, 0);

    let events = service.wb_security_drain_events();
    let ambigs: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            compute_security::SecurityEvent::AmbiguityDetected { warning } => Some(warning.clone()),
            _ => None,
        })
        .collect();
    assert!(
        !ambigs.is_empty(),
        "tied sheet policies must surface an AmbiguityDetected event at matrix publish: {events:?}"
    );
    let w = &ambigs[0];
    assert_eq!(
        w.conflicting_policies.len(),
        2,
        "two tied policies must appear in conflicting_policies: {w:?}"
    );
}

#[test]
fn ambiguity_detected_on_tied_policies_via_evaluate() {
    // Two workbook-scope policies tied on priority/specificity with
    // different levels. `effective_access` routes through
    // `SecurityState::evaluate`, which carries `EvalResult.ambiguity`;
    // that path now emits `AmbiguityDetected`. Also verifies the
    // safer (lower) level is the returned one.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent_tags: Vec<String> = vec!["agent:copilot".into()];

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("tied a");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("tied b");

    let _ = service.wb_security_drain_events();

    let lvl = service.wb_security_effective_access(AccessTarget::Workbook, agent_tags.clone());
    assert_eq!(
        lvl,
        AccessLevel::Read,
        "ambiguity resolves to the safer (lower) level"
    );

    let events = service.wb_security_drain_events();
    let ambigs: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::AmbiguityDetected { .. }))
        .collect();
    assert!(
        !ambigs.is_empty(),
        "tied workbook policies must emit AmbiguityDetected through evaluate: {events:?}"
    );
}

#[test]
fn ambiguity_event_deduped_within_policy_version() {
    // Same tie, 100 calls: dedup must collapse to one event per
    // fingerprint. Without dedup, every `effective_access` call would
    // push a fresh event and overflow the bounded ring buffer.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent_tags: Vec<String> = vec!["agent:copilot".into()];

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("tied a");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("tied b");

    let _ = service.wb_security_drain_events();
    for _ in 0..100 {
        let _ = service.wb_security_effective_access(AccessTarget::Workbook, agent_tags.clone());
    }

    let ambig_count = service
        .wb_security_drain_events()
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::AmbiguityDetected { .. }))
        .count();
    assert_eq!(
        ambig_count, 1,
        "100 tied-policy evaluations must collapse to one deduped AmbiguityDetected"
    );
}

#[test]
fn ambiguity_reemit_after_policy_change() {
    // Dedup is scoped to `policy_version`. After a policy mutation
    // (which bumps the counter and clears the dedup set), the same
    // fingerprint should re-emit so consumers see that the ambiguity
    // is still present in the new policy state.
    let (mut service, _sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent_tags: Vec<String> = vec!["agent:copilot".into()];

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Read))
        .expect("tied a");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Write))
        .expect("tied b");

    // First round — emit once, dedup the rest.
    for _ in 0..10 {
        let _ = service.wb_security_effective_access(AccessTarget::Workbook, agent_tags.clone());
    }
    let _ = service.wb_security_drain_events();

    // Add an unrelated third policy. The version bump clears the
    // dedup set; the next evaluate re-emits.
    service
        .wb_security_add_policy(workbook_policy("role:other", AccessLevel::Read))
        .expect("bump");
    let _ = service.wb_security_drain_events();

    let _ = service.wb_security_effective_access(AccessTarget::Workbook, agent_tags);

    let ambig_count = service
        .wb_security_drain_events()
        .iter()
        .filter(|e| matches!(e, compute_security::SecurityEvent::AmbiguityDetected { .. }))
        .count();
    assert_eq!(
        ambig_count, 1,
        "policy-version bump must clear dedup, letting the same fingerprint re-emit"
    );
}
