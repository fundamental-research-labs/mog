use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Continuous, ContinuousCDF, FisherSnedecor};

use super::support::try_dist;

// --- F distribution ---

pub(in crate::statistical) struct FnFDist;
impl PureFunction for FnFDist {
    fn name(&self) -> &'static str {
        "F.DIST"
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
        let df1 = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df2 = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || df1 < 1.0 || df2 < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "F.DIST: requires x >= 0, deg_freedom1 >= 1, deg_freedom2 >= 1, got x={x}, df1={df1}, df2={df2}"
                ),
            );
        }
        let dist = try_dist!(FisherSnedecor::new(df1, df2), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

pub(in crate::statistical) struct FnFDistRT;
impl PureFunction for FnFDistRT {
    fn name(&self) -> &'static str {
        "F.DIST.RT"
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
        let df1 = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df2 = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if x < 0.0 || df1 < 1.0 || df2 < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "F.DIST.RT: requires x >= 0, deg_freedom1 >= 1, deg_freedom2 >= 1, got x={x}, df1={df1}, df2={df2}"
                ),
            );
        }
        let dist = try_dist!(FisherSnedecor::new(df1, df2), self.name());
        CellValue::number(1.0 - dist.cdf(x))
    }
}

/// FDIST is legacy alias for F.DIST.RT
pub(in crate::statistical) struct FnFDistLegacy;
impl PureFunction for FnFDistLegacy {
    fn name(&self) -> &'static str {
        "FDIST"
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
        FnFDistRT.call(args)
    }
}

pub(in crate::statistical) struct FnFInv;
impl PureFunction for FnFInv {
    fn name(&self) -> &'static str {
        "F.INV"
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
        let df1 = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df2 = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || df1 < 1.0 || df2 < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "F.INV: requires 0 <= probability <= 1, deg_freedom1 >= 1, deg_freedom2 >= 1, got p={p}, df1={df1}, df2={df2}"
                ),
            );
        }
        let dist = try_dist!(FisherSnedecor::new(df1, df2), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(in crate::statistical) struct FnFInvRT;
impl PureFunction for FnFInvRT {
    fn name(&self) -> &'static str {
        "F.INV.RT"
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
        let df1 = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let df2 = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(0.0..=1.0).contains(&p) || df1 < 1.0 || df2 < 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "F.INV.RT: requires 0 <= probability <= 1, deg_freedom1 >= 1, deg_freedom2 >= 1, got p={p}, df1={df1}, df2={df2}"
                ),
            );
        }
        let dist = try_dist!(FisherSnedecor::new(df1, df2), self.name());
        CellValue::number(dist.inverse_cdf(1.0 - p))
    }
}

/// FINV is legacy alias for F.INV.RT
pub(in crate::statistical) struct FnFInvLegacy;
impl PureFunction for FnFInvLegacy {
    fn name(&self) -> &'static str {
        "FINV"
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
        FnFInvRT.call(args)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnFDist));
    registry.register(Box::new(FnFDistRT));
    registry.register(Box::new(FnFDistLegacy));
    registry.register(Box::new(FnFInv));
    registry.register(Box::new(FnFInvRT));
    registry.register(Box::new(FnFInvLegacy));
}
