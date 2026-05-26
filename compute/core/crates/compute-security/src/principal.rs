use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, Weak};

use serde::{Deserialize, Serialize};

/// Literal tag value (e.g. `"agent:copilot"`). `Arc<str>` so cloning is a
/// refcount bump on the common hot path of threading principals through
/// gated call sites.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(from = "String", into = "String")]
pub struct PrincipalTag(Arc<str>);

impl PrincipalTag {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for PrincipalTag {
    fn from(s: String) -> Self {
        Self(Arc::from(s))
    }
}

impl From<&str> for PrincipalTag {
    fn from(s: &str) -> Self {
        Self(Arc::from(s))
    }
}

impl From<PrincipalTag> for String {
    fn from(t: PrincipalTag) -> Self {
        t.0.as_ref().to_owned()
    }
}

/// Canonical sorted+deduped tag vector used as the `PrincipalPool` key.
/// A distinct type keeps the invariant encoded in the signature of
/// `intern`/the pool map — no ad-hoc `Vec<PrincipalTag>` ever shows up as
/// a key.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SortedTagList(Vec<PrincipalTag>);

impl SortedTagList {
    #[must_use]
    pub fn from_unsorted(mut tags: Vec<PrincipalTag>) -> Self {
        tags.sort_unstable_by(|a, b| a.as_str().cmp(b.as_str()));
        tags.dedup_by(|a, b| a.as_str() == b.as_str());
        Self(tags)
    }

    #[must_use]
    pub fn as_slice(&self) -> &[PrincipalTag] {
        &self.0
    }
}

/// Opaque identity — the address of the interned tag slab. `Copy`, `Eq`,
/// `Hash` so it can be a cache key directly (see `AccessMatrixCache` in
/// R2.2). Two distinct principals cannot alias because the pool hands out
/// one slab per canonical tag set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PrincipalIdentity(usize);

impl PrincipalIdentity {
    #[must_use]
    pub fn as_usize(&self) -> usize {
        self.0
    }

    /// Test-only: forge a `PrincipalIdentity` from a raw address. Used
    /// by regression tests that need to simulate slab-address reuse
    /// (see `AccessMatrixCache` in `compute-core::storage::security_cache`)
    /// without waiting for the allocator to actually recycle a pointer.
    ///
    /// Not gated behind `cfg(test)` alone because the cache test lives
    /// in a *different* crate (`compute-core`), and `cfg(test)` in
    /// `compute-security` only fires when `compute-security` itself is
    /// compiled as the test target. The `#[doc(hidden)]` plus explicit
    /// `__` prefix mark the API as "test infrastructure only"; no
    /// production caller should reach for it.
    #[doc(hidden)]
    #[must_use]
    pub fn __test_from_raw(addr: usize) -> Self {
        Self(addr)
    }
}

/// A caller identity expressed as a set of tags. Canonicalised through
/// `PrincipalPool::intern` — direct construction is not public so the
/// pool can uphold "same canonical tag set ⇒ same `PrincipalIdentity`".
///
/// `Principal` is deliberately **not** `Serialize` / `Deserialize`. Its
/// identity is the slab pointer of a pool-interned `Arc<[PrincipalTag]>`;
/// a deserialised `Principal` would have an Arc address foreign to any
/// pool and would silently fail to match pool-interned principals in the
/// matrix cache (ARCHITECTURE.md §3.1). The wire format used by bridge
/// callers is a tagged-string list (`Vec<String>`); the service-side
/// `ComputeService::make_principal(tags)` is the canonical hook that
/// converts from the wire shape into a pool-interned `Principal`. Do not
/// re-add serde derives here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
    tags: Arc<[PrincipalTag]>,
}

/// Conventional owner tag. Presence suppresses `mog:non-owner` derivation.
pub const OWNER_TAG: &str = "mog:owner";

/// Derived tag implicitly added to any principal lacking `mog:owner`.
pub const NON_OWNER_TAG: &str = "mog:non-owner";

// Shared derived-tag value so `effective_tags` can hand out `&PrincipalTag`
// with `'static` lifetime. One allocation for the whole process.
static NON_OWNER_TAG_VALUE: LazyLock<PrincipalTag> =
    LazyLock::new(|| PrincipalTag(Arc::from(NON_OWNER_TAG)));

impl Principal {
    /// Crate-internal construction from a pool-allocated slab.
    pub(crate) fn from_interned(tags: Arc<[PrincipalTag]>) -> Self {
        Self { tags }
    }

    /// Construct a non-interned `Principal` from a tag list. The
    /// resulting `Principal` has an `Arc` slab that is **not** shared
    /// with the `PrincipalPool`; its `identity()` will therefore *not*
    /// match a pool-interned `Principal` with the same tag set.
    ///
    /// Use this only for paths that consume the *tag set* and not the
    /// identity — notably `PolicyEngine::evaluate` /
    /// `PolicyEngine::explain`, which do not key on `PrincipalIdentity`.
    /// Any path that touches the matrix cache (`AccessMatrixCache` in
    /// `compute-core::storage::security_cache`) MUST go through
    /// `PrincipalPool::intern` instead.
    ///
    /// This constructor exists to support bridge-surface methods like
    /// `YrsComputeEngine::wb_security_effective_access(target,
    /// principal_tags: Vec<String>)` that trade `Vec<String>` on the
    /// wire (because `Principal` is not serialisable) and then
    /// construct a fresh Principal on the engine side for
    /// identity-agnostic evaluation.
    #[must_use]
    pub fn from_tags<I>(tags: I) -> Self
    where
        I: IntoIterator,
        I::Item: Into<PrincipalTag>,
    {
        let collected: Vec<PrincipalTag> = tags.into_iter().map(Into::into).collect();
        Self {
            tags: Arc::from(collected.into_boxed_slice()),
        }
    }

    /// Pool-interned, empty-tag-set principal used by the delegate macro
    /// when a `None` principal meets active enforcement (fail-safe anon).
    #[must_use]
    pub fn anonymous(pool: &PrincipalPool) -> Self {
        pool.intern(std::iter::empty())
    }

    #[must_use]
    pub fn tags(&self) -> &[PrincipalTag] {
        &self.tags
    }

    /// Clone the underlying `Arc<[PrincipalTag]>` — a strong handle to
    /// the pool-interned slab. Used by the matrix cache
    /// (`compute-core::storage::security_cache`) to pin the slab for
    /// the lifetime of a cache entry, closing the address-reuse
    /// aliasing window (a re-used allocator address would otherwise
    /// make `PrincipalIdentity` spuriously compare equal between
    /// unrelated tag sets). Not on the public hot path — the pointer
    /// itself is an implementation detail of the intern pool.
    #[must_use]
    pub fn tags_arc(&self) -> Arc<[PrincipalTag]> {
        Arc::clone(&self.tags)
    }

    /// Slab-pointer identity — used directly as a cache key component,
    /// no hashing or collision class.
    #[must_use]
    pub fn identity(&self) -> PrincipalIdentity {
        // Pointer address of the interned slab is stable for the lifetime
        // of the Arc; the pool keeps a Weak ref so a fresh intern after
        // drop reallocates (and yields a new identity).
        PrincipalIdentity(Arc::as_ptr(&self.tags) as *const () as usize)
    }

    /// Iterator over explicit tags plus derived `mog:non-owner` (added
    /// only when `mog:owner` is absent). Resolves SG-1.
    pub fn effective_tags(&self) -> EffectiveTags<'_> {
        let has_owner = self.tags.iter().any(|t| t.as_str() == OWNER_TAG);
        EffectiveTags {
            explicit: self.tags.iter(),
            emit_derived: !has_owner,
        }
    }
}

/// Iterator returned by `Principal::effective_tags`.
pub struct EffectiveTags<'a> {
    explicit: std::slice::Iter<'a, PrincipalTag>,
    emit_derived: bool,
}

impl<'a> Iterator for EffectiveTags<'a> {
    type Item = &'a PrincipalTag;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(t) = self.explicit.next() {
            return Some(t);
        }
        if self.emit_derived {
            self.emit_derived = false;
            return Some(&NON_OWNER_TAG_VALUE);
        }
        None
    }
}

/// Canonicalises `Principal` values so that pointer equality of the
/// interned `Arc<[PrincipalTag]>` slab is a sound structural identity.
/// Weak references so dropped principals don't leak through the pool.
pub struct PrincipalPool {
    entries: Mutex<HashMap<SortedTagList, Weak<[PrincipalTag]>>>,
}

impl PrincipalPool {
    #[must_use]
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// Canonicalise the input, look up; if the Weak upgrades, reuse the
    /// live slab; otherwise allocate and store a new Weak.
    pub fn intern(&self, tags: impl IntoIterator<Item = PrincipalTag>) -> Principal {
        let key = SortedTagList::from_unsorted(tags.into_iter().collect());
        let mut guard = self.entries.lock().expect("PrincipalPool mutex poisoned");
        if let Some(existing) = guard.get(&key).and_then(Weak::upgrade) {
            return Principal::from_interned(existing);
        }
        let slab: Arc<[PrincipalTag]> = Arc::from(key.0.clone().into_boxed_slice());
        guard.insert(key, Arc::downgrade(&slab));
        Principal::from_interned(slab)
    }

    /// Remove entries whose `Weak` has expired. Callers decide cadence;
    /// safe to invoke anytime. Returns the number of entries reclaimed.
    pub fn gc(&self) -> usize {
        let mut guard = self.entries.lock().expect("PrincipalPool mutex poisoned");
        let before = guard.len();
        guard.retain(|_, weak| weak.strong_count() > 0);
        before - guard.len()
    }

    /// Current entry count (including not-yet-GC'd dead Weaks). Callers
    /// that need a precise live count should `gc()` first.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries
            .lock()
            .expect("PrincipalPool mutex poisoned")
            .len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Default for PrincipalPool {
    fn default() -> Self {
        Self::new()
    }
}
