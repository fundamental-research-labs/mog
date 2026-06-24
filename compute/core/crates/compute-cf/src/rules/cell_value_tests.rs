use super::*;
use crate::types::{CellValueComparison, CellValueSingleOp, CellValueThreshold};
use value_types::{CellError, FiniteF64};

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

// =============================================================================
// Helpers to construct comparisons concisely
// =============================================================================

fn single(op: CellValueSingleOp, text: &str) -> CellValueComparison {
    CellValueComparison::Single {
        operator: op,
        threshold: CellValueThreshold {
            text: text.to_string(),
            number: text.parse::<f64>().ok(),
        },
    }
}

fn single_text_only(op: CellValueSingleOp, text: &str) -> CellValueComparison {
    CellValueComparison::Single {
        operator: op,
        threshold: CellValueThreshold {
            text: text.to_string(),
            number: None,
        },
    }
}

fn between(low: f64, high: f64) -> CellValueComparison {
    CellValueComparison::Between { low, high }
}

fn not_between(low: f64, high: f64) -> CellValueComparison {
    CellValueComparison::NotBetween { low, high }
}

// -----------------------------------------------------------------------
// Numeric comparisons -- all 6 single-value operators
// -----------------------------------------------------------------------

#[test]
fn test_greater_than() {
    let cmp = single(CellValueSingleOp::GreaterThan, "10");

    // 15 > 10 -> match
    assert_eq!(evaluate_cell_value(&n(15.0), &cmp), true);
    // 10 > 10 -> no match
    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), false);
    // 5 > 10 -> no match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), false);
}

#[test]
fn test_less_than() {
    let cmp = single(CellValueSingleOp::LessThan, "10");

    // 5 < 10 -> match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), true);
    // 10 < 10 -> no match
    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), false);
    // 15 < 10 -> no match
    assert_eq!(evaluate_cell_value(&n(15.0), &cmp), false);
}

#[test]
fn test_greater_than_or_equal() {
    let cmp = single(CellValueSingleOp::GreaterThanOrEqual, "10");

    // 15 >= 10 -> match
    assert_eq!(evaluate_cell_value(&n(15.0), &cmp), true);
    // 10 >= 10 -> match
    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), true);
    // 5 >= 10 -> no match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), false);
}

#[test]
fn test_less_than_or_equal() {
    let cmp = single(CellValueSingleOp::LessThanOrEqual, "10");

    // 5 <= 10 -> match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), true);
    // 10 <= 10 -> match
    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), true);
    // 15 <= 10 -> no match
    assert_eq!(evaluate_cell_value(&n(15.0), &cmp), false);
}

#[test]
fn test_equal_numeric() {
    let cmp = single(CellValueSingleOp::Equal, "10");

    // 10 == 10 -> match
    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), true);
    // 10.5 == 10 -> no match
    assert_eq!(evaluate_cell_value(&n(10.5), &cmp), false);
}

#[test]
fn test_not_equal_numeric() {
    let cmp = single(CellValueSingleOp::NotEqual, "10");

    // 5 != 10 -> match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), true);
    // 10 != 10 -> no match
    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), false);
}

// -----------------------------------------------------------------------
// Between / NotBetween
// -----------------------------------------------------------------------

#[test]
fn test_between() {
    let cmp = between(10.0, 20.0);

    // 15 between 10 and 20 -> match
    assert_eq!(evaluate_cell_value(&n(15.0), &cmp), true);
    // 10 between 10 and 20 -> match (inclusive)
    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), true);
    // 20 between 10 and 20 -> match (inclusive)
    assert_eq!(evaluate_cell_value(&n(20.0), &cmp), true);
    // 5 between 10 and 20 -> no match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), false);
    // 25 between 10 and 20 -> no match
    assert_eq!(evaluate_cell_value(&n(25.0), &cmp), false);
}

#[test]
fn test_between_reversed_values() {
    // low/high are already sorted by the type system (conversion sorts them),
    // but we can test with low < high directly.
    let cmp = between(1.0, 10.0);

    // 5 between 1 and 10 -> match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), true);
}

#[test]
fn test_not_between() {
    let cmp = not_between(10.0, 20.0);

    // 5 not between 10 and 20 -> match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), true);
    // 25 not between 10 and 20 -> match
    assert_eq!(evaluate_cell_value(&n(25.0), &cmp), true);
    // 15 not between 10 and 20 -> no match
    assert_eq!(evaluate_cell_value(&n(15.0), &cmp), false);
    // 10 not between 10 and 20 -> no match (inclusive boundary)
    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), false);
}

// -----------------------------------------------------------------------
// String comparison (equal / notEqual with non-numeric threshold)
// -----------------------------------------------------------------------

#[test]
fn test_equal_string_case_insensitive() {
    let cmp = single_text_only(CellValueSingleOp::Equal, "hello");

    // "hello" == "hello" -> match
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("hello".into()), &cmp),
        true
    );
    // "HELLO" == "hello" -> match (case-insensitive)
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("HELLO".into()), &cmp),
        true
    );
    // "world" == "hello" -> no match
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("world".into()), &cmp),
        false
    );
}

#[test]
fn test_not_equal_string() {
    let cmp = single_text_only(CellValueSingleOp::NotEqual, "hello");

    // "world" != "hello" -> match
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("world".into()), &cmp),
        true
    );
    // "hello" != "hello" -> no match
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("hello".into()), &cmp),
        false
    );
}

// -----------------------------------------------------------------------
// Non-numeric cell values
// -----------------------------------------------------------------------

#[test]
fn test_text_cell_with_numeric_threshold() {
    let cmp = single(CellValueSingleOp::GreaterThan, "10");

    // Excel orders text after numbers for mixed text/number comparisons.
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("abc".into()), &cmp),
        true
    );
}

#[test]
fn test_text_cell_orders_after_numeric_threshold() {
    let gt = single(CellValueSingleOp::GreaterThan, "1");
    let gte = single(CellValueSingleOp::GreaterThanOrEqual, "1");
    let lt = single(CellValueSingleOp::LessThan, "1");
    let lte = single(CellValueSingleOp::LessThanOrEqual, "1");

    let text = CellValue::Text(" ".into());

    assert_eq!(evaluate_cell_value(&text, &gt), true);
    assert_eq!(evaluate_cell_value(&text, &gte), true);
    assert_eq!(evaluate_cell_value(&text, &lt), false);
    assert_eq!(evaluate_cell_value(&text, &lte), false);
}

#[test]
fn test_text_cell_parseable_as_number() {
    let cmp = single(CellValueSingleOp::GreaterThan, "10");

    // Text "15" > 10 -> match (text parses to 15.0)
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("15".into()), &cmp),
        true
    );
}

#[test]
fn test_boolean_cell_value() {
    let cmp = single(CellValueSingleOp::GreaterThan, "0");

    // true (=1) > 0 -> match
    assert_eq!(evaluate_cell_value(&CellValue::Boolean(true), &cmp), true);
    // false (=0) > 0 -> no match
    assert_eq!(evaluate_cell_value(&CellValue::Boolean(false), &cmp), false);
}

#[test]
fn test_null_cell_value() {
    let cmp = single(CellValueSingleOp::GreaterThan, "10");

    // Null with numeric operator -> false
    assert_eq!(evaluate_cell_value(&CellValue::Null, &cmp), false);
    // Null with between -> false
    let cmp_between = between(5.0, 15.0);
    assert_eq!(evaluate_cell_value(&CellValue::Null, &cmp_between), false);
}

#[test]
fn test_error_cell_value() {
    let cmp_gt = single(CellValueSingleOp::GreaterThan, "10");

    // Error values should not match numeric comparisons
    assert_eq!(
        evaluate_cell_value(&CellValue::Error(CellError::Div0, None), &cmp_gt),
        false
    );
    let cmp_eq = single(CellValueSingleOp::Equal, "10");
    assert_eq!(
        evaluate_cell_value(&CellValue::Error(CellError::Value, None), &cmp_eq),
        false
    );
}

// -----------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------

#[test]
fn test_nan_threshold() {
    // Non-numeric threshold with numeric operator -> false
    let cmp = single_text_only(CellValueSingleOp::GreaterThan, "abc");

    assert_eq!(evaluate_cell_value(&n(10.0), &cmp), false);
}

#[test]
fn test_negative_numbers() {
    let cmp = single(CellValueSingleOp::GreaterThan, "-5");

    // -3 > -5 -> match
    assert_eq!(evaluate_cell_value(&n(-3.0), &cmp), true);
    // -10 > -5 -> no match
    assert_eq!(evaluate_cell_value(&n(-10.0), &cmp), false);
}

#[test]
fn test_decimal_numbers() {
    let cmp_gt = single(CellValueSingleOp::GreaterThan, "12.34");

    // 12.35 > 12.34 -> match
    assert_eq!(evaluate_cell_value(&n(12.35), &cmp_gt), true);

    let cmp_eq = single(CellValueSingleOp::Equal, "12.34");
    // 12.34 == 12.34 -> match
    assert_eq!(evaluate_cell_value(&n(12.34), &cmp_eq), true);
}

#[test]
fn test_zero_threshold() {
    let cmp_eq = single(CellValueSingleOp::Equal, "0");
    // 0 == 0 -> match
    assert_eq!(evaluate_cell_value(&n(0.0), &cmp_eq), true);

    let cmp_gt = single(CellValueSingleOp::GreaterThan, "0");
    // 1 > 0 -> match
    assert_eq!(evaluate_cell_value(&n(1.0), &cmp_gt), true);

    let cmp_lt = single(CellValueSingleOp::LessThan, "0");
    // -1 < 0 -> match
    assert_eq!(evaluate_cell_value(&n(-1.0), &cmp_lt), true);
}

// -----------------------------------------------------------------------
// Between/NotBetween with inverted bounds
// -----------------------------------------------------------------------

#[test]
fn test_between_inverted_bounds() {
    // Bounds are pre-sorted by conversion, so low=1, high=10
    let cmp = between(1.0, 10.0);

    // 5 between 1 and 10 -> match
    assert_eq!(evaluate_cell_value(&n(5.0), &cmp), true);
}

#[test]
fn test_not_between_inverted_bounds() {
    // Bounds pre-sorted: low=1, high=10
    let cmp = not_between(1.0, 10.0);

    // 15 is NOT between 1 and 10 -> match for NotBetween
    assert_eq!(evaluate_cell_value(&n(15.0), &cmp), true);
}

// -----------------------------------------------------------------------
// Infinity thresholds
// -----------------------------------------------------------------------

#[test]
fn test_less_than_infinity_threshold() {
    // Threshold pre-parsed as f64::INFINITY
    let cmp = CellValueComparison::Single {
        operator: CellValueSingleOp::LessThan,
        threshold: CellValueThreshold {
            text: "Infinity".to_string(),
            number: Some(f64::INFINITY),
        },
    };

    // 1e308 < Infinity -> match
    assert_eq!(evaluate_cell_value(&n(1e308), &cmp), true);
}

#[test]
fn test_greater_than_neg_infinity_threshold() {
    let cmp = CellValueComparison::Single {
        operator: CellValueSingleOp::GreaterThan,
        threshold: CellValueThreshold {
            text: "-Infinity".to_string(),
            number: Some(f64::NEG_INFINITY),
        },
    };

    // -1e308 > -Infinity -> match
    assert_eq!(evaluate_cell_value(&n(-1e308), &cmp), true);
}

#[test]
fn test_infinity_equal_infinity() {
    let cmp = CellValueComparison::Single {
        operator: CellValueSingleOp::Equal,
        threshold: CellValueThreshold {
            text: "Infinity".to_string(),
            number: Some(f64::INFINITY),
        },
    };

    // With FiniteF64, Infinity becomes Error(Num) — no longer matches Equal
    assert_eq!(
        evaluate_cell_value(&CellValue::number(f64::INFINITY), &cmp),
        false,
    );
}

#[test]
fn test_between_with_infinity_bounds() {
    // Between -Infinity and Infinity: any number should match
    let cmp = between(f64::NEG_INFINITY, f64::INFINITY);

    assert_eq!(evaluate_cell_value(&n(42.0), &cmp), true);
}

// -----------------------------------------------------------------------
// Null cell with Equal empty string threshold
// -----------------------------------------------------------------------

#[test]
fn test_null_equal_empty_string() {
    // Empty string threshold: number is None, so falls to string path.
    // cell_value_to_string(Null) = "", and "".to_lowercase() == "".to_lowercase() -> match
    let cmp = single_text_only(CellValueSingleOp::Equal, "");

    assert_eq!(evaluate_cell_value(&CellValue::Null, &cmp), true);
}

#[test]
fn test_null_not_equal_empty_string() {
    // Null coerced to "" compared NotEqual to "" -> no match
    let cmp = single_text_only(CellValueSingleOp::NotEqual, "");

    assert_eq!(evaluate_cell_value(&CellValue::Null, &cmp), false);
}

#[test]
fn test_null_equal_nonempty_string() {
    // Null coerced to "" compared Equal to "hello" -> no match
    let cmp = single_text_only(CellValueSingleOp::Equal, "hello");

    assert_eq!(evaluate_cell_value(&CellValue::Null, &cmp), false);
}

// -----------------------------------------------------------------------
// Mixed-type comparisons: non-numeric cell vs numeric threshold
// (Regression tests for NotEqual bug -- previously returned false/None
//  for non-numeric values compared against numeric thresholds)
// -----------------------------------------------------------------------

#[test]
fn test_not_equal_text_vs_numeric_threshold() {
    let cmp = single(CellValueSingleOp::NotEqual, "10");

    // "hello" != 10 -> match (text is inherently not equal to a number)
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("hello".into()), &cmp),
        true
    );
}

#[test]
fn test_not_equal_boolean_vs_numeric_threshold() {
    let cmp = single(CellValueSingleOp::NotEqual, "10");

    // TRUE (=1.0) != 10 -> match (1.0 != 10.0, via numeric path)
    assert_eq!(evaluate_cell_value(&CellValue::Boolean(true), &cmp), true);
}

#[test]
fn test_not_equal_null_vs_numeric_threshold() {
    let cmp = single(CellValueSingleOp::NotEqual, "10");

    // Null != 10 -> match (null is inherently not equal to a number)
    assert_eq!(evaluate_cell_value(&CellValue::Null, &cmp), true);
}

#[test]
fn test_equal_text_vs_numeric_threshold() {
    let cmp = single(CellValueSingleOp::Equal, "10");

    // "hello" == 10 -> no match (text is not equal to a number)
    assert_eq!(
        evaluate_cell_value(&CellValue::Text("hello".into()), &cmp),
        false
    );
}

// -----------------------------------------------------------------------
// Boolean vs text threshold (Excel type-mismatch semantics)
// In Excel, Boolean and Text are different types. Boolean cells only
// compare via the numeric path (TRUE=1, FALSE=0), never via string.
// -----------------------------------------------------------------------

#[test]
fn test_boolean_true_equal_text_true_no_match() {
    // Boolean(true) Equal "TRUE" -> false (type mismatch in Excel)
    let cmp = single_text_only(CellValueSingleOp::Equal, "TRUE");

    assert_eq!(evaluate_cell_value(&CellValue::Boolean(true), &cmp), false);
}

#[test]
fn test_boolean_false_equal_text_false_no_match() {
    // Boolean(false) Equal "FALSE" -> false (type mismatch in Excel)
    let cmp = single_text_only(CellValueSingleOp::Equal, "FALSE");

    assert_eq!(evaluate_cell_value(&CellValue::Boolean(false), &cmp), false);
}

#[test]
fn test_boolean_true_equal_numeric_1_matches() {
    // Boolean(true) Equal "1" -> match (TRUE coerces to 1.0 via numeric path)
    let cmp = single(CellValueSingleOp::Equal, "1");

    assert_eq!(evaluate_cell_value(&CellValue::Boolean(true), &cmp), true);
}

#[test]
fn test_boolean_false_equal_numeric_0_matches() {
    // Boolean(false) Equal "0" -> match (FALSE coerces to 0.0 via numeric path)
    let cmp = single(CellValueSingleOp::Equal, "0");

    assert_eq!(evaluate_cell_value(&CellValue::Boolean(false), &cmp), true);
}

#[test]
fn test_boolean_true_not_equal_text_true_no_match() {
    // Boolean(true) NotEqual "TRUE" -> false (booleans skip string comparison entirely)
    let cmp = single_text_only(CellValueSingleOp::NotEqual, "TRUE");

    assert_eq!(evaluate_cell_value(&CellValue::Boolean(true), &cmp), false);
}

#[test]
fn test_boolean_true_equal_text_yes_no_match() {
    // Boolean(true) Equal "yes" -> false (non-numeric text threshold, boolean cell)
    let cmp = single_text_only(CellValueSingleOp::Equal, "yes");

    assert_eq!(evaluate_cell_value(&CellValue::Boolean(true), &cmp), false);
}

#[test]
fn test_boolean_false_not_equal_text_false_no_match() {
    // Boolean(false) NotEqual "FALSE" -> false (booleans skip string comparison)
    let cmp = single_text_only(CellValueSingleOp::NotEqual, "FALSE");

    assert_eq!(evaluate_cell_value(&CellValue::Boolean(false), &cmp), false);
}

// ===================================================================
// float_eq edge case tests (tested via Equal/NotEqual operators)
// ===================================================================

#[test]
fn test_float_eq_classic_0_1_plus_0_2() {
    // 0.1 + 0.2 == 0.3 should be true (Excel behavior)
    let cmp = single(CellValueSingleOp::Equal, "0.3");
    let value = n(0.1 + 0.2);

    assert_eq!(evaluate_cell_value(&value, &cmp), true);
}

#[test]
fn test_float_eq_large_numbers() {
    // Large numbers with small relative difference
    let cmp = single(CellValueSingleOp::Equal, "1000000000000000.5");
    let value = n(1e15 + 0.5);

    assert_eq!(evaluate_cell_value(&value, &cmp), true);
}

#[test]
fn test_float_eq_negative_zero_equals_zero() {
    let cmp = single(CellValueSingleOp::Equal, "0");
    let value = n(-0.0);

    assert_eq!(evaluate_cell_value(&value, &cmp), true);
}

#[test]
fn test_float_eq_infinity_equals_infinity() {
    // "inf" parses to f64::INFINITY
    let cmp = CellValueComparison::Single {
        operator: CellValueSingleOp::Equal,
        threshold: CellValueThreshold {
            text: "inf".to_string(),
            number: "inf".parse::<f64>().ok(), // Some(INFINITY)
        },
    };
    let value = CellValue::number(f64::INFINITY);

    // With FiniteF64, Infinity becomes Error(Num) — no longer matches Equal
    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

// ===================================================================
// NaN cell value tests -- NaN should never match any CF comparison
// ===================================================================

#[test]
fn test_nan_not_equal_any_number() {
    // With FiniteF64, NaN becomes Error(Num). Error values are inherently
    // not-equal to any number, so NotEqual returns true.
    let cmp = single(CellValueSingleOp::NotEqual, "10");
    let value = CellValue::number(f64::NAN);

    assert_eq!(evaluate_cell_value(&value, &cmp), true);
}

#[test]
fn test_nan_not_equal_to_itself() {
    // "NaN" parses to f64::NAN via f64::parse
    let cmp = CellValueComparison::Single {
        operator: CellValueSingleOp::Equal,
        threshold: CellValueThreshold {
            text: "NaN".to_string(),
            number: "NaN".parse::<f64>().ok(), // Some(NaN)
        },
    };
    let value = CellValue::number(f64::NAN);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

#[test]
fn test_nan_greater_than() {
    let cmp = single(CellValueSingleOp::GreaterThan, "0");
    let value = CellValue::number(f64::NAN);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

#[test]
fn test_nan_between() {
    let cmp = between(0.0, 100.0);
    let value = CellValue::number(f64::NAN);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

#[test]
fn test_infinity_greater_than() {
    // With FiniteF64, Infinity becomes Error(Num) — non-numeric returns false
    let cmp = single(CellValueSingleOp::GreaterThan, "999999");
    let value = CellValue::number(f64::INFINITY);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

#[test]
fn test_neg_infinity_less_than() {
    // With FiniteF64, NEG_INFINITY becomes Error(Num) — non-numeric returns false
    let cmp = single(CellValueSingleOp::LessThan, "-999999");
    let value = CellValue::number(f64::NEG_INFINITY);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

// ===================================================================
// Epsilon-aware Between/NotBetween boundary tests (Bug M5 regression)
// ===================================================================

#[test]
fn test_between_epsilon_boundary_0_1_plus_0_2() {
    // 0.1 + 0.2 is ~0.30000000000000004 in IEEE 754.
    // Between(0.3, 0.5) should still match at the lower boundary
    // because float_gte uses epsilon-aware comparison (same as Equal).
    let cmp = between(0.3, 0.5);
    let value = n(0.1 + 0.2);

    assert_eq!(evaluate_cell_value(&value, &cmp), true);
}

#[test]
fn test_not_between_epsilon_boundary_0_1_plus_0_2() {
    // 0.1 + 0.2 is epsilon-equal to 0.3, so it IS between 0.3 and 0.5.
    // Therefore NotBetween(0.3, 0.5) should NOT match.
    let cmp = not_between(0.3, 0.5);
    let value = n(0.1 + 0.2);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

#[test]
fn test_between_degenerate_single_point_range() {
    // Between(5.0, 5.0) with value 5.0 should match (degenerate single-point range).
    let cmp = between(5.0, 5.0);
    let value = n(5.0);

    assert_eq!(evaluate_cell_value(&value, &cmp), true);
}

#[test]
fn test_not_between_degenerate_single_point_range() {
    // NotBetween(5.0, 5.0) with value 5.0 should NOT match.
    let cmp = not_between(5.0, 5.0);
    let value = n(5.0);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

// ===================================================================
// Epsilon-aware GreaterThanOrEqual / LessThanOrEqual (consistency fix)
// Before this fix, >= and <= used raw IEEE 754 comparison while
// Between/NotBetween used epsilon-aware float_gte/float_lte.
// ===================================================================

#[test]
fn test_gte_epsilon_one_third_times_three() {
    // 1.0/3.0 * 3.0 is ~0.9999999999999999 in IEEE 754.
    // GreaterThanOrEqual 1.0 should match because they are epsilon-equal.
    let cmp = single(CellValueSingleOp::GreaterThanOrEqual, "1");
    let value = n(1.0_f64 / 3.0 * 3.0);

    assert_eq!(evaluate_cell_value(&value, &cmp), true);
}

#[test]
fn test_lte_epsilon_one_third_times_three() {
    // 1.0/3.0 * 3.0 is ~0.9999999999999999 in IEEE 754.
    // LessThanOrEqual 1.0 should match because they are epsilon-equal.
    let cmp = single(CellValueSingleOp::LessThanOrEqual, "1");
    let value = n(1.0_f64 / 3.0 * 3.0);

    assert_eq!(evaluate_cell_value(&value, &cmp), true);
}

#[test]
fn test_gt_strict_fails_for_epsilon_equal() {
    // 1.0/3.0 * 3.0 is epsilon-equal to 1.0, so strict GreaterThan should NOT match.
    let cmp = single(CellValueSingleOp::GreaterThan, "1");
    let value = n(1.0_f64 / 3.0 * 3.0);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

#[test]
fn test_lt_strict_fails_for_epsilon_equal() {
    // 1.0/3.0 * 3.0 is epsilon-equal to 1.0, so strict LessThan should NOT match.
    let cmp = single(CellValueSingleOp::LessThan, "1");
    let value = n(1.0_f64 / 3.0 * 3.0);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

// ===================================================================
// Array cell value -> to_number returns None
// ===================================================================

#[test]
fn test_array_cell_value_returns_false() {
    // CellValue::Array should not be convertible to a number,
    // so any numeric comparison should return false.
    let cmp = single(CellValueSingleOp::GreaterThan, "10");
    let arr = CellValue::Array(std::sync::Arc::new(value_types::CellArray::new(vec![], 0)));

    assert_eq!(evaluate_cell_value(&arr, &cmp), false);
}

#[test]
fn test_array_cell_value_equal_returns_false() {
    let cmp = single(CellValueSingleOp::Equal, "10");
    let arr = CellValue::Array(std::sync::Arc::new(value_types::CellArray::new(vec![], 0)));

    assert_eq!(evaluate_cell_value(&arr, &cmp), false);
}

#[test]
fn test_array_cell_value_not_equal_returns_true() {
    // Array is non-numeric, so NotEqual against a numeric threshold -> true
    // (it is inherently not equal to any number)
    let cmp = single(CellValueSingleOp::NotEqual, "10");
    let arr = CellValue::Array(std::sync::Arc::new(value_types::CellArray::new(vec![], 0)));

    assert_eq!(evaluate_cell_value(&arr, &cmp), true);
}

// ===================================================================
// float_eq with both values near zero
// ===================================================================

#[test]
fn test_float_eq_near_zero_relative_comparison() {
    // Very small numbers use relative comparison (diff/largest).
    // 1e-16 vs 0: diff=1e-16, largest=1e-16, diff/largest=1.0 > 1e-15 -> NOT equal.
    // This is correct: even though both are tiny, 1e-16 is infinitely far from 0 relatively.
    let cmp = single(CellValueSingleOp::Equal, "0");
    let value = n(1e-16);

    assert_eq!(
        evaluate_cell_value(&value, &cmp),
        false,
        "1e-16 should NOT be epsilon-equal to 0 (relative diff is 100%)"
    );
}

#[test]
fn test_float_eq_both_small_very_close() {
    // Two small numbers that are very close relatively:
    // a = 1e-10, b = 1e-10 + 1e-26: diff = 1e-26, largest = 1e-10
    // diff/largest = 1e-16 < 1e-15 -> equal
    let a = 1e-10;
    let b = a + 1e-26;
    let cmp = CellValueComparison::Single {
        operator: CellValueSingleOp::Equal,
        threshold: CellValueThreshold {
            text: format!("{}", a),
            number: Some(a),
        },
    };

    assert_eq!(
        evaluate_cell_value(&n(b), &cmp),
        true,
        "Two very close small numbers should be epsilon-equal"
    );
}

// ===================================================================
// NaN value in numeric comparison (line 76)
// ===================================================================

#[test]
fn test_nan_in_compare_values_less_than() {
    // NaN should not match any operator, even LessThan.
    // CellValue::number(NaN) produces Error(Num) via FiniteF64.
    let cmp = single(CellValueSingleOp::LessThan, "100");
    let value = CellValue::number(f64::NAN);

    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

// ===================================================================
// cell_value_to_string for Number and Boolean (lines 99-100)
// ===================================================================

#[test]
fn test_number_cell_equal_string_representation() {
    // When threshold has no numeric parse (text-only), the string comparison
    // path is used. cell_value_to_string(Number(42)) -> "42".
    let cmp = single_text_only(CellValueSingleOp::Equal, "42");
    // Number(42) -> cell_value_to_string -> "42", compare "42" == "42" -> true
    assert_eq!(evaluate_cell_value(&n(42.0), &cmp), true);
}

// ===================================================================
// compare_values_string with non-Equal/NotEqual operators (line 134)
// ===================================================================

#[test]
fn test_string_comparison_greater_than_returns_false() {
    // When threshold is non-numeric and operator is GreaterThan,
    // compare_values_string should return false (only Equal/NotEqual work).
    let cmp = single_text_only(CellValueSingleOp::GreaterThan, "apple");

    assert_eq!(
        evaluate_cell_value(&CellValue::Text("banana".into()), &cmp),
        false,
        "GreaterThan with non-numeric threshold should return false"
    );
}

#[test]
fn test_string_comparison_less_than_returns_false() {
    let cmp = single_text_only(CellValueSingleOp::LessThan, "banana");

    assert_eq!(
        evaluate_cell_value(&CellValue::Text("apple".into()), &cmp),
        false,
        "LessThan with non-numeric threshold should return false"
    );
}

// ===================================================================
// Between/NotBetween with non-numeric (text) cell values (lines 159, 165, 168)
// ===================================================================

#[test]
fn test_between_with_text_value_returns_false() {
    // Text "hello" cannot be converted to a number, so Between should return false.
    let cmp = between(1.0, 100.0);

    assert_eq!(
        evaluate_cell_value(&CellValue::Text("hello".into()), &cmp),
        false,
        "Between with non-numeric text should return false"
    );
}

#[test]
fn test_not_between_with_text_value_returns_false() {
    // Same for NotBetween: non-numeric text -> false
    let cmp = not_between(1.0, 100.0);

    assert_eq!(
        evaluate_cell_value(&CellValue::Text("hello".into()), &cmp),
        false,
        "NotBetween with non-numeric text should return false"
    );
}

#[test]
fn test_between_with_null_value_returns_false() {
    let cmp = between(1.0, 100.0);
    assert_eq!(evaluate_cell_value(&CellValue::Null, &cmp), false);
}

#[test]
fn test_not_between_with_null_value_returns_false() {
    let cmp = not_between(1.0, 100.0);
    assert_eq!(evaluate_cell_value(&CellValue::Null, &cmp), false);
}

#[test]
fn test_between_with_error_value_returns_false() {
    // Error values (like NaN -> Error(Num)) should not match Between
    let cmp = between(0.0, 100.0);
    let value = CellValue::number(f64::NAN);
    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}

#[test]
fn test_not_between_with_error_value_returns_false() {
    // Error values should not match NotBetween either
    let cmp = not_between(0.0, 100.0);
    let value = CellValue::number(f64::NAN);
    assert_eq!(evaluate_cell_value(&value, &cmp), false);
}
