//! Per-engine security state — R2.3.
//!
//! Owns the live `PolicyEngine` (swappable via `ArcSwap`), the policy/
//! structure version counters, the `AccessMatrixCache`, and the
//! service-visible `active` flag. One instance per `YrsComputeEngine`;
//! the `ComputeService` holds a clone of the `active` flag so the gated
//! delegate's fast path can short-circuit without touching the engine.
//!
//! Invariants:
//! - `reload_policies_from_yrs` is the single entry point that rebuilds
//!   the `PolicyEngine` and publishes `active`. Called at engine init
//!   (seed-on-load) and from the Yrs observer on every `security` map
//!   change.
//! - `bump_structure_version` is called on every structural op so
//!   column-indexed matrices cached against the old layout become cache
//!   misses. Never touches `active` — structural ops don't add or
//!   remove policies.
//! - `active_matrix` is the R2 primitive; R3.1 will wrap it on the
//!   engine side. Callers materialize the `ColumnIndex` on the engine
//!   thread — the trait is `&dyn`-passed and engine-thread only (R1
//!   design pin).
//! - `SecurityState::evaluate` is the lightweight path used by
//!   `effective_access`. It falls through without caching when the
//!   principal is not pool-interned (passing a non-interned `Principal`
//!   doesn't poison the cache: the identity slot would point to a
//!   pointer that will be freed when the `Principal` drops, and a
//!   future intern of the same tags could recycle that address and
//!   collide with a stale entry — so the only sound answer is "don't
//!   cache this one").

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use arc_swap::ArcSwap;
use cell_types::SheetId;
use compute_document::SecurityStore;
use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, AmbiguityWarning, ColumnIndex, PolicyEngine, PolicyId,
    Principal, PrincipalTag, SecurityEvent, SheetAccessMatrix,
};
use yrs::{DeepObservable, Doc, Map, MapRef, ReadTxn, Subscription, Transact};

use compute_document::schema::KEY_SECURITY;

use super::engine::security_events::SecurityEventBuffer;
use super::security_cache::AccessMatrixCache;

/// Dedup key for `AmbiguityDetected` events (R9.2). Fingerprint is
/// order-independent on `conflicting_policies` (sorted `Vec<PolicyId>`)
/// so iteration-order variance at the emission site doesn't defeat
/// dedup. Principal is captured as its sorted tag list — the interned
/// slab pointer is session-local and wouldn't survive a principal-swap
/// + re-intern round-trip, but the tag list is canonical and stable.
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

/// Sharable inner block — the `Arc<SecurityInner>` is what the observer
/// callback captures (via `Weak`) and what the engine-thread accessors
/// dereference. Splitting this from the outer `SecurityState` means the
/// `Subscription` (which is `!Send + !Sync`) can live on the outer
/// struct while everything the observer touches is safely shareable.
struct SecurityInner {
    engine: ArcSwap<PolicyEngine>,
    policy_version: AtomicI64,
    structure_version: AtomicI64,
    cache: AccessMatrixCache,
    /// True iff the policy set is non-empty. Cloned into `ComputeService`
    /// so the delegate fast path is a single relaxed load.
    active: Arc<AtomicBool>,
    /// Shared handle to the engine's `SecurityEventBuffer`. Holding it
    /// here — via the same `Arc<SecurityInner>` the deep-observer
    /// closure captures — is the only way the observer callback can
    /// push `PoliciesReloaded` events without naming engine internals.
    /// The engine stores a second `Arc` to the same buffer; drain
    /// works identically whether the event came from a local CRUD
    /// method or a remote Yrs sync.
    ///
    /// Optional so the `SecurityState::new` constructor (used by unit
    /// tests that don't wire up an event buffer) can skip the
    /// allocation — production construction via
    /// `SecurityState::with_event_buffer` always supplies one.
    event_buffer: Option<Arc<SecurityEventBuffer>>,
    /// Per-`policy_version` dedup set for `AmbiguityDetected` events
    /// (R9.2). Fingerprint-keyed (principal tags + target +
    /// sorted conflicting policy IDs) so iteration-order variance
    /// doesn't defeat dedup. Cleared by `publish_policies` when the
    /// policy version bumps, so a re-introduced ambiguity re-emits
    /// against the new version. Cap TODO: 256 with LRU eviction if
    /// profiling shows bloat (risk-register item); today the set is
    /// naturally bounded by the number of distinct ambiguities in the
    /// current policy set × principals queried since last publish.
    ambiguity_dedup: Mutex<HashSet<AmbiguityFingerprint>>,
}

/// Aggregate of the engine-side security machinery.
pub struct SecurityState {
    inner: Arc<SecurityInner>,
    /// Yrs subscription on the `security` map — kept alive so the
    /// callback fires for the lifetime of the engine. `Subscription`
    /// is `!Send + !Sync`, which is fine because `YrsComputeEngine`
    /// itself is pinned to the engine thread.
    _subscription: Option<Subscription>,
}

impl SecurityState {
    /// Build a new `SecurityState` and **seed it from `doc`**. The Yrs
    /// observer only fires on transitions, so a freshly-loaded snapshot
    /// that already contains policies would otherwise leave `active ==
    /// false` and let the first call run un-gated. We call
    /// `reload_policies_from_yrs` here so the seeded state matches the
    /// doc's contents before any service call is accepted.
    ///
    /// The Yrs `observe_deep` subscription on the `security` map is
    /// registered as part of construction and kept alive on `self`. The
    /// callback closes over a `Weak<SecurityInner>`; when the engine
    /// drops, the Weak fails to upgrade and the callback becomes a
    /// no-op, so late-arriving events during engine teardown don't
    /// UAF.
    #[must_use]
    pub fn new(doc: &Doc) -> Self {
        Self::build(doc, None)
    }

    /// Construct a `SecurityState` wired to the engine's shared event
    /// buffer. Production callers use this so the observer-driven
    /// `PoliciesReloaded` emissions land in the same buffer as the
    /// `PolicyAdded` / `PolicyRemoved` events produced by the local
    /// CRUD methods — SDK consumers drain one place and see every
    /// change.
    #[must_use]
    pub fn with_event_buffer(doc: &Doc, buffer: Arc<SecurityEventBuffer>) -> Self {
        Self::build(doc, Some(buffer))
    }

    fn build(doc: &Doc, event_buffer: Option<Arc<SecurityEventBuffer>>) -> Self {
        let inner = Arc::new(SecurityInner {
            engine: ArcSwap::from_pointee(PolicyEngine::new(std::iter::empty::<AccessPolicy>())),
            policy_version: AtomicI64::new(0),
            structure_version: AtomicI64::new(0),
            cache: AccessMatrixCache::default_bound(),
            active: Arc::new(AtomicBool::new(false)),
            event_buffer,
            ambiguity_dedup: Mutex::new(HashSet::new()),
        });
        // Seed from the initial snapshot before handing the state out.
        reload_policies_into(&inner, doc);

        // Attach the observer. We snapshot the doc for reload_from inside
        // the callback — Yrs subscription callbacks only receive the
        // `TransactionMut` that fired them, not the owning doc, so we
        // take a `Doc` clone (cheap — it's an Arc internally).
        let subscription = attach_security_observer(doc, &inner);

        Self {
            inner,
            _subscription: subscription,
        }
    }

    /// Clone the shared activation flag for `ComputeService` to observe
    /// without reaching into the engine. The flag is `Arc<AtomicBool>`
    /// so there is one source of truth; the delegate layer pays one
    /// relaxed load per call.
    #[must_use]
    pub fn active_handle(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.inner.active)
    }

    /// Returns the current value of `active` without going through the
    /// shared `Arc<AtomicBool>`. Convenience for the engine's own code
    /// paths (R3.1 primitives); outside callers use `active_handle`.
    #[must_use]
    pub fn is_active(&self) -> bool {
        self.inner.active.load(Ordering::Relaxed)
    }

    /// Current policy version counter. Bumped by every
    /// `reload_policies_from_yrs` call (observer fires on every write
    /// to the `security` map).
    #[must_use]
    pub fn policy_version(&self) -> i64 {
        self.inner.policy_version.load(Ordering::Acquire)
    }

    /// Current structure version counter. Bumped by every structural
    /// op via `bump_structure_version`.
    #[must_use]
    pub fn structure_version(&self) -> i64 {
        self.inner.structure_version.load(Ordering::Acquire)
    }

    /// Load the `PolicyEngine` pointer. `ArcSwap::load` is a lockfree
    /// fence-pair; readers don't contend with a concurrent observer
    /// rebuild.
    #[must_use]
    pub fn policy_engine(&self) -> Arc<PolicyEngine> {
        self.inner.engine.load_full()
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
        let engine = self.inner.engine.load_full();
        let pv = self.inner.policy_version.load(Ordering::Acquire);
        let sv = self.inner.structure_version.load(Ordering::Acquire);
        // Pass the principal itself so the cache can pin the tag slab —
        // closes the address-reuse aliasing window documented in
        // `storage::security_cache`.
        let matrix = self.inner.cache.get_or_build(principal, sheet, pv, sv, || {
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
        let engine = self.inner.engine.load_full();
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
        let Some(buffer) = self.inner.event_buffer.as_ref() else {
            return;
        };
        let fingerprint = AmbiguityFingerprint::from_warning(warning);
        let mut guard = self
            .inner
            .ambiguity_dedup
            .lock()
            .expect("ambiguity dedup poisoned");
        if !guard.insert(fingerprint) {
            return;
        }
        drop(guard);
        super::engine::security_events::push_on(
            buffer,
            SecurityEvent::AmbiguityDetected {
                warning: warning.clone(),
            },
        );
    }

    /// Rebuild the engine from the current Yrs document. Called from
    /// `SecurityState::new` (seed on load) and from the Yrs observer on
    /// every mutation of the `security` map.
    ///
    /// Thread-safety: the method is safe to invoke from the engine
    /// thread concurrently with a `load_full` read on a gated call in
    /// flight. `ArcSwap::store` publishes the new `PolicyEngine`
    /// atomically; the version counter bumps happen with
    /// `Release`-tier ordering so a reader that sees `active == true`
    /// (via its own `Acquire` load) is guaranteed to see the matching
    /// `policy_version` and the matching engine.
    pub fn reload_policies_from_yrs(&self, doc: &Doc) {
        reload_policies_into(&self.inner, doc);
    }

    /// Bump the structure version counter. Called from every
    /// structural op on `YrsComputeEngine` (insert/delete row/col,
    /// move, rename, add/delete sheet). Does not touch `active`
    /// because structural ops don't add or remove policies.
    pub fn bump_structure_version(&self) {
        self.inner.structure_version.fetch_add(1, Ordering::AcqRel);
    }

    /// Drop every cache entry. Not used on the hot path (the cache
    /// invalidates via key changes, not wholesale eviction) but handy
    /// for tests and for a future "engine replaced" hook.
    pub fn clear_cache(&self) {
        self.inner.cache.clear();
    }
}

fn reload_policies_into(inner: &Arc<SecurityInner>, doc: &Doc) {
    let txn = doc.transact();
    let Some(sec_map): Option<MapRef> = txn.get_map(KEY_SECURITY) else {
        publish_policies(inner, Vec::new());
        return;
    };
    let store = SecurityStore::new(&sec_map, doc, &txn);
    let policies = store.read_all(&txn);
    publish_policies(inner, policies);
}

/// Variant of `reload_policies_into` that reads through an existing
/// `impl ReadTxn` borrow — used by the Yrs `observe_deep` callback,
/// which fires *inside* the commit of a `TransactionMut`. Opening a
/// fresh `doc.transact()` from inside the callback would deadlock
/// against the in-flight mut txn; we reuse the callback's txn instead.
fn reload_policies_from_txn<T: ReadTxn>(inner: &Arc<SecurityInner>, sec_map: &MapRef, txn: &T) {
    let mut out: Vec<AccessPolicy> = Vec::new();
    if let Some(yrs::Out::YMap(policies_map)) =
        sec_map.get(txn, compute_document::schema::KEY_SECURITY_POLICIES)
    {
        for (_k, v) in policies_map.iter(txn) {
            if let yrs::Out::Any(yrs::Any::String(json)) = v
                && let Ok(p) = serde_json::from_str::<AccessPolicy>(&json)
            {
                out.push(p);
            }
        }
        out.sort_by_key(|p| p.id.as_uuid());
    }
    publish_policies(inner, out);
}

fn publish_policies(inner: &Arc<SecurityInner>, policies: Vec<AccessPolicy>) {
    let is_empty = policies.is_empty();
    let new_engine = PolicyEngine::new(policies);
    // Snapshot the policy_version BEFORE the bump so the emitted event
    // carries the "before" counter — consumers cache-keyed on the
    // counter can identify which publish they're reacting to even if
    // several back-to-back CRUD writes coalesce into one drain.
    let version_before = inner.policy_version.load(Ordering::Acquire);
    inner.engine.store(Arc::new(new_engine));
    let version_after = inner.policy_version.fetch_add(1, Ordering::AcqRel) + 1;
    inner.active.store(!is_empty, Ordering::Release);

    // R9.2: clear the ambiguity dedup set on every policy-version bump.
    // A re-introduced tie (same fingerprint, new policy revision) must
    // re-emit against the new version; conversely the matrix-build
    // site populates the set afresh from the new matrix's warnings.
    if let Ok(mut guard) = inner.ambiguity_dedup.lock() {
        guard.clear();
    }

    // Emit PoliciesReloaded AFTER `ArcSwap::store` AND `active.store`
    // complete — a consumer that receives the event is guaranteed to
    // see the new `PolicyEngine` and the new `active` flag when they
    // re-read the engine's state. Swapping this ordering (emit before
    // the stores) would let an observer read stale state.
    if let Some(buffer) = inner.event_buffer.as_ref() {
        super::engine::security_events::push_on(
            buffer,
            SecurityEvent::PoliciesReloaded {
                policy_version_before: version_before,
                policy_version_after: version_after,
                active: !is_empty,
            },
        );
    }
}

/// Register an `observe_deep` subscription on the `security` map that
/// reloads policies whenever the map changes. Returns `None` if the
/// security map doesn't exist on the doc (non-canonical test fixtures);
/// the subscription is boxed by Yrs and must be held to keep the
/// callback alive.
///
/// The callback fires inside the committing `TransactionMut`. Reading
/// via `doc.transact()` from inside the callback would deadlock
/// against the mut txn (Yrs serializes read/write on the same doc),
/// so we read directly from the callback's `TransactionMut`.
fn attach_security_observer(doc: &Doc, inner: &Arc<SecurityInner>) -> Option<Subscription> {
    let sec_map: MapRef = {
        let txn = doc.transact();
        txn.get_map(KEY_SECURITY)?
    };
    // Hold a weak ref so the callback doesn't keep the inner alive
    // past engine drop — a late event after drop simply no-ops.
    let weak = Arc::downgrade(inner);
    let sec_map_for_cb = sec_map.clone();
    Some(sec_map.observe_deep(move |txn, _events| {
        let Some(inner) = weak.upgrade() else {
            return;
        };
        reload_policies_from_txn(&inner, &sec_map_for_cb, txn);
    }))
}

impl std::fmt::Debug for SecurityState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SecurityState")
            .field("active", &self.inner.active.load(Ordering::Relaxed))
            .field(
                "policy_version",
                &self.inner.policy_version.load(Ordering::Acquire),
            )
            .field(
                "structure_version",
                &self.inner.structure_version.load(Ordering::Acquire),
            )
            .field("cache", &self.inner.cache)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use compute_document::SecurityStore;
    use compute_document::schema::init_canonical_schema;
    use compute_security::{
        AccessLevel, AccessPolicy, AccessTarget, PolicyId, PolicyMetadata, PrincipalPool,
        PrincipalTag, TagMatcher,
    };
    use yrs::{Doc, MapRef, Transact};

    fn policy(tag: &str, level: AccessLevel) -> AccessPolicy {
        AccessPolicy {
            id: PolicyId::new_v4(),
            principal_tag: TagMatcher::parse(tag),
            target: AccessTarget::Workbook,
            level,
            priority: 0,
            enabled: true,
            metadata: PolicyMetadata {
                created_by: Arc::from("t"),
                created_at_millis: 0,
                template_id: None,
            },
        }
    }

    fn with_doc_and_store<R>(
        doc: &Doc,
        f: impl for<'a> FnOnce(SecurityStore<'a>, &mut yrs::TransactionMut<'a>) -> R,
    ) -> R {
        let sec_map: MapRef = {
            let txn = doc.transact();
            txn.get_map(KEY_SECURITY).expect("security map")
        };
        let mut txn = doc.transact_mut();
        let store = SecurityStore::new(&sec_map, doc, &txn);
        f(store, &mut txn)
    }

    #[test]
    fn seed_on_load_activates_if_policies_present() {
        let doc = Doc::new();
        let _ = init_canonical_schema(&doc);
        with_doc_and_store(&doc, |s, t| {
            s.add_policy(t, &policy("agent:*", AccessLevel::Read))
        });
        let state = SecurityState::new(&doc);
        assert!(
            state.is_active(),
            "seed-on-load must flip active when the snapshot has policies"
        );
        assert!(state.policy_version() > 0);
    }

    #[test]
    fn empty_doc_remains_inactive() {
        let doc = Doc::new();
        let _ = init_canonical_schema(&doc);
        let state = SecurityState::new(&doc);
        assert!(!state.is_active());
    }

    #[test]
    fn reload_flips_active_true_and_bumps_version() {
        let doc = Doc::new();
        let _ = init_canonical_schema(&doc);
        let state = SecurityState::new(&doc);
        let v0 = state.policy_version();
        with_doc_and_store(&doc, |s, t| {
            s.add_policy(t, &policy("a", AccessLevel::Read))
        });
        state.reload_policies_from_yrs(&doc);
        assert!(state.is_active());
        assert!(state.policy_version() > v0);
    }

    #[test]
    fn reload_flips_active_false_when_policy_removed() {
        let doc = Doc::new();
        let _ = init_canonical_schema(&doc);
        let p = policy("a", AccessLevel::Read);
        let pid = p.id;
        with_doc_and_store(&doc, |s, t| s.add_policy(t, &p));
        let state = SecurityState::new(&doc);
        assert!(state.is_active());
        with_doc_and_store(&doc, |s, t| s.remove_policy(t, pid));
        state.reload_policies_from_yrs(&doc);
        assert!(!state.is_active());
    }

    #[test]
    fn bump_structure_version_changes_counter() {
        let doc = Doc::new();
        let _ = init_canonical_schema(&doc);
        let state = SecurityState::new(&doc);
        let v0 = state.structure_version();
        state.bump_structure_version();
        assert_eq!(state.structure_version(), v0 + 1);
    }

    #[test]
    fn active_matrix_cached_across_calls() {
        use cell_types::{ColId, SheetId};
        struct StubCols(Vec<ColId>);
        impl ColumnIndex for StubCols {
            fn position_of(&self, col: ColId) -> Option<u32> {
                self.0.iter().position(|c| *c == col).map(|p| p as u32)
            }
            fn column_count(&self) -> u32 {
                self.0.len() as u32
            }
        }
        let doc = Doc::new();
        let _ = init_canonical_schema(&doc);
        let state = SecurityState::new(&doc);
        let pool = PrincipalPool::new();
        let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));
        let sheet = SheetId::from_raw(0x1);
        let cols = StubCols(vec![]);

        let m1 = state.active_matrix(&p, sheet, &cols);
        let m2 = state.active_matrix(&p, sheet, &cols);
        assert!(Arc::ptr_eq(&m1, &m2));

        // Bump structure version — next fetch should be a fresh Arc.
        state.bump_structure_version();
        let m3 = state.active_matrix(&p, sheet, &cols);
        assert!(!Arc::ptr_eq(&m1, &m3));
    }
}
