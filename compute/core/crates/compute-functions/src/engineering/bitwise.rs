//! Bitwise operations: BITAND, BITOR, BITXOR, BITLSHIFT, BITRSHIFT
//! Comparison functions: DELTA, GESTEP

use value_types::{CellError, CellValue};

use super::helpers::coerce_num;
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// Bitwise Operations (5)
// ===========================================================================

/// Maximum value for 48-bit unsigned: 2^48 - 1
const BIT_MAX: f64 = 281474976710655.0;

pub(super) struct FnBitAnd;
impl PureFunction for FnBitAnd {
    fn name(&self) -> &'static str {
        "BITAND"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let a = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let b = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if a < 0.0 || b < 0.0 || a > BIT_MAX || b > BIT_MAX {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BITAND: arguments must be non-negative integers <= 2^48-1, got {a} and {b}"
                ),
            );
        }
        if (a - a.trunc()).abs() > 1e-10 || (b - b.trunc()).abs() > 1e-10 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITAND: arguments must be integers, got {a} and {b}"),
            );
        }
        let ai = a as u64;
        let bi = b as u64;
        CellValue::number((ai & bi) as f64)
    }
}

pub(super) struct FnBitOr;
impl PureFunction for FnBitOr {
    fn name(&self) -> &'static str {
        "BITOR"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let a = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let b = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if a < 0.0 || b < 0.0 || a > BIT_MAX || b > BIT_MAX {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BITOR: arguments must be non-negative integers <= 2^48-1, got {a} and {b}"
                ),
            );
        }
        if (a - a.trunc()).abs() > 1e-10 || (b - b.trunc()).abs() > 1e-10 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITOR: arguments must be integers, got {a} and {b}"),
            );
        }
        let ai = a as u64;
        let bi = b as u64;
        CellValue::number((ai | bi) as f64)
    }
}

pub(super) struct FnBitXor;
impl PureFunction for FnBitXor {
    fn name(&self) -> &'static str {
        "BITXOR"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let a = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let b = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if a < 0.0 || b < 0.0 || a > BIT_MAX || b > BIT_MAX {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "BITXOR: arguments must be non-negative integers <= 2^48-1, got {a} and {b}"
                ),
            );
        }
        if (a - a.trunc()).abs() > 1e-10 || (b - b.trunc()).abs() > 1e-10 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITXOR: arguments must be integers, got {a} and {b}"),
            );
        }
        let ai = a as u64;
        let bi = b as u64;
        CellValue::number((ai ^ bi) as f64)
    }
}

pub(super) struct FnBitLShift;
impl PureFunction for FnBitLShift {
    fn name(&self) -> &'static str {
        "BITLSHIFT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let num = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let shift = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if !(0.0..=BIT_MAX).contains(&num) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITLSHIFT: number must be a non-negative integer <= 2^48-1, got {num}"),
            );
        }
        if (num - num.trunc()).abs() > 1e-10 || (shift - shift.trunc()).abs() > 1e-10 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITLSHIFT: arguments must be integers, got {num} and {shift}"),
            );
        }
        let shift_i = shift as i64;
        if !(-53..=53).contains(&shift_i) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITLSHIFT: shift_amount must be between -53 and 53, got {shift_i}"),
            );
        }
        let result = if shift_i >= 0 {
            num * 2.0_f64.powi(shift_i as i32)
        } else {
            (num / 2.0_f64.powi((-shift_i) as i32)).floor()
        };
        if !(0.0..=BIT_MAX).contains(&result) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITLSHIFT: result {result} exceeds 48-bit range"),
            );
        }
        CellValue::number(result)
    }
}

pub(super) struct FnBitRShift;
impl PureFunction for FnBitRShift {
    fn name(&self) -> &'static str {
        "BITRSHIFT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let num = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let shift = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if !(0.0..=BIT_MAX).contains(&num) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITRSHIFT: number must be a non-negative integer <= 2^48-1, got {num}"),
            );
        }
        if (num - num.trunc()).abs() > 1e-10 || (shift - shift.trunc()).abs() > 1e-10 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITRSHIFT: arguments must be integers, got {num} and {shift}"),
            );
        }
        let shift_i = shift as i64;
        if !(-53..=53).contains(&shift_i) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITRSHIFT: shift_amount must be between -53 and 53, got {shift_i}"),
            );
        }
        let result = if shift_i >= 0 {
            (num / 2.0_f64.powi(shift_i as i32)).floor()
        } else {
            num * 2.0_f64.powi((-shift_i) as i32)
        };
        if !(0.0..=BIT_MAX).contains(&result) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BITRSHIFT: result {result} exceeds 48-bit range"),
            );
        }
        CellValue::number(result)
    }
}

// ===========================================================================
// Comparison Functions (2)
// ===========================================================================

pub(super) struct FnDelta;
impl PureFunction for FnDelta {
    fn name(&self) -> &'static str {
        "DELTA"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let a = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let b = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => v,
                Err(e) => return e,
            }
        } else {
            0.0
        };
        CellValue::number(if a == b { 1.0 } else { 0.0 })
    }
}

pub(super) struct FnGeStep;
impl PureFunction for FnGeStep {
    fn name(&self) -> &'static str {
        "GESTEP"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let num = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let step = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => v,
                Err(e) => return e,
            }
        } else {
            0.0
        };
        CellValue::number(if num >= step { 1.0 } else { 0.0 })
    }
}

// ===========================================================================
// Registration
// ===========================================================================

pub(crate) fn register(registry: &mut FunctionRegistry) {
    // Bitwise Operations (5)
    registry.register(Box::new(FnBitAnd));
    registry.register(Box::new(FnBitOr));
    registry.register(Box::new(FnBitXor));
    registry.register(Box::new(FnBitLShift));
    registry.register(Box::new(FnBitRShift));

    // Comparison (2)
    registry.register(Box::new(FnDelta));
    registry.register(Box::new(FnGeStep));
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    #[test]
    fn test_bitand() {
        let f = FnBitAnd;
        assert_eq!(f.call(&[num(13.0), num(25.0)]), num(9.0));
    }

    #[test]
    fn test_bitor() {
        let f = FnBitOr;
        assert_eq!(f.call(&[num(23.0), num(10.0)]), num(31.0));
    }

    #[test]
    fn test_bitxor() {
        let f = FnBitXor;
        assert_eq!(f.call(&[num(5.0), num(3.0)]), num(6.0));
    }

    #[test]
    fn test_bitlshift() {
        let f = FnBitLShift;
        assert_eq!(f.call(&[num(4.0), num(2.0)]), num(16.0));
    }

    #[test]
    fn test_bitrshift() {
        let f = FnBitRShift;
        assert_eq!(f.call(&[num(13.0), num(2.0)]), num(3.0));
    }

    #[test]
    fn test_delta() {
        let f = FnDelta;
        assert_eq!(f.call(&[num(5.0), num(5.0)]), num(1.0));
        assert_eq!(f.call(&[num(5.0), num(4.0)]), num(0.0));
        assert_eq!(f.call(&[num(0.0)]), num(1.0));
    }

    #[test]
    fn test_gestep() {
        let f = FnGeStep;
        assert_eq!(f.call(&[num(5.0), num(4.0)]), num(1.0));
        assert_eq!(f.call(&[num(3.0), num(4.0)]), num(0.0));
        assert_eq!(f.call(&[num(0.0)]), num(1.0));
    }
}
