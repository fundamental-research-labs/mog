//! Calculate transform — derives a new field from an expression.
//!
//! Supports simple field references, arithmetic (+, -, *, /),
//! and string concatenation. Division by zero produces null.

use serde_json::Value;

use crate::types::DataRow;
use crate::utils::{value_as_f64, value_to_string};

// =============================================================================
// Public API
// =============================================================================

/// Apply a calculate transform, adding a new field computed from an expression.
///
/// Supports:
/// - Simple field reference: `"price"` or `"datum.price"` → copies the field value
/// - Arithmetic: `"datum.price * datum.quantity"`, `"datum.x + 1"` → numeric result
/// - String concat: `"datum.first + ' ' + datum.last"` → string result
/// - Division by zero → null
pub fn apply_calculate(data: &[DataRow], expr: &str, as_field: &str) -> Vec<DataRow> {
    data.iter()
        .map(|row| {
            let mut out = row.clone();
            let value = evaluate_calc_expr(row, expr.trim());
            out.insert(as_field.to_string(), value);
            out
        })
        .collect()
}

// =============================================================================
// Expression evaluator
// =============================================================================

/// Evaluate a calculate expression against a single row.
fn evaluate_calc_expr(row: &DataRow, expr: &str) -> Value {
    let expr = expr.trim();

    // Try to parse as a binary arithmetic/concat expression.
    // We look for +, -, *, / operators at the top level (outside strings).
    // Precedence: we handle + and - first (lowest), then * and / (higher).
    // This gives us correct precedence for simple two-operand expressions.

    // Try addition/subtraction (lower precedence — scan right to left
    // so left-associativity is preserved).
    if let Some((left, op, right)) = split_binary_op(expr, &['+', '-']) {
        let left_val = evaluate_calc_expr(row, left);
        let right_val = evaluate_calc_expr(row, right);

        // String concatenation for +
        if op == '+' && (is_string_value(&left_val) || is_string_value(&right_val)) {
            let l = value_to_string(&left_val);
            let r = value_to_string(&right_val);
            return Value::String(format!("{}{}", l, r));
        }

        if let (Some(l), Some(r)) = (value_as_f64(&left_val), value_as_f64(&right_val)) {
            let result = match op {
                '+' => l + r,
                '-' => l - r,
                _ => return Value::Null,
            };
            return if result.is_finite() {
                Value::from(result)
            } else {
                Value::Null
            };
        }

        return Value::Null;
    }

    // Try multiplication/division (higher precedence).
    if let Some((left, op, right)) = split_binary_op(expr, &['*', '/']) {
        let left_val = evaluate_calc_expr(row, left);
        let right_val = evaluate_calc_expr(row, right);

        if let (Some(l), Some(r)) = (value_as_f64(&left_val), value_as_f64(&right_val)) {
            let result = match op {
                '*' => l * r,
                '/' => {
                    if r == 0.0 {
                        return Value::Null;
                    }
                    l / r
                }
                _ => return Value::Null,
            };
            return if result.is_finite() {
                Value::from(result)
            } else {
                Value::Null
            };
        }

        return Value::Null;
    }

    // Leaf: resolve as a value token.
    resolve_token(row, expr)
}

/// Split an expression on the rightmost top-level operator from the given set.
///
/// Scans right-to-left so left-associativity is preserved.
/// Respects parentheses and string literals.
fn split_binary_op<'a>(expr: &'a str, ops: &[char]) -> Option<(&'a str, char, &'a str)> {
    let bytes = expr.as_bytes();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut string_char = 0u8;

    // Scan right to left.
    let mut i = bytes.len();
    while i > 0 {
        i -= 1;
        let b = bytes[i];

        if in_string {
            if b == string_char {
                in_string = false;
            }
            continue;
        }

        if b == b'"' || b == b'\'' {
            in_string = true;
            string_char = b;
            continue;
        }

        if b == b')' {
            depth += 1;
        } else if b == b'(' {
            depth -= 1;
        }

        if depth == 0 && i > 0 {
            let ch = b as char;
            if ops.contains(&ch) {
                let left = expr[..i].trim();
                let right = expr[i + 1..].trim();
                // Don't split if left is empty (e.g., negative number).
                if !left.is_empty() && !right.is_empty() {
                    return Some((left, ch, right));
                }
            }
        }
    }

    None
}

/// Resolve a leaf token to a `serde_json::Value`.
fn resolve_token(row: &DataRow, token: &str) -> Value {
    let token = token.trim();

    // Strip wrapping parentheses.
    if token.starts_with('(') && token.ends_with(')') {
        return evaluate_calc_expr(row, &token[1..token.len() - 1]);
    }

    // datum.field
    if let Some(field) = token.strip_prefix("datum.") {
        return row.get(field).cloned().unwrap_or(Value::Null);
    }

    // datum['field'] or datum["field"]
    if token.starts_with("datum[") && token.ends_with(']') {
        let inner = token[6..token.len() - 1].trim();
        let field = inner
            .strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\''))
            .or_else(|| inner.strip_prefix('"').and_then(|s| s.strip_suffix('"')));
        if let Some(f) = field {
            return row.get(f).cloned().unwrap_or(Value::Null);
        }
    }

    // String literal
    if (token.starts_with('"') && token.ends_with('"'))
        || (token.starts_with('\'') && token.ends_with('\''))
    {
        return Value::String(token[1..token.len() - 1].to_string());
    }

    // Numeric literal
    if let Ok(n) = token.parse::<f64>() {
        return Value::from(n);
    }

    // null
    if token == "null" {
        return Value::Null;
    }

    // Bare field name
    row.get(token).cloned().unwrap_or(Value::Null)
}

/// Check if a Value is a string.
fn is_string_value(v: &Value) -> bool {
    matches!(v, Value::String(_))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_row(pairs: &[(&str, Value)]) -> DataRow {
        let mut row = DataRow::new();
        for (k, v) in pairs {
            row.insert(k.to_string(), v.clone());
        }
        row
    }

    // ---- Empty data ----

    #[test]
    fn calculate_empty_data() {
        let result = apply_calculate(&[], "datum.x + 1", "y");
        assert!(result.is_empty());
    }

    // ---- Simple field reference ----

    #[test]
    fn calculate_field_reference() {
        let data = vec![make_row(&[("price", json!(42))])];
        let result = apply_calculate(&data, "datum.price", "out");
        assert_eq!(result[0].get("out"), Some(&json!(42)));
    }

    // ---- Bare field reference ----

    #[test]
    fn calculate_bare_field() {
        let data = vec![make_row(&[("price", json!(42))])];
        let result = apply_calculate(&data, "price", "out");
        assert_eq!(result[0].get("out"), Some(&json!(42)));
    }

    // ---- Arithmetic ----

    #[test]
    fn calculate_addition() {
        let data = vec![make_row(&[("a", json!(10)), ("b", json!(20))])];
        let result = apply_calculate(&data, "datum.a + datum.b", "sum");
        assert_eq!(result[0].get("sum").and_then(|v| v.as_f64()), Some(30.0));
    }

    #[test]
    fn calculate_subtraction() {
        let data = vec![make_row(&[("a", json!(50)), ("b", json!(20))])];
        let result = apply_calculate(&data, "datum.a - datum.b", "diff");
        assert_eq!(result[0].get("diff").and_then(|v| v.as_f64()), Some(30.0));
    }

    #[test]
    fn calculate_multiplication() {
        let data = vec![make_row(&[("price", json!(10)), ("qty", json!(3))])];
        let result = apply_calculate(&data, "datum.price * datum.qty", "total");
        assert_eq!(result[0].get("total").and_then(|v| v.as_f64()), Some(30.0));
    }

    #[test]
    fn calculate_division() {
        let data = vec![make_row(&[("a", json!(100)), ("b", json!(4))])];
        let result = apply_calculate(&data, "datum.a / datum.b", "ratio");
        assert_eq!(result[0].get("ratio").and_then(|v| v.as_f64()), Some(25.0));
    }

    // ---- Division by zero ----

    #[test]
    fn calculate_division_by_zero() {
        let data = vec![make_row(&[("a", json!(100)), ("b", json!(0))])];
        let result = apply_calculate(&data, "datum.a / datum.b", "ratio");
        assert_eq!(result[0].get("ratio"), Some(&Value::Null));
    }

    // ---- Field + constant ----

    #[test]
    fn calculate_field_plus_constant() {
        let data = vec![make_row(&[("x", json!(5))])];
        let result = apply_calculate(&data, "datum.x * 2", "double");
        assert_eq!(result[0].get("double").and_then(|v| v.as_f64()), Some(10.0));
    }

    // ---- String concatenation ----

    #[test]
    fn calculate_string_concat() {
        let data = vec![make_row(&[
            ("first", json!("John")),
            ("last", json!("Doe")),
        ])];
        let result = apply_calculate(&data, "datum.first + ' ' + datum.last", "full_name");
        assert_eq!(result[0].get("full_name"), Some(&json!("John Doe")));
    }

    // ---- Missing field -> null ----

    #[test]
    fn calculate_missing_field() {
        let data = vec![make_row(&[("x", json!(10))])];
        let result = apply_calculate(&data, "datum.missing + 1", "out");
        assert_eq!(result[0].get("out"), Some(&Value::Null));
    }

    // ---- Preserves original fields ----

    #[test]
    fn calculate_preserves_original() {
        let data = vec![make_row(&[("x", json!(5)), ("name", json!("A"))])];
        let result = apply_calculate(&data, "datum.x + 1", "y");
        assert_eq!(result[0].get("x"), Some(&json!(5)));
        assert_eq!(result[0].get("name"), Some(&json!("A")));
        assert_eq!(result[0].get("y").and_then(|v| v.as_f64()), Some(6.0));
    }

    // ---- Multiple rows ----

    #[test]
    fn calculate_multiple_rows() {
        let data = vec![
            make_row(&[("v", json!(1))]),
            make_row(&[("v", json!(2))]),
            make_row(&[("v", json!(3))]),
        ];
        let result = apply_calculate(&data, "datum.v * datum.v", "v_squared");
        assert_eq!(
            result[0].get("v_squared").and_then(|v| v.as_f64()),
            Some(1.0)
        );
        assert_eq!(
            result[1].get("v_squared").and_then(|v| v.as_f64()),
            Some(4.0)
        );
        assert_eq!(
            result[2].get("v_squared").and_then(|v| v.as_f64()),
            Some(9.0)
        );
    }

    // ---- Numeric literal ----

    #[test]
    fn calculate_numeric_literal() {
        let data = vec![make_row(&[("x", json!(1))])];
        let result = apply_calculate(&data, "42", "answer");
        assert_eq!(result[0].get("answer").and_then(|v| v.as_f64()), Some(42.0));
    }
}
