use value_types::{CellError, CellValue};

use super::types::format_complex;
use super::wrappers::complex_unary_fn;

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
