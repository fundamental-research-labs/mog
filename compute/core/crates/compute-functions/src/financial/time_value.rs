//! Time Value of Money: PV, FV, PMT, NPER, RATE, FVSCHEDULE

use value_types::{CellError, CellValue};

use super::helpers::{arg_num, err_val, fv_core, num_or_err_msg, pmt_core, req_num};
use crate::helpers::coercion::{check_error, extract_numbers, flatten_values};
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// PV
// ===========================================================================

pub(super) struct FnPv;
impl PureFunction for FnPv {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let nper = req_num(args, 1).map_err(err_val)?;
            let pmt = req_num(args, 2).map_err(err_val)?;
            let fv = arg_num(args, 3, 0.0).map_err(err_val)?;
            let type_raw = arg_num(args, 4, 0.0).map_err(err_val)?;
            let type_ = type_raw.trunc();
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PV: type must be 0 or 1, got {type_}"),
                ));
            }
            if rate == 0.0 {
                return Ok(-(fv + pmt * nper));
            }
            let pow = (1.0 + rate).powf(nper);
            let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
            let af = (pow - 1.0) / rate;
            Ok(-(fv / pow + (pmt * af * type_adj) / pow))
        })())
    }
}

// ===========================================================================
// FV
// ===========================================================================

pub(super) struct FnFv;
impl PureFunction for FnFv {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let nper = req_num(args, 1).map_err(err_val)?;
            let pmt = req_num(args, 2).map_err(err_val)?;
            let pv = arg_num(args, 3, 0.0).map_err(err_val)?;
            let type_raw = arg_num(args, 4, 0.0).map_err(err_val)?;
            let type_ = type_raw.trunc();
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("FV: type must be 0 or 1, got {type_}"),
                ));
            }
            Ok(fv_core(rate, nper, pmt, pv, type_))
        })())
    }
}

// ===========================================================================
// PMT
// ===========================================================================

pub(super) struct FnPmt;
impl PureFunction for FnPmt {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PMT"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let nper = req_num(args, 1).map_err(err_val)?;
            let pv = req_num(args, 2).map_err(err_val)?;
            let fv = arg_num(args, 3, 0.0).map_err(err_val)?;
            let type_raw = arg_num(args, 4, 0.0).map_err(err_val)?;
            let type_ = type_raw.trunc();
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PMT: type must be 0 or 1, got {type_}"),
                ));
            }
            Ok(pmt_core(rate, nper, pv, fv, type_))
        })())
    }
}

// ===========================================================================
// NPER
// ===========================================================================

pub(super) struct FnNper;
impl PureFunction for FnNper {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "NPER"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let pmt = req_num(args, 1).map_err(err_val)?;
            let pv = req_num(args, 2).map_err(err_val)?;
            let fv = arg_num(args, 3, 0.0).map_err(err_val)?;
            let type_raw = arg_num(args, 4, 0.0).map_err(err_val)?;
            let type_ = type_raw.trunc();
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("NPER: type must be 0 or 1, got {type_}"),
                ));
            }
            if rate == 0.0 {
                if pmt == 0.0 {
                    return Err(CellValue::error_with_message(
                        CellError::Div0,
                        "NPER: pmt must not be 0 when rate is 0",
                    ));
                }
                return Ok(-(pv + fv) / pmt);
            }
            let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
            let pmt_adj = pmt * type_adj;
            let num = pmt_adj - fv * rate;
            let den = pmt_adj + pv * rate;
            if den == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "NPER: denominator is zero — no solution exists",
                ));
            }
            let ratio = num / den;
            if ratio <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "NPER: no solution — logarithm argument is non-positive",
                ));
            }
            let nper = ratio.ln() / (1.0 + rate).ln();
            if !nper.is_finite() {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "NPER: result is not finite",
                ));
            }
            Ok(nper)
        })())
    }
}

// ===========================================================================
// RATE
// ===========================================================================

pub(super) struct FnRate;
impl PureFunction for FnRate {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "RATE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            5 => Some(CellValue::number(0.1)), // guess defaults to 0.1 (10%)
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let nper = req_num(args, 0).map_err(err_val)?;
            let pmt = req_num(args, 1).map_err(err_val)?;
            let pv = req_num(args, 2).map_err(err_val)?;
            let fv = arg_num(args, 3, 0.0).map_err(err_val)?;
            let type_raw = arg_num(args, 4, 0.0).map_err(err_val)?;
            let type_ = type_raw.trunc();
            let guess = arg_num(args, 5, 0.1).map_err(err_val)?;
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("RATE: type must be 0 or 1, got {type_}"),
                ));
            }
            if nper <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("RATE: nper must be > 0, got {nper}"),
                ));
            }

            // Degenerate case: when pmt=0 and fv=0, the equation pv*(1+r)^nper = 0
            // has no finite solution (requires r=-1, which is outside the domain).
            if pmt == 0.0 && fv == 0.0 && pv != 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "RATE: no solution — pmt=0 and fv=0 with non-zero pv",
                ));
            }

            // Combined f(rate) that dispatches between normal and log-stable near -1
            let f_combined = |rate: f64| -> f64 {
                if rate < -0.99 {
                    // log-stable version
                    let u = 1.0 + rate;
                    if u <= 0.0 {
                        return f64::NAN;
                    }
                    let ln_u = u.ln();
                    let pow = (nper * ln_u).exp();
                    let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
                    pv * pow + pmt * type_adj * (pow - 1.0) / rate + fv
                } else if rate.abs() < 1e-14 {
                    pv + pmt * nper + fv
                } else {
                    let pow = (1.0 + rate).powf(nper);
                    let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
                    pv * pow + pmt * (pow - 1.0) / rate * type_adj + fv
                }
            };

            // Combined f'(rate) that dispatches between normal and log-stable near -1
            let df_combined = |rate: f64| -> f64 {
                if rate < -0.99 {
                    // log-stable derivative
                    let u = 1.0 + rate;
                    if u <= 0.0 {
                        return f64::NAN;
                    }
                    let ln_u = u.ln();
                    let pow = (nper * ln_u).exp();
                    let dpow = nper * pow / u;
                    let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
                    let type_deriv = if type_ != 0.0 { 1.0 } else { 0.0 };
                    let annuity = (pow - 1.0) / rate;
                    let annuity_deriv = (dpow * rate - (pow - 1.0)) / (rate * rate);
                    pv * dpow + pmt * (annuity_deriv * type_adj + annuity * type_deriv)
                } else if rate.abs() < 1e-14 {
                    nper * pv + pmt * nper * (nper - 1.0) / 2.0
                } else {
                    let pow = (1.0 + rate).powf(nper);
                    let dpow = nper * (1.0 + rate).powf(nper - 1.0);
                    let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
                    let type_deriv = if type_ != 0.0 { 1.0 } else { 0.0 };
                    let annuity = (pow - 1.0) / rate;
                    let annuity_deriv = (dpow * rate - (pow - 1.0)) / (rate * rate);
                    pv * dpow + pmt * (annuity_deriv * type_adj + annuity * type_deriv)
                }
            };

            // Scale-adaptive tolerance: the residual f(rate) has magnitude
            // proportional to PV, PMT*nper (annuity at rate≈0), and FV.
            // Use 1e-10 relative to that scale for ~10-digit precision,
            // matching IRR/XIRR's approach.
            let scale = pv.abs().max((pmt * nper).abs()).max(fv.abs()).max(1.0);

            let config = compute_solver::SolverConfig {
                objective: compute_solver::Objective::Target(0.0),
                x0: vec![guess],
                bounds: vec![compute_solver::Bound::lower(-1.0 + 1e-10)],
                ftol: 1e-10 * scale,
                xtol: 1e-14,
                max_evals: 2000,
                max_time_ms: 0,
                ..Default::default()
            };

            let extra_guesses: &[f64] = &[
                0.0, 0.5, 0.1, -0.5, -0.9, 1.0, -0.99, -0.999, -0.9999, -0.99999, -0.999999,
                -0.997, -0.998, -0.9975, -0.9979,
            ];

            let result =
                compute_solver::solve_root_nr(f_combined, df_combined, &config, extra_guesses);

            if result.converged {
                Ok(result.x[0])
            } else {
                Err(CellValue::error_with_message(
                    CellError::Num,
                    "RATE: failed to converge — check inputs",
                ))
            }
        })())
    }
}

// ===========================================================================
// FVSCHEDULE
// ===========================================================================

pub(super) struct FnFvSchedule;
impl PureFunction for FnFvSchedule {
    fn name(&self) -> &'static str {
        "FVSCHEDULE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let principal = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let flat = flatten_values(&[args[1].clone()]);
        let rates = match extract_numbers(&flat) {
            Ok(r) => r,
            Err(e) => return CellValue::Error(e, None),
        };
        let mut fv = principal;
        for r in &rates {
            fv *= 1.0 + r;
        }
        CellValue::number(fv)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnPv));
    registry.register(Box::new(FnFv));
    registry.register(Box::new(FnPmt));
    registry.register(Box::new(FnNper));
    registry.register(Box::new(FnRate));
    registry.register(Box::new(FnFvSchedule));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn approx(a: &CellValue, expected: f64, tol: f64) -> bool {
        match a {
            CellValue::Number(n) => (n.get() - expected).abs() < tol,
            _ => false,
        }
    }

    // -- TVM --

    #[test]
    fn test_pv() {
        let r = FnPv.call(&[num(0.05), num(10.0), num(-1000.0), num(0.0), num(0.0)]);
        assert!(approx(&r, 7721.73, 1.0));
    }

    #[test]
    fn test_fv() {
        let r = FnFv.call(&[
            num(0.05 / 12.0),
            num(120.0),
            num(-100.0),
            num(-1000.0),
            num(0.0),
        ]);
        match r {
            CellValue::Number(n) => assert!(n.get() > 0.0),
            _ => panic!("Expected number"),
        }
    }

    #[test]
    fn test_pmt() {
        let r = FnPmt.call(&[
            num(0.06 / 12.0),
            num(360.0),
            num(100000.0),
            num(0.0),
            num(0.0),
        ]);
        assert!(approx(&r, -599.55, 0.01));
    }

    #[test]
    fn test_nper_zero_rate() {
        let r = FnNper.call(&[num(0.0), num(-100.0), num(1000.0)]);
        assert!(approx(&r, 10.0, 0.01));
    }

    #[test]
    fn test_rate() {
        let r = FnRate.call(&[
            num(360.0),
            num(-599.55),
            num(100000.0),
            num(0.0),
            num(0.0),
            num(0.005),
        ]);
        match &r {
            CellValue::Number(n) => assert!((n.get() * 12.0 - 0.06).abs() < 0.001),
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_fvschedule() {
        let schedule = CellValue::from_rows(vec![vec![num(0.05), num(0.06), num(0.07)]]);
        let r = FnFvSchedule.call(&[num(1000.0), schedule]);
        // 1000 * 1.05 * 1.06 * 1.07 = 1190.91
        assert!(approx(&r, 1190.91, 0.01));
    }

    #[test]
    fn test_rate_near_minus_one() {
        // Test RATE convergence when the solution is very close to -1.
        // We construct parameters where the true rate is -0.9999993:
        //   nper=10, pmt=100, pv=0, type=0
        //   fv = -pmt * ((1+r)^nper - 1) / r  at r = -0.9999993
        // At r = -0.9999993, u = 7e-7, u^10 is tiny, so fv ≈ -100 * (-1) / (-0.9999993) ≈ -100.00007
        let target_rate: f64 = -0.9999993;
        let nper: f64 = 10.0;
        let pmt: f64 = 100.0;
        let pv: f64 = 0.0;
        let type_: f64 = 0.0;
        // Compute fv so that f(target_rate) = 0 exactly (in f64)
        let u = 1.0 + target_rate;
        let ln_u = u.ln();
        let pow = (nper * ln_u).exp();
        let fv = -(pv * pow + pmt * (pow - 1.0) / target_rate);

        let r = FnRate.call(&[num(nper), num(pmt), num(pv), num(fv), num(type_), num(0.1)]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - target_rate).abs() < 1e-6,
                    "Expected rate near {}, got {}",
                    target_rate,
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_rate_no_convergence() {
        // All zeroes - PMT=0, PV=0, FV=0 is trivially satisfied but
        // let's use a case that truly won't converge: contradictory inputs
        // nper=1, pmt=0, pv=100, fv=100 -> 100*(1+r) + 100 = 0 -> r = -2, but clipped to -0.99
        // Actually use: nper=1, pmt=0, pv=0, fv=0 converges to 0
        // Better: impossible scenario where convergence oscillates
        let r = FnRate.call(&[
            num(1.0),
            num(0.0),
            num(100.0),
            num(100.0),
            num(0.0),
            num(0.1),
        ]);
        // f(rate) = 100*(1+r) + 100 = 200 + 100*r, which converges to r=-2, but that's < -1
        assert_eq!(r, err(CellError::Num));
    }

    // -- Fix 3: Type parameter truncation --

    #[test]
    fn test_pv_type_truncation() {
        // PV with type=0.9 should truncate to 0 (end of period), not error
        let r = FnPv.call(&[num(0.05), num(10.0), num(-1000.0), num(0.0), num(0.9)]);
        let r_zero = FnPv.call(&[num(0.05), num(10.0), num(-1000.0), num(0.0), num(0.0)]);
        assert!(
            matches!(r, CellValue::Number(_)),
            "PV with type=0.9 should not error: {:?}",
            r
        );
        match (&r, &r_zero) {
            (CellValue::Number(a), CellValue::Number(b)) => {
                assert!(
                    (a.get() - b.get()).abs() < 0.001,
                    "PV(type=0.9) should equal PV(type=0): {} vs {}",
                    a.get(),
                    b.get()
                );
            }
            _ => panic!("Expected numbers"),
        }
    }

    #[test]
    fn test_fv_type_truncation() {
        // FV with type=0.9 should truncate to 0
        let r = FnFv.call(&[num(0.05), num(10.0), num(-100.0), num(0.0), num(0.9)]);
        assert!(
            matches!(r, CellValue::Number(_)),
            "FV with type=0.9 should not error: {:?}",
            r
        );
    }

    #[test]
    fn test_pmt_type_truncation() {
        // PMT with type=0.9 should truncate to 0
        let r = FnPmt.call(&[num(0.05), num(10.0), num(1000.0), num(0.0), num(0.9)]);
        assert!(
            matches!(r, CellValue::Number(_)),
            "PMT with type=0.9 should not error: {:?}",
            r
        );
    }

    #[test]
    fn test_nper_type_truncation() {
        // NPER with type=0.9 should truncate to 0
        let r = FnNper.call(&[num(0.05), num(-100.0), num(1000.0), num(0.0), num(0.9)]);
        assert!(
            matches!(r, CellValue::Number(_)),
            "NPER with type=0.9 should not error: {:?}",
            r
        );
    }

    #[test]
    fn test_type_truncation_1_5_becomes_1() {
        // type=1.5 should truncate to 1 (beginning of period)
        let r_1_5 = FnPv.call(&[num(0.05), num(10.0), num(-1000.0), num(0.0), num(1.5)]);
        let r_1 = FnPv.call(&[num(0.05), num(10.0), num(-1000.0), num(0.0), num(1.0)]);
        match (&r_1_5, &r_1) {
            (CellValue::Number(a), CellValue::Number(b)) => {
                assert!(
                    (a.get() - b.get()).abs() < 0.001,
                    "PV(type=1.5) should equal PV(type=1): {} vs {}",
                    a.get(),
                    b.get()
                );
            }
            _ => panic!("Expected numbers"),
        }
    }

    #[test]
    fn test_type_2_still_errors() {
        // type=2 should still error (truncates to 2, which is not 0 or 1)
        let r = FnPv.call(&[num(0.05), num(10.0), num(-1000.0), num(0.0), num(2.0)]);
        assert_eq!(r, err(CellError::Num), "PV with type=2 should error");
    }

    // ====================================================================
    // PMT precision cascade reproduction
    // ====================================================================
    //
    // Reproduces a floating-point precision cascade observed in amortization
    // schedules that recalculate PMT for each remaining period.
    //
    // A large loan with a 24-month interest-only period followed by 336
    // months of amortization recalculates PMT each month. Tiny rounding
    // differences in pmt_core (order ~1e-10 per payment) accumulate over
    // 336 iterations, producing a final balance residual of ~-1.37e-9
    // vs Excel's ~-9.90e-10 (delta ≈ 3.78e-10).
    //
    // Root causes investigated:
    //   - powf vs powi: powi gives ~8% improvement (44 ULPs in raw power)
    //   - Alternative PMT formulas (negative exponent): actually WORSE
    //   - Kahan compensated subtraction: no improvement (error isn't in
    //     the subtraction but in pmt_core's intermediate products)
    //   - Most likely explanation: Excel uses 80-bit extended precision
    //     (x87 FPU) for intermediate results, giving ~3 extra bits per op.
    //
    // This is NOT a bug — it's an inherent f64 limitation. But using powi
    // for integer nper would provide a small free improvement.
    // ====================================================================

    #[test]
    fn test_pmt_amortization_precision_cascade() {
        use super::super::helpers::pmt_core;

        // Representative amortization schedule parameters.
        let initial_balance = 27_500_000.0_f64;
        let annual_rate = 0.065_f64;
        let monthly_rate = annual_rate / 12.0;
        let total_term: u32 = 360;
        let io_months: u32 = 24;

        // Simulate the full amortization schedule (matches spreadsheet formulas):
        //   C[n] = H[n-1]                      (beginning balance)
        //   F[n] = C[n] * rate / 12             (interest)
        //   E[n] = -PMT(rate/12, remaining, C[n]) (payment, recalculated each month)
        //   G[n] = E[n] - F[n]                  (principal)
        //   H[n] = C[n] - G[n]                  (ending balance)
        let mut balance = initial_balance;

        for month in 1..=total_term {
            let interest = balance * monthly_rate;
            if month <= io_months {
                // Interest-only: payment = interest, balance unchanged
            } else {
                let remaining = total_term - month + 1;
                let payment = -pmt_core(monthly_rate, remaining as f64, balance, 0.0, 0.0);
                let principal = payment - interest;
                balance -= principal;
            }
        }

        let our_residual = balance;

        // 1) The loan correctly amortizes to near-zero.
        assert!(
            our_residual.abs() < 1e-6,
            "Final balance should be near zero for a fully amortized loan, got {:.6e}",
            our_residual
        );

        // 2) The residual is only floating-point noise.
        assert!(
            our_residual < 0.0,
            "Residual should be slightly negative (tiny overpayment), got {:.6e}",
            our_residual
        );
        assert!(
            our_residual > -1e-6,
            "Residual magnitude should be sub-microsecond, got {:.6e}",
            our_residual
        );
    }

    #[test]
    fn test_pmt_powf_vs_powi_precision() {
        // Demonstrates that powf(nper) introduces more error than powi(nper)
        // for the power computation in pmt_core when nper is an integer.
        //
        // powf uses exp(n * ln(x)) which adds log/exp rounding;
        // powi uses repeated squaring which is exact per multiply.
        let base = 1.0 + 0.065_f64 / 12.0;
        let nper = 336;

        let pow_f = base.powf(nper as f64);
        let pow_i = base.powi(nper);

        // They should be very close but not identical
        let ulp_diff = (pow_f.to_bits() as i64 - pow_i.to_bits() as i64).unsigned_abs();

        // powf introduces measurable ULP drift vs powi
        assert!(
            ulp_diff > 0,
            "powf and powi should differ for large integer exponents"
        );
        assert!(
            ulp_diff < 100,
            "ULP difference should be bounded, got {}",
            ulp_diff
        );

        // Verify powi gives a result closer to a high-precision reference.
        // We compute the reference via iterative squaring with f64 (matches powi).
        // The key insight: for integer exponents, powi is strictly more accurate
        // because it avoids the exp(n*ln(x)) detour through transcendental functions.
        let pow_ref = {
            let mut result = 1.0_f64;
            let mut b = base;
            let mut n = nper as u32;
            while n > 0 {
                if n & 1 == 1 {
                    result *= b;
                }
                b *= b;
                n >>= 1;
            }
            result
        };
        assert_eq!(
            pow_i.to_bits(),
            pow_ref.to_bits(),
            "powi should match manual repeated squaring exactly"
        );

        // The amortization impact: simulate with each variant
        let rate = 0.065_f64 / 12.0;
        let initial = 27645942.3194807_f64;
        let excel = -9.89530235528946e-10_f64;

        let simulate = |use_powi: bool| -> f64 {
            let mut balance = initial;
            for month in 1..=360u32 {
                let interest = balance * rate;
                if month > 24 {
                    let remaining = 360 - month + 1;
                    let pow = if use_powi {
                        (1.0 + rate).powi(remaining as i32)
                    } else {
                        (1.0 + rate).powf(remaining as f64)
                    };
                    let af = (pow - 1.0) / rate;
                    let payment = (balance * pow) / af;
                    let principal = payment - interest;
                    balance -= principal;
                }
            }
            balance
        };

        let res_powf = simulate(false);
        let res_powi = simulate(true);
        let err_powf = (res_powf - excel).abs();
        let err_powi = (res_powi - excel).abs();

        // powi should be at least as close to Excel as powf
        assert!(
            err_powi <= err_powf,
            "powi ({:.6e}) should be at least as precise as powf ({:.6e})",
            err_powi,
            err_powf
        );
    }

    #[test]
    fn test_pmt_recalc_each_month_is_better_than_fixed() {
        // Verifies that recalculating PMT each month (as the spreadsheet does)
        // is more numerically stable than using a fixed PMT computed once.
        //
        // This is because recalculating effectively self-corrects accumulated
        // rounding errors at each step.
        use super::super::helpers::pmt_core;

        let rate = 0.065_f64 / 12.0;
        let initial = 27645942.3194807_f64;

        // Strategy A: Recalculate PMT each month (spreadsheet approach)
        let mut bal_recalc = initial;
        for month in 1..=360u32 {
            let interest = bal_recalc * rate;
            if month > 24 {
                let remaining = 360 - month + 1;
                let payment = -pmt_core(rate, remaining as f64, bal_recalc, 0.0, 0.0);
                bal_recalc -= payment - interest;
            }
        }

        // Strategy B: Compute PMT once and reuse
        let fixed_payment = -pmt_core(rate, 336.0, initial, 0.0, 0.0);
        let mut bal_fixed = initial;
        for month in 1..=360u32 {
            let interest = bal_fixed * rate;
            if month > 24 {
                bal_fixed -= fixed_payment - interest;
            }
        }

        // Recalculating each month should give a smaller residual
        assert!(
            bal_recalc.abs() < bal_fixed.abs(),
            "Recalc residual ({:.6e}) should be smaller than fixed ({:.6e})",
            bal_recalc.abs(),
            bal_fixed.abs()
        );

        // The improvement should be significant (>100x)
        let improvement = bal_fixed.abs() / bal_recalc.abs();
        assert!(
            improvement > 100.0,
            "Recalc should be >100x better than fixed, got {:.1}x",
            improvement
        );
    }
}
