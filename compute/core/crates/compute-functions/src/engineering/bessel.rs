//! Bessel functions: BESSELI, BESSELJ, BESSELK, BESSELY

use value_types::{CellError, CellValue};

use super::helpers::coerce_num;
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// Bessel Function Helpers (series approximations)
// ===========================================================================

const BESSEL_MAX_ITER: usize = 100;
const BESSEL_TOL: f64 = 1e-12;

/// Factorial for small non-negative integers. Caps at 170 to avoid infinity.
fn factorial(n: u64) -> f64 {
    if n == 0 || n == 1 {
        return 1.0;
    }
    if n > 170 {
        return f64::INFINITY;
    }
    let mut result = 1.0_f64;
    for i in 2..=n {
        result *= i as f64;
    }
    result
}

/// Log-gamma based factorial for large n to avoid overflow.
/// Uses Stirling's approximation: ln(n!) ≈ n*ln(n) - n + 0.5*ln(2*pi*n)
fn ln_factorial(n: u64) -> f64 {
    if n <= 170 {
        return factorial(n).ln();
    }
    let n_f = n as f64;
    // Stirling's approximation with correction terms
    n_f * n_f.ln() - n_f + 0.5 * (2.0 * std::f64::consts::PI * n_f).ln() + 1.0 / (12.0 * n_f)
        - 1.0 / (360.0 * n_f * n_f * n_f)
}

/// Modified Bessel function of the first kind I_n(x), series expansion.
fn bessel_i(x: f64, n: i64) -> f64 {
    let n = n as u64;
    // Use logarithmic computation for the initial term to avoid overflow for large n
    let ln_initial = (n as f64) * (x / 2.0).abs().ln() - ln_factorial(n);
    if ln_initial < -700.0 {
        // Result is essentially zero (underflow)
        return 0.0;
    }
    let mut sum = ln_initial.exp();
    if x < 0.0 && n % 2 == 1 {
        sum = -sum;
    }
    let mut term = sum;
    for k in 1..BESSEL_MAX_ITER {
        term *= (x * x) / (4.0 * k as f64 * (k as u64 + n) as f64);
        sum += term;
        if term.abs() < BESSEL_TOL * sum.abs() {
            break;
        }
    }
    sum
}

/// Bessel function of the first kind J_n(x), series expansion.
fn bessel_j(x: f64, n: i64) -> f64 {
    let n = n as u64;
    // Use logarithmic computation for the initial term to avoid overflow for large n
    let ln_initial = (n as f64) * (x / 2.0).abs().ln() - ln_factorial(n);
    if ln_initial < -700.0 {
        // Result is essentially zero (underflow)
        return 0.0;
    }
    let mut sum = ln_initial.exp();
    if x < 0.0 && n % 2 == 1 {
        sum = -sum;
    }
    let mut term = sum;
    for k in 1..BESSEL_MAX_ITER {
        term *= -(x * x) / (4.0 * k as f64 * (k as u64 + n) as f64);
        sum += term;
        if term.abs() < BESSEL_TOL * sum.abs() {
            break;
        }
    }
    sum
}

/// Modified Bessel function of the second kind K0(x).
/// Uses Abramowitz & Stegun polynomial approximations (9.8.5 and 9.8.6).
fn bessel_k0(x: f64) -> f64 {
    if x <= 2.0 {
        // A&S 9.8.5: K0(x) = -ln(x/2)*I0(x) + polynomial in (x/2)^2
        let t = x / 2.0;
        let t2 = t * t;
        let i0 = bessel_i(x, 0);
        let poly = -0.57721566
            + 0.42278420 * t2
            + 0.23069756 * t2 * t2
            + 0.03488590 * t2.powi(3)
            + 0.00262698 * t2.powi(4)
            + 0.00010750 * t2.powi(5)
            + 0.00000740 * t2.powi(6);
        -(x / 2.0).ln() * i0 + poly
    } else {
        // A&S 9.8.6: K0(x) = (sqrt(pi/(2x)) * e^(-x)) * P(1/x)
        let t = 2.0 / x;
        let poly = 1.25331414 - 0.07832358 * t + 0.02189568 * t * t - 0.01062446 * t.powi(3)
            + 0.00587872 * t.powi(4)
            - 0.00251540 * t.powi(5)
            + 0.00053208 * t.powi(6);
        poly * (-x).exp() / x.sqrt()
    }
}

/// Modified Bessel function of the second kind K1(x).
/// Uses Abramowitz & Stegun polynomial approximations (9.8.7 and 9.8.8).
fn bessel_k1(x: f64) -> f64 {
    if x <= 2.0 {
        // A&S 9.8.7: K1(x) = ln(x/2)*I1(x) + (1/x)*polynomial
        let t = x / 2.0;
        let t2 = t * t;
        let i1 = bessel_i(x, 1);
        let poly = 1.0 + 0.15443144 * t2
            - 0.67278579 * t2 * t2
            - 0.18156897 * t2.powi(3)
            - 0.01919402 * t2.powi(4)
            - 0.00110404 * t2.powi(5)
            - 0.00004686 * t2.powi(6);
        (x / 2.0).ln() * i1 + (1.0 / x) * poly
    } else {
        // A&S 9.8.8: K1(x) = (sqrt(pi/(2x)) * e^(-x)) * Q(1/x)
        let t = 2.0 / x;
        let poly = 1.25331414 + 0.23498619 * t - 0.03655620 * t * t + 0.01504268 * t.powi(3)
            - 0.00780353 * t.powi(4)
            + 0.00325614 * t.powi(5)
            - 0.00068245 * t.powi(6);
        poly * (-x).exp() / x.sqrt()
    }
}

/// Modified Bessel function of the second kind K_n(x).
fn bessel_k(x: f64, n: i64) -> f64 {
    if n == 0 {
        bessel_k0(x)
    } else if n == 1 {
        bessel_k1(x)
    } else {
        // Recurrence: K(n+1) = K(n-1) + (2n/x) * K(n)
        let mut k0 = bessel_k0(x);
        let mut k1 = bessel_k1(x);
        for i in 1..n {
            let kn = k0 + (2.0 * i as f64 / x) * k1;
            k0 = k1;
            k1 = kn;
        }
        k1
    }
}

/// Bessel function of the second kind Y0(x).
/// Uses Abramowitz & Stegun polynomial approximations (9.4.1 and 9.4.2).
fn bessel_y0(x: f64) -> f64 {
    if x <= 5.0 {
        // A&S 9.4.1: Y0(x) = (2/pi)*ln(x/2)*J0(x) + polynomial
        // Series: Y0(x) = (2/pi) * [ln(x/2) + gamma] * J0(x) + (2/pi) * sum
        let euler_gamma = 0.5772156649015329;
        let j0 = bessel_j(x, 0);
        let base = (2.0 / std::f64::consts::PI) * ((x / 2.0).ln() + euler_gamma) * j0;
        let mut sum = 0.0;
        for k in 1..=25 {
            let mut harmonic = 0.0;
            for h in 1..=k {
                harmonic += 1.0 / h as f64;
            }
            // Sign is (-1)^(k+1) = positive for odd k, negative for even k
            let sign = if k % 2 == 0 { -1.0 } else { 1.0 };
            let kf = factorial(k as u64);
            sum += sign * (x / 2.0).powi(2 * k) / (kf * kf) * harmonic;
        }
        base + (2.0 / std::f64::consts::PI) * sum
    } else {
        // A&S 9.4.2: asymptotic expansion for large x
        // Y0(x) ~ sqrt(2/(pi*x)) * sin(x - pi/4) * P0 + cos(x - pi/4) * Q0
        let theta = x - std::f64::consts::PI / 4.0;
        let t = 8.0 / x;
        let t2 = t * t;
        let p0 = 1.0 - 0.00000077 * t - 0.00552740 * t2 - 0.00009512 * t2 * t
            + 0.00137237 * t2 * t2
            - 0.00072805 * t2 * t2 * t
            + 0.00014476 * t2.powi(3);
        let q0 = -0.04166397 * t - 0.00003954 * t2 + 0.00262573 * t2 * t
            - 0.00054125 * t2 * t2
            - 0.00029333 * t2 * t2 * t
            + 0.00013558 * t2.powi(3);
        let factor = (2.0 / (std::f64::consts::PI * x)).sqrt();
        factor * (theta.sin() * p0 + theta.cos() * q0)
    }
}

/// Bessel function of the second kind Y1(x).
/// Uses DLMF 10.8.2 / A&S 9.1.11 series for small x and asymptotic expansion for large x.
fn bessel_y1(x: f64) -> f64 {
    if x <= 5.0 {
        // DLMF 10.8.2 for n=1:
        // Y1(x) = (2/pi)*ln(x/2)*J1(x) - (2/(pi*x))
        //   - (1/pi)*sum_{k=0}^{inf} (-1)^k * (psi(k+1)+psi(k+2)) * (x/2)^(2k+1) / (k!*(k+1)!)
        // where psi(k+1) = -gamma + H(k), H(k) = harmonic number
        let euler_gamma = 0.5772156649015329;
        let j1 = bessel_j(x, 1);
        let two_over_pi = 2.0 / std::f64::consts::PI;
        let t = x / 2.0;

        let mut sum = 0.0;
        for k in 0..=30_u64 {
            let mut h_k = 0.0_f64;
            for h in 1..=k {
                h_k += 1.0 / h as f64;
            }
            let h_k1 = h_k + 1.0 / (k + 1) as f64;
            let psi_sum = -2.0 * euler_gamma + h_k + h_k1;
            let sign = if k % 2 == 0 { 1.0 } else { -1.0 };
            let kf = factorial(k);
            let k1f = factorial(k + 1);
            let term = sign * t.powi(2 * k as i32 + 1) * psi_sum / (kf * k1f);
            sum += term;
            if k > 2 && term.abs() < BESSEL_TOL * sum.abs() {
                break;
            }
        }
        two_over_pi * (x / 2.0).ln() * j1
            - 2.0 / (std::f64::consts::PI * x)
            - (1.0 / std::f64::consts::PI) * sum
    } else {
        // Asymptotic expansion for large x
        // Y1(x) ~ sqrt(2/(pi*x)) * sin(x - 3*pi/4) * P1 + cos(x - 3*pi/4) * Q1
        let theta = x - 3.0 * std::f64::consts::PI / 4.0;
        let t = 8.0 / x;
        let t2 = t * t;
        let p1 = 1.0 + 0.00000156 * t + 0.01659667 * t2 + 0.00017105 * t2 * t
            - 0.00249511 * t2 * t2
            + 0.00113653 * t2 * t2 * t
            - 0.00020033 * t2.powi(3);
        let q1 = 0.12499612 * t + 0.00005650 * t2 - 0.00637879 * t2 * t
            + 0.00074348 * t2 * t2
            + 0.00079824 * t2 * t2 * t
            - 0.00029166 * t2.powi(3);
        let factor = (2.0 / (std::f64::consts::PI * x)).sqrt();
        factor * (theta.sin() * p1 + theta.cos() * q1)
    }
}

/// Bessel function of the second kind Y_n(x).
fn bessel_y(x: f64, n: i64) -> f64 {
    if n == 0 {
        bessel_y0(x)
    } else if n == 1 {
        bessel_y1(x)
    } else {
        // Recurrence: Y(n+1) = (2n/x) * Y(n) - Y(n-1)
        let mut y0 = bessel_y0(x);
        let mut y1 = bessel_y1(x);
        for i in 1..n {
            let yn = (2.0 * i as f64 / x) * y1 - y0;
            y0 = y1;
            y1 = yn;
        }
        y1
    }
}

// ===========================================================================
// Bessel Functions (4)
// ===========================================================================

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
        let ni = n as i64;
        if ni < 0 || (n - ni as f64).abs() > 1e-10 || ni > 200 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BESSELI: order must be a non-negative integer <= 200, got {n}"),
            );
        }
        let result = bessel_i(x, ni);
        CellValue::number(result)
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
        let ni = n as i64;
        if ni < 0 || (n - ni as f64).abs() > 1e-10 || ni > 200 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BESSELJ: order must be a non-negative integer <= 200, got {n}"),
            );
        }
        let result = bessel_j(x, ni);
        CellValue::number(result)
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
        let ni = n as i64;
        if ni < 0 || (n - ni as f64).abs() > 1e-10 || ni > 200 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BESSELK: order must be a non-negative integer <= 200, got {n}"),
            );
        }
        let result = bessel_k(x, ni);
        CellValue::number(result)
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
        let ni = n as i64;
        if ni < 0 || (n - ni as f64).abs() > 1e-10 || ni > 200 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BESSELY: order must be a non-negative integer <= 200, got {n}"),
            );
        }
        let result = bessel_y(x, ni);
        CellValue::number(result)
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

    #[test]
    fn test_besseli() {
        let f = FnBesselI;
        let result = f.call(&[num(1.5), num(1.0)]);
        if let CellValue::Number(n) = result {
            assert!((n.get() - 0.9816664285779074).abs() < 1e-6);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_besselj() {
        let f = FnBesselJ;
        let result = f.call(&[num(1.9), num(2.0)]);
        if let CellValue::Number(n) = result {
            assert!((n.get() - 0.329926).abs() < 1e-4);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_besselk_0() {
        // BESSELK(1.5, 0) = 0.2138055... (known value from tables)
        let f = FnBesselK;
        let result = f.call(&[num(1.5), num(0.0)]);
        if let CellValue::Number(n) = result {
            assert!(
                (n.get() - 0.21380556264235205).abs() < 1e-4,
                "BESSELK(1.5, 0) = {} but expected ~0.21381",
                n.get()
            );
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_besselk_1() {
        // BESSELK(1.5, 1) = 0.2774... (known value from tables)
        let f = FnBesselK;
        let result = f.call(&[num(1.5), num(1.0)]);
        if let CellValue::Number(n) = result {
            assert!(
                (n.get() - 0.27738780045684834).abs() < 1e-4,
                "BESSELK(1.5, 1) = {} but expected ~0.27739",
                n.get()
            );
        } else {
            panic!("Expected number, got {:?}", result);
        }
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
        let result = f.call(&[num(1.5), num(0.0)]);
        if let CellValue::Number(n) = result {
            assert!(
                (n.get() - 0.38244892379775884).abs() < 1e-4,
                "BESSELY(1.5, 0) = {} but expected ~0.38245",
                n.get()
            );
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_bessely_1() {
        // BESSELY(1.5, 1) = -0.41230863... (known value from tables)
        let f = FnBesselY;
        let result = f.call(&[num(1.5), num(1.0)]);
        if let CellValue::Number(n) = result {
            assert!(
                (n.get() - (-0.412_308_626_973_911_3)).abs() < 1e-4,
                "BESSELY(1.5, 1) = {} but expected ~-0.41231",
                n.get()
            );
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_bessely_negative_x() {
        // BESSELY with x <= 0 should return #NUM!
        let f = FnBesselY;
        let result = f.call(&[num(0.0), num(0.0)]);
        assert!(matches!(result, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_besselj_large_order() {
        // BESSELJ(1, 200) should return a number (very close to 0) or #NUM!, not panic
        let f = FnBesselJ;
        let result = f.call(&[num(1.0), num(200.0)]);
        match result {
            CellValue::Number(n) => {
                // For large order and small x, J_n(x) is essentially 0
                assert!(
                    n.get().is_finite(),
                    "BESSELJ(1, 200) should be finite, got {}",
                    n.get()
                );
                assert!(
                    n.get().abs() < 1e-10,
                    "BESSELJ(1, 200) should be ~0, got {}",
                    n.get()
                );
            }
            CellValue::Error(CellError::Num, _) => {
                // Also acceptable: returning #NUM! for extreme values
            }
            other => panic!("Expected number or #NUM!, got {:?}", other),
        }
    }

    #[test]
    fn test_besseli_large_order() {
        // BESSELI(1, 200) should return a number (very close to 0) or #NUM!, not panic
        let f = FnBesselI;
        let result = f.call(&[num(1.0), num(200.0)]);
        match result {
            CellValue::Number(n) => {
                assert!(
                    n.get().is_finite(),
                    "BESSELI(1, 200) should be finite, got {}",
                    n.get()
                );
                assert!(
                    n.get().abs() < 1e-10,
                    "BESSELI(1, 200) should be ~0, got {}",
                    n.get()
                );
            }
            CellValue::Error(CellError::Num, _) => {
                // Also acceptable
            }
            other => panic!("Expected number or #NUM!, got {:?}", other),
        }
    }
}
