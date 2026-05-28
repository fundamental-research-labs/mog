use std::collections::HashMap;
use std::hash::BuildHasher;

use super::MAX_DEPTH;
use super::ast::{CalcFieldExpr, CalcFieldOp};

/// Evaluate a calculated field expression given field values.
///
/// Field name lookup is case-insensitive, matching Excel behaviour.
///
/// Returns `None` if any referenced field is missing or has a null value,
/// or if division by zero occurs, if the result is NaN or infinite, or if
/// expression depth exceeds `MAX_DEPTH`.
///
/// # Examples
///
/// ```
/// use compute_pivot::{parse_calc_field, evaluate_calc_field};
/// use std::collections::HashMap;
///
/// let expr = parse_calc_field("Revenue / Units").unwrap();
/// let mut fields = HashMap::new();
/// fields.insert("Revenue", 10000.0);
/// fields.insert("Units", 100.0);
/// assert_eq!(evaluate_calc_field(&expr, &fields), Some(100.0));
/// ```
#[must_use]
pub fn evaluate_calc_field<S: BuildHasher>(
    expr: &CalcFieldExpr,
    field_values: &HashMap<&str, f64, S>,
) -> Option<f64> {
    evaluate_inner(expr, field_values, 0)
}

/// Recursive evaluator with depth tracking.
fn evaluate_inner<S: BuildHasher>(
    expr: &CalcFieldExpr,
    field_values: &HashMap<&str, f64, S>,
    depth: usize,
) -> Option<f64> {
    if depth > MAX_DEPTH {
        return None;
    }
    match expr {
        CalcFieldExpr::Number(n) => Some(*n),
        CalcFieldExpr::FieldRef(name) => {
            // Case-insensitive field lookup to match Excel behaviour.
            field_values
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| *v)
        }
        CalcFieldExpr::BinaryOp { op, left, right } => {
            let l = evaluate_inner(left, field_values, depth + 1)?;
            let r = evaluate_inner(right, field_values, depth + 1)?;
            let result = match op {
                CalcFieldOp::Add => l + r,
                CalcFieldOp::Sub => l - r,
                CalcFieldOp::Mul => l * r,
                CalcFieldOp::Div => {
                    if r == 0.0 {
                        return None;
                    }
                    l / r
                }
            };
            // Guard against NaN and Infinity
            if result.is_finite() {
                Some(result)
            } else {
                None
            }
        }
        CalcFieldExpr::Negate(inner) => evaluate_inner(inner, field_values, depth + 1).map(|v| -v),
    }
}
