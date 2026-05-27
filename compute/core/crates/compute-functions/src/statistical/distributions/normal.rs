use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Continuous, ContinuousCDF, Normal};

use super::support::try_dist;

// --- Normal distribution ---

pub(in crate::statistical) struct FnNormDist;
impl PureFunction for FnNormDist {
    fn name(&self) -> &'static str {
        "NORM.DIST"
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
        if std_dev <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("NORM.DIST: standard_dev must be > 0, got {std_dev}"),
            );
        }
        let dist = try_dist!(Normal::new(mean, std_dev), self.name());
        if cumulative {
            CellValue::number(dist.cdf(x))
        } else {
            CellValue::number(dist.pdf(x))
        }
    }
}

/// NORMDIST is legacy alias for NORM.DIST
pub(in crate::statistical) struct FnNormDistLegacy;
impl PureFunction for FnNormDistLegacy {
    fn name(&self) -> &'static str {
        "NORMDIST"
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
        FnNormDist.call(args)
    }
}

pub(in crate::statistical) struct FnNormInv;
impl PureFunction for FnNormInv {
    fn name(&self) -> &'static str {
        "NORM.INV"
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
        if std_dev <= 0.0 || p <= 0.0 || p >= 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "NORM.INV: requires standard_dev > 0 and 0 < probability < 1, got standard_dev={std_dev}, p={p}"
                ),
            );
        }
        let dist = try_dist!(Normal::new(mean, std_dev), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(in crate::statistical) struct FnNormInvLegacy;
impl PureFunction for FnNormInvLegacy {
    fn name(&self) -> &'static str {
        "NORMINV"
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
        FnNormInv.call(args)
    }
}

pub(in crate::statistical) struct FnNormSDist;
impl PureFunction for FnNormSDist {
    fn name(&self) -> &'static str {
        "NORM.S.DIST"
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
        let z = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[1].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        if cumulative {
            CellValue::number(dist.cdf(z))
        } else {
            CellValue::number(dist.pdf(z))
        }
    }
}

pub(in crate::statistical) struct FnNormSDistLegacy;
impl PureFunction for FnNormSDistLegacy {
    fn name(&self) -> &'static str {
        "NORMSDIST"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let z = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(dist.cdf(z))
    }
}

pub(in crate::statistical) struct FnNormSInv;
impl PureFunction for FnNormSInv {
    fn name(&self) -> &'static str {
        "NORM.S.INV"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        if p <= 0.0 || p >= 1.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("NORM.S.INV: probability must be > 0 and < 1, got {p}"),
            );
        }
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(dist.inverse_cdf(p))
    }
}

pub(in crate::statistical) struct FnNormSInvLegacy;
impl PureFunction for FnNormSInvLegacy {
    fn name(&self) -> &'static str {
        "NORMSINV"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnNormSInv.call(args)
    }
}

pub(in crate::statistical) struct FnStandardize;
impl PureFunction for FnStandardize {
    fn name(&self) -> &'static str {
        "STANDARDIZE"
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
        if std_dev <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("STANDARDIZE: standard_dev must be > 0, got {std_dev}"),
            );
        }
        CellValue::number((x - mean) / std_dev)
    }
}

// --- GAUSS, PHI ---

pub(in crate::statistical) struct FnGauss;
impl PureFunction for FnGauss {
    fn name(&self) -> &'static str {
        "GAUSS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let z = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(dist.cdf(z) - 0.5)
    }
}

pub(in crate::statistical) struct FnPhi;
impl PureFunction for FnPhi {
    fn name(&self) -> &'static str {
        "PHI"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let dist = try_dist!(Normal::new(0.0, 1.0), self.name());
        CellValue::number(dist.pdf(x))
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnNormDist));
    registry.register(Box::new(FnNormDistLegacy));
    registry.register(Box::new(FnNormInv));
    registry.register(Box::new(FnNormInvLegacy));
    registry.register(Box::new(FnNormSDist));
    registry.register(Box::new(FnNormSDistLegacy));
    registry.register(Box::new(FnNormSInv));
    registry.register(Box::new(FnNormSInvLegacy));
    registry.register(Box::new(FnStandardize));
}

pub(super) fn register_gauss_phi(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnGauss));
    registry.register(Box::new(FnPhi));
}
