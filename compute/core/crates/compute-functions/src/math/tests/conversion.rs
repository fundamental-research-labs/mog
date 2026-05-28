use super::super::conversion::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_arabic() {
    assert_eq!(FnArabic.call(&[text("XIV")]), num(14.0));
    assert_eq!(FnArabic.call(&[text("MCMXCIX")]), num(1999.0));
    assert_eq!(FnArabic.call(&[text("")]), num(0.0));
}

#[test]
fn test_base() {
    assert_eq!(
        FnBase.call(&[num(15.0), num(16.0)]),
        CellValue::Text("F".into())
    );
    assert_eq!(
        FnBase.call(&[num(10.0), num(2.0)]),
        CellValue::Text("1010".into())
    );
    assert_eq!(
        FnBase.call(&[num(10.0), num(2.0), num(8.0)]),
        CellValue::Text("00001010".into())
    );
}

#[test]
fn test_decimal() {
    assert_eq!(FnDecimal.call(&[text("FF"), num(16.0)]), num(255.0));
    assert_eq!(FnDecimal.call(&[text("1010"), num(2.0)]), num(10.0));
}

#[test]
fn test_roman() {
    assert_eq!(
        FnRoman.call(&[num(499.0)]),
        CellValue::Text("CDXCIX".into())
    );
    assert_eq!(
        FnRoman.call(&[num(2024.0)]),
        CellValue::Text("MMXXIV".into())
    );
    assert_eq!(FnRoman.call(&[num(0.0)]), err(CellError::Value));
    assert_eq!(FnRoman.call(&[num(4000.0)]), err(CellError::Value));
}

#[test]
fn test_roman_form_0_classic() {
    assert_eq!(
        FnRoman.call(&[num(499.0), num(0.0)]),
        CellValue::Text("CDXCIX".into())
    );
    assert_eq!(
        FnRoman.call(&[num(999.0), num(0.0)]),
        CellValue::Text("CMXCIX".into())
    );
}

#[test]
fn test_roman_form_1() {
    // ROMAN(499, 1) = "LDVLIV"  (LD=450, VL=45, IV=4)
    assert_eq!(
        FnRoman.call(&[num(499.0), num(1.0)]),
        CellValue::Text("LDVLIV".into())
    );
    // ROMAN(999, 1) = "LMVLIV"  (LM=950, VL=45, IV=4)
    assert_eq!(
        FnRoman.call(&[num(999.0), num(1.0)]),
        CellValue::Text("LMVLIV".into())
    );
}

#[test]
fn test_roman_form_2() {
    // ROMAN(499, 2) = "XDIX"  (XD=490, IX=9)
    assert_eq!(
        FnRoman.call(&[num(499.0), num(2.0)]),
        CellValue::Text("XDIX".into())
    );
    // ROMAN(999, 2) = "XMIX"  (XM=990, IX=9)
    assert_eq!(
        FnRoman.call(&[num(999.0), num(2.0)]),
        CellValue::Text("XMIX".into())
    );
}

#[test]
fn test_roman_form_3() {
    // ROMAN(499, 3) = "VDIV"  (VD=495, IV=4)
    assert_eq!(
        FnRoman.call(&[num(499.0), num(3.0)]),
        CellValue::Text("VDIV".into())
    );
    // ROMAN(999, 3) = "VMIV"  (VM=995, IV=4)
    assert_eq!(
        FnRoman.call(&[num(999.0), num(3.0)]),
        CellValue::Text("VMIV".into())
    );
}

#[test]
fn test_roman_form_4_simplified() {
    // ROMAN(499, 4) = "ID"
    assert_eq!(
        FnRoman.call(&[num(499.0), num(4.0)]),
        CellValue::Text("ID".into())
    );
    // ROMAN(999, 4) = "IM"
    assert_eq!(
        FnRoman.call(&[num(999.0), num(4.0)]),
        CellValue::Text("IM".into())
    );
}

#[test]
fn test_roman_form_default_is_classic() {
    // Without form parameter, should use form 0 (classic)
    assert_eq!(
        FnRoman.call(&[num(499.0)]),
        CellValue::Text("CDXCIX".into())
    );
}

#[test]
fn test_roman_form_invalid() {
    assert_eq!(FnRoman.call(&[num(100.0), num(5.0)]), err(CellError::Value));
    assert_eq!(
        FnRoman.call(&[num(100.0), num(-1.0)]),
        err(CellError::Value)
    );
}

// -----------------------------------------------------------------------
// Edge-case tests for extreme float values (Issue fixes)
// -----------------------------------------------------------------------
