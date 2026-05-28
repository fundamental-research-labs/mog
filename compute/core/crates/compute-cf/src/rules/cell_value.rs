//! Cell value comparison rules (>, <, between, equal, etc.)
//!
//! Ported from TypeScript: `spreadsheet-model/src/conditional-format/rule-evaluator.ts`
//! Functions: `evaluateCellValueRule`, `compareValues`, `toNumber`.

use std::borrow::Cow;

use crate::types::{CellValueComparison, CellValueSingleOp};
use value_types::CellValue;

// =============================================================================
// Helper: toNumber
// =============================================================================

/// Convert a CellValue to an f64, returning None if not numeric.
/// Port of TypeScript `toNumber`.
fn to_number(value: &CellValue) -> Option<f64> {
    match value {
        CellValue::Number(n) => Some(n.get()),
        CellValue::Text(s) => s.parse::<f64>().ok(),
        CellValue::Boolean(b) => Some(if *b { 1.0 } else { 0.0 }),
        CellValue::Control(c) => Some(if c.value { 1.0 } else { 0.0 }),
        CellValue::Error(..) => None,
        CellValue::Null => None,
        CellValue::Array(_) => None,
        CellValue::Image(_) => None,
    }
}

// =============================================================================
// Helper: float_eq (Excel-compatible epsilon comparison)
// =============================================================================

/// Excel-compatible float comparison: equal if relative difference < 1e-15
/// or both values are very close to zero (absolute difference < 1e-15).
///
/// Excel internally compares using ~15 significant digits of precision,
/// so `0.1 + 0.2 == 0.3` evaluates to true in Excel.
fn float_eq(a: f64, b: f64) -> bool {
    if a == b {
        return true;
    } // handles exact match, infinities
    let diff = (a - b).abs();
    let largest = a.abs().max(b.abs());
    if largest == 0.0 {
        return diff < 1e-15;
    }
    diff / largest < 1e-15
}

/// Greater-than-or-equal with epsilon tolerance (matches float_eq semantics).
fn float_gte(a: f64, b: f64) -> bool {
    a > b || float_eq(a, b)
}

/// Less-than-or-equal with epsilon tolerance (matches float_eq semantics).
fn float_lte(a: f64, b: f64) -> bool {
    a < b || float_eq(a, b)
}

// =============================================================================
// Helper: compareValues
// =============================================================================

/// Compare a cell value against a numeric threshold using the given operator.
/// Port of TypeScript `compareValues`.
///
/// Only handles single-value operators (Between/NotBetween are handled at the
/// `CellValueComparison` level and never reach this function).
fn compare_values(value: &CellValue, threshold: f64, operator: &CellValueSingleOp) -> bool {
    let num_value = to_number(value);

    // Numeric comparison -- require numeric cell value
    if let Some(n) = num_value {
        // NaN values should not participate in numeric comparison (matches Excel behavior
        // where error cells don't match CF cell value rules).
        if n.is_nan() {
            return false;
        }
        match operator {
            CellValueSingleOp::GreaterThan => n > threshold && !float_eq(n, threshold),
            CellValueSingleOp::LessThan => n < threshold && !float_eq(n, threshold),
            CellValueSingleOp::GreaterThanOrEqual => float_gte(n, threshold),
            CellValueSingleOp::LessThanOrEqual => float_lte(n, threshold),
            CellValueSingleOp::Equal => float_eq(n, threshold),
            CellValueSingleOp::NotEqual => !float_eq(n, threshold),
        }
    } else {
        // Non-numeric cell value: it is inherently not equal to any number,
        // so NotEqual should return true. All other operators (including Equal)
        // return false because ordering is undefined for mixed types.
        matches!(operator, CellValueSingleOp::NotEqual)
    }
}

/// Convert a CellValue to a string representation using `Cow` to avoid
/// allocation for the common `Text` case.
fn cell_value_to_string(value: &CellValue) -> Cow<'_, str> {
    match value {
        CellValue::Text(s) => Cow::Borrowed(s),
        CellValue::Number(n) => Cow::Owned(n.to_string()),
        CellValue::Boolean(b) => Cow::Borrowed(if *b { "TRUE" } else { "FALSE" }),
        _ => Cow::Borrowed(""),
    }
}

/// Compare a cell value against a string threshold (used when the threshold
/// cannot be parsed as a number). Case-insensitive for equal/notEqual.
///
/// # Case-sensitivity note
///
/// Uses Unicode-aware case-insensitive comparison (`to_lowercase`).
/// The original TypeScript source uses case-sensitive comparison (`===`).
/// The Rust behavior matches Excel's actual behavior -- CF cell value rules are
/// case-insensitive. This is an intentional improvement over the TS source.
fn compare_values_string(value: &CellValue, threshold: &str, operator: &CellValueSingleOp) -> bool {
    // Return false for Error/Array/Lambda values (same as the old Null => "" path
    // won't match non-empty thresholds, but Error/Array/Lambda should never match).
    //
    // Boolean values also do not participate in string comparisons. In Excel,
    // Boolean and Text are different types -- Boolean(true) Equal "TRUE" does NOT
    // match. Booleans only compare via the numeric path (TRUE=1, FALSE=0).
    if matches!(
        value,
        CellValue::Boolean(_) | CellValue::Error(..) | CellValue::Array(_) | CellValue::Image(_)
    ) {
        return false;
    }

    let str_value = cell_value_to_string(value);

    match operator {
        CellValueSingleOp::Equal => str_value.to_lowercase() == threshold.to_lowercase(),
        CellValueSingleOp::NotEqual => str_value.to_lowercase() != threshold.to_lowercase(),
        // For other operators with non-numeric thresholds, no match
        _ => false,
    }
}

// =============================================================================
// Public: evaluate_cell_value
// =============================================================================

/// Evaluate a cell value comparison rule.
/// Returns `true` if the rule matches, `false` otherwise.
///
/// Port of TypeScript `evaluateCellValueRule`.
///
/// The `CellValueComparison` encodes both the operator and pre-parsed thresholds:
/// - `Single { operator, threshold }` for single-value operators
/// - `Between { low, high }` / `NotBetween { low, high }` for range operators
///
/// Arity is enforced at the type level -- no need to check value counts.
pub fn evaluate_cell_value(value: &CellValue, comparison: &CellValueComparison) -> bool {
    match comparison {
        CellValueComparison::Between { low, high } => {
            let Some(num_value) = to_number(value) else {
                return false;
            };
            if num_value.is_nan() {
                return false;
            }
            float_gte(num_value, *low) && float_lte(num_value, *high)
        }
        CellValueComparison::NotBetween { low, high } => {
            let Some(num_value) = to_number(value) else {
                return false;
            };
            if num_value.is_nan() {
                return false;
            }
            let is_between = float_gte(num_value, *low) && float_lte(num_value, *high);
            !is_between
        }
        CellValueComparison::Single {
            operator,
            threshold,
        } => {
            // If threshold has a numeric value, try numeric comparison
            if let Some(thresh_num) = threshold.number {
                let num_value = to_number(value);
                if num_value.is_none()
                    && !matches!(
                        operator,
                        CellValueSingleOp::Equal | CellValueSingleOp::NotEqual
                    )
                {
                    return false;
                }
                compare_values(value, thresh_num, operator)
            } else {
                // Non-numeric threshold -- string comparison for Equal/NotEqual
                match operator {
                    CellValueSingleOp::Equal | CellValueSingleOp::NotEqual => {
                        compare_values_string(value, &threshold.text, operator)
                    }
                    _ => false,
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "cell_value_tests.rs"]
mod tests;
