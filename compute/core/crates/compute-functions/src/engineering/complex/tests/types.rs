use super::super::arithmetic::{FnImProduct, FnImSub, FnImSum};
use super::super::components::{FnComplex, FnImAbs, FnImConjugate, FnImReal, FnImaginary};
use super::super::types::parse_complex;
use super::helpers::*;
use crate::PureFunction;

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
