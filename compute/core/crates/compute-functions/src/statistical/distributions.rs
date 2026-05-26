//! Distribution functions (using statrs crate):
//! Normal: NORM.DIST, NORMDIST, NORM.INV, NORMINV, NORM.S.DIST, NORMSDIST,
//!         NORM.S.INV, NORMSINV, STANDARDIZE
//! Student's t: T.DIST, T.DIST.2T, T.DIST.RT, TDIST, T.INV, T.INV.2T, TINV
//! Chi-squared: CHISQ.DIST, CHISQ.DIST.RT, CHIDIST, CHISQ.INV, CHISQ.INV.RT, CHIINV
//! F: F.DIST, F.DIST.RT, FDIST, F.INV, F.INV.RT, FINV
//! Binomial: BINOM.DIST, BINOMDIST, BINOM.DIST.RANGE, BINOM.INV, CRITBINOM
//! Poisson: POISSON.DIST, POISSON
//! Exponential: EXPON.DIST, EXPONDIST
//! Negative binomial: NEGBINOM.DIST, NEGBINOMDIST
//! LogNormal: LOGNORM.DIST, LOGNORMDIST, LOGNORM.INV, LOGINV
//! Weibull: WEIBULL.DIST, WEIBULL
//! Beta: BETA.DIST, BETADIST, BETA.INV, BETAINV
//! Gamma: GAMMA, GAMMA.DIST, GAMMADIST, GAMMA.INV, GAMMAINV, GAMMALN, GAMMALN.PRECISE
//! GAUSS, PHI
//! Hypergeometric: HYPGEOM.DIST, HYPGEOMDIST
//! Confidence: CONFIDENCE.NORM, CONFIDENCE, CONFIDENCE.T

use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{
    Beta, Binomial, ChiSquared, Continuous, ContinuousCDF, Discrete, DiscreteCDF, Exp,
    FisherSnedecor, Gamma as GammaDist, Hypergeometric, LogNormal, NegativeBinomial, Normal,
    Poisson, StudentsT, Weibull as WeibullDist,
};
use statrs::function::gamma::{gamma as gamma_fn, ln_gamma};

/// Helper macro to construct a distribution, returning a #NUM! error with diagnostic message
/// if construction fails (e.g. due to NaN or other invalid parameters).
macro_rules! try_dist {
    ($expr:expr, $func_name:expr) => {
        match $expr {
            Ok(d) => d,
            Err(_) => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("{}: invalid distribution parameters", $func_name),
                )
            }
        }
    };
}

// --- Normal distribution ---

pub(super) struct FnNormDist;
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
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

/// NORMDIST is legacy alias for NORM.DIST
pub(super) struct FnNormDistLegacy;
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

pub(super) struct FnNormInv;
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
        if std_dev <= 0.0 || p <= 0.0 || p >= 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "NORM.INV: requires standard_dev > 0 and 0 < probability < 1, got standard_dev={std_dev}, p={p}"
                ),
            );
        }
        let dist = try_dist!(Normal::new(mean, std_dev), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(super) struct FnNormInvLegacy;
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

pub(super) struct FnNormSDist;
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
            CellValue::number(dist.cdf(z))
        } else {
            CellValue::number(dist.pdf(z))
        }
    }
}

pub(super) struct FnNormSDistLegacy;
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
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(dist.cdf(z))
    }
}

pub(super) struct FnNormSInv;
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
        if p <= 0.0 || p >= 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("NORM.S.INV: probability must be > 0 and < 1, got {p}"),
            );
        }
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(super) struct FnNormSInvLegacy;
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

pub(super) struct FnStandardize;
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

// --- Student's t distribution ---

pub(super) struct FnTDist;
impl PureFunction for FnTDist {
    fn name(&self) -> &'static str {
        "T.DIST"
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
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[2].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("T.DIST: degrees_freedom must be >= 1, got {df}"),
            );
        }
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

pub(super) struct FnTDist2T;
impl PureFunction for FnTDist2T {
    fn name(&self) -> &'static str {
        "T.DIST.2T"
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
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("T.DIST.2T: requires x >= 0 and degrees_freedom >= 1, got x={x}, df={df}"),
            );
        }
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        CellValue::number(2.0 * (1.0 - dist.cdf(x.abs())))
    }
}

pub(super) struct FnTDistRT;
impl PureFunction for FnTDistRT {
    fn name(&self) -> &'static str {
        "T.DIST.RT"
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
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("T.DIST.RT: degrees_freedom must be >= 1, got {df}"),
            );
        }
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        CellValue::number(1.0 - dist.cdf(x))
    }
}

pub(super) struct FnTDistLegacy;
impl PureFunction for FnTDistLegacy {
    fn name(&self) -> &'static str {
        "TDIST"
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
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let tails = match args[2].coerce_to_number() {
            Ok(v) => v as i32,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || df < 1.0 || (tails != 1 && tails != 2) {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "TDIST: requires x >= 0, degrees_freedom >= 1, and tails in {{1,2}}, got x={x}, df={df}, tails={tails}"
                ),
            );
        }
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        let rt = 1.0 - dist.cdf(x);
        if tails == 2 {
            CellValue::number(2.0 * rt)
        } else {
            CellValue::number(rt)
        }
    }
}

pub(super) struct FnTInv;
impl PureFunction for FnTInv {
    fn name(&self) -> &'static str {
        "T.INV"
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
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if p <= 0.0 || p >= 1.0 || df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "T.INV: requires 0 < probability < 1 and degrees_freedom >= 1, got p={p}, df={df}"
                ),
            );
        }
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(super) struct FnTInv2T;
impl PureFunction for FnTInv2T {
    fn name(&self) -> &'static str {
        "T.INV.2T"
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
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if p <= 0.0 || p > 1.0 || df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "T.INV.2T: requires 0 < probability <= 1 and degrees_freedom >= 1, got p={p}, df={df}"
                ),
            );
        }
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        CellValue::number(dist.inverse_cdf(1.0 - p / 2.0))
    }
}

/// TINV is legacy alias for T.INV.2T
pub(super) struct FnTInvLegacy;
impl PureFunction for FnTInvLegacy {
    fn name(&self) -> &'static str {
        "TINV"
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
        FnTInv2T.call(args)
    }
}

// --- Chi-squared distribution ---

pub(super) struct FnChisqDist;
impl PureFunction for FnChisqDist {
    fn name(&self) -> &'static str {
        "CHISQ.DIST"
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
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[2].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("CHISQ.DIST: requires x >= 0 and degrees_freedom >= 1, got x={x}, df={df}"),
            );
        }
        let dist = try_dist!(ChiSquared::new(df), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

pub(super) struct FnChisqDistRT;
impl PureFunction for FnChisqDistRT {
    fn name(&self) -> &'static str {
        "CHISQ.DIST.RT"
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
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CHISQ.DIST.RT: requires x >= 0 and degrees_freedom >= 1, got x={x}, df={df}"
                ),
            );
        }
        let dist = try_dist!(ChiSquared::new(df), self.name());
        CellValue::number(1.0 - dist.cdf(x))
    }
}

/// CHIDIST is legacy alias for CHISQ.DIST.RT
pub(super) struct FnChiDistLegacy;
impl PureFunction for FnChiDistLegacy {
    fn name(&self) -> &'static str {
        "CHIDIST"
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
        FnChisqDistRT.call(args)
    }
}

pub(super) struct FnChisqInv;
impl PureFunction for FnChisqInv {
    fn name(&self) -> &'static str {
        "CHISQ.INV"
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
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CHISQ.INV: requires 0 <= probability <= 1 and degrees_freedom >= 1, got p={p}, df={df}"
                ),
            );
        }
        let dist = try_dist!(ChiSquared::new(df), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(super) struct FnChisqInvRT;
impl PureFunction for FnChisqInvRT {
    fn name(&self) -> &'static str {
        "CHISQ.INV.RT"
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
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || df < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CHISQ.INV.RT: requires 0 <= probability <= 1 and degrees_freedom >= 1, got p={p}, df={df}"
                ),
            );
        }
        let dist = try_dist!(ChiSquared::new(df), self.name());
        CellValue::number(dist.inverse_cdf(1.0 - p))
    }
}

/// CHIINV is legacy alias for CHISQ.INV.RT
pub(super) struct FnChiInvLegacy;
impl PureFunction for FnChiInvLegacy {
    fn name(&self) -> &'static str {
        "CHIINV"
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
        FnChisqInvRT.call(args)
    }
}

// --- F distribution ---

pub(super) struct FnFDist;
impl PureFunction for FnFDist {
    fn name(&self) -> &'static str {
        "F.DIST"
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
        let df1 = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df2 = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || df1 < 1.0 || df2 < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "F.DIST: requires x >= 0, deg_freedom1 >= 1, deg_freedom2 >= 1, got x={x}, df1={df1}, df2={df2}"
                ),
            );
        }
        let dist = try_dist!(FisherSnedecor::new(df1, df2), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

pub(super) struct FnFDistRT;
impl PureFunction for FnFDistRT {
    fn name(&self) -> &'static str {
        "F.DIST.RT"
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
        let df1 = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df2 = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || df1 < 1.0 || df2 < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "F.DIST.RT: requires x >= 0, deg_freedom1 >= 1, deg_freedom2 >= 1, got x={x}, df1={df1}, df2={df2}"
                ),
            );
        }
        let dist = try_dist!(FisherSnedecor::new(df1, df2), self.name());
        CellValue::number(1.0 - dist.cdf(x))
    }
}

/// FDIST is legacy alias for F.DIST.RT
pub(super) struct FnFDistLegacy;
impl PureFunction for FnFDistLegacy {
    fn name(&self) -> &'static str {
        "FDIST"
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
        FnFDistRT.call(args)
    }
}

pub(super) struct FnFInv;
impl PureFunction for FnFInv {
    fn name(&self) -> &'static str {
        "F.INV"
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
        let df1 = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df2 = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || df1 < 1.0 || df2 < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "F.INV: requires 0 <= probability <= 1, deg_freedom1 >= 1, deg_freedom2 >= 1, got p={p}, df1={df1}, df2={df2}"
                ),
            );
        }
        let dist = try_dist!(FisherSnedecor::new(df1, df2), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(super) struct FnFInvRT;
impl PureFunction for FnFInvRT {
    fn name(&self) -> &'static str {
        "F.INV.RT"
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
        let df1 = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df2 = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || df1 < 1.0 || df2 < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "F.INV.RT: requires 0 <= probability <= 1, deg_freedom1 >= 1, deg_freedom2 >= 1, got p={p}, df1={df1}, df2={df2}"
                ),
            );
        }
        let dist = try_dist!(FisherSnedecor::new(df1, df2), self.name());
        CellValue::number(dist.inverse_cdf(1.0 - p))
    }
}

/// FINV is legacy alias for F.INV.RT
pub(super) struct FnFInvLegacy;
impl PureFunction for FnFInvLegacy {
    fn name(&self) -> &'static str {
        "FINV"
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
        FnFInvRT.call(args)
    }
}

// --- Binomial distribution ---

pub(super) struct FnBinomDist;
impl PureFunction for FnBinomDist {
    fn name(&self) -> &'static str {
        "BINOM.DIST"
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
        let s_f = match args[0].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let n_f = match args[1].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if s_f < 0.0 || n_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BINOM.DIST: number_s and trials must be >= 0, got number_s={s_f}, trials={n_f}"
                ),
            );
        }
        let s = s_f as u64;
        let n = n_f as u64;
        let p = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || s > n {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BINOM.DIST: requires 0 <= probability_s <= 1 and number_s <= trials, got p={p}, number_s={s}, trials={n}"
                ),
            );
        }
        let dist = try_dist!(Binomial::new(p, n), self.name());
        if cumulative {
            CellValue::number(dist.cdf(s))
        } else {
            CellValue::number(dist.pmf(s))
        }
    }
}

pub(super) struct FnBinomDistLegacy;
impl PureFunction for FnBinomDistLegacy {
    fn name(&self) -> &'static str {
        "BINOMDIST"
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
        FnBinomDist.call(args)
    }
}

pub(super) struct FnBinomDistRange;
impl PureFunction for FnBinomDistRange {
    fn name(&self) -> &'static str {
        "BINOM.DIST.RANGE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let n_f = match args[0].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if n_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BINOM.DIST.RANGE: trials must be >= 0, got {n_f}"),
            );
        }
        let n = n_f as u64;
        let p = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let s_f = match args[2].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if s_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BINOM.DIST.RANGE: number_s must be >= 0, got {s_f}"),
            );
        }
        let s = s_f as u64;
        let s2 = if args.len() > 3 {
            let s2_f = match args[3].coerce_to_number() {
                Ok(v) => v.floor(),
                Err(e) => return CellValue::Error(e, None),
            };
            if s2_f < 0.0 {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("BINOM.DIST.RANGE: number_s2 must be >= 0, got {s2_f}"),
                );
            }
            s2_f as u64
        } else {
            s
        };
        if !(0.0..=1.0).contains(&p) || s > n || s2 > n || s > s2 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BINOM.DIST.RANGE: requires 0 <= probability_s <= 1, number_s <= trials, number_s2 <= trials, number_s <= number_s2, got p={p}, s={s}, s2={s2}, n={n}"
                ),
            );
        }
        let dist = try_dist!(Binomial::new(p, n), self.name());
        let result: f64 = (s..=s2).map(|k| dist.pmf(k)).sum();
        CellValue::number(result)
    }
}

pub(super) struct FnBinomInv;
impl PureFunction for FnBinomInv {
    fn name(&self) -> &'static str {
        "BINOM.INV"
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
        let n_f = match args[0].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if n_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BINOM.INV: trials must be >= 0, got {n_f}"),
            );
        }
        let n = n_f as u64;
        let p = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let alpha = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || !(0.0..=1.0).contains(&alpha) {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BINOM.INV: requires 0 <= probability_s <= 1 and 0 <= alpha <= 1, got p={p}, alpha={alpha}"
                ),
            );
        }
        let dist = try_dist!(Binomial::new(p, n), self.name());
        for k in 0..=n {
            if dist.cdf(k) >= alpha {
                return CellValue::number(k as f64);
            }
        }
        CellValue::number(n as f64)
    }
}

/// CRITBINOM is legacy alias for BINOM.INV
pub(super) struct FnCritBinom;
impl PureFunction for FnCritBinom {
    fn name(&self) -> &'static str {
        "CRITBINOM"
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
        FnBinomInv.call(args)
    }
}

// --- Poisson distribution ---

pub(super) struct FnPoissonDist;
impl PureFunction for FnPoissonDist {
    fn name(&self) -> &'static str {
        "POISSON.DIST"
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
        let x_f = match args[0].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if x_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("POISSON.DIST: x must be >= 0, got {x_f}"),
            );
        }
        let x = x_f as u64;
        let mean = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[2].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if mean < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("POISSON.DIST: mean must be >= 0, got {mean}"),
            );
        }
        let dist = try_dist!(Poisson::new(mean), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pmf(x))
        }
    }
}

pub(super) struct FnPoissonLegacy;
impl PureFunction for FnPoissonLegacy {
    fn name(&self) -> &'static str {
        "POISSON"
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
        FnPoissonDist.call(args)
    }
}

// --- Exponential distribution ---

pub(super) struct FnExponDist;
impl PureFunction for FnExponDist {
    fn name(&self) -> &'static str {
        "EXPON.DIST"
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
        let lambda = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[2].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || lambda <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("EXPON.DIST: requires x >= 0 and lambda > 0, got x={x}, lambda={lambda}"),
            );
        }
        let dist = try_dist!(Exp::new(lambda), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

pub(super) struct FnExponDistLegacy;
impl PureFunction for FnExponDistLegacy {
    fn name(&self) -> &'static str {
        "EXPONDIST"
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
        FnExponDist.call(args)
    }
}

// --- Negative binomial distribution ---

pub(super) struct FnNegBinomDist;
impl PureFunction for FnNegBinomDist {
    fn name(&self) -> &'static str {
        "NEGBINOM.DIST"
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
        let f_f = match args[0].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let s_f = match args[1].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if f_f < 0.0 || s_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "NEGBINOM.DIST: number_f and number_s must be >= 0, got number_f={f_f}, number_s={s_f}"
                ),
            );
        }
        let f = f_f as u64;
        let s = s_f as u64;
        let p = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || s < 1 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "NEGBINOM.DIST: requires 0 <= probability_s <= 1 and number_s >= 1, got p={p}, number_s={s}"
                ),
            );
        }
        let dist = try_dist!(NegativeBinomial::new(s as f64, p), self.name());
        if cumulative {
            CellValue::number(dist.cdf(f))
        } else {
            CellValue::number(dist.pmf(f))
        }
    }
}

pub(super) struct FnNegBinomDistLegacy;
impl PureFunction for FnNegBinomDistLegacy {
    fn name(&self) -> &'static str {
        "NEGBINOMDIST"
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
        let f_f = match args[0].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let s_f = match args[1].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if f_f < 0.0 || s_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "NEGBINOMDIST: number_f and number_s must be >= 0, got number_f={f_f}, number_s={s_f}"
                ),
            );
        }
        let f = f_f as u64;
        let s = s_f as u64;
        let p = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || s < 1 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "NEGBINOMDIST: requires 0 <= probability_s <= 1 and number_s >= 1, got p={p}, number_s={s}"
                ),
            );
        }
        let dist = try_dist!(NegativeBinomial::new(s as f64, p), self.name());
        CellValue::number(dist.pmf(f))
    }
}

// --- LogNormal distribution ---

pub(super) struct FnLogNormDist;
impl PureFunction for FnLogNormDist {
    fn name(&self) -> &'static str {
        "LOGNORM.DIST"
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
        if x <= 0.0 || std_dev <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "LOGNORM.DIST: requires x > 0 and standard_dev > 0, got x={x}, standard_dev={std_dev}"
                ),
            );
        }
        let dist = try_dist!(LogNormal::new(mean, std_dev), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

pub(super) struct FnLogNormDistLegacy;
impl PureFunction for FnLogNormDistLegacy {
    fn name(&self) -> &'static str {
        "LOGNORMDIST"
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
        if x <= 0.0 || std_dev <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "LOGNORMDIST: requires x > 0 and standard_dev > 0, got x={x}, standard_dev={std_dev}"
                ),
            );
        }
        let dist = try_dist!(LogNormal::new(mean, std_dev), self.name());
        CellValue::number(dist.cdf(x))
    }
}

pub(super) struct FnLogNormInv;
impl PureFunction for FnLogNormInv {
    fn name(&self) -> &'static str {
        "LOGNORM.INV"
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
        if p <= 0.0 || p >= 1.0 || std_dev <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "LOGNORM.INV: requires 0 < probability < 1 and standard_dev > 0, got p={p}, standard_dev={std_dev}"
                ),
            );
        }
        let dist = try_dist!(LogNormal::new(mean, std_dev), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

/// LOGINV is legacy alias for LOGNORM.INV
pub(super) struct FnLogInv;
impl PureFunction for FnLogInv {
    fn name(&self) -> &'static str {
        "LOGINV"
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
        FnLogNormInv.call(args)
    }
}

// --- Weibull distribution ---

pub(super) struct FnWeibullDist;
impl PureFunction for FnWeibullDist {
    fn name(&self) -> &'static str {
        "WEIBULL.DIST"
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
        let alpha = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let beta = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "WEIBULL.DIST: requires x >= 0, alpha > 0, beta > 0, got x={x}, alpha={alpha}, beta={beta}"
                ),
            );
        }
        let dist = try_dist!(WeibullDist::new(alpha, beta), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

pub(super) struct FnWeibullLegacy;
impl PureFunction for FnWeibullLegacy {
    fn name(&self) -> &'static str {
        "WEIBULL"
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
        FnWeibullDist.call(args)
    }
}

// --- Beta distribution ---

pub(super) struct FnBetaDist;
impl PureFunction for FnBetaDist {
    fn name(&self) -> &'static str {
        "BETA.DIST"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            4 => Some(CellValue::number(0.0)), // A (lower bound) defaults to 0
            5 => Some(CellValue::number(1.0)), // B (upper bound) defaults to 1
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let alpha = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let beta_param = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let a = if args.len() > 4 {
            match args[4].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };
        let b = if args.len() > 5 {
            match args[5].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        if alpha <= 0.0 || beta_param <= 0.0 || x < a || x > b || a >= b {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BETA.DIST: requires alpha > 0, beta > 0, A < x <= B, A < B, got alpha={alpha}, beta={beta_param}, x={x}, A={a}, B={b}"
                ),
            );
        }
        let scaled = (x - a) / (b - a);
        let dist = try_dist!(Beta::new(alpha, beta_param), self.name());
        if cumulative {
            CellValue::number(dist.cdf(scaled))
        } else {
            CellValue::number(dist.pdf(scaled) / (b - a))
        }
    }
}

pub(super) struct FnBetaDistLegacy;
impl PureFunction for FnBetaDistLegacy {
    fn name(&self) -> &'static str {
        "BETADIST"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 => Some(CellValue::number(0.0)), // A (lower bound) defaults to 0
            4 => Some(CellValue::number(1.0)), // B (upper bound) defaults to 1
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let alpha = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let beta_param = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let a = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };
        let b = if args.len() > 4 {
            match args[4].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        if alpha <= 0.0 || beta_param <= 0.0 || x < a || x > b || a >= b {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BETADIST: requires alpha > 0, beta > 0, A <= x <= B, A < B, got alpha={alpha}, beta={beta_param}, x={x}, A={a}, B={b}"
                ),
            );
        }
        let scaled = (x - a) / (b - a);
        let dist = try_dist!(Beta::new(alpha, beta_param), self.name());
        CellValue::number(dist.cdf(scaled))
    }
}

pub(super) struct FnBetaInv;
impl PureFunction for FnBetaInv {
    fn name(&self) -> &'static str {
        "BETA.INV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 => Some(CellValue::number(0.0)), // A defaults to 0
            4 => Some(CellValue::number(1.0)), // B defaults to 1
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let alpha = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let beta_param = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let a = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };
        let b = if args.len() > 4 {
            match args[4].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        if !(0.0..=1.0).contains(&p) || alpha <= 0.0 || beta_param <= 0.0 || a >= b {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BETA.INV: requires 0 <= probability <= 1, alpha > 0, beta > 0, A < B, got p={p}, alpha={alpha}, beta={beta_param}, A={a}, B={b}"
                ),
            );
        }
        let dist = try_dist!(Beta::new(alpha, beta_param), self.name());
        CellValue::number(a + dist.inverse_cdf(p) * (b - a))
    }
}

pub(super) struct FnBetaInvLegacy;
impl PureFunction for FnBetaInvLegacy {
    fn name(&self) -> &'static str {
        "BETAINV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 => Some(CellValue::number(0.0)), // A defaults to 0
            4 => Some(CellValue::number(1.0)), // B defaults to 1
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnBetaInv.call(args)
    }
}

// --- Gamma distribution & functions ---

pub(super) struct FnGammaFn;
impl PureFunction for FnGammaFn {
    fn name(&self) -> &'static str {
        "GAMMA"
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
        if x <= 0.0 && x == x.floor() {
            return CellValue::error_with_message(
                CellError::Num,
                format!("GAMMA: x must not be a non-positive integer, got {x}"),
            );
        }
        let result = gamma_fn(x);
        if result.is_infinite() || result.is_nan() {
            CellValue::error_with_message(
                CellError::Num,
                format!("GAMMA: result is too large or undefined for x={x}"),
            )
        } else {
            CellValue::number(result)
        }
    }
}

pub(super) struct FnGammaDist;
impl PureFunction for FnGammaDist {
    fn name(&self) -> &'static str {
        "GAMMA.DIST"
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
        let alpha = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let beta = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "GAMMA.DIST: requires x >= 0, alpha > 0, beta > 0, got x={x}, alpha={alpha}, beta={beta}"
                ),
            );
        }
        // statrs Gamma::new(shape, rate) takes rate = 1/scale, but Excel's beta is scale
        let dist = try_dist!(GammaDist::new(alpha, 1.0 / beta), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

pub(super) struct FnGammaDistLegacy;
impl PureFunction for FnGammaDistLegacy {
    fn name(&self) -> &'static str {
        "GAMMADIST"
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
        FnGammaDist.call(args)
    }
}

pub(super) struct FnGammaInv;
impl PureFunction for FnGammaInv {
    fn name(&self) -> &'static str {
        "GAMMA.INV"
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
        let alpha = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let beta = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || alpha <= 0.0 || beta <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "GAMMA.INV: requires 0 <= probability <= 1, alpha > 0, beta > 0, got p={p}, alpha={alpha}, beta={beta}"
                ),
            );
        }
        // statrs Gamma::new(shape, rate) takes rate = 1/scale, but Excel's beta is scale
        let dist = try_dist!(GammaDist::new(alpha, 1.0 / beta), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(super) struct FnGammaInvLegacy;
impl PureFunction for FnGammaInvLegacy {
    fn name(&self) -> &'static str {
        "GAMMAINV"
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
        FnGammaInv.call(args)
    }
}

pub(super) struct FnGammaLn;
impl PureFunction for FnGammaLn {
    fn name(&self) -> &'static str {
        "GAMMALN"
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
        if x <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("GAMMALN: x must be > 0, got {x}"),
            );
        }
        CellValue::number(ln_gamma(x))
    }
}

pub(super) struct FnGammaLnPrecise;
impl PureFunction for FnGammaLnPrecise {
    fn name(&self) -> &'static str {
        "GAMMALN.PRECISE"
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
        FnGammaLn.call(args)
    }
}

// --- GAUSS, PHI ---

pub(super) struct FnGauss;
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
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(dist.cdf(z) - 0.5)
    }
}

pub(super) struct FnPhi;
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

// --- Hypergeometric distribution ---

pub(super) struct FnHypGeomDist;
impl PureFunction for FnHypGeomDist {
    fn name(&self) -> &'static str {
        "HYPGEOM.DIST"
    }
    fn min_args(&self) -> usize {
        5
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let s_f = match args[0].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let n_sample_f = match args[1].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let k_pop_f = match args[2].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let n_pop_f = match args[3].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if s_f < 0.0 || n_sample_f < 0.0 || k_pop_f < 0.0 || n_pop_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "HYPGEOM.DIST: all parameters must be >= 0, got sample_s={s_f}, number_sample={n_sample_f}, population_s={k_pop_f}, number_pop={n_pop_f}"
                ),
            );
        }
        let s = s_f as u64;
        let n_sample = n_sample_f as u64;
        let k_pop = k_pop_f as u64;
        let n_pop = n_pop_f as u64;
        let cumulative = match args[4].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if n_sample > n_pop || k_pop > n_pop || s > n_sample || s > k_pop {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "HYPGEOM.DIST: requires sample_s <= number_sample <= number_pop, population_s <= number_pop, sample_s <= population_s, got s={s}, n_sample={n_sample}, k_pop={k_pop}, n_pop={n_pop}"
                ),
            );
        }
        let dist = try_dist!(Hypergeometric::new(n_pop, k_pop, n_sample), self.name());
        if cumulative {
            CellValue::number(dist.cdf(s))
        } else {
            CellValue::number(dist.pmf(s))
        }
    }
}

pub(super) struct FnHypGeomDistLegacy;
impl PureFunction for FnHypGeomDistLegacy {
    fn name(&self) -> &'static str {
        "HYPGEOMDIST"
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
        let s_f = match args[0].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let n_sample_f = match args[1].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let k_pop_f = match args[2].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        let n_pop_f = match args[3].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if s_f < 0.0 || n_sample_f < 0.0 || k_pop_f < 0.0 || n_pop_f < 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "HYPGEOMDIST: all parameters must be >= 0, got sample_s={s_f}, number_sample={n_sample_f}, population_s={k_pop_f}, number_pop={n_pop_f}"
                ),
            );
        }
        let s = s_f as u64;
        let n_sample = n_sample_f as u64;
        let k_pop = k_pop_f as u64;
        let n_pop = n_pop_f as u64;
        if n_sample > n_pop || k_pop > n_pop || s > n_sample || s > k_pop {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "HYPGEOMDIST: requires sample_s <= number_sample <= number_pop, population_s <= number_pop, sample_s <= population_s, got s={s}, n_sample={n_sample}, k_pop={k_pop}, n_pop={n_pop}"
                ),
            );
        }
        let dist = try_dist!(Hypergeometric::new(n_pop, k_pop, n_sample), self.name());
        CellValue::number(dist.pmf(s))
    }
}

// --- Confidence intervals ---

pub(super) struct FnConfidenceNorm;
impl PureFunction for FnConfidenceNorm {
    fn name(&self) -> &'static str {
        "CONFIDENCE.NORM"
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
        let alpha = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let std_dev = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let size = match args[2].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if alpha <= 0.0
            || alpha >= 1.0
            || std_dev <= 0.0
            || size < 1.0
            || alpha.is_nan()
            || std_dev.is_nan()
            || size.is_nan()
        {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CONFIDENCE.NORM: requires 0 < alpha < 1, standard_dev > 0, size >= 1, got alpha={alpha}, standard_dev={std_dev}, size={size}"
                ),
            );
        }
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        let z = dist.inverse_cdf(1.0 - alpha / 2.0);
        CellValue::number(z * std_dev / size.sqrt())
    }
}

pub(super) struct FnConfidenceLegacy;
impl PureFunction for FnConfidenceLegacy {
    fn name(&self) -> &'static str {
        "CONFIDENCE"
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
        FnConfidenceNorm.call(args)
    }
}

pub(super) struct FnConfidenceT;
impl PureFunction for FnConfidenceT {
    fn name(&self) -> &'static str {
        "CONFIDENCE.T"
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
        let alpha = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let std_dev = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let size = match args[2].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if alpha <= 0.0
            || alpha >= 1.0
            || std_dev <= 0.0
            || size < 2.0
            || alpha.is_nan()
            || std_dev.is_nan()
            || size.is_nan()
        {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CONFIDENCE.T: requires 0 < alpha < 1, standard_dev > 0, size >= 2, got alpha={alpha}, standard_dev={std_dev}, size={size}"
                ),
            );
        }
        let df = size - 1.0;
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        let t = dist.inverse_cdf(1.0 - alpha / 2.0);
        CellValue::number(t * std_dev / size.sqrt())
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    // Normal distribution
    registry.register(Box::new(FnNormDist));
    registry.register(Box::new(FnNormDistLegacy));
    registry.register(Box::new(FnNormInv));
    registry.register(Box::new(FnNormInvLegacy));
    registry.register(Box::new(FnNormSDist));
    registry.register(Box::new(FnNormSDistLegacy));
    registry.register(Box::new(FnNormSInv));
    registry.register(Box::new(FnNormSInvLegacy));
    registry.register(Box::new(FnStandardize));
    // Student's t distribution
    registry.register(Box::new(FnTDist));
    registry.register(Box::new(FnTDist2T));
    registry.register(Box::new(FnTDistRT));
    registry.register(Box::new(FnTDistLegacy));
    registry.register(Box::new(FnTInv));
    registry.register(Box::new(FnTInv2T));
    registry.register(Box::new(FnTInvLegacy));
    // Chi-squared distribution
    registry.register(Box::new(FnChisqDist));
    registry.register(Box::new(FnChisqDistRT));
    registry.register(Box::new(FnChiDistLegacy));
    registry.register(Box::new(FnChisqInv));
    registry.register(Box::new(FnChisqInvRT));
    registry.register(Box::new(FnChiInvLegacy));
    // F distribution
    registry.register(Box::new(FnFDist));
    registry.register(Box::new(FnFDistRT));
    registry.register(Box::new(FnFDistLegacy));
    registry.register(Box::new(FnFInv));
    registry.register(Box::new(FnFInvRT));
    registry.register(Box::new(FnFInvLegacy));
    // Binomial distribution
    registry.register(Box::new(FnBinomDist));
    registry.register(Box::new(FnBinomDistLegacy));
    registry.register(Box::new(FnBinomDistRange));
    registry.register(Box::new(FnBinomInv));
    registry.register(Box::new(FnCritBinom));
    // Poisson distribution
    registry.register(Box::new(FnPoissonDist));
    registry.register(Box::new(FnPoissonLegacy));
    // Exponential distribution
    registry.register(Box::new(FnExponDist));
    registry.register(Box::new(FnExponDistLegacy));
    // Negative binomial
    registry.register(Box::new(FnNegBinomDist));
    registry.register(Box::new(FnNegBinomDistLegacy));
    // LogNormal distribution
    registry.register(Box::new(FnLogNormDist));
    registry.register(Box::new(FnLogNormDistLegacy));
    registry.register(Box::new(FnLogNormInv));
    registry.register(Box::new(FnLogInv));
    // Weibull distribution
    registry.register(Box::new(FnWeibullDist));
    registry.register(Box::new(FnWeibullLegacy));
    // Beta distribution
    registry.register(Box::new(FnBetaDist));
    registry.register(Box::new(FnBetaDistLegacy));
    registry.register(Box::new(FnBetaInv));
    registry.register(Box::new(FnBetaInvLegacy));
    // Gamma distribution & functions
    registry.register(Box::new(FnGammaFn));
    registry.register(Box::new(FnGammaDist));
    registry.register(Box::new(FnGammaDistLegacy));
    registry.register(Box::new(FnGammaInv));
    registry.register(Box::new(FnGammaInvLegacy));
    registry.register(Box::new(FnGammaLn));
    registry.register(Box::new(FnGammaLnPrecise));
    // Gauss & Phi
    registry.register(Box::new(FnGauss));
    registry.register(Box::new(FnPhi));
    // Hypergeometric
    registry.register(Box::new(FnHypGeomDist));
    registry.register(Box::new(FnHypGeomDistLegacy));
    // Confidence intervals
    registry.register(Box::new(FnConfidenceNorm));
    registry.register(Box::new(FnConfidenceLegacy));
    registry.register(Box::new(FnConfidenceT));
}
