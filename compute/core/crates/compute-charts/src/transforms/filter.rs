//! Filter transform — removes rows that don't match a predicate.
//!
//! Supports both structured `FilterSpec` predicates (AND-combined)
//! and simple string expressions like `"datum.field > 10"`.

use serde_json::Value;

use crate::types::{DataRow, FilterInput, FilterSpec};
use crate::utils::value_as_f64;

// =============================================================================
// Public API
// =============================================================================

/// Apply a filter transform, returning only rows that match the predicate.
pub fn apply_filter(data: &[DataRow], filter: &FilterInput) -> Vec<DataRow> {
    match filter {
        FilterInput::Spec(spec) => apply_spec_filter(data, spec),
        FilterInput::Expression(expr) => apply_expression_filter(data, expr),
    }
}

// =============================================================================
// Spec-based filter
// =============================================================================

/// Filter rows using a structured `FilterSpec`. All conditions are AND-combined.
fn apply_spec_filter(data: &[DataRow], spec: &FilterSpec) -> Vec<DataRow> {
    data.iter()
        .filter(|row| row_matches_spec(row, spec))
        .cloned()
        .collect()
}

/// Check if a single row satisfies all predicates in the spec.
fn row_matches_spec(row: &DataRow, spec: &FilterSpec) -> bool {
    let value = match row.get(&spec.field) {
        Some(v) => v,
        None => return false,
    };

    // equal
    if let Some(ref expected) = spec.equal
        && value != expected
    {
        return false;
    }

    // oneOf
    if let Some(ref values) = spec.one_of
        && !values.iter().any(|v| v == value)
    {
        return false;
    }

    // Numeric comparisons — extract f64 from the row value.
    let numeric = value_as_f64(value);

    // lt
    if let Some(threshold) = spec.lt {
        match numeric {
            Some(n) if n < threshold => {}
            _ => return false,
        }
    }

    // lte
    if let Some(threshold) = spec.lte {
        match numeric {
            Some(n) if n <= threshold => {}
            _ => return false,
        }
    }

    // gt
    if let Some(threshold) = spec.gt {
        match numeric {
            Some(n) if n > threshold => {}
            _ => return false,
        }
    }

    // gte
    if let Some(threshold) = spec.gte {
        match numeric {
            Some(n) if n >= threshold => {}
            _ => return false,
        }
    }

    // range [min, max] (inclusive)
    if let Some((lo, hi)) = spec.range {
        match numeric {
            Some(n) if n >= lo && n <= hi => {}
            _ => return false,
        }
    }

    true
}

// =============================================================================
// Expression-based filter
// =============================================================================

/// Filter rows using a simple expression string.
///
/// Supported syntax:
/// - Comparison: `datum.field > 10`, `datum.field == "hello"`, etc.
/// - Operators: `==`, `!=`, `>`, `>=`, `<`, `<=`
/// - Logical: `&&`, `||`
/// - Truthy check: `datum.field` (non-null, non-false, non-zero, non-empty-string)
/// - Negation: `!datum.field`
fn apply_expression_filter(data: &[DataRow], expr: &str) -> Vec<DataRow> {
    let expr = expr.trim();
    if expr.is_empty() {
        return data.to_vec();
    }

    data.iter()
        .filter(|row| evaluate_expression(row, expr))
        .cloned()
        .collect()
}

/// Evaluate a filter expression against a single row.
fn evaluate_expression(row: &DataRow, expr: &str) -> bool {
    let expr = expr.trim();

    // Handle || (split on top-level ||)
    if let Some((left, right)) = split_logical(expr, "||") {
        return evaluate_expression(row, left) || evaluate_expression(row, right);
    }

    // Handle && (split on top-level &&)
    if let Some((left, right)) = split_logical(expr, "&&") {
        return evaluate_expression(row, left) && evaluate_expression(row, right);
    }

    // Handle negation: !datum.field
    if let Some(rest) = expr.strip_prefix('!') {
        let rest = rest.trim();
        return !evaluate_expression(row, rest);
    }

    // Try comparison operators (longest first to avoid ambiguity).
    for &op in &["==", "!=", ">=", "<=", ">", "<"] {
        if let Some(idx) = expr.find(op) {
            let left = expr[..idx].trim();
            let right = expr[idx + op.len()..].trim();
            let left_val = resolve_value(row, left);
            let right_val = resolve_value(row, right);
            return compare_values(&left_val, &right_val, op);
        }
    }

    // Truthy check: just a field reference.
    let val = resolve_value(row, expr);
    is_truthy(&val)
}

/// Split an expression on a top-level logical operator (`&&` or `||`),
/// respecting parentheses and string literals.
fn split_logical<'a>(expr: &'a str, op: &str) -> Option<(&'a str, &'a str)> {
    let bytes = expr.as_bytes();
    let op_bytes = op.as_bytes();
    let op_len = op_bytes.len();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut string_char = 0u8;
    let mut i = 0;

    while i < bytes.len() {
        let b = bytes[i];

        if in_string {
            if b == string_char {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if b == b'"' || b == b'\'' {
            in_string = true;
            string_char = b;
            i += 1;
            continue;
        }

        if b == b'(' {
            depth += 1;
        } else if b == b')' {
            depth -= 1;
        }

        if depth == 0 && i + op_len <= bytes.len() && bytes[i..i + op_len] == *op_bytes {
            let left = &expr[..i];
            let right = &expr[i + op_len..];
            // Only split if both sides are non-empty (after trimming).
            if !left.trim().is_empty() && !right.trim().is_empty() {
                return Some((left, right));
            }
        }

        i += 1;
    }

    None
}

/// Resolve a value token to a `serde_json::Value`.
///
/// Handles:
/// - `datum.field` or `datum['field']` → lookup in row
/// - Numeric literals: `42`, `3.14`
/// - String literals: `"hello"`, `'hello'`
/// - Boolean literals: `true`, `false`
/// - `null`
fn resolve_value(row: &DataRow, token: &str) -> Value {
    let token = token.trim();

    // datum.field
    if let Some(field) = token.strip_prefix("datum.") {
        return row.get(field).cloned().unwrap_or(Value::Null);
    }

    // datum['field'] or datum["field"]
    if token.starts_with("datum[") && token.ends_with(']') {
        let inner = &token[6..token.len() - 1].trim();
        let field = inner
            .strip_prefix('\'')
            .and_then(|s| s.strip_suffix('\''))
            .or_else(|| inner.strip_prefix('"').and_then(|s| s.strip_suffix('"')));
        if let Some(f) = field {
            return row.get(f).cloned().unwrap_or(Value::Null);
        }
    }

    // String literals
    if (token.starts_with('"') && token.ends_with('"'))
        || (token.starts_with('\'') && token.ends_with('\''))
    {
        return Value::String(token[1..token.len() - 1].to_string());
    }

    // Boolean literals
    if token == "true" {
        return Value::Bool(true);
    }
    if token == "false" {
        return Value::Bool(false);
    }

    // null
    if token == "null" {
        return Value::Null;
    }

    // Numeric literal
    if let Ok(n) = token.parse::<f64>() {
        return Value::from(n);
    }

    // Bare field name (no "datum." prefix) — treat as field lookup.
    row.get(token).cloned().unwrap_or(Value::Null)
}

/// Compare two `serde_json::Value`s using the given operator.
fn compare_values(left: &Value, right: &Value, op: &str) -> bool {
    match op {
        "==" | "!=" => {
            // For numeric values, compare as f64 to avoid integer/float representation mismatch.
            if let (Some(l), Some(r)) = (value_as_f64(left), value_as_f64(right)) {
                return if op == "==" { l == r } else { l != r };
            }
            if op == "==" {
                left == right
            } else {
                left != right
            }
        }
        ">" | ">=" | "<" | "<=" => {
            // Try numeric comparison first.
            if let (Some(l), Some(r)) = (value_as_f64(left), value_as_f64(right)) {
                return match op {
                    ">" => l > r,
                    ">=" => l >= r,
                    "<" => l < r,
                    "<=" => l <= r,
                    _ => false,
                };
            }
            // Fall back to string comparison.
            if let (Some(l), Some(r)) = (left.as_str(), right.as_str()) {
                return match op {
                    ">" => l > r,
                    ">=" => l >= r,
                    "<" => l < r,
                    "<=" => l <= r,
                    _ => false,
                };
            }
            false
        }
        _ => false,
    }
}

/// Check if a value is "truthy" (non-null, non-false, non-zero, non-empty-string).
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|v| v != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(_) => true,
    }
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

    fn sample_data() -> Vec<DataRow> {
        vec![
            make_row(&[
                ("name", json!("Alice")),
                ("age", json!(25)),
                ("score", json!(90)),
            ]),
            make_row(&[
                ("name", json!("Bob")),
                ("age", json!(30)),
                ("score", json!(85)),
            ]),
            make_row(&[
                ("name", json!("Charlie")),
                ("age", json!(35)),
                ("score", json!(92)),
            ]),
            make_row(&[
                ("name", json!("Diana")),
                ("age", json!(28)),
                ("score", json!(78)),
            ]),
        ]
    }

    // ---- Empty data ----

    #[test]
    fn filter_empty_data() {
        let spec = FilterSpec {
            field: "x".to_string(),
            equal: Some(json!(1)),
            lt: None,
            lte: None,
            gt: None,
            gte: None,
            one_of: None,
            range: None,
        };
        let result = apply_filter(&[], &FilterInput::Spec(spec));
        assert!(result.is_empty());
    }

    // ---- Spec: equal ----

    #[test]
    fn filter_spec_equal() {
        let data = sample_data();
        let spec = FilterSpec {
            field: "name".to_string(),
            equal: Some(json!("Bob")),
            lt: None,
            lte: None,
            gt: None,
            gte: None,
            one_of: None,
            range: None,
        };
        let result = apply_filter(&data, &FilterInput::Spec(spec));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("name").unwrap(), &json!("Bob"));
    }

    // ---- Spec: gt ----

    #[test]
    fn filter_spec_gt() {
        let data = sample_data();
        let spec = FilterSpec {
            field: "age".to_string(),
            equal: None,
            lt: None,
            lte: None,
            gt: Some(28.0),
            gte: None,
            one_of: None,
            range: None,
        };
        let result = apply_filter(&data, &FilterInput::Spec(spec));
        assert_eq!(result.len(), 2); // Bob (30), Charlie (35)
    }

    // ---- Spec: range ----

    #[test]
    fn filter_spec_range() {
        let data = sample_data();
        let spec = FilterSpec {
            field: "score".to_string(),
            equal: None,
            lt: None,
            lte: None,
            gt: None,
            gte: None,
            one_of: None,
            range: Some((80.0, 91.0)),
        };
        let result = apply_filter(&data, &FilterInput::Spec(spec));
        assert_eq!(result.len(), 2); // Alice (90), Bob (85)
    }

    // ---- Spec: one_of ----

    #[test]
    fn filter_spec_one_of() {
        let data = sample_data();
        let spec = FilterSpec {
            field: "name".to_string(),
            equal: None,
            lt: None,
            lte: None,
            gt: None,
            gte: None,
            one_of: Some(vec![json!("Alice"), json!("Charlie")]),
            range: None,
        };
        let result = apply_filter(&data, &FilterInput::Spec(spec));
        assert_eq!(result.len(), 2);
    }

    // ---- Spec: combined AND ----

    #[test]
    fn filter_spec_combined_and() {
        let data = sample_data();
        let spec = FilterSpec {
            field: "age".to_string(),
            equal: None,
            lt: None,
            lte: None,
            gt: Some(25.0),
            gte: None,
            one_of: None,
            range: None,
        };
        // gt 25 -> Bob (30), Charlie (35), Diana (28)
        let result = apply_filter(&data, &FilterInput::Spec(spec));
        assert_eq!(result.len(), 3);
    }

    // ---- Spec: missing field ----

    #[test]
    fn filter_spec_missing_field() {
        let data = sample_data();
        let spec = FilterSpec {
            field: "nonexistent".to_string(),
            equal: Some(json!(42)),
            lt: None,
            lte: None,
            gt: None,
            gte: None,
            one_of: None,
            range: None,
        };
        let result = apply_filter(&data, &FilterInput::Spec(spec));
        assert!(result.is_empty());
    }

    // ---- Expression: comparison ----

    #[test]
    fn filter_expr_comparison() {
        let data = sample_data();
        let result = apply_filter(
            &data,
            &FilterInput::Expression("datum.age > 28".to_string()),
        );
        assert_eq!(result.len(), 2); // Bob (30), Charlie (35)
    }

    #[test]
    fn filter_expr_equality() {
        let data = sample_data();
        let result = apply_filter(
            &data,
            &FilterInput::Expression("datum.name == \"Alice\"".to_string()),
        );
        assert_eq!(result.len(), 1);
    }

    // ---- Expression: logical operators ----

    #[test]
    fn filter_expr_and() {
        let data = sample_data();
        let result = apply_filter(
            &data,
            &FilterInput::Expression("datum.age > 25 && datum.score > 80".to_string()),
        );
        // Bob (30, 85), Charlie (35, 92)
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn filter_expr_or() {
        let data = sample_data();
        let result = apply_filter(
            &data,
            &FilterInput::Expression("datum.age == 25 || datum.age == 35".to_string()),
        );
        // Alice (25), Charlie (35)
        assert_eq!(result.len(), 2);
    }

    // ---- Expression: truthy ----

    #[test]
    fn filter_expr_truthy() {
        let data = vec![
            make_row(&[("x", json!(0))]),
            make_row(&[("x", json!(1))]),
            make_row(&[("x", json!(null))]),
            make_row(&[("x", json!(5))]),
        ];
        let result = apply_filter(&data, &FilterInput::Expression("datum.x".to_string()));
        assert_eq!(result.len(), 2); // 1 and 5
    }

    // ---- Expression: negation ----

    #[test]
    fn filter_expr_negation() {
        let data = vec![
            make_row(&[("active", json!(true))]),
            make_row(&[("active", json!(false))]),
        ];
        let result = apply_filter(&data, &FilterInput::Expression("!datum.active".to_string()));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("active").unwrap(), &json!(false));
    }

    // ---- Expression: empty ----

    #[test]
    fn filter_expr_empty_returns_all() {
        let data = sample_data();
        let result = apply_filter(&data, &FilterInput::Expression("".to_string()));
        assert_eq!(result.len(), data.len());
    }

    // ---- Spec: lte and gte ----

    #[test]
    fn filter_spec_lte_gte() {
        let data = sample_data();
        let spec = FilterSpec {
            field: "age".to_string(),
            equal: None,
            lt: None,
            lte: Some(30.0),
            gt: None,
            gte: Some(28.0),
            one_of: None,
            range: None,
        };
        // age >= 28 AND age <= 30 -> Bob (30), Diana (28)
        let result = apply_filter(&data, &FilterInput::Spec(spec));
        assert_eq!(result.len(), 2);
    }
}
