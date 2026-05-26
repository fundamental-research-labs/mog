//! Policy resolution engine (§4 of ARCHITECTURE.md).
//!
//! Pure: holds only the policy list. No Yrs, no cache, no principal pool
//! awareness. The `SecurityState` in `compute-core` (R2.3) swaps fresh
//! `PolicyEngine` instances into an `ArcSwap` on every Yrs change; the
//! cache keyed on `PrincipalIdentity` + version numbers lives there.

use std::sync::Arc;

use cell_types::SheetId;
use serde::{Deserialize, Serialize};

use crate::events::AmbiguityWarning;
use crate::level::AccessLevel;
use crate::matrix::{ColumnIndex, SheetAccessMatrix};
use crate::policy::{AccessPolicy, AccessTarget, PolicyId};
use crate::principal::{OWNER_TAG, Principal, PrincipalTag};
use crate::tag_match::TagSpecificity;

/// Resolution result for a single target. `matched` is the winning policy;
/// `None` means the default path fired (owner → `Admin`, else `None`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvalResult {
    pub level: AccessLevel,
    pub matched: Option<PolicyId>,
    pub ambiguity: Option<AmbiguityWarning>,
}

/// Why a resolution returned the level it did. Matches the legacy TS
/// `explainAccess.reason` codes so SDK diagnostics round-trip unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExplainReason {
    /// At least one policy matched; the winner drove the level.
    PolicyMatch,
    /// No policy matched and the principal has `mog:owner` — defaulted to
    /// `Admin`.
    DefaultOwner,
    /// No policy matched and principal is not the owner — defaulted to
    /// `None`.
    DefaultDeny,
    /// Principal had no explicit tags at all (derived `mog:non-owner`
    /// still applies but no policy referenced it) — effectively a deny,
    /// surfaced separately so SDK can distinguish "unauthenticated" from
    /// "authenticated but not allowed".
    NoTags,
}

/// Full derivation trace. One shape; R7 UIs consume this.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessExplanation {
    /// Principal + derived tags fed into the resolver.
    pub effective_tags: Vec<PrincipalTag>,
    /// Policies that passed the tag + target + enabled filter, in the
    /// pre-sort (engine-insertion) order. Included so a reviewer can see
    /// what survived filtering without re-running the engine.
    pub candidate_policies: Vec<AccessPolicy>,
    /// The same set after the §4.1 sort — first entry is the winner (if
    /// non-empty).
    pub sorted_policies: Vec<AccessPolicy>,
    /// The resolved policy, or `None` when the default path fired.
    pub matched_policy: Option<AccessPolicy>,
    pub level: AccessLevel,
    /// Present when two or more candidates tied on every sort dimension.
    pub ambiguity: Option<AmbiguityWarning>,
    /// True iff §4.1 step 5 (owner-lockout floor) lifted the level from
    /// below `Read` up to `Read`.
    pub clamp_fired: bool,
    pub reason: ExplainReason,
}

#[derive(Clone)]
pub struct PolicyEngine {
    policies: Arc<[AccessPolicy]>,
}

impl PolicyEngine {
    #[must_use]
    pub fn new(policies: impl IntoIterator<Item = AccessPolicy>) -> Self {
        let v: Vec<AccessPolicy> = policies.into_iter().collect();
        Self {
            policies: Arc::from(v.into_boxed_slice()),
        }
    }

    #[must_use]
    pub fn policies(&self) -> &[AccessPolicy] {
        &self.policies
    }

    #[must_use]
    pub fn evaluate(&self, principal: &Principal, target: &AccessTarget) -> EvalResult {
        let effective: Vec<&PrincipalTag> = principal.effective_tags().collect();
        let candidates = filter_candidates(&self.policies, &effective, target);
        let (level, matched, ambiguity, _clamp_fired, _reason) = resolve(
            &effective,
            target,
            &candidates,
            principal_has_owner(&effective),
        );
        EvalResult {
            level,
            matched: matched.map(|p| p.id),
            ambiguity,
        }
    }

    /// Build the per-column matrix for a sheet. `sheet_default` is
    /// `evaluate(principal, AccessTarget::Sheet { sheet_id })`; column
    /// overrides come from any policy whose target is
    /// `AccessTarget::Column { sheet_id, .. }` and whose `col_id` resolves
    /// through `col_positions`. Column policies referencing deleted
    /// columns (`position_of` → `None`) are silently dropped — the matrix
    /// is a snapshot of the *current* layout and a deleted column has no
    /// position to pin an override to.
    #[must_use]
    pub fn evaluate_sheet(
        &self,
        principal: &Principal,
        sheet_id: SheetId,
        col_positions: &dyn ColumnIndex,
    ) -> SheetAccessMatrix {
        let effective: Vec<&PrincipalTag> = principal.effective_tags().collect();
        let has_owner = principal_has_owner(&effective);

        // Sheet default reuses the full resolver against the sheet target.
        // Walking all policies (rather than a filtered subset) is fine —
        // evaluate_sheet runs once per (principal, sheet, policy_version)
        // and is cached by the matrix cache (R2.2).
        let sheet_target = AccessTarget::Sheet { sheet_id };
        let sheet_candidates = filter_candidates(&self.policies, &effective, &sheet_target);
        let (sheet_default, _matched, sheet_ambig, _clamp, _reason) =
            resolve(&effective, &sheet_target, &sheet_candidates, has_owner);

        let col_count = col_positions.column_count();
        let mut col_overrides: Vec<AccessLevel> = (0..col_count).map(|_| sheet_default).collect();
        let mut column_warnings: Vec<AmbiguityWarning> = Vec::new();
        let mut touched: Vec<bool> = vec![false; col_count as usize];

        // Group column-level candidates by the column position so each
        // position resolves through the same sort + clamp path the scalar
        // evaluate() uses.
        for policy in self.policies.iter() {
            let AccessTarget::Column {
                sheet_id: ps,
                col_id,
            } = &policy.target
            else {
                continue;
            };
            if *ps != sheet_id {
                continue;
            }
            let Some(pos) = col_positions.position_of(*col_id) else {
                continue;
            };
            if pos >= col_count {
                continue;
            }
            if touched[pos as usize] {
                continue;
            }
            touched[pos as usize] = true;
            let col_target = AccessTarget::Column {
                sheet_id,
                col_id: *col_id,
            };
            let col_candidates = filter_candidates(&self.policies, &effective, &col_target);
            let (lvl, _matched, ambig, _clamp, _reason) =
                resolve(&effective, &col_target, &col_candidates, has_owner);
            col_overrides[pos as usize] = lvl;
            if let Some(w) = ambig {
                column_warnings.push(w);
            }
        }

        let mut warnings = Vec::new();
        if let Some(w) = sheet_ambig {
            warnings.push(w);
        }
        warnings.extend(column_warnings);

        SheetAccessMatrix::new(
            sheet_default,
            col_overrides.into_boxed_slice(),
            warnings.into_boxed_slice(),
        )
    }

    #[must_use]
    pub fn explain(&self, principal: &Principal, target: &AccessTarget) -> AccessExplanation {
        let effective_refs: Vec<&PrincipalTag> = principal.effective_tags().collect();
        let effective_tags: Vec<PrincipalTag> =
            effective_refs.iter().map(|t| (*t).clone()).collect();

        let candidates = filter_candidates(&self.policies, &effective_refs, target);
        let candidate_policies: Vec<AccessPolicy> =
            candidates.iter().map(|p| (*p).clone()).collect();

        let has_owner = principal_has_owner(&effective_refs);
        let mut sorted_refs: Vec<&AccessPolicy> = candidates.clone();
        sort_candidates(&mut sorted_refs, target);
        let sorted_policies: Vec<AccessPolicy> = sorted_refs.iter().map(|p| (*p).clone()).collect();

        let (level, matched, ambiguity, clamp_fired, reason) =
            resolve(&effective_refs, target, &candidates, has_owner);

        // `NoTags` takes precedence over `DefaultDeny` for diagnostics —
        // an SDK user needs to know their call is effectively unauthenticated
        // (principal has no explicit tags) vs. authenticated-but-denied.
        let reason = if principal.tags().is_empty() && matches!(reason, ExplainReason::DefaultDeny)
        {
            ExplainReason::NoTags
        } else {
            reason
        };

        AccessExplanation {
            effective_tags,
            candidate_policies,
            sorted_policies,
            matched_policy: matched.cloned(),
            level,
            ambiguity,
            clamp_fired,
            reason,
        }
    }
}

impl std::fmt::Debug for PolicyEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PolicyEngine")
            .field("policies", &self.policies.len())
            .finish()
    }
}

// ----------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------

fn principal_has_owner(effective: &[&PrincipalTag]) -> bool {
    effective.iter().any(|t| t.as_str() == OWNER_TAG)
}

/// A policy's target "applies to" a query target when the policy's scope
/// is equal-to or broader-than the query. Workbook → everything; sheet →
/// any column on the same sheet; column → only the exact column.
fn target_applies(policy_target: &AccessTarget, query: &AccessTarget) -> bool {
    match (policy_target, query) {
        (AccessTarget::Workbook, _) => true,
        (AccessTarget::Sheet { sheet_id: a }, AccessTarget::Sheet { sheet_id: b }) => a == b,
        (AccessTarget::Sheet { sheet_id: a }, AccessTarget::Column { sheet_id: b, .. }) => a == b,
        (
            AccessTarget::Column {
                sheet_id: a,
                col_id: ca,
            },
            AccessTarget::Column {
                sheet_id: b,
                col_id: cb,
            },
        ) => a == b && ca == cb,
        _ => false,
    }
}

fn filter_candidates<'a>(
    policies: &'a [AccessPolicy],
    effective: &[&PrincipalTag],
    target: &AccessTarget,
) -> Vec<&'a AccessPolicy> {
    policies
        .iter()
        .filter(|p| p.enabled)
        .filter(|p| target_applies(&p.target, target))
        .filter(|p| effective.iter().any(|tag| p.principal_tag.matches(tag)))
        .collect()
}

/// Numeric specificity of a policy target for sorting. Higher is more
/// specific; ties are broken by tag specificity then priority.
fn target_specificity(t: &AccessTarget) -> u8 {
    match t {
        AccessTarget::Workbook => 0,
        AccessTarget::Sheet { .. } => 1,
        AccessTarget::Column { .. } => 2,
    }
}

fn sort_candidates(candidates: &mut [&AccessPolicy], _query: &AccessTarget) {
    // Stable sort so policies equal on every dimension keep insertion
    // order — matters for the ambiguity collector below, which lists
    // conflicting IDs in stable order.
    candidates.sort_by(|a, b| {
        let a_t = target_specificity(&a.target);
        let b_t = target_specificity(&b.target);
        let a_ts: TagSpecificity = a.principal_tag.specificity();
        let b_ts: TagSpecificity = b.principal_tag.specificity();
        b_t.cmp(&a_t)
            .then(b_ts.cmp(&a_ts))
            .then(b.priority.cmp(&a.priority))
    });
}

/// Resolution core shared by `evaluate`, `evaluate_sheet`, and `explain`.
/// Returns `(level, winning_policy, ambiguity, clamp_fired, reason)`.
fn resolve<'a>(
    effective: &[&PrincipalTag],
    target: &AccessTarget,
    candidates: &[&'a AccessPolicy],
    has_owner: bool,
) -> (
    AccessLevel,
    Option<&'a AccessPolicy>,
    Option<AmbiguityWarning>,
    bool,
    ExplainReason,
) {
    let mut sorted: Vec<&AccessPolicy> = candidates.to_vec();
    sort_candidates(&mut sorted, target);

    // No matching policy → default path.
    let Some(winner) = sorted.first().copied() else {
        let (level, reason) = if has_owner {
            (AccessLevel::Admin, ExplainReason::DefaultOwner)
        } else {
            (AccessLevel::None, ExplainReason::DefaultDeny)
        };
        return (level, None, None, false, reason);
    };

    // Find the tie group on the top sort dimensions (target + tag + priority).
    // Members with a *different* level form the ambiguity.
    let w_target = target_specificity(&winner.target);
    let w_tag = winner.principal_tag.specificity();
    let w_prio = winner.priority;

    let tie_group: Vec<&AccessPolicy> = sorted
        .iter()
        .take_while(|p| {
            target_specificity(&p.target) == w_target
                && p.principal_tag.specificity() == w_tag
                && p.priority == w_prio
        })
        .copied()
        .collect();

    // Apply SG-3 tie-break: pick the lowest (safest) level among the tie
    // group; if the group contains more than one distinct level, emit an
    // ambiguity warning.
    let mut resolved_level = winner.level;
    let mut resolved_policy: &AccessPolicy = winner;
    let mut levels_seen: std::collections::BTreeSet<AccessLevel> =
        std::collections::BTreeSet::new();
    for p in &tie_group {
        levels_seen.insert(p.level);
        if p.level < resolved_level {
            resolved_level = p.level;
            resolved_policy = *p;
        }
    }

    // §4.1 step 5 — owner-lockout floor. When the clamp lifts the level,
    // emit an ambiguity warning too: the author of the lockout policy
    // wrote `None` or `Structure` for a `mog:owner` principal, and we
    // overrode it. That's a notable anomaly — surfacing it here matches
    // legacy semantics and lets SDKs flag misconfigured owner policies.
    let (level_after_clamp, clamp_fired) = if has_owner && resolved_level < AccessLevel::Read {
        (AccessLevel::Read, true)
    } else {
        (resolved_level, false)
    };

    let ambiguity = if levels_seen.len() > 1 {
        Some(AmbiguityWarning {
            principal_tags: effective.iter().map(|t| (*t).clone()).collect(),
            target: target.clone(),
            conflicting_policies: tie_group.iter().map(|p| p.id).collect(),
            resolved_level: level_after_clamp,
        })
    } else if clamp_fired {
        Some(AmbiguityWarning {
            principal_tags: effective.iter().map(|t| (*t).clone()).collect(),
            target: target.clone(),
            conflicting_policies: vec![resolved_policy.id],
            resolved_level: level_after_clamp,
        })
    } else {
        None
    };

    (
        level_after_clamp,
        Some(resolved_policy),
        ambiguity,
        clamp_fired,
        ExplainReason::PolicyMatch,
    )
}
