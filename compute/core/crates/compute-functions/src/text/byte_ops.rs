//! Byte operations (DBCS/SBCS aware): LEFTB, RIGHTB, MIDB, LENB, FINDB,
//! SEARCHB, REPLACEB
//!
//! In SBCS systems these behave identically to their non-B counterparts.
//! For simplicity, implemented as aliases (correct for non-DBCS locales).

use value_types::CellValue;

use super::extraction::{FnLeft, FnLen, FnMid, FnRight};
use super::search::{FnFind, FnReplace, FnSearch};
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnLeftB;
impl PureFunction for FnLeftB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LEFTB"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnLeft.call(args)
    }
}

pub(crate) struct FnRightB;
impl PureFunction for FnRightB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "RIGHTB"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnRight.call(args)
    }
}

pub(crate) struct FnMidB;
impl PureFunction for FnMidB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "MIDB"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnMid.call(args)
    }
}

pub(crate) struct FnLenB;
impl PureFunction for FnLenB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LENB"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnLen.call(args)
    }
}

pub(crate) struct FnFindB;
impl PureFunction for FnFindB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FINDB"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnFind.call(args)
    }
}

pub(crate) struct FnSearchB;
impl PureFunction for FnSearchB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SEARCHB"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnSearch.call(args)
    }
}

pub(crate) struct FnReplaceB;
impl PureFunction for FnReplaceB {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "REPLACEB"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnReplace.call(args)
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnLeftB));
    registry.register(Box::new(FnRightB));
    registry.register(Box::new(FnMidB));
    registry.register(Box::new(FnLenB));
    registry.register(Box::new(FnFindB));
    registry.register(Box::new(FnSearchB));
    registry.register(Box::new(FnReplaceB));
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{bool_val, err, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::CellError;

    #[test]
    fn test_byte_aliases() {
        // LEFTB = LEFT in SBCS
        assert_eq!(FnLeftB.call(&[text("hello"), num(3.0)]), text("hel"));
        // RIGHTB = RIGHT in SBCS
        assert_eq!(FnRightB.call(&[text("hello"), num(3.0)]), text("llo"));
        // MIDB = MID in SBCS
        assert_eq!(
            FnMidB.call(&[text("hello"), num(2.0), num(3.0)]),
            text("ell")
        );
        // LENB = LEN in SBCS
        assert_eq!(FnLenB.call(&[text("hello")]), num(5.0));
        // FINDB = FIND in SBCS
        assert_eq!(FnFindB.call(&[text("ll"), text("hello")]), num(3.0));
        // SEARCHB = SEARCH in SBCS
        assert_eq!(FnSearchB.call(&[text("LL"), text("hello")]), num(3.0));
        // REPLACEB = REPLACE in SBCS
        assert_eq!(
            FnReplaceB.call(&[text("hello"), num(2.0), num(3.0), text("a")]),
            text("hao")
        );
    }

    #[test]
    fn test_lenb_ascii() {
        // LENB("hello") = 5 in SBCS locale
        assert_eq!(FnLenB.call(&[text("hello")]), num(5.0));
    }

    #[test]
    fn test_lenb_empty() {
        assert_eq!(FnLenB.call(&[text("")]), num(0.0));
    }

    #[test]
    fn test_lenb_number_coercion() {
        // Numbers coerced to string: 123 -> "123" -> len 3
        assert_eq!(FnLenB.call(&[num(123.0)]), num(3.0));
    }

    #[test]
    fn test_lenb_boolean_coercion() {
        assert_eq!(FnLenB.call(&[bool_val(true)]), num(4.0)); // "TRUE"
        assert_eq!(FnLenB.call(&[bool_val(false)]), num(5.0)); // "FALSE"
    }

    #[test]
    fn test_lenb_error_propagation() {
        assert_eq!(FnLenB.call(&[err(CellError::Ref)]), err(CellError::Ref));
    }

    #[test]
    fn test_leftb_default_one_char() {
        // LEFTB with no num_bytes defaults to 1
        assert_eq!(FnLeftB.call(&[text("hello")]), text("h"));
    }

    #[test]
    fn test_leftb_specific_count() {
        assert_eq!(FnLeftB.call(&[text("hello"), num(3.0)]), text("hel"));
    }

    #[test]
    fn test_leftb_exceeds_length() {
        assert_eq!(FnLeftB.call(&[text("hi"), num(10.0)]), text("hi"));
    }

    #[test]
    fn test_leftb_zero() {
        assert_eq!(FnLeftB.call(&[text("hello"), num(0.0)]), text(""));
    }

    #[test]
    fn test_leftb_negative_error() {
        assert_eq!(
            FnLeftB.call(&[text("hello"), num(-1.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_rightb_default_one_char() {
        assert_eq!(FnRightB.call(&[text("hello")]), text("o"));
    }

    #[test]
    fn test_rightb_specific_count() {
        assert_eq!(FnRightB.call(&[text("hello"), num(3.0)]), text("llo"));
    }

    #[test]
    fn test_rightb_exceeds_length() {
        assert_eq!(FnRightB.call(&[text("hi"), num(10.0)]), text("hi"));
    }

    #[test]
    fn test_rightb_negative_error() {
        assert_eq!(
            FnRightB.call(&[text("hello"), num(-1.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_midb_basic() {
        // MIDB("hello", 2, 3) = "ell" (1-indexed)
        assert_eq!(
            FnMidB.call(&[text("hello"), num(2.0), num(3.0)]),
            text("ell")
        );
    }

    #[test]
    fn test_midb_start_at_one() {
        assert_eq!(
            FnMidB.call(&[text("hello"), num(1.0), num(5.0)]),
            text("hello")
        );
    }

    #[test]
    fn test_midb_start_zero_error() {
        assert_eq!(
            FnMidB.call(&[text("hello"), num(0.0), num(3.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_midb_num_chars_exceeds() {
        assert_eq!(
            FnMidB.call(&[text("hello"), num(3.0), num(100.0)]),
            text("llo")
        );
    }

    #[test]
    fn test_findb_basic() {
        // FINDB("b", "abc") = 2 (case-sensitive, 1-indexed)
        assert_eq!(FnFindB.call(&[text("b"), text("abc")]), num(2.0));
    }

    #[test]
    fn test_findb_case_sensitive() {
        // FINDB("B", "abc") = #VALUE! (case-sensitive)
        assert_eq!(
            FnFindB.call(&[text("B"), text("abc")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_findb_with_start_pos() {
        // FINDB("l", "hello world", 5) = 5 (start searching from position 5)
        assert_eq!(
            FnFindB.call(&[text("o"), text("hello world"), num(5.0)]),
            num(5.0)
        );
    }

    #[test]
    fn test_findb_start_less_than_one() {
        assert_eq!(
            FnFindB.call(&[text("a"), text("abc"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_searchb_case_insensitive() {
        // SEARCHB("B", "abc") = 2 (case-insensitive)
        assert_eq!(FnSearchB.call(&[text("B"), text("abc")]), num(2.0));
    }

    #[test]
    fn test_searchb_with_start_pos() {
        assert_eq!(
            FnSearchB.call(&[text("o"), text("hello world"), num(6.0)]),
            num(8.0)
        );
    }

    #[test]
    fn test_replaceb_basic() {
        // REPLACEB("abcdef", 3, 2, "XY") = "abXYef"
        assert_eq!(
            FnReplaceB.call(&[text("abcdef"), num(3.0), num(2.0), text("XY")]),
            text("abXYef")
        );
    }

    #[test]
    fn test_replaceb_at_start() {
        assert_eq!(
            FnReplaceB.call(&[text("abcdef"), num(1.0), num(2.0), text("ZZ")]),
            text("ZZcdef")
        );
    }

    #[test]
    fn test_replaceb_error_propagation() {
        assert_eq!(
            FnReplaceB.call(&[err(CellError::Na), num(1.0), num(2.0), text("X")]),
            err(CellError::Na)
        );
    }

    // -------------------------------------------------------------------
    // cjk.rs — ASC, DBCS, JIS, PHONETIC
    // -------------------------------------------------------------------
}
