use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

use statrs::distribution::{Beta, Continuous, ContinuousCDF};

use super::support::try_dist;

// --- Beta distribution ---

pub(in crate::statistical) struct FnBetaDist;
impl PureFunction for FnBetaDist {
    fn name(&self) -> &'static str {
        "BETA.DIST"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            4 => Some(CellValue::number(0.0)), // A (lower bound) defaults to 0
            5 => Some(CellValue::number(1.0)), // B (upper bound) defaults to 1
            _ => None,
        }
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
        let beta_param = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let cumulative = match args[3].coerce_to_bool() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let a = if args.len() > 4 {
            match args[4].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };
        let b = if args.len() > 5 {
            match args[5].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        if alpha <= 0.0 || beta_param <= 0.0 || x < a || x > b || a >= b {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BETA.DIST: requires alpha > 0, beta > 0, A < x <= B, A < B, got alpha={alpha}, beta={beta_param}, x={x}, A={a}, B={b}"
                ),
            );
        }
        let scaled = (x - a) / (b - a);
        let dist = try_dist!(Beta::new(alpha, beta_param), self.name());
        if cumulative {
            CellValue::number(dist.cdf(scaled))
        } else {
            CellValue::number(dist.pdf(scaled) / (b - a))
        }
    }
}

pub(in crate::statistical) struct FnBetaDistLegacy;
impl PureFunction for FnBetaDistLegacy {
    fn name(&self) -> &'static str {
        "BETADIST"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 => Some(CellValue::number(0.0)), // A (lower bound) defaults to 0
            4 => Some(CellValue::number(1.0)), // B (upper bound) defaults to 1
            _ => None,
        }
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
        let beta_param = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let a = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };
        let b = if args.len() > 4 {
            match args[4].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        if alpha <= 0.0 || beta_param <= 0.0 || x < a || x > b || a >= b {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BETADIST: requires alpha > 0, beta > 0, A <= x <= B, A < B, got alpha={alpha}, beta={beta_param}, x={x}, A={a}, B={b}"
                ),
            );
        }
        let scaled = (x - a) / (b - a);
        let dist = try_dist!(Beta::new(alpha, beta_param), self.name());
        CellValue::number(dist.cdf(scaled))
    }
}

pub(in crate::statistical) struct FnBetaInv;
impl PureFunction for FnBetaInv {
    fn name(&self) -> &'static str {
        "BETA.INV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 => Some(CellValue::number(0.0)), // A defaults to 0
            4 => Some(CellValue::number(1.0)), // B defaults to 1
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let p = match args[0].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let alpha = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let beta_param = match args[2].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let a = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };
        let b = if args.len() > 4 {
            match args[4].coerce_to_number() {
                Ok(v) => v,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        if !(0.0..=1.0).contains(&p) || alpha <= 0.0 || beta_param <= 0.0 || a >= b {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BETA.INV: requires 0 <= probability <= 1, alpha > 0, beta > 0, A < B, got p={p}, alpha={alpha}, beta={beta_param}, A={a}, B={b}"
                ),
            );
        }
        let dist = try_dist!(Beta::new(alpha, beta_param), self.name());
        CellValue::number(a + dist.inverse_cdf(p) * (b - a))
    }
}

pub(in crate::statistical) struct FnBetaInvLegacy;
impl PureFunction for FnBetaInvLegacy {
    fn name(&self) -> &'static str {
        "BETAINV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 => Some(CellValue::number(0.0)), // A defaults to 0
            4 => Some(CellValue::number(1.0)), // B defaults to 1
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnBetaInv.call(args)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnBetaDist));
    registry.register(Box::new(FnBetaDistLegacy));
    registry.register(Box::new(FnBetaInv));
    registry.register(Box::new(FnBetaInvLegacy));
}
