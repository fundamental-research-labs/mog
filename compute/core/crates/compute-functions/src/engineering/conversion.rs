//! Base conversion functions: BIN2DEC, BIN2HEX, BIN2OCT, DEC2BIN, DEC2HEX, DEC2OCT,
//! HEX2BIN, HEX2DEC, HEX2OCT, OCT2BIN, OCT2DEC, OCT2HEX

use value_types::{CellError, CellValue};

use super::helpers::{coerce_num, coerce_str};
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// Base Conversion Helpers
// ===========================================================================

/// Parse a binary string (max 10 chars, two's complement) to i64.
fn bin_to_decimal(s: &str) -> Option<i64> {
    if s.is_empty() || s.len() > 10 {
        return None;
    }
    for c in s.chars() {
        if c != '0' && c != '1' {
            return None;
        }
    }
    let val = i64::from_str_radix(s, 2).ok()?;
    // Two's complement: if 10 bits and leading bit is 1, it's negative
    if s.len() == 10 && s.starts_with('1') {
        Some(val - (1i64 << 10))
    } else {
        Some(val)
    }
}

/// Parse an octal string (max 10 chars, two's complement 30-bit) to i64.
fn oct_to_decimal(s: &str) -> Option<i64> {
    if s.is_empty() || s.len() > 10 {
        return None;
    }
    for c in s.chars() {
        if !('0'..='7').contains(&c) {
            return None;
        }
    }
    let val = i64::from_str_radix(s, 8).ok()?;
    // Two's complement at 30 bits
    if val >= (1i64 << 29) {
        Some(val - (1i64 << 30))
    } else {
        Some(val)
    }
}

/// Parse a hex string (max 10 chars, two's complement 40-bit) to i64.
fn hex_to_decimal(s: &str) -> Option<i64> {
    if s.is_empty() || s.len() > 10 {
        return None;
    }
    let upper = s.to_uppercase();
    for c in upper.chars() {
        if !c.is_ascii_hexdigit() {
            return None;
        }
    }
    let val = i64::from_str_radix(&upper, 16).ok()?;
    // Two's complement at 40 bits
    if val >= (1i64 << 39) {
        Some(val - (1i64 << 40))
    } else {
        Some(val)
    }
}

/// Convert a decimal to two's complement binary string.
/// For non-negative: minimal length (at least 1 digit).
/// For negative: always 10 bits.
fn decimal_to_bin(val: i64) -> String {
    if val >= 0 {
        format!("{:b}", val)
    } else {
        // 10-bit two's complement
        let tc = ((1i64 << 10) + val) as u64;
        format!("{:010b}", tc)
    }
}

/// Convert a decimal to octal string.
/// For non-negative: minimal length.
/// For negative: 10-digit two's complement (30-bit).
fn decimal_to_oct(val: i64) -> String {
    if val >= 0 {
        format!("{:o}", val)
    } else {
        let tc = ((1i64 << 30) + val) as u64;
        format!("{:010o}", tc)
    }
}

/// Convert a decimal to hex string (uppercase).
/// For non-negative: minimal length.
/// For negative: 10-digit two's complement (40-bit).
fn decimal_to_hex(val: i64) -> String {
    if val >= 0 {
        format!("{:X}", val)
    } else {
        let tc = ((1i64 << 40) + val) as u64;
        format!("{:010X}", tc)
    }
}

/// Format output with optional `places` padding. Returns CellValue.
/// When `is_negative` is true, Excel ignores the `places` parameter and
/// always returns the full-width two's complement representation.
fn format_with_places(value: &str, places: Option<i64>, is_negative: bool) -> CellValue {
    if is_negative {
        // Excel ignores `places` for negative numbers — always return full-width
        return CellValue::Text(value.to_string().into());
    }
    match places {
        Some(p) => {
            if !(0..=10).contains(&p) {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("places must be between 0 and 10, got {p}"),
                );
            }
            let p = p as usize;
            if value.len() > p {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "result '{}' has {} digits which exceeds places={}",
                        value,
                        value.len(),
                        p
                    ),
                );
            }
            let padded = format!("{:0>width$}", value, width = p);
            CellValue::Text(padded.into())
        }
        None => CellValue::Text(value.to_string().into()),
    }
}

// ===========================================================================
// Base Conversion Functions (12)
// ===========================================================================

pub(super) struct FnBin2Dec;
impl PureFunction for FnBin2Dec {
    fn name(&self) -> &'static str {
        "BIN2DEC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_string();
        match bin_to_decimal(&s) {
            Some(val) => CellValue::number(val as f64),
            None => CellValue::error_with_message(
                CellError::Num,
                format!("BIN2DEC: value '{s}' is not a valid binary number"),
            ),
        }
    }
}

pub(super) struct FnBin2Hex;
impl PureFunction for FnBin2Hex {
    fn name(&self) -> &'static str {
        "BIN2HEX"
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
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_string();
        let decimal = match bin_to_decimal(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("BIN2HEX: value '{s}' is not a valid binary number"),
                );
            }
        };
        let hex = decimal_to_hex(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&hex, places, decimal < 0)
    }
}

pub(super) struct FnBin2Oct;
impl PureFunction for FnBin2Oct {
    fn name(&self) -> &'static str {
        "BIN2OCT"
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
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_string();
        let decimal = match bin_to_decimal(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("BIN2OCT: value '{s}' is not a valid binary number"),
                );
            }
        };
        if !(-512..=511).contains(&decimal) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BIN2OCT: value {decimal} is out of range for octal conversion"),
            );
        }
        let oct = decimal_to_oct(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&oct, places, decimal < 0)
    }
}

pub(super) struct FnDec2Bin;
impl PureFunction for FnDec2Bin {
    fn name(&self) -> &'static str {
        "DEC2BIN"
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
        let n = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        // Excel truncates non-integer inputs (e.g. DEC2BIN(5.7) = DEC2BIN(5))
        let decimal = n.trunc() as i64;
        // Range: -512 to 511
        if !(-512..=511).contains(&decimal) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("DEC2BIN: value {decimal} is out of range (-512 to 511)"),
            );
        }
        let bin = decimal_to_bin(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&bin, places, decimal < 0)
    }
}

pub(super) struct FnDec2Hex;
impl PureFunction for FnDec2Hex {
    fn name(&self) -> &'static str {
        "DEC2HEX"
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
        let n = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        // Excel truncates non-integer inputs (e.g. DEC2HEX(255.9) = DEC2HEX(255))
        let decimal = n.trunc() as i64;
        // Range: -549755813888 to 549755813887 (40-bit)
        if !(-549755813888..=549755813887).contains(&decimal) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("DEC2HEX: value {decimal} is out of range for hex conversion"),
            );
        }
        let hex = decimal_to_hex(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&hex, places, decimal < 0)
    }
}

pub(super) struct FnDec2Oct;
impl PureFunction for FnDec2Oct {
    fn name(&self) -> &'static str {
        "DEC2OCT"
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
        let n = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        // Excel truncates non-integer inputs (e.g. DEC2OCT(8.1) = DEC2OCT(8))
        let decimal = n.trunc() as i64;
        // Range: -536870912 to 536870911 (30-bit)
        if !(-536870912..=536870911).contains(&decimal) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("DEC2OCT: value {decimal} is out of range for octal conversion"),
            );
        }
        let oct = decimal_to_oct(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&oct, places, decimal < 0)
    }
}

pub(super) struct FnHex2Bin;
impl PureFunction for FnHex2Bin {
    fn name(&self) -> &'static str {
        "HEX2BIN"
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
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_uppercase();
        let decimal = match hex_to_decimal(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("HEX2BIN: value '{s}' is not a valid hexadecimal number"),
                );
            }
        };
        // Range check for binary: -512 to 511
        if !(-512..=511).contains(&decimal) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("HEX2BIN: value {decimal} is out of range for binary conversion"),
            );
        }
        let bin = decimal_to_bin(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&bin, places, decimal < 0)
    }
}

pub(super) struct FnHex2Dec;
impl PureFunction for FnHex2Dec {
    fn name(&self) -> &'static str {
        "HEX2DEC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_uppercase();
        match hex_to_decimal(&s) {
            Some(val) => CellValue::number(val as f64),
            None => CellValue::error_with_message(
                CellError::Num,
                format!("HEX2DEC: value '{s}' is not a valid hexadecimal number"),
            ),
        }
    }
}

pub(super) struct FnHex2Oct;
impl PureFunction for FnHex2Oct {
    fn name(&self) -> &'static str {
        "HEX2OCT"
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
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_uppercase();
        let decimal = match hex_to_decimal(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("HEX2OCT: value '{s}' is not a valid hexadecimal number"),
                );
            }
        };
        // Range check for octal: -536870912 to 536870911
        if !(-536870912..=536870911).contains(&decimal) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("HEX2OCT: value {decimal} is out of range for octal conversion"),
            );
        }
        let oct = decimal_to_oct(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&oct, places, decimal < 0)
    }
}

pub(super) struct FnOct2Bin;
impl PureFunction for FnOct2Bin {
    fn name(&self) -> &'static str {
        "OCT2BIN"
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
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_string();
        let decimal = match oct_to_decimal(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("OCT2BIN: value '{s}' is not a valid octal number"),
                );
            }
        };
        if !(-512..=511).contains(&decimal) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("OCT2BIN: value {decimal} is out of range for binary conversion"),
            );
        }
        let bin = decimal_to_bin(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&bin, places, decimal < 0)
    }
}

pub(super) struct FnOct2Dec;
impl PureFunction for FnOct2Dec {
    fn name(&self) -> &'static str {
        "OCT2DEC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_string();
        match oct_to_decimal(&s) {
            Some(val) => CellValue::number(val as f64),
            None => CellValue::error_with_message(
                CellError::Num,
                format!("OCT2DEC: value '{s}' is not a valid octal number"),
            ),
        }
    }
}

pub(super) struct FnOct2Hex;
impl PureFunction for FnOct2Hex {
    fn name(&self) -> &'static str {
        "OCT2HEX"
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
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s = s.trim().to_string();
        let decimal = match oct_to_decimal(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("OCT2HEX: value '{s}' is not a valid octal number"),
                );
            }
        };
        let hex = decimal_to_hex(decimal);
        let places = if args.len() > 1 {
            match coerce_num(args, 1) {
                Ok(v) => Some(v as i64),
                Err(e) => return e,
            }
        } else {
            None
        };
        format_with_places(&hex, places, decimal < 0)
    }
}

// ===========================================================================
// Registration
// ===========================================================================

pub(crate) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnBin2Dec));
    registry.register(Box::new(FnBin2Hex));
    registry.register(Box::new(FnBin2Oct));
    registry.register(Box::new(FnDec2Bin));
    registry.register(Box::new(FnDec2Hex));
    registry.register(Box::new(FnDec2Oct));
    registry.register(Box::new(FnHex2Bin));
    registry.register(Box::new(FnHex2Dec));
    registry.register(Box::new(FnHex2Oct));
    registry.register(Box::new(FnOct2Bin));
    registry.register(Box::new(FnOct2Dec));
    registry.register(Box::new(FnOct2Hex));
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
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.to_string().into())
    }

    #[test]
    fn test_bin2dec() {
        let f = FnBin2Dec;
        assert_eq!(f.call(&[text("1100100")]), num(100.0));
        assert_eq!(f.call(&[text("1111111111")]), num(-1.0));
        assert_eq!(f.call(&[text("0")]), num(0.0));
    }

    #[test]
    fn test_bin2hex() {
        let f = FnBin2Hex;
        assert_eq!(f.call(&[text("11111011")]), text("FB"));
        assert_eq!(f.call(&[text("11111011"), num(4.0)]), text("00FB"));
    }

    #[test]
    fn test_dec2bin() {
        let f = FnDec2Bin;
        assert_eq!(f.call(&[num(9.0)]), text("1001"));
        assert_eq!(f.call(&[num(-100.0)]), text("1110011100"));
    }

    #[test]
    fn test_dec2hex() {
        let f = FnDec2Hex;
        assert_eq!(f.call(&[num(100.0)]), text("64"));
        assert_eq!(f.call(&[num(-54.0)]), text("FFFFFFFFCA"));
    }

    #[test]
    fn test_hex2dec() {
        let f = FnHex2Dec;
        assert_eq!(f.call(&[text("A5")]), num(165.0));
        assert_eq!(f.call(&[text("FFFFFFFF5B")]), num(-165.0));
    }

    #[test]
    fn test_oct2dec() {
        let f = FnOct2Dec;
        assert_eq!(f.call(&[text("54")]), num(44.0));
        assert_eq!(f.call(&[text("7777777777")]), num(-1.0));
    }

    #[test]
    fn test_dec2bin_truncates_float() {
        // Excel truncates non-integer inputs: DEC2BIN(5.7) = DEC2BIN(5) = "101"
        let f = FnDec2Bin;
        assert_eq!(f.call(&[num(5.7)]), text("101"));
        assert_eq!(f.call(&[num(5.1)]), text("101"));
        assert_eq!(f.call(&[num(-3.9)]), text("1111111101"));
    }

    #[test]
    fn test_dec2hex_truncates_float() {
        // Excel truncates non-integer inputs: DEC2HEX(255.9) = DEC2HEX(255) = "FF"
        let f = FnDec2Hex;
        assert_eq!(f.call(&[num(255.9)]), text("FF"));
        assert_eq!(f.call(&[num(255.1)]), text("FF"));
    }

    #[test]
    fn test_dec2oct_truncates_float() {
        // Excel truncates non-integer inputs: DEC2OCT(8.1) = DEC2OCT(8) = "10"
        let f = FnDec2Oct;
        assert_eq!(f.call(&[num(8.1)]), text("10"));
        assert_eq!(f.call(&[num(8.9)]), text("10"));
    }
}
