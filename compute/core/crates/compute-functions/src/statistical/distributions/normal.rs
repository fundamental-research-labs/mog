use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Continuous, Normal};

use super::support::try_dist;

// The normal CDF in statrs 0.17 delegates to an erfc approximation whose
// rounded coefficients lose several digits in the moderate tails (for
// example, its Phi(3) is about 5e-14 high).  Keep the public function/error
// contracts above this module, but evaluate the standard normal through
// libm's fdlibm/Sun erfc rational approximation and Wichura's AS 241
// quantile approximation.  Both approximations use direct tail probabilities,
// so the CDF and inverse remain accurate across the full finite f64 domain.

const SQRT_2: f64 = std::f64::consts::SQRT_2;

fn evaluate_polynomial(coefficients: &[f64], x: f64) -> f64 {
    coefficients
        .iter()
        .rev()
        .fold(0.0, |value, coefficient| value * x + coefficient)
}

pub(super) fn standard_normal_cdf(z: f64) -> f64 {
    if z < 0.0 {
        0.5 * libm::erfc(-z / SQRT_2)
    } else {
        1.0 - 0.5 * libm::erfc(z / SQRT_2)
    }
}

pub(in crate::statistical) fn standard_normal_survival(z: f64) -> f64 {
    0.5 * libm::erfc(z / SQRT_2)
}

// Wichura, Algorithm AS 241, Applied Statistics 37 (1988), 477-484.
// The coefficients below are the double-precision AS 241 PPND16 tables.
const AS241_A: [f64; 8] = [
    3.3871328727963666080,
    1.3314166789178437745e2,
    1.9715909503065514427e3,
    1.3731693765509461125e4,
    4.5921953931549871457e4,
    6.7265770927008700853e4,
    3.3430575583588128105e4,
    2.5090809287301226727e3,
];
const AS241_B: [f64; 8] = [
    1.0,
    4.2313330701600911252e1,
    6.8718700749205790830e2,
    5.3941960214247511077e3,
    2.1213794301586595867e4,
    3.9307895800092710610e4,
    2.8729085735721942674e4,
    5.2264952788528545610e3,
];
const AS241_C: [f64; 8] = [
    1.42343711074968357734,
    4.63033784615654529590,
    5.76949722146069140550,
    3.64784832476320460504,
    1.27045825245236838258,
    2.41780725177450611770e-1,
    2.27238449892691845833e-2,
    7.74545014278341407640e-4,
];
const AS241_D: [f64; 8] = [
    1.0,
    2.05319162663775882187,
    1.67638483018380384940,
    6.89767334985100004550e-1,
    1.48103976427480074590e-1,
    1.51986665636164571966e-2,
    5.47593808499534494600e-4,
    1.05075007164441684324e-9,
];
const AS241_E: [f64; 8] = [
    6.65790464350110377720,
    5.46378491116411436990,
    1.78482653991729133580,
    2.96560571828504891230e-1,
    2.65321895265761230930e-2,
    1.24266094738807843860e-3,
    2.71155556874348757815e-5,
    2.01033439929228813265e-7,
];
const AS241_F: [f64; 8] = [
    1.0,
    5.99832206555887937690e-1,
    1.36929880922735805310e-1,
    1.48753612908506148525e-2,
    7.86869131145613259100e-4,
    1.84631831751005468180e-5,
    1.42151175831644588870e-7,
    2.04426310338993978564e-15,
];

pub(super) fn standard_normal_inverse(probability: f64) -> f64 {
    if probability <= 0.0 {
        return f64::NEG_INFINITY;
    }
    if probability >= 1.0 {
        return f64::INFINITY;
    }

    let q = probability - 0.5;
    if q.abs() <= 0.425 {
        let r = 0.180625 - q * q;
        return q * evaluate_polynomial(&AS241_A, r) / evaluate_polynomial(&AS241_B, r);
    }

    let tail = if q < 0.0 {
        probability
    } else {
        1.0 - probability
    };
    let root = (-tail.ln()).sqrt();
    let value = if root <= 5.0 {
        evaluate_polynomial(&AS241_C, root - 1.6) / evaluate_polynomial(&AS241_D, root - 1.6)
    } else {
        evaluate_polynomial(&AS241_E, root - 5.0) / evaluate_polynomial(&AS241_F, root - 5.0)
    };
    if q < 0.0 {
        -value
    } else {
        value
    }
}

// --- Normal distribution ---

pub(in crate::statistical) struct FnNormDist;
impl PureFunction for FnNormDist {
    fn name(&self) -> &'static str {
        "NORM.DIST"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let mean = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let std_dev = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if std_dev <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("NORM.DIST: standard_dev must be > 0, got {std_dev}"),
            );
        }
        let dist = try_dist!(Normal::new(mean, std_dev), self.name());
        if cumulative {
            CellValue::number(standard_normal_cdf((x - mean) / std_dev))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

/// NORMDIST is legacy alias for NORM.DIST
pub(in crate::statistical) struct FnNormDistLegacy;
impl PureFunction for FnNormDistLegacy {
    fn name(&self) -> &'static str {
        "NORMDIST"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnNormDist.call(args)
    }
}

pub(in crate::statistical) struct FnNormInv;
impl PureFunction for FnNormInv {
    fn name(&self) -> &'static str {
        "NORM.INV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let mean = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let std_dev = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if std_dev <= 0.0 || p.is_nan() || p <= 0.0 || p >= 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "NORM.INV: requires standard_dev > 0 and 0 < probability < 1, got standard_dev={std_dev}, p={p}"
                ),
            );
        }
        let _dist = try_dist!(Normal::new(mean, std_dev), self.name());
        CellValue::number(mean + std_dev * standard_normal_inverse(p))
    }
}

pub(in crate::statistical) struct FnNormInvLegacy;
impl PureFunction for FnNormInvLegacy {
    fn name(&self) -> &'static str {
        "NORMINV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnNormInv.call(args)
    }
}

pub(in crate::statistical) struct FnNormSDist;
impl PureFunction for FnNormSDist {
    fn name(&self) -> &'static str {
        "NORM.S.DIST"
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
        let z = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[1].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        if cumulative {
            CellValue::number(standard_normal_cdf(z))
        } else {
            CellValue::number(dist.pdf(z))
        }
    }
}

pub(in crate::statistical) struct FnNormSDistLegacy;
impl PureFunction for FnNormSDistLegacy {
    fn name(&self) -> &'static str {
        "NORMSDIST"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let z = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        CellValue::number(standard_normal_cdf(z))
    }
}

pub(in crate::statistical) struct FnNormSInv;
impl PureFunction for FnNormSInv {
    fn name(&self) -> &'static str {
        "NORM.S.INV"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if p.is_nan() || p <= 0.0 || p >= 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("NORM.S.INV: probability must be > 0 and < 1, got {p}"),
            );
        }
        CellValue::number(standard_normal_inverse(p))
    }
}

pub(in crate::statistical) struct FnNormSInvLegacy;
impl PureFunction for FnNormSInvLegacy {
    fn name(&self) -> &'static str {
        "NORMSINV"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnNormSInv.call(args)
    }
}

pub(in crate::statistical) struct FnStandardize;
impl PureFunction for FnStandardize {
    fn name(&self) -> &'static str {
        "STANDARDIZE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let mean = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let std_dev = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if std_dev <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("STANDARDIZE: standard_dev must be > 0, got {std_dev}"),
            );
        }
        CellValue::number((x - mean) / std_dev)
    }
}

// --- GAUSS, PHI ---

pub(in crate::statistical) struct FnGauss;
impl PureFunction for FnGauss {
    fn name(&self) -> &'static str {
        "GAUSS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let z = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        CellValue::number(standard_normal_cdf(z) - 0.5)
    }
}

pub(in crate::statistical) struct FnPhi;
impl PureFunction for FnPhi {
    fn name(&self) -> &'static str {
        "PHI"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(dist.pdf(x))
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnNormDist));
    registry.register(Box::new(FnNormDistLegacy));
    registry.register(Box::new(FnNormInv));
    registry.register(Box::new(FnNormInvLegacy));
    registry.register(Box::new(FnNormSDist));
    registry.register(Box::new(FnNormSDistLegacy));
    registry.register(Box::new(FnNormSInv));
    registry.register(Box::new(FnNormSInvLegacy));
    registry.register(Box::new(FnStandardize));
}

pub(super) fn register_gauss_phi(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnGauss));
    registry.register(Box::new(FnPhi));
}
