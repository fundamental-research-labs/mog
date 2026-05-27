use super::fixtures::*;

// ===========================================================================
// Principal identity regression
// ===========================================================================

#[test]
fn make_principal_is_canonical() {
    // `make_principal` returns the canonical (sorted, deduped) tag list
    // at the wire boundary — `Principal` itself is not serialisable
    // (identity is the pool slab pointer; see compute_security::principal).
    // Two different input orders must produce byte-identical canonical
    // output; the pool pre-warm guarantees set_active_principal with the
    // same canonical list hits the same slab.
    let (service, _) = fresh_service();
    let p1 = service.make_principal(vec!["a".into(), "b".into()]);
    let p2 = service.make_principal(vec!["b".into(), "a".into()]);
    assert_eq!(p1, p2);
}

#[test]
fn make_principal_dedupes_duplicate_tags() {
    // Pool canonicalizes sort + dedupe; two `a` tags collapse to one.
    let (service, _) = fresh_service();
    let p1 = service.make_principal(vec!["a".into(), "a".into()]);
    let p2 = service.make_principal(vec!["a".into()]);
    assert_eq!(p1, p2);
    assert_eq!(p1, vec!["a".to_string()]);
}

#[test]
fn anonymous_principal_is_pool_interned() {
    // Anonymous = empty tag list. Both wire-canonical and pool-identity
    // stable across repeated make_principal calls.
    let (service, _) = fresh_service();
    let a1 = service.make_principal(vec![]);
    let a2 = service.make_principal(vec![]);
    assert_eq!(a1, a2);
    assert!(a1.is_empty());
}
