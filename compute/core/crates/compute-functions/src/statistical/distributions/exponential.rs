use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Continuous, ContinuousCDF, Exp};

use super::support::try_dist;

// --- Exponential distribution ---

pub(in crate::statistical) struct FnExponDist;
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

pub(in crate::statistical) struct FnExponDistLegacy;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnExponDist));
    registry.register(Box::new(FnExponDistLegacy));
}
