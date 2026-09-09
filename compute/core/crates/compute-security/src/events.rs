use serde::{Deserialize, Serialize};

use crate::level::AccessLevel;
use crate::policy::{AccessPolicy, AccessTarget, PolicyId};
use crate::principal::PrincipalTag;

/// Emitted by the engine when two or more matching policies tie on every
/// sort dimension. The engine falls back to the safer (lower) level and
/// surfaces the tie here for diagnostics. Does not fail the call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AmbiguityWarning {
    pub principal_tags: Vec<PrincipalTag>,
    pub target: AccessTarget,
    pub conflicting_policies: Vec<PolicyId>,
    pub resolved_level: AccessLevel,
}

/// Engine-side security events. Consumers live in `compute-api` and the
/// SDK event relays; this crate only defines the shapes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SecurityEvent {
    PolicyAdded {
        policy: AccessPolicy,
    },
    PolicyRemoved {
        id: PolicyId,
    },
    PolicyUpdated {
        id: PolicyId,
    },
    AccessDenied {
        // Tags as a plain list — `Principal` itself is not serialisable
        // (its canonical identity is the pool slab pointer; see
        // `compute_security::principal` and ARCHITECTURE.md §3.1). The
        // effective principal's explicit tags are what consumers need
        // for diagnostics; derived `mog:non-owner` is reconstructible.
        principal_tags: Vec<PrincipalTag>,
        target: AccessTarget,
        // Owned String so the event can round-trip through serde and across
        // the bridge; engine-side emitters supply `&'static str` literals
        // that are copied into the owned slot at construction.
        operation: String,
    },
    AmbiguityDetected {
        warning: AmbiguityWarning,
    },
    /// Notification that native policy state has been replaced.
    ///
    /// `SecurityState` publishes the new policy engine and activation flag
    /// before queuing this event. Consumers can invalidate cached policy
    /// projections using the before/after version pair and reload one
    /// consistent snapshot.
    #[serde(rename_all = "camelCase")]
    PoliciesReloaded {
        policy_version_before: i64,
        policy_version_after: i64,
        active: bool,
    },
}
