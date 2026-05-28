use value_types::{CellError, CellValue};

use super::super::helpers::{coerce_num, coerce_str};
use super::types::{format_complex, parse_complex};
use super::wrappers::complex_unary_fn;
use crate::PureFunction;

complex_unary_fn!(FnImSqrt, "IMSQRT", |re: f64,
                                       im: f64,
                                       suffix: char|
 -> CellValue {
    let modulus = (re * re + im * im).sqrt();
    let theta = im.atan2(re);
    let sqrt_r = modulus.sqrt();
    let r = sqrt_r * (theta / 2.0).cos();
    let i = sqrt_r * (theta / 2.0).sin();
    CellValue::Text(format_complex(r, i, suffix).into())
});

pub(super) struct FnImPower;
impl PureFunction for FnImPower {
    fn name(&self) -> &'static str {
        "IMPOWER"
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
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let (re, im, suffix) = match parse_complex(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMPOWER: first argument is not a valid complex number".to_string(),
                );
            }
        };
        let n = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let r = (re * re + im * im).sqrt();
        let theta = im.atan2(re);
        if r == 0.0 && n <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                "IMPOWER: cannot raise zero to a negative or zero power".to_string(),
            );
        }
        let rn = r.powf(n);
        let result_re = rn * (n * theta).cos();
        let result_im = rn * (n * theta).sin();
        CellValue::Text(format_complex(result_re, result_im, suffix).into())
    }
}

// IMDIV: complex / complex
pub(super) struct FnImDiv;
impl PureFunction for FnImDiv {
    fn name(&self) -> &'static str {
        "IMDIV"
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
        let s1 = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s2 = match coerce_str(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let (a, b, suf1) = match parse_complex(&s1) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMDIV: numerator is not a valid complex number".to_string(),
                );
            }
        };
        let (c, d, suf2) = match parse_complex(&s2) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMDIV: denominator is not a valid complex number".to_string(),
                );
            }
        };
        // Validate suffix consistency: if both have imaginary parts, suffixes must match
        if b != 0.0 && d != 0.0 && suf1 != suf2 {
            return CellValue::error_with_message(
                CellError::Value,
                "IMDIV: mismatched imaginary suffixes ('i' vs 'j')".to_string(),
            );
        }
        let suffix = if b != 0.0 { suf1 } else { suf2 };
        let denom = c * c + d * d;
        if denom == 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                "IMDIV: division by zero".to_string(),
            );
        }
        let re = (a * c + b * d) / denom;
        let im = (b * c - a * d) / denom;
        CellValue::Text(format_complex(re, im, suffix).into())
    }
}

// IMSUB: complex - complex
pub(super) struct FnImSub;
impl PureFunction for FnImSub {
    fn name(&self) -> &'static str {
        "IMSUB"
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
        let s1 = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s2 = match coerce_str(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let (a, b, suf1) = match parse_complex(&s1) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMSUB: first argument is not a valid complex number".to_string(),
                );
            }
        };
        let (c, d, suf2) = match parse_complex(&s2) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMSUB: second argument is not a valid complex number".to_string(),
                );
            }
        };
        // Validate suffix consistency: if both have imaginary parts, suffixes must match
        if b != 0.0 && d != 0.0 && suf1 != suf2 {
            return CellValue::error_with_message(
                CellError::Value,
                "IMSUB: mismatched imaginary suffixes ('i' vs 'j')".to_string(),
            );
        }
        let suffix = if b != 0.0 { suf1 } else { suf2 };
        CellValue::Text(format_complex(a - c, b - d, suffix).into())
    }
}

// IMSUM: sum of 1..N complex numbers
pub(super) struct FnImSum;
impl PureFunction for FnImSum {
    fn name(&self) -> &'static str {
        "IMSUM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let mut total_re = 0.0;
        let mut total_im = 0.0;
        let mut result_suffix = 'i';
        let mut suffix_set = false;
        for (idx, _) in args.iter().enumerate() {
            let s = match coerce_str(args, idx) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let (re, im, suf) = match parse_complex(&s) {
                Some(v) => v,
                None => {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("IMSUM: argument {} is not a valid complex number", idx + 1),
                    );
                }
            };
            total_re += re;
            total_im += im;
            // Track suffix from first non-real argument; error on mismatch
            if suf != 'i' || im != 0.0 {
                if !suffix_set {
                    result_suffix = suf;
                    suffix_set = true;
                } else if suf != result_suffix && suf != 'i' {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "IMSUM: mismatched imaginary suffixes ('i' vs 'j')".to_string(),
                    );
                }
            }
        }
        CellValue::Text(format_complex(total_re, total_im, result_suffix).into())
    }
}

// IMPRODUCT: product of 1..N complex numbers
pub(super) struct FnImProduct;
impl PureFunction for FnImProduct {
    fn name(&self) -> &'static str {
        "IMPRODUCT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let mut result_re = 1.0;
        let mut result_im = 0.0;
        let mut result_suffix = 'i';
        let mut suffix_set = false;
        for (idx, _) in args.iter().enumerate() {
            let s = match coerce_str(args, idx) {
                Ok(v) => v,
                Err(e) => return e,
            };
            let (re, im, suf) = match parse_complex(&s) {
                Some(v) => v,
                None => {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "IMPRODUCT: argument {} is not a valid complex number",
                            idx + 1
                        ),
                    );
                }
            };
            // (a + bi)(c + di) = (ac - bd) + (ad + bc)i
            let new_re = result_re * re - result_im * im;
            let new_im = result_re * im + result_im * re;
            result_re = new_re;
            result_im = new_im;
            // Track suffix from first non-real argument; error on mismatch
            if suf != 'i' || im != 0.0 {
                if !suffix_set {
                    result_suffix = suf;
                    suffix_set = true;
                } else if suf != result_suffix && suf != 'i' {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "IMPRODUCT: mismatched imaginary suffixes ('i' vs 'j')".to_string(),
                    );
                }
            }
        }
        CellValue::Text(format_complex(result_re, result_im, result_suffix).into())
    }
}
