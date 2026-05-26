//! Principal + intern pool soundness tests per R0.2.

use compute_security::{NON_OWNER_TAG, OWNER_TAG, Principal, PrincipalPool, PrincipalTag};

fn tag(s: &str) -> PrincipalTag {
    PrincipalTag::from(s)
}

fn effective(p: &Principal) -> Vec<String> {
    p.effective_tags().map(|t| t.as_str().to_owned()).collect()
}

// =============================================================================
// Derived tag iteration — SG-1
// =============================================================================

#[test]
fn derived_non_owner_added_when_owner_absent() {
    let pool = PrincipalPool::new();
    let p = pool.intern([tag("agent:copilot")]);
    let tags = effective(&p);
    assert!(tags.iter().any(|s| s == "agent:copilot"));
    assert!(tags.iter().any(|s| s == NON_OWNER_TAG));
    assert_eq!(tags.len(), 2);
}

#[test]
fn derived_non_owner_absent_when_owner_present() {
    let pool = PrincipalPool::new();
    let p = pool.intern([tag(OWNER_TAG)]);
    let tags = effective(&p);
    assert_eq!(tags, vec![OWNER_TAG.to_string()]);
    assert!(!tags.iter().any(|s| s == NON_OWNER_TAG));
}

#[test]
fn derived_non_owner_absent_when_owner_present_with_others() {
    let pool = PrincipalPool::new();
    let p = pool.intern([tag(OWNER_TAG), tag("agent:copilot")]);
    let tags = effective(&p);
    assert!(tags.iter().any(|s| s == OWNER_TAG));
    assert!(tags.iter().any(|s| s == "agent:copilot"));
    assert!(!tags.iter().any(|s| s == NON_OWNER_TAG));
}

#[test]
fn effective_tags_on_empty_principal_yields_only_derived() {
    let pool = PrincipalPool::new();
    let p = Principal::anonymous(&pool);
    let tags = effective(&p);
    assert_eq!(tags, vec![NON_OWNER_TAG.to_string()]);
}

// =============================================================================
// Intern pool — canonicalisation soundness
// =============================================================================

#[test]
fn intern_same_tags_different_order_returns_same_identity() {
    // Canonical ordering inside the pool means [a, b] and [b, a] map to
    // the same slab.
    let pool = PrincipalPool::new();
    let p1 = pool.intern([tag("a"), tag("b")]);
    let p2 = pool.intern([tag("b"), tag("a")]);
    assert_eq!(p1.identity(), p2.identity());
}

#[test]
fn intern_dedups_repeated_tags() {
    let pool = PrincipalPool::new();
    let p1 = pool.intern([tag("a"), tag("b")]);
    let p2 = pool.intern([tag("a"), tag("b"), tag("a")]);
    assert_eq!(p1.identity(), p2.identity());
    assert_eq!(p1.tags().len(), 2);
}

#[test]
fn intern_different_tag_sets_yield_different_identities() {
    let pool = PrincipalPool::new();
    let p1 = pool.intern([tag("a"), tag("b")]);
    let p2 = pool.intern([tag("a"), tag("c")]);
    assert_ne!(p1.identity(), p2.identity());
}

#[test]
fn intern_empty_is_stable_while_alive() {
    let pool = PrincipalPool::new();
    let p1 = Principal::anonymous(&pool);
    let p2 = Principal::anonymous(&pool);
    assert_eq!(p1.identity(), p2.identity());
}

// =============================================================================
// Pointer-identity stability & GC
// =============================================================================

#[test]
fn consecutive_interns_share_identity_while_live() {
    let pool = PrincipalPool::new();
    let p1 = pool.intern([tag("x"), tag("y")]);
    let id1 = p1.identity();
    let p2 = pool.intern([tag("y"), tag("x")]);
    assert_eq!(id1, p2.identity());
    // p1 is still alive; dropping p2 must not invalidate p1's identity.
    drop(p2);
    let p3 = pool.intern([tag("x"), tag("y")]);
    assert_eq!(id1, p3.identity());
}

#[test]
fn weak_gc_reclaims_dropped_entries() {
    let pool = PrincipalPool::new();
    let first_identity = {
        let p = pool.intern([tag("only")]);
        p.identity()
    };
    // All strong refs dropped. The pool still holds a dead Weak until gc.
    assert_eq!(pool.len(), 1);
    let reclaimed = pool.gc();
    assert_eq!(reclaimed, 1);
    assert_eq!(pool.len(), 0);

    // Re-interning may yield a fresh identity (new allocation); what we
    // really test is that gc cleared the dead slot. Identity equality
    // with the old slab is not a guarantee either way — the allocator
    // may or may not hand back the same address.
    let p2 = pool.intern([tag("only")]);
    let _ = (first_identity, p2.identity());
}

#[test]
fn gc_preserves_live_entries() {
    let pool = PrincipalPool::new();
    let alive = pool.intern([tag("keep")]);
    let _throwaway = pool.intern([tag("drop")]);
    drop(_throwaway);
    let reclaimed = pool.gc();
    // "drop" entry is reclaimed, "keep" entry stays.
    assert_eq!(reclaimed, 1);
    assert_eq!(pool.len(), 1);
    // Re-interning the live tag set still returns the existing slab.
    let alive_again = pool.intern([tag("keep")]);
    assert_eq!(alive.identity(), alive_again.identity());
}

#[test]
fn weak_upgrade_returns_existing_slab_not_fresh_alloc() {
    // This is the core soundness invariant: two intern calls with the
    // same canonical key return the *same* Arc slab (pointer identity)
    // while at least one `Principal` is live.
    let pool = PrincipalPool::new();
    let p1 = pool.intern([tag("alpha"), tag("beta")]);
    let p1_ptr = p1.tags().as_ptr();
    let p2 = pool.intern([tag("beta"), tag("alpha")]);
    let p2_ptr = p2.tags().as_ptr();
    assert_eq!(p1_ptr, p2_ptr, "pool must hand back the same slab pointer");
}

// =============================================================================
// Anonymous principal
// =============================================================================

#[test]
fn anonymous_is_canonical() {
    let pool = PrincipalPool::new();
    let a1 = Principal::anonymous(&pool);
    let a2 = Principal::anonymous(&pool);
    assert_eq!(a1.identity(), a2.identity());
    assert!(a1.tags().is_empty());
}

#[test]
fn anonymous_is_non_owner_by_derivation() {
    let pool = PrincipalPool::new();
    let a = Principal::anonymous(&pool);
    assert_eq!(effective(&a), vec![NON_OWNER_TAG.to_string()]);
}
