use super::super::super::dynamic_arrays::*;
use super::super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

// =======================================================================
// SEQUENCE tests
// =======================================================================

#[test]
fn test_sequence_basic() {
    let f = FnSequence;
    let result = f.call(&[num(3.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(arr.row(0), vec![num(1.0)]);
            assert_eq!(arr.row(1), vec![num(2.0)]);
            assert_eq!(arr.row(2), vec![num(3.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sequence_rows_and_cols() {
    let f = FnSequence;
    let result = f.call(&[num(3.0), num(2.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(arr.row(0), vec![num(1.0), num(2.0)]);
            assert_eq!(arr.row(1), vec![num(3.0), num(4.0)]);
            assert_eq!(arr.row(2), vec![num(5.0), num(6.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sequence_custom_start_step() {
    let f = FnSequence;
    let result = f.call(&[num(3.0), num(2.0), num(10.0), num(5.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(arr.row(0), vec![num(10.0), num(15.0)]);
            assert_eq!(arr.row(1), vec![num(20.0), num(25.0)]);
            assert_eq!(arr.row(2), vec![num(30.0), num(35.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sequence_negative_step() {
    let f = FnSequence;
    let result = f.call(&[num(4.0), num(1.0), num(10.0), num(-2.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 4);
            assert_eq!(arr.row(0), vec![num(10.0)]);
            assert_eq!(arr.row(1), vec![num(8.0)]);
            assert_eq!(arr.row(2), vec![num(6.0)]);
            assert_eq!(arr.row(3), vec![num(4.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sequence_zero_step() {
    let f = FnSequence;
    let result = f.call(&[num(3.0), num(1.0), num(5.0), num(0.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(arr.row(0), vec![num(5.0)]);
            assert_eq!(arr.row(1), vec![num(5.0)]);
            assert_eq!(arr.row(2), vec![num(5.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sequence_single_cell() {
    let f = FnSequence;
    let result = f.call(&[num(1.0), num(1.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.row(0), vec![num(1.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sequence_errors() {
    let f = FnSequence;
    // rows <= 0 → #CALC!
    assert_eq!(f.call(&[num(0.0)]), err(CellError::Calc));
    assert_eq!(f.call(&[num(-1.0)]), err(CellError::Calc));
    // cols <= 0 → #CALC!
    assert_eq!(f.call(&[num(3.0), num(0.0)]), err(CellError::Calc));
    // text arg → #VALUE!
    assert_eq!(f.call(&[text("abc")]), err(CellError::Value));
}

#[test]
fn test_sequence_rejects_arrays_larger_than_a_sheet() {
    let f = FnSequence;
    // More rows or columns than a sheet has
    assert_calc_error(f.call(&[num(1_048_577.0)]), "SEQUENCE(1048577)");
    assert_calc_error(f.call(&[num(1.0), num(16_385.0)]), "SEQUENCE(1,16385)");
    // More than 2,000,000 cells
    assert_calc_error(f.call(&[num(2_000.0), num(1_001.0)]), "SEQUENCE(2000,1001)");
    // Rejected before anything is allocated
    assert_calc_error(f.call(&[num(1e9)]), "SEQUENCE(1E9)");
    assert_calc_error(f.call(&[num(1e300), num(1e300)]), "SEQUENCE(1E300,1E300)");

    // A full sheet column still fits
    match f.call(&[num(1_048_576.0)]) {
        CellValue::Array(arr) => assert_eq!((arr.rows(), arr.cols()), (1_048_576, 1)),
        other => panic!("SEQUENCE(1048576): expected an array, got {other:?}"),
    }
}
