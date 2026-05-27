use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Continuous, ContinuousCDF, StudentsT};

use super::support::try_dist;

// --- Student's t distribution ---

pub(in crate::statistical) struct FnTDist;
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

pub(in crate::statistical) struct FnTDist2T;
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

pub(in crate::statistical) struct FnTDistRT;
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

pub(in crate::statistical) struct FnTDistLegacy;
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

pub(in crate::statistical) struct FnTInv;
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

pub(in crate::statistical) struct FnTInv2T;
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
pub(in crate::statistical) struct FnTInvLegacy;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTDist));
    registry.register(Box::new(FnTDist2T));
    registry.register(Box::new(FnTDistRT));
    registry.register(Box::new(FnTDistLegacy));
    registry.register(Box::new(FnTInv));
    registry.register(Box::new(FnTInv2T));
    registry.register(Box::new(FnTInvLegacy));
}
