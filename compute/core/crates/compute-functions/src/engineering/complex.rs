//! Complex number functions: COMPLEX, IMABS, IMAGINARY, IMARGUMENT, IMCONJUGATE,
//! IMCOS, IMCOSH, IMCOT, IMCSC, IMCSCH, IMDIV, IMEXP, IMLN, IMLOG10, IMLOG2,
//! IMPOWER, IMPRODUCT, IMREAL, IMSEC, IMSECH, IMSIN, IMSINH, IMSQRT, IMSUB,
//! IMSUM, IMTAN

use value_types::{CellError, CellValue};

use super::helpers::{coerce_num, coerce_str};
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// Complex Number Helpers
// ===========================================================================

/// Parse a complex number string like "3+4i", "3+4j", "3", "4i", "i", "-i".
/// Returns (real, imag, suffix) or None on parse failure.
pub(crate) fn parse_complex(s: &str) -> Option<(f64, f64, char)> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    // Determine suffix
    let last = s.chars().last()?;
    let suffix = if last == 'i' || last == 'j' {
        last
    } else {
        // Pure real number
        let real: f64 = s.parse().ok()?;
        return Some((real, 0.0, 'i'));
    };

    let without_suffix = &s[..s.len() - 1];

    // Pure imaginary: "i", "+i", "-i"
    if without_suffix.is_empty() || without_suffix == "+" {
        return Some((0.0, 1.0, suffix));
    }
    if without_suffix == "-" {
        return Some((0.0, -1.0, suffix));
    }

    // Try pure imaginary: "4i", "-4i", "1.5e2i", "2.5e-3i"
    // Check if there's an internal +/- that isn't part of scientific notation.
    // If no such operator exists, this is a pure imaginary number.
    {
        let bytes = without_suffix.as_bytes();
        let mut has_internal_op = false;
        for idx in 1..bytes.len() {
            let c = bytes[idx] as char;
            if c == '+' || c == '-' {
                let prev = bytes[idx - 1] as char;
                if prev != 'e' && prev != 'E' {
                    has_internal_op = true;
                    break;
                }
            }
        }
        if !has_internal_op && let Ok(im) = without_suffix.parse::<f64>() {
            return Some((0.0, im, suffix));
        }
    }

    // Complex: "3+4i" or "3-4i" -- find the last + or - that splits real and imag
    // Skip characters inside scientific notation (e+ or e-)
    let bytes = without_suffix.as_bytes();
    let mut split_pos = None;
    let mut i = without_suffix.len();
    while i > 0 {
        i -= 1;
        let c = bytes[i] as char;
        if (c == '+' || c == '-') && i > 0 {
            // Make sure this isn't part of scientific notation
            let prev = bytes[i - 1] as char;
            if prev == 'e' || prev == 'E' {
                continue;
            }
            split_pos = Some(i);
            break;
        }
    }

    let split = split_pos?;
    if split == 0 {
        return None;
    }

    let real_part = &without_suffix[..split];
    let imag_part = &without_suffix[split..];

    let real: f64 = real_part.parse().ok()?;
    let imag: f64 = if imag_part == "+" {
        1.0
    } else if imag_part == "-" {
        -1.0
    } else {
        imag_part.parse().ok()?
    };

    Some((real, imag, suffix))
}

/// Format a complex number as a string, matching Excel conventions.
fn format_complex(re: f64, im: f64, suffix: char) -> String {
    const EPSILON: f64 = 1e-14;
    let re = if re.abs() < EPSILON { 0.0 } else { re };
    let im = if im.abs() < EPSILON { 0.0 } else { im };

    if im == 0.0 {
        return format_num(re);
    }
    if re == 0.0 {
        if im == 1.0 {
            return format!("{}", suffix);
        }
        if im == -1.0 {
            return format!("-{}", suffix);
        }
        return format!("{}{}", format_num(im), suffix);
    }
    // Both parts nonzero
    let sign = if im >= 0.0 { "+" } else { "" };
    if im == 1.0 {
        return format!("{}+{}", format_num(re), suffix);
    }
    if im == -1.0 {
        return format!("{}-{}", format_num(re), suffix);
    }
    format!("{}{}{}{}", format_num(re), sign, format_num(im), suffix)
}

/// Format a number for complex output: integers without decimals, floats as-is.
fn format_num(n: f64) -> String {
    if n == n.trunc() && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}

// ===========================================================================
// Complex Number Functions (26)
// ===========================================================================

pub(super) struct FnComplex;
impl PureFunction for FnComplex {
    fn name(&self) -> &'static str {
        "COMPLEX"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let real = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let imag = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let suffix = if args.len() > 2 {
            match coerce_str(args, 2) {
                Ok(s) => {
                    if s == "i" || s == "j" {
                        match s.chars().next() {
                            Some(c) => c,
                            None => return CellValue::Error(CellError::Value, None),
                        }
                    } else {
                        return CellValue::error_with_message(
                            CellError::Value,
                            format!("COMPLEX: suffix must be 'i' or 'j', got '{s}'"),
                        );
                    }
                }
                Err(e) => return e,
            }
        } else {
            'i'
        };
        CellValue::Text(format_complex(real, imag, suffix).into())
    }
}

/// Macro for single-arg complex functions that return a complex string.
macro_rules! complex_unary_fn {
    ($struct_name:ident, $name:literal, $body:expr) => {
        pub(super) struct $struct_name;
        impl PureFunction for $struct_name {
            fn name(&self) -> &'static str {
                $name
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
                let (re, im, suffix) = match parse_complex(&s) {
                    Some(v) => v,
                    None => {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("{}: argument is not a valid complex number", $name),
                        );
                    }
                };
                let f: fn(f64, f64, char) -> CellValue = $body;
                f(re, im, suffix)
            }
        }
    };
}

/// Macro for single-arg complex functions that return a number.
macro_rules! complex_to_num_fn {
    ($struct_name:ident, $name:literal, $body:expr) => {
        pub(super) struct $struct_name;
        impl PureFunction for $struct_name {
            fn name(&self) -> &'static str {
                $name
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
                let (re, im, _suffix) = match parse_complex(&s) {
                    Some(v) => v,
                    None => {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("{}: argument is not a valid complex number", $name),
                        );
                    }
                };
                let f: fn(f64, f64) -> CellValue = $body;
                f(re, im)
            }
        }
    };
}

complex_to_num_fn!(FnImAbs, "IMABS", |re: f64, im: f64| -> CellValue {
    CellValue::number((re * re + im * im).sqrt())
});

complex_to_num_fn!(FnImaginary, "IMAGINARY", |_re: f64, im: f64| -> CellValue {
    CellValue::number(im)
});

complex_to_num_fn!(FnImReal, "IMREAL", |re: f64, _im: f64| -> CellValue {
    CellValue::number(re)
});

pub(super) struct FnImArgument;
impl PureFunction for FnImArgument {
    fn name(&self) -> &'static str {
        "IMARGUMENT"
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
        let (re, im, _) = match parse_complex(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMARGUMENT: argument is not a valid complex number".to_string(),
                );
            }
        };
        if re == 0.0 && im == 0.0 {
            return CellValue::error_with_message(
                CellError::Div0,
                "IMARGUMENT: argument of zero is undefined".to_string(),
            );
        }
        CellValue::number(im.atan2(re))
    }
}

complex_unary_fn!(FnImConjugate, "IMCONJUGATE", |re: f64,
                                                 im: f64,
                                                 suffix: char|
 -> CellValue {
    CellValue::Text(format_complex(re, -im, suffix).into())
});

complex_unary_fn!(FnImCos, "IMCOS", |re: f64,
                                     im: f64,
                                     suffix: char|
 -> CellValue {
    // cos(a + bi) = cos(a)cosh(b) - i*sin(a)sinh(b)
    let r = re.cos() * im.cosh();
    let i = -re.sin() * im.sinh();
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImCosh, "IMCOSH", |re: f64,
                                       im: f64,
                                       suffix: char|
 -> CellValue {
    // cosh(a + bi) = cosh(a)cos(b) + i*sinh(a)sin(b)
    let r = re.cosh() * im.cos();
    let i = re.sinh() * im.sin();
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImCot, "IMCOT", |re: f64,
                                     im: f64,
                                     suffix: char|
 -> CellValue {
    // cot(z) = cos(z)/sin(z)
    let sin_re = re.sin() * im.cosh();
    let sin_im = re.cos() * im.sinh();
    let cos_re = re.cos() * im.cosh();
    let cos_im = -re.sin() * im.sinh();
    let denom = sin_re * sin_re + sin_im * sin_im;
    if denom == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMCOT: division by zero (sin(z) = 0)".to_string(),
        );
    }
    let r = (cos_re * sin_re + cos_im * sin_im) / denom;
    let i = (cos_im * sin_re - cos_re * sin_im) / denom;
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImCsc, "IMCSC", |re: f64,
                                     im: f64,
                                     suffix: char|
 -> CellValue {
    // csc(z) = 1/sin(z)
    let sin_re = re.sin() * im.cosh();
    let sin_im = re.cos() * im.sinh();
    let denom = sin_re * sin_re + sin_im * sin_im;
    if denom == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMCSC: division by zero (sin(z) = 0)".to_string(),
        );
    }
    let r = sin_re / denom;
    let i = -sin_im / denom;
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImCsch, "IMCSCH", |re: f64,
                                       im: f64,
                                       suffix: char|
 -> CellValue {
    // csch(z) = 1/sinh(z)
    let sinh_re = re.sinh() * im.cos();
    let sinh_im = re.cosh() * im.sin();
    let denom = sinh_re * sinh_re + sinh_im * sinh_im;
    if denom == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMCSCH: division by zero (sinh(z) = 0)".to_string(),
        );
    }
    let r = sinh_re / denom;
    let i = -sinh_im / denom;
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImExp, "IMEXP", |re: f64,
                                     im: f64,
                                     suffix: char|
 -> CellValue {
    // e^(a + bi) = e^a * (cos(b) + i*sin(b))
    let ea = re.exp();
    let r = ea * im.cos();
    let i = ea * im.sin();
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImLn, "IMLN", |re: f64,
                                   im: f64,
                                   suffix: char|
 -> CellValue {
    let modulus = (re * re + im * im).sqrt();
    if modulus == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMLN: logarithm of zero is undefined".to_string(),
        );
    }
    let r = modulus.ln();
    let i = im.atan2(re);
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImLog10, "IMLOG10", |re: f64,
                                         im: f64,
                                         suffix: char|
 -> CellValue {
    let modulus = (re * re + im * im).sqrt();
    if modulus == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMLOG10: logarithm of zero is undefined".to_string(),
        );
    }
    let ln10 = 10.0_f64.ln();
    let r = modulus.ln() / ln10;
    let i = im.atan2(re) / ln10;
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImLog2, "IMLOG2", |re: f64,
                                       im: f64,
                                       suffix: char|
 -> CellValue {
    let modulus = (re * re + im * im).sqrt();
    if modulus == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMLOG2: logarithm of zero is undefined".to_string(),
        );
    }
    let ln2 = 2.0_f64.ln();
    let r = modulus.ln() / ln2;
    let i = im.atan2(re) / ln2;
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImSec, "IMSEC", |re: f64,
                                     im: f64,
                                     suffix: char|
 -> CellValue {
    // sec(z) = 1/cos(z)
    let cos_re = re.cos() * im.cosh();
    let cos_im = -re.sin() * im.sinh();
    let denom = cos_re * cos_re + cos_im * cos_im;
    if denom == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMSEC: division by zero (cos(z) = 0)".to_string(),
        );
    }
    let r = cos_re / denom;
    let i = -cos_im / denom;
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImSech, "IMSECH", |re: f64,
                                       im: f64,
                                       suffix: char|
 -> CellValue {
    // sech(z) = 1/cosh(z)
    let cosh_re = re.cosh() * im.cos();
    let cosh_im = re.sinh() * im.sin();
    let denom = cosh_re * cosh_re + cosh_im * cosh_im;
    if denom == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMSECH: division by zero (cosh(z) = 0)".to_string(),
        );
    }
    let r = cosh_re / denom;
    let i = -cosh_im / denom;
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImSin, "IMSIN", |re: f64,
                                     im: f64,
                                     suffix: char|
 -> CellValue {
    // sin(a + bi) = sin(a)cosh(b) + i*cos(a)sinh(b)
    let r = re.sin() * im.cosh();
    let i = re.cos() * im.sinh();
    CellValue::Text(format_complex(r, i, suffix).into())
});

complex_unary_fn!(FnImSinh, "IMSINH", |re: f64,
                                       im: f64,
                                       suffix: char|
 -> CellValue {
    // sinh(a + bi) = sinh(a)cos(b) + i*cosh(a)sin(b)
    let r = re.sinh() * im.cos();
    let i = re.cosh() * im.sin();
    CellValue::Text(format_complex(r, i, suffix).into())
});

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

complex_unary_fn!(FnImTan, "IMTAN", |re: f64,
                                     im: f64,
                                     suffix: char|
 -> CellValue {
    // tan(z) = sin(z)/cos(z)
    let sin_re = re.sin() * im.cosh();
    let sin_im = re.cos() * im.sinh();
    let cos_re = re.cos() * im.cosh();
    let cos_im = -re.sin() * im.sinh();
    let denom = cos_re * cos_re + cos_im * cos_im;
    if denom == 0.0 {
        return CellValue::error_with_message(
            CellError::Num,
            "IMTAN: division by zero (cos(z) = 0)".to_string(),
        );
    }
    let r = (sin_re * cos_re + sin_im * cos_im) / denom;
    let i = (sin_im * cos_re - sin_re * cos_im) / denom;
    CellValue::Text(format_complex(r, i, suffix).into())
});

// IMPOWER: complex^n (n is a real number)
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

// ===========================================================================
// Registration
// ===========================================================================

pub(crate) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnComplex));
    registry.register(Box::new(FnImAbs));
    registry.register(Box::new(FnImaginary));
    registry.register(Box::new(FnImArgument));
    registry.register(Box::new(FnImConjugate));
    registry.register(Box::new(FnImCos));
    registry.register(Box::new(FnImCosh));
    registry.register(Box::new(FnImCot));
    registry.register(Box::new(FnImCsc));
    registry.register(Box::new(FnImCsch));
    registry.register(Box::new(FnImDiv));
    registry.register(Box::new(FnImExp));
    registry.register(Box::new(FnImLn));
    registry.register(Box::new(FnImLog10));
    registry.register(Box::new(FnImLog2));
    registry.register(Box::new(FnImPower));
    registry.register(Box::new(FnImProduct));
    registry.register(Box::new(FnImReal));
    registry.register(Box::new(FnImSec));
    registry.register(Box::new(FnImSech));
    registry.register(Box::new(FnImSin));
    registry.register(Box::new(FnImSinh));
    registry.register(Box::new(FnImSqrt));
    registry.register(Box::new(FnImSub));
    registry.register(Box::new(FnImSum));
    registry.register(Box::new(FnImTan));
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
        CellValue::Text(s.into())
    }

    #[test]
    fn test_complex() {
        let f = FnComplex;
        assert_eq!(f.call(&[num(3.0), num(4.0)]), text("3+4i"));
        assert_eq!(f.call(&[num(3.0), num(4.0), text("j")]), text("3+4j"));
        assert_eq!(f.call(&[num(0.0), num(1.0)]), text("i"));
        assert_eq!(f.call(&[num(1.0), num(0.0)]), text("1"));
    }

    #[test]
    fn test_imabs() {
        let f = FnImAbs;
        assert_eq!(f.call(&[text("3+4i")]), num(5.0));
    }

    #[test]
    fn test_imaginary() {
        let f = FnImaginary;
        assert_eq!(f.call(&[text("3+4i")]), num(4.0));
    }

    #[test]
    fn test_imreal() {
        let f = FnImReal;
        assert_eq!(f.call(&[text("3+4i")]), num(3.0));
    }

    #[test]
    fn test_imsum() {
        let f = FnImSum;
        assert_eq!(f.call(&[text("3+4i"), text("5+3i")]), text("8+7i"));
    }

    #[test]
    fn test_imsub() {
        let f = FnImSub;
        assert_eq!(f.call(&[text("13+4i"), text("5+3i")]), text("8+i"));
    }

    #[test]
    fn test_improduct() {
        let f = FnImProduct;
        // (3+4i)(1+2i) = (3-8)+(6+4)i = -5+10i
        assert_eq!(f.call(&[text("3+4i"), text("1+2i")]), text("-5+10i"));
    }

    #[test]
    fn test_imconjugate() {
        let f = FnImConjugate;
        assert_eq!(f.call(&[text("3+4i")]), text("3-4i"));
    }

    #[test]
    fn test_parse_complex_cases() {
        assert_eq!(parse_complex("3"), Some((3.0, 0.0, 'i')));
        assert_eq!(parse_complex("4i"), Some((0.0, 4.0, 'i')));
        assert_eq!(parse_complex("i"), Some((0.0, 1.0, 'i')));
        assert_eq!(parse_complex("-i"), Some((0.0, -1.0, 'i')));
        assert_eq!(parse_complex("3+4i"), Some((3.0, 4.0, 'i')));
        assert_eq!(parse_complex("3-4j"), Some((3.0, -4.0, 'j')));
        assert_eq!(parse_complex("0"), Some((0.0, 0.0, 'i')));
    }

    // =====================================================================
    // Helper: extract f64 from CellValue::Number
    // =====================================================================

    fn extract_f64(v: &CellValue) -> f64 {
        match v {
            CellValue::Number(n) => f64::from(*n),
            other => panic!("expected Number, got {:?}", other),
        }
    }

    fn extract_text(v: &CellValue) -> String {
        match v {
            CellValue::Text(s) => s.to_string(),
            other => panic!("expected Text, got {:?}", other),
        }
    }

    fn assert_num_approx(result: &CellValue, expected: f64, tol: f64) {
        let got = extract_f64(result);
        assert!(
            (got - expected).abs() < tol,
            "expected {expected}, got {got}, diff {}",
            (got - expected).abs()
        );
    }

    /// Parse a complex result string and assert real/imag parts within tolerance.
    fn assert_complex_approx(result: &CellValue, expected_re: f64, expected_im: f64, tol: f64) {
        let s = extract_text(result);
        let (re, im, _) =
            parse_complex(&s).unwrap_or_else(|| panic!("failed to parse complex result: {s:?}"));
        assert!(
            (re - expected_re).abs() < tol,
            "real part: expected {expected_re}, got {re} (from {s:?})"
        );
        assert!(
            (im - expected_im).abs() < tol,
            "imag part: expected {expected_im}, got {im} (from {s:?})"
        );
    }

    // =====================================================================
    // COMPLEX — construction
    // =====================================================================

    #[test]
    fn test_complex_negative_imaginary() {
        assert_eq!(FnComplex.call(&[num(3.0), num(-4.0)]), text("3-4i"));
    }

    #[test]
    fn test_complex_zero_zero() {
        assert_eq!(FnComplex.call(&[num(0.0), num(0.0)]), text("0"));
    }

    #[test]
    fn test_complex_pure_real() {
        assert_eq!(FnComplex.call(&[num(5.0), num(0.0)]), text("5"));
    }

    #[test]
    fn test_complex_pure_imaginary() {
        assert_eq!(FnComplex.call(&[num(0.0), num(3.0)]), text("3i"));
    }

    #[test]
    fn test_complex_neg_one_imaginary() {
        assert_eq!(FnComplex.call(&[num(0.0), num(-1.0)]), text("-i"));
    }

    #[test]
    fn test_complex_j_suffix() {
        assert_eq!(
            FnComplex.call(&[num(3.0), num(4.0), text("j")]),
            text("3+4j")
        );
    }

    #[test]
    fn test_complex_invalid_suffix() {
        assert!(matches!(
            FnComplex.call(&[num(1.0), num(1.0), text("k")]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn test_complex_fractional() {
        assert_eq!(FnComplex.call(&[num(1.5), num(2.5)]), text("1.5+2.5i"));
    }

    #[test]
    fn test_complex_negative_real_and_imag() {
        assert_eq!(FnComplex.call(&[num(-3.0), num(-4.0)]), text("-3-4i"));
    }

    #[test]
    fn test_complex_one_imag() {
        // COMPLEX(2, 1) = "2+i"
        assert_eq!(FnComplex.call(&[num(2.0), num(1.0)]), text("2+i"));
    }

    #[test]
    fn test_complex_neg_one_imag_with_real() {
        // COMPLEX(2, -1) = "2-i"
        assert_eq!(FnComplex.call(&[num(2.0), num(-1.0)]), text("2-i"));
    }

    // =====================================================================
    // IMREAL / IMAGINARY — extraction
    // =====================================================================

    #[test]
    fn test_imreal_pure_real() {
        assert_eq!(FnImReal.call(&[text("5")]), num(5.0));
    }

    #[test]
    fn test_imaginary_pure_real() {
        assert_eq!(FnImaginary.call(&[text("5")]), num(0.0));
    }

    #[test]
    fn test_imreal_pure_imaginary() {
        assert_eq!(FnImReal.call(&[text("3i")]), num(0.0));
    }

    #[test]
    fn test_imaginary_pure_imaginary() {
        assert_eq!(FnImaginary.call(&[text("3i")]), num(3.0));
    }

    #[test]
    fn test_imreal_unit_imaginary() {
        assert_eq!(FnImReal.call(&[text("i")]), num(0.0));
    }

    #[test]
    fn test_imaginary_unit_imaginary() {
        assert_eq!(FnImaginary.call(&[text("i")]), num(1.0));
    }

    #[test]
    fn test_imaginary_negative_unit() {
        assert_eq!(FnImaginary.call(&[text("-i")]), num(-1.0));
    }

    #[test]
    fn test_imreal_invalid_string() {
        assert!(matches!(
            FnImReal.call(&[text("abc")]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    // =====================================================================
    // IMABS — modulus |z| = sqrt(re^2 + im^2)
    // =====================================================================

    #[test]
    fn test_imabs_3_4i() {
        // |3+4i| = 5
        assert_eq!(FnImAbs.call(&[text("3+4i")]), num(5.0));
    }

    #[test]
    fn test_imabs_1_plus_i() {
        // |1+i| = sqrt(2)
        let result = FnImAbs.call(&[text("1+i")]);
        assert_num_approx(&result, std::f64::consts::SQRT_2, 1e-9);
    }

    #[test]
    fn test_imabs_pure_real() {
        assert_eq!(FnImAbs.call(&[text("5")]), num(5.0));
    }

    #[test]
    fn test_imabs_pure_imaginary() {
        // |4i| = 4
        assert_eq!(FnImAbs.call(&[text("4i")]), num(4.0));
    }

    #[test]
    fn test_imabs_zero() {
        assert_eq!(FnImAbs.call(&[text("0")]), num(0.0));
    }

    // =====================================================================
    // IMARGUMENT — angle theta = atan2(im, re)
    // =====================================================================

    #[test]
    fn test_imargument_first_quadrant() {
        // arg(1+i) = pi/4
        let result = FnImArgument.call(&[text("1+i")]);
        assert_num_approx(&result, std::f64::consts::FRAC_PI_4, 1e-9);
    }

    #[test]
    fn test_imargument_pure_imaginary() {
        // arg(i) = pi/2
        let result = FnImArgument.call(&[text("i")]);
        assert_num_approx(&result, std::f64::consts::FRAC_PI_2, 1e-9);
    }

    #[test]
    fn test_imargument_negative_real() {
        // arg(-1) = pi
        let result = FnImArgument.call(&[text("-1")]);
        assert_num_approx(&result, std::f64::consts::PI, 1e-9);
    }

    #[test]
    fn test_imargument_positive_real() {
        // arg(1) = 0
        let result = FnImArgument.call(&[text("1")]);
        assert_num_approx(&result, 0.0, 1e-9);
    }

    #[test]
    fn test_imargument_negative_imaginary() {
        // arg(-i) = -pi/2
        let result = FnImArgument.call(&[text("-i")]);
        assert_num_approx(&result, -std::f64::consts::FRAC_PI_2, 1e-9);
    }

    #[test]
    fn test_imargument_zero_is_div0() {
        // arg(0) is undefined -> #DIV/0!
        assert!(matches!(
            FnImArgument.call(&[text("0")]),
            CellValue::Error(CellError::Div0, _)
        ));
    }

    // =====================================================================
    // IMCONJUGATE — z̄ = re - im*i
    // =====================================================================

    #[test]
    fn test_imconjugate_positive_imag() {
        assert_eq!(FnImConjugate.call(&[text("3+4i")]), text("3-4i"));
    }

    #[test]
    fn test_imconjugate_negative_imag() {
        assert_eq!(FnImConjugate.call(&[text("3-4i")]), text("3+4i"));
    }

    #[test]
    fn test_imconjugate_pure_real() {
        assert_eq!(FnImConjugate.call(&[text("5")]), text("5"));
    }

    #[test]
    fn test_imconjugate_pure_imaginary() {
        assert_eq!(FnImConjugate.call(&[text("3i")]), text("-3i"));
    }

    // =====================================================================
    // IMSUM — addition
    // =====================================================================

    #[test]
    fn test_imsum_basic() {
        assert_eq!(FnImSum.call(&[text("1+2i"), text("3+4i")]), text("4+6i"));
    }

    #[test]
    fn test_imsum_three_args() {
        assert_eq!(
            FnImSum.call(&[text("1+i"), text("2+2i"), text("3+3i")]),
            text("6+6i")
        );
    }

    #[test]
    fn test_imsum_with_real() {
        assert_eq!(FnImSum.call(&[text("3+4i"), text("2")]), text("5+4i"));
    }

    // =====================================================================
    // IMSUB — subtraction
    // =====================================================================

    #[test]
    fn test_imsub_basic() {
        assert_eq!(FnImSub.call(&[text("3+4i"), text("1+2i")]), text("2+2i"));
    }

    #[test]
    fn test_imsub_result_zero() {
        assert_eq!(FnImSub.call(&[text("3+4i"), text("3+4i")]), text("0"));
    }

    // =====================================================================
    // IMPRODUCT — multiplication
    // =====================================================================

    #[test]
    fn test_improduct_i_squared() {
        // (1+i)^2 = 1 + 2i + i^2 = 1 + 2i - 1 = 2i
        assert_eq!(FnImProduct.call(&[text("1+i"), text("1+i")]), text("2i"));
    }

    #[test]
    fn test_improduct_conjugate_pair() {
        // (3+4i)(3-4i) = 9 + 16 = 25
        assert_eq!(FnImProduct.call(&[text("3+4i"), text("3-4i")]), text("25"));
    }

    #[test]
    fn test_improduct_pure_imaginary() {
        // i * i = -1
        assert_eq!(FnImProduct.call(&[text("i"), text("i")]), text("-1"));
    }

    #[test]
    fn test_improduct_three_args() {
        // (1+i)(1+i)(1+i) = (2i)(1+i) = 2i + 2i^2 = -2+2i
        assert_eq!(
            FnImProduct.call(&[text("1+i"), text("1+i"), text("1+i")]),
            text("-2+2i")
        );
    }

    // =====================================================================
    // IMDIV — division
    // =====================================================================

    #[test]
    fn test_imdiv_one_over_i() {
        // 1/i = -i
        assert_eq!(FnImDiv.call(&[text("1"), text("i")]), text("-i"));
    }

    #[test]
    fn test_imdiv_basic() {
        // (4+2i)/(1+i) = (4+2i)(1-i)/2 = (4-4i+2i-2i^2)/2 = (6-2i)/2 = 3-i
        assert_eq!(FnImDiv.call(&[text("4+2i"), text("1+i")]), text("3-i"));
    }

    #[test]
    fn test_imdiv_by_zero() {
        assert!(matches!(
            FnImDiv.call(&[text("1+i"), text("0")]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_imdiv_identity() {
        // z/z = 1
        assert_eq!(FnImDiv.call(&[text("3+4i"), text("3+4i")]), text("1"));
    }

    // =====================================================================
    // IMPOWER — z^n
    // =====================================================================

    #[test]
    fn test_impower_squared() {
        // (1+i)^2 = 2i
        let result = FnImPower.call(&[text("1+i"), num(2.0)]);
        assert_complex_approx(&result, 0.0, 2.0, 1e-9);
    }

    #[test]
    fn test_impower_zero() {
        // z^0 = 1
        assert_eq!(FnImPower.call(&[text("3+4i"), num(0.0)]), text("1"));
    }

    #[test]
    fn test_impower_one() {
        // z^1 = z
        let result = FnImPower.call(&[text("3+4i"), num(1.0)]);
        assert_complex_approx(&result, 3.0, 4.0, 1e-9);
    }

    #[test]
    fn test_impower_negative_exponent() {
        // i^(-1) = 1/i = -i
        let result = FnImPower.call(&[text("i"), num(-1.0)]);
        assert_complex_approx(&result, 0.0, -1.0, 1e-9);
    }

    #[test]
    fn test_impower_zero_base_negative_exp() {
        assert!(matches!(
            FnImPower.call(&[text("0"), num(-1.0)]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    // =====================================================================
    // IMSQRT — principal square root
    // =====================================================================

    #[test]
    fn test_imsqrt_negative_one() {
        // sqrt(-1) = i
        assert_eq!(FnImSqrt.call(&[text("-1")]), text("i"));
    }

    #[test]
    fn test_imsqrt_of_i() {
        // sqrt(i) = (1+i)/sqrt(2)
        let result = FnImSqrt.call(&[text("i")]);
        let expected = 1.0 / std::f64::consts::SQRT_2;
        assert_complex_approx(&result, expected, expected, 1e-9);
    }

    #[test]
    fn test_imsqrt_positive_real() {
        // sqrt(4) = 2
        assert_eq!(FnImSqrt.call(&[text("4")]), text("2"));
    }

    #[test]
    fn test_imsqrt_negative_four() {
        // sqrt(-4) = 2i
        assert_eq!(FnImSqrt.call(&[text("-4")]), text("2i"));
    }

    // =====================================================================
    // IMEXP — e^z
    // =====================================================================

    #[test]
    fn test_imexp_zero() {
        // e^0 = 1
        assert_eq!(FnImExp.call(&[text("0")]), text("1"));
    }

    #[test]
    fn test_imexp_euler_identity() {
        // e^(pi*i) = -1 (Euler's identity)
        let arg = format!("{}i", std::f64::consts::PI);
        let result = FnImExp.call(&[text(&arg)]);
        assert_complex_approx(&result, -1.0, 0.0, 1e-9);
    }

    #[test]
    fn test_imexp_pure_real() {
        // e^1 = e
        let result = FnImExp.call(&[text("1")]);
        assert_complex_approx(&result, std::f64::consts::E, 0.0, 1e-9);
    }

    #[test]
    fn test_imexp_half_pi_i() {
        // e^(pi/2 * i) = i
        let arg = format!("{}i", std::f64::consts::FRAC_PI_2);
        let result = FnImExp.call(&[text(&arg)]);
        assert_complex_approx(&result, 0.0, 1.0, 1e-9);
    }

    // =====================================================================
    // IMLN — natural log
    // =====================================================================

    #[test]
    fn test_imln_one() {
        // ln(1) = 0
        assert_eq!(FnImLn.call(&[text("1")]), text("0"));
    }

    #[test]
    fn test_imln_of_i() {
        // ln(i) = i*pi/2
        let result = FnImLn.call(&[text("i")]);
        assert_complex_approx(&result, 0.0, std::f64::consts::FRAC_PI_2, 1e-9);
    }

    #[test]
    fn test_imln_of_e() {
        // ln(e) = 1
        let arg = format!("{}", std::f64::consts::E);
        let result = FnImLn.call(&[text(&arg)]);
        assert_complex_approx(&result, 1.0, 0.0, 1e-9);
    }

    #[test]
    fn test_imln_of_zero() {
        // ln(0) is undefined -> #NUM!
        assert!(matches!(
            FnImLn.call(&[text("0")]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_imln_negative_one() {
        // ln(-1) = i*pi
        let result = FnImLn.call(&[text("-1")]);
        assert_complex_approx(&result, 0.0, std::f64::consts::PI, 1e-9);
    }

    // =====================================================================
    // IMLOG2 / IMLOG10
    // =====================================================================

    #[test]
    fn test_imlog2_one() {
        assert_eq!(FnImLog2.call(&[text("1")]), text("0"));
    }

    #[test]
    fn test_imlog2_two() {
        let result = FnImLog2.call(&[text("2")]);
        assert_complex_approx(&result, 1.0, 0.0, 1e-9);
    }

    #[test]
    fn test_imlog10_one() {
        assert_eq!(FnImLog10.call(&[text("1")]), text("0"));
    }

    #[test]
    fn test_imlog10_ten() {
        let result = FnImLog10.call(&[text("10")]);
        assert_complex_approx(&result, 1.0, 0.0, 1e-9);
    }

    #[test]
    fn test_imlog2_of_zero() {
        assert!(matches!(
            FnImLog2.call(&[text("0")]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_imlog10_of_zero() {
        assert!(matches!(
            FnImLog10.call(&[text("0")]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    // =====================================================================
    // IMSIN / IMCOS / IMTAN at zero (real trig identities)
    // =====================================================================

    #[test]
    fn test_imsin_zero() {
        // sin(0) = 0
        assert_eq!(FnImSin.call(&[text("0")]), text("0"));
    }

    #[test]
    fn test_imcos_zero() {
        // cos(0) = 1
        assert_eq!(FnImCos.call(&[text("0")]), text("1"));
    }

    #[test]
    fn test_imtan_zero() {
        // tan(0) = 0
        assert_eq!(FnImTan.call(&[text("0")]), text("0"));
    }

    #[test]
    fn test_imsin_pi_half() {
        // sin(pi/2) = 1
        let arg = format!("{}", std::f64::consts::FRAC_PI_2);
        let result = FnImSin.call(&[text(&arg)]);
        assert_complex_approx(&result, 1.0, 0.0, 1e-9);
    }

    #[test]
    fn test_imcos_pi() {
        // cos(pi) = -1
        let arg = format!("{}", std::f64::consts::PI);
        let result = FnImCos.call(&[text(&arg)]);
        assert_complex_approx(&result, -1.0, 0.0, 1e-9);
    }

    // =====================================================================
    // IMSINH / IMCOSH at zero
    // =====================================================================

    #[test]
    fn test_imsinh_zero() {
        // sinh(0) = 0
        assert_eq!(FnImSinh.call(&[text("0")]), text("0"));
    }

    #[test]
    fn test_imcosh_zero() {
        // cosh(0) = 1
        assert_eq!(FnImCosh.call(&[text("0")]), text("1"));
    }

    #[test]
    fn test_imsinh_pure_imaginary() {
        // sinh(i*pi/2) = i*sin(pi/2) = i
        let arg = format!("{}i", std::f64::consts::FRAC_PI_2);
        let result = FnImSinh.call(&[text(&arg)]);
        assert_complex_approx(&result, 0.0, 1.0, 1e-9);
    }

    // =====================================================================
    // IMCOT / IMCSC / IMCSCH / IMSEC / IMSECH
    // =====================================================================

    #[test]
    fn test_imcot_at_pi_over_4() {
        // cot(pi/4) = 1
        let arg = format!("{}", std::f64::consts::FRAC_PI_4);
        let result = FnImCot.call(&[text(&arg)]);
        assert_complex_approx(&result, 1.0, 0.0, 1e-9);
    }

    #[test]
    fn test_imcot_at_zero_is_error() {
        // cot(0) = cos(0)/sin(0) -> division by zero -> #NUM!
        assert!(matches!(
            FnImCot.call(&[text("0")]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_imcsc_at_pi_over_2() {
        // csc(pi/2) = 1/sin(pi/2) = 1
        let arg = format!("{}", std::f64::consts::FRAC_PI_2);
        let result = FnImCsc.call(&[text(&arg)]);
        assert_complex_approx(&result, 1.0, 0.0, 1e-9);
    }

    #[test]
    fn test_imcsc_at_zero_is_error() {
        assert!(matches!(
            FnImCsc.call(&[text("0")]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_imcsch_at_zero_is_error() {
        // csch(0) = 1/sinh(0) -> division by zero
        assert!(matches!(
            FnImCsch.call(&[text("0")]),
            CellValue::Error(CellError::Num, _)
        ));
    }

    #[test]
    fn test_imsec_at_zero() {
        // sec(0) = 1/cos(0) = 1
        let result = FnImSec.call(&[text("0")]);
        assert_complex_approx(&result, 1.0, 0.0, 1e-9);
    }

    #[test]
    fn test_imsech_at_zero() {
        // sech(0) = 1/cosh(0) = 1
        let result = FnImSech.call(&[text("0")]);
        assert_complex_approx(&result, 1.0, 0.0, 1e-9);
    }

    // =====================================================================
    // parse_complex — edge cases
    // =====================================================================

    #[test]
    fn test_parse_complex_empty() {
        assert_eq!(parse_complex(""), None);
    }

    #[test]
    fn test_parse_complex_plus_i() {
        assert_eq!(parse_complex("+i"), Some((0.0, 1.0, 'i')));
    }

    #[test]
    fn test_parse_complex_j_suffix() {
        assert_eq!(parse_complex("3+4j"), Some((3.0, 4.0, 'j')));
    }

    #[test]
    fn test_parse_complex_negative_real() {
        assert_eq!(parse_complex("-5"), Some((-5.0, 0.0, 'i')));
    }

    #[test]
    fn test_parse_complex_garbage() {
        assert_eq!(parse_complex("hello"), None);
    }

    // =====================================================================
    // format_complex — via COMPLEX function round-trips
    // =====================================================================

    #[test]
    fn test_format_complex_large_integer() {
        assert_eq!(FnComplex.call(&[num(100.0), num(200.0)]), text("100+200i"));
    }

    // =====================================================================
    // Suffix consistency errors
    // =====================================================================

    #[test]
    fn test_imsum_mixed_suffix_error() {
        // IMSUM("3+4i", "1+2j") should return #VALUE! because of mixed i/j suffixes
        let f = FnImSum;
        assert!(matches!(
            f.call(&[text("3+4i"), text("1+2j")]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn test_imsum_same_suffix_j() {
        // IMSUM("3+4j", "1+2j") should work fine with j suffix
        let f = FnImSum;
        assert_eq!(f.call(&[text("3+4j"), text("1+2j")]), text("4+6j"));
    }

    #[test]
    fn test_improduct_mixed_suffix_error() {
        // IMPRODUCT("3+4i", "1+2j") should return #VALUE!
        let f = FnImProduct;
        assert!(matches!(
            f.call(&[text("3+4i"), text("1+2j")]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn test_imsub_mixed_suffix_error() {
        // IMSUB("3+4i", "1+2j") should return #VALUE!
        let f = FnImSub;
        assert!(matches!(
            f.call(&[text("3+4i"), text("1+2j")]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn test_imdiv_mixed_suffix_error() {
        // IMDIV("3+4i", "1+2j") should return #VALUE!
        let f = FnImDiv;
        assert!(matches!(
            f.call(&[text("3+4i"), text("1+2j")]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn test_parse_complex_scientific_notation_imaginary() {
        // Pure imaginary with scientific notation: "1.5e2i" = 150i
        assert_eq!(parse_complex("1.5e2i"), Some((0.0, 150.0, 'i')));
        // Negative exponent: "2.5e-3i" = 0.0025i
        assert_eq!(parse_complex("2.5e-3i"), Some((0.0, 0.0025, 'i')));
        // Complex with scientific notation in imaginary part: "1+2.5e2i"
        assert_eq!(parse_complex("1+2.5e2i"), Some((1.0, 250.0, 'i')));
        // Complex with scientific notation in both parts: "1.5e2+2.5e-1i"
        assert_eq!(parse_complex("1.5e2+2.5e-1i"), Some((150.0, 0.25, 'i')));
    }
}
