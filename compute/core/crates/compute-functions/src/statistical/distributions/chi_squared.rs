use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{ChiSquared, Continuous, ContinuousCDF};

use super::support::try_dist;

// --- Chi-squared distribution ---

pub(in crate::statistical) struct FnChisqDist;
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

pub(in crate::statistical) struct FnChisqDistRT;
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
pub(in crate::statistical) struct FnChiDistLegacy;
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

pub(in crate::statistical) struct FnChisqInv;
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

pub(in crate::statistical) struct FnChisqInvRT;
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
pub(in crate::statistical) struct FnChiInvLegacy;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnChisqDist));
    registry.register(Box::new(FnChisqDistRT));
    registry.register(Box::new(FnChiDistLegacy));
    registry.register(Box::new(FnChisqInv));
    registry.register(Box::new(FnChisqInvRT));
    registry.register(Box::new(FnChiInvLegacy));
}
