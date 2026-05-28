use value_types::{CellError, CellValue};

use super::super::helpers::{coerce_num, coerce_str};
use super::types::{format_complex, parse_complex};
use super::wrappers::{complex_to_num_fn, complex_unary_fn};
use crate::PureFunction;

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
