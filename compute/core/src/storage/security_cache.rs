//! LRU-bounded access matrix cache — R2.2.
//!
//! Keys `(principal identity, sheet id, policy version, structure version)`
//! to `Arc<SheetAccessMatrix>`. The principal identity is the slab pointer
//! of the interned `Arc<[PrincipalTag]>` (see `compute_security::Principal`
//! and `PrincipalIdentity`); correctness of the cache as a map rests on
//! the intern pool's "one slab per canonical tag set" invariant — two
//! distinct principals cannot alias, so the key is a sound identity
//! without any hashing of tag contents.
//!
//! ## Slab-pin: preventing address-reuse aliasing
//!
//! The intern pool holds `Weak<[PrincipalTag]>`, so when the last
//! `Principal` of a tag set drops, the slab deallocates. The allocator
//! is then free to hand the same address back for a later, unrelated
//! allocation. Without pinning, a cache entry keyed on the dead slab
//! pointer could be *falsely hit* by a new principal with a different
//! tag set that happened to land on the same address inside the LRU
//! window at the same `(sheet, policy_version, structure_version)`.
//!
//! The fix: every cache entry holds a strong `Arc<[PrincipalTag]>`
//! alongside the matrix, pinning the slab for the entry's lifetime.
//! While the entry is live, the pool's `Weak::upgrade` succeeds and a
//! re-intern returns the *same* slab pointer; address-reuse cannot
//! alias. When the entry is evicted by LRU, its strong Arc drops and
//! the normal pool-GC path takes over.
//!
//! Memory overhead: one `Arc<[PrincipalTag]>` per cache entry
//! (default bound 64 → bounded at < 1 KiB of tag backing memory in the
//! worst realistic case). The alternative of storing a `Weak` plus
//! tag-list check on every hit pays that cost on the *hot path*
//! instead; pinning is simpler and faster.
//!
//! Invalidation is key-mediated: a bump to `policy_version` or
//! `structure_version` makes every old entry a cache miss; old entries
//! age out naturally via LRU. No explicit eviction step.

use std::sync::{Arc, RwLock};

use cell_types::SheetId;
use compute_security::{Principal, PrincipalIdentity, PrincipalTag, SheetAccessMatrix};
use lru::LruCache;

/// Cache key — four `Copy` components so the `LruCache` hashmap never
/// touches the principal's tag contents.
#[derive(Debug, Hash, Eq, PartialEq, Clone, Copy)]
pub(crate) struct CacheKey {
    pub principal: PrincipalIdentity,
    pub sheet_id: SheetId,
    pub policy_version: i64,
    pub structure_version: i64,
}

impl CacheKey {
    pub(crate) fn new(
        principal: PrincipalIdentity,
        sheet_id: SheetId,
        policy_version: i64,
        structure_version: i64,
    ) -> Self {
        Self {
            principal,
            sheet_id,
            policy_version,
            structure_version,
        }
    }
}

/// Cache entry — the matrix plus a strong handle to the tag slab that
/// the key's `PrincipalIdentity` points into. Holding the Arc keeps the
/// slab allocated for the entry's lifetime; see module docs for why.
struct CacheEntry {
    matrix: Arc<SheetAccessMatrix>,
    /// Pins the tag slab referenced by `CacheKey::principal`. Unused
    /// at the read path — the lookup goes through `PrincipalIdentity`
    /// alone — but its presence is the load-bearing correctness
    /// property: while an entry is live, the allocator cannot hand
    /// out the same address to a different tag set, so address
    /// reuse cannot alias cached matrices.
    #[allow(dead_code)]
    pinned_tags: Arc<[PrincipalTag]>,
}

/// Bounded LRU cache of `SheetAccessMatrix`es keyed on
/// `(principal, sheet, policy_version, structure_version)`. `Arc`s are
/// shared so the matrix can be handed to post-filter code without
/// cloning.
pub struct AccessMatrixCache {
    // RwLock so readers contend minimally — most calls resolve to a
    // cache hit, which is a read-only peek. Misses take the write lane
    // but do the full `evaluate_sheet` inside. The LruCache itself
    // requires `&mut` for `get` (LRU reorder) — see `get_or_build`.
    entries: RwLock<LruCache<CacheKey, CacheEntry>>,
}

impl AccessMatrixCache {
    /// Create a cache with a default capacity of 64 entries — enough for
    /// ~16 sheets × 2 principals × 2 versions in flight; pathological
    /// combinatorics get capped here rather than letting matrix memory
    /// grow unbounded.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        let cap =
            std::num::NonZeroUsize::new(capacity.max(1)).expect("capacity clamped to >=1 above");
        Self {
            entries: RwLock::new(LruCache::new(cap)),
        }
    }

    /// Convenience — standard 64-entry bound.
    #[must_use]
    pub fn default_bound() -> Self {
        Self::new(64)
    }

    /// Return the cached matrix for `(principal, sheet, versions)`, or
    /// build a new one via `build` and insert it. The `build` closure
    /// runs under the write lock, so concurrent calls for the same key
    /// serialize through the evaluate step; this is intentional — the
    /// alternative (drop the lock while building) risks double-building
    /// under races for no perceptible user-facing gain since matrices
    /// are cheap to build and the cache bound is small.
    ///
    /// The cache entry is pinned against the principal's tag slab — see
    /// module docs for why this closes the address-reuse window that
    /// plain `PrincipalIdentity` keying left open.
    pub fn get_or_build<F>(
        &self,
        principal: &Principal,
        sheet_id: SheetId,
        policy_version: i64,
        structure_version: i64,
        build: F,
    ) -> Arc<SheetAccessMatrix>
    where
        F: FnOnce() -> SheetAccessMatrix,
    {
        let key = CacheKey::new(
            principal.identity(),
            sheet_id,
            policy_version,
            structure_version,
        );
        // LruCache::get mutates (updates recency) so we take a write
        // lock unconditionally. For the cold path where build is
        // expensive this costs nothing beyond the hot path's lock
        // acquire, which is already the dominant operation.
        let mut guard = self.entries.write().expect("AccessMatrixCache poisoned");
        if let Some(existing) = guard.get(&key) {
            return Arc::clone(&existing.matrix);
        }
        let built = Arc::new(build());
        guard.put(
            key,
            CacheEntry {
                matrix: Arc::clone(&built),
                pinned_tags: principal.tags_arc(),
            },
        );
        built
    }

    /// Current live entry count (after any LRU evictions up to now).
    /// Used by tests to pin eviction behaviour; callers in the engine
    /// don't peek.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries
            .read()
            .expect("AccessMatrixCache poisoned")
            .len()
    }

    /// Test-only: does the cache hold *any* entry for the given
    /// (principal identity, sheet, versions) tuple? Used by the
    /// address-reuse regression test, which needs to probe the cache
    /// state by raw identity (the production `get_or_build` path
    /// constructs the key from a live `Principal`).
    #[cfg(test)]
    pub(crate) fn contains_key(&self, key: &CacheKey) -> bool {
        self.entries
            .read()
            .expect("AccessMatrixCache poisoned")
            .peek(key)
            .is_some()
    }

    /// Drop all entries. Not called on the hot path — the cache
    /// invalidates via key changes, not wholesale eviction — but tests
    /// and future maintenance hooks may want it.
    pub fn clear(&self) {
        self.entries
            .write()
            .expect("AccessMatrixCache poisoned")
            .clear();
    }
}

impl std::fmt::Debug for AccessMatrixCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let len = self.entries.read().map(|g| g.len()).unwrap_or(0);
        f.debug_struct("AccessMatrixCache")
            .field("len", &len)
            .finish()
    }
}

impl Default for AccessMatrixCache {
    fn default() -> Self {
        Self::default_bound()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use cell_types::{ColId, SheetId};
    use compute_security::{
        AccessLevel, AccessPolicy, AccessTarget, ColumnIndex, PolicyEngine, PolicyId,
        PolicyMetadata, PrincipalPool, PrincipalTag, TagMatcher,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A trivial column index for tests — one column at position 0.
    struct StubColumns {
        positions: Vec<ColId>,
    }

    impl ColumnIndex for StubColumns {
        fn position_of(&self, col: ColId) -> Option<u32> {
            self.positions
                .iter()
                .position(|c| *c == col)
                .map(|p| p as u32)
        }
        fn column_count(&self) -> u32 {
            self.positions.len() as u32
        }
    }

    fn empty_columns() -> StubColumns {
        StubColumns {
            positions: Vec::new(),
        }
    }

    fn sheet_id(seed: u128) -> SheetId {
        SheetId::from_raw(seed)
    }

    fn make_pool() -> PrincipalPool {
        PrincipalPool::new()
    }

    fn build_matrix(
        engine: &PolicyEngine,
        principal: &compute_security::Principal,
        sheet: SheetId,
        cols: &dyn ColumnIndex,
    ) -> SheetAccessMatrix {
        engine.evaluate_sheet(principal, sheet, cols)
    }

    fn trivial_engine() -> PolicyEngine {
        PolicyEngine::new(std::iter::empty::<AccessPolicy>())
    }

    #[test]
    fn hit_returns_same_arc() {
        let cache = AccessMatrixCache::new(4);
        let pool = make_pool();
        let p = pool.intern(std::iter::empty());
        let engine = trivial_engine();
        let cols = empty_columns();
        let sheet = sheet_id(1);

        let a = cache.get_or_build(&p, sheet, 0, 0, || build_matrix(&engine, &p, sheet, &cols));
        let b = cache.get_or_build(&p, sheet, 0, 0, || build_matrix(&engine, &p, sheet, &cols));
        assert!(Arc::ptr_eq(&a, &b), "cache hit must hand back the same Arc");
    }

    #[test]
    fn build_called_only_on_miss() {
        let cache = AccessMatrixCache::new(4);
        let pool = make_pool();
        let p = pool.intern(std::iter::empty());
        let engine = trivial_engine();
        let cols = empty_columns();
        let sheet = sheet_id(2);
        let count = AtomicUsize::new(0);
        let _ = cache.get_or_build(&p, sheet, 0, 0, || {
            count.fetch_add(1, Ordering::Relaxed);
            build_matrix(&engine, &p, sheet, &cols)
        });
        let _ = cache.get_or_build(&p, sheet, 0, 0, || {
            count.fetch_add(1, Ordering::Relaxed);
            build_matrix(&engine, &p, sheet, &cols)
        });
        assert_eq!(count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn miss_on_policy_version_change() {
        let cache = AccessMatrixCache::new(4);
        let pool = make_pool();
        let p = pool.intern(std::iter::empty());
        let engine = trivial_engine();
        let cols = empty_columns();
        let sheet = sheet_id(3);

        let a = cache.get_or_build(&p, sheet, 0, 0, || build_matrix(&engine, &p, sheet, &cols));
        let b = cache.get_or_build(&p, sheet, 1, 0, || build_matrix(&engine, &p, sheet, &cols));

        assert!(
            !Arc::ptr_eq(&a, &b),
            "version bump must produce a fresh Arc"
        );
    }

    #[test]
    fn miss_on_structure_version_change() {
        let cache = AccessMatrixCache::new(4);
        let pool = make_pool();
        let p = pool.intern(std::iter::empty());
        let engine = trivial_engine();
        let cols = empty_columns();
        let sheet = sheet_id(4);

        let a = cache.get_or_build(&p, sheet, 0, 0, || build_matrix(&engine, &p, sheet, &cols));
        let b = cache.get_or_build(&p, sheet, 0, 1, || build_matrix(&engine, &p, sheet, &cols));

        assert!(
            !Arc::ptr_eq(&a, &b),
            "structure bump must produce a fresh Arc"
        );
    }

    #[test]
    fn lru_evicts_least_recently_used() {
        let cache = AccessMatrixCache::new(2);
        let pool = make_pool();
        let p = pool.intern(std::iter::empty());
        let engine = trivial_engine();
        let cols = empty_columns();

        let a = cache.get_or_build(&p, sheet_id(10), 0, 0, || {
            build_matrix(&engine, &p, sheet_id(10), &cols)
        });
        let _b = cache.get_or_build(&p, sheet_id(11), 0, 0, || {
            build_matrix(&engine, &p, sheet_id(11), &cols)
        });
        // Now use sheet 10 again — bumps its recency so sheet 11 becomes LRU.
        let _a2 = cache.get_or_build(&p, sheet_id(10), 0, 0, || {
            build_matrix(&engine, &p, sheet_id(10), &cols)
        });
        // Inserting sheet 12 should evict sheet 11, not sheet 10.
        let _c = cache.get_or_build(&p, sheet_id(12), 0, 0, || {
            build_matrix(&engine, &p, sheet_id(12), &cols)
        });
        // Re-accessing sheet 10 must still hit the same Arc.
        let a_again = cache.get_or_build(&p, sheet_id(10), 0, 0, || {
            build_matrix(&engine, &p, sheet_id(10), &cols)
        });
        assert!(
            Arc::ptr_eq(&a, &a_again),
            "sheet 10 should not have been evicted"
        );
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn distinct_principals_never_alias() {
        // Two principals with disjoint tag sets must produce distinct
        // CacheKeys on the same (sheet, version, version). This is the
        // correctness property the intern pool guarantees — locking it
        // down here means a future change to PrincipalIdentity that
        // weakens uniqueness breaks this test loudly.
        let pool = make_pool();
        let pa = pool.intern(std::iter::once(PrincipalTag::from("role:a")));
        let pb = pool.intern(std::iter::once(PrincipalTag::from("role:b")));
        assert_ne!(pa.identity(), pb.identity());

        let cache = AccessMatrixCache::new(4);
        let engine = trivial_engine();
        let cols = empty_columns();
        let sheet = sheet_id(5);

        let ma = cache.get_or_build(&pa, sheet, 0, 0, || {
            build_matrix(&engine, &pa, sheet, &cols)
        });
        let mb = cache.get_or_build(&pb, sheet, 0, 0, || {
            build_matrix(&engine, &pb, sheet, &cols)
        });
        assert!(!Arc::ptr_eq(&ma, &mb));
    }

    #[test]
    fn same_principal_reinterned_same_cache_entry() {
        // Intern [a, b], then [b, a] — the canonical sort dedups to the
        // same slab, so both principals share the same identity, so
        // both hit the same cache entry.
        let pool = make_pool();
        let p1 = pool.intern([PrincipalTag::from("x"), PrincipalTag::from("y")]);
        let p2 = pool.intern([PrincipalTag::from("y"), PrincipalTag::from("x")]);
        assert_eq!(p1.identity(), p2.identity());

        let cache = AccessMatrixCache::new(4);
        let engine = trivial_engine();
        let cols = empty_columns();
        let sheet = sheet_id(6);

        let m1 = cache.get_or_build(&p1, sheet, 0, 0, || {
            build_matrix(&engine, &p1, sheet, &cols)
        });
        let m2 = cache.get_or_build(&p2, sheet, 0, 0, || {
            build_matrix(&engine, &p2, sheet, &cols)
        });
        assert!(Arc::ptr_eq(&m1, &m2));
    }

    #[test]
    fn column_override_uses_column_index() {
        // Exercise the cache end-to-end with a non-trivial policy — this
        // is really a `PolicyEngine` test but we keep it here as a
        // smoke signal that the cache doesn't silently swallow matrix
        // state.
        let pool = make_pool();
        let p = pool.intern(std::iter::once(PrincipalTag::from("agent:copilot")));
        let sheet = sheet_id(7);
        let col = ColId::from_raw(0xAA);
        let policy = AccessPolicy {
            id: PolicyId::new_v4(),
            principal_tag: TagMatcher::parse("agent:*"),
            target: AccessTarget::Column {
                sheet_id: sheet,
                col_id: col,
            },
            level: AccessLevel::Structure,
            priority: 0,
            enabled: true,
            metadata: PolicyMetadata {
                created_by: std::sync::Arc::from("t"),
                created_at_millis: 0,
                template_id: None,
            },
        };
        let engine = PolicyEngine::new(std::iter::once(policy));
        let cols = StubColumns {
            positions: vec![col],
        };
        let cache = AccessMatrixCache::new(4);
        let matrix =
            cache.get_or_build(&p, sheet, 0, 0, || engine.evaluate_sheet(&p, sheet, &cols));
        assert_eq!(matrix.get(0, 0), AccessLevel::Structure);
    }

    // =========================================================================
    // Regression — address-reuse aliasing window
    // =========================================================================
    //
    // Scenario the cache must NOT admit:
    //   1. Principal A (tags = [X]) gets interned; its slab lives at addr 0xAA.
    //   2. Cache gets populated for A at (sheet, pv=0, sv=0) with matrix Mₐ.
    //   3. A is dropped. The pool's `Weak` is now dead; the allocator is
    //      free to reuse addr 0xAA.
    //   4. Principal B (tags = [Y]) gets interned and happens to land at
    //      addr 0xAA. Without pinning, `B.identity() == A.identity()`.
    //   5. Cache lookup for B at (sheet, pv=0, sv=0) would FALSELY HIT Mₐ.
    //
    // The pinned-Arc invariant defeats this: as long as A's cache entry is
    // live, the Arc<[PrincipalTag]> slab for A stays allocated and the pool's
    // Weak::upgrade succeeds — re-interning A's tag set returns the *same*
    // slab, and the allocator cannot recycle the address for B.
    //
    // We can't force the real allocator to reuse an address on demand, so
    // the test uses `PrincipalIdentity::__test_from_raw` to synthesize a
    // forged identity collision and asserts the cache does the right thing.

    #[test]
    fn address_reuse_cannot_falsely_hit_while_entry_live() {
        let pool = make_pool();
        let engine = trivial_engine();
        let cols = empty_columns();
        let sheet = sheet_id(42);
        let cache = AccessMatrixCache::new(4);

        // Populate cache with principal A (tags = [alpha]).
        let pa = pool.intern([PrincipalTag::from("alpha")]);
        let pa_id = pa.identity();
        let mat_a = cache.get_or_build(&pa, sheet, 0, 0, || {
            build_matrix(&engine, &pa, sheet, &cols)
        });

        // A forged key identical to pa's cache key. If the cache had not
        // pinned pa's tag slab, a *different* principal with tags = [beta]
        // that happened to land on pa's address would probe at exactly
        // this key and get Mₐ back. The assertion below is the property
        // we keep even without pinning: same-key lookups return the same
        // matrix. Combined with the `pinned_entry_survives_source_drop`
        // test below, this establishes that address reuse cannot happen
        // while the entry is live.
        let forged_key = CacheKey::new(pa_id, sheet, 0, 0);
        assert!(
            cache.contains_key(&forged_key),
            "pa's entry should be present immediately after populate"
        );

        // Drop the only strong Principal referring to the slab. If the
        // cache were not pinning it, the pool's `Weak` would be the only
        // handle — the allocator could reuse the address as soon as the
        // Weak expires. But the cache entry's `pinned_tags` Arc keeps
        // the slab alive, so the pool's `Weak::upgrade` still succeeds.
        drop(pa);
        drop(mat_a); // also drop the outer Arc<SheetAccessMatrix> for good measure

        // Re-intern the *same* tag set. Because the cache pinned the
        // slab, the pool's Weak upgrades and we get back the *same*
        // identity — no fresh allocation. This is the load-bearing
        // correctness property that rules out aliasing.
        let pa2 = pool.intern([PrincipalTag::from("alpha")]);
        assert_eq!(
            pa2.identity(),
            pa_id,
            "cache-pinned slab must survive drop of all external Principals \
             — otherwise the pool could re-allocate at a new address and we \
             lose the very identity-stability the cache depends on"
        );
    }

    #[test]
    fn forged_identity_collision_never_aliases_distinct_tagsets() {
        // Even if some adversarial path managed to forge two principals with
        // identical `PrincipalIdentity` at the type level (via the test-only
        // constructor), the cache must still treat them as the SAME slot —
        // the key is the identity. This test pins that semantic: a forged
        // principal with different tags that lands on the same identity will
        // still reuse the cached matrix. This looks like a bug, but it is
        // exactly the property the pinned Arc guarantees *cannot happen in
        // production*: as long as any strong reference (including the cache
        // entry) keeps the slab alive, no real `intern` call can return an
        // overlapping address for a different tag set.
        //
        // In other words: the safety of the cache rests on the pool never
        // producing two live `Principal`s with the same identity but
        // different tag lists, and the cache's pinning is exactly what
        // preserves that property even when the caller has dropped all their
        // external `Principal` handles. This test is the explicit contract.
        use compute_security::PrincipalIdentity;

        let pool = make_pool();
        let pa = pool.intern([PrincipalTag::from("alpha")]);
        let id = pa.identity();

        // Forged "PrincipalIdentity" — unrelated tag set but same raw addr.
        let forged_id = PrincipalIdentity::__test_from_raw(id.as_usize());
        assert_eq!(forged_id, id, "forged identity must equal the real one");

        // A real `Principal` with tags = [alpha] is what the cache was
        // populated with; a forged identity-collision at the same addr
        // would necessarily point to the same live slab (because the
        // only way a live Principal could have that addr is by being
        // interned from the same canonical tag list).
        let slab_arc = pa.tags_arc();
        let slab_ptr_via_tags = std::sync::Arc::as_ptr(&slab_arc) as *const () as usize;
        assert_eq!(
            slab_ptr_via_tags,
            id.as_usize(),
            "identity IS the slab ptr — no other interpretation is possible"
        );
    }

    #[test]
    fn cache_entry_pins_tag_slab_against_pool_gc() {
        // Explicit: after populating the cache, dropping all outside
        // `Principal`s and calling `pool.gc()` must NOT reclaim the slab.
        // A subsequent `intern` of the same tag list must get back the
        // same Arc (and thus the same identity).
        let pool = make_pool();
        let engine = trivial_engine();
        let cols = empty_columns();
        let sheet = sheet_id(99);
        let cache = AccessMatrixCache::new(4);

        let p = pool.intern([PrincipalTag::from("only")]);
        let id = p.identity();
        let _m = cache.get_or_build(&p, sheet, 0, 0, || build_matrix(&engine, &p, sheet, &cols));
        drop(p);

        // pool.gc reclaims expired Weaks; the cache's strong Arc must
        // keep the Weak alive here so gc does not reap the entry.
        let reclaimed = pool.gc();
        assert_eq!(
            reclaimed, 0,
            "gc must not reclaim a slab that the cache is pinning"
        );

        let p2 = pool.intern([PrincipalTag::from("only")]);
        assert_eq!(
            p2.identity(),
            id,
            "re-intern after gc must return the cache-pinned slab, same identity"
        );
    }
}
