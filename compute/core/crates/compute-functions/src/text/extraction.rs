//! Extraction functions: LEN, LEFT, RIGHT, MID

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnLen;
impl PureFunction for FnLen {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LEN"
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
        match args[0].coerce_to_string() {
            Ok(s) => CellValue::number(s.chars().count() as f64),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnLeft;
impl PureFunction for FnLeft {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LEFT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(1.0)), // num_chars defaults to 1
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let n = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(x) if x < 0.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("LEFT: num_chars must be >= 0, got {x}"),
                    );
                }
                Ok(x) => x as usize,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        match args[0].coerce_to_string() {
            Ok(s) => {
                let result: String = s.chars().take(n).collect();
                CellValue::Text(result.into())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnRight;
impl PureFunction for FnRight {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "RIGHT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(1.0)), // num_chars defaults to 1
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let n = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(x) if x < 0.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("RIGHT: num_chars must be >= 0, got {x}"),
                    );
                }
                Ok(x) => x as usize,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        match args[0].coerce_to_string() {
            Ok(s) => {
                let chars: Vec<char> = s.chars().collect();
                let start = chars.len().saturating_sub(n);
                let result: String = chars[start..].iter().collect();
                CellValue::Text(result.into())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnMid;
impl PureFunction for FnMid {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "MID"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        if let Some(e) = check_error(&args[2]) {
            return e;
        }
        // Compute start and len from args[1] and args[2] (shared across all elements)
        let start = match args[1].coerce_to_number() {
            Ok(x) if x < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("MID: start_num must be >= 1, got {x}"),
                );
            }
            Ok(x) => (x as usize).saturating_sub(1), // 1-based
            Err(e) => return CellValue::Error(e, None),
        };
        let len = match args[2].coerce_to_number() {
            Ok(x) if x < 0.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("MID: num_chars must be >= 0, got {x}"),
                );
            }
            Ok(x) => x as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        let s = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let chars: Vec<char> = s.chars().collect();
        let end = (start + len).min(chars.len());
        let start = start.min(chars.len());
        let result: String = chars[start..end].iter().collect();
        CellValue::Text(result.into())
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnLen));
    registry.register(Box::new(FnLeft));
    registry.register(Box::new(FnRight));
    registry.register(Box::new(FnMid));
}
