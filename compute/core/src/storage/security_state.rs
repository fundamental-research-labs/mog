//! Native security policies, access-matrix caches, and change notifications.
//!
//! The policy engine owns the sole policy list. Mutations publish a new immutable
//! list on the engine thread, invalidate cached decisions by version, and update
//! the activation flag shared with the API delegate before returning.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use cell_types::SheetId;
use compute_security::{
    AccessLevel, AccessPolicy, AccessPolicyPatch, AccessTarget, AmbiguityWarning, ColumnIndex,
    PolicyEngine, PolicyId, Principal, PrincipalTag, SecurityEvent, SheetAccessMatrix,
};

use super::engine::security_events::SecurityEventBuffer;
use super::security_cache::AccessMatrixCache;

#[derive(Hash, Eq, PartialEq, Clone, Debug)]
struct AmbiguityFingerprint {
    principal_tags: Vec<PrincipalTag>,
    target: AccessTarget,
    conflicting_policies: Vec<PolicyId>,
}

impl AmbiguityFingerprint {
    fn from_warning(w: &AmbiguityWarning) -> Self {
        let mut tags = w.principal_tags.clone();
        tags.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        let mut policies = w.conflicting_policies.clone();
        policies.sort_by_key(|id| id.as_uuid());
        Self {
            principal_tags: tags,
            target: w.target.clone(),
            conflicting_policies: policies,
        }
    }
}

/// Security state owned by one engine. Only the activation flag and immutable
/// policy views are shared with callers; mutation requires exclusive access.
#[derive(Debug)]
pub struct SecurityState {
    engine: Arc<PolicyEngine>,
    templates: HashMap<String, Vec<PolicyId>>,
    policy_version: i64,
    structure_version: AtomicI64,
    cache: AccessMatrixCache,
    active: Arc<AtomicBool>,
    event_buffer: Option<Arc<SecurityEventBuffer>>,
    ambiguity_dedup: Mutex<HashSet<AmbiguityFingerprint>>,
}

impl Default for SecurityState {
    fn default() -> Self {
        Self::build(None)
    }
}

impl SecurityState {
    #[must_use]
    pub(crate) fn with_event_buffer(buffer: Arc<SecurityEventBuffer>) -> Self {
        Self::build(Some(buffer))
    }

    fn build(event_buffer: Option<Arc<SecurityEventBuffer>>) -> Self {
        Self {
            engine: Arc::new(PolicyEngine::new([])),
            templates: HashMap::new(),
            policy_version: 0,
            structure_version: AtomicI64::new(0),
            cache: AccessMatrixCache::default_bound(),
            active: Arc::new(AtomicBool::new(false)),
            event_buffer,
            ambiguity_dedup: Mutex::new(HashSet::new()),
        }
    }

    /// Policies are kept in stable UUID order for deterministic API responses.
    pub fn policies(&self) -> &[AccessPolicy] {
        self.engine.policies()
    }

    pub(crate) fn add_policy(&mut self, policy: AccessPolicy) {
        let mut policies = self.policies().to_vec();
        match policies.binary_search_by_key(&policy.id.as_uuid(), |p| p.id.as_uuid()) {
            Ok(index) => policies[index] = policy,
            Err(index) => policies.insert(index, policy),
        }
        self.publish_policies(policies);
    }

    pub(crate) fn remove_policy(&mut self, id: PolicyId) {
        let mut policies = self.policies().to_vec();
        policies.retain(|p| p.id != id);
        self.publish_policies(policies);
    }

    pub(crate) fn update_policy(&mut self, id: PolicyId, patch: &AccessPolicyPatch) {
        let mut policies = self.policies().to_vec();
        if let Some(policy) = policies.iter_mut().find(|p| p.id == id) {
            patch.apply(policy);
            self.publish_policies(policies);
        }
    }

    /// Apply an already validated template in one publication. Retain all IDs
    /// from repeated applications so removing a template cannot orphan policies.
    pub(crate) fn apply_template(&mut self, id: String, generated: &[AccessPolicy]) {
        let mut policies = self.policies().to_vec();
        policies.extend_from_slice(generated);
        policies.sort_by_key(|p| p.id.as_uuid());
        self.templates
            .entry(id)
            .or_default()
            .extend(generated.iter().map(|p| p.id));
        self.publish_policies(policies);
    }

    pub(crate) fn remove_template(&mut self, id: &str) -> Vec<PolicyId> {
        let ids = self.templates.remove(id).unwrap_or_default();
        let removed: HashSet<_> = ids.iter().copied().collect();
        let mut policies = self.policies().to_vec();
        policies.retain(|p| !removed.contains(&p.id));
        self.publish_policies(policies);
        ids
    }

    fn publish_policies(&mut self, policies: Vec<AccessPolicy>) {
        if policies == self.policies() {
            return;
        }
        let active = !policies.is_empty();
        let version_before = self.policy_version;
        self.engine = Arc::new(PolicyEngine::new(policies));
        self.policy_version += 1;
        self.ambiguity_dedup
            .get_mut()
            .expect("ambiguity dedup poisoned")
            .clear();
        self.active.store(active, Ordering::Release);
        if let Some(buffer) = self.event_buffer.as_ref() {
            buffer.push(SecurityEvent::PoliciesReloaded {
                policy_version_before: version_before,
                policy_version_after: self.policy_version,
                active,
            });
        }
    }

    /// Clone the shared activation flag for `ComputeService` to observe
    /// without reaching into the engine. The flag is `Arc<AtomicBool>`
    /// so there is one source of truth; the delegate layer pays one
    /// relaxed load per call.
    #[must_use]
    pub fn active_handle(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.active)
    }

    /// Returns the current value of `active` without going through the
    /// shared `Arc<AtomicBool>`. Convenience for the engine's own code
    /// paths (R3.1 primitives); outside callers use `active_handle`.
    #[must_use]
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }

    /// Current policy version counter. Bumped by every
    /// native policy mutation.
    #[must_use]
    pub fn policy_version(&self) -> i64 {
        self.policy_version
    }

    /// Current structure version counter. Bumped by every structural
    /// op via `bump_structure_version`.
    #[must_use]
    pub fn structure_version(&self) -> i64 {
        self.structure_version.load(Ordering::Acquire)
    }

    /// Share an immutable view of the current policies.
    #[must_use]
    pub fn policy_engine(&self) -> Arc<PolicyEngine> {
        Arc::clone(&self.engine)
    }

    /// Peek at the cached matrix for `(principal, sheet)` at the
    /// current version pair, building it via
    /// `PolicyEngine::evaluate_sheet` on miss. The `col_idx` callback
    /// is `&dyn ColumnIndex` and is evaluated on the engine thread —
    /// callers (R3.1) build the adapter around whatever in-memory grid
    /// they already have.
    ///
    /// R9.2: per-column `AmbiguityWarning`s carried on the matrix are
    /// emitted as `AmbiguityDetected` events, deduped within the
    /// current `policy_version` scope. Matrix builds are the
    /// single source of per-column ambiguity visibility — cell/range
    /// gating reads the matrix directly and never consults
    /// `PolicyEngine::evaluate`, so without this emission per-column
    /// ambiguities are silent.
    pub fn active_matrix(
        &self,
        principal: &Principal,
        sheet: SheetId,
        col_idx: &dyn ColumnIndex,
    ) -> Arc<SheetAccessMatrix> {
        let engine = Arc::clone(&self.engine);
        let pv = self.policy_version;
        let sv = self.structure_version.load(Ordering::Acquire);
        // Pass the principal itself so the cache can pin the tag slab —
        // closes the address-reuse aliasing window documented in
        // `storage::security_cache`.
        let matrix = self.cache.get_or_build(principal, sheet, pv, sv, || {
            engine.evaluate_sheet(principal, sheet, col_idx)
        });
        // Emit + dedup. On a cache hit, every warning has already been
        // fingerprinted on first build and the dedup set short-circuits
        // re-emission; on a fresh build, the dedup set is populated by
        // the emitter. Either way, one event per unique fingerprint
        // per `policy_version`.
        for warning in matrix.warnings() {
            self.emit_ambiguity(warning);
        }
        matrix
    }

    /// Resolve effective access for a target — wraps the pure engine's
    /// `evaluate`. No cache: targets are shallow lookups (workbook,
    /// sheet, single column) and R5.1 uses this path only for
    /// attenuation and explain_access, both low-frequency.
    ///
    /// R1 design pin: this path accepts un-interned principals without
    /// side effects on the cache — evaluation uses only the tag set,
    /// not `principal.identity()`. The matrix cache is the only place
    /// that keys on identity, and we never touch it here.
    ///
    /// R9.2: when the underlying `EvalResult` carries an
    /// `ambiguity: Some(AmbiguityWarning)`, emit an
    /// `AmbiguityDetected` event before returning the level.
    /// `sheet` / `workbook` / `explain` / `effective_access` paths
    /// route through here — the matrix-build emission doesn't cover
    /// workbook-scope evaluations, so without this site workbook-level
    /// ambiguities are silent.
    #[must_use]
    pub fn evaluate(&self, principal: &Principal, target: &AccessTarget) -> AccessLevel {
        let engine = Arc::clone(&self.engine);
        let result = engine.evaluate(principal, target);
        if let Some(w) = &result.ambiguity {
            self.emit_ambiguity(w);
        }
        result.level
    }

    /// Emit `AmbiguityDetected` with policy-version-scoped dedup.
    /// Fingerprint is the order-independent tuple (principal_tags,
    /// target, sorted conflicting_policies) so a warning produced
    /// at both the matrix-build site and a subsequent `evaluate` call
    /// hashes to the same slot. Policy-version bump (see
    /// `publish_policies`) clears the set so a re-introduced
    /// ambiguity re-fires under the new version.
    fn emit_ambiguity(&self, warning: &AmbiguityWarning) {
        let Some(buffer) = self.event_buffer.as_ref() else {
            return;
        };
        let fingerprint = AmbiguityFingerprint::from_warning(warning);
        let mut guard = self
            .ambiguity_dedup
            .lock()
            .expect("ambiguity dedup poisoned");
        if !guard.insert(fingerprint) {
            return;
        }
        drop(guard);
        buffer.push(SecurityEvent::AmbiguityDetected {
            warning: warning.clone(),
        });
    }

    /// Invalidate column-indexed access matrices after a structural edit.
    pub fn bump_structure_version(&self) {
        self.structure_version.fetch_add(1, Ordering::AcqRel);
    }

    pub fn clear_cache(&self) {
        self.cache.clear();
    }
}

#[cfg(test)]
mod tests;
