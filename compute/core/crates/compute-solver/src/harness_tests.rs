//! Tests for EvalHarness.

use crate::harness::EvalHarness;
use crate::types::Objective;

// ---------------------------------------------------------------------------
// NaN / Inf sentinel
// ---------------------------------------------------------------------------

#[test]
fn nan_returns_infinity() {
    let mut h = EvalHarness::new(|_: &[f64]| f64::NAN, Objective::Minimize, 100, 0, 1);
    let result = h.eval(&[1.0]).unwrap();
    assert_eq!(result, f64::INFINITY);
}

#[test]
fn pos_inf_returns_infinity() {
    let mut h = EvalHarness::new(|_: &[f64]| f64::INFINITY, Objective::Minimize, 100, 0, 1);
    let result = h.eval(&[1.0]).unwrap();
    assert_eq!(result, f64::INFINITY);
}

#[test]
fn neg_inf_returns_infinity() {
    let mut h = EvalHarness::new(
        |_: &[f64]| f64::NEG_INFINITY,
        Objective::Minimize,
        100,
        0,
        1,
    );
    let result = h.eval(&[1.0]).unwrap();
    assert_eq!(result, f64::INFINITY);
}

// ---------------------------------------------------------------------------
// Objective transformation
// ---------------------------------------------------------------------------

#[test]
fn minimize_is_identity() {
    let mut h = EvalHarness::new(|x: &[f64]| x[0] * x[0], Objective::Minimize, 100, 0, 1);
    assert_eq!(h.eval(&[3.0]).unwrap(), 9.0);
    assert_eq!(h.eval(&[-2.0]).unwrap(), 4.0);
}

#[test]
fn maximize_negates() {
    let mut h = EvalHarness::new(|x: &[f64]| x[0] * x[0], Objective::Maximize, 100, 0, 1);
    assert_eq!(h.eval(&[3.0]).unwrap(), -9.0);
    assert_eq!(h.eval(&[-2.0]).unwrap(), -4.0);
}

#[test]
fn target_absolute_difference() {
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Target(5.0), 100, 0, 1);
    assert_eq!(h.eval(&[3.0]).unwrap(), 2.0); // |3 - 5| = 2
    assert_eq!(h.eval(&[7.0]).unwrap(), 2.0); // |7 - 5| = 2
    assert_eq!(h.eval(&[5.0]).unwrap(), 0.0); // |5 - 5| = 0
}

#[test]
fn maximize_nan_returns_infinity() {
    // raw=NaN, transform=-NaN=NaN, sentinel=INFINITY
    let mut h = EvalHarness::new(|_: &[f64]| f64::NAN, Objective::Maximize, 100, 0, 1);
    assert_eq!(h.eval(&[1.0]).unwrap(), f64::INFINITY);
}

#[test]
fn target_nan_returns_infinity() {
    // raw=NaN, transform=|NaN-5|=NaN, sentinel=INFINITY
    let mut h = EvalHarness::new(|_: &[f64]| f64::NAN, Objective::Target(5.0), 100, 0, 1);
    assert_eq!(h.eval(&[1.0]).unwrap(), f64::INFINITY);
}

// ---------------------------------------------------------------------------
// Budget tracking
// ---------------------------------------------------------------------------

#[test]
fn budget_exhaustion() {
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Minimize, 3, 0, 1);
    assert!(h.eval(&[1.0]).is_ok());
    assert!(h.eval(&[2.0]).is_ok());
    assert!(h.eval(&[3.0]).is_ok());
    assert!(h.eval(&[4.0]).is_err()); // 4th call, budget is 3
}

#[test]
fn eval_count() {
    let mut h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, 100, 0, 1);
    assert_eq!(h.evals(), 0);
    h.eval(&[1.0]).unwrap();
    assert_eq!(h.evals(), 1);
    h.eval(&[2.0]).unwrap();
    assert_eq!(h.evals(), 2);
}

#[test]
fn remaining_evals() {
    let mut h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, 5, 0, 1);
    assert_eq!(h.remaining_evals(), 5);
    h.eval(&[1.0]).unwrap();
    assert_eq!(h.remaining_evals(), 4);
    h.eval(&[2.0]).unwrap();
    assert_eq!(h.remaining_evals(), 3);
}

#[test]
fn unlimited_budget() {
    let mut h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, 0, 0, 1);
    // max_evals=0 means unlimited
    for _ in 0..100 {
        assert!(h.eval(&[1.0]).is_ok());
    }
    assert_eq!(h.evals(), 100);
    assert_eq!(h.remaining_evals(), u32::MAX);
}

// ---------------------------------------------------------------------------
// Best-so-far tracking
// ---------------------------------------------------------------------------

#[test]
fn best_so_far_tracking() {
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Minimize, 100, 0, 1);
    h.eval(&[5.0]).unwrap();
    assert_eq!(h.best_f(), 5.0);
    assert_eq!(h.best_x(), &[5.0]);

    h.eval(&[3.0]).unwrap();
    assert_eq!(h.best_f(), 3.0);
    assert_eq!(h.best_x(), &[3.0]);

    h.eval(&[7.0]).unwrap();
    assert_eq!(h.best_f(), 3.0); // not updated
    assert_eq!(h.best_x(), &[3.0]);
}

#[test]
fn best_so_far_with_maximize() {
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Maximize, 100, 0, 1);
    h.eval(&[3.0]).unwrap(); // transformed = -3
    assert_eq!(h.best_raw_f(), 3.0);

    h.eval(&[7.0]).unwrap(); // transformed = -7 < -3 → new best
    assert_eq!(h.best_raw_f(), 7.0);
    assert_eq!(h.best_x(), &[7.0]);

    h.eval(&[5.0]).unwrap(); // transformed = -5, not better than -7
    assert_eq!(h.best_raw_f(), 7.0);
}

#[test]
fn nan_does_not_update_best() {
    let counter = std::cell::Cell::new(0u32);
    let mut h = EvalHarness::new(
        |x: &[f64]| {
            let c = counter.get();
            counter.set(c + 1);
            if c == 1 { f64::NAN } else { x[0] }
        },
        Objective::Minimize,
        100,
        0,
        1,
    );

    h.eval(&[5.0]).unwrap(); // returns 5.0, best = 5.0
    h.eval(&[1.0]).unwrap(); // returns NaN → ∞, best stays 5.0
    assert_eq!(h.best_f(), 5.0);
    assert_eq!(h.best_x(), &[5.0]);
}

#[test]
fn best_raw_f_for_target() {
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Target(10.0), 100, 0, 1);
    h.eval(&[7.0]).unwrap(); // |7 - 10| = 3
    assert_eq!(h.best_raw_f(), 7.0); // raw value is 7, not 3

    h.eval(&[9.0]).unwrap(); // |9 - 10| = 1 < 3 → new best
    assert_eq!(h.best_raw_f(), 9.0);
    assert_eq!(h.best_f(), 1.0);
}

// ---------------------------------------------------------------------------
// Elapsed time (native only)
// ---------------------------------------------------------------------------

#[test]
fn elapsed_ms_is_populated() {
    let mut h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, 100, 0, 1);
    h.eval(&[1.0]).unwrap();
    // Just verify it returns something reasonable (>= 0, < 1000ms)
    assert!(h.elapsed_ms() < 1000);
}

// ---------------------------------------------------------------------------
// Multi-dimensional
// ---------------------------------------------------------------------------

#[test]
fn multidim_best_tracking() {
    let mut h = EvalHarness::new(
        |x: &[f64]| x[0] * x[0] + x[1] * x[1],
        Objective::Minimize,
        100,
        0,
        2,
    );
    h.eval(&[3.0, 4.0]).unwrap(); // 25
    assert_eq!(h.best_f(), 25.0);
    assert_eq!(h.best_x(), &[3.0, 4.0]);

    h.eval(&[1.0, 1.0]).unwrap(); // 2
    assert_eq!(h.best_f(), 2.0);
    assert_eq!(h.best_x(), &[1.0, 1.0]);
}

// ===========================================================================
// First-principles tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Wall-clock time limit (max_time_ms)
// ---------------------------------------------------------------------------

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn wall_clock_time_limit_triggers_budget_exhausted() {
    use std::thread;
    use std::time::{Duration, Instant};

    // A function that spins for ~10ms per call
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            thread::sleep(Duration::from_millis(10));
            1.0
        },
        Objective::Minimize,
        u32::MAX, // no eval limit
        100,      // 100ms time limit
        1,
    );

    let start = Instant::now();
    let mut count = 0u32;
    loop {
        match h.eval(&[1.0]) {
            Ok(_) => count += 1,
            Err(_) => break,
        }
        // Safety: if we somehow do 1000 evals without hitting the limit, break
        if count > 1000 {
            panic!("time limit was never enforced after 1000 evals");
        }
    }
    let elapsed = start.elapsed();

    // The harness should have stopped around 100ms (allow generous margin)
    assert!(
        elapsed.as_millis() >= 90,
        "time limit triggered too early: {}ms",
        elapsed.as_millis()
    );
    assert!(
        elapsed.as_millis() < 500,
        "time limit triggered too late: {}ms",
        elapsed.as_millis()
    );
    // At least a few evals should have succeeded before timeout
    assert!(
        count >= 1,
        "expected at least 1 successful eval, got {count}"
    );
}

// ---------------------------------------------------------------------------
// 2. Objective transformation mathematical properties
// ---------------------------------------------------------------------------

#[test]
fn minimize_transform_is_exact_identity() {
    // For Minimize: eval(x) == f(x) exactly, for a variety of values
    let values = [0.0, 1.0, -1.0, 1e-15, 1e15, -1e15, 0.5, -0.5];
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Minimize, 1000, 0, 1);
    for &v in &values {
        let result = h.eval(&[v]).unwrap();
        assert_eq!(
            result, v,
            "Minimize transform must be identity for f(x)={v}"
        );
    }
}

#[test]
fn maximize_transform_is_exact_negation() {
    // For Maximize: eval(x) == -f(x) exactly
    let values = [0.0, 1.0, -1.0, 42.0, -42.0, 1e-15, 1e15];
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Maximize, 1000, 0, 1);
    for &v in &values {
        let result = h.eval(&[v]).unwrap();
        assert_eq!(result, -v, "Maximize transform must be -f(x) for f(x)={v}");
    }
}

#[test]
fn maximize_best_raw_f_is_maximum_seen() {
    // For Maximize, best_raw_f must be the MAXIMUM f value seen (not minimum of -f)
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Maximize, 100, 0, 1);
    h.eval(&[2.0]).unwrap(); // raw=2, transformed=-2
    h.eval(&[5.0]).unwrap(); // raw=5, transformed=-5 (better: lower transformed)
    h.eval(&[3.0]).unwrap(); // raw=3, transformed=-3

    // The best transformed is -5 (lowest), so best_raw_f should be 5.0 (the max)
    assert_eq!(h.best_raw_f(), 5.0);
    assert_eq!(h.best_f(), -5.0);
}

#[test]
fn target_transform_is_absolute_difference() {
    // For Target(t): eval(x) == |f(x) - t| exactly
    let target = 7.0;
    let test_values = [7.0, 0.0, 14.0, 3.5, 10.5, -7.0];
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Target(target), 1000, 0, 1);
    for &v in &test_values {
        let result = h.eval(&[v]).unwrap();
        let expected = (v - target).abs();
        assert_eq!(
            result, expected,
            "Target({target}) transform must be |f(x)-t| for f(x)={v}"
        );
    }
}

#[test]
fn target_best_raw_f_is_closest_to_target() {
    // For Target(t), best_raw_f should be the f(x) closest to t
    let mut h = EvalHarness::new(|x: &[f64]| x[0], Objective::Target(10.0), 100, 0, 1);
    h.eval(&[15.0]).unwrap(); // |15-10|=5
    h.eval(&[8.0]).unwrap(); // |8-10|=2 (better)
    h.eval(&[12.0]).unwrap(); // |12-10|=2 (tied, no update since not strictly less)
    h.eval(&[9.5]).unwrap(); // |9.5-10|=0.5 (best)
    h.eval(&[13.0]).unwrap(); // |13-10|=3 (worse)

    assert_eq!(h.best_raw_f(), 9.5);
    assert_eq!(h.best_f(), 0.5);
}

// ---------------------------------------------------------------------------
// 3. Budget invariants
// ---------------------------------------------------------------------------

#[test]
fn evals_equals_number_of_successful_eval_calls() {
    let mut h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, 5, 0, 1);
    for i in 0..5 {
        assert_eq!(h.evals(), i);
        h.eval(&[1.0]).unwrap();
        assert_eq!(h.evals(), i + 1);
    }
    // 6th call fails
    assert!(h.eval(&[1.0]).is_err());
    // evals should NOT increment on failed call
    assert_eq!(h.evals(), 5);
}

#[test]
fn remaining_evals_equals_max_minus_current_at_all_times() {
    let max = 10u32;
    let mut h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, max, 0, 1);
    for i in 0..max {
        assert_eq!(
            h.remaining_evals(),
            max - i,
            "remaining_evals invariant broken at eval {i}"
        );
        assert_eq!(
            h.remaining_evals(),
            max - h.evals(),
            "remaining != max - evals at eval {i}"
        );
        h.eval(&[1.0]).unwrap();
    }
    assert_eq!(h.remaining_evals(), 0);
    assert_eq!(h.evals(), max);
}

#[test]
fn after_budget_exhausted_evals_equals_max_evals() {
    let max = 7u32;
    let mut h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, max, 0, 1);
    for _ in 0..max {
        h.eval(&[1.0]).unwrap();
    }
    assert!(h.eval(&[1.0]).is_err());
    assert_eq!(h.evals(), max);
}

#[test]
fn best_f_leq_all_returned_values_for_minimize() {
    // best_f() must be <= every value ever returned by eval()
    let values = [10.0, 3.0, 7.0, 1.0, 5.0, 2.0, 8.0, 0.5, 6.0];
    let idx = std::cell::Cell::new(0usize);
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            let i = idx.get();
            idx.set(i + 1);
            values[i]
        },
        Objective::Minimize,
        100,
        0,
        1,
    );

    let mut all_returned = Vec::new();
    for _ in 0..values.len() {
        let v = h.eval(&[0.0]).unwrap();
        all_returned.push(v);
        for &r in &all_returned {
            assert!(
                h.best_f() <= r,
                "best_f()={} must be <= returned value {r}",
                h.best_f()
            );
        }
    }
}

#[test]
fn best_x_corresponds_to_best_f() {
    // best_x() must be the x that produced best_f()
    let mut h = EvalHarness::new(|x: &[f64]| x[0] * x[0], Objective::Minimize, 100, 0, 1);
    let xs = [5.0, -3.0, 7.0, 2.0, -1.0, 4.0];
    let mut best_val = f64::INFINITY;
    let mut best_x_expected = vec![0.0];

    for &x in &xs {
        let v = h.eval(&[x]).unwrap();
        if v < best_val {
            best_val = v;
            best_x_expected = vec![x];
        }
        assert_eq!(h.best_f(), best_val);
        assert_eq!(h.best_x(), best_x_expected.as_slice());
    }
}

// ---------------------------------------------------------------------------
// 4. NaN/Inf handling invariants
// ---------------------------------------------------------------------------

#[test]
fn nan_never_becomes_best_f() {
    let call = std::cell::Cell::new(0u32);
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            let c = call.get();
            call.set(c + 1);
            // Returns: 10.0, NaN, 5.0, NaN, 7.0
            match c {
                0 => 10.0,
                1 => f64::NAN,
                2 => 5.0,
                3 => f64::NAN,
                4 => 7.0,
                _ => unreachable!(),
            }
        },
        Objective::Minimize,
        100,
        0,
        1,
    );

    h.eval(&[0.0]).unwrap(); // 10.0
    assert_eq!(h.best_f(), 10.0);

    h.eval(&[1.0]).unwrap(); // NaN -> INFINITY, best stays 10.0
    assert_eq!(h.best_f(), 10.0);

    h.eval(&[2.0]).unwrap(); // 5.0, new best
    assert_eq!(h.best_f(), 5.0);

    h.eval(&[3.0]).unwrap(); // NaN -> INFINITY, best stays 5.0
    assert_eq!(h.best_f(), 5.0);

    h.eval(&[4.0]).unwrap(); // 7.0, not better
    assert_eq!(h.best_f(), 5.0);
}

#[test]
fn pos_inf_never_becomes_best_for_minimize() {
    let call = std::cell::Cell::new(0u32);
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            let c = call.get();
            call.set(c + 1);
            if c == 0 { 5.0 } else { f64::INFINITY }
        },
        Objective::Minimize,
        100,
        0,
        1,
    );

    h.eval(&[0.0]).unwrap(); // 5.0
    h.eval(&[1.0]).unwrap(); // +Inf -> sentinel INFINITY
    assert_eq!(h.best_f(), 5.0);
    assert_eq!(h.best_raw_f(), 5.0);
}

#[test]
fn neg_inf_never_becomes_best_for_maximize() {
    // For Maximize: raw=-Inf, transform=-(-Inf)=+Inf, sentinel -> INFINITY
    // So -Inf should never be best for Maximize
    let call = std::cell::Cell::new(0u32);
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            let c = call.get();
            call.set(c + 1);
            if c == 0 { 5.0 } else { f64::NEG_INFINITY }
        },
        Objective::Maximize,
        100,
        0,
        1,
    );

    h.eval(&[0.0]).unwrap(); // raw=5, transformed=-5
    h.eval(&[1.0]).unwrap(); // raw=-Inf, transformed=+Inf, sentinel=INFINITY
    assert_eq!(h.best_raw_f(), 5.0);
    assert_eq!(h.best_f(), -5.0);
}

#[test]
fn nan_inf_sequence_best_is_correct() {
    // Sequence: [5.0, NaN, 3.0, NaN, 4.0] -> best_f must be 3.0
    let call = std::cell::Cell::new(0u32);
    let seq = [5.0, f64::NAN, 3.0, f64::NAN, 4.0];
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            let c = call.get();
            call.set(c + 1);
            seq[c as usize]
        },
        Objective::Minimize,
        100,
        0,
        1,
    );

    for i in 0..5 {
        h.eval(&[i as f64]).unwrap();
    }
    assert_eq!(
        h.best_f(),
        3.0,
        "best_f must be 3.0 after [5, NaN, 3, NaN, 4]"
    );
    assert_eq!(h.best_raw_f(), 3.0, "best_raw_f must be 3.0");
}

// ---------------------------------------------------------------------------
// 5. Monotonicity of best_f
// ---------------------------------------------------------------------------

#[test]
fn best_f_monotonically_non_increasing_minimize() {
    let values = [10.0, 8.0, 12.0, 5.0, 9.0, 3.0, 7.0, 1.0, 6.0, 2.0];
    let idx = std::cell::Cell::new(0usize);
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            let i = idx.get();
            idx.set(i + 1);
            values[i]
        },
        Objective::Minimize,
        100,
        0,
        1,
    );

    let mut prev_best = f64::INFINITY;
    for _ in 0..values.len() {
        h.eval(&[0.0]).unwrap();
        let current_best = h.best_f();
        assert!(
            current_best <= prev_best,
            "best_f must be non-increasing: {prev_best} -> {current_best}"
        );
        prev_best = current_best;
    }
}

#[test]
fn best_f_monotonically_non_increasing_maximize() {
    // For Maximize, the transformed best_f (which is -raw) should be non-increasing
    let values = [2.0, 5.0, 3.0, 8.0, 1.0, 10.0, 4.0];
    let idx = std::cell::Cell::new(0usize);
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            let i = idx.get();
            idx.set(i + 1);
            values[i]
        },
        Objective::Maximize,
        100,
        0,
        1,
    );

    let mut prev_best = f64::INFINITY;
    for _ in 0..values.len() {
        h.eval(&[0.0]).unwrap();
        let current_best = h.best_f();
        assert!(
            current_best <= prev_best,
            "best_f (transformed) must be non-increasing for Maximize: {prev_best} -> {current_best}"
        );
        prev_best = current_best;
    }
}

#[test]
fn best_f_monotonically_non_increasing_target() {
    let values = [20.0, 12.0, 8.0, 11.0, 10.0, 15.0, 9.5];
    let idx = std::cell::Cell::new(0usize);
    let mut h = EvalHarness::new(
        |_: &[f64]| {
            let i = idx.get();
            idx.set(i + 1);
            values[i]
        },
        Objective::Target(10.0),
        100,
        0,
        1,
    );

    let mut prev_best = f64::INFINITY;
    for _ in 0..values.len() {
        h.eval(&[0.0]).unwrap();
        let current_best = h.best_f();
        assert!(
            current_best <= prev_best,
            "best_f must be non-increasing for Target: {prev_best} -> {current_best}"
        );
        prev_best = current_best;
    }
}

// ---------------------------------------------------------------------------
// 6. max_time_ms=0 means no time limit
// ---------------------------------------------------------------------------

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn max_time_ms_zero_means_no_time_limit() {
    use std::thread;
    use std::time::Duration;

    let mut h = EvalHarness::new(
        |_: &[f64]| {
            thread::sleep(Duration::from_millis(5));
            1.0
        },
        Objective::Minimize,
        1000, // high eval limit
        0,    // 0 = no time limit
        1,
    );

    // Run enough evals to exceed 50ms — all should succeed
    for _ in 0..20 {
        assert!(
            h.eval(&[1.0]).is_ok(),
            "with max_time_ms=0, evaluations must not be time-limited"
        );
    }
    // Verify we actually spent meaningful time (>50ms)
    assert!(
        h.elapsed_ms() >= 50,
        "expected >50ms elapsed, got {}ms",
        h.elapsed_ms()
    );
}

// ---------------------------------------------------------------------------
// 7. max_evals=0 means unlimited
// ---------------------------------------------------------------------------

#[test]
fn max_evals_zero_remaining_returns_u32_max() {
    let h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, 0, 0, 1);
    assert_eq!(h.remaining_evals(), u32::MAX);
}

#[test]
fn max_evals_zero_allows_many_evaluations() {
    let mut h = EvalHarness::new(|_: &[f64]| 0.0, Objective::Minimize, 0, 0, 1);
    // Run 10,000 evals — all should succeed
    for i in 0..10_000 {
        assert!(
            h.eval(&[1.0]).is_ok(),
            "with max_evals=0, eval {i} should succeed"
        );
    }
    assert_eq!(h.evals(), 10_000);
    // remaining_evals should still return u32::MAX (unlimited)
    assert_eq!(h.remaining_evals(), u32::MAX);
}
