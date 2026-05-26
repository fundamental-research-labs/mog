//! CJK functions: ASC, DBCS, JIS, PHONETIC

use value_types::CellValue;

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnAsc;
impl PureFunction for FnAsc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ASC"
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
            Ok(s) => {
                // Convert full-width (double-byte) characters to half-width (single-byte)
                let mut result = String::with_capacity(s.len());
                for ch in s.chars() {
                    let code = ch as u32;
                    if (0xFF01..=0xFF5E).contains(&code) {
                        // Full-width ASCII variants -> half-width
                        result.push(char::from_u32(code - 0xFEE0).unwrap_or(ch));
                    } else if code == 0x3000 {
                        // Full-width space -> half-width space
                        result.push(' ');
                    } else {
                        result.push(ch);
                    }
                }
                CellValue::Text(result.into())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnDbcs;
impl PureFunction for FnDbcs {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DBCS"
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
            Ok(s) => {
                // Convert half-width (single-byte) characters to full-width (double-byte)
                let mut result = String::with_capacity(s.len());
                for ch in s.chars() {
                    let code = ch as u32;
                    if (0x0021..=0x007E).contains(&code) {
                        // Half-width ASCII -> full-width
                        result.push(char::from_u32(code + 0xFEE0).unwrap_or(ch));
                    } else if code == 0x0020 {
                        // Half-width space -> full-width space
                        result.push('\u{3000}');
                    } else {
                        result.push(ch);
                    }
                }
                CellValue::Text(result.into())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnJis;
impl PureFunction for FnJis {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "JIS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // JIS is functionally identical to DBCS
        FnDbcs.call(args)
    }
}

pub(crate) struct FnPhonetic;
impl PureFunction for FnPhonetic {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PHONETIC"
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
        // PHONETIC returns the phonetic (furigana) string.
        // Not applicable outside Japanese — return the input text as-is.
        match args[0].coerce_to_string() {
            Ok(s) => CellValue::Text(s.into_owned().into()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnAsc));
    registry.register(Box::new(FnDbcs));
    registry.register(Box::new(FnJis));
    registry.register(Box::new(FnPhonetic));
}
