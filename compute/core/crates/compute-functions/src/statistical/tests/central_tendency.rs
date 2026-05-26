use super::super::central_tendency::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

fn arr(vals: Vec<f64>) -> CellValue {
    CellValue::from_rows(vec![vals.into_iter().map(num).collect()])
}

#[test]
fn test_median_odd() {
    let f = FnMedian;
    assert_eq!(f.call(&[num(1.0), num(3.0), num(5.0)]), num(3.0));
}

#[test]
fn test_median_even() {
    let f = FnMedian;
    assert_eq!(f.call(&[num(1.0), num(2.0), num(3.0), num(4.0)]), num(2.5));
}

#[test]
fn test_mode() {
    let f = FnMode;
    assert_eq!(f.call(&[num(1.0), num(2.0), num(2.0), num(3.0)]), num(2.0));
    // No repeats => #N/A
    assert_eq!(f.call(&[num(1.0), num(2.0), num(3.0)]), err(CellError::Na));
}

#[test]
fn test_geomean() {
    let f = FnGeoMean;
    // GEOMEAN(2, 8) = sqrt(16) = 4
    let result = f.call(&[num(2.0), num(8.0)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 4.0).abs() < 0.001, "geomean was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
    // Negative values => #NUM!
    assert_eq!(f.call(&[num(-1.0), num(2.0)]), err(CellError::Num));
}

#[test]
fn test_harmean() {
    let f = FnHarMean;
    // HARMEAN(2, 4) = 2 / (1/2 + 1/4) = 2 / 0.75 = 2.667
    let result = f.call(&[num(2.0), num(4.0)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 2.667).abs() < 0.01, "harmean was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_mode_mult_sorted() {
    let f = FnModeMult;
    // MODE.MULT({3,5,3,5}) should return {3;5} (vertical, sorted ascending)
    let data = arr(vec![3.0, 5.0, 3.0, 5.0]);
    let result = f.call(&[data]);
    if let CellValue::Array(a) = result {
        // Should be a vertical array: 2 rows, each with 1 column
        assert_eq!(a.rows(), 2, "Expected 2 rows for vertical array");
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
        assert_eq!(vals, vec![3.0, 5.0], "MODE.MULT should return sorted modes");
    } else {
        panic!("Expected array, got {:?}", result);
    }
}

#[test]
fn test_mode_mult_unsorted_input() {
    let f = FnModeMult;
    // Modes 9,2,5 should be sorted to 2,5,9 (vertical array)
    let data = arr(vec![9.0, 2.0, 5.0, 9.0, 2.0, 5.0]);
    let result = f.call(&[data]);
    if let CellValue::Array(a) = result {
        assert_eq!(a.rows(), 3, "Expected 3 rows for vertical array");
        let vals: Vec<f64> = a
            .rows_iter()
            .map(|row| {
                assert_eq!(row.len(), 1, "Each row should have 1 column");
                if let CellValue::Number(n) = row[0] {
                    n.get()
                } else {
                    panic!("Expected number")
                }
            })
            .collect();
        assert_eq!(
            vals,
            vec![2.0, 5.0, 9.0],
            "MODE.MULT should return sorted modes"
        );
    } else {
        panic!("Expected array, got {:?}", result);
    }
}

#[test]
fn test_mode_mult_vertical_array() {
    let f = FnModeMult;
    // MODE.MULT should return a vertical array (N rows, 1 col) per Excel behavior
    let data = arr(vec![1.0, 2.0, 1.0, 2.0, 3.0]);
    let result = f.call(&[data]);
    if let CellValue::Array(a) = result {
        // Two modes: 1 and 2, each should be in its own row
        assert_eq!(a.rows(), 2, "Expected 2 rows (vertical)");
        for row in a.rows_iter() {
            assert_eq!(row.len(), 1, "Each row should have exactly 1 column");
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
        assert_eq!(vals, vec![1.0, 2.0]);
    } else {
        panic!("Expected array, got {:?}", result);
    }
}

#[test]
fn test_median_five_elements_odd() {
    // MEDIAN({1,2,3,4,5}) = 3 (middle of sorted odd-length)
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MEDIAN", &[arr(vec![1.0, 2.0, 3.0, 4.0, 5.0])]),
        num(3.0)
    );
}

#[test]
fn test_median_four_elements_even() {
    // MEDIAN({1,2,3,4}) = 2.5 (average of 2 and 3)
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MEDIAN", &[arr(vec![1.0, 2.0, 3.0, 4.0])]),
        num(2.5)
    );
}

#[test]
fn test_median_unsorted_input() {
    // MEDIAN({5,1,3,2,4}) = 3 regardless of input order
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MEDIAN", &[arr(vec![5.0, 1.0, 3.0, 2.0, 4.0])]),
        num(3.0)
    );
}

#[test]
fn test_median_single_element() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(reg.call("MEDIAN", &[num(1.0)]), num(1.0));
}

#[test]
fn test_median_two_elements() {
    // MEDIAN({10,20}) = 15
    let reg = crate::FunctionRegistry::new();
    assert_eq!(reg.call("MEDIAN", &[arr(vec![10.0, 20.0])]), num(15.0));
}

#[test]
fn test_median_empty_gives_num_error() {
    let f = FnMedian;
    assert_eq!(f.call(&[CellValue::Null]), err(CellError::Num));
}

#[test]
fn test_median_with_negative_numbers() {
    // MEDIAN({-5, -1, 0, 1, 5}) = 0
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MEDIAN", &[arr(vec![-5.0, -1.0, 0.0, 1.0, 5.0])]),
        num(0.0)
    );
}

#[test]
fn test_mode_sngl_most_frequent() {
    // MODE.SNGL({1,2,2,3,3,3}) = 3
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MODE.SNGL", &[arr(vec![1.0, 2.0, 2.0, 3.0, 3.0, 3.0])]),
        num(3.0)
    );
}

#[test]
fn test_mode_sngl_no_repeats() {
    // MODE.SNGL({1,2,3}) -> #N/A
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MODE.SNGL", &[arr(vec![1.0, 2.0, 3.0])]),
        err(CellError::Na)
    );
}

#[test]
fn test_mode_sngl_returns_first_encountered_mode() {
    // When two values tie for max count, MODE returns the first encountered
    // {1,1,2,2} -> both appear twice, MODE returns 1 (first encountered)
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MODE.SNGL", &[arr(vec![1.0, 1.0, 2.0, 2.0])]),
        num(1.0)
    );
}

#[test]
fn test_mode_empty_gives_na() {
    let f = FnMode;
    assert_eq!(f.call(&[CellValue::Null]), err(CellError::Na));
}

#[test]
fn test_mode_sngl_is_alias_for_mode() {
    // MODE.SNGL delegates to MODE
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![4.0, 4.0, 5.0, 5.0, 5.0]);
    assert_eq!(
        reg.call("MODE", std::slice::from_ref(&data)),
        reg.call("MODE.SNGL", &[data])
    );
}

#[test]
fn test_mode_mult_multiple_modes() {
    // MODE.MULT({1,1,2,2,3}) = {1, 2} (both appear twice, 3 appears once)
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("MODE.MULT", &[arr(vec![1.0, 1.0, 2.0, 2.0, 3.0])]);
    if let CellValue::Array(a) = result {
        assert_eq!(a.rows(), 2);
        let vals: Vec<f64> = a
            .rows_iter()
            .map(|row| {
                if let CellValue::Number(n) = row[0] {
                    n.get()
                } else {
                    panic!("not number")
                }
            })
            .collect();
        assert_eq!(vals, vec![1.0, 2.0]);
    } else {
        panic!("Expected array, got {:?}", result);
    }
}

#[test]
fn test_mode_mult_no_repeats() {
    // MODE.MULT({1,2,3}) -> #N/A (no value repeats)
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("MODE.MULT", &[arr(vec![1.0, 2.0, 3.0])]),
        err(CellError::Na)
    );
}

#[test]
fn test_mode_mult_single_mode() {
    // When only one value repeats, MODE.MULT returns a 1-element column array
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("MODE.MULT", &[arr(vec![1.0, 2.0, 2.0, 3.0])]);
    if let CellValue::Array(a) = result {
        assert_eq!(a.rows(), 1);
        let vals: Vec<f64> = a
            .rows_iter()
            .map(|row| {
                if let CellValue::Number(n) = row[0] {
                    n.get()
                } else {
                    panic!("not number")
                }
            })
            .collect();
        assert_eq!(vals, vec![2.0]);
    } else {
        panic!("Expected array, got {:?}", result);
    }
}

#[test]
fn test_mode_mult_empty() {
    let f = FnModeMult;
    assert_eq!(f.call(&[CellValue::Null]), err(CellError::Na));
}

#[test]
fn test_averagea_bool_and_text() {
    // AVERAGEA({TRUE, FALSE, 1, "text"}) -> TRUE=1, FALSE=0, 1=1, "text"=0 -> avg=0.5
    let reg = crate::FunctionRegistry::new();
    let result = reg.call(
        "AVERAGEA",
        &[
            CellValue::Boolean(true),
            CellValue::Boolean(false),
            num(1.0),
            text("text"),
        ],
    );
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 0.5).abs() < 1e-10,
            "AVERAGEA was {}, expected 0.5",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_averagea_numeric_text() {
    // AVERAGEA({"5", 3}) -> "5" parses to 5.0, avg = (5+3)/2 = 4
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("AVERAGEA", &[text("5"), num(3.0)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 4.0).abs() < 1e-10,
            "AVERAGEA was {}, expected 4.0",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_averagea_empty_gives_div0() {
    let f = FnAverageA;
    assert_eq!(f.call(&[CellValue::Null]), err(CellError::Div0));
}

#[test]
fn test_averagea_all_numbers() {
    // AVERAGEA({1,2,3,4,5}) = 3 (same as AVERAGE for pure numbers)
    let reg = crate::FunctionRegistry::new();
    let result = reg.call(
        "AVERAGEA",
        &[num(1.0), num(2.0), num(3.0), num(4.0), num(5.0)],
    );
    assert_eq!(result, num(3.0));
}

#[test]
fn test_geomean_equal_values() {
    // GEOMEAN({4,4,4}) = 4 (geometric mean of equal values is that value)
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("GEOMEAN", &[num(4.0), num(4.0), num(4.0)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 4.0).abs() < 1e-10, "GEOMEAN was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_geomean_two_values() {
    // GEOMEAN({2,8}) = sqrt(16) = 4
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("GEOMEAN", &[num(2.0), num(8.0)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 4.0).abs() < 1e-10, "GEOMEAN was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_geomean_negative_gives_num_error() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("GEOMEAN", &[num(-1.0), num(4.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_geomean_zero_gives_num_error() {
    // GEOMEAN requires all positive values; zero is not positive
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("GEOMEAN", &[num(0.0), num(4.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_geomean_empty_gives_num_error() {
    let f = FnGeoMean;
    assert_eq!(f.call(&[CellValue::Null]), err(CellError::Num));
}

#[test]
fn test_geomean_single_value() {
    // GEOMEAN({7}) = 7
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("GEOMEAN", &[num(7.0)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 7.0).abs() < 1e-10, "GEOMEAN was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_harmean_three_values() {
    // HARMEAN({1,2,4}) = 3 / (1/1 + 1/2 + 1/4) = 3 / 1.75 = 12/7 ~ 1.71429
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("HARMEAN", &[num(1.0), num(2.0), num(4.0)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 12.0 / 7.0).abs() < 1e-10,
            "HARMEAN was {}, expected {}",
            n.get(),
            12.0 / 7.0
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_harmean_zero_gives_num_error() {
    // HARMEAN with zero -> division by zero internally -> #NUM!
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("HARMEAN", &[num(0.0), num(1.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_harmean_negative_gives_num_error() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("HARMEAN", &[num(-1.0), num(2.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_harmean_equal_values() {
    // HARMEAN({5,5,5}) = 5 (harmonic mean of equal values is that value)
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("HARMEAN", &[num(5.0), num(5.0), num(5.0)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 5.0).abs() < 1e-10, "HARMEAN was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_harmean_empty_gives_num_error() {
    let f = FnHarMean;
    assert_eq!(f.call(&[CellValue::Null]), err(CellError::Num));
}

#[test]
fn test_trimmean_twenty_percent() {
    // TRIMMEAN({1..10}, 0.2) -> trim 1 from each end -> avg({2..9}) = 5.5
    let reg = crate::FunctionRegistry::new();
    let result = reg.call(
        "TRIMMEAN",
        &[
            arr(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]),
            num(0.2),
        ],
    );
    if let CellValue::Number(n) = result {
        assert!((n.get() - 5.5).abs() < 1e-10, "TRIMMEAN was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_trimmean_zero_percent_equals_average() {
    // TRIMMEAN(data, 0) = arithmetic mean (no trimming)
    // {1,2,3,4,5} -> mean = 15/5 = 3
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    let result = reg.call("TRIMMEAN", &[data, num(0.0)]);
    assert_eq!(result, num(3.0));
}

#[test]
fn test_trimmean_invalid_percent_gives_num_error() {
    // percent >= 1 -> #NUM!
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("TRIMMEAN", &[arr(vec![1.0, 2.0, 3.0]), num(1.0)]),
        err(CellError::Num)
    );
    // percent < 0 -> #NUM!
    assert_eq!(
        reg.call("TRIMMEAN", &[arr(vec![1.0, 2.0, 3.0]), num(-0.1)]),
        err(CellError::Num)
    );
}

#[test]
fn test_trimmean_empty_gives_num_error() {
    let f = FnTrimMean;
    assert_eq!(f.call(&[CellValue::Null, num(0.1)]), err(CellError::Num));
}

#[test]
fn test_trimmean_high_trim_leaves_middle() {
    // {1,2,3,4,5}, 0.8 -> trim 2 from each end -> avg({3}) = 3
    let reg = crate::FunctionRegistry::new();
    let result = reg.call("TRIMMEAN", &[arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]), num(0.8)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 3.0).abs() < 1e-10, "TRIMMEAN was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_geomean_leq_arithmetic_mean() {
    // AM-GM inequality: geometric mean <= arithmetic mean
    // GEOMEAN({2,8}) = 4, arithmetic mean = (2+8)/2 = 5, so 4 <= 5
    let reg = crate::FunctionRegistry::new();
    let geo = reg.call("GEOMEAN", &[num(2.0), num(8.0)]);
    if let CellValue::Number(g) = geo {
        let am = (2.0 + 8.0) / 2.0; // = 5.0
        assert!(
            g.get() <= am + 1e-10,
            "GM {} should be <= AM {}",
            g.get(),
            am
        );
        assert!(
            (g.get() - 4.0).abs() < 1e-10,
            "GM should be 4, got {}",
            g.get()
        );
    } else {
        panic!("Expected number, got {:?}", geo);
    }
}

#[test]
fn test_harmean_leq_geomean() {
    // HM <= GM always for positive values
    let reg = crate::FunctionRegistry::new();
    let hm = reg.call("HARMEAN", &[num(1.0), num(4.0)]);
    let gm = reg.call("GEOMEAN", &[num(1.0), num(4.0)]);
    if let (CellValue::Number(h), CellValue::Number(g)) = (hm, gm) {
        assert!(
            h.get() <= g.get() + 1e-10,
            "HM {} should be <= GM {}",
            h.get(),
            g.get()
        );
    } else {
        panic!("Expected numbers");
    }
}
