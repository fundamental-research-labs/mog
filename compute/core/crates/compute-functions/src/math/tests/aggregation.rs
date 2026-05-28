use super::super::aggregation::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_percentof_standalone_sums_ranges() {
    let f = FnPercentOf;
    let subset = CellValue::from_rows(vec![
        vec![num(10.0), text("ignored")],
        vec![CellValue::Null, num(5.0)],
    ]);
    let all = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
    assert_eq!(f.call(&[subset, all]), num(0.25));
    assert_eq!(f.call(&[num(1.0), CellValue::Null]), err(CellError::Div0));
}

#[test]
fn test_seriessum() {
    let coeffs = CellValue::from_rows(vec![vec![num(1.0), num(1.0), num(1.0)]]);
    // 1*2^0 + 1*2^1 + 1*2^2 = 1 + 2 + 4 = 7
    assert_eq!(
        FnSeriesSum.call(&[num(2.0), num(0.0), num(1.0), coeffs]),
        num(7.0)
    );
}

// --- Tests for matrix functions ---

#[test]
fn test_sumsq() {
    // 1^2 + 2^2 + 3^2 = 1 + 4 + 9 = 14
    assert_eq!(FnSumsq.call(&[num(1.0), num(2.0), num(3.0)]), num(14.0));
}

#[test]
fn test_sumx2my2() {
    let xs = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
    let ys = CellValue::from_rows(vec![vec![num(4.0), num(5.0), num(6.0)]]);
    // (1-16) + (4-25) + (9-36) = -15 + -21 + -27 = -63
    assert_eq!(FnSumx2my2.call(&[xs, ys]), num(-63.0));
}

#[test]
fn test_sumx2py2() {
    let xs = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
    let ys = CellValue::from_rows(vec![vec![num(3.0), num(4.0)]]);
    // (1+9) + (4+16) = 10 + 20 = 30
    assert_eq!(FnSumx2py2.call(&[xs, ys]), num(30.0));
}

#[test]
fn test_sumxmy2() {
    let xs = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
    let ys = CellValue::from_rows(vec![vec![num(3.0), num(4.0)]]);
    // (1-3)^2 + (2-4)^2 = 4 + 4 = 8
    assert_eq!(FnSumxmy2.call(&[xs, ys]), num(8.0));
}

// --- Tests for conversion functions ---
