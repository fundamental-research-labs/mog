use std::collections::HashMap;

use super::*;

#[test]
fn test_evaluate_basic_arithmetic() {
    let mut fields = HashMap::new();
    fields.insert("A", 10.0);
    fields.insert("B", 3.0);

    let expr = parse_calc_field("A + B").unwrap();
    assert_eq!(evaluate_calc_field(&expr, &fields), Some(13.0));

    let expr = parse_calc_field("A - B").unwrap();
    assert_eq!(evaluate_calc_field(&expr, &fields), Some(7.0));

    let expr = parse_calc_field("A * B").unwrap();
    assert_eq!(evaluate_calc_field(&expr, &fields), Some(30.0));

    let expr = parse_calc_field("A / B").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!((result - 10.0 / 3.0).abs() < 1e-10);
}

#[test]
fn test_evaluate_division_by_zero() {
    let mut fields = HashMap::new();
    fields.insert("Revenue", 1000.0);
    fields.insert("Units", 0.0);

    let expr = parse_calc_field("Revenue / Units").unwrap();
    assert_eq!(evaluate_calc_field(&expr, &fields), None);
}

#[test]
fn test_evaluate_missing_field() {
    let mut fields = HashMap::new();
    fields.insert("Revenue", 1000.0);
    // "Units" is not in the map

    let expr = parse_calc_field("Revenue / Units").unwrap();
    assert_eq!(evaluate_calc_field(&expr, &fields), None);
}

#[test]
fn test_evaluate_complex_expression() {
    let mut fields = HashMap::new();
    fields.insert("Revenue", 1000.0);
    fields.insert("Cost", 600.0);

    // Profit margin: (Revenue - Cost) / Revenue * 100
    let expr = parse_calc_field("(Revenue - Cost) / Revenue * 100").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!(
        (result - 40.0).abs() < 1e-10,
        "Expected 40.0, got {}",
        result
    );
}

#[test]
fn test_evaluate_negation() {
    let mut fields = HashMap::new();
    fields.insert("Revenue", 1000.0);
    fields.insert("Cost", 600.0);

    let expr = parse_calc_field("-Revenue + Cost").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!((result - (-400.0)).abs() < 1e-10);
}

#[test]
fn test_evaluate_numeric_literal() {
    let expr = parse_calc_field("42").unwrap();
    let fields = HashMap::new();
    assert_eq!(evaluate_calc_field(&expr, &fields), Some(42.0));
}

#[test]
fn test_evaluate_with_numeric_multiplier() {
    let mut fields = HashMap::new();
    fields.insert("Revenue", 1000.0);

    let expr = parse_calc_field("Revenue * 1.15").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!((result - 1150.0).abs() < 1e-10);
}

#[test]
fn test_evaluate_nested_division_by_zero() {
    let mut fields = HashMap::new();
    fields.insert("A", 10.0);
    fields.insert("B", 0.0);
    fields.insert("C", 5.0);

    // (A / B) + C — division by zero in subexpression
    let expr = parse_calc_field("(A / B) + C").unwrap();
    assert_eq!(evaluate_calc_field(&expr, &fields), None);
}

#[test]
fn test_evaluate_empty_fields() {
    let fields: HashMap<&str, f64> = HashMap::new();

    let expr = parse_calc_field("Revenue").unwrap();
    assert_eq!(evaluate_calc_field(&expr, &fields), None);
}

#[test]
fn test_evaluate_all_operations_precedence() {
    let mut fields = HashMap::new();
    fields.insert("A", 2.0);
    fields.insert("B", 3.0);
    fields.insert("C", 4.0);
    fields.insert("D", 5.0);

    // A + B * C - D => 2 + 12 - 5 = 9
    let expr = parse_calc_field("A + B * C - D").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!((result - 9.0).abs() < 1e-10);
}

#[test]
fn test_evaluate_double_negation() {
    let mut fields = HashMap::new();
    fields.insert("Revenue", 1000.0);

    let expr = parse_calc_field("--Revenue").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!((result - 1000.0).abs() < 1e-10);
}

#[test]
fn test_evaluate_quoted_field_names() {
    let mut fields = HashMap::new();
    fields.insert("Cost of Goods", 600.0);
    fields.insert("Revenue", 1000.0);

    let expr = parse_calc_field("'Cost of Goods' / Revenue").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!((result - 0.6).abs() < 1e-10);
}

#[test]
fn test_round_trip_complex_formula() {
    let mut fields = HashMap::new();
    fields.insert("Sales", 10000.0);
    fields.insert("Returns", 500.0);
    fields.insert("Units", 200.0);

    // Net revenue per unit: (Sales - Returns) / Units
    let expr = parse_calc_field("(Sales - Returns) / Units").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!((result - 47.5).abs() < 1e-10);
}

#[test]
fn test_evaluate_case_insensitive_field_lookup() {
    let mut fields = HashMap::new();
    fields.insert("revenue", 1000.0);
    fields.insert("Units", 50.0);

    // Formula references "Revenue" (capital R) but map has "revenue" (lowercase)
    let expr = parse_calc_field("Revenue / Units").unwrap();
    let result = evaluate_calc_field(&expr, &fields).unwrap();
    assert!((result - 20.0).abs() < 1e-10);

    // Also verify mixed case: formula "UNITS" matches "Units"
    let expr2 = parse_calc_field("revenue / UNITS").unwrap();
    let result2 = evaluate_calc_field(&expr2, &fields).unwrap();
    assert!((result2 - 20.0).abs() < 1e-10);
}

#[test]
fn test_evaluator_depth_limit() {
    // Build a deeply nested AST manually: Negate(Negate(Negate(...Number(1.0)...)))
    let mut expr = CalcFieldExpr::Number(1.0);
    for _ in 0..150 {
        expr = CalcFieldExpr::Negate(Box::new(expr));
    }
    let fields = HashMap::new();
    // Should return None because depth exceeds MAX_DEPTH
    assert_eq!(evaluate_calc_field(&expr, &fields), None);
}
