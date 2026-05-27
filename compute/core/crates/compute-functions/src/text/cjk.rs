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

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{err, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::CellError;

    #[test]
    fn test_asc() {
        let f = FnAsc;
        // Full-width 'A' (U+FF21) -> half-width 'A' (U+0041)
        assert_eq!(f.call(&[text("\u{FF21}")]), text("A"));
        // Full-width space -> half-width space
        assert_eq!(f.call(&[text("\u{3000}")]), text(" "));
        // Already half-width — no change
        assert_eq!(f.call(&[text("ABC")]), text("ABC"));
    }

    #[test]
    fn test_dbcs() {
        let f = FnDbcs;
        // Half-width 'A' (U+0041) -> full-width 'A' (U+FF21)
        assert_eq!(f.call(&[text("A")]), text("\u{FF21}"));
        // Half-width space -> full-width space
        assert_eq!(f.call(&[text(" ")]), text("\u{3000}"));
    }

    #[test]
    fn test_jis_same_as_dbcs() {
        assert_eq!(FnJis.call(&[text("A")]), FnDbcs.call(&[text("A")]));
    }

    #[test]
    fn test_phonetic_passthrough() {
        let f = FnPhonetic;
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[num(123.0)]), text("123"));
    }

    #[test]
    fn test_asc_full_range() {
        // Full-width digits -> half-width
        assert_eq!(FnAsc.call(&[text("\u{FF10}\u{FF11}\u{FF19}")]), text("019"));
        // Full-width lowercase -> half-width
        assert_eq!(FnAsc.call(&[text("\u{FF41}")]), text("a"));
        // Full-width punctuation
        assert_eq!(FnAsc.call(&[text("\u{FF01}")]), text("!"));
    }

    #[test]
    fn test_asc_empty_string() {
        assert_eq!(FnAsc.call(&[text("")]), text(""));
    }

    #[test]
    fn test_asc_non_convertible_passthrough() {
        // CJK ideographs should pass through unchanged
        assert_eq!(FnAsc.call(&[text("\u{4E16}")]), text("\u{4E16}")); // "world" kanji
    }

    #[test]
    fn test_asc_mixed_content() {
        // Mix of full-width and half-width
        assert_eq!(
            FnAsc.call(&[text("hello\u{FF21}world")]),
            text("helloAworld")
        );
    }

    #[test]
    fn test_asc_error_propagation() {
        assert_eq!(FnAsc.call(&[err(CellError::Div0)]), err(CellError::Div0));
    }

    #[test]
    fn test_dbcs_full_range() {
        // Half-width digits -> full-width
        assert_eq!(FnDbcs.call(&[text("0")]), text("\u{FF10}"));
        assert_eq!(FnDbcs.call(&[text("9")]), text("\u{FF19}"));
        // Half-width lowercase -> full-width
        assert_eq!(FnDbcs.call(&[text("a")]), text("\u{FF41}"));
        // Punctuation
        assert_eq!(FnDbcs.call(&[text("!")]), text("\u{FF01}"));
    }

    #[test]
    fn test_dbcs_empty_string() {
        assert_eq!(FnDbcs.call(&[text("")]), text(""));
    }

    #[test]
    fn test_dbcs_non_convertible_passthrough() {
        // Characters outside 0x0020-0x007E pass through
        assert_eq!(FnDbcs.call(&[text("\u{4E16}")]), text("\u{4E16}"));
    }

    #[test]
    fn test_dbcs_space_to_fullwidth() {
        // Half-width space (0x20) -> full-width space (0x3000)
        assert_eq!(
            FnDbcs.call(&[text("A B")]),
            text("\u{FF21}\u{3000}\u{FF22}")
        );
    }

    #[test]
    fn test_dbcs_roundtrip_with_asc() {
        // DBCS then ASC should be identity for ASCII
        let original = text("Hello World! 123");
        let full_width = FnDbcs.call(std::slice::from_ref(&original));
        let back = FnAsc.call(&[full_width]);
        assert_eq!(back, original);
    }

    #[test]
    fn test_jis_identical_to_dbcs() {
        // JIS is functionally identical to DBCS
        assert_eq!(FnJis.call(&[text("Hello")]), FnDbcs.call(&[text("Hello")]));
        assert_eq!(FnJis.call(&[text("123")]), FnDbcs.call(&[text("123")]));
        assert_eq!(FnJis.call(&[text(" ")]), FnDbcs.call(&[text(" ")]));
    }

    #[test]
    fn test_phonetic_returns_text_unchanged() {
        assert_eq!(FnPhonetic.call(&[text("Tokyo")]), text("Tokyo"));
        assert_eq!(FnPhonetic.call(&[text("")]), text(""));
    }

    #[test]
    fn test_phonetic_number_coercion() {
        assert_eq!(FnPhonetic.call(&[num(42.0)]), text("42"));
    }

    #[test]
    fn test_phonetic_error_propagation() {
        assert_eq!(
            FnPhonetic.call(&[err(CellError::Value)]),
            err(CellError::Value)
        );
    }

    // -------------------------------------------------------------------
    // modern.rs — TEXTBEFORE, TEXTAFTER, TEXTSPLIT
    // -------------------------------------------------------------------
}
