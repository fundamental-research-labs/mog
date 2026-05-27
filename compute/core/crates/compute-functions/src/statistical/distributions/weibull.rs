use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Continuous, ContinuousCDF, Weibull as WeibullDist};

use super::support::try_dist;

// --- Weibull distribution ---

pub(in crate::statistical) struct FnWeibullDist;
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

pub(in crate::statistical) struct FnWeibullLegacy;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnWeibullDist));
    registry.register(Box::new(FnWeibullLegacy));
}
