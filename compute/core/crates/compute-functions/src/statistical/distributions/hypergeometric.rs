use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Discrete, DiscreteCDF, Hypergeometric};

use super::support::try_dist;

// --- Hypergeometric distribution ---

pub(in crate::statistical) struct FnHypGeomDist;
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
        // Excel rejects degenerate populations/samples and samples that cannot
        // contain enough successes because the population has too few
        // failures.  The upper bound is min(number_sample, population_s),
        // while the lower bound is max(0, number_sample - number_pop +
        // population_s).
        let min_successes = n_sample.saturating_sub(n_pop.saturating_sub(k_pop));
        if n_sample == 0
            || k_pop == 0
            || n_pop == 0
            || n_sample > n_pop
            || k_pop > n_pop
            || s > n_sample
            || s > k_pop
            || s < min_successes
        {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "HYPGEOM.DIST: requires 0 < number_sample <= number_pop, 0 < population_s <= number_pop, and max(0, number_sample - number_pop + population_s) <= sample_s <= min(number_sample, population_s), got s={s}, n_sample={n_sample}, k_pop={k_pop}, n_pop={n_pop}"
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

pub(in crate::statistical) struct FnHypGeomDistLegacy;
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
        let min_successes = n_sample.saturating_sub(n_pop.saturating_sub(k_pop));
        if n_sample == 0
            || k_pop == 0
            || n_pop == 0
            || n_sample > n_pop
            || k_pop > n_pop
            || s > n_sample
            || s > k_pop
            || s < min_successes
        {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "HYPGEOMDIST: requires 0 < number_sample <= number_pop, 0 < population_s <= number_pop, and max(0, number_sample - number_pop + population_s) <= sample_s <= min(number_sample, population_s), got s={s}, n_sample={n_sample}, k_pop={k_pop}, n_pop={n_pop}"
                ),
            );
        }
        let dist = try_dist!(Hypergeometric::new(n_pop, k_pop, n_sample), self.name());
        CellValue::number(dist.pmf(s))
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnHypGeomDist));
    registry.register(Box::new(FnHypGeomDistLegacy));
}
