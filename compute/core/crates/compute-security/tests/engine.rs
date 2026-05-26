//! Port of `kernel/src/services/security/__tests__/policy-engine.test.ts`.
//! Describe blocks → `mod`; `it` blocks → `#[test]`.

use std::sync::Arc;

use cell_types::{ColId, SheetId};
use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, ExplainReason, PolicyEngine, PolicyId, PolicyMetadata,
    PrincipalPool, PrincipalTag, TagMatcher,
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

fn sheet() -> SheetId {
    SheetId::from_raw(0x1111_1111_1111_1111_1111_1111_1111_1111)
}
fn col_a() -> ColId {
    ColId::from_raw(0xa0a0_a0a0_a0a0_a0a0_a0a0_a0a0_a0a0_a0a0)
}
fn col_b() -> ColId {
    ColId::from_raw(0xb0b0_b0b0_b0b0_b0b0_b0b0_b0b0_b0b0_b0b0)
}

fn make_policy(
    principal_tag: &str,
    target: AccessTarget,
    level: AccessLevel,
    priority: i32,
) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(principal_tag),
        target,
        level,
        priority,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("test"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

fn make_policy_disabled(
    principal_tag: &str,
    target: AccessTarget,
    level: AccessLevel,
    priority: i32,
) -> AccessPolicy {
    let mut p = make_policy(principal_tag, target, level, priority);
    p.enabled = false;
    p
}

fn principal_with(tags: &[&str]) -> compute_security::Principal {
    let pool = PrincipalPool::new();
    pool.intern(tags.iter().map(|t| PrincipalTag::from(*t)))
}

// -----------------------------------------------------------------------------
// describe('target specificity: column > sheet > workbook')
// -----------------------------------------------------------------------------

mod target_specificity {
    use super::*;

    #[test]
    fn column_level_policy_overrides_workbook_level_policy() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "agent:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::None,
                0,
            ),
        ]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(
            &p,
            &AccessTarget::Column {
                sheet_id: sheet(),
                col_id: col_a(),
            },
        );
        assert_eq!(r.level, AccessLevel::None);
    }

    #[test]
    fn sheet_level_policy_overrides_workbook_level_policy() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "agent:*",
                AccessTarget::Sheet { sheet_id: sheet() },
                AccessLevel::Structure,
                0,
            ),
        ]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(&p, &AccessTarget::Sheet { sheet_id: sheet() });
        assert_eq!(r.level, AccessLevel::Structure);
    }

    #[test]
    fn column_level_policy_overrides_sheet_level_policy() {
        let engine = PolicyEngine::new([
            make_policy(
                "agent:*",
                AccessTarget::Sheet { sheet_id: sheet() },
                AccessLevel::Read,
                0,
            ),
            make_policy(
                "agent:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::None,
                0,
            ),
        ]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(
            &p,
            &AccessTarget::Column {
                sheet_id: sheet(),
                col_id: col_a(),
            },
        );
        assert_eq!(r.level, AccessLevel::None);
    }
}

// -----------------------------------------------------------------------------
// describe('tag specificity (SG-2): exact > prefix-glob > wildcard')
// -----------------------------------------------------------------------------

mod tag_specificity {
    use super::*;

    #[test]
    fn exact_tag_overrides_prefix_glob() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Structure, 0),
            make_policy(
                "agent:copilot",
                AccessTarget::Workbook,
                AccessLevel::Read,
                0,
            ),
        ]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Read);
    }

    #[test]
    fn prefix_glob_overrides_wildcard() {
        let engine = PolicyEngine::new([
            make_policy("*", AccessTarget::Workbook, AccessLevel::None, 0),
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Structure, 0),
        ]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Structure);
    }

    #[test]
    fn exact_tag_overrides_wildcard() {
        let engine = PolicyEngine::new([
            make_policy("*", AccessTarget::Workbook, AccessLevel::None, 0),
            make_policy("user:alice", AccessTarget::Workbook, AccessLevel::Write, 0),
        ]);
        let p = principal_with(&["user:alice"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Write);
    }
}

// -----------------------------------------------------------------------------
// describe('priority: higher wins within same specificity')
// -----------------------------------------------------------------------------

mod priority {
    use super::*;

    #[test]
    fn higher_priority_wins_at_same_target_and_tag_specificity() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Structure, 0),
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 10),
        ]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Read);
    }
}

// -----------------------------------------------------------------------------
// describe('ambiguity: same specificity + priority + different levels')
// -----------------------------------------------------------------------------

mod ambiguity {
    use super::*;

    #[test]
    fn resolves_to_lower_level_and_emits_warning() {
        let engine = PolicyEngine::new([
            make_policy("team:*", AccessTarget::Workbook, AccessLevel::Write, 0),
            make_policy("role:*", AccessTarget::Workbook, AccessLevel::Read, 0),
        ]);
        let p = principal_with(&["team:engineering", "role:viewer"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Read);
        assert!(r.ambiguity.is_some());
    }

    #[test]
    fn does_not_emit_warning_when_levels_agree() {
        let engine = PolicyEngine::new([
            make_policy("team:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy("role:*", AccessTarget::Workbook, AccessLevel::Read, 0),
        ]);
        let p = principal_with(&["team:engineering", "role:viewer"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Read);
        assert!(r.ambiguity.is_none());
    }
}

// -----------------------------------------------------------------------------
// describe('owner lockout (SG-3): mog:owner clamped to minimum read')
// -----------------------------------------------------------------------------

mod owner_lockout {
    use super::*;

    #[test]
    fn clamps_mog_owner_to_read_when_resolved_level_is_none() {
        let engine = PolicyEngine::new([make_policy(
            "mog:owner",
            AccessTarget::Workbook,
            AccessLevel::None,
            0,
        )]);
        let p = principal_with(&["mog:owner"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Read);
        // Legacy emitted a warning on clamp — preserved here so SDKs
        // can flag misconfigured owner policies.
        assert!(r.ambiguity.is_some());
    }

    #[test]
    fn clamps_mog_owner_to_read_when_resolved_level_is_structure() {
        let engine = PolicyEngine::new([make_policy(
            "mog:owner",
            AccessTarget::Workbook,
            AccessLevel::Structure,
            0,
        )]);
        let p = principal_with(&["mog:owner"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Read);
    }

    #[test]
    fn does_not_clamp_when_level_is_read_or_above() {
        let engine = PolicyEngine::new([make_policy(
            "mog:owner",
            AccessTarget::Workbook,
            AccessLevel::Read,
            0,
        )]);
        let p = principal_with(&["mog:owner"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Read);
        assert!(r.ambiguity.is_none());
    }

    #[test]
    fn does_not_clamp_non_owners() {
        let engine = PolicyEngine::new([make_policy(
            "*",
            AccessTarget::Workbook,
            AccessLevel::None,
            0,
        )]);
        let p = principal_with(&["user:alice"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::None);
    }
}

// -----------------------------------------------------------------------------
// describe('derived tags (SG-1): mog:non-owner auto-added')
// -----------------------------------------------------------------------------

mod derived_tags {
    use super::*;

    #[test]
    fn adds_mog_non_owner_when_mog_owner_is_absent() {
        let engine = PolicyEngine::new([make_policy(
            "mog:non-owner",
            AccessTarget::Workbook,
            AccessLevel::Read,
            0,
        )]);
        let p = principal_with(&["user:alice"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Read);
    }

    #[test]
    fn does_not_add_mog_non_owner_when_mog_owner_is_present() {
        let engine = PolicyEngine::new([make_policy(
            "mog:non-owner",
            AccessTarget::Workbook,
            AccessLevel::Read,
            0,
        )]);
        let p = principal_with(&["mog:owner"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        // Owner defaults to Admin with no matching policy.
        assert_eq!(r.level, AccessLevel::Admin);
    }
}

// -----------------------------------------------------------------------------
// describe('default deny')
// -----------------------------------------------------------------------------

mod default_deny {
    use super::*;

    #[test]
    fn returns_none_when_no_policies_match_and_principal_is_not_owner() {
        let engine = PolicyEngine::new(std::iter::empty());
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::None);
    }

    #[test]
    fn returns_admin_when_no_policies_match_and_principal_is_owner() {
        let engine = PolicyEngine::new(std::iter::empty());
        let p = principal_with(&["mog:owner"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::Admin);
    }

    #[test]
    fn returns_none_when_principal_has_no_tags() {
        let engine = PolicyEngine::new(std::iter::empty());
        let p = principal_with(&[]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::None);
    }
}

// -----------------------------------------------------------------------------
// describe('explainAccess')
// -----------------------------------------------------------------------------

mod explain_access {
    use super::*;

    #[test]
    fn returns_matched_policy_and_reason_for_policy_match() {
        let engine = PolicyEngine::new([make_policy(
            "agent:copilot",
            AccessTarget::Workbook,
            AccessLevel::Structure,
            0,
        )]);
        let p = principal_with(&["agent:copilot"]);
        let e = engine.explain(&p, &AccessTarget::Workbook);
        assert_eq!(e.level, AccessLevel::Structure);
        assert_eq!(e.reason, ExplainReason::PolicyMatch);
        assert!(e.matched_policy.is_some());
        assert_eq!(
            e.matched_policy.as_ref().unwrap().principal_tag.pattern(),
            "agent:copilot"
        );
        assert_eq!(e.candidate_policies.len(), 1);
        assert!(e.ambiguity.is_none());
        assert!(!e.clamp_fired);
    }

    #[test]
    fn returns_default_owner_reason_when_no_policies_match_for_owner() {
        let engine = PolicyEngine::new(std::iter::empty());
        let p = principal_with(&["mog:owner"]);
        let e = engine.explain(&p, &AccessTarget::Workbook);
        assert_eq!(e.level, AccessLevel::Admin);
        assert_eq!(e.reason, ExplainReason::DefaultOwner);
        assert!(e.matched_policy.is_none());
    }

    #[test]
    fn returns_default_deny_reason_when_no_policies_match_for_non_owner() {
        let engine = PolicyEngine::new(std::iter::empty());
        let p = principal_with(&["user:alice"]);
        let e = engine.explain(&p, &AccessTarget::Workbook);
        assert_eq!(e.level, AccessLevel::None);
        assert_eq!(e.reason, ExplainReason::DefaultDeny);
        assert!(e.matched_policy.is_none());
    }

    #[test]
    fn returns_no_tags_reason_for_empty_tags() {
        let engine = PolicyEngine::new(std::iter::empty());
        let p = principal_with(&[]);
        let e = engine.explain(&p, &AccessTarget::Workbook);
        assert_eq!(e.level, AccessLevel::None);
        assert_eq!(e.reason, ExplainReason::NoTags);
    }

    #[test]
    fn includes_warnings_for_ambiguous_policies() {
        let engine = PolicyEngine::new([
            make_policy("team:*", AccessTarget::Workbook, AccessLevel::Write, 0),
            make_policy("role:*", AccessTarget::Workbook, AccessLevel::Read, 0),
        ]);
        let p = principal_with(&["team:eng", "role:viewer"]);
        let e = engine.explain(&p, &AccessTarget::Workbook);
        assert_eq!(e.level, AccessLevel::Read);
        assert!(e.ambiguity.is_some());
    }

    #[test]
    fn includes_candidates_in_explanation() {
        let engine = PolicyEngine::new([
            make_policy(
                "agent:copilot",
                AccessTarget::Workbook,
                AccessLevel::Read,
                0,
            ),
            make_policy("*", AccessTarget::Workbook, AccessLevel::Structure, 0),
        ]);
        let p = principal_with(&["agent:copilot"]);
        let e = engine.explain(&p, &AccessTarget::Workbook);
        assert_eq!(e.candidate_policies.len(), 2);
    }

    #[test]
    fn sorted_policies_lead_with_winner() {
        let engine = PolicyEngine::new([
            make_policy("*", AccessTarget::Workbook, AccessLevel::Structure, 0),
            make_policy(
                "agent:copilot",
                AccessTarget::Workbook,
                AccessLevel::Read,
                0,
            ),
        ]);
        let p = principal_with(&["agent:copilot"]);
        let e = engine.explain(&p, &AccessTarget::Workbook);
        assert_eq!(e.sorted_policies.len(), 2);
        // More specific tag wins; should be first after sort.
        assert_eq!(
            e.sorted_policies[0].principal_tag.pattern(),
            "agent:copilot"
        );
    }

    #[test]
    fn clamp_fired_is_true_when_owner_locked_out() {
        let engine = PolicyEngine::new([make_policy(
            "mog:owner",
            AccessTarget::Workbook,
            AccessLevel::None,
            0,
        )]);
        let p = principal_with(&["mog:owner"]);
        let e = engine.explain(&p, &AccessTarget::Workbook);
        assert_eq!(e.level, AccessLevel::Read);
        assert!(e.clamp_fired);
    }
}

// -----------------------------------------------------------------------------
// describe('disabled policies')
// -----------------------------------------------------------------------------

mod disabled_policies {
    use super::*;

    #[test]
    fn ignores_disabled_policies() {
        let engine = PolicyEngine::new([make_policy_disabled(
            "agent:*",
            AccessTarget::Workbook,
            AccessLevel::Read,
            0,
        )]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::None);
    }
}

// -----------------------------------------------------------------------------
// describe('target matching')
// -----------------------------------------------------------------------------

mod target_matching {
    use super::*;

    #[test]
    fn workbook_policy_matches_sheet_target() {
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Workbook,
            AccessLevel::Read,
            0,
        )]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(&p, &AccessTarget::Sheet { sheet_id: sheet() });
        assert_eq!(r.level, AccessLevel::Read);
    }

    #[test]
    fn workbook_policy_matches_column_target() {
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Workbook,
            AccessLevel::Read,
            0,
        )]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(
            &p,
            &AccessTarget::Column {
                sheet_id: sheet(),
                col_id: col_a(),
            },
        );
        assert_eq!(r.level, AccessLevel::Read);
    }

    #[test]
    fn sheet_policy_does_not_match_workbook_target() {
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Sheet { sheet_id: sheet() },
            AccessLevel::Read,
            0,
        )]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(&p, &AccessTarget::Workbook);
        assert_eq!(r.level, AccessLevel::None);
    }

    #[test]
    fn column_policy_only_matches_the_specific_column() {
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Column {
                sheet_id: sheet(),
                col_id: col_a(),
            },
            AccessLevel::None,
            0,
        )]);
        let p = principal_with(&["agent:copilot"]);
        assert_eq!(
            engine
                .evaluate(
                    &p,
                    &AccessTarget::Column {
                        sheet_id: sheet(),
                        col_id: col_a(),
                    },
                )
                .level,
            AccessLevel::None,
        );
        // Column B has no policy → default deny.
        assert_eq!(
            engine
                .evaluate(
                    &p,
                    &AccessTarget::Column {
                        sheet_id: sheet(),
                        col_id: col_b(),
                    },
                )
                .level,
            AccessLevel::None,
        );
    }

    #[test]
    fn sheet_policy_on_a_different_sheet_does_not_apply() {
        let other_sheet = SheetId::from_raw(0x2222_2222_2222_2222_2222_2222_2222_2222);
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Sheet { sheet_id: sheet() },
            AccessLevel::Read,
            0,
        )]);
        let p = principal_with(&["agent:copilot"]);
        let r = engine.evaluate(
            &p,
            &AccessTarget::Sheet {
                sheet_id: other_sheet,
            },
        );
        assert_eq!(r.level, AccessLevel::None);
    }
}

// -----------------------------------------------------------------------------
// describe('complex scenario: Salesforce integration')
// -----------------------------------------------------------------------------

mod complex_scenarios {
    use super::*;

    #[test]
    fn finance_team_can_see_revenue_column_others_cannot() {
        let engine = PolicyEngine::new([
            make_policy("sf:user:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "sf:team:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::None,
                0,
            ),
            make_policy(
                "sf:team:finance",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::Read,
                10,
            ),
        ]);

        let finance = principal_with(&["sf:user:bob", "sf:team:finance"]);
        let eng = principal_with(&["sf:user:jane", "sf:team:engineering"]);

        assert_eq!(
            engine
                .evaluate(
                    &finance,
                    &AccessTarget::Column {
                        sheet_id: sheet(),
                        col_id: col_a(),
                    },
                )
                .level,
            AccessLevel::Read,
        );
        assert_eq!(
            engine
                .evaluate(
                    &eng,
                    &AccessTarget::Column {
                        sheet_id: sheet(),
                        col_id: col_a(),
                    },
                )
                .level,
            AccessLevel::None,
        );
        assert_eq!(
            engine.evaluate(&finance, &AccessTarget::Workbook).level,
            AccessLevel::Read,
        );
        assert_eq!(
            engine.evaluate(&eng, &AccessTarget::Workbook).level,
            AccessLevel::Read,
        );
    }
}

// -----------------------------------------------------------------------------
// Attenuation ceiling: R5.1 attenuation uses `evaluate(&Workbook)` as the
// caller's ceiling. The engine-level invariant we pin down here is that
// the attenuation ceiling is identical to the workbook evaluation.
// -----------------------------------------------------------------------------

mod attenuation {
    use super::*;

    #[test]
    fn effective_workbook_access_matches_evaluate_workbook() {
        let engine = PolicyEngine::new([make_policy(
            "user:alice",
            AccessTarget::Workbook,
            AccessLevel::Write,
            0,
        )]);
        let p = principal_with(&["user:alice"]);
        let from_evaluate = engine.evaluate(&p, &AccessTarget::Workbook).level;
        assert_eq!(from_evaluate, AccessLevel::Write);
    }

    #[test]
    fn caller_with_write_cannot_grant_admin_per_attenuation_rule() {
        // Attenuation itself is enforced in R5.1 (wb.security.add_policy);
        // here we verify the pure engine reports the caller's ceiling
        // accurately so the attenuation check can rely on it.
        let engine = PolicyEngine::new([make_policy(
            "user:alice",
            AccessTarget::Workbook,
            AccessLevel::Write,
            0,
        )]);
        let p = principal_with(&["user:alice"]);
        let ceiling = engine.evaluate(&p, &AccessTarget::Workbook).level;
        assert!(ceiling < AccessLevel::Admin);
    }
}
