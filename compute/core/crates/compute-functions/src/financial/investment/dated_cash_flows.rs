use value_types::{CellError, CellValue};

/// Excel's 1900 date system supports serials through 31 December 9999.
///
/// This is a contract boundary, rather than a solver bound.  The date
/// conversion helper intentionally clamps very large serials for display, so
/// financial functions validate against the documented Excel range before
/// doing any date arithmetic.
const MAX_EXCEL_DATE_SERIAL: f64 = 2_958_465.0;

/// Normalize an Excel date serial at the financial-function boundary.
///
/// XIRR/XNPV use whole calendar dates even when a caller supplies a fractional
/// serial. Validate the sign before truncating so a negative fraction cannot
/// be silently converted into the valid serial zero, then validate the whole
/// date against Excel's upper boundary.
fn normalize_date_serial(serial: f64) -> Result<f64, CellError> {
    if !serial.is_finite() || serial < 0.0 {
        return Err(CellError::Value);
    }
    let truncated = serial.trunc();
    if truncated > MAX_EXCEL_DATE_SERIAL {
        return Err(CellError::Value);
    }
    Ok(truncated)
}

/// Iterate two flattened ranges in lockstep, collecting (value, date) pairs.
/// Matches Excel behaviour:
///  - Errors in either position propagate immediately.
///  - Empty (Null) value cells are treated as 0 when the date is valid.
///  - Text entries are coerced to numbers (including date-like text -> serial).
///    If coercion fails, the pair is skipped.
///  - Date serials are validated against the Excel date range and truncated to
///    whole calendar days.
///  - Boolean entries in either position cause the pair to be skipped.
///  - If the date is Null/Boolean the pair is skipped regardless.
pub(super) fn collect_value_date_pairs(
    flat_vals: &[CellValue],
    flat_dates: &[CellValue],
) -> Result<(Vec<f64>, Vec<f64>), CellError> {
    // Excel requires the values and dates references to have the same number
    // of entries.  Check this before filtering skipped cells; otherwise a
    // mismatched range can accidentally produce enough remaining pairs to
    // return a plausible but incorrect result.
    if flat_vals.len() != flat_dates.len() {
        return Err(CellError::Num);
    }

    let len = flat_vals.len();
    let mut values = Vec::with_capacity(len);
    let mut dates = Vec::with_capacity(len);
    for i in 0..len {
        let v = &flat_vals[i];
        let d = &flat_dates[i];
        if let CellValue::Error(e, _) = v {
            return Err(*e);
        }
        if let CellValue::Error(e, _) = d {
            return Err(*e);
        }
        let date_val = match d {
            CellValue::Number(n) => n.get(),
            CellValue::Text(_) => match d.coerce_to_number() {
                Ok(n) => n,
                Err(_) => continue,
            },
            _ => continue,
        };
        let date_val = normalize_date_serial(date_val)?;
        let cash_flow = match v {
            CellValue::Number(n) => n.get(),
            CellValue::Null => 0.0,
            CellValue::Text(_) => match v.coerce_to_number() {
                Ok(n) => n,
                Err(_) => continue,
            },
            _ => continue,
        };
        values.push(cash_flow);
        dates.push(date_val);
    }
    Ok((values, dates))
}

/// Check both the normalized residual and the local rate correction.
///
/// A residual by itself is not a convergence certificate for a cash-flow
/// curve: a nearly stationary curve can have a tiny residual while its next
/// Newton correction is enormous.  The correction estimate is computed in
/// `log1p(rate)` space, then converted to a first-order rate step.  Exact zero
/// remains an immediate success, and the caller supplies the documented
/// function accuracy as `rate_tolerance` (IRR: 1e-7; XIRR: 1e-8).
fn financial_converged<D>(
    df: &mut D,
    rate: f64,
    residual: f64,
    residual_tolerance: f64,
    rate_tolerance: f64,
) -> bool
where
    D: FnMut(f64) -> f64,
{
    if !residual.is_finite() || residual.abs() > residual_tolerance {
        return false;
    }
    if residual == 0.0 {
        return true;
    }

    let derivative_in_log_space = df(rate) * (1.0 + rate);
    if !derivative_in_log_space.is_finite() || derivative_in_log_space == 0.0 {
        return false;
    }
    let estimated_log_step = residual / derivative_in_log_space;
    let estimated_rate_step = estimated_log_step.abs() * (1.0 + rate);
    estimated_rate_step.is_finite() && estimated_rate_step <= rate_tolerance * (1.0 + rate.abs())
}

/// Solve a financial cash-flow root from the caller's initial guess.
///
/// IRR and XIRR both have a domain of `rate > -1`, but the generic solver is
/// also used by unrelated functions and deliberately tries a list of fallback
/// guesses.  Those fallbacks can select a different root when a cash-flow
/// polynomial has multiple roots and can hide the documented non-convergence
/// behavior of the financial functions.  This routine keeps the financial
/// contract local: Newton iterations start at the supplied guess, are
/// safeguarded in `log1p(rate)` space, and use a bounded bracket fallback.
/// `max_iterations` is the function's documented iteration limit (20 for IRR,
/// 100 for XIRR). The caller supplies a scale-normalized residual tolerance
/// and the function's documented rate-accuracy tolerance.
pub(super) fn solve_financial_root<F, D>(
    mut f: F,
    mut df: D,
    guess: f64,
    max_iterations: usize,
    residual_tolerance: f64,
    rate_tolerance: f64,
) -> Option<f64>
where
    F: FnMut(f64) -> f64,
    D: FnMut(f64) -> f64,
{
    if !guess.is_finite() || guess <= -1.0 || max_iterations == 0 {
        return None;
    }

    // Work in log(1 + rate), which keeps trial rates above -1 and prevents a
    // Newton step from crossing the singularity.  These are representable
    // f64 domain limits, not assumptions about any particular workbook.
    // The nearest representable rate above -1 is one half of the usual
    // machine epsilon away from -1. Using `f64::EPSILON` itself skips that
    // value and unnecessarily narrows the valid financial domain.
    let min_rate = -1.0 + f64::EPSILON / 2.0;
    let min_log_base = min_rate.ln_1p();
    let max_log_base = f64::MAX.ln_1p();
    let rate_from_log_base = |z: f64| -> Option<f64> {
        if !z.is_finite() || z < min_log_base || z > max_log_base {
            return None;
        }
        let rate = z.exp_m1();
        if rate.is_finite() && rate > -1.0 {
            Some(rate)
        } else {
            None
        }
    };
    let sign_change = |a: f64, b: f64| -> bool {
        a == 0.0 || b == 0.0 || (a < 0.0 && b > 0.0) || (a > 0.0 && b < 0.0)
    };

    let mut z = guess.ln_1p();
    let mut rate = guess;
    let mut f_rate = f(rate);
    if !f_rate.is_finite() {
        return None;
    }
    if financial_converged(&mut df, rate, f_rate, residual_tolerance, rate_tolerance) {
        return Some(rate);
    }

    // A damped Newton phase preserves the caller's guess as the root-selection
    // seed while remaining stable for steep high-return and near-singular
    // cash-flow curves.
    let mut newton_iterations = 0;
    for _ in 0..max_iterations {
        newton_iterations += 1;
        let derivative = df(rate);
        let derivative_in_log_space = derivative * (1.0 + rate);
        if !derivative_in_log_space.is_finite() || derivative_in_log_space == 0.0 {
            break;
        }
        let full_step = f_rate / derivative_in_log_space;
        if !full_step.is_finite() {
            break;
        }

        let mut damping = 1.0;
        let mut accepted = None;
        // A finite number of reductions bounds work even when every Newton
        // proposal is outside the financial domain or overflows evaluation.
        for _ in 0..24 {
            let candidate_z = z - full_step * damping;
            let Some(candidate_rate) = rate_from_log_base(candidate_z) else {
                damping *= 0.5;
                continue;
            };
            let candidate_f = f(candidate_rate);
            if candidate_f.is_finite()
                && (candidate_f.abs() < f_rate.abs() || candidate_f.abs() <= residual_tolerance)
            {
                accepted = Some((candidate_z, candidate_rate, candidate_f));
                break;
            }
            damping *= 0.5;
        }
        let Some((candidate_z, candidate_rate, candidate_f)) = accepted else {
            break;
        };
        z = candidate_z;
        rate = candidate_rate;
        f_rate = candidate_f;
        if financial_converged(&mut df, rate, f_rate, residual_tolerance, rate_tolerance) {
            return Some(rate);
        }
        if (full_step * damping).abs() <= f64::EPSILON * z.abs().max(1.0) {
            break;
        }
    }

    // If Newton stalled, search for the nearest sign-changing interval around
    // the supplied guess.  Exponential expansion covers both sides of the
    // domain without a hard-coded list of rates or fixture-specific roots.
    let z0 = guess.ln_1p();
    let f0 = f(guess);
    if !f0.is_finite() {
        return None;
    }

    let mut bracket = None;
    let mut radius = 0.5_f64;
    for _ in 0..32 {
        let left_z = (z0 - radius).max(min_log_base);
        let right_z = (z0 + radius).min(max_log_base);
        let left = if left_z < z0 {
            rate_from_log_base(left_z).and_then(|left_rate| {
                let left_f = f(left_rate);
                left_f.is_finite().then_some((left_z, left_f))
            })
        } else {
            None
        };
        let right = if right_z > z0 {
            rate_from_log_base(right_z).and_then(|right_rate| {
                let right_f = f(right_rate);
                right_f.is_finite().then_some((right_z, right_f))
            })
        } else {
            None
        };

        if let Some((left_z, left_f)) = left
            && sign_change(left_f, f0)
        {
            bracket = Some((left_z, left_f, z0, f0));
            break;
        }
        if let Some((right_z, right_f)) = right
            && sign_change(f0, right_f)
        {
            bracket = Some((z0, f0, right_z, right_f));
            break;
        }

        if left_z <= min_log_base && right_z >= max_log_base {
            break;
        }
        radius *= 2.0;
    }

    let Some((mut left_z, mut left_f, mut right_z, mut right_f)) = bracket else {
        return None;
    };
    let fallback_iterations = max_iterations.saturating_sub(newton_iterations);
    if fallback_iterations == 0 {
        return None;
    }
    // Keep the initial guess in the bracket.  It is a useful Newton seed and
    // makes the fallback respect the supplied guess when several roots exist.
    z = z0;
    rate = guess;
    f_rate = f0;

    for _ in 0..fallback_iterations {
        if financial_converged(&mut df, rate, f_rate, residual_tolerance, rate_tolerance) {
            return Some(rate);
        }

        let midpoint_z = left_z + (right_z - left_z) * 0.5;
        let derivative = df(rate) * (1.0 + rate);
        let mut candidate_z = midpoint_z;
        if derivative.is_finite() && derivative != 0.0 {
            let newton_z = z - f_rate / derivative;
            if newton_z.is_finite() && newton_z > left_z && newton_z < right_z {
                candidate_z = newton_z;
            }
        }

        let Some(candidate_rate) = rate_from_log_base(candidate_z) else {
            candidate_z = midpoint_z;
            let Some(candidate_rate) = rate_from_log_base(candidate_z) else {
                return None;
            };
            let candidate_f = f(candidate_rate);
            if !candidate_f.is_finite() {
                return None;
            }
            if financial_converged(
                &mut df,
                candidate_rate,
                candidate_f,
                residual_tolerance,
                rate_tolerance,
            ) {
                return Some(candidate_rate);
            }
            if sign_change(left_f, candidate_f) {
                right_z = candidate_z;
                right_f = candidate_f;
            } else {
                left_z = candidate_z;
                left_f = candidate_f;
            }
            z = candidate_z;
            rate = candidate_rate;
            f_rate = candidate_f;
            continue;
        };
        let candidate_f = f(candidate_rate);
        if !candidate_f.is_finite() {
            candidate_z = midpoint_z;
            let Some(midpoint_rate) = rate_from_log_base(candidate_z) else {
                return None;
            };
            let midpoint_f = f(midpoint_rate);
            if !midpoint_f.is_finite() {
                return None;
            }
            if financial_converged(
                &mut df,
                midpoint_rate,
                midpoint_f,
                residual_tolerance,
                rate_tolerance,
            ) {
                return Some(midpoint_rate);
            }
            if sign_change(left_f, midpoint_f) {
                right_z = candidate_z;
                right_f = midpoint_f;
            } else {
                left_z = candidate_z;
                left_f = midpoint_f;
            }
            z = candidate_z;
            rate = midpoint_rate;
            f_rate = midpoint_f;
            continue;
        }
        if financial_converged(
            &mut df,
            candidate_rate,
            candidate_f,
            residual_tolerance,
            rate_tolerance,
        ) {
            return Some(candidate_rate);
        }
        if sign_change(left_f, candidate_f) {
            right_z = candidate_z;
            right_f = candidate_f;
        } else {
            left_z = candidate_z;
            left_f = candidate_f;
        }
        z = candidate_z;
        rate = candidate_rate;
        f_rate = candidate_f;

        if (right_z - left_z).abs() <= f64::EPSILON * z.abs().max(1.0) {
            break;
        }
    }

    // A final endpoint check avoids dropping a valid root that landed at the
    // bracket edge on the last bounded iteration.
    if financial_converged(&mut df, rate, f_rate, residual_tolerance, rate_tolerance) {
        Some(rate)
    } else if let Some(left_rate) = rate_from_log_base(left_z)
        && financial_converged(
            &mut df,
            left_rate,
            left_f,
            residual_tolerance,
            rate_tolerance,
        )
    {
        Some(left_rate)
    } else if let Some(right_rate) = rate_from_log_base(right_z)
        && financial_converged(
            &mut df,
            right_rate,
            right_f,
            residual_tolerance,
            rate_tolerance,
        )
    {
        Some(right_rate)
    } else {
        None
    }
}
