//! Subsystem 5: IterativeConvergenceSolver
//!
//! Drives the outer loop for circular reference convergence.
//! Generic over the evaluation strategy — works with both parallel and sequential evaluation.
//!
//! Knows about: Cell IDs, `CellValue`, convergence parameters, and an evaluation function.
//! Does NOT know about parallelism, DAG structure, dense caches, or ASTs.

use cell_types::CellId;
use rustc_hash::{FxHashMap, FxHashSet};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Parameters controlling iterative convergence.
#[derive(Debug, Clone)]
pub struct ConvergenceParams {
    /// Maximum number of iterations for convergence (default: 100).
    pub max_iterations: u32,
    /// Maximum absolute change between iterations to consider converged (default: 0.001).
    pub max_change: f64,
    /// Whether iterative calculation is enabled (retained for API compatibility; no longer gates convergence).
    pub iterative_calc_enabled: bool,
}

impl Default for ConvergenceParams {
    fn default() -> Self {
        Self {
            max_iterations: 100,
            max_change: 0.001,
            iterative_calc_enabled: false,
        }
    }
}

/// Result of one evaluation pass (returned by the evaluate function).
pub struct EvalPassResult {
    /// Cell values produced by the evaluation pass.
    pub values: FxHashMap<CellId, CellValue>,
    /// Cells detected as participating in circular references during this pass.
    pub cycle_cells: Vec<CellId>,
}

/// Final result of iterative convergence.
pub struct ConvergenceResult {
    /// Total number of evaluation passes performed.
    pub iterations_used: u32,
    /// Whether the iteration converged within the tolerance.
    pub converged: bool,
    /// Cells that participate in circular references.
    pub cycle_cells: Vec<CellId>,
    /// The scoped set of cells iterated (cycle cells + transitive dependents).
    pub iteration_scope: FxHashSet<CellId>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Drives iterative convergence for circular references.
///
/// - Iteration 0: evaluates `initial_dirty` via `evaluate_fn`, discovers cycles.
/// - If no cycles: returns immediately.
/// - Iteration 1+: evaluates only `iteration_scope`, checks convergence.
///
/// # Arguments
///
/// * `initial_dirty` — the set of cells that need evaluation.
/// * `params` — convergence parameters (max iterations, tolerance, enabled flag).
/// * `evaluate_fn(dirty_set)` — evaluates all cells in the set, returns results + cycle info.
/// * `compute_scope(cycle_cells)` — returns `cycle_cells ∪ transitive dependents`.
pub fn solve_iterative<E, S>(
    initial_dirty: FxHashSet<CellId>,
    params: &ConvergenceParams,
    mut evaluate_fn: E,
    compute_scope: S,
) -> ConvergenceResult
where
    E: FnMut(&FxHashSet<CellId>) -> EvalPassResult,
    S: FnOnce(&[CellId]) -> FxHashSet<CellId>,
{
    // Iteration 0: full evaluation
    let pass0 = evaluate_fn(&initial_dirty);
    let cycle_cells = dedup_cycle_cells(pass0.cycle_cells);

    if cycle_cells.is_empty() {
        return ConvergenceResult {
            iterations_used: 1,
            converged: cycle_cells.is_empty(),
            cycle_cells,
            iteration_scope: FxHashSet::default(),
        };
    }

    // Compute scoped iteration set: cycle cells + their transitive dependents
    let iteration_scope = compute_scope(&cycle_cells);
    let mut prev_values = pass0.values;

    // Iteration 1+: scoped convergence
    for iteration in 1..=params.max_iterations {
        let pass = evaluate_fn(&iteration_scope);
        let max_delta = compute_max_delta(&cycle_cells, &prev_values, &pass.values);
        prev_values = pass.values;

        if max_delta <= params.max_change {
            return ConvergenceResult {
                iterations_used: iteration + 1,
                converged: true,
                cycle_cells,
                iteration_scope,
            };
        }
    }

    ConvergenceResult {
        iterations_used: params.max_iterations + 1,
        converged: false,
        cycle_cells,
        iteration_scope,
    }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Compute max absolute delta between old and new values for the given cells.
///
/// - Number vs Number: `|old - new|`
/// - Number vs non-Number (or vice versa): `f64::INFINITY` (non-convergent)
/// - Missing old value: treat as 0.0 (first iteration)
/// - Two different non-numeric values: `f64::INFINITY` (non-convergent)
/// - Same non-numeric value in both: 0.0 (converged)
pub(crate) fn compute_max_delta(
    cells: &[CellId],
    old: &FxHashMap<CellId, CellValue>,
    new: &FxHashMap<CellId, CellValue>,
) -> f64 {
    let mut max = 0.0_f64;

    for &cell in cells {
        let old_val = old.get(&cell);
        let new_val = new.get(&cell);

        let delta = match (old_val, new_val) {
            // Both numeric: absolute difference.
            (Some(CellValue::Number(a)), Some(CellValue::Number(b))) => (a.get() - b.get()).abs(),
            // Number → non-Number or non-Number → Number: non-convergent.
            (Some(CellValue::Number(_)), Some(_)) | (Some(_), Some(CellValue::Number(_))) => {
                f64::INFINITY
            }
            // Missing old value with numeric new: treat old as 0.0.
            (None, Some(CellValue::Number(b))) => b.get().abs(),
            // Missing old value with non-numeric new: 0.0 (no numeric change detectable).
            (None, _) => 0.0,
            // Two different non-numeric values = not converged.
            (Some(a), Some(b)) if a != b => f64::INFINITY,
            // Same non-numeric value = converged.
            _ => 0.0,
        };

        if delta > max {
            max = delta;
        }
    }

    max
}

/// Deduplicate and sort cycle cells for deterministic behavior.
/// Sorts by inner u128 value, then removes duplicates.
pub(crate) fn dedup_cycle_cells(mut cells: Vec<CellId>) -> Vec<CellId> {
    cells.sort_by_key(|c| c.as_u128());
    cells.dedup();
    cells
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::CellId;
    use rustc_hash::{FxHashMap, FxHashSet};
    use std::cell::RefCell;
    use value_types::{CellValue, FiniteF64};

    /// Helper to create a CellId from a small integer.
    fn cid(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    /// Helper to create a numeric CellValue.
    fn num(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(v))
    }

    #[test]
    fn test_acyclic_single_pass() {
        let a = cid(1);
        let b = cid(2);
        let mut dirty = FxHashSet::default();
        dirty.insert(a);
        dirty.insert(b);

        let params = ConvergenceParams {
            iterative_calc_enabled: true,
            ..Default::default()
        };

        let result = solve_iterative(
            dirty,
            &params,
            |_| EvalPassResult {
                values: FxHashMap::default(),
                cycle_cells: vec![],
            },
            |_| FxHashSet::default(),
        );

        assert_eq!(result.iterations_used, 1);
        assert!(result.converged);
        assert!(result.cycle_cells.is_empty());
    }

    #[test]
    fn test_cycle_converges() {
        // Simulate: A = B + 1, B = A / 2
        // Seed: A=0, B=0
        // Iter0: A = 0+1 = 1, B = 0/2 = 0   (uses old values)
        // Iter1: A = 0+1 = 1, B = 1/2 = 0.5
        // Iter2: A = 0.5+1 = 1.5, B = 1.5/2 = 0.75
        // ...converges to A=2, B=1
        let a = cid(1);
        let b = cid(2);

        let iteration = RefCell::new(0u32);
        let prev_a = RefCell::new(0.0_f64);
        let prev_b = RefCell::new(0.0_f64);

        let mut dirty = FxHashSet::default();
        dirty.insert(a);
        dirty.insert(b);

        let params = ConvergenceParams {
            max_iterations: 100,
            max_change: 0.001,
            iterative_calc_enabled: true,
        };

        let result = solve_iterative(
            dirty,
            &params,
            |_| {
                let iter = *iteration.borrow();
                let mut values = FxHashMap::default();

                if iter == 0 {
                    // First eval: A=1, B=0 (seed from 0)
                    values.insert(a, num(1.0));
                    values.insert(b, num(0.0));
                } else {
                    // Subsequent: A = prev_b + 1, B = prev_a / 2
                    let new_a = *prev_b.borrow() + 1.0;
                    let new_b = *prev_a.borrow() / 2.0;
                    values.insert(a, num(new_a));
                    values.insert(b, num(new_b));
                }

                *prev_a.borrow_mut() = match values.get(&a) {
                    Some(CellValue::Number(f)) => f.get(),
                    _ => 0.0,
                };
                *prev_b.borrow_mut() = match values.get(&b) {
                    Some(CellValue::Number(f)) => f.get(),
                    _ => 0.0,
                };

                *iteration.borrow_mut() += 1;

                EvalPassResult {
                    values,
                    cycle_cells: vec![a, b],
                }
            },
            |cells| {
                let mut scope = FxHashSet::default();
                for &c in cells {
                    scope.insert(c);
                }
                scope
            },
        );

        assert!(result.converged);
        assert!(result.iterations_used > 1);
        assert!(result.iterations_used <= 101);
        assert_eq!(result.cycle_cells, vec![a, b]);
    }

    #[test]
    fn test_cycle_with_dependents() {
        // A = B + 1, B = A * 0.5, C = A + 10
        // C is a dependent of cycle cell A but not itself in a cycle.
        let a = cid(1);
        let b = cid(2);
        let c = cid(3);

        let iteration = RefCell::new(0u32);
        let prev_a = RefCell::new(0.0_f64);
        let prev_b = RefCell::new(0.0_f64);

        let mut dirty = FxHashSet::default();
        dirty.insert(a);
        dirty.insert(b);
        dirty.insert(c);

        let params = ConvergenceParams {
            max_iterations: 200,
            max_change: 0.001,
            iterative_calc_enabled: true,
        };

        let result = solve_iterative(
            dirty,
            &params,
            |_| {
                let iter = *iteration.borrow();
                let mut values = FxHashMap::default();

                if iter == 0 {
                    values.insert(a, num(1.0));
                    values.insert(b, num(0.0));
                    values.insert(c, num(11.0));
                } else {
                    let new_a = *prev_b.borrow() + 1.0;
                    let new_b = *prev_a.borrow() * 0.5;
                    let new_c = new_a + 10.0;
                    values.insert(a, num(new_a));
                    values.insert(b, num(new_b));
                    values.insert(c, num(new_c));
                }

                *prev_a.borrow_mut() = match values.get(&a) {
                    Some(CellValue::Number(f)) => f.get(),
                    _ => 0.0,
                };
                *prev_b.borrow_mut() = match values.get(&b) {
                    Some(CellValue::Number(f)) => f.get(),
                    _ => 0.0,
                };

                *iteration.borrow_mut() += 1;

                EvalPassResult {
                    values,
                    cycle_cells: vec![a, b],
                }
            },
            |cells| {
                let mut scope = FxHashSet::default();
                for &cell in cells {
                    scope.insert(cell);
                }
                // Add C as a transitive dependent of A
                scope.insert(c);
                scope
            },
        );

        assert!(result.converged);
        // C should be in the iteration_scope
        assert!(result.iteration_scope.contains(&c));
        assert!(result.iteration_scope.contains(&a));
        assert!(result.iteration_scope.contains(&b));
    }

    #[test]
    fn test_no_convergence() {
        // A = B * 2, B = A * 2: diverges
        let a = cid(1);
        let b = cid(2);

        let prev_a = RefCell::new(0.0_f64);
        let prev_b = RefCell::new(0.0_f64);
        let iteration = RefCell::new(0u32);

        let mut dirty = FxHashSet::default();
        dirty.insert(a);
        dirty.insert(b);

        let params = ConvergenceParams {
            max_iterations: 10,
            max_change: 0.001,
            iterative_calc_enabled: true,
        };

        let result = solve_iterative(
            dirty,
            &params,
            |_| {
                let iter = *iteration.borrow();
                let mut values = FxHashMap::default();

                if iter == 0 {
                    values.insert(a, num(1.0));
                    values.insert(b, num(1.0));
                } else {
                    let new_a = *prev_b.borrow() * 2.0;
                    let new_b = *prev_a.borrow() * 2.0;
                    values.insert(a, num(new_a));
                    values.insert(b, num(new_b));
                }

                *prev_a.borrow_mut() = match values.get(&a) {
                    Some(CellValue::Number(f)) => f.get(),
                    _ => 0.0,
                };
                *prev_b.borrow_mut() = match values.get(&b) {
                    Some(CellValue::Number(f)) => f.get(),
                    _ => 0.0,
                };
                *iteration.borrow_mut() += 1;

                EvalPassResult {
                    values,
                    cycle_cells: vec![a, b],
                }
            },
            |cells| {
                let mut scope = FxHashSet::default();
                for &c in cells {
                    scope.insert(c);
                }
                scope
            },
        );

        assert!(!result.converged);
        assert_eq!(result.iterations_used, 11); // max_iterations + 1
    }

    #[test]
    fn test_iterative_calc_disabled_still_converges() {
        // With always-converge, iterative_calc_enabled=false no longer gates
        // the convergence loop. Cycles are always iterated.
        let a = cid(1);
        let b = cid(2);

        let mut dirty = FxHashSet::default();
        dirty.insert(a);
        dirty.insert(b);

        let params = ConvergenceParams {
            max_iterations: 100,
            max_change: 0.001,
            iterative_calc_enabled: false,
        };

        let iteration = std::cell::RefCell::new(0u32);

        let result = solve_iterative(
            dirty,
            &params,
            |_| {
                let iter = *iteration.borrow();
                let mut values = FxHashMap::default();
                // Stable after first pass: both cells produce 1.0
                values.insert(a, num(1.0));
                values.insert(b, num(1.0));
                *iteration.borrow_mut() = iter + 1;
                EvalPassResult {
                    values,
                    cycle_cells: if iter == 0 { vec![a, b] } else { vec![a, b] },
                }
            },
            |cells| {
                let mut scope = FxHashSet::default();
                for &c in cells {
                    scope.insert(c);
                }
                scope
            },
        );

        // Should have converged (stable values)
        assert!(result.converged);
        assert_eq!(result.cycle_cells.len(), 2);
    }

    #[test]
    fn test_convergence_threshold() {
        // Test exact threshold boundary: max_change=0.001
        // delta=0.0009 should converge, delta=0.0011 should not.
        let a = cid(1);

        let mut dirty = FxHashSet::default();
        dirty.insert(a);

        let params = ConvergenceParams {
            max_iterations: 2,
            max_change: 0.001,
            iterative_calc_enabled: true,
        };

        // Case 1: delta = 0.0009, should converge (0.0009 < 0.001)
        let iteration1 = RefCell::new(0u32);
        let result1 = solve_iterative(
            dirty.clone(),
            &params,
            |_| {
                let iter = *iteration1.borrow();
                *iteration1.borrow_mut() += 1;
                let mut values = FxHashMap::default();
                if iter == 0 {
                    values.insert(a, num(1.0));
                } else {
                    // Each iteration changes by 0.0009
                    values.insert(a, num(1.0 + 0.0009 * iter as f64));
                }
                EvalPassResult {
                    values,
                    cycle_cells: vec![a],
                }
            },
            |cells| {
                let mut scope = FxHashSet::default();
                for &c in cells {
                    scope.insert(c);
                }
                scope
            },
        );
        assert!(result1.converged);

        // Case 2: delta = 0.0011, should NOT converge (0.0011 >= 0.001)
        let iteration2 = RefCell::new(0u32);
        let result2 = solve_iterative(
            dirty,
            &params,
            |_| {
                let iter = *iteration2.borrow();
                *iteration2.borrow_mut() += 1;
                let mut values = FxHashMap::default();
                if iter == 0 {
                    values.insert(a, num(1.0));
                } else {
                    values.insert(a, num(1.0 + 0.0011 * iter as f64));
                }
                EvalPassResult {
                    values,
                    cycle_cells: vec![a],
                }
            },
            |cells| {
                let mut scope = FxHashSet::default();
                for &c in cells {
                    scope.insert(c);
                }
                scope
            },
        );
        assert!(!result2.converged);
    }

    #[test]
    fn test_max_delta_number_number() {
        let a = cid(1);
        let mut old = FxHashMap::default();
        let mut new = FxHashMap::default();
        old.insert(a, num(3.0));
        new.insert(a, num(5.0));

        let delta = compute_max_delta(&[a], &old, &new);
        assert!((delta - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_max_delta_number_text() {
        let a = cid(1);
        let mut old = FxHashMap::default();
        let mut new = FxHashMap::default();
        old.insert(a, num(3.0));
        new.insert(a, CellValue::Text("hello".into()));

        let delta = compute_max_delta(&[a], &old, &new);
        assert!(delta.is_infinite());

        // Reverse direction too
        let mut old2 = FxHashMap::default();
        let mut new2 = FxHashMap::default();
        old2.insert(a, CellValue::Text("hello".into()));
        new2.insert(a, num(3.0));

        let delta2 = compute_max_delta(&[a], &old2, &new2);
        assert!(delta2.is_infinite());
    }

    #[test]
    fn test_max_delta_missing_old() {
        let a = cid(1);
        let old = FxHashMap::default(); // empty — no old value
        let mut new = FxHashMap::default();
        new.insert(a, num(5.0));

        let delta = compute_max_delta(&[a], &old, &new);
        assert!((delta - 5.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_scope_receives_correct_dirty_sets() {
        // Verify evaluate_fn receives initial_dirty for iter 0, iteration_scope for iter 1+.
        let a = cid(1);
        let b = cid(2);
        let c = cid(3);

        let mut dirty = FxHashSet::default();
        dirty.insert(a);
        dirty.insert(b);

        let params = ConvergenceParams {
            max_iterations: 2,
            max_change: 0.001,
            iterative_calc_enabled: true,
        };

        let calls: RefCell<Vec<Vec<CellId>>> = RefCell::new(vec![]);
        let call_count = RefCell::new(0u32);

        let result = solve_iterative(
            dirty.clone(),
            &params,
            |dirty_set| {
                let mut cells: Vec<CellId> = dirty_set.iter().copied().collect();
                cells.sort_by_key(|c| c.as_u128());
                calls.borrow_mut().push(cells);

                let n = *call_count.borrow();
                *call_count.borrow_mut() += 1;

                // Use different values each call to prevent convergence
                let mut values = FxHashMap::default();
                values.insert(a, num(1.0 + 10.0 * n as f64));
                values.insert(b, num(2.0 + 10.0 * n as f64));
                values.insert(c, num(3.0 + 10.0 * n as f64));

                EvalPassResult {
                    values,
                    // Keep reporting cycles so iteration continues
                    cycle_cells: vec![a, b],
                }
            },
            |_cells| {
                let mut scope = FxHashSet::default();
                scope.insert(a);
                scope.insert(b);
                scope.insert(c); // transitive dependent
                scope
            },
        );

        let calls = calls.into_inner();
        // Call 0: initial_dirty = {a, b}
        assert_eq!(calls[0], vec![a, b]);
        // Call 1+: iteration_scope = {a, b, c}
        for call in &calls[1..] {
            assert_eq!(call.len(), 3);
            assert!(call.contains(&a));
            assert!(call.contains(&b));
            assert!(call.contains(&c));
        }

        // Should have max_iterations + 1 calls total (1 for iter 0 + max_iterations)
        assert_eq!(calls.len(), 3); // iter 0 + 2 iterations
        assert!(!result.converged);
    }

    #[test]
    fn test_empty_dirty_set() {
        let dirty = FxHashSet::default();

        let params = ConvergenceParams {
            iterative_calc_enabled: true,
            ..Default::default()
        };

        let result = solve_iterative(
            dirty,
            &params,
            |_| EvalPassResult {
                values: FxHashMap::default(),
                cycle_cells: vec![],
            },
            |_| FxHashSet::default(),
        );

        assert_eq!(result.iterations_used, 1);
        assert!(result.converged);
        assert!(result.cycle_cells.is_empty());
    }

    #[test]
    fn test_dedup_cycle_cells() {
        let a = cid(3);
        let b = cid(1);
        let c = cid(2);

        let result = dedup_cycle_cells(vec![a, b, c, a, b]);
        assert_eq!(result, vec![b, c, a]); // sorted by u128: 1, 2, 3
    }
}
