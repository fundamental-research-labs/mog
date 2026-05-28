use super::super::super::test_helpers::{bool_val, err, null, num, text};
use super::super::split::FnTextSplit;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_textsplit_basic() {
    let f = FnTextSplit;
    let result = f.call(&[text("a,b,c"), text(",")]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_textsplit_row_and_col() {
    let f = FnTextSplit;
    let result = f.call(&[text("a,b;c,d"), text(","), text(";")]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.row(0), &[text("a"), text("b")]);
            assert_eq!(arr.row(1), &[text("c"), text("d")]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_textsplit_single_value() {
    let f = FnTextSplit;
    assert_eq!(f.call(&[text("hello"), text(",")]), text("hello"));
}

#[test]
fn test_textsplit_unicode_no_panic() {
    let f = FnTextSplit;
    let result = f.call(&[text("a\u{2615}b\u{2615}c"), text("\u{2615}")]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_textsplit_horizontal() {
    let result = FnTextSplit.call(&[text("a,b,c"), text(",")]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_2d_row_and_col() {
    let result = FnTextSplit.call(&[text("a,b;c,d"), text(","), text(";")]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.cols(), 2);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            assert_eq!(arr.get(1, 0).unwrap(), &text("c"));
            assert_eq!(arr.get(1, 1).unwrap(), &text("d"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_no_match_single_value() {
    assert_eq!(FnTextSplit.call(&[text("hello"), text(",")]), text("hello"));
}

#[test]
fn test_textsplit_ignore_empty_true() {
    let result = FnTextSplit.call(&[text("a,,b"), text(","), null(), bool_val(true)]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.cols(), 2);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_ignore_empty_false() {
    let result = FnTextSplit.call(&[text("a,,b"), text(","), null(), bool_val(false)]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text(""));
            assert_eq!(arr.get(0, 2).unwrap(), &text("b"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_case_insensitive() {
    let result = FnTextSplit.call(&[text("aXbxC"), text("x"), null(), bool_val(false), num(1.0)]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            assert_eq!(arr.get(0, 2).unwrap(), &text("C"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_array_column_delimiters_case_insensitive() {
    let delimiters = CellValue::from_rows(vec![vec![text("x"), text("y")]]);
    let result = FnTextSplit.call(&[text("aXbYc"), delimiters, null(), bool_val(false), num(1.0)]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_array_row_delimiters() {
    let row_delimiters = CellValue::from_rows(vec![vec![text(";"), text("|")]]);
    let result = FnTextSplit.call(&[text("a;b|c"), null(), row_delimiters]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(arr.cols(), 1);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(1, 0).unwrap(), &text("b"));
            assert_eq!(arr.get(2, 0).unwrap(), &text("c"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_array_delimiters_preserve_multi_character_order() {
    let delimiters = CellValue::from_rows(vec![vec![text("--"), text("|")]]);
    let result = FnTextSplit.call(&[text("a--b|c"), delimiters]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_uneven_rows_padded() {
    let result = FnTextSplit.call(&[text("a,b;c"), text(","), text(";")]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.cols(), 2);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            assert_eq!(arr.get(1, 0).unwrap(), &text("c"));
            assert_eq!(arr.get(1, 1).unwrap(), &err(CellError::Na));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_only_row_delimiter() {
    let result = FnTextSplit.call(&[text("a;b;c"), null(), text(";")]);
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(arr.cols(), 1);
            assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
            assert_eq!(arr.get(1, 0).unwrap(), &text("b"));
            assert_eq!(arr.get(2, 0).unwrap(), &text("c"));
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_textsplit_error_propagation() {
    assert_eq!(
        FnTextSplit.call(&[err(CellError::Ref), text(",")]),
        err(CellError::Ref)
    );
}
