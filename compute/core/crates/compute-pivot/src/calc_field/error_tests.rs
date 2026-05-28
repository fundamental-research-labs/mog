use super::*;

#[test]
fn test_partial_eq_on_calc_field_expr() {
    let a = CalcFieldExpr::FieldRef("Revenue".to_string());
    let b = CalcFieldExpr::FieldRef("Revenue".to_string());
    let c = CalcFieldExpr::FieldRef("Cost".to_string());
    assert_eq!(a, b);
    assert_ne!(a, c);

    let op_a = CalcFieldExpr::BinaryOp {
        op: CalcFieldOp::Add,
        left: Box::new(CalcFieldExpr::Number(1.0)),
        right: Box::new(CalcFieldExpr::Number(2.0)),
    };
    let op_b = CalcFieldExpr::BinaryOp {
        op: CalcFieldOp::Add,
        left: Box::new(CalcFieldExpr::Number(1.0)),
        right: Box::new(CalcFieldExpr::Number(2.0)),
    };
    assert_eq!(op_a, op_b);

    assert_eq!(CalcFieldOp::Add, CalcFieldOp::Add);
    assert_ne!(CalcFieldOp::Add, CalcFieldOp::Sub);
}

#[test]
fn test_display_unmatched_paren() {
    let err = CalcFieldParseError::UnmatchedParen { position: 5 };
    let msg = format!("{err}");
    assert!(msg.contains("Unmatched parenthesis"));
    assert!(msg.contains("5"));
}

#[test]
fn test_display_max_depth_exceeded() {
    let err = CalcFieldParseError::MaxDepthExceeded { max_depth: 100 };
    let msg = format!("{err}");
    assert!(msg.contains("maximum nesting depth"));
    assert!(msg.contains("100"));
}

#[test]
fn test_display_empty_expression() {
    let err = CalcFieldParseError::EmptyExpression;
    assert_eq!(format!("{err}"), "Empty expression");
}

#[test]
fn test_display_unexpected_token() {
    let err = CalcFieldParseError::UnexpectedToken {
        token: "@".to_string(),
        position: 3,
    };
    let msg = format!("{err}");
    assert!(msg.contains("Unexpected token"));
    assert!(msg.contains("@"));
    assert!(msg.contains("3"));
}

#[test]
fn test_error_trait_impl() {
    let err: Box<dyn std::error::Error> = Box::new(CalcFieldParseError::EmptyExpression);
    assert_eq!(err.to_string(), "Empty expression");
}
