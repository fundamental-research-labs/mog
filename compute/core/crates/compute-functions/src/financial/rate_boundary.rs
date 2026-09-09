//! RATE convergence for zero payment/future value and nonzero present value.
//!
//! A mathematical endpoint at -1 is not sufficient for Excel to return a
//! number. This bounded secant policy reproduces its observed convergence on
//! period/guess grids, including the stricter domain checks near that endpoint.
//! It is intentionally separate from the ordinary annuity solver.

use super::super::helpers::tvm_power;

const MAX_ITERATIONS: usize = 200;
const INITIAL_STEP: f64 = 0.001;
const PRECISION: f64 = 1e-7;
const TERMINAL_PRECISION: f64 = 1e-4;

// Excel flushes underflow to zero instead of retaining subnormal results.
// In particular, flushing the secant numerator is observable for tiny PV.
fn normal(value: f64) -> f64 {
    if value.is_subnormal() {
        0.0_f64.copysign(value)
    } else {
        value
    }
}

fn residual(nper: f64, pv: f64, rate: f64) -> Option<f64> {
    if !rate.is_finite() || rate <= -1.0 {
        return None;
    }
    let value = normal(pv * normal(tvm_power(rate, nper)?));
    value.is_finite().then_some(value)
}

fn converged(rate: f64, delta: f64, value: f64, precision: f64) -> bool {
    // The tolerance neighborhood must also stay inside the rate domain.
    // Both this check and the relaxed terminal tolerance are compatibility
    // behavior verified on either side of the observed Excel thresholds.
    delta < precision && value.abs() < precision && 1.0 + rate > precision
}

pub(super) fn solve(nper: f64, pv: f64, guess: f64) -> Option<f64> {
    let mut previous = guess;
    let mut rate = guess
        + if pv < 0.0 {
            INITIAL_STEP
        } else {
            -INITIAL_STEP
        };
    let mut previous_value = residual(nper, pv, previous)?;
    let mut value = residual(nper, pv, rate)?;
    let mut delta = f64::INFINITY;

    for _ in 0..MAX_ITERATIONS {
        let denominator = normal(value - previous_value);
        if denominator == 0.0 || !denominator.is_finite() {
            return None;
        }
        // Keep the delta form and operation order: a cross-multiplied secant
        // is algebraically equivalent but has different underflow behavior.
        let numerator = normal(value * normal(rate - previous));
        let next = normal(rate - normal(numerator / denominator));
        let next_value = residual(nper, pv, next)?;
        delta = (next - rate).abs();
        previous = rate;
        previous_value = value;
        rate = next;
        value = next_value;

        if converged(rate, delta, value, PRECISION) {
            return Some(rate);
        }
    }

    converged(rate, delta, value, TERMINAL_PRECISION).then_some(rate)
}

#[cfg(test)]
#[path = "rate_boundary_tests.rs"]
mod tests;
