//! Tests for bound utilities.

use crate::bounds::*;
use crate::types::Bound;

// ---------------------------------------------------------------------------
// project
// ---------------------------------------------------------------------------

#[test]
fn project_within_bounds() {
    let b = Bound::bounded(0.0, 10.0);
    assert_eq!(project(5.0, &b), 5.0);
}

#[test]
fn project_below_lower() {
    let b = Bound::bounded(0.0, 10.0);
    assert_eq!(project(-3.0, &b), 0.0);
}

#[test]
fn project_above_upper() {
    let b = Bound::bounded(0.0, 10.0);
    assert_eq!(project(15.0, &b), 10.0);
}

#[test]
fn project_lower_only() {
    let b = Bound::lower(0.0);
    assert_eq!(project(-5.0, &b), 0.0);
    assert_eq!(project(100.0, &b), 100.0);
}

#[test]
fn project_upper_only() {
    let b = Bound::upper(10.0);
    assert_eq!(project(-5.0, &b), -5.0);
    assert_eq!(project(15.0, &b), 10.0);
}

#[test]
fn project_unbounded() {
    let b = Bound::unbounded();
    assert_eq!(project(f64::MAX, &b), f64::MAX);
    assert_eq!(project(f64::MIN, &b), f64::MIN);
}

// ---------------------------------------------------------------------------
// project_vec
// ---------------------------------------------------------------------------

#[test]
fn project_vec_mixed_bounds() {
    let bounds = vec![
        Bound::bounded(0.0, 10.0),
        Bound::lower(-5.0),
        Bound::unbounded(),
    ];
    let mut x = vec![-1.0, -10.0, 999.0];
    project_vec(&mut x, &bounds);
    assert_eq!(x, vec![0.0, -5.0, 999.0]);
}

// ---------------------------------------------------------------------------
// reflect
// ---------------------------------------------------------------------------

#[test]
fn reflect_within_bounds() {
    let b = Bound::bounded(0.0, 10.0);
    assert_eq!(reflect(5.0, &b), 5.0);
}

#[test]
fn reflect_below_lower() {
    let b = Bound::bounded(0.0, 10.0);
    // x = -2, reflected = 0 + (0 - (-2)) = 2
    assert_eq!(reflect(-2.0, &b), 2.0);
}

#[test]
fn reflect_above_upper() {
    let b = Bound::bounded(0.0, 10.0);
    // x = 13, reflected = 10 - (13 - 10) = 7
    assert_eq!(reflect(13.0, &b), 7.0);
}

#[test]
fn reflect_overshoot_clamps() {
    // Narrow bounds: [4, 6], x = -5 → reflected = 4 + (4-(-5)) = 13, clamped to 6
    let b = Bound::bounded(4.0, 6.0);
    assert_eq!(reflect(-5.0, &b), 6.0);
}

#[test]
fn reflect_lower_only() {
    let b = Bound::lower(0.0);
    assert_eq!(reflect(-3.0, &b), 3.0);
    assert_eq!(reflect(5.0, &b), 5.0);
}

#[test]
fn reflect_upper_only() {
    let b = Bound::upper(10.0);
    assert_eq!(reflect(12.0, &b), 8.0);
    assert_eq!(reflect(5.0, &b), 5.0);
}

#[test]
fn reflect_unbounded() {
    let b = Bound::unbounded();
    assert_eq!(reflect(-100.0, &b), -100.0);
    assert_eq!(reflect(100.0, &b), 100.0);
}

// ---------------------------------------------------------------------------
// reflect_vec
// ---------------------------------------------------------------------------

#[test]
fn reflect_vec_mixed() {
    let bounds = vec![Bound::bounded(0.0, 10.0), Bound::bounded(0.0, 10.0)];
    let mut x = vec![-2.0, 13.0];
    reflect_vec(&mut x, &bounds);
    assert_eq!(x, vec![2.0, 7.0]);
}

// ---------------------------------------------------------------------------
// is_feasible
// ---------------------------------------------------------------------------

#[test]
fn feasible_within() {
    let bounds = vec![Bound::bounded(0.0, 10.0), Bound::bounded(-5.0, 5.0)];
    assert!(is_feasible(&[5.0, 0.0], &bounds));
}

#[test]
fn infeasible_below() {
    let bounds = vec![Bound::bounded(0.0, 10.0)];
    assert!(!is_feasible(&[-1.0], &bounds));
}

#[test]
fn infeasible_above() {
    let bounds = vec![Bound::bounded(0.0, 10.0)];
    assert!(!is_feasible(&[11.0], &bounds));
}

#[test]
fn feasible_at_boundary() {
    let bounds = vec![Bound::bounded(0.0, 10.0)];
    assert!(is_feasible(&[0.0], &bounds));
    assert!(is_feasible(&[10.0], &bounds));
}

// ---------------------------------------------------------------------------
// has_bounds
// ---------------------------------------------------------------------------

#[test]
fn has_bounds_true() {
    assert!(has_bounds(&[Bound::bounded(0.0, 10.0)]));
    assert!(has_bounds(&[Bound::lower(0.0)]));
    assert!(has_bounds(&[Bound::upper(10.0)]));
}

#[test]
fn has_bounds_false() {
    assert!(!has_bounds(&[]));
    assert!(!has_bounds(&[Bound::unbounded()]));
    assert!(!has_bounds(&[Bound::unbounded(), Bound::unbounded()]));
}

// ---------------------------------------------------------------------------
// Bound::contains
// ---------------------------------------------------------------------------

#[test]
fn bound_contains() {
    let b = Bound::bounded(0.0, 10.0);
    assert!(b.contains(0.0));
    assert!(b.contains(5.0));
    assert!(b.contains(10.0));
    assert!(!b.contains(-0.1));
    assert!(!b.contains(10.1));
}
