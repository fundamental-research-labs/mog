use value_types::{CellError, CellValue};

use super::types::format_complex;
use super::wrappers::complex_unary_fn;

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
