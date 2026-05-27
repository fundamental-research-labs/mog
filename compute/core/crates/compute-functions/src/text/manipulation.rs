//! Manipulation functions: UPPER, LOWER, PROPER, TRIM, CLEAN, T

use value_types::CellValue;

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

/// Excel TRIM algorithm: removes leading/trailing ASCII space (0x20) only,
/// and collapses multiple ASCII spaces into one. Does NOT touch
/// tabs, newlines, or other Unicode whitespace.
fn excel_trim(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut prev_was_space = true; // treat start as "after space" to skip leading
    for ch in s.chars() {
        if ch == ' ' {
            if !prev_was_space {
                result.push(' ');
            }
            prev_was_space = true;
        } else {
            result.push(ch);
            prev_was_space = false;
        }
    }
    // Remove trailing space if any
    if result.ends_with(' ') {
        result.pop();
    }
    result
}

/// Apply UPPER to a single (non-array) value.
fn upper_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => CellValue::Text(s.to_uppercase().into()),
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnUpper;
impl PureFunction for FnUpper {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "UPPER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(upper_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => upper_single(&args[0]),
        }
    }
}

/// Apply LOWER to a single (non-array) value.
fn lower_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => CellValue::Text(s.to_lowercase().into()),
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnLower;
impl PureFunction for FnLower {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "LOWER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(lower_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => lower_single(&args[0]),
        }
    }
}

/// Apply PROPER to a single (non-array) value.
fn proper_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => {
            // Excel PROPER: capitalize first letter of each word.
            // Word boundary is any non-letter character.
            let mut result = String::with_capacity(s.len());
            let mut capitalize_next = true;
            for ch in s.chars() {
                if ch.is_alphabetic() {
                    if capitalize_next {
                        for upper in ch.to_uppercase() {
                            result.push(upper);
                        }
                    } else {
                        for lower in ch.to_lowercase() {
                            result.push(lower);
                        }
                    }
                    capitalize_next = false;
                } else {
                    result.push(ch);
                    capitalize_next = true;
                }
            }
            CellValue::Text(result.into())
        }
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnProper;
impl PureFunction for FnProper {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "PROPER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(proper_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => proper_single(&args[0]),
        }
    }
}

/// Apply TRIM to a single (non-array) value.
fn trim_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => CellValue::Text(excel_trim(&s).into()),
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnTrim;
impl PureFunction for FnTrim {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "TRIM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(trim_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => trim_single(&args[0]),
        }
    }
}

/// Apply CLEAN to a single (non-array) value.
fn clean_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => {
            // Excel CLEAN: removes non-printable characters (ASCII 0-31)
            let cleaned: String = s.chars().filter(|&c| c as u32 > 31).collect();
            CellValue::Text(cleaned.into())
        }
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnClean;
impl PureFunction for FnClean {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "CLEAN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(clean_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => clean_single(&args[0]),
        }
    }
}

pub(crate) struct FnT;
impl PureFunction for FnT {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "T"
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
        // T returns text if text, empty string otherwise
        match &args[0] {
            CellValue::Text(s) => CellValue::Text(s.clone()),
            _ => CellValue::Text(String::new().into()),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnUpper));
    registry.register(Box::new(FnLower));
    registry.register(Box::new(FnProper));
    registry.register(Box::new(FnTrim));
    registry.register(Box::new(FnClean));
    registry.register(Box::new(FnT));
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{bool_val, err, null, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    #[test]
    fn test_upper_lower() {
        assert_eq!(FnUpper.call(&[text("hello")]), text("HELLO"));
        assert_eq!(FnLower.call(&[text("HELLO")]), text("hello"));
    }

    #[test]
    fn test_trim() {
        let f = FnTrim;
        assert_eq!(f.call(&[text("  hello  world  ")]), text("hello world"));
    }

    #[test]
    fn test_proper() {
        let f = FnProper;
        assert_eq!(f.call(&[text("hello world")]), text("Hello World"));
        assert_eq!(f.call(&[text("HELLO WORLD")]), text("Hello World"));
        assert_eq!(f.call(&[text("hello-world")]), text("Hello-World"));
        assert_eq!(f.call(&[text("can't stop")]), text("Can'T Stop"));
        assert_eq!(f.call(&[text("")]), text(""));
        assert_eq!(f.call(&[num(123.0)]), text("123"));
    }

    #[test]
    fn test_clean() {
        let f = FnClean;
        // Remove control characters (ASCII 0-31)
        assert_eq!(f.call(&[text("hello\x00world")]), text("helloworld"));
        assert_eq!(f.call(&[text("abc\x01\x02def")]), text("abcdef"));
        assert_eq!(f.call(&[text("hello")]), text("hello"));
    }

    #[test]
    fn test_t() {
        let f = FnT;
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[num(42.0)]), text(""));
        assert_eq!(f.call(&[bool_val(true)]), text(""));
        assert_eq!(f.call(&[null()]), text(""));
    }

    #[test]
    fn test_t_error_propagation() {
        let f = FnT;
        assert_eq!(f.call(&[err(CellError::Na)]), err(CellError::Na));
    }

    #[test]
    fn test_trim_ascii_space_only() {
        let f = FnTrim;
        // Tab should be preserved (not treated as whitespace)
        assert_eq!(f.call(&[text("hello\tworld")]), text("hello\tworld"));
        // Newline should be preserved
        assert_eq!(f.call(&[text("hello\nworld")]), text("hello\nworld"));
        // Only ASCII spaces are trimmed and collapsed
        assert_eq!(f.call(&[text("  hello   world  ")]), text("hello world"));
        // Non-breaking space (U+00A0) should be preserved
        assert_eq!(
            f.call(&[text("hello\u{00A0}world")]),
            text("hello\u{00A0}world")
        );
    }

    #[test]
    fn test_lower_array_preserves_structure() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![text("ABC"), text("DEF"), text("GHI")]]);
        let result = reg.call("LOWER", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("abc"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("def"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("ghi"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_upper_array_preserves_structure() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![text("abc")], vec![text("def")]]);
        let result = reg.call("UPPER", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("ABC"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("DEF"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_trim_array() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![text("  hello  "), text(" world ")]]);
        let result = reg.call("TRIM", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("hello"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("world"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_proper_array() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![text("hello world"), text("foo bar")]]);
        let result = reg.call("PROPER", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("Hello World"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("Foo Bar"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    // ===================================================================
    // Comprehensive first-principles tests for text function submodules
    // ===================================================================

    // -------------------------------------------------------------------
    // byte_ops.rs — DBCS byte-length functions (aliases in SBCS locale)
    // -------------------------------------------------------------------
}
