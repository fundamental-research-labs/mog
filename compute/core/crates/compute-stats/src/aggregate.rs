//! Analytical aggregation functions.
//!
//! 12 aggregate functions with configurable semantics.  E.g., `count` only
//! counts numbers, `average` returns `Null` for empty input.
//!
//! All value classification (blank detection, numeric detection) and key
//! generation delegates to the canonical [`super::values`] module.  No local
//! normalization logic exists in this file.
//!
//! Numerical accuracy:
//! - Summation uses Kahan compensated summation via [`super::values::kahan_sum`].
//! - Variance / standard deviation uses Welford's online algorithm.

use std::collections::HashSet;

use value_types::CellValue;

use super::types::AggregateFunction;
use super::values::{
    GroupKey, cell_value_is_numeric, cell_value_to_group_key, kahan_sum, welford_online,
};

// ============================================================================
// Helper functions
// ============================================================================

/// Iterator over finite numeric values in a `CellValue` slice.
///
/// Yields the `f64` payload of every `CellValue::Number(n)` where `n` is
/// finite.  NaN, Infinity, and all non-Number variants are skipped.
#[inline]
fn numeric_iter(values: &[CellValue]) -> impl Iterator<Item = f64> + '_ {
    values.iter().filter_map(|v| {
        if cell_value_is_numeric(v) {
            v.as_number()
        } else {
            None
        }
    })
}

/// Welford's online algorithm for numerically stable variance computation.
///
/// Returns `(mean, m2, count)` where `population_variance = m2 / count`.
/// Single-pass, avoids catastrophic cancellation with large close-together
/// values.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
fn welford_accumulate(values: &[CellValue]) -> (f64, f64, u64) {
    welford_online(numeric_iter(values))
}

// ============================================================================
// Aggregate function implementations
// ============================================================================

/// Sum of numeric values using Kahan compensated summation.
/// Returns `Null` for empty input (Excel pivot tables show blank for empty aggregations).
fn pivot_sum(values: &[CellValue]) -> CellValue {
    let mut iter = numeric_iter(values).peekable();
    if iter.peek().is_none() {
        return CellValue::Null;
    }
    CellValue::number(kahan_sum(iter))
}

/// Count of numeric values only (like OOXML `countNums`).
/// Returns `Null` for empty input (Excel pivot tables show blank for empty aggregations).
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
fn pivot_count(values: &[CellValue]) -> CellValue {
    let count = numeric_iter(values).count();
    if count == 0 {
        CellValue::Null
    } else {
        CellValue::number(count as f64)
    }
}

/// Count of non-blank values (like Excel `COUNTA`).
/// Returns `Null` for empty input (Excel pivot tables show blank for empty aggregations).
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
fn pivot_counta(values: &[CellValue]) -> CellValue {
    let count = values.iter().filter(|v| !v.is_visually_blank()).count();
    if count == 0 {
        CellValue::Null
    } else {
        CellValue::number(count as f64)
    }
}

/// Count of unique non-blank values.
///
/// Uses the canonical [`cell_value_to_group_key`] for deduplication, which means:
/// - Case-insensitive text comparison (`"A"` and `"a"` are the same key).
/// - No trimming: `"  hello  "` and `"hello"` are *different* keys.
/// - Typed variants prevent cross-type collisions (Number vs Text).
/// - Negative zero canonicalized to positive zero.
/// - All NaN bit patterns map to one canonical key.
///
/// Returns `Null` for empty input (Excel pivot tables show blank for empty aggregations).
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
fn pivot_countunique(values: &[CellValue]) -> CellValue {
    let seen: HashSet<GroupKey> = values
        .iter()
        .filter(|v| !v.is_visually_blank())
        .map(cell_value_to_group_key)
        .collect();
    if seen.is_empty() {
        CellValue::Null
    } else {
        CellValue::number(seen.len() as f64)
    }
}

/// Average of numeric values using Welford's algorithm.
/// Returns `Null` for empty input.
fn pivot_average(values: &[CellValue]) -> CellValue {
    let (mean, _, count) = welford_accumulate(values);
    if count == 0 {
        return CellValue::Null;
    }
    CellValue::number(mean)
}

/// Minimum numeric value.  Returns `Null` for empty input.
fn pivot_min(values: &[CellValue]) -> CellValue {
    let mut min = f64::INFINITY;
    let mut found = false;
    for n in numeric_iter(values) {
        found = true;
        if n < min {
            min = n;
        }
    }
    if found {
        CellValue::number(min)
    } else {
        CellValue::Null
    }
}

/// Maximum numeric value.  Returns `Null` for empty input.
fn pivot_max(values: &[CellValue]) -> CellValue {
    let mut max = f64::NEG_INFINITY;
    let mut found = false;
    for n in numeric_iter(values) {
        found = true;
        if n > max {
            max = n;
        }
    }
    if found {
        CellValue::number(max)
    } else {
        CellValue::Null
    }
}

/// Product of numeric values.  Returns `Null` for empty input
/// (Excel pivot tables show blank for empty aggregations).
fn pivot_product(values: &[CellValue]) -> CellValue {
    let mut product = 1.0_f64;
    let mut found = false;
    for n in numeric_iter(values) {
        found = true;
        product *= n;
    }
    if found {
        CellValue::number(product)
    } else {
        CellValue::Null
    }
}

/// Sample standard deviation.  Returns `Null` if fewer than 2 numeric values.
/// Uses Welford's algorithm for numerical stability.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
fn pivot_stdev(values: &[CellValue]) -> CellValue {
    let (_, m2, count) = welford_accumulate(values);
    if count < 2 {
        return CellValue::Null;
    }
    CellValue::number((m2 / (count - 1) as f64).sqrt())
}

/// Population standard deviation.  Returns `Null` for empty input.
/// Uses Welford's algorithm for numerical stability.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
fn pivot_stdevp(values: &[CellValue]) -> CellValue {
    let (_, m2, count) = welford_accumulate(values);
    if count == 0 {
        return CellValue::Null;
    }
    CellValue::number((m2 / count as f64).sqrt())
}

/// Sample variance.  Returns `Null` if fewer than 2 numeric values.
/// Uses Welford's algorithm for numerical stability.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
fn pivot_var(values: &[CellValue]) -> CellValue {
    let (_, m2, count) = welford_accumulate(values);
    if count < 2 {
        return CellValue::Null;
    }
    CellValue::number(m2 / (count - 1) as f64)
}

/// Population variance.  Returns `Null` for empty input.
/// Uses Welford's algorithm for numerical stability.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
fn pivot_varp(values: &[CellValue]) -> CellValue {
    let (_, m2, count) = welford_accumulate(values);
    if count == 0 {
        return CellValue::Null;
    }
    CellValue::number(m2 / count as f64)
}

// ============================================================================
// Public dispatch
// ============================================================================

/// Dispatch to the appropriate aggregate function.
#[must_use]
pub fn aggregate(func: AggregateFunction, values: &[CellValue]) -> CellValue {
    match func {
        AggregateFunction::Sum => pivot_sum(values),
        AggregateFunction::Count => pivot_count(values),
        AggregateFunction::CountA => pivot_counta(values),
        AggregateFunction::CountUnique => pivot_countunique(values),
        AggregateFunction::Average => pivot_average(values),
        AggregateFunction::Min => pivot_min(values),
        AggregateFunction::Max => pivot_max(values),
        AggregateFunction::Product => pivot_product(values),
        AggregateFunction::StdDev => pivot_stdev(values),
        AggregateFunction::StdDevP => pivot_stdevp(values),
        AggregateFunction::Var => pivot_var(values),
        AggregateFunction::VarP => pivot_varp(values),
        _ => CellValue::Null, // future variants
    }
}

/// Get all available aggregation function variants.
#[must_use]
pub fn get_aggregate_functions() -> &'static [AggregateFunction] {
    &[
        AggregateFunction::Sum,
        AggregateFunction::Count,
        AggregateFunction::CountA,
        AggregateFunction::CountUnique,
        AggregateFunction::Average,
        AggregateFunction::Min,
        AggregateFunction::Max,
        AggregateFunction::Product,
        AggregateFunction::StdDev,
        AggregateFunction::StdDevP,
        AggregateFunction::Var,
        AggregateFunction::VarP,
    ]
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellError;

    // -- Test data fixtures --------------------------------------------------

    fn numbers() -> Vec<CellValue> {
        vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
            CellValue::number(4.0),
            CellValue::number(5.0),
        ]
    }

    fn mixed_numbers() -> Vec<CellValue> {
        vec![
            CellValue::number(10.0),
            CellValue::number(20.0),
            CellValue::Null,
            CellValue::number(30.0),
            CellValue::Text("text".into()),
            CellValue::number(40.0),
        ]
    }

    fn strings() -> Vec<CellValue> {
        vec![
            CellValue::Text("apple".into()),
            CellValue::Text("banana".into()),
            CellValue::Text("cherry".into()),
        ]
    }

    fn with_nulls() -> Vec<CellValue> {
        vec![
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::number(2.0),
            CellValue::Null,
            CellValue::number(3.0),
        ]
    }

    fn empty() -> Vec<CellValue> {
        vec![]
    }

    fn all_nulls() -> Vec<CellValue> {
        vec![CellValue::Null, CellValue::Null, CellValue::Null]
    }

    fn div0_error() -> CellValue {
        CellValue::Error(CellError::Div0, None)
    }

    fn with_errors() -> Vec<CellValue> {
        vec![
            CellValue::number(1.0),
            div0_error(),
            CellValue::number(2.0),
            CellValue::number(3.0),
        ]
    }

    // Helper to assert a CellValue::Number is close to expected.
    fn assert_close(val: CellValue, expected: f64, tolerance: f64) {
        match val {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - expected).abs() < tolerance,
                    "expected {} to be close to {} (tolerance {})",
                    n,
                    expected,
                    tolerance,
                );
            }
            other => panic!("expected Number, got {:?}", other),
        }
    }

    fn assert_num(val: CellValue, expected: f64) {
        match val {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - expected).abs() < 1e-10,
                    "expected {} but got {}",
                    expected,
                    n,
                );
            }
            other => panic!("expected Number({}), got {:?}", expected, other),
        }
    }

    fn assert_null(val: CellValue) {
        assert!(
            matches!(val, CellValue::Null),
            "expected Null, got {:?}",
            val,
        );
    }

    // -- Canonical value helpers (delegated to super::values) -----------------

    #[test]
    fn test_cell_value_is_numeric_via_canonical() {
        assert!(cell_value_is_numeric(&CellValue::number(123.0)));
        assert!(cell_value_is_numeric(&CellValue::number(0.0)));
        assert!(cell_value_is_numeric(&CellValue::number(-5.5)));
        assert!(!cell_value_is_numeric(&CellValue::number(f64::NAN)));
        assert!(!cell_value_is_numeric(&CellValue::Text("123".into())));
        assert!(!cell_value_is_numeric(&CellValue::Null));
    }

    #[test]
    fn test_is_visually_blank_via_canonical() {
        assert!(!CellValue::number(123.0).is_visually_blank());
        assert!(!CellValue::Text("text".into()).is_visually_blank());
        assert!(!CellValue::Boolean(false).is_visually_blank());
        assert!(!CellValue::Error(CellError::Div0, None).is_visually_blank());
        assert!(CellValue::Null.is_visually_blank());
        assert!(CellValue::Text("".into()).is_visually_blank());
        assert!(CellValue::Text("   ".into()).is_visually_blank());
    }

    // -- SUM -----------------------------------------------------------------

    #[test]
    fn test_sum_numeric_values() {
        assert_num(pivot_sum(&numbers()), 15.0);
    }

    #[test]
    fn test_sum_ignores_non_numeric() {
        assert_num(pivot_sum(&mixed_numbers()), 100.0);
    }

    #[test]
    fn test_sum_empty_array() {
        assert_null(pivot_sum(&empty()));
    }

    #[test]
    fn test_sum_all_nulls() {
        assert_null(pivot_sum(&all_nulls()));
    }

    #[test]
    fn test_sum_ignores_errors() {
        assert_num(pivot_sum(&with_errors()), 6.0);
    }

    #[test]
    fn test_sum_kahan_compensated() {
        // Without Kahan: 1e15 + 1.0 - 1e15 = 0.0 (catastrophic cancellation).
        // With Kahan: result should be exactly 1.0.
        let vals = vec![
            CellValue::number(1e15),
            CellValue::number(1.0),
            CellValue::number(-1e15),
        ];
        assert_num(pivot_sum(&vals), 1.0);
    }

    // -- COUNT ---------------------------------------------------------------

    #[test]
    fn test_count_numeric_values_only() {
        assert_num(pivot_count(&numbers()), 5.0);
    }

    #[test]
    fn test_count_ignores_non_numeric() {
        assert_num(pivot_count(&mixed_numbers()), 4.0);
    }

    #[test]
    fn test_count_empty_array() {
        assert_null(pivot_count(&empty()));
    }

    #[test]
    fn test_count_returns_null_for_strings() {
        assert_null(pivot_count(&strings()));
    }

    // -- COUNTA --------------------------------------------------------------

    #[test]
    fn test_counta_counts_non_empty() {
        assert_num(pivot_counta(&numbers()), 5.0);
    }

    #[test]
    fn test_counta_counts_strings() {
        assert_num(pivot_counta(&strings()), 3.0);
    }

    #[test]
    fn test_counta_ignores_nulls() {
        assert_num(pivot_counta(&with_nulls()), 3.0);
    }

    #[test]
    fn test_counta_counts_errors() {
        assert_num(pivot_counta(&with_errors()), 4.0);
    }

    #[test]
    fn test_counta_empty_array() {
        assert_null(pivot_counta(&empty()));
    }

    // -- COUNTUNIQUE ---------------------------------------------------------

    #[test]
    fn test_countunique_counts_unique_values() {
        let vals = vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
            CellValue::number(3.0),
            CellValue::number(3.0),
        ];
        assert_num(pivot_countunique(&vals), 3.0);
    }

    #[test]
    fn test_countunique_case_insensitive_strings() {
        let vals = vec![
            CellValue::Text("A".into()),
            CellValue::Text("a".into()),
            CellValue::Text("B".into()),
            CellValue::Text("b".into()),
        ];
        assert_num(pivot_countunique(&vals), 2.0);
    }

    #[test]
    fn test_countunique_ignores_nulls() {
        let vals = vec![
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::number(1.0),
            CellValue::Null,
            CellValue::number(2.0),
        ];
        assert_num(pivot_countunique(&vals), 2.0);
    }

    #[test]
    fn test_countunique_boolean_text_are_distinct_types() {
        // Boolean(true) and Text("TRUE") are different types via canonical keys.
        let vals = vec![
            CellValue::Boolean(true),
            CellValue::Text("TRUE".into()),
            CellValue::Text("true".into()),
        ];
        // Boolean(true) -> "B:true", Text("TRUE")/Text("true") -> "T:true" = 2 unique
        assert_num(pivot_countunique(&vals), 2.0);
    }

    #[test]
    fn test_countunique_number_text_no_collision() {
        // Number(1.0) and Text("1") are different types and must not collide.
        let vals = vec![CellValue::number(1.0), CellValue::Text("1".into())];
        assert_num(pivot_countunique(&vals), 2.0);
    }

    #[test]
    fn test_countunique_handles_errors_as_unique() {
        let e1 = CellValue::Error(CellError::Div0, None);
        let e1_dup = CellValue::Error(CellError::Div0, None);
        let e2 = CellValue::Error(CellError::Value, None);
        let vals = vec![e1, e1_dup, e2];
        assert_num(pivot_countunique(&vals), 2.0);
    }

    #[test]
    fn test_countunique_no_trimming() {
        // Canonical keys do NOT trim non-blank text.
        // "hello" and "  hello  " produce different keys.
        let vals = vec![
            CellValue::Text("hello".into()),
            CellValue::Text("  hello  ".into()),
        ];
        assert_num(pivot_countunique(&vals), 2.0);
    }

    #[test]
    fn test_countunique_null_and_empty_text_both_blank() {
        // Null and Text("") are both blank and excluded from counting.
        let vals = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::number(1.0),
        ];
        assert_num(pivot_countunique(&vals), 1.0);
    }

    #[test]
    fn test_countunique_empty_input() {
        assert_null(pivot_countunique(&empty()));
    }

    #[test]
    fn test_countunique_all_blanks() {
        let vals = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::Text("   ".into()),
        ];
        assert_null(pivot_countunique(&vals));
    }

    #[test]
    fn test_countunique_single_value() {
        let vals = vec![CellValue::number(42.0)];
        assert_num(pivot_countunique(&vals), 1.0);
    }

    #[test]
    fn test_countunique_mixed_types() {
        let vals = vec![
            CellValue::number(1.0),
            CellValue::Text("hello".into()),
            CellValue::Boolean(true),
            CellValue::Error(CellError::Na, None),
        ];
        assert_num(pivot_countunique(&vals), 4.0);
    }

    // -- AVERAGE -------------------------------------------------------------

    #[test]
    fn test_average_calculates_average() {
        assert_num(pivot_average(&numbers()), 3.0);
    }

    #[test]
    fn test_average_ignores_non_numeric() {
        assert_num(pivot_average(&mixed_numbers()), 25.0);
    }

    #[test]
    fn test_average_returns_null_for_empty() {
        assert_null(pivot_average(&empty()));
    }

    #[test]
    fn test_average_returns_null_for_all_non_numeric() {
        assert_null(pivot_average(&strings()));
    }

    // -- Numerical stability (Welford's) ------------------------------------

    #[test]
    fn test_stdev_numerical_stability_large_values() {
        // Values close together but with large magnitude.
        // True population stddev of [1,2,...,10] = 2.8722813...
        let vals: Vec<CellValue> = (1..=10)
            .map(|i| CellValue::number(1e12 + i as f64))
            .collect();
        let result = pivot_stdevp(&vals);
        assert_close(result, 2.8722813232690143, 1e-6);
    }

    // -- NaN/Infinity edge cases -------------------------------------------

    #[test]
    fn test_nan_inputs_ignored_in_all_aggregations() {
        let vals = vec![
            CellValue::number(1.0),
            CellValue::number(f64::NAN),
            CellValue::number(3.0),
        ];
        assert_num(pivot_sum(&vals), 4.0);
        assert_num(pivot_count(&vals), 2.0);
        assert_num(pivot_average(&vals), 2.0);
        assert_num(pivot_min(&vals), 1.0);
        assert_num(pivot_max(&vals), 3.0);
    }

    #[test]
    fn test_infinity_inputs_ignored() {
        let vals = vec![
            CellValue::number(1.0),
            CellValue::number(f64::INFINITY),
            CellValue::number(3.0),
        ];
        assert_num(pivot_sum(&vals), 4.0);
        assert_num(pivot_count(&vals), 2.0);
    }

    // -- Boolean values in aggregations ------------------------------------

    #[test]
    fn test_boolean_values_ignored_in_numeric_aggregations() {
        let vals = vec![
            CellValue::number(5.0),
            CellValue::Boolean(true),
            CellValue::Boolean(false),
        ];
        assert_num(pivot_sum(&vals), 5.0);
        assert_num(pivot_count(&vals), 1.0);
    }

    // -- MIN -----------------------------------------------------------------

    #[test]
    fn test_min_finds_minimum() {
        assert_num(pivot_min(&numbers()), 1.0);
    }

    #[test]
    fn test_min_ignores_non_numeric() {
        assert_num(pivot_min(&mixed_numbers()), 10.0);
    }

    #[test]
    fn test_min_returns_null_for_empty() {
        assert_null(pivot_min(&empty()));
    }

    #[test]
    fn test_min_handles_negative_numbers() {
        let vals = vec![
            CellValue::number(-5.0),
            CellValue::number(-2.0),
            CellValue::number(0.0),
            CellValue::number(3.0),
        ];
        assert_num(pivot_min(&vals), -5.0);
    }

    // -- MAX -----------------------------------------------------------------

    #[test]
    fn test_max_finds_maximum() {
        assert_num(pivot_max(&numbers()), 5.0);
    }

    #[test]
    fn test_max_ignores_non_numeric() {
        assert_num(pivot_max(&mixed_numbers()), 40.0);
    }

    #[test]
    fn test_max_returns_null_for_empty() {
        assert_null(pivot_max(&empty()));
    }

    #[test]
    fn test_max_handles_negative_numbers() {
        let vals = vec![
            CellValue::number(-5.0),
            CellValue::number(-2.0),
            CellValue::number(0.0),
            CellValue::number(3.0),
        ];
        assert_num(pivot_max(&vals), 3.0);
    }

    // -- PRODUCT -------------------------------------------------------------

    #[test]
    fn test_product_calculates_product() {
        assert_num(pivot_product(&numbers()), 120.0);
    }

    #[test]
    fn test_product_ignores_non_numeric() {
        let vals = vec![
            CellValue::number(2.0),
            CellValue::number(3.0),
            CellValue::Text("text".into()),
            CellValue::number(4.0),
        ];
        assert_num(pivot_product(&vals), 24.0);
    }

    #[test]
    fn test_product_returns_null_for_empty() {
        assert_null(pivot_product(&empty()));
    }

    #[test]
    fn test_product_handles_zero() {
        let vals = vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(0.0),
            CellValue::number(3.0),
        ];
        assert_num(pivot_product(&vals), 0.0);
    }

    // -- STDEV (sample) ------------------------------------------------------

    #[test]
    fn test_stdev_calculates_sample_stdev() {
        let vals: Vec<CellValue> = vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
            .into_iter()
            .map(CellValue::number)
            .collect();
        assert_close(pivot_stdev(&vals), 2.138, 0.001);
    }

    #[test]
    fn test_stdev_returns_null_for_single_value() {
        assert_null(pivot_stdev(&[CellValue::number(5.0)]));
    }

    #[test]
    fn test_stdev_returns_null_for_empty() {
        assert_null(pivot_stdev(&empty()));
    }

    // -- STDEVP (population) -------------------------------------------------

    #[test]
    fn test_stdevp_calculates_population_stdev() {
        let vals: Vec<CellValue> = vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
            .into_iter()
            .map(CellValue::number)
            .collect();
        assert_close(pivot_stdevp(&vals), 2.0, 0.001);
    }

    #[test]
    fn test_stdevp_returns_value_for_single_element() {
        assert_num(pivot_stdevp(&[CellValue::number(5.0)]), 0.0);
    }

    #[test]
    fn test_stdevp_returns_null_for_empty() {
        assert_null(pivot_stdevp(&empty()));
    }

    // -- VAR (sample) --------------------------------------------------------

    #[test]
    fn test_var_calculates_sample_variance() {
        let vals: Vec<CellValue> = vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
            .into_iter()
            .map(CellValue::number)
            .collect();
        assert_close(pivot_var(&vals), 4.571, 0.001);
    }

    #[test]
    fn test_var_returns_null_for_single_value() {
        assert_null(pivot_var(&[CellValue::number(5.0)]));
    }

    // -- VARP (population) ---------------------------------------------------

    #[test]
    fn test_varp_calculates_population_variance() {
        let vals: Vec<CellValue> = vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
            .into_iter()
            .map(CellValue::number)
            .collect();
        assert_close(pivot_varp(&vals), 4.0, 0.001);
    }

    #[test]
    fn test_varp_returns_0_for_single_element() {
        assert_num(pivot_varp(&[CellValue::number(5.0)]), 0.0);
    }

    // -- aggregate dispatch --------------------------------------------------

    #[test]
    fn test_aggregate_dispatches_correctly() {
        let nums = numbers(); // [1, 2, 3, 4, 5]

        // Basic aggregates
        assert_num(aggregate(AggregateFunction::Sum, &nums), 15.0);
        assert_num(aggregate(AggregateFunction::Count, &nums), 5.0);
        assert_num(aggregate(AggregateFunction::Average, &nums), 3.0);
        assert_num(aggregate(AggregateFunction::Min, &nums), 1.0);
        assert_num(aggregate(AggregateFunction::Max, &nums), 5.0);
        assert_num(aggregate(AggregateFunction::Product, &nums), 120.0);

        // CountA (all 5 are non-blank)
        assert_num(aggregate(AggregateFunction::CountA, &nums), 5.0);

        // CountUnique (all 5 are unique numbers)
        assert_num(aggregate(AggregateFunction::CountUnique, &nums), 5.0);

        // Statistical functions on [1, 2, 3, 4, 5]
        // Sample variance = 10 / 4 = 2.5
        assert_close(aggregate(AggregateFunction::Var, &nums), 2.5, 1e-10);
        // Population variance = 10 / 5 = 2.0
        assert_close(aggregate(AggregateFunction::VarP, &nums), 2.0, 1e-10);
        // Sample stdev = sqrt(2.5)
        assert_close(
            aggregate(AggregateFunction::StdDev, &nums),
            (2.5_f64).sqrt(),
            1e-10,
        );
        // Population stdev = sqrt(2.0)
        assert_close(
            aggregate(AggregateFunction::StdDevP, &nums),
            (2.0_f64).sqrt(),
            1e-10,
        );
    }

    // -- get_aggregate_functions ---------------------------------------------

    #[test]
    fn test_get_aggregate_functions_returns_all_12() {
        let fns = get_aggregate_functions();
        assert_eq!(fns.len(), 12);
        assert!(fns.contains(&AggregateFunction::Sum));
        assert!(fns.contains(&AggregateFunction::Count));
        assert!(fns.contains(&AggregateFunction::CountA));
        assert!(fns.contains(&AggregateFunction::CountUnique));
        assert!(fns.contains(&AggregateFunction::Average));
        assert!(fns.contains(&AggregateFunction::Min));
        assert!(fns.contains(&AggregateFunction::Max));
        assert!(fns.contains(&AggregateFunction::Product));
        assert!(fns.contains(&AggregateFunction::StdDev));
        assert!(fns.contains(&AggregateFunction::StdDevP));
        assert!(fns.contains(&AggregateFunction::Var));
        assert!(fns.contains(&AggregateFunction::VarP));
    }

    // -- Text values ignored in numeric aggregations (Excel behavior) --------

    #[test]
    fn test_sum_ignores_string_numbers() {
        // Text values like "20" and "30" should be ignored, not coerced.
        let vals = vec![
            CellValue::number(10.0),
            CellValue::Text("20".into()),
            CellValue::Text("30".into()),
        ];
        assert_num(pivot_sum(&vals), 10.0);
    }

    #[test]
    fn test_count_ignores_string_numbers() {
        // Only actual Number cells are counted, not text that looks numeric.
        let vals = vec![
            CellValue::number(1.0),
            CellValue::Text("2".into()),
            CellValue::Text("nope".into()),
        ];
        assert_num(pivot_count(&vals), 1.0);
    }

    // -- Edge cases: empty, single value, all blanks -------------------------

    #[test]
    fn test_all_aggregates_on_empty() {
        assert_null(pivot_sum(&empty()));
        assert_null(pivot_count(&empty()));
        assert_null(pivot_counta(&empty()));
        assert_null(pivot_countunique(&empty()));
        assert_null(pivot_average(&empty()));
        assert_null(pivot_min(&empty()));
        assert_null(pivot_max(&empty()));
        assert_null(pivot_product(&empty()));
        assert_null(pivot_stdev(&empty()));
        assert_null(pivot_stdevp(&empty()));
        assert_null(pivot_var(&empty()));
        assert_null(pivot_varp(&empty()));
    }

    #[test]
    fn test_all_aggregates_on_single_value() {
        let vals = vec![CellValue::number(7.0)];
        assert_num(pivot_sum(&vals), 7.0);
        assert_num(pivot_count(&vals), 1.0);
        assert_num(pivot_counta(&vals), 1.0);
        assert_num(pivot_countunique(&vals), 1.0);
        assert_num(pivot_average(&vals), 7.0);
        assert_num(pivot_min(&vals), 7.0);
        assert_num(pivot_max(&vals), 7.0);
        assert_num(pivot_product(&vals), 7.0);
        assert_null(pivot_stdev(&vals)); // needs >= 2 values
        assert_num(pivot_stdevp(&vals), 0.0);
        assert_null(pivot_var(&vals)); // needs >= 2 values
        assert_num(pivot_varp(&vals), 0.0);
    }

    #[test]
    fn test_all_aggregates_on_all_blanks() {
        let vals = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::Text("   ".into()),
        ];
        assert_null(pivot_sum(&vals));
        assert_null(pivot_count(&vals));
        assert_null(pivot_counta(&vals));
        assert_null(pivot_countunique(&vals));
        assert_null(pivot_average(&vals));
        assert_null(pivot_min(&vals));
        assert_null(pivot_max(&vals));
        assert_null(pivot_product(&vals));
        assert_null(pivot_stdev(&vals));
        assert_null(pivot_stdevp(&vals));
        assert_null(pivot_var(&vals));
        assert_null(pivot_varp(&vals));
    }

    #[test]
    fn test_all_aggregates_on_mixed_types() {
        let vals = vec![
            CellValue::number(10.0),
            CellValue::Text("hello".into()),
            CellValue::Boolean(true),
            CellValue::Error(CellError::Na, None),
            CellValue::Null,
            CellValue::number(20.0),
        ];
        // Numeric aggregates only see [10.0, 20.0]
        assert_num(pivot_sum(&vals), 30.0);
        assert_num(pivot_count(&vals), 2.0);
        assert_num(pivot_average(&vals), 15.0);
        assert_num(pivot_min(&vals), 10.0);
        assert_num(pivot_max(&vals), 20.0);
        assert_num(pivot_product(&vals), 200.0);
        // Non-blank count: Number(10), Text("hello"), Boolean(true), Error(Na), Number(20) = 5
        assert_num(pivot_counta(&vals), 5.0);
        // Unique non-blank: 5 distinct canonical keys
        assert_num(pivot_countunique(&vals), 5.0);
    }

    // ========================================================================
    // First-principles mathematical correctness tests
    // ========================================================================

    // -- 1. StdDev / StdDevP / Var / VarP with hand-computed values ----------

    #[test]
    fn test_variance_stddev_hand_computed_exact() {
        // Data: [2, 4, 4, 4, 5, 5, 7, 9]
        // N = 8, Sum = 40, Mean = 5
        // Squared deviations from mean: [9, 1, 1, 1, 0, 0, 4, 16] → sum = 32
        // Population variance = 32/8 = 4.0
        // Sample variance = 32/7 ≈ 4.571428571428571
        // Population std dev = sqrt(4) = 2.0
        // Sample std dev = sqrt(32/7) ≈ 2.1380899352993950
        let vals: Vec<CellValue> = vec![2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
            .into_iter()
            .map(CellValue::number)
            .collect();

        // Population variance = exactly 4.0
        assert_num(pivot_varp(&vals), 4.0);

        // Sample variance = 32/7
        let sample_var = pivot_var(&vals);
        assert!(
            (sample_var.as_number().unwrap() - 32.0 / 7.0).abs() < 1e-10,
            "sample variance should be 32/7, got {}",
            sample_var.as_number().unwrap()
        );

        // Population std dev = exactly 2.0
        assert_num(pivot_stdevp(&vals), 2.0);

        // Sample std dev = sqrt(32/7)
        let sample_sd = pivot_stdev(&vals);
        let expected_sd = (32.0_f64 / 7.0).sqrt();
        assert!(
            (sample_sd.as_number().unwrap() - expected_sd).abs() < 1e-10,
            "sample stddev should be sqrt(32/7) ≈ {}, got {}",
            expected_sd,
            sample_sd.as_number().unwrap()
        );
    }

    #[test]
    fn test_variance_two_values() {
        // Data: [3, 7] → mean = 5, deviations = [-2, 2], sum_sq = 8
        // Pop var = 8/2 = 4, Sample var = 8/1 = 8
        let vals = vec![CellValue::number(3.0), CellValue::number(7.0)];
        assert_num(pivot_varp(&vals), 4.0);
        assert_num(pivot_var(&vals), 8.0);
        assert_num(pivot_stdevp(&vals), 2.0);
        assert_num(pivot_stdev(&vals), (8.0_f64).sqrt());
    }

    #[test]
    fn test_variance_identical_values() {
        // All same value → variance = 0
        let vals: Vec<CellValue> = vec![5.0; 10].into_iter().map(CellValue::number).collect();
        assert_num(pivot_varp(&vals), 0.0);
        assert_num(pivot_var(&vals), 0.0);
        assert_num(pivot_stdevp(&vals), 0.0);
        assert_num(pivot_stdev(&vals), 0.0);
    }

    // -- 2. Count vs CountA semantics ----------------------------------------

    #[test]
    fn test_count_vs_counta_mixed_types() {
        // [Number(1), Text("a"), Boolean(true), Null, Error(Div0), Number(2)]
        // Count: only numeric → 2 (Number(1), Number(2))
        // CountA: non-blank → 5 (Number(1), Text("a"), Boolean(true), Error(Div0), Number(2))
        let vals = vec![
            CellValue::number(1.0),
            CellValue::Text("a".into()),
            CellValue::Boolean(true),
            CellValue::Null,
            CellValue::Error(CellError::Div0, None),
            CellValue::number(2.0),
        ];
        assert_num(pivot_count(&vals), 2.0);
        assert_num(pivot_counta(&vals), 5.0);
    }

    #[test]
    fn test_count_zero_for_all_non_numeric() {
        // Booleans, text, errors are NOT numeric
        let vals = vec![
            CellValue::Text("hello".into()),
            CellValue::Boolean(true),
            CellValue::Boolean(false),
            CellValue::Error(CellError::Value, None),
        ];
        assert_null(pivot_count(&vals));
        assert_num(pivot_counta(&vals), 4.0);
    }

    #[test]
    fn test_counta_excludes_blank_text() {
        // Empty string and whitespace-only strings are blank
        let vals = vec![
            CellValue::number(1.0),
            CellValue::Text("".into()),
            CellValue::Text("   ".into()),
            CellValue::Text("x".into()),
        ];
        // Non-blank: Number(1.0), Text("x") = 2
        assert_num(pivot_counta(&vals), 2.0);
    }

    // -- 3. CountUnique semantics --------------------------------------------

    #[test]
    fn test_countunique_case_insensitive_three_cases() {
        // "Apple", "apple", "APPLE" should all collapse to 1 unique
        let vals = vec![
            CellValue::Text("Apple".into()),
            CellValue::Text("apple".into()),
            CellValue::Text("APPLE".into()),
        ];
        assert_num(pivot_countunique(&vals), 1.0);
    }

    #[test]
    fn test_countunique_cross_type_number_vs_text() {
        // Number(1) and Text("1") are different types → 2 unique
        let vals = vec![CellValue::number(1.0), CellValue::Text("1".into())];
        assert_num(pivot_countunique(&vals), 2.0);
    }

    #[test]
    fn test_countunique_blanks_excluded() {
        // Null, Text(""), Number(1) → only Number(1) is non-blank → 1 unique
        let vals = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::number(1.0),
        ];
        assert_num(pivot_countunique(&vals), 1.0);
    }

    #[test]
    fn test_countunique_negative_zero_canonicalized() {
        // 0.0 and -0.0 should be the same unique value
        let vals = vec![CellValue::number(0.0), CellValue::number(-0.0)];
        assert_num(pivot_countunique(&vals), 1.0);
    }

    // -- 4. Product edge cases -----------------------------------------------

    #[test]
    fn test_product_basic() {
        let vals = vec![
            CellValue::number(2.0),
            CellValue::number(3.0),
            CellValue::number(4.0),
        ];
        assert_num(pivot_product(&vals), 24.0);
    }

    #[test]
    fn test_product_zero_absorbs() {
        let vals = vec![
            CellValue::number(0.0),
            CellValue::number(5.0),
            CellValue::number(10.0),
        ];
        assert_num(pivot_product(&vals), 0.0);
    }

    #[test]
    fn test_product_negative() {
        let vals = vec![CellValue::number(-2.0), CellValue::number(3.0)];
        assert_num(pivot_product(&vals), -6.0);
    }

    #[test]
    fn test_product_single_value() {
        let vals = vec![CellValue::number(7.0)];
        assert_num(pivot_product(&vals), 7.0);
    }

    #[test]
    fn test_product_ignores_non_numeric_mixed() {
        let vals = vec![
            CellValue::number(2.0),
            CellValue::Text("x".into()),
            CellValue::number(3.0),
        ];
        assert_num(pivot_product(&vals), 6.0);
    }

    // -- 5. Sum numerical precision ------------------------------------------

    #[test]
    fn test_sum_kahan_precision() {
        // Classic Kahan test: 1e15 + 1.0 - 1e15 should be exactly 1.0
        let vals = vec![
            CellValue::number(1e15),
            CellValue::number(1.0),
            CellValue::number(-1e15),
        ];
        assert_num(pivot_sum(&vals), 1.0);
    }

    #[test]
    fn test_sum_many_small_values() {
        // 10000 copies of 0.1 → should be close to 1000.0
        let vals: Vec<CellValue> = (0..10000).map(|_| CellValue::number(0.1)).collect();
        let result = pivot_sum(&vals);
        assert!(
            (result.as_number().unwrap() - 1000.0).abs() < 1e-6,
            "sum of 10000 * 0.1 should be ~1000.0, got {}",
            result.as_number().unwrap()
        );
    }

    // -- 6. Average edge cases -----------------------------------------------

    #[test]
    fn test_average_basic() {
        let vals = vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
        ];
        assert_num(pivot_average(&vals), 2.0);
    }

    #[test]
    fn test_average_ignores_non_numeric_mixed() {
        // [Number(10), Text("x"), Number(20), Null] → average of [10, 20] = 15.0
        let vals = vec![
            CellValue::number(10.0),
            CellValue::Text("x".into()),
            CellValue::number(20.0),
            CellValue::Null,
        ];
        assert_num(pivot_average(&vals), 15.0);
    }

    #[test]
    fn test_average_empty_is_null() {
        assert_null(pivot_average(&[]));
    }

    #[test]
    fn test_average_all_non_numeric_is_null() {
        let vals = vec![CellValue::Text("a".into()), CellValue::Boolean(true)];
        assert_null(pivot_average(&vals));
    }

    // -- 7. Min/Max with mixed types -----------------------------------------

    #[test]
    fn test_min_max_ignores_text_that_looks_numeric() {
        // Text("1") is NOT numeric, should be ignored
        let vals = vec![
            CellValue::number(5.0),
            CellValue::Text("1".into()),
            CellValue::number(3.0),
        ];
        assert_num(pivot_min(&vals), 3.0);
        assert_num(pivot_max(&vals), 5.0);
    }

    #[test]
    fn test_min_max_all_non_numeric_is_null() {
        let vals = vec![
            CellValue::Text("100".into()),
            CellValue::Boolean(true),
            CellValue::Error(CellError::Na, None),
        ];
        assert_null(pivot_min(&vals));
        assert_null(pivot_max(&vals));
    }

    #[test]
    fn test_min_max_single_numeric_among_non_numeric() {
        let vals = vec![
            CellValue::Text("hello".into()),
            CellValue::number(42.0),
            CellValue::Boolean(false),
        ];
        assert_num(pivot_min(&vals), 42.0);
        assert_num(pivot_max(&vals), 42.0);
    }

    // -- 8. All aggregate functions on empty input → Null --------------------

    #[test]
    fn test_all_aggregates_empty_via_dispatch() {
        // Verify via the public `aggregate` dispatch, not just internal fns
        for func in get_aggregate_functions() {
            let result = aggregate(*func, &[]);
            assert!(
                matches!(result, CellValue::Null),
                "{:?} on empty input should return Null, got {:?}",
                func,
                result
            );
        }
    }

    // -- 9. All aggregate functions on all-blank input → Null ----------------

    #[test]
    fn test_all_aggregates_all_blank_via_dispatch() {
        let blanks = vec![
            CellValue::Null,
            CellValue::Text("".into()),
            CellValue::Text("  ".into()),
        ];
        for func in get_aggregate_functions() {
            let result = aggregate(*func, &blanks);
            assert!(
                matches!(result, CellValue::Null),
                "{:?} on all-blank input should return Null, got {:?}",
                func,
                result
            );
        }
    }

    // -- Additional first-principles tests -----------------------------------

    #[test]
    fn test_sum_associativity() {
        // Sum should not depend on order (within floating-point tolerance)
        let vals_a = vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
        ];
        let vals_b = vec![
            CellValue::number(3.0),
            CellValue::number(1.0),
            CellValue::number(2.0),
        ];
        let a = pivot_sum(&vals_a).as_number().unwrap();
        let b = pivot_sum(&vals_b).as_number().unwrap();
        assert!((a - b).abs() < 1e-10, "sum should be order-independent");
    }

    #[test]
    fn test_stdev_ignores_non_numeric_in_computation() {
        // StdDev/Var should only use numeric values for their computation
        // [10, Text("x"), 20] → treated as [10, 20]
        // mean = 15, deviations = [-5, 5], sum_sq = 50
        // pop var = 50/2 = 25, sample var = 50/1 = 50
        let vals = vec![
            CellValue::number(10.0),
            CellValue::Text("x".into()),
            CellValue::number(20.0),
        ];
        assert_num(pivot_varp(&vals), 25.0);
        assert_num(pivot_var(&vals), 50.0);
        assert_num(pivot_stdevp(&vals), 5.0);
        assert_num(pivot_stdev(&vals), (50.0_f64).sqrt());
    }

    #[test]
    fn test_average_large_equal_values() {
        // Average of N identical values should be that value exactly
        let vals: Vec<CellValue> = (0..1000).map(|_| CellValue::number(3.14159)).collect();
        assert_num(pivot_average(&vals), 3.14159);
    }

    #[test]
    fn test_product_two_negatives() {
        // (-3) * (-4) = 12
        let vals = vec![CellValue::number(-3.0), CellValue::number(-4.0)];
        assert_num(pivot_product(&vals), 12.0);
    }

    #[test]
    fn test_countunique_nan_values_excluded() {
        // NaN is not finite, so not numeric. It also should not be counted
        // if is_visually_blank considers it non-blank... let's verify.
        // NaN Number cells are not numeric but ARE non-blank, so they get a key.
        // Two NaN values should map to the same canonical key.
        let vals = vec![
            CellValue::number(f64::NAN),
            CellValue::number(f64::NAN),
            CellValue::number(1.0),
        ];
        // NaN is not blank, so countunique sees it. Two NaN → 1 unique NaN + 1 unique Number = 2
        assert_num(pivot_countunique(&vals), 2.0);
    }

    #[test]
    fn test_min_max_with_negative_zero() {
        // -0.0 and 0.0 should compare equal
        let vals = vec![CellValue::number(-0.0), CellValue::number(0.0)];
        assert_num(pivot_min(&vals), 0.0);
        assert_num(pivot_max(&vals), 0.0);
    }
}
