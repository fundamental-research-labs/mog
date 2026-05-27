use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Discrete, DiscreteCDF, Poisson};

use super::support::try_dist;

// --- Poisson distribution ---

pub(in crate::statistical) struct FnPoissonDist;
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

pub(in crate::statistical) struct FnPoissonLegacy;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnPoissonDist));
    registry.register(Box::new(FnPoissonLegacy));
}
