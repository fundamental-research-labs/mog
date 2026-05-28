use super::super::super::dynamic_arrays::*;
use super::super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_sortby() {
    let f = FnSortBy;
    let arr = CellValue::from_rows(vec![
        vec![text("c"), num(3.0)],
        vec![text("a"), num(1.0)],
        vec![text("b"), num(2.0)],
    ]);
    let by_arr = CellValue::from_rows(vec![vec![num(3.0)], vec![num(1.0)], vec![num(2.0)]]);
    let result = f.call(&[arr, by_arr, num(1.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(*arr.get(0, 0).unwrap(), text("a"));
            assert_eq!(*arr.get(1, 0).unwrap(), text("b"));
            assert_eq!(*arr.get(2, 0).unwrap(), text("c"));
        }
        _ => panic!("Expected array"),
    }
}

// =======================================================================
// SORTBY multi-key tests
// =======================================================================

#[test]
fn test_sortby_multi_key() {
    let f = FnSortBy;
    let arr = CellValue::from_rows(vec![
        vec![text("A"), num(2.0)],
        vec![text("B"), num(1.0)],
        vec![text("A"), num(1.0)],
        vec![text("B"), num(2.0)],
    ]);
    let key1 = CellValue::from_rows(vec![
        vec![text("A")],
        vec![text("B")],
        vec![text("A")],
        vec![text("B")],
    ]);
    let key2 = CellValue::from_rows(vec![
        vec![num(2.0)],
        vec![num(1.0)],
        vec![num(1.0)],
        vec![num(2.0)],
    ]);
    // Sort by key1 asc, then key2 asc
    let result = f.call(&[arr, key1, num(1.0), key2, num(1.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 4);
            assert_eq!(arr.row(0), vec![text("A"), num(1.0)]);
            assert_eq!(arr.row(1), vec![text("A"), num(2.0)]);
            assert_eq!(arr.row(2), vec![text("B"), num(1.0)]);
            assert_eq!(arr.row(3), vec![text("B"), num(2.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sortby_descending() {
    let f = FnSortBy;
    let arr = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)], vec![num(3.0)]]);
    let by = CellValue::from_rows(vec![vec![num(10.0)], vec![num(30.0)], vec![num(20.0)]]);
    let result = f.call(&[arr, by, num(-1.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), num(2.0)); // by=30
            assert_eq!(*arr.get(1, 0).unwrap(), num(3.0)); // by=20
            assert_eq!(*arr.get(2, 0).unwrap(), num(1.0)); // by=10
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sortby_mismatched_lengths() {
    let f = FnSortBy;
    let arr = CellValue::from_rows(vec![vec![num(1.0)], vec![num(2.0)]]);
    let by = CellValue::from_rows(vec![vec![num(10.0)]]);
    // by_array has 1 element, array has 2 rows → #VALUE!
    assert_eq!(f.call(&[arr, by]), err(CellError::Value));
}

#[test]
fn test_sortby_horizontal() {
    let f = FnSortBy;
    // Single row: =SORTBY({30,10,20}, {3,1,2}, 1) → {10,20,30}
    let arr = CellValue::from_rows(vec![vec![num(30.0), num(10.0), num(20.0)]]);
    let by = CellValue::from_rows(vec![vec![num(3.0), num(1.0), num(2.0)]]);
    let result = f.call(&[arr, by, num(1.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.row(0), vec![num(10.0), num(20.0), num(30.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sortby_horizontal_descending() {
    let f = FnSortBy;
    // Single row descending: =SORTBY({30,10,20}, {3,1,2}, -1) → {30,20,10}
    let arr = CellValue::from_rows(vec![vec![num(30.0), num(10.0), num(20.0)]]);
    let by = CellValue::from_rows(vec![vec![num(3.0), num(1.0), num(2.0)]]);
    let result = f.call(&[arr, by, num(-1.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.row(0), vec![num(30.0), num(20.0), num(10.0)]);
        }
        _ => panic!("Expected array"),
    }
}

#[test]
fn test_sortby_horizontal_with_text() {
    let f = FnSortBy;
    // Simulates =SORTBY($C$7:$G$7, $C$6:$G$6, 1) with text values
    let arr = CellValue::from_rows(vec![vec![
        text("e"),
        text("c"),
        text("a"),
        text("d"),
        text("b"),
    ]]);
    let by = CellValue::from_rows(vec![vec![num(5.0), num(3.0), num(1.0), num(4.0), num(2.0)]]);
    let result = f.call(&[arr, by, num(1.0)]);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(
                arr.row(0),
                vec![text("a"), text("b"), text("c"), text("d"), text("e")]
            );
        }
        _ => panic!("Expected array"),
    }
}
