//! Hyperbolic functions: SINH, COSH, TANH, ASINH, ACOSH, ATANH,
//! COTH, ACOTH, SECH, CSCH

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

one_num_fn!(FnSinh, "SINH", |n: f64| n.sinh());
one_num_fn!(FnCosh, "COSH", |n: f64| n.cosh());
one_num_fn!(FnTanh, "TANH", |n: f64| n.tanh());
one_num_fn!(FnAsinh, "ASINH", |n: f64| n.asinh());

pub(super) struct FnAcosh;
impl PureFunction for FnAcosh {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ACOSH"
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
            Ok(n) if n < 1.0 => CellValue::error_with_message(
                CellError::Num,
                format!("ACOSH: number must be >= 1, got {n}"),
            ),
            Ok(n) => CellValue::number(n.acosh()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnAtanh;
impl PureFunction for FnAtanh {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ATANH"
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
            Ok(n) if n <= -1.0 || n >= 1.0 => CellValue::error_with_message(
                CellError::Num,
                format!("ATANH: number must be between -1 and 1 (exclusive), got {n}"),
            ),
            Ok(n) => CellValue::number(n.atanh()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCoth;
impl PureFunction for FnCoth {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COTH"
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
                let sinh_val = n.sinh();
                if sinh_val == 0.0 {
                    CellValue::error_with_message(
                        CellError::Div0,
                        format!("COTH: sinh({n}) is 0 (division by zero)"),
                    )
                } else {
                    CellValue::number(n.cosh() / sinh_val)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnAcoth;
impl PureFunction for FnAcoth {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ACOTH"
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
            Ok(n) if (-1.0..=1.0).contains(&n) => CellValue::error_with_message(
                CellError::Num,
                format!("ACOTH: number must have |n| > 1, got {n}"),
            ),
            Ok(n) => {
                // ACOTH(x) = 0.5 * ln((x+1)/(x-1))
                CellValue::number(0.5 * ((n + 1.0) / (n - 1.0)).ln())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnSech;
impl PureFunction for FnSech {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SECH"
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
                let cosh_val = n.cosh();
                if cosh_val == 0.0 {
                    CellValue::error_with_message(
                        CellError::Div0,
                        format!("SECH: cosh({n}) is 0 (division by zero)"),
                    )
                } else {
                    CellValue::number(1.0 / cosh_val)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCsch;
impl PureFunction for FnCsch {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CSCH"
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
                let sinh_val = n.sinh();
                if sinh_val == 0.0 {
                    CellValue::error_with_message(
                        CellError::Div0,
                        format!("CSCH: sinh({n}) is 0 (division by zero)"),
                    )
                } else {
                    CellValue::number(1.0 / sinh_val)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnSinh));
    registry.register(Box::new(FnCosh));
    registry.register(Box::new(FnTanh));
    registry.register(Box::new(FnAsinh));
    registry.register(Box::new(FnAcosh));
    registry.register(Box::new(FnAtanh));
    registry.register(Box::new(FnCoth));
    registry.register(Box::new(FnAcoth));
    registry.register(Box::new(FnSech));
    registry.register(Box::new(FnCsch));
}
