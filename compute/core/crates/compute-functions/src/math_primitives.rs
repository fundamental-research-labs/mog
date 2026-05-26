//! Shared pure math primitives for evaluator intrinsics.
//!
//! These functions perform the mathematical computation that evaluator
//! intrinsics (SUM, AVERAGE, etc.) call after pre-processing arguments.
//! They are NOT registered as named functions in the registry — they are
//! utilities. The evaluator’s intrinsic does tagged evaluation → extracts
//! clean numbers → calls these.
//!
//! This module is also available as `compute_functions::math_primitives`
//! after the crate extraction for direct use by evaluator intrinsics.

use value_types::CellValue;

/// Sum a slice of f64 values. Returns 0.0 for empty slice.
///
/// Uses Kahan summation for improved numerical accuracy with large datasets.
pub fn sum_f64s(values: &[f64]) -> f64 {
    // Kahan compensated summation for accuracy
    let mut sum = 0.0_f64;
    let mut compensation = 0.0_f64;
    for &v in values {
        let y = v - compensation;
        let t = sum + y;
        // Guard: compensation is meaningless for non-finite sums (Inf - Inf = NaN)
        if t.is_finite() {
            compensation = (t - sum) - y;
        } else {
            compensation = 0.0;
        }
        sum = t;
    }
    sum
}

/// Average a slice of f64 values. Returns None if empty.
pub fn average_f64s(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(sum_f64s(values) / values.len() as f64)
}

/// Minimum of a slice of f64 values. Returns None if empty.
pub fn min_f64s(values: &[f64]) -> Option<f64> {
    values.iter().copied().reduce(f64::min)
}

/// Maximum of a slice of f64 values. Returns None if empty.
pub fn max_f64s(values: &[f64]) -> Option<f64> {
    values.iter().copied().reduce(f64::max)
}

/// Product of a slice of f64 values. Returns 1.0 for empty slice.
pub fn product_f64s(values: &[f64]) -> f64 {
    values.iter().copied().fold(1.0, |acc, v| acc * v)
}

/// COUNT semantics: count how many CellValues are numeric.
///
/// - Numbers → counted
/// - Booleans → NOT counted (Excel COUNT ignores booleans in ranges)
/// - Text that parses to number → NOT counted (only literal numbers)
/// - Errors → NOT counted
/// - Null → NOT counted
/// - Arrays → recursively counted
pub fn count_values(values: &[CellValue]) -> f64 {
    let mut count = 0.0;
    for v in values {
        match v {
            CellValue::Number(_) => count += 1.0,
            CellValue::Array(arr) => {
                for row in arr.rows_iter() {
                    count += count_values(row);
                }
            }
            _ => {}
        }
    }
    count
}

/// COUNTA semantics: count how many CellValues are non-empty.
///
/// - Null → NOT counted
/// - Everything else (numbers, text, booleans, errors) → counted
/// - Arrays → recursively counted
pub fn counta_values(values: &[CellValue]) -> f64 {
    let mut count = 0.0;
    for v in values {
        match v {
            CellValue::Null => {}
            CellValue::Array(arr) => {
                for row in arr.rows_iter() {
                    count += counta_values(row);
                }
            }
            _ => count += 1.0,
        }
    }
    count
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellValue;

    // ---- sum_f64s ----

    #[test]
    fn test_sum_empty() {
        assert_eq!(sum_f64s(&[]), 0.0);
    }

    #[test]
    fn test_sum_single() {
        assert_eq!(sum_f64s(&[42.0]), 42.0);
    }

    #[test]
    fn test_sum_multiple() {
        assert_eq!(sum_f64s(&[1.0, 2.0, 3.0]), 6.0);
    }

    #[test]
    fn test_sum_negative() {
        assert_eq!(sum_f64s(&[-1.0, -2.0, 3.0]), 0.0);
    }

    #[test]
    fn test_sum_large_dataset_accuracy() {
        // Kahan summation should handle this better than naive sum
        let values: Vec<f64> = (0..10000).map(|_| 0.1).collect();
        let result = sum_f64s(&values);
        assert!((result - 1000.0).abs() < 1e-10);
    }

    #[test]
    fn test_sum_inf() {
        assert_eq!(sum_f64s(&[f64::INFINITY, 1.0]), f64::INFINITY);
    }

    #[test]
    fn test_sum_nan() {
        assert!(sum_f64s(&[f64::NAN, 1.0]).is_nan());
    }

    // ---- average_f64s ----

    #[test]
    fn test_average_empty() {
        assert_eq!(average_f64s(&[]), None);
    }

    #[test]
    fn test_average_single() {
        assert_eq!(average_f64s(&[5.0]), Some(5.0));
    }

    #[test]
    fn test_average_multiple() {
        assert_eq!(average_f64s(&[2.0, 4.0, 6.0]), Some(4.0));
    }

    // ---- min_f64s ----

    #[test]
    fn test_min_empty() {
        assert_eq!(min_f64s(&[]), None);
    }

    #[test]
    fn test_min_single() {
        assert_eq!(min_f64s(&[7.0]), Some(7.0));
    }

    #[test]
    fn test_min_multiple() {
        assert_eq!(min_f64s(&[3.0, 1.0, 2.0]), Some(1.0));
    }

    #[test]
    fn test_min_negative() {
        assert_eq!(min_f64s(&[-5.0, -1.0, 0.0]), Some(-5.0));
    }

    // ---- max_f64s ----

    #[test]
    fn test_max_empty() {
        assert_eq!(max_f64s(&[]), None);
    }

    #[test]
    fn test_max_single() {
        assert_eq!(max_f64s(&[7.0]), Some(7.0));
    }

    #[test]
    fn test_max_multiple() {
        assert_eq!(max_f64s(&[3.0, 1.0, 2.0]), Some(3.0));
    }

    #[test]
    fn test_max_negative() {
        assert_eq!(max_f64s(&[-5.0, -1.0, 0.0]), Some(0.0));
    }

    // ---- product_f64s ----

    #[test]
    fn test_product_empty() {
        assert_eq!(product_f64s(&[]), 1.0);
    }

    #[test]
    fn test_product_single() {
        assert_eq!(product_f64s(&[5.0]), 5.0);
    }

    #[test]
    fn test_product_multiple() {
        assert_eq!(product_f64s(&[2.0, 3.0, 4.0]), 24.0);
    }

    #[test]
    fn test_product_with_zero() {
        assert_eq!(product_f64s(&[2.0, 0.0, 4.0]), 0.0);
    }

    // ---- count_values ----

    #[test]
    fn test_count_empty() {
        assert_eq!(count_values(&[]), 0.0);
    }

    #[test]
    fn test_count_numbers() {
        assert_eq!(
            count_values(&[
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0),
            ]),
            3.0
        );
    }

    #[test]
    fn test_count_ignores_text() {
        assert_eq!(
            count_values(&[
                CellValue::number(1.0),
                CellValue::Text("hello".into()),
                CellValue::number(3.0),
            ]),
            2.0
        );
    }

    #[test]
    fn test_count_ignores_booleans() {
        assert_eq!(
            count_values(&[
                CellValue::number(1.0),
                CellValue::Boolean(true),
                CellValue::Boolean(false),
            ]),
            1.0
        );
    }

    #[test]
    fn test_count_ignores_null() {
        assert_eq!(
            count_values(&[CellValue::Null, CellValue::number(1.0), CellValue::Null]),
            1.0
        );
    }

    #[test]
    fn test_count_flattens_arrays() {
        assert_eq!(
            count_values(&[CellValue::from_rows(vec![
                vec![CellValue::number(1.0), CellValue::number(2.0)],
                vec![CellValue::Text("x".into()), CellValue::number(3.0)],
            ])]),
            3.0
        );
    }

    // ---- counta_values ----

    #[test]
    fn test_counta_empty() {
        assert_eq!(counta_values(&[]), 0.0);
    }

    #[test]
    fn test_counta_counts_everything_except_null() {
        assert_eq!(
            counta_values(&[
                CellValue::number(1.0),
                CellValue::Text("hi".into()),
                CellValue::Boolean(true),
                CellValue::Null,
            ]),
            3.0
        );
    }

    #[test]
    fn test_counta_counts_errors() {
        use value_types::CellError;
        assert_eq!(
            counta_values(&[
                CellValue::Error(CellError::Value, None),
                CellValue::Error(CellError::Div0, None),
            ]),
            2.0
        );
    }

    #[test]
    fn test_counta_flattens_arrays() {
        assert_eq!(
            counta_values(&[CellValue::from_rows(vec![
                vec![CellValue::number(1.0), CellValue::Null],
                vec![CellValue::Text("x".into()), CellValue::number(3.0)],
            ])]),
            3.0
        );
    }
}
