//! Unicode functions: UNICHAR, UNICODE

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnUnichar;
impl PureFunction for FnUnichar {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "UNICHAR"
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
                let code = n as u32;
                // Valid Unicode range: 1 to 1,114,111 (0x10FFFF)
                // Exclude surrogate pair range: 0xD800 to 0xDFFF
                if !(1..=0x10FFFF).contains(&code) {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("UNICHAR: code {code} out of range, must be 1-1114111"),
                    );
                }
                if (0xD800..=0xDFFF).contains(&code) {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("UNICHAR: code {code} is in surrogate pair range (U+D800-U+DFFF)"),
                    );
                }
                match char::from_u32(code) {
                    Some(c) => CellValue::Text(c.to_string().into()),
                    None => CellValue::error_with_message(
                        CellError::Value,
                        format!("UNICHAR: code {code} is not a valid Unicode character"),
                    ),
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnUnicode;
impl PureFunction for FnUnicode {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "UNICODE"
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
            Ok(s) if s.is_empty() => {
                CellValue::error_with_message(CellError::Value, "UNICODE: text must not be empty")
            }
            Ok(s) => {
                let c = match s.chars().next() {
                    Some(c) => c,
                    None => return CellValue::Error(CellError::Value, None),
                };
                CellValue::number(c as u32 as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnUnichar));
    registry.register(Box::new(FnUnicode));
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{err, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::CellError;

    #[test]
    fn test_unichar() {
        let f = FnUnichar;
        assert_eq!(f.call(&[num(65.0)]), text("A"));
        assert_eq!(f.call(&[num(8364.0)]), text("\u{20AC}")); // Euro sign
        assert_eq!(f.call(&[num(0.0)]), err(CellError::Value));
        assert_eq!(f.call(&[num(1114112.0)]), err(CellError::Value)); // above max
    }

    #[test]
    fn test_unicode() {
        let f = FnUnicode;
        assert_eq!(f.call(&[text("A")]), num(65.0));
        assert_eq!(f.call(&[text("\u{20AC}")]), num(8364.0)); // Euro sign
        assert_eq!(f.call(&[text("")]), err(CellError::Value));
    }
}
