use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Discrete, DiscreteCDF, NegativeBinomial};

use super::support::try_dist;

// --- Negative binomial distribution ---

pub(in crate::statistical) struct FnNegBinomDist;
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

pub(in crate::statistical) struct FnNegBinomDistLegacy;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnNegBinomDist));
    registry.register(Box::new(FnNegBinomDistLegacy));
}
