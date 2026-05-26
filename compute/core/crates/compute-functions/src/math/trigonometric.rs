//! Trigonometric functions: SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2,
//! DEGREES, RADIANS, COT, ACOT, SEC, CSC

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

one_num_fn!(FnSin, "SIN", |n: f64| n.sin());
one_num_fn!(FnCos, "COS", |n: f64| n.cos());
one_num_fn!(FnAtan, "ATAN", |n: f64| n.atan());
one_num_fn!(FnDegrees, "DEGREES", |n: f64| n * 180.0
    / std::f64::consts::PI);
one_num_fn!(FnRadians, "RADIANS", |n: f64| n * std::f64::consts::PI
    / 180.0);

pub(super) struct FnTan;
impl PureFunction for FnTan {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TAN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let r = n.tan();
                if r.is_infinite() || r.is_nan() {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("TAN: undefined at {n} (near odd multiple of pi/2)"),
                    )
                } else {
                    CellValue::number(r)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnAsin;
impl PureFunction for FnAsin {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ASIN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) if !(-1.0..=1.0).contains(&n) => CellValue::error_with_message(
                CellError::Num,
                format!("ASIN: number must be between -1 and 1, got {n}"),
            ),
            Ok(n) => CellValue::number(n.asin()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnAcos;
impl PureFunction for FnAcos {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ACOS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) if !(-1.0..=1.0).contains(&n) => CellValue::error_with_message(
                CellError::Num,
                format!("ACOS: number must be between -1 and 1, got {n}"),
            ),
            Ok(n) => CellValue::number(n.acos()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnAtan2;
impl PureFunction for FnAtan2 {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ATAN2"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(x), Ok(y)) => {
                if x == 0.0 && y == 0.0 {
                    CellValue::error_with_message(CellError::Div0, "ATAN2: both x and y are 0")
                } else {
                    // Excel ATAN2(x, y) = Math.atan2(y, x)
                    CellValue::number(y.atan2(x))
                }
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCot;
impl PureFunction for FnCot {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let sin_val = n.sin();
                if sin_val == 0.0 {
                    CellValue::error_with_message(
                        CellError::Div0,
                        format!("COT: sin({n}) is 0 (division by zero)"),
                    )
                } else {
                    CellValue::number(n.cos() / sin_val)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnAcot;
impl PureFunction for FnAcot {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ACOT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n == 0.0 {
                    CellValue::number(std::f64::consts::FRAC_PI_2)
                } else if n > 0.0 {
                    CellValue::number((1.0 / n).atan())
                } else {
                    CellValue::number((1.0 / n).atan() + std::f64::consts::PI)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnSec;
impl PureFunction for FnSec {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SEC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let cos_val = n.cos();
                if cos_val == 0.0 {
                    CellValue::error_with_message(
                        CellError::Div0,
                        format!("SEC: cos({n}) is 0 (division by zero)"),
                    )
                } else {
                    CellValue::number(1.0 / cos_val)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCsc;
impl PureFunction for FnCsc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CSC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let sin_val = n.sin();
                if sin_val == 0.0 {
                    CellValue::error_with_message(
                        CellError::Div0,
                        format!("CSC: sin({n}) is 0 (division by zero)"),
                    )
                } else {
                    CellValue::number(1.0 / sin_val)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnSin));
    registry.register(Box::new(FnCos));
    registry.register(Box::new(FnTan));
    registry.register(Box::new(FnAsin));
    registry.register(Box::new(FnAcos));
    registry.register(Box::new(FnAtan));
    registry.register(Box::new(FnAtan2));
    registry.register(Box::new(FnDegrees));
    registry.register(Box::new(FnRadians));
    registry.register(Box::new(FnCot));
    registry.register(Box::new(FnAcot));
    registry.register(Box::new(FnSec));
    registry.register(Box::new(FnCsc));
}
