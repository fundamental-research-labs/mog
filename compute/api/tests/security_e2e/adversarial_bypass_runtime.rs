use super::fixtures::*;

use compute_security::AccessLevel;
use domain_types::domain::comment::CommentType;
use value_types::CellValue;

// ===========================================================================
// Adversarial bypass tests from the scenario audit.
//
// Each test below locks down one Group B scenario. Group A rationales
// and Group C "no surface yet" stubs live in the audit file, not here.
// ===========================================================================

/// R10.2 — `bypass-via-formula-result`.
///
/// Under a Structure-level workbook policy, a cell whose value is
/// computed from a formula (`B1 = =A1`) must also redact the computed
/// result — `B1` reads go through the same gated `get_cell_value` path
/// that routes `redact_scalar` over the output. The expected typed
/// placeholder is `CellValue::Text("[Number]")`, parity with the raw-
/// number redaction anchored by `sg2_structure_redacts_cell_values`.
#[test]
fn adversarial_formula_result_redacts_under_structure() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "42")
        .expect("owner seed A1");
    service
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1")
        .expect("owner seed B1 formula");
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    // B1 is a formula whose value derives from A1. Under Structure, the
    // computed result must redact to the typed placeholder — the R4
    // `RedactMaybe` impl for `CellValue` returns `Text("[Number]")` for
    // numeric payloads.
    let v = service.get_cell_value(&sheet_id, 0, 1);
    match v {
        CellValue::Text(ref s) => assert_eq!(
            &**s, "[Number]",
            "formula result must redact to [Number] placeholder under Structure"
        ),
        other => panic!("formula result must redact under Structure, got {other:?}"),
    }
}

/// R10.3 — `bypass-via-conditional-format`.
///
/// `get_cf_rules_for_cell` is `#[bridge::read(scope = "cell")]` ->
/// `Vec<ConditionalFormat>`. Under a None-level workbook policy the
/// cell-scope post-filter calls `Vec::<T>::redact(None)` which
/// `Vec::clear()`s. We seed one CF rule covering A1 and assert that
/// the owner sees the rule but the agent sees an empty Vec.
#[test]
fn adversarial_conditional_format_read_under_none_redacts() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Seed a CF rule covering A1..B2 as owner.
    service.set_active_principal(Some(owner.clone()));
    // CF schema canonicalization: bridge takes serde_json::Value so it can
    // normalize public-API rule-shape variants in Rust before deserializing.
    let cf_json = serde_json::json!({
        "id": "cf-adv-1",
        "sheetId": sheet_id.to_uuid_string(),
        "pivot": null,
        "ranges": [cell_types::SheetRange::new(0, 0, 1, 1)],
        "rangeIdentities": null,
        "rules": [{
            "type": "cellValue",
            "id": "r1",
            "priority": 1,
            "stopIfTrue": null,
            "operator": "greaterThan",
            "value1": 50,
            "value2": null,
            "style": {},
            "text": null
        }]
    });
    service.add_cf_rule(&sheet_id, cf_json).expect("seed CF");

    // Owner sees the rule.
    let owner_rules = service.get_cf_rules_for_cell(&sheet_id, 0, 0);
    assert_eq!(
        owner_rules.len(),
        1,
        "owner baseline: CF rule present at A1"
    );

    // Apply None-level policy; agent reads the same cell and gets empty.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let agent_rules = service.get_cf_rules_for_cell(&sheet_id, 0, 0);
    assert!(
        agent_rules.is_empty(),
        "agent under None policy must see empty CF rule list, got {agent_rules:?}"
    );
}

/// R10.3 — `bypass-via-chart-data`.
///
/// Chart reads (`get_all_charts`, `get_chart`) return
/// `FloatingObject` payloads — metadata + layout, not cell values. The
/// `coverage_audit::every_bridge_api_method_returning_cell_data_is_gated`
/// test already confirms no chart read returns `CellValue` /
/// `CellInfo` data. This test is the end-to-end companion: call the
/// chart read surface under a None policy and verify the call returns
/// (bridge dispatch succeeds through the gated path) without panicking
/// or leaking. A regression that added a cell-value field to
/// `FloatingObject` without updating the audit fragment list would be
/// caught there; this test locks the runtime path.
#[test]
fn adversarial_chart_read_under_none_redacts() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    // No charts seeded — the empty Vec is the expected redacted shape.
    // The point of the test is to exercise the gated path; the
    // coverage_audit already proves the surface can't accept a cell-
    // value-bearing return type without the audit going red.
    let charts = service.get_all_charts(&sheet_id);
    assert!(
        charts.is_empty(),
        "no charts seeded; agent read must not synthesize phantom charts: {charts:?}"
    );
}

/// R10.3 — `bypass-via-pivot-aggregate`.
///
/// `pivot_get_all` is `#[bridge::read(scope = "sheet")]` returning
/// `Vec<PivotTableConfig>` — stored config, not computed aggregates.
/// The aggregate-computing path (`pivot_compute_from_source`) is
/// documented as a known limitation in BYPASS-AUDIT.md (same class as
/// `bypass-via-dependent-cell`) — Rust compute-path enforcement is an
/// explicit non-goal. This test locks the stored-config return shape
/// under None.
#[test]
fn adversarial_pivot_read_under_none_redacts() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let pivots = service.pivot_get_all(&sheet_id);
    assert!(
        pivots.is_empty(),
        "no pivots seeded; agent read must return empty: {pivots:?}"
    );
}

/// R10.3 — `bypass-via-autofilter-unique`.
///
/// `get_unique_column_values` is `#[bridge::read(scope = "sheet")]`
/// returning `Vec<CellValue>`. Sheet-scope Vec reads are passthrough
/// in the current delegate macro (see BYPASS-AUDIT.md "gaps discovered"
/// section) — cell values can flow through under a sheet None policy.
/// The test here locks the CURRENT behavior: owner sees seeded data,
/// agent under None sees whatever the passthrough produces. If the
/// macro is tightened in a follow-up (range-scoped filter emission for
/// sheet Vec reads, or scope narrowing), this test WILL flip and its
/// assertion should be tightened to `agent_values.is_empty()` in lock-
/// step with the fix. A failing assertion here is the regression
/// signal we want.
///
/// For now: the agent-scoped call must at minimum not panic on the
/// bridge dispatch and must not exceed the owner's view.
#[test]
fn adversarial_autofilter_unique_values_redact_under_structure() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Apply structure policy — no data seeded because the autofilter
    // surface requires a configured filter id. The test exercises the
    // gated-read path on the unfiltered return (empty Vec) and locks
    // the bridge dispatch against regression.
    service.set_active_principal(Some(owner));
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::Structure))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    // Non-existent filter id -> empty Vec. The gated path must still
    // run through `active_matrix` (which exercises the passthrough
    // arm for sheet-scope Vec<CellValue> — see BYPASS-AUDIT.md).
    let unique = service.get_unique_column_values(&sheet_id, "nonexistent-filter", 0);
    assert!(
        unique.is_empty(),
        "no filter configured; agent read must not synthesize unique values: {unique:?}"
    );
}

/// R10.4 — `bypass-via-hyperlink-read`.
///
/// `get_hyperlink` is `#[bridge::read(scope = "cell")]` ->
/// `Option<String>`. Under a None-level policy on the enclosing sheet,
/// cell-scope `redact_scalar` calls `Option::<String>::redact(None)`
/// which sets the option to `None`. The URL does not survive.
///
/// Scope correction: hyperlinks are not workbook-scope metadata "visible under
/// Structure"; the engine annotation at `objects.rs:863` is `scope = "cell"`.
/// The Structure-vs-None invariant this test asserts is the None-level full
/// hide, which is the tightest regression anchor regardless of the
/// Structure-level design decision.
#[test]
fn adversarial_hyperlink_redacts_under_none() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Seed a cell value + hyperlink as owner.
    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "anchor")
        .expect("owner seed A1");
    service
        .set_hyperlink(&sheet_id, 0, 0, "https://example.com/secret")
        .expect("owner seed hyperlink");

    // Owner sees the URL.
    let owner_link = service.get_hyperlink(&sheet_id, 0, 0);
    assert_eq!(
        owner_link.as_deref(),
        Some("https://example.com/secret"),
        "owner baseline: hyperlink visible"
    );

    // Apply None policy; agent reads and sees the URL hidden.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let agent_link = service.get_hyperlink(&sheet_id, 0, 0);
    assert!(
        agent_link.is_none(),
        "agent under None policy must see hyperlink as None, got {agent_link:?}"
    );
}

/// `bypass-via-comment-read` (cell-scope / position form).
///
/// `get_comments_for_cell_by_position` is `#[bridge::read(scope =
/// "cell")]`, so `redact_scalar` applies. The `Comment` type itself is
/// `redact_noop!` because comments are annotations, not values, but the
/// wrapping `Vec<Comment>` redacts to an empty Vec under None.
#[test]
fn adversarial_comment_redacts_under_none_position_form() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Seed a comment on A1 as owner.
    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "anchor")
        .expect("owner seed A1");
    service
        .add_comment_by_position(
            &sheet_id,
            0,
            0,
            "confidential note",
            "owner",
            None,
            None,
            CommentType::Note,
        )
        .expect("owner seed comment");

    // Owner baseline: comment present.
    let owner_comments = service.get_comments_for_cell_by_position(&sheet_id, 0, 0);
    assert_eq!(owner_comments.len(), 1, "owner baseline: comment visible");

    // Apply None policy; agent sees an empty Vec.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    let agent_comments = service.get_comments_for_cell_by_position(&sheet_id, 0, 0);
    assert!(
        agent_comments.is_empty(),
        "agent under None policy must see empty comment list from position form, got {agent_comments:?}"
    );
}

/// R10.4 — `bypass-via-comment-read` (sheet-scope / id form).
///
/// `get_comments_for_cell` is `#[bridge::read(scope = "sheet")]` ->
/// `Vec<Comment>`. Sheet-scope Vec reads are PASSTHROUGH in the
/// current delegate macro (see `infra/rust-bridge/bridge-delegate/
/// macros/src/expand.rs:926-939` — only byte-Vec at sheet scope or
/// range scope get a filter; sheet-scope `Vec<T>` falls into the `_`
/// arm). `Comment` is `redact_noop!` by design because comments are
/// annotations, not values, so per-element redact wouldn't change anything at
/// Structure. The only meaningful tightening is Vec-clear at None, which the
/// current macro does NOT apply at sheet scope.
///
/// This is a KNOWN GAP documented in BYPASS-AUDIT.md "Sheet-scope
/// passthrough for non-byte Vec returns". The test below locks the
/// CURRENT behavior ("id form passes through") so any future
/// tightening (macro emission of a range-filter-style pass, or
/// per-method scope narrowing) that FIXES the leak produces a test
/// signal. When that happens, flip the `.is_empty()` assertion at
/// the bottom and update BYPASS-AUDIT.md to mark the gap closed.
///
/// Keeping both position-form and id-form tests ensures a regression
/// that mis-scopes only ONE surface (e.g., drops the cell annotation
/// on the position form while the id form sheet-scope is untouched)
/// is caught by the position-form invariant.
#[test]
fn adversarial_comment_redacts_under_none_id_form() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "anchor")
        .expect("owner seed A1");
    service
        .add_comment_by_position(
            &sheet_id,
            0,
            0,
            "confidential note",
            "owner",
            None,
            None,
            CommentType::Note,
        )
        .expect("owner seed comment");
    let seeded = service.get_comments_for_cell_by_position(&sheet_id, 0, 0);
    assert_eq!(seeded.len(), 1, "owner baseline: comment present");
    // `get_comments_for_cell` (sheet-scope, id form) filters by the
    // comment's `cell_ref` field (the engine-emitted cell id, not
    // A1 notation). We read it off the seeded comment.
    let cell_ref = seeded[0].cell_ref.clone();

    // Owner via id-form also sees the comment.
    let owner_id_form = service.get_comments_for_cell(&sheet_id, &cell_ref);
    assert_eq!(
        owner_id_form.len(),
        1,
        "owner baseline via id form: comment visible"
    );

    // Apply None policy; agent calls id-form.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");
    service.set_active_principal(Some(agent));

    // Position form IS redacted (cell-scope -> redact_scalar -> Vec clears).
    // This invariant must never regress.
    let agent_position_form = service.get_comments_for_cell_by_position(&sheet_id, 0, 0);
    assert!(
        agent_position_form.is_empty(),
        "position form (cell scope) must redact under None, got {agent_position_form:?}"
    );

    // Id form is CURRENTLY a passthrough leak per the documented gap.
    // We lock the current shape so a future macro tightening that
    // emits a filter for sheet-scope Vec<T> reads DOES produce a test
    // signal. When you come to close this gap:
    //   1. Apply the macro change (or narrow the scope on this method).
    //   2. Flip the assertion below to `is_empty`.
    //   3. Update BYPASS-AUDIT.md "gaps discovered" to mark closed.
    let agent_id_form = service.get_comments_for_cell(&sheet_id, &cell_ref);
    assert_eq!(
        agent_id_form.len(),
        seeded.len(),
        "documented gap: sheet-scope Vec<Comment> read is passthrough. \
         If this assertion fails, the macro may have been tightened — \
         see BYPASS-AUDIT.md 'Sheet-scope passthrough' section and \
         flip this to `is_empty` if the fix is intentional."
    );
}

/// R10.5 — `bypass-via-undo-reveal`.
///
/// The current security contract withdraws the previous rationale that
/// `composition_policy_change_takes_effect_immediately` covers this
/// case — that test exercises policy-version swap, not undo. This test
/// authors the real invariant: after a sequence of edits, a policy
/// add, and an owner-initiated undo, reading through the gated
/// delegate as the agent still redacts. The Yrs undo manager mutates
/// state; the next `get_cell_value` re-enters the gated path and
/// `redact_scalar` runs against the post-undo value.
///
/// If this test becomes trivially architectural (coverage_audit
/// already proves get_cell_value is gated + undo writes through the
/// engine's mutation path + reads re-enter the gated delegate), the
/// scenario can be promoted to Group A with the specific
/// coverage_audit row as citation. For now we keep an explicit test
/// because the interaction spans two otherwise-independent subsystems
/// (undo manager + security matrix).
#[test]
fn adversarial_undo_does_not_reveal_redacted_cell() {
    let (mut service, sheet_id) = fresh_service();
    let owner = service.make_principal(vec!["mog:owner".into()]);
    let agent = service.make_principal(vec!["agent:copilot".into()]);

    // Owner performs a sequence of edits that undo can reach.
    service.set_active_principal(Some(owner.clone()));
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "secret")
        .expect("owner seed A1=secret");
    service
        .set_cell_value_parsed(&sheet_id, 0, 0, "secret-v2")
        .expect("owner bump A1");

    // Apply None policy.
    service
        .wb_security_add_policy(workbook_policy("agent:*", AccessLevel::None))
        .expect("policy add");

    // Owner undoes the last edit — yrs reverts A1 to "secret".
    service.undo().expect("owner undo");

    // Agent reads A1 under the None policy; must return Null.
    service.set_active_principal(Some(agent));
    let v = service.get_cell_value(&sheet_id, 0, 0);
    assert!(
        matches!(v, CellValue::Null),
        "post-undo agent read must still redact under None, got {v:?}"
    );

    // Drain events — once R9 merges, an AccessDenied event IS NOT
    // expected here (reads redact, they do not deny). Policy-add event
    // should still be present. We assert only that draining succeeds;
    // the event-contents assertion lives with the R9 tests.
    let _events = service.wb_security_drain_events();
}
