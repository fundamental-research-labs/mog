use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Continuous, ContinuousCDF, Gamma as GammaDist};
use statrs::function::gamma::{gamma as gamma_fn, ln_gamma};

use super::support::try_dist;

// --- Gamma distribution & functions ---

pub(in crate::statistical) struct FnGammaFn;
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

pub(in crate::statistical) struct FnGammaDist;
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

pub(in crate::statistical) struct FnGammaDistLegacy;
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

pub(in crate::statistical) struct FnGammaInv;
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

pub(in crate::statistical) struct FnGammaInvLegacy;
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

pub(in crate::statistical) struct FnGammaLn;
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

pub(in crate::statistical) struct FnGammaLnPrecise;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnGammaFn));
    registry.register(Box::new(FnGammaDist));
    registry.register(Box::new(FnGammaDistLegacy));
    registry.register(Box::new(FnGammaInv));
    registry.register(Box::new(FnGammaInvLegacy));
    registry.register(Box::new(FnGammaLn));
    registry.register(Box::new(FnGammaLnPrecise));
}
