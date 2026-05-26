//! Bound utilities — project, reflect, feasibility checking.

use crate::types::Bound;

/// Project a scalar value into bounds (clamp).
pub fn project(x: f64, bound: &Bound) -> f64 {
    let mut v = x;
    if let Some(lo) = bound.lower {
        v = v.max(lo);
    }
    if let Some(hi) = bound.upper {
        v = v.min(hi);
    }
    v
}

/// Project a vector into bounds (clamp each component in-place).
pub fn project_vec(x: &mut [f64], bounds: &[Bound]) {
    for (xi, b) in x.iter_mut().zip(bounds.iter()) {
        *xi = project(*xi, b);
    }
}

/// Reflect a scalar value off bounds.
///
/// If `x` is below the lower bound, reflect it upward: `lo + (lo - x)`.
/// If `x` is above the upper bound, reflect it downward: `hi - (x - hi)`.
/// If the reflected value overshoots the opposite bound, clamp instead.
pub fn reflect(x: f64, bound: &Bound) -> f64 {
    if let Some(lo) = bound.lower
        && x < lo
    {
        let reflected = lo + (lo - x);
        // If reflected overshoots upper bound, clamp
        if let Some(hi) = bound.upper {
            return reflected.min(hi);
        }
        return reflected;
    }
    if let Some(hi) = bound.upper
        && x > hi
    {
        let reflected = hi - (x - hi);
        // If reflected overshoots lower bound, clamp
        if let Some(lo) = bound.lower {
            return reflected.max(lo);
        }
        return reflected;
    }
    x
}

/// Reflect a vector off bounds (in-place).
pub fn reflect_vec(x: &mut [f64], bounds: &[Bound]) {
    for (xi, b) in x.iter_mut().zip(bounds.iter()) {
        *xi = reflect(*xi, b);
    }
}

/// Check if all values are within their bounds.
pub fn is_feasible(x: &[f64], bounds: &[Bound]) -> bool {
    x.iter().zip(bounds.iter()).all(|(xi, b)| b.contains(*xi))
}

/// Check if any bound has a finite lower or upper limit.
pub fn has_bounds(bounds: &[Bound]) -> bool {
    bounds
        .iter()
        .any(|b| b.lower.is_some() || b.upper.is_some())
}
