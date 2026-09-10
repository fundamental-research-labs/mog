//! Bessel functions: BESSELI, BESSELJ, BESSELK, BESSELY

use value_types::{CellError, CellValue};

use super::helpers::coerce_num;
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// Bessel Function Helpers (legacy Excel Analysis ToolPak approximations)
// ===========================================================================

// Excel's original Analysis ToolPak Bessel routines are documented as the
// Numerical Recipes rational/asymptotic approximations.  The frozen workbook
// corpus contains those values (rather than the exact power-series values),
// so these constants and regime boundaries are part of the compatibility
// contract.  They are intentionally kept as decimal literals from the
// published routines; replacing them with a generic series changes Excel
// compatibility by several ulps to 1e-8 for the corpus's order-three cases.
// This is the intentionally rounded constant from Excel's published ATP
// routine. Replacing it with FRAC_2_PI changes the legacy compatibility bits.
#[allow(clippy::approx_constant)]
const BESSEL_W: f64 = 0.636619772; // 2/pi in the published routine
const BESSEL_ACC: f64 = 40.0;
const BESSEL_BIGNO: f64 = 1.0e10;
const BESSEL_BIGNI: f64 = 1.0e-10;
// The published routines take a C `int` order, but the forward K/Y and Miller
// recurrences are O(n).  Keep the repository's established hang guard while
// covering the full supported order range without allowing worksheet input to
// turn one formula into an unbounded loop.
const BESSEL_MAX_ORDER: usize = 200;
// Below this x, forming 2/x overflows f64.  I_n/J_n for n >= 2 are already
// below the representable range; K_n/Y_n for n >= 2 are outside it.
const BESSEL_TOX_LIMIT: f64 = 2.0 / f64::MAX;

/// Evaluate a polynomial written in the Numerical Recipes Horner form.
#[inline]
fn horner(y: f64, coefficients: &[f64]) -> f64 {
    let mut result = coefficients[coefficients.len() - 1];
    for coefficient in coefficients[..coefficients.len() - 1].iter().rev() {
        result = *coefficient + y * result;
    }
    result
}

/// Modified Bessel I0 from the legacy Excel/Analysis ToolPak routine.
fn bessel_i0(x: f64) -> f64 {
    let ax = x.abs();
    if ax < 3.75 {
        let y = (x / 3.75) * (x / 3.75);
        horner(
            y,
            &[
                1.0,
                3.5156229,
                3.0899424,
                1.2067492,
                0.2659732,
                0.360768e-1,
                0.45813e-2,
            ],
        )
    } else {
        let y = 3.75 / ax;
        let polynomial = horner(
            y,
            &[
                0.39894228,
                0.1328592e-1,
                0.225319e-2,
                -0.157565e-2,
                0.916281e-2,
                -0.2057706e-1,
                0.2635537e-1,
                -0.1647633e-1,
                0.392377e-2,
            ],
        );
        ax.exp() / ax.sqrt() * polynomial
    }
}

/// Modified Bessel I1 from the legacy Excel/Analysis ToolPak routine.
fn bessel_i1(x: f64) -> f64 {
    let ax = x.abs();
    if ax < 3.75 {
        let y = (x / 3.75) * (x / 3.75);
        x * horner(
            y,
            &[
                0.5,
                0.87890594,
                0.51498869,
                0.15084934,
                0.2658733e-1,
                0.301532e-2,
                0.32411e-3,
            ],
        )
    } else {
        let y = 3.75 / ax;
        // Keep the two Horner stages from the published C routine.  This
        // preserves its evaluation order and its behavior at the transition.
        let tail = 0.2282967e-1 + y * (-0.2895312e-1 + y * (0.1787654e-1 - y * 0.420059e-2));
        let polynomial = 0.39894228
            + y * (-0.3988024e-1
                + y * (-0.362018e-2 + y * (0.163801e-2 + y * (-0.1031555e-1 + y * tail))));
        let result = ax.exp() / ax.sqrt() * polynomial;
        if x < 0.0 {
            -result
        } else {
            result
        }
    }
}

/// Modified Bessel I_n, using Miller's downward recurrence from Excel's ATP.
fn bessel_i(x: f64, n: usize) -> f64 {
    if n == 0 {
        return bessel_i0(x);
    }
    if n == 1 {
        return bessel_i1(x);
    }
    if x == 0.0 {
        return 0.0;
    }

    let ax = x.abs();
    if ax <= BESSEL_TOX_LIMIT {
        return 0.0;
    }
    let tox = 2.0 / ax;
    let root = (BESSEL_ACC * n as f64).sqrt() as usize;
    let Some(m) = n.checked_add(root).and_then(|value| value.checked_mul(2)) else {
        return f64::NAN;
    };
    let mut bip = 0.0;
    let mut bi = 1.0;
    let mut ans = 0.0;

    for j in (1..=m).rev() {
        let bim = bip + j as f64 * tox * bi;
        bip = bi;
        bi = bim;
        if bi.abs() > BESSEL_BIGNO {
            ans *= BESSEL_BIGNI;
            bi *= BESSEL_BIGNI;
            bip *= BESSEL_BIGNI;
        }
        if j == n {
            ans = bip;
        }
    }

    let result = ans * bessel_i0(x) / bi;
    if x < 0.0 && n % 2 == 1 {
        -result
    } else {
        result
    }
}

/// Bessel J0 from the legacy Excel/Analysis ToolPak routine.
fn bessel_j0(x: f64) -> f64 {
    // The rational approximation is close to, but not exactly, one at zero.
    // Excel's function has the analytical zero limit, so preserve it before
    // evaluating the approximation.
    if x == 0.0 {
        return 1.0;
    }
    let ax = x.abs();
    if ax < 8.0 {
        let y = x * x;
        horner(
            y,
            &[
                57568490574.0,
                -13362590354.0,
                651619640.7,
                -11214424.18,
                77392.33017,
                -184.9052456,
            ],
        ) / horner(
            y,
            &[
                57568490411.0,
                1029532985.0,
                9494680.718,
                59272.64853,
                267.8532712,
                1.0,
            ],
        )
    } else {
        let z = 8.0 / ax;
        let y = z * z;
        let xx = ax - 0.785398164;
        let ans1 = horner(
            y,
            &[
                1.0,
                -0.1098628627e-2,
                0.2734510407e-4,
                -0.2073370639e-5,
                0.2093887211e-6,
            ],
        );
        let ans2 = horner(
            y,
            &[
                -0.1562499995e-1,
                0.1430488765e-3,
                -0.6911147651e-5,
                0.7621095161e-6,
                -0.934935152e-7,
            ],
        );
        (BESSEL_W / ax).sqrt() * (xx.cos() * ans1 - z * xx.sin() * ans2)
    }
}

/// Bessel J1 from the legacy Excel/Analysis ToolPak routine.
fn bessel_j1(x: f64) -> f64 {
    if x == 0.0 {
        return 0.0;
    }
    let ax = x.abs();
    if ax < 8.0 {
        let y = x * x;
        // Q89404 contains a transposed digit in this numerator.  The value
        // below is the Numerical Recipes/Excel constant (72,362,614,232),
        // corroborated by the published Excel example and the other ATP
        // implementations.
        x * horner(
            y,
            &[
                72362614232.0,
                -7895059235.0,
                242396853.1,
                -2972611.439,
                15704.48260,
                -30.16036606,
            ],
        ) / horner(
            y,
            &[
                144725228442.0,
                2300535178.0,
                18583304.74,
                99447.43394,
                376.9991397,
                1.0,
            ],
        )
    } else {
        let z = 8.0 / ax;
        let y = z * z;
        let xx = ax - 2.356194491;
        let ans1 = horner(
            y,
            &[
                1.0,
                0.183105e-2,
                -0.3516396496e-4,
                0.2457520174e-5,
                -0.240337019e-6,
            ],
        );
        let ans2 = horner(
            y,
            &[
                0.04687499995,
                -0.2002690873e-3,
                0.8449199096e-5,
                -0.88228987e-6,
                0.105787412e-6,
            ],
        );
        let result = (BESSEL_W / ax).sqrt() * (xx.cos() * ans1 - z * xx.sin() * ans2);
        if x < 0.0 {
            -result
        } else {
            result
        }
    }
}

/// Bessel J_n, using upward recurrence when stable and Miller's downward
/// recurrence for the small-argument/high-order regime documented by Excel.
fn bessel_j(x: f64, n: usize) -> f64 {
    if n == 0 {
        return bessel_j0(x);
    }
    if n == 1 {
        return bessel_j1(x);
    }

    let ax = x.abs();
    if ax == 0.0 {
        return 0.0;
    }
    if ax <= BESSEL_TOX_LIMIT {
        return 0.0;
    }

    let tox = 2.0 / ax;
    let result = if ax > n as f64 {
        let mut bjm = bessel_j0(ax);
        let mut bj = bessel_j1(ax);
        for j in 1..n {
            let bjp = j as f64 * tox * bj - bjm;
            bjm = bj;
            bj = bjp;
        }
        bj
    } else {
        let root = (BESSEL_ACC * n as f64).sqrt() as usize;
        let Some(m) = n
            .checked_add(root)
            .and_then(|value| value.checked_div(2))
            .and_then(|value| value.checked_mul(2))
        else {
            return f64::NAN;
        };
        let mut bjp = 0.0;
        let mut bj = 1.0;
        let mut ans = 0.0;
        let mut sum = 0.0;
        let mut jsum = false;

        for j in (1..=m).rev() {
            let bjm = j as f64 * tox * bj - bjp;
            bjp = bj;
            bj = bjm;
            if bj.abs() > BESSEL_BIGNO {
                bj *= BESSEL_BIGNI;
                bjp *= BESSEL_BIGNI;
                ans *= BESSEL_BIGNI;
                sum *= BESSEL_BIGNI;
            }
            if jsum {
                sum += bj;
            }
            jsum = !jsum;
            if j == n {
                ans = bjp;
            }
        }
        sum = 2.0 * sum - bj;
        ans / sum
    };

    if x < 0.0 && n % 2 == 1 {
        -result
    } else {
        result
    }
}

/// Modified Bessel K0 from the legacy Excel/Analysis ToolPak routine.
fn bessel_k0(x: f64) -> f64 {
    if x <= 2.0 {
        let y = x * x / 4.0;
        let polynomial = horner(
            y,
            &[
                -0.57721566,
                0.42278420,
                0.23069756,
                0.3488590e-1,
                0.262698e-2,
                0.10750e-3,
                0.74e-5,
            ],
        );
        // Avoid x/2 underflow for the smallest positive subnormal while
        // retaining the published expression for ordinary arguments.
        let log_half_x = if x / 2.0 == 0.0 {
            x.ln() - 2.0_f64.ln()
        } else {
            (x / 2.0).ln()
        };
        -log_half_x * bessel_i0(x) + polynomial
    } else {
        let y = 2.0 / x;
        let polynomial = horner(
            y,
            &[
                1.25331414,
                -0.7832358e-1,
                0.2189568e-1,
                -0.1062446e-1,
                0.587872e-2,
                -0.251540e-2,
                0.53208e-3,
            ],
        );
        (-x).exp() / x.sqrt() * polynomial
    }
}

/// Modified Bessel K1 from the legacy Excel/Analysis ToolPak routine.
fn bessel_k1(x: f64) -> f64 {
    if x <= 2.0 {
        let y = x * x / 4.0;
        let polynomial = horner(
            y,
            &[
                1.0,
                0.15443144,
                -0.67278579,
                -0.18156897,
                -0.1919402e-1,
                -0.110404e-2,
                -0.4686e-4,
            ],
        );
        (x / 2.0).ln() * bessel_i1(x) + polynomial / x
    } else {
        let y = 2.0 / x;
        let polynomial = horner(
            y,
            &[
                1.25331414,
                0.23498619,
                -0.3655620e-1,
                0.1504268e-1,
                -0.780353e-2,
                0.325614e-2,
                -0.68245e-3,
            ],
        );
        (-x).exp() / x.sqrt() * polynomial
    }
}

/// Modified Bessel K_n(x), by the stable forward recurrence used by Excel.
fn bessel_k(x: f64, n: usize) -> f64 {
    if n == 0 {
        return bessel_k0(x);
    }
    if n == 1 {
        return bessel_k1(x);
    }

    if x <= BESSEL_TOX_LIMIT {
        return f64::INFINITY;
    }
    let tox = 2.0 / x;
    let mut bkm = bessel_k0(x);
    let mut bk = bessel_k1(x);
    for j in 1..n {
        let bkp = bkm + j as f64 * tox * bk;
        bkm = bk;
        bk = bkp;
    }
    bk
}

/// Bessel Y0 from the Numerical Recipes routine used by Excel's ATP.
fn bessel_y0(x: f64) -> f64 {
    if x < 8.0 {
        let y = x * x;
        let numerator = horner(
            y,
            &[
                -2957821389.0,
                7062834065.0,
                -512359803.6,
                10879881.29,
                -86327.92757,
                228.4622733,
            ],
        );
        let denominator = horner(
            y,
            &[
                40076544269.0,
                745249964.8,
                7189466.438,
                47447.26470,
                226.1030244,
                1.0,
            ],
        );
        numerator / denominator + BESSEL_W * bessel_j0(x) * x.ln()
    } else {
        let z = 8.0 / x;
        let y = z * z;
        let xx = x - 0.785398164;
        let ans1 = horner(
            y,
            &[
                1.0,
                -0.1098628627e-2,
                0.2734510407e-4,
                -0.2073370639e-5,
                0.2093887211e-6,
            ],
        );
        // Y0's final coefficient is .934945152e-7; J0's is .934935152e-7.
        let ans2 = horner(
            y,
            &[
                -0.1562499995e-1,
                0.1430488765e-3,
                -0.6911147651e-5,
                0.7621095161e-6,
                -0.934945152e-7,
            ],
        );
        (BESSEL_W / x).sqrt() * (xx.sin() * ans1 + z * xx.cos() * ans2)
    }
}

/// Bessel Y1 from the Numerical Recipes routine used by Excel's ATP.
fn bessel_y1(x: f64) -> f64 {
    if x < 8.0 {
        let y = x * x;
        let numerator = x * horner(
            y,
            &[
                -0.4900604943e13,
                0.1275274390e13,
                -0.5153438139e11,
                0.7349264551e9,
                -0.4237922726e7,
                0.8511937935e4,
            ],
        );
        let denominator = horner(
            y,
            &[
                0.2499580570e14,
                0.4244419664e12,
                0.3733650367e10,
                0.2245904002e8,
                0.1020426050e6,
                0.3549632885e3,
                1.0,
            ],
        );
        numerator / denominator + BESSEL_W * (bessel_j1(x) * x.ln() - 1.0 / x)
    } else {
        let z = 8.0 / x;
        let y = z * z;
        let xx = x - 2.356194491;
        let ans1 = horner(
            y,
            &[
                1.0,
                0.183105e-2,
                -0.3516396496e-4,
                0.2457520174e-5,
                -0.240337019e-6,
            ],
        );
        let ans2 = horner(
            y,
            &[
                0.04687499995,
                -0.2002690873e-3,
                0.8449199096e-5,
                -0.88228987e-6,
                0.105787412e-6,
            ],
        );
        (BESSEL_W / x).sqrt() * (xx.sin() * ans1 + z * xx.cos() * ans2)
    }
}

/// Bessel Y_n(x), by the stable forward recurrence used by Excel.
fn bessel_y(x: f64, n: usize) -> f64 {
    if n == 0 {
        return bessel_y0(x);
    }
    if n == 1 {
        return bessel_y1(x);
    }

    if x <= BESSEL_TOX_LIMIT {
        return f64::INFINITY;
    }
    let tox = 2.0 / x;
    let mut bym = bessel_y0(x);
    let mut by = bessel_y1(x);
    for j in 1..n {
        let byp = j as f64 * tox * by - bym;
        bym = by;
        by = byp;
    }
    by
}

// ===========================================================================
// Bessel Functions (4)
// ===========================================================================

/// Excel truncates a non-negative order toward zero before evaluating it.
/// The public documentation does not describe an upper bound, but this
/// repository retains its established `<= 200` hang guard for O(n)
/// recurrences. A non-finite or over-bound order is reported as a numeric
/// error rather than being saturated by a float cast.
fn coerce_bessel_order(name: &str, n: f64) -> Result<usize, CellValue> {
    if !n.is_finite() || n < 0.0 {
        return Err(CellValue::error_with_message(
            CellError::Num,
            format!("{name}: order must be a finite non-negative number, got {n}"),
        ));
    }

    let truncated = n.trunc();
    if truncated > BESSEL_MAX_ORDER as f64 {
        return Err(CellValue::error_with_message(
            CellError::Num,
            format!(
                "{name}: order exceeds the finite evaluation bound ({BESSEL_MAX_ORDER}), got {n}"
            ),
        ));
    }
    Ok(truncated as usize)
}

/// Excel represents a floating-point overflow from an engineering function
/// as `#NUM!`; do not let an intermediate NaN/∞ poison the surrounding sheet.
fn bessel_number(name: &str, result: f64) -> CellValue {
    if result.is_finite() {
        CellValue::number(result)
    } else {
        CellValue::error_with_message(
            CellError::Num,
            format!("{name}: result is outside the numeric range"),
        )
    }
}

pub(super) struct FnBesselI;
impl PureFunction for FnBesselI {
    fn name(&self) -> &'static str {
        "BESSELI"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let n = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let ni = match coerce_bessel_order("BESSELI", n) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let result = bessel_i(x, ni);
        bessel_number("BESSELI", result)
    }
}

pub(super) struct FnBesselJ;
impl PureFunction for FnBesselJ {
    fn name(&self) -> &'static str {
        "BESSELJ"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let n = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let ni = match coerce_bessel_order("BESSELJ", n) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let result = bessel_j(x, ni);
        bessel_number("BESSELJ", result)
    }
}

pub(super) struct FnBesselK;
impl PureFunction for FnBesselK {
    fn name(&self) -> &'static str {
        "BESSELK"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let n = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if x <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BESSELK: x must be positive, got {x}"),
            );
        }
        let ni = match coerce_bessel_order("BESSELK", n) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let result = bessel_k(x, ni);
        bessel_number("BESSELK", result)
    }
}

pub(super) struct FnBesselY;
impl PureFunction for FnBesselY {
    fn name(&self) -> &'static str {
        "BESSELY"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let n = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if x <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BESSELY: x must be positive, got {x}"),
            );
        }
        let ni = match coerce_bessel_order("BESSELY", n) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let result = bessel_y(x, ni);
        bessel_number("BESSELY", result)
    }
}

// ===========================================================================
// Registration
// ===========================================================================

pub(crate) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnBesselI));
    registry.register(Box::new(FnBesselJ));
    registry.register(Box::new(FnBesselK));
    registry.register(Box::new(FnBesselY));
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    fn assert_close(value: CellValue, expected: f64, tolerance: f64, label: &str) {
        match value {
            CellValue::Number(actual) => assert!(
                (actual.get() - expected).abs() < tolerance,
                "{label} = {}, expected ~{expected}",
                actual.get()
            ),
            other => panic!("Expected {label} number, got {other:?}"),
        }
    }

    #[test]
    fn test_besseli() {
        let f = FnBesselI;
        assert_close(
            f.call(&[num(1.5), num(1.0)]),
            0.9816664285779074,
            1e-6,
            "BESSELI(1.5, 1)",
        );
    }

    #[test]
    fn test_besselj() {
        let f = FnBesselJ;
        assert_close(
            f.call(&[num(1.9), num(2.0)]),
            0.329926,
            1e-4,
            "BESSELJ(1.9, 2)",
        );
    }

    #[test]
    fn test_besselk_0() {
        // BESSELK(1.5, 0) = 0.2138055... (known value from tables)
        let f = FnBesselK;
        assert_close(
            f.call(&[num(1.5), num(0.0)]),
            0.21380556264235205,
            1e-4,
            "BESSELK(1.5, 0)",
        );
    }

    #[test]
    fn test_besselk_1() {
        // BESSELK(1.5, 1) = 0.2774... (known value from tables)
        let f = FnBesselK;
        assert_close(
            f.call(&[num(1.5), num(1.0)]),
            0.27738780045684834,
            1e-4,
            "BESSELK(1.5, 1)",
        );
    }

    #[test]
    fn test_besselk_negative_x() {
        // BESSELK with x <= 0 should return #NUM!
        let f = FnBesselK;
        let result = f.call(&[num(0.0), num(0.0)]);
        assert!(matches!(result, CellValue::Error(CellError::Num, _)));
        let result = f.call(&[num(-1.0), num(0.0)]);
        assert!(matches!(result, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_bessely_0() {
        // BESSELY(1.5, 0) = 0.38244892... (known value from tables)
        let f = FnBesselY;
        assert_close(
            f.call(&[num(1.5), num(0.0)]),
            0.38244892379775884,
            1e-4,
            "BESSELY(1.5, 0)",
        );
    }

    #[test]
    fn test_bessely_1() {
        // BESSELY(1.5, 1) = -0.41230863... (known value from tables)
        let f = FnBesselY;
        assert_close(
            f.call(&[num(1.5), num(1.0)]),
            -0.412_308_626_973_911_3,
            1e-4,
            "BESSELY(1.5, 1)",
        );
    }

    #[test]
    fn test_bessely_negative_x() {
        // BESSELY with x <= 0 should return #NUM!
        let f = FnBesselY;
        let result = f.call(&[num(0.0), num(0.0)]);
        assert!(matches!(result, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn first_kind_large_order_is_finite_and_negligible() {
        let registry = FunctionRegistry::new();
        for name in ["BESSELI", "BESSELJ"] {
            match registry.call(name, &[num(1.0), num(200.0)]) {
                CellValue::Number(value) => {
                    assert!(value.get().is_finite());
                    assert!(value.get().abs() < 1e-10);
                }
                other => panic!("Expected finite {name}(1, 200), got {other:?}"),
            }
        }
    }

    #[test]
    fn legacy_atp_values_match_bessel_stress_corpus() {
        // These are the cached values in tier_a_formula_stress_test/golden.xlsx.
        // The Microsoft ATP definitions identify the rational fits and Miller
        // recurrences used to produce them; this locks the compatibility path
        // to that published algorithm rather than to a fitted correction.
        let registry = FunctionRegistry::new();
        let cases = [
            ("BESSELI", 0.21273995970273565),
            ("BESSELJ", 0.12894324997562717),
            ("BESSELY", -1.1277837651220644),
        ];
        for (name, expected) in cases {
            let result = registry.call(name, &[num(2.0), num(3.0)]);
            match result {
                CellValue::Number(value) => assert!(
                    (value.get() - expected).abs() < 2e-14,
                    "{name}(2, 3) = {}, expected {expected}",
                    value.get()
                ),
                other => panic!("Expected {name} number, got {other:?}"),
            }
        }
    }

    #[test]
    fn bessel_order_is_truncated_toward_zero() {
        // Microsoft documents truncation of a non-integer order for all four
        // functions.  The previous implementation rejected these valid calls.
        let registry = FunctionRegistry::new();
        for (name, x, fractional_order, integer_order) in [
            ("BESSELI", 1.5, 1.9, 1.0),
            ("BESSELJ", 1.9, 2.9, 2.0),
            ("BESSELK", 1.5, 1.9, 1.0),
            ("BESSELY", 2.5, 1.9, 1.0),
        ] {
            assert_eq!(
                registry.call(name, &[num(x), num(fractional_order)]),
                registry.call(name, &[num(x), num(integer_order)]),
                "{name} order truncation"
            );
        }
    }

    #[test]
    fn bessel_first_kind_negative_x_has_integer_order_parity() {
        let registry = FunctionRegistry::new();
        for name in ["BESSELI", "BESSELJ"] {
            for order in [0.0, 1.0, 3.0] {
                let positive = registry.call(name, &[num(2.0), num(order)]);
                let negative = registry.call(name, &[num(-2.0), num(order)]);
                match (positive, negative) {
                    (CellValue::Number(p), CellValue::Number(n)) => {
                        let expected = if order as usize % 2 == 1 {
                            -p.get()
                        } else {
                            p.get()
                        };
                        assert_eq!(n.get(), expected, "{name} negative-x parity");
                    }
                    (positive, negative) => panic!(
                        "Expected numeric parity values for {name}: {positive:?}, {negative:?}"
                    ),
                }
            }
        }
    }

    #[test]
    fn bessel_negative_orders_are_num_errors_after_truncation_contract() {
        let registry = FunctionRegistry::new();
        for name in ["BESSELI", "BESSELJ", "BESSELK", "BESSELY"] {
            for order in [-1.0, -0.5] {
                assert!(
                    matches!(
                        registry.call(name, &[num(2.0), num(order)]),
                        CellValue::Error(CellError::Num, _)
                    ),
                    "{name}({order}) should be #NUM!"
                );
            }
        }
    }

    #[test]
    fn bessel_asymptotic_regimes_are_finite_at_their_boundaries() {
        let registry = FunctionRegistry::new();
        for (name, x) in [
            ("BESSELI", 3.75),
            ("BESSELJ", 8.0),
            ("BESSELY", 8.0),
            ("BESSELK", 2.0),
        ] {
            match registry.call(name, &[num(x), num(0.0)]) {
                CellValue::Number(value) => assert!(
                    value.get().is_finite(),
                    "{name}({x}, 0) should be finite, got {}",
                    value.get()
                ),
                other => panic!("Expected {name} boundary value, got {other:?}"),
            }
        }
        // The large-x J/Y routines use the oscillatory asymptotic branch.
        assert!((bessel_j0(10.0) - -0.2459357644).abs() < 2e-8);
        assert!((bessel_y0(10.0) - 0.0556711674).abs() < 2e-8);
    }

    #[test]
    fn bessel_order_guard_prevents_unbounded_recurrence() {
        let registry = FunctionRegistry::new();
        for name in ["BESSELI", "BESSELJ", "BESSELK", "BESSELY"] {
            assert!(
                matches!(
                    registry.call(name, &[num(2.0), num(201.0)]),
                    CellValue::Error(CellError::Num, _)
                ),
                "{name}(2, 201) should be bounded by the recurrence guard"
            );
        }
    }

    #[test]
    fn bessel_huge_order_is_rejected_before_integer_conversion() {
        let registry = FunctionRegistry::new();
        for name in ["BESSELI", "BESSELJ", "BESSELK", "BESSELY"] {
            assert!(matches!(
                registry.call(name, &[num(2.0), num(1e308)]),
                CellValue::Error(CellError::Num, _)
            ));
        }
    }

    #[test]
    fn bessel_subnormal_x_does_not_overflow_recurrence_ratio() {
        let registry = FunctionRegistry::new();
        let tiny = f64::from_bits(1);
        for name in ["BESSELI", "BESSELJ"] {
            assert_eq!(
                registry.call(name, &[num(tiny), num(2.0)]),
                CellValue::number(0.0)
            );
        }
        for name in ["BESSELK", "BESSELY"] {
            assert!(matches!(
                registry.call(name, &[num(tiny), num(0.0)]),
                CellValue::Number(value) if value.get().is_finite()
            ));
            assert!(matches!(
                registry.call(name, &[num(tiny), num(2.0)]),
                CellValue::Error(CellError::Num, _)
            ));
        }
    }
}

#[test]
fn first_kind_bessel_zero_limits_include_blank_coercion() {
    // Excel returns 1 for BESSELI when both referenced arguments are blank.
    // Explicit zero/order cases also verify the analytical BESSELI/BESSELJ limits.
    let registry = FunctionRegistry::new();
    for name in ["BESSELI", "BESSELJ"] {
        for x in [
            CellValue::Null,
            CellValue::number(0.0),
            CellValue::number(-0.0),
        ] {
            for order in [CellValue::Null, CellValue::number(0.0)] {
                assert_eq!(
                    registry.call(name, &[x.clone(), order]),
                    CellValue::number(1.0),
                    "{name}"
                );
            }
            for order in [1.0, 2.0, 200.0] {
                assert_eq!(
                    registry.call(name, &[x.clone(), CellValue::number(order)]),
                    CellValue::number(0.0),
                    "{name}"
                );
            }
        }
    }
}
