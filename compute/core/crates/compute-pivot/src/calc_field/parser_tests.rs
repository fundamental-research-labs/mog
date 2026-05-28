use super::*;

#[test]
fn test_parse_simple_division() {
    let expr = parse_calc_field("Revenue / Units").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Div,
            left: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
            right: Box::new(CalcFieldExpr::FieldRef("Units".to_string())),
        }
    );
}

#[test]
fn test_parse_simple_addition() {
    let expr = parse_calc_field("Revenue + Cost").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Add,
            left: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
            right: Box::new(CalcFieldExpr::FieldRef("Cost".to_string())),
        }
    );
}

#[test]
fn test_parse_complex_formula() {
    // (Revenue - Cost) / Revenue * 100
    let expr = parse_calc_field("(Revenue - Cost) / Revenue * 100").unwrap();
    // Should parse as ((Revenue - Cost) / Revenue) * 100
    // because * and / have same precedence, left-to-right associativity
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Mul,
            left: Box::new(CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Div,
                left: Box::new(CalcFieldExpr::BinaryOp {
                    op: CalcFieldOp::Sub,
                    left: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
                    right: Box::new(CalcFieldExpr::FieldRef("Cost".to_string())),
                }),
                right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
            }),
            right: Box::new(CalcFieldExpr::Number(100.0)),
        }
    );
}

#[test]
fn test_parse_single_quoted_field() {
    let expr = parse_calc_field("'Cost of Goods' / Revenue").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Div,
            left: Box::new(CalcFieldExpr::FieldRef("Cost of Goods".to_string())),
            right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
        }
    );
}

#[test]
fn test_parse_double_quoted_field() {
    let expr = parse_calc_field("\"Units Sold\" * Price").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Mul,
            left: Box::new(CalcFieldExpr::FieldRef("Units Sold".to_string())),
            right: Box::new(CalcFieldExpr::FieldRef("Price".to_string())),
        }
    );
}

#[test]
fn test_parse_unary_negation() {
    let expr = parse_calc_field("-Revenue + Cost").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Add,
            left: Box::new(CalcFieldExpr::Negate(Box::new(CalcFieldExpr::FieldRef(
                "Revenue".to_string()
            )))),
            right: Box::new(CalcFieldExpr::FieldRef("Cost".to_string())),
        }
    );
}

#[test]
fn test_parse_double_negation() {
    let expr = parse_calc_field("--Revenue").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::Negate(Box::new(CalcFieldExpr::Negate(Box::new(
            CalcFieldExpr::FieldRef("Revenue".to_string())
        ))))
    );
}

#[test]
fn test_parse_numeric_literal() {
    let expr = parse_calc_field("Revenue * 1.15").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Mul,
            left: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
            right: Box::new(CalcFieldExpr::Number(1.15)),
        }
    );
}

#[test]
fn test_parse_parenthesized_expression() {
    let expr = parse_calc_field("(A + B) * C").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Mul,
            left: Box::new(CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Add,
                left: Box::new(CalcFieldExpr::FieldRef("A".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("B".to_string())),
            }),
            right: Box::new(CalcFieldExpr::FieldRef("C".to_string())),
        }
    );
}

#[test]
fn test_parse_nested_parentheses() {
    let expr = parse_calc_field("((A + B))").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Add,
            left: Box::new(CalcFieldExpr::FieldRef("A".to_string())),
            right: Box::new(CalcFieldExpr::FieldRef("B".to_string())),
        }
    );
}

#[test]
fn test_parse_precedence_mul_before_add() {
    // A + B * C should parse as A + (B * C)
    let expr = parse_calc_field("A + B * C").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Add,
            left: Box::new(CalcFieldExpr::FieldRef("A".to_string())),
            right: Box::new(CalcFieldExpr::BinaryOp {
                op: CalcFieldOp::Mul,
                left: Box::new(CalcFieldExpr::FieldRef("B".to_string())),
                right: Box::new(CalcFieldExpr::FieldRef("C".to_string())),
            }),
        }
    );
}

#[test]
fn test_parse_single_field() {
    let expr = parse_calc_field("Revenue").unwrap();
    assert_eq!(expr, CalcFieldExpr::FieldRef("Revenue".to_string()));
}

#[test]
fn test_parse_single_number() {
    let expr = parse_calc_field("42").unwrap();
    assert_eq!(expr, CalcFieldExpr::Number(42.0));
}

#[test]
fn test_parse_underscore_field() {
    let expr = parse_calc_field("total_revenue / unit_count").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Div,
            left: Box::new(CalcFieldExpr::FieldRef("total_revenue".to_string())),
            right: Box::new(CalcFieldExpr::FieldRef("unit_count".to_string())),
        }
    );
}

#[test]
fn test_parse_decimal_starting_with_dot() {
    let expr = parse_calc_field(".5 * Revenue").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Mul,
            left: Box::new(CalcFieldExpr::Number(0.5)),
            right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
        }
    );
}

#[test]
fn test_parse_empty_string() {
    assert_eq!(
        parse_calc_field("").unwrap_err(),
        CalcFieldParseError::EmptyExpression
    );
    assert_eq!(
        parse_calc_field("   ").unwrap_err(),
        CalcFieldParseError::EmptyExpression
    );
}

#[test]
fn test_parse_unclosed_paren() {
    let err = parse_calc_field("(Revenue + Cost").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnmatchedParen { .. }),
        "Error should be UnmatchedParen: {err}",
    );
}

#[test]
fn test_parse_extra_close_paren() {
    let err = parse_calc_field("Revenue + Cost)").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnexpectedToken { .. }),
        "Error should be UnexpectedToken: {err}",
    );
}

#[test]
fn test_parse_unexpected_character() {
    let err = parse_calc_field("Revenue @ Cost").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnexpectedToken { ref token, .. } if token == "@"),
        "Error should mention the character: {err}",
    );
}

#[test]
fn test_parse_missing_operand() {
    let err = parse_calc_field("Revenue +").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::EmptyExpression),
        "Error should be EmptyExpression: {err}",
    );
}

#[test]
fn test_parse_consecutive_operators() {
    // Revenue + * Cost should fail
    let err = parse_calc_field("Revenue + * Cost").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnexpectedToken { .. }),
        "Error should be UnexpectedToken: {err}",
    );
}

#[test]
fn test_parse_empty_quoted_field() {
    let err = parse_calc_field("'' + Revenue").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnexpectedToken { ref token, .. } if token == "''"),
        "Error should mention empty field: {err}",
    );
}

#[test]
fn test_parse_unclosed_single_quote() {
    let err = parse_calc_field("'Cost of Goods + Revenue").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnmatchedParen { .. }),
        "Error should be UnmatchedParen for unclosed quote: {err}",
    );
}

#[test]
fn test_parse_unclosed_double_quote() {
    let err = parse_calc_field("\"Cost of Goods + Revenue").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnmatchedParen { .. }),
        "Error should be UnmatchedParen for unclosed quote: {err}",
    );
}

#[test]
fn test_parser_depth_limit() {
    // Build a deeply nested expression: (((((...A...)))))
    // 200 levels of parentheses should exceed MAX_DEPTH
    let mut formula = String::new();
    for _ in 0..200 {
        formula.push('(');
    }
    formula.push('A');
    for _ in 0..200 {
        formula.push(')');
    }
    let result = parse_calc_field(&formula);
    assert!(result.is_err(), "Should fail with depth limit");
    assert!(
        matches!(
            result.unwrap_err(),
            CalcFieldParseError::MaxDepthExceeded { max_depth: 100 }
        ),
        "Error should be MaxDepthExceeded"
    );
}

#[test]
fn test_parse_escaped_single_quote() {
    // 'field''s name' should parse to field name: field's name
    let expr = parse_calc_field("'field''s name' + Revenue").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Add,
            left: Box::new(CalcFieldExpr::FieldRef("field's name".to_string())),
            right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
        }
    );
}

#[test]
fn test_parse_escaped_double_quote() {
    // "field""s name" should parse to field name: field"s name
    let expr = parse_calc_field("\"field\"\"s name\" + Revenue").unwrap();
    assert_eq!(
        expr,
        CalcFieldExpr::BinaryOp {
            op: CalcFieldOp::Add,
            left: Box::new(CalcFieldExpr::FieldRef("field\"s name".to_string())),
            right: Box::new(CalcFieldExpr::FieldRef("Revenue".to_string())),
        }
    );
}

#[test]
fn test_parse_empty_double_quoted_field() {
    let err = parse_calc_field("\"\" + Revenue").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnexpectedToken { ref token, .. } if token == "\"\""),
        "Error should mention empty double-quoted field: {err}",
    );
}

#[test]
fn test_unexpected_token_after_paren_group() {
    // (A + B) followed by something invalid like another number without operator
    // "(A) B" — after consuming "(A)", parser sees "B" as unconsumed
    let err = parse_calc_field("(A) B").unwrap_err();
    assert!(
        matches!(err, CalcFieldParseError::UnexpectedToken { .. }),
        "Error should be UnexpectedToken: {err}",
    );
}
