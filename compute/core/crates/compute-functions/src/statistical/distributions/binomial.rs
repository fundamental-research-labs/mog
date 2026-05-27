use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Binomial, Discrete, DiscreteCDF};

use super::support::try_dist;

// --- Binomial distribution ---

pub(in crate::statistical) struct FnBinomDist;
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

pub(in crate::statistical) struct FnBinomDistLegacy;
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

pub(in crate::statistical) struct FnBinomDistRange;
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

pub(in crate::statistical) struct FnBinomInv;
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
pub(in crate::statistical) struct FnCritBinom;
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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnBinomDist));
    registry.register(Box::new(FnBinomDistLegacy));
    registry.register(Box::new(FnBinomDistRange));
    registry.register(Box::new(FnBinomInv));
    registry.register(Box::new(FnCritBinom));
}
