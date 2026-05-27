use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Continuous, ContinuousCDF, LogNormal};

use super::support::try_dist;

// --- LogNormal distribution ---

pub(in crate::statistical) struct FnLogNormDist;
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

pub(in crate::statistical) struct FnLogNormDistLegacy;
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

pub(in crate::statistical) struct FnLogNormInv;
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
pub(in crate::statistical) struct FnLogInv;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnLogNormDist));
    registry.register(Box::new(FnLogNormDistLegacy));
    registry.register(Box::new(FnLogNormInv));
    registry.register(Box::new(FnLogInv));
}
