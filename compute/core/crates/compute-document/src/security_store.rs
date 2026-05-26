//! Typed Yrs accessor for the `security` map.
//!
//! `SecurityStore` wraps the top-level `KEY_SECURITY` map and exposes a
//! policy-and-template CRUD API keyed by `PolicyId` / template id strings.
//! Policies are serialized as JSON per-entry (one JSON blob per `PolicyId`),
//! matching the legacy TS wire format so existing docs migrate with zero
//! conversion work. Templates record the set of policy IDs they generated
//! so `unregister_template` can remove the derived policies without a
//! reverse scan.
//!
//! The version counter lives at `security[KEY_SECURITY_VERSION]` as a bare
//! `i64` — written lazily on first mutation (the schema initializer doesn't
//! pre-create it, see `init_canonical_schema`).
//!
//! `SecurityStore` is a transient borrow over a `MapRef`; it lives only
//! inside a single transaction. R2.3's `SecurityState` will materialize a
//! fresh `SecurityStore` inside the observer callback and inside
//! `reload_policies_from_yrs`.

use std::collections::HashMap;

use compute_security::{AccessPolicy, PolicyId};
use yrs::{Any, Array, ArrayPrelim, Doc, Map, MapPrelim, MapRef, Out, ReadTxn, TransactionMut};

use crate::schema::{
    KEY_SECURITY, KEY_SECURITY_POLICIES, KEY_SECURITY_TEMPLATES, KEY_SECURITY_VERSION,
};

/// Typed wrapper over the top-level `security` Yrs map.
///
/// Holds the root `MapRef` only — sub-maps are looked up on every call so
/// the store survives sub-map re-creation by CRDT peers. The expected
/// shape is:
///
/// ```text
/// security: Map
///   ├── policies:  Map<PolicyId-as-string, JSON AccessPolicy>
///   ├── templates: Map<TemplateId-as-string, Map { "ids": [PolicyId-as-string] }>
///   └── version:   i64 (bare Any::BigInt — absent until first write)
/// ```
pub struct SecurityStore<'a> {
    sec_map: &'a MapRef,
}

impl<'a> SecurityStore<'a> {
    /// Borrow the security map for the lifetime of `sec_map`. The `_doc`
    /// and `_txn` args anchor the borrow to one specific transaction so
    /// callers can't accidentally reuse the store across disjoint txns;
    /// `SecurityStore` itself carries no doc state.
    #[must_use]
    pub fn new(sec_map: &'a MapRef, _doc: &Doc, _txn: &impl ReadTxn) -> Self {
        Self { sec_map }
    }

    /// Convenience constructor — fetch the `security` map from the doc
    /// via the read txn and return an owned wrapper.
    #[must_use]
    pub fn open(_doc: &Doc, txn: &impl ReadTxn) -> Option<SecurityStoreOwned> {
        let sec = txn.get_map(KEY_SECURITY)?;
        Some(SecurityStoreOwned { sec_map: sec })
    }

    fn policies_map<T: ReadTxn>(&self, txn: &T) -> Option<MapRef> {
        match self.sec_map.get(txn, KEY_SECURITY_POLICIES) {
            Some(Out::YMap(m)) => Some(m),
            _ => None,
        }
    }

    fn templates_map<T: ReadTxn>(&self, txn: &T) -> Option<MapRef> {
        match self.sec_map.get(txn, KEY_SECURITY_TEMPLATES) {
            Some(Out::YMap(m)) => Some(m),
            _ => None,
        }
    }

    /// Read every policy in ID-sorted order. Sorting makes the output
    /// deterministic across process runs so tests and snapshot diffs
    /// don't churn on Yrs internal iteration order.
    #[must_use]
    pub fn read_all<T: ReadTxn>(&self, txn: &T) -> Vec<AccessPolicy> {
        let Some(policies) = self.policies_map(txn) else {
            return Vec::new();
        };
        let mut out: Vec<AccessPolicy> = Vec::with_capacity(policies.len(txn) as usize);
        for (_key, value) in policies.iter(txn) {
            let Out::Any(Any::String(json)) = value else {
                continue;
            };
            // Malformed entries are silently dropped — a peer may have
            // written a corrupted record, but we refuse to poison the
            // whole policy set over one bad row.
            if let Ok(policy) = serde_json::from_str::<AccessPolicy>(&json) {
                out.push(policy);
            }
        }
        out.sort_by_key(|p| p.id.as_uuid());
        out
    }

    /// Read the version counter. Returns 0 if the counter has never been
    /// written (fresh document). Callers treat 0 as "empty policy set"
    /// and rely on `read_all` to confirm; the cache key carries the
    /// version so a 0 → 1 bump always invalidates.
    #[must_use]
    pub fn read_version<T: ReadTxn>(&self, txn: &T) -> i64 {
        match self.sec_map.get(txn, KEY_SECURITY_VERSION) {
            Some(Out::Any(Any::BigInt(n))) => n,
            Some(Out::Any(Any::Number(n))) => n as i64,
            _ => 0,
        }
    }

    /// Overwrite the version counter. Monotonicity is enforced by callers
    /// (observer + mutation paths); the store itself is unopinionated so
    /// tests can exercise regression cases.
    pub fn write_version(&self, txn: &mut TransactionMut<'_>, v: i64) {
        self.sec_map
            .insert(txn, KEY_SECURITY_VERSION, Any::BigInt(v));
    }

    /// Convenience: read + 1 + write. The typical caller path.
    pub fn bump_version(&self, txn: &mut TransactionMut<'_>) -> i64 {
        let next = self.read_version(txn).wrapping_add(1);
        self.write_version(txn, next);
        next
    }

    /// Serialize + store a policy under `policy.id`. LWW by policy id when
    /// two peers write the same id — Yrs YMap merge semantics pick the
    /// last write; we don't attempt to diff inside the JSON blob.
    pub fn add_policy(&self, txn: &mut TransactionMut<'_>, policy: &AccessPolicy) {
        let policies = self.ensure_policies_map(txn);
        let json = serde_json::to_string(policy).expect("AccessPolicy is serializable");
        policies.insert(
            txn,
            policy.id.to_string(),
            Any::String(std::sync::Arc::from(json)),
        );
        self.bump_version(txn);
    }

    /// Remove a policy by id. No-op if the id is absent — idempotent so
    /// concurrent removals don't throw.
    pub fn remove_policy(&self, txn: &mut TransactionMut<'_>, id: PolicyId) {
        if let Some(policies) = self.policies_map(txn) {
            policies.remove(txn, &id.to_string());
        }
        self.bump_version(txn);
    }

    /// Read a single policy by id. Used by `update_policy` and by SDK
    /// read methods that want to surface one policy without pulling the
    /// full set.
    #[must_use]
    pub fn read_policy<T: ReadTxn>(&self, txn: &T, id: PolicyId) -> Option<AccessPolicy> {
        let policies = self.policies_map(txn)?;
        let Out::Any(Any::String(json)) = policies.get(txn, &id.to_string())? else {
            return None;
        };
        serde_json::from_str(&json).ok()
    }

    /// Read, mutate, write. Returns `true` if the policy existed; `false`
    /// leaves the map untouched. Mutating the id field via this updater
    /// is caller error — the store writes back under the *original* id,
    /// so a mismatched id after the update silently leaves a stale key
    /// behind. Callers that need to re-key should `remove_policy` +
    /// `add_policy`.
    pub fn update_policy<F: FnOnce(&mut AccessPolicy)>(
        &self,
        txn: &mut TransactionMut<'_>,
        id: PolicyId,
        updater: F,
    ) -> bool {
        let Some(mut policy) = self.read_policy(txn, id) else {
            return false;
        };
        updater(&mut policy);
        let policies = self.ensure_policies_map(txn);
        let json = serde_json::to_string(&policy).expect("AccessPolicy is serializable");
        policies.insert(txn, id.to_string(), Any::String(std::sync::Arc::from(json)));
        self.bump_version(txn);
        true
    }

    /// Read the full `template_id → [PolicyId]` map. Used by SDK explain
    /// views and by `unregister_template` to know which policies to drop.
    #[must_use]
    pub fn read_templates<T: ReadTxn>(&self, txn: &T) -> HashMap<String, Vec<PolicyId>> {
        let mut out = HashMap::new();
        let Some(templates) = self.templates_map(txn) else {
            return out;
        };
        for (key, value) in templates.iter(txn) {
            let Out::YMap(entry) = value else {
                continue;
            };
            let ids = match entry.get(txn, "ids") {
                Some(Out::YArray(arr)) => arr,
                _ => continue,
            };
            let len = ids.len(txn);
            let mut parsed: Vec<PolicyId> = Vec::with_capacity(len as usize);
            for idx in 0..len {
                let Some(Out::Any(Any::String(s))) = ids.get(txn, idx) else {
                    continue;
                };
                if let Ok(uuid) = uuid::Uuid::parse_str(&s) {
                    parsed.push(PolicyId::from_uuid(uuid));
                }
            }
            out.insert(key.to_string(), parsed);
        }
        out
    }

    /// Record that template `id` generated `policy_ids`. Does not write
    /// the generated policies themselves — the caller does that via
    /// `add_policy` for each; the template entry is a pure bookkeeping
    /// record so `unregister_template` can locate them.
    pub fn register_template(
        &self,
        txn: &mut TransactionMut<'_>,
        id: &str,
        policy_ids: &[PolicyId],
    ) {
        let templates = self.ensure_templates_map(txn);
        let entry = MapPrelim::from([] as [(&str, Any); 0]);
        let entry_ref = templates.insert(txn, id, entry);
        let array = entry_ref.insert(txn, "ids", ArrayPrelim::default());
        // Any::String wire-form for each id — matches how the rest of the
        // Yrs schema stores stringly-typed ids (e.g. sheet hex ids).
        let values: Vec<Any> = policy_ids
            .iter()
            .map(|pid| Any::String(std::sync::Arc::from(pid.to_string())))
            .collect();
        if !values.is_empty() {
            array.insert_range(txn, 0, values);
        }
        self.bump_version(txn);
    }

    /// Remove the template entry and return the policy IDs it generated.
    /// The caller is responsible for calling `remove_policy` on each —
    /// this separation lets template unregistration run in one
    /// transaction with all policy removals, bumping the version exactly
    /// once for the overall op in the common case (the per-call bumps
    /// in `remove_policy` are defensive; LWW on the version counter
    /// means over-bumping is safe).
    pub fn unregister_template(&self, txn: &mut TransactionMut<'_>, id: &str) -> Vec<PolicyId> {
        let Some(templates) = self.templates_map(txn) else {
            return Vec::new();
        };
        let ids = match templates.get(txn, id) {
            Some(Out::YMap(entry)) => match entry.get(txn, "ids") {
                Some(Out::YArray(arr)) => {
                    let len = arr.len(txn);
                    let mut v = Vec::with_capacity(len as usize);
                    for idx in 0..len {
                        if let Some(Out::Any(Any::String(s))) = arr.get(txn, idx)
                            && let Ok(uuid) = uuid::Uuid::parse_str(&s)
                        {
                            v.push(PolicyId::from_uuid(uuid));
                        }
                    }
                    v
                }
                _ => Vec::new(),
            },
            _ => Vec::new(),
        };
        templates.remove(txn, id);
        self.bump_version(txn);
        ids
    }

    fn ensure_policies_map(&self, txn: &mut TransactionMut<'_>) -> MapRef {
        if let Some(m) = self.policies_map(txn) {
            return m;
        }
        let empty = MapPrelim::from([] as [(&str, Any); 0]);
        self.sec_map.insert(txn, KEY_SECURITY_POLICIES, empty)
    }

    fn ensure_templates_map(&self, txn: &mut TransactionMut<'_>) -> MapRef {
        if let Some(m) = self.templates_map(txn) {
            return m;
        }
        let empty = MapPrelim::from([] as [(&str, Any); 0]);
        self.sec_map.insert(txn, KEY_SECURITY_TEMPLATES, empty)
    }
}

/// Owned-MapRef variant returned by `SecurityStore::open`. Same API as the
/// borrowed form; exists only because `open` returns a `MapRef` pulled
/// from the transaction and can't satisfy the `&'a MapRef` lifetime
/// bound on `SecurityStore`.
pub struct SecurityStoreOwned {
    sec_map: MapRef,
}

impl SecurityStoreOwned {
    #[must_use]
    pub fn as_borrowed(&self) -> SecurityStore<'_> {
        SecurityStore {
            sec_map: &self.sec_map,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use compute_security::{AccessLevel, AccessPolicy, AccessTarget, PolicyMetadata, TagMatcher};
    use yrs::{Doc, Transact};

    use crate::schema::init_canonical_schema;

    fn sample_policy(tag: &str, level: AccessLevel) -> AccessPolicy {
        AccessPolicy {
            id: PolicyId::new_v4(),
            principal_tag: TagMatcher::parse(tag),
            target: AccessTarget::Workbook,
            level,
            priority: 0,
            enabled: true,
            metadata: PolicyMetadata {
                created_by: Arc::from("test"),
                created_at_millis: 1,
                template_id: None,
            },
        }
    }

    fn fresh_doc() -> Doc {
        let doc = Doc::new();
        let _ = init_canonical_schema(&doc);
        doc
    }

    /// Transaction scope with a `SecurityStore` materialized inside. We
    /// declare the `MapRef` before the txn so drop order matches the
    /// borrow — the txn drops first, then the map ref (which holds no
    /// outstanding borrow at that point).
    fn with_store<R, F>(doc: &Doc, f: F) -> R
    where
        F: for<'a> FnOnce(SecurityStore<'a>, &mut TransactionMut<'a>) -> R,
    {
        // Acquire map ref from a read txn, drop the read txn, then open
        // a write txn. Yrs `MapRef` is an Arc-backed handle and remains
        // valid across txns as long as the doc is live.
        let sec_map: MapRef = {
            let txn = doc.transact();
            txn.get_map(KEY_SECURITY).expect("security map")
        };
        let mut txn = doc.transact_mut();
        let store = SecurityStore { sec_map: &sec_map };
        f(store, &mut txn)
    }

    fn read_version(doc: &Doc) -> i64 {
        let txn = doc.transact();
        let sec: MapRef = txn.get_map(KEY_SECURITY).unwrap();
        SecurityStore { sec_map: &sec }.read_version(&txn)
    }

    fn read_all_policies(doc: &Doc) -> Vec<AccessPolicy> {
        let txn = doc.transact();
        let sec: MapRef = txn.get_map(KEY_SECURITY).unwrap();
        SecurityStore { sec_map: &sec }.read_all(&txn)
    }

    fn read_templates(doc: &Doc) -> HashMap<String, Vec<PolicyId>> {
        let txn = doc.transact();
        let sec: MapRef = txn.get_map(KEY_SECURITY).unwrap();
        SecurityStore { sec_map: &sec }.read_templates(&txn)
    }

    #[test]
    fn round_trip_single_policy() {
        let doc = fresh_doc();
        let policy = sample_policy("agent:*", AccessLevel::Read);
        with_store(&doc, |store, txn| {
            store.add_policy(txn, &policy);
        });
        let read = read_all_policies(&doc);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0], policy);
    }

    #[test]
    fn version_monotonic_on_add() {
        let doc = fresh_doc();
        let p1 = sample_policy("a", AccessLevel::Read);
        let p2 = sample_policy("b", AccessLevel::Write);
        let v0 = read_version(&doc);
        with_store(&doc, |s, t| s.add_policy(t, &p1));
        let v1 = read_version(&doc);
        with_store(&doc, |s, t| s.add_policy(t, &p2));
        let v2 = read_version(&doc);
        assert_eq!(v0, 0);
        assert!(v1 > v0);
        assert!(v2 > v1);
    }

    #[test]
    fn multi_policy_stable_order() {
        let doc = fresh_doc();
        let policies: Vec<_> = (0..5)
            .map(|i| sample_policy(&format!("agent:{i}"), AccessLevel::Read))
            .collect();
        for p in &policies {
            with_store(&doc, |s, t| s.add_policy(t, p));
        }
        let read1 = read_all_policies(&doc);
        let read2 = read_all_policies(&doc);
        assert_eq!(read1, read2, "read_all is stable within a txn");
        assert_eq!(read1.len(), 5);
        // Sort guarantee is documented — IDs monotonic in the order
        // returned.
        let mut prev = uuid::Uuid::nil();
        for p in &read1 {
            assert!(p.id.as_uuid() > prev, "read_all must be sorted by id");
            prev = p.id.as_uuid();
        }
    }

    #[test]
    fn lww_same_policy_id() {
        // Simulating LWW within a single doc: two sequential writes to
        // the same id — the second replaces the first because Yrs YMap
        // inserts by key. Across peers, the tie-break is Yrs' internal
        // ordering; in-process we verify the same-txn overwrite path.
        let doc = fresh_doc();
        let mut p = sample_policy("agent:*", AccessLevel::Read);
        with_store(&doc, |s, t| s.add_policy(t, &p));
        p.level = AccessLevel::Write;
        with_store(&doc, |s, t| s.add_policy(t, &p));
        let read = read_all_policies(&doc);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].level, AccessLevel::Write);
    }

    #[test]
    fn template_round_trip() {
        let doc = fresh_doc();
        let p1 = sample_policy("a", AccessLevel::Read);
        let p2 = sample_policy("b", AccessLevel::Structure);
        with_store(&doc, |s, t| {
            s.add_policy(t, &p1);
            s.add_policy(t, &p2);
            s.register_template(t, "protect-workbook", &[p1.id, p2.id]);
        });
        let templates = read_templates(&doc);
        assert_eq!(templates.len(), 1);
        let ids = templates.get("protect-workbook").expect("template present");
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&p1.id));
        assert!(ids.contains(&p2.id));

        let removed = with_store(&doc, |s, t| s.unregister_template(t, "protect-workbook"));
        assert_eq!(removed.len(), 2);
        let templates_after = read_templates(&doc);
        assert!(templates_after.is_empty());
    }

    #[test]
    fn update_policy_applies_and_bumps_version() {
        let doc = fresh_doc();
        let p = sample_policy("agent:*", AccessLevel::Read);
        let id = p.id;
        with_store(&doc, |s, t| s.add_policy(t, &p));
        let before = read_version(&doc);
        let ok = with_store(&doc, |s, t| {
            s.update_policy(t, id, |p| {
                p.level = AccessLevel::Admin;
            })
        });
        assert!(ok);
        let after = read_version(&doc);
        assert!(after > before);
        let txn = doc.transact();
        let sec: MapRef = txn.get_map(KEY_SECURITY).unwrap();
        let store = SecurityStore { sec_map: &sec };
        let updated = store.read_policy(&txn, id).expect("policy still present");
        assert_eq!(updated.level, AccessLevel::Admin);
    }

    #[test]
    fn remove_nonexistent_is_no_op() {
        let doc = fresh_doc();
        let bogus = PolicyId::new_v4();
        with_store(&doc, |s, t| s.remove_policy(t, bogus));
    }
}
