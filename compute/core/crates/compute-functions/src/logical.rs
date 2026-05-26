//! Logical and Info functions: TRUE, FALSE, NA,
//! ISERROR, ISNA, ISBLANK, ISNUMBER, ISTEXT,
//! SWITCH, XOR, etc.

use value_types::{CellError, CellValue};

use crate::helpers::coercion::flatten_values;
use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// Tier 1 -- Core logical functions
// ---------------------------------------------------------------------------

pub struct FnTrue;
impl PureFunction for FnTrue {
    fn name(&self) -> &'static str {
        "TRUE"
    }
    fn min_args(&self) -> usize {
        0
    }
    fn max_args(&self) -> Option<usize> {
        Some(0)
    }
    fn call(&self, _args: &[CellValue]) -> CellValue {
        CellValue::Boolean(true)
    }
}

pub struct FnFalse;
impl PureFunction for FnFalse {
    fn name(&self) -> &'static str {
        "FALSE"
    }
    fn min_args(&self) -> usize {
        0
    }
    fn max_args(&self) -> Option<usize> {
        Some(0)
    }
    fn call(&self, _args: &[CellValue]) -> CellValue {
        CellValue::Boolean(false)
    }
}

pub struct FnNa;
impl PureFunction for FnNa {
    fn name(&self) -> &'static str {
        "NA"
    }
    fn min_args(&self) -> usize {
        0
    }
    fn max_args(&self) -> Option<usize> {
        Some(0)
    }
    fn call(&self, _args: &[CellValue]) -> CellValue {
        CellValue::Error(CellError::Na, None)
    }
}

// ---------------------------------------------------------------------------
// Info / IS functions
// ---------------------------------------------------------------------------

fn iserror_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(val.is_error())
}

pub struct FnIsError;
impl PureFunction for FnIsError {
    fn name(&self) -> &'static str {
        "ISERROR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(iserror_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => iserror_single(&args[0]),
        }
    }
}

fn isna_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(matches!(val, CellValue::Error(CellError::Na, _)))
}

pub struct FnIsNa;
impl PureFunction for FnIsNa {
    fn name(&self) -> &'static str {
        "ISNA"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(isna_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => isna_single(&args[0]),
        }
    }
}

fn isblank_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(val.is_null())
}

pub struct FnIsBlank;
impl PureFunction for FnIsBlank {
    fn name(&self) -> &'static str {
        "ISBLANK"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(isblank_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => isblank_single(&args[0]),
        }
    }
}

fn isnumber_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(val.is_number())
}

pub struct FnIsNumber;
impl PureFunction for FnIsNumber {
    fn name(&self) -> &'static str {
        "ISNUMBER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(isnumber_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => isnumber_single(&args[0]),
        }
    }
}

fn istext_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(matches!(val, CellValue::Text(_)))
}

pub struct FnIsText;
impl PureFunction for FnIsText {
    fn name(&self) -> &'static str {
        "ISTEXT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(istext_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => istext_single(&args[0]),
        }
    }
}

// ---------------------------------------------------------------------------
// Tier 2 -- Extended logical
// ---------------------------------------------------------------------------

pub struct FnSwitch;
impl PureFunction for FnSwitch {
    fn name(&self) -> &'static str {
        "SWITCH"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn is_scalar_arg(&self, index: usize) -> bool {
        index == 0
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let expr = &args[0];
        if let CellValue::Error(e, _) = expr {
            return CellValue::Error(*e, None);
        }
        let remaining = &args[1..];
        let pairs = remaining.len() / 2;
        let has_default = !remaining.len().is_multiple_of(2);

        for i in 0..pairs {
            let val = &remaining[i * 2];
            let result = &remaining[i * 2 + 1];
            if cell_values_equal(expr, val) {
                return result.clone();
            }
        }

        if has_default {
            remaining.last().cloned().unwrap_or_else(|| {
                CellValue::error_with_message(CellError::Na, "SWITCH: no matching value found")
            })
        } else {
            CellValue::error_with_message(
                CellError::Na,
                "SWITCH: no matching value and no default provided",
            )
        }
    }
}

pub struct FnXor;
impl PureFunction for FnXor {
    fn name(&self) -> &'static str {
        "XOR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        // First pass: propagate errors
        for v in &flat {
            if let CellValue::Error(e, _) = v {
                return CellValue::Error(*e, None);
            }
        }
        // Second pass: coerce to bool and count trues, skip text and null
        let mut true_count = 0usize;
        let mut found_valid = false;
        for v in &flat {
            match v {
                CellValue::Text(_) | CellValue::Null => continue,
                _ => {
                    found_valid = true;
                    match v.coerce_to_bool() {
                        Ok(true) => true_count += 1,
                        Ok(false) => {}
                        Err(e) => {
                            return CellValue::error_with_message(
                                e,
                                "XOR: could not convert argument to boolean",
                            );
                        }
                    }
                }
            }
        }
        if !found_valid {
            return CellValue::error_with_message(
                CellError::Value,
                "XOR: no valid boolean arguments provided",
            );
        }
        CellValue::Boolean(!true_count.is_multiple_of(2))
    }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

fn cell_values_equal(a: &CellValue, b: &CellValue) -> bool {
    match (a, b) {
        (CellValue::Number(x), CellValue::Number(y)) => (x.get() - y.get()).abs() < 1e-10,
        (CellValue::Text(x), CellValue::Text(y)) => x.eq_ignore_ascii_case(y),
        (CellValue::Boolean(x), CellValue::Boolean(y)) => x == y,
        (CellValue::Null, CellValue::Null) => true,
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTrue));
    registry.register(Box::new(FnFalse));
    registry.register(Box::new(FnNa));
    registry.register(Box::new(FnIsError));
    registry.register(Box::new(FnIsNa));
    registry.register(Box::new(FnIsBlank));
    registry.register(Box::new(FnIsNumber));
    registry.register(Box::new(FnIsText));
    registry.register(Box::new(FnSwitch));
    registry.register(Box::new(FnXor));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn bool_val(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }
    fn null() -> CellValue {
        CellValue::Null
    }

    #[test]
    fn test_true_false_na() {
        assert_eq!(FnTrue.call(&[]), bool_val(true));
        assert_eq!(FnFalse.call(&[]), bool_val(false));
        assert_eq!(FnNa.call(&[]), err(CellError::Na));
    }

    #[test]
    fn test_iserror() {
        assert_eq!(FnIsError.call(&[err(CellError::Div0)]), bool_val(true));
        assert_eq!(FnIsError.call(&[num(1.0)]), bool_val(false));
    }

    #[test]
    fn test_isblank() {
        assert_eq!(FnIsBlank.call(&[null()]), bool_val(true));
        assert_eq!(FnIsBlank.call(&[num(0.0)]), bool_val(false));
    }

    #[test]
    fn test_isnumber_istext() {
        assert_eq!(FnIsNumber.call(&[num(1.0)]), bool_val(true));
        assert_eq!(FnIsNumber.call(&[text("1")]), bool_val(false));
        assert_eq!(FnIsText.call(&[text("hello")]), bool_val(true));
        assert_eq!(FnIsText.call(&[num(1.0)]), bool_val(false));
    }

    #[test]
    fn test_switch() {
        assert_eq!(
            FnSwitch.call(&[
                num(2.0),
                num(1.0),
                text("one"),
                num(2.0),
                text("two"),
                text("default")
            ]),
            text("two")
        );
        assert_eq!(
            FnSwitch.call(&[
                num(3.0),
                num(1.0),
                text("one"),
                num(2.0),
                text("two"),
                text("default")
            ]),
            text("default")
        );
    }

    #[test]
    fn test_switch_matching_value() {
        // SWITCH(2, 1, "one", 2, "two", 3, "three") => "two"
        assert_eq!(
            FnSwitch.call(&[
                num(2.0),
                num(1.0),
                text("one"),
                num(2.0),
                text("two"),
                num(3.0),
                text("three")
            ],),
            text("two")
        );
    }

    #[test]
    fn test_switch_default_value() {
        // SWITCH(4, 1, "one", 2, "two", "default") => "default"
        assert_eq!(
            FnSwitch.call(&[
                num(4.0),
                num(1.0),
                text("one"),
                num(2.0),
                text("two"),
                text("default")
            ],),
            text("default")
        );
    }

    #[test]
    fn test_switch_no_match_no_default_returns_na() {
        // SWITCH(4, 1, "one", 2, "two") => #N/A (no default, even number of remaining args)
        assert_eq!(
            FnSwitch.call(&[num(4.0), num(1.0), text("one"), num(2.0), text("two")],),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_xor() {
        assert_eq!(
            FnXor.call(&[bool_val(true), bool_val(false)]),
            bool_val(true)
        );
        assert_eq!(
            FnXor.call(&[bool_val(true), bool_val(true)]),
            bool_val(false)
        );
        assert_eq!(
            FnXor.call(&[bool_val(false), bool_val(false)]),
            bool_val(false)
        );
    }

    #[test]
    fn test_xor_error_precedence() {
        // Error should propagate even if text comes first
        assert_eq!(
            FnXor.call(&[text("hello"), err(CellError::Na)]),
            err(CellError::Na)
        );
    }

    // --- Bulk IS* function array tests ---

    #[test]
    fn test_isnumber_array() {
        let arr = CellValue::from_rows(vec![vec![num(1.0), text("hello"), num(3.0)]]);
        let result = FnIsNumber.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(0, 2).unwrap(), bool_val(true));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_istext_array() {
        let arr = CellValue::from_rows(vec![vec![text("a"), num(1.0), text("b")]]);
        let result = FnIsText.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(0, 2).unwrap(), bool_val(true));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_isblank_array() {
        let arr = CellValue::from_rows(vec![vec![null(), num(1.0), null()]]);
        let result = FnIsBlank.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(0, 2).unwrap(), bool_val(true));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_iserror_array() {
        let arr = CellValue::from_rows(vec![vec![
            err(CellError::Div0),
            num(1.0),
            err(CellError::Na),
        ]]);
        let result = FnIsError.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(0, 2).unwrap(), bool_val(true));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_isna_array() {
        let arr = CellValue::from_rows(vec![vec![
            err(CellError::Na),
            err(CellError::Div0),
            num(1.0),
        ]]);
        let result = FnIsNa.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(0, 2).unwrap(), bool_val(false));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_isnumber_array_2d() {
        let arr = CellValue::from_rows(vec![vec![num(1.0), text("x")], vec![text("y"), num(2.0)]]);
        let result = FnIsNumber.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                assert_eq!(rows.rows(), 2);
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(1, 0).unwrap(), bool_val(false));
                assert_eq!(*rows.get(1, 1).unwrap(), bool_val(true));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }
}
