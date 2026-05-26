//! Bridged security operations — R5.1.
//!
//! Flat `wb_security_*` methods that SDKs bind directly; the TS and Python
//! `wb.security` facades forward to these one-for-one. Writes go through
//! `SecurityStore` so the Yrs observer fires, rebuilds the live
//! `PolicyEngine`, and flips `active` — the `#[bridge::write(needs_principal)]`
//! contract bypasses the delegate fast path so attenuation runs on the
//! very first policy-add (bootstrap case, ARCHITECTURE.md §8.1).
//!
//! Reads take `scope = "workbook"` because policy metadata is workbook-
//! scoped (not per-cell); the delegate's workbook-scope read path does a
//! single `check_write` at Read level and returns the payload without
//! matrix-level redaction.

use std::sync::Arc;

use bridge_core as bridge;
use compute_document::SecurityStore;
use compute_document::schema::KEY_SECURITY;
use compute_security::{
    AccessExplanation, AccessLevel, AccessPolicy, AccessPolicyPatch, AccessTarget, PolicyId,
    Principal, SecurityError, SecurityEvent, Template,
};
use value_types::ComputeError;
use yrs::{MapRef, ReadTxn, Transact};

use super::YrsComputeEngine;
use super::security_events::push_event;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "security_ops",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Mutations — all `#[bridge::write(needs_principal)]`
    // -------------------------------------------------------------------

    /// Add a policy after checking caller attenuation. The delegate's
    /// outer `check_write` gates the call against the caller's
    /// workbook-level Write access; the inner attenuation check here
    /// enforces that the caller cannot grant a higher level than they
    /// themselves hold (prevents privilege escalation even when the
    /// caller has Write on the workbook).
    #[bridge::write(scope = "workbook", needs_principal)]
    pub fn wb_security_add_policy(
        &mut self,
        policy: AccessPolicy,
        caller: &Principal,
    ) -> Result<PolicyId, ComputeError> {
        check_attenuation(self, caller, policy.level)?;
        let policy_id = policy.id;
        with_security_store_mut(self, |store, txn| {
            store.add_policy(txn, &policy);
        })?;
        push_event(self, SecurityEvent::PolicyAdded { policy });
        Ok(policy_id)
    }

    /// Remove a policy by ID. Idempotent at the store layer; we still
    /// emit the event for every call because SDK consumers expect a
    /// notification even on a redundant remove (matches the security-store
    /// semantic: every CRUD call produces a subscriber tick).
    #[bridge::write(scope = "workbook", needs_principal)]
    pub fn wb_security_remove_policy(
        &mut self,
        id: PolicyId,
        _caller: &Principal,
    ) -> Result<(), ComputeError> {
        with_security_store_mut(self, |store, txn| {
            store.remove_policy(txn, id);
        })?;
        push_event(self, SecurityEvent::PolicyRemoved { id });
        Ok(())
    }

    /// Apply a partial update to an existing policy. Re-runs the
    /// attenuation check when `level` is the thing being patched —
    /// demoting is always safe; upgrading a policy's level past the
    /// caller's ceiling is the same escalation class that
    /// `add_policy` guards against.
    #[bridge::write(scope = "workbook", needs_principal)]
    pub fn wb_security_update_policy(
        &mut self,
        id: PolicyId,
        patch: AccessPolicyPatch,
        caller: &Principal,
    ) -> Result<(), ComputeError> {
        if let Some(level) = patch.level {
            check_attenuation(self, caller, level)?;
        }
        with_security_store_mut(self, |store, txn| {
            store.update_policy(txn, id, |p| patch.apply(p));
        })?;
        push_event(self, SecurityEvent::PolicyUpdated { id });
        Ok(())
    }

    /// Apply a template — generate its policy list, run each through
    /// the attenuation gate, write to Yrs, and register the template
    /// record so `remove_template` can tear them down. Failure in the
    /// middle of the loop is not atomic: Yrs is single-writer on the
    /// engine thread, so partial state is bounded by the first failing
    /// policy and the caller can retry after fixing attenuation.
    #[bridge::write(scope = "workbook", needs_principal)]
    pub fn wb_security_apply_template(
        &mut self,
        template: Template,
        caller: &Principal,
    ) -> Result<Vec<PolicyId>, ComputeError> {
        let template_id = template.id().to_string();
        let policies = template.generate();
        let mut created: Vec<PolicyId> = Vec::with_capacity(policies.len());
        for policy in &policies {
            check_attenuation(self, caller, policy.level)?;
            created.push(policy.id);
        }
        with_security_store_mut(self, |store, txn| {
            for policy in &policies {
                store.add_policy(txn, policy);
            }
            store.register_template(txn, &template_id, &created);
        })?;
        for policy in policies {
            push_event(self, SecurityEvent::PolicyAdded { policy });
        }
        Ok(created)
    }

    /// Remove every policy that was emitted by a prior
    /// `apply_template` under the same `template_id`. The Yrs store
    /// owns the template → policy-id mapping; we read it back,
    /// iterate, and issue per-policy removes.
    #[bridge::write(scope = "workbook", needs_principal)]
    pub fn wb_security_remove_template(
        &mut self,
        template_id: String,
        _caller: &Principal,
    ) -> Result<(), ComputeError> {
        let ids = with_security_store_mut(self, |store, txn| {
            let removed = store.unregister_template(txn, &template_id);
            for id in &removed {
                store.remove_policy(txn, *id);
            }
            removed
        })?;
        for id in ids {
            push_event(self, SecurityEvent::PolicyRemoved { id });
        }
        Ok(())
    }

    // -------------------------------------------------------------------
    // Reads — workbook-scoped
    // -------------------------------------------------------------------

    /// List every policy currently in the doc, in stable (id-sorted)
    /// order. The `SecurityStore::read_all` contract guarantees
    /// determinism across process runs so SDK-side diffing works.
    #[bridge::read(scope = "workbook")]
    pub fn wb_security_list_policies(&self) -> Vec<AccessPolicy> {
        with_security_store_read(self, |store, txn| store.read_all(txn)).unwrap_or_default()
    }

    /// Resolve the caller's effective access for `target`. The delegate
    /// materialises an anonymous principal for the `None` case, so the
    /// engine always receives a concrete `Principal`; we need a
    /// `caller` param only on mutating methods (attenuation). For
    /// read-only introspection we use the current active principal
    /// implicitly via the delegate's per-call materialisation — but
    /// this primitive bypasses gated post-filter because policy
    /// metadata is workbook-scoped.
    ///
    /// Signature takes the principal as a `Vec<String>` tag list — not
    /// a `Principal` value — because `Principal` is not serialisable
    /// across the bridge (its canonical identity is the pool slab
    /// pointer; see `compute_security::principal`). The engine
    /// does not use a `needs_principal` flag here because that
    /// attribute is reserved for writes; we accept the caller
    /// explicitly so SDKs can explain access for *any* principal, not
    /// only the active one (security-store behavior; the TS `explainAccess`
    /// accepted an `AccessPrincipal` argument and the Python surface
    /// mirrors that).
    ///
    /// The engine constructs a fresh, un-interned `Principal` from the
    /// tag list for evaluation — identity is irrelevant for the pure
    /// `evaluate`/`explain` path (it uses only the tag set, not the
    /// slab pointer; R1 design pin). See `security_state::evaluate` /
    /// `SecurityState::active_matrix` for the opposite contract, where
    /// identity *is* load-bearing and callers thread a pool-interned
    /// `Principal` through.
    #[bridge::read(scope = "workbook")]
    pub fn wb_security_effective_access(
        &self,
        target: AccessTarget,
        principal_tags: Vec<String>,
    ) -> AccessLevel {
        let principal = Principal::from_tags(principal_tags);
        self.security.evaluate(&principal, &target)
    }

    /// Full derivation trace for diagnostics. The shape matches
    /// `compute_security::engine::AccessExplanation` — one-to-one
    /// from the pure engine's `explain` method. Takes `Vec<String>`
    /// for the same reason as `wb_security_effective_access`.
    #[bridge::read(scope = "workbook")]
    pub fn wb_security_explain_access(
        &self,
        target: AccessTarget,
        principal_tags: Vec<String>,
    ) -> AccessExplanation {
        let principal = Principal::from_tags(principal_tags);
        let engine = self.security.policy_engine();
        engine.explain(&principal, &target)
    }

    /// Drain pending security events (R5.4). SDK bindings call this on
    /// a tick and re-fan-out the returned list via their native event
    /// bus. Emptying the buffer is cooperative — callers that don't
    /// drain will eventually see the oldest events evicted when the
    /// ring buffer fills (see `SecurityEventBuffer`).
    #[bridge::read(scope = "workbook")]
    pub fn wb_security_drain_events(&self) -> Vec<SecurityEvent> {
        self.security_events.drain()
    }
}

// =======================================================================
// Internals
// =======================================================================

/// Common attenuation check body. Called by `add_policy`, `update_policy`
/// (when `level` is patched), and `apply_template` (per generated policy).
///
/// Kept as a free function rather than an `&self` method so it's reusable
/// from both `&mut self` methods and would-be test helpers without the
/// re-borrow dance through `&self`-only methods on `YrsComputeEngine`.
fn check_attenuation(
    engine: &YrsComputeEngine,
    caller: &Principal,
    requested: AccessLevel,
) -> Result<(), ComputeError> {
    let caller_ceiling = engine.security.evaluate(caller, &AccessTarget::Workbook);
    if requested > caller_ceiling {
        let err: SecurityError = SecurityError::AttenuationViolation {
            requested,
            caller: caller_ceiling,
        };
        return Err(err.into());
    }
    Ok(())
}

/// Open the `security` Yrs map for a read-only transaction and hand the
/// borrowed `SecurityStore` to `f`. Returns `None` when the security map
/// doesn't exist (test fixtures sometimes bypass the canonical schema
/// init) — the bridged reads treat that as "no policies" rather than
/// panic.
fn with_security_store_read<R>(
    engine: &YrsComputeEngine,
    f: impl for<'a, 'b> FnOnce(SecurityStore<'a>, &yrs::Transaction<'b>) -> R,
) -> Option<R> {
    let doc = engine.stores.storage.doc();
    let txn = doc.transact();
    let sec_map: MapRef = txn.get_map(KEY_SECURITY)?;
    let store = SecurityStore::new(&sec_map, doc, &txn);
    Some(f(store, &txn))
}

/// Open the `security` Yrs map for a mutating transaction. `f` returns
/// `R`; we re-hydrate the policy engine by nudging
/// `reload_policies_from_yrs` after the transaction drops so the
/// observer-side publish fires on the refreshed snapshot. The observer
/// already runs inside the `TransactionMut` commit — this is belt-and-
/// suspenders for the in-process path where the observer subscription
/// may not have fired yet (notably for tests running against a doc
/// whose observer was never attached, e.g. custom fixture setups).
fn with_security_store_mut<R>(
    engine: &mut YrsComputeEngine,
    f: impl for<'a> FnOnce(SecurityStore<'a>, &mut yrs::TransactionMut<'a>) -> R,
) -> Result<R, ComputeError> {
    let result = {
        let doc = engine.stores.storage.doc();
        let sec_map: MapRef = {
            let read_txn = doc.transact();
            match read_txn.get_map(KEY_SECURITY) {
                Some(m) => m,
                None => {
                    drop(read_txn);
                    return Err(ComputeError::Eval {
                        message: "security map not initialised on doc".to_string(),
                    });
                }
            }
        };
        let mut txn = doc.transact_mut();
        let store = SecurityStore::new(&sec_map, doc, &txn);
        f(store, &mut txn)
    };
    // The deep-observer on the security map fires during commit (inside
    // the TransactionMut drop) and rebuilds the live PolicyEngine — but
    // we still call reload here as a safety net for tests that construct
    // a doc without going through `SecurityState::new`. In production
    // paths this is a redundant rebuild against identical state; the
    // cost is one policy-list read and one ArcSwap store, well under
    // the §12 budget for this rare path.
    let doc = engine.stores.storage.doc();
    let doc_cloned: yrs::Doc = doc.clone();
    engine.security.reload_policies_from_yrs(&doc_cloned);
    Ok(result)
}

// Shared one-shot accessor for tests and the events module below — a
// convenience for binding `Arc<AccessPolicy>` in event payloads without
// repeating the borrow dance. Currently unused outside this module but
// retained for symmetry with the TS security-store API.
#[allow(dead_code)]
pub(crate) fn read_policy_arc(
    engine: &YrsComputeEngine,
    id: PolicyId,
) -> Option<Arc<AccessPolicy>> {
    with_security_store_read(engine, |store, txn| store.read_policy(txn, id))
        .flatten()
        .map(Arc::new)
}
