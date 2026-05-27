use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{ContinuousCDF, Normal, StudentsT};

use super::support::try_dist;

// --- Confidence intervals ---

pub(in crate::statistical) struct FnConfidenceNorm;
impl PureFunction for FnConfidenceNorm {
    fn name(&self) -> &'static str {
        "CONFIDENCE.NORM"
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
        let alpha = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let std_dev = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let size = match args[2].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if alpha <= 0.0
            || alpha >= 1.0
            || std_dev <= 0.0
            || size < 1.0
            || alpha.is_nan()
            || std_dev.is_nan()
            || size.is_nan()
        {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CONFIDENCE.NORM: requires 0 < alpha < 1, standard_dev > 0, size >= 1, got alpha={alpha}, standard_dev={std_dev}, size={size}"
                ),
            );
        }
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        let z = dist.inverse_cdf(1.0 - alpha / 2.0);
        CellValue::number(z * std_dev / size.sqrt())
    }
}

pub(in crate::statistical) struct FnConfidenceLegacy;
impl PureFunction for FnConfidenceLegacy {
    fn name(&self) -> &'static str {
        "CONFIDENCE"
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
        FnConfidenceNorm.call(args)
    }
}

pub(in crate::statistical) struct FnConfidenceT;
impl PureFunction for FnConfidenceT {
    fn name(&self) -> &'static str {
        "CONFIDENCE.T"
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
        let alpha = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let std_dev = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let size = match args[2].coerce_to_number() {
            Ok(v) => v.floor(),
            Err(e) => return CellValue::Error(e, None),
        };
        if alpha <= 0.0
            || alpha >= 1.0
            || std_dev <= 0.0
            || size < 2.0
            || alpha.is_nan()
            || std_dev.is_nan()
            || size.is_nan()
        {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CONFIDENCE.T: requires 0 < alpha < 1, standard_dev > 0, size >= 2, got alpha={alpha}, standard_dev={std_dev}, size={size}"
                ),
            );
        }
        let df = size - 1.0;
        let dist = try_dist!(StudentsT::new(0.0, 1.0, df), self.name());
        let t = dist.inverse_cdf(1.0 - alpha / 2.0);
        CellValue::number(t * std_dev / size.sqrt())
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnConfidenceNorm));
    registry.register(Box::new(FnConfidenceLegacy));
    registry.register(Box::new(FnConfidenceT));
}
