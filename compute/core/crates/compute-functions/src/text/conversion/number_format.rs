use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnDollar;
impl PureFunction for FnDollar {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DOLLAR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let number = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let decimals = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(d) => d as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            2
        };

        CellValue::Text(compute_formats::format_dollar(number, decimals).into())
    }
}

pub(super) struct FnFixed;
impl PureFunction for FnFixed {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FIXED"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let number = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let decimals = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(d) => d as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            2
        };
        let no_commas = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false
        };

        CellValue::Text(compute_formats::format_fixed(number, decimals, no_commas).into())
    }
}

pub(super) struct FnNumberValue;
impl PureFunction for FnNumberValue {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "NUMBERVALUE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let decimal_sep = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_string() {
                Ok(s) => s.into_owned(),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            ".".to_string()
        };
        let group_sep = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_string() {
                Ok(s) => s.into_owned(),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            ",".to_string()
        };

        let trimmed = text.trim();
        if trimmed.is_empty() {
            return CellValue::number(0.0);
        }

        let mut cleaned = trimmed.to_string();

        let is_percent = cleaned.ends_with('%');
        if is_percent {
            cleaned = cleaned[..cleaned.len() - 1].trim().to_string();
        }

        if !group_sep.is_empty() {
            cleaned = cleaned.replace(&group_sep, "");
        }

        if !decimal_sep.is_empty() && decimal_sep != "." {
            cleaned = cleaned.replace(&decimal_sep, ".");
        }

        cleaned = cleaned.replace(['$', '\u{20AC}', '\u{00A3}', '\u{00A5}', ' '], "");

        match fast_float::parse::<f64, _>(cleaned.trim()) {
            Ok(n) => {
                if is_percent {
                    CellValue::number(n / 100.0)
                } else {
                    CellValue::number(n)
                }
            }
            Err(_) => CellValue::error_with_message(
                CellError::Value,
                format!("NUMBERVALUE: cannot convert '{trimmed}' to a number"),
            ),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDollar));
    registry.register(Box::new(FnFixed));
    registry.register(Box::new(FnNumberValue));
}
