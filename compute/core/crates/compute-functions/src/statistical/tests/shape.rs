use super::super::shape::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

fn arr(vals: Vec<f64>) -> CellValue {
    CellValue::from_rows(vec![vals.into_iter().map(num).collect()])
}

#[test]
fn test_kurt() {
    let f = FnKurt;
    // Need at least 4 data points
    assert_eq!(
        f.call(&[num(1.0), num(2.0), num(3.0)]),
        err(CellError::Div0)
    );
    // For uniform-ish data, kurtosis should be defined
    let result = f.call(&[num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)]);
    assert!(matches!(result, CellValue::Number(_)));
}

#[test]
fn test_skew() {
    let f = FnSkew;
    // Need at least 3 data points
    assert_eq!(f.call(&[num(1.0), num(2.0)]), err(CellError::Div0));
    // Symmetric data => skew near 0
    let result = f.call(&[num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)]);
    if let CellValue::Number(n) = result {
        assert!(
            n.get().abs() < 0.01,
            "skew of symmetric data was {}",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_frequency() {
    let f = FnFrequency;
    let data = arr(vec![1.0, 3.0, 5.0, 7.0, 9.0]);
    let bins = arr(vec![2.0, 6.0]);
    let result = f.call(&[data, bins]);
    // bins: <=2, <=6, >6 => vertical array [[1], [2], [2]]
    if let CellValue::Array(a) = result {
        assert_eq!(a.rows(), 3, "Expected 3 rows");
        let vals: Vec<f64> = a
            .rows_iter()
            .map(|row| {
                assert_eq!(row.len(), 1, "Expected 1 column per row");
                if let CellValue::Number(n) = row[0] {
                    n.get()
                } else {
                    panic!("Expected number")
                }
            })
            .collect();
        assert_eq!(vals, vec![1.0, 2.0, 2.0]);
    } else {
        panic!("Expected array, got {:?}", result);
    }
}

#[test]
fn test_frequency_vertical_array() {
    let f = FnFrequency;
    // FREQUENCY({1,2,3,4,5}, {2,4}) should return a vertical 3-element array
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let bins = arr(vec![2.0, 4.0]);
    let result = f.call(&[data, bins]);
    if let CellValue::Array(a) = &result {
        // Should be 3 rows, each with 1 column (vertical array)
        assert_eq!(a.rows(), 3, "Expected 3 rows for vertical array");
        for (i, row) in a.rows_iter().enumerate() {
            assert_eq!(row.len(), 1, "Row {} should have 1 column", i);
        }
        let vals: Vec<f64> = a
            .rows_iter()
            .map(|row| {
                if let CellValue::Number(n) = row[0] {
                    n.get()
                } else {
                    panic!("Expected number")
                }
            })
            .collect();
        // <=2: {1,2} => 2, <=4: {3,4} => 2, >4: {5} => 1
        assert_eq!(vals, vec![2.0, 2.0, 1.0]);
    } else {
        panic!("Expected array, got {:?}", result);
    }
}

#[test]
fn test_skew_p_with_one_value() {
    let f = FnSkewP;
    // SKEW.P with 1 value should return #DIV/0! (can't compute population std dev with 1 value)
    let result = f.call(&[num(5.0)]);
    assert_eq!(result, err(CellError::Div0));
}

#[test]
fn test_skew_p_with_two_identical_values() {
    let f = FnSkewP;
    // SKEW.P with 2 identical values should return 0 (all same = zero skewness)
    let result = f.call(&[num(5.0), num(5.0)]);
    assert_eq!(result, num(0.0));
}

#[test]
fn test_skew_p_with_two_different_values() {
    let f = FnSkewP;
    // SKEW.P with 2 different values: symmetric, should be 0
    let result = f.call(&[num(1.0), num(3.0)]);
    if let CellValue::Number(n) = result {
        assert!(
            n.get().abs() < 0.001,
            "SKEW.P of symmetric 2-element set was {}, expected ~0",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_skew_sample_still_requires_three() {
    let f = FnSkew;
    // SKEW (sample) should still require 3 values minimum
    assert_eq!(f.call(&[num(1.0), num(2.0)]), err(CellError::Div0));
    assert_eq!(f.call(&[num(1.0)]), err(CellError::Div0));
}
