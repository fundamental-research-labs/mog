use crate::ast::{ASTNode, BinOp, UnaryOp, needs_quoting};
use value_types::CellError;

#[test]
fn test_display_number_integer() {
    assert_eq!(format!("{}", ASTNode::Number(42.0)), "42");
}

#[test]
#[allow(clippy::approx_constant)]
fn test_display_number_float() {
    assert_eq!(format!("{}", ASTNode::Number(3.14)), "3.14");
}

#[test]
fn test_display_number_negative_integer() {
    assert_eq!(format!("{}", ASTNode::Number(-7.0)), "-7");
}

#[test]
fn display_special_numbers() {
    assert_eq!(format!("{}", ASTNode::Number(f64::NAN)), "#NUM!");
    assert_eq!(format!("{}", ASTNode::Number(f64::INFINITY)), "1E+308");
    assert_eq!(format!("{}", ASTNode::Number(f64::NEG_INFINITY)), "-1E+308");
    assert_eq!(format!("{}", ASTNode::Number(-0.0)), "0");
}

#[test]
fn test_display_text_simple() {
    assert_eq!(
        format!("{}", ASTNode::Text("hello".to_string())),
        "\"hello\""
    );
}

#[test]
fn test_display_text_with_quotes() {
    assert_eq!(
        format!("{}", ASTNode::Text("say \"hi\"".to_string())),
        "\"say \"\"hi\"\"\""
    );
}

#[test]
fn test_display_text_empty() {
    assert_eq!(format!("{}", ASTNode::Text(String::new())), "\"\"");
}

#[test]
fn test_display_boolean() {
    assert_eq!(format!("{}", ASTNode::Boolean(true)), "TRUE");
    assert_eq!(format!("{}", ASTNode::Boolean(false)), "FALSE");
}

#[test]
fn test_display_errors() {
    assert_eq!(format!("{}", ASTNode::Error(CellError::Div0)), "#DIV/0!");
    assert_eq!(format!("{}", ASTNode::Error(CellError::Na)), "#N/A");
    assert_eq!(format!("{}", ASTNode::Error(CellError::Ref)), "#REF!");
    assert_eq!(format!("{}", ASTNode::Error(CellError::Value)), "#VALUE!");
    assert_eq!(format!("{}", ASTNode::Error(CellError::Name)), "#NAME?");
    assert_eq!(format!("{}", ASTNode::Error(CellError::Null)), "#NULL!");
    assert_eq!(format!("{}", ASTNode::Error(CellError::Num)), "#NUM!");
}

#[test]
fn test_display_binary_op() {
    let node = ASTNode::BinaryOp {
        op: BinOp::Add,
        left: Box::new(ASTNode::Number(1.0)),
        right: Box::new(ASTNode::Number(2.0)),
    };
    assert_eq!(format!("{node}"), "1+2");
}

#[test]
fn test_display_binary_op_nested() {
    let node = ASTNode::BinaryOp {
        op: BinOp::Add,
        left: Box::new(ASTNode::Number(1.0)),
        right: Box::new(ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(ASTNode::Number(2.0)),
            right: Box::new(ASTNode::Number(3.0)),
        }),
    };
    assert_eq!(format!("{node}"), "1+2*3");
}

#[test]
fn test_display_unary_minus() {
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Minus,
        operand: Box::new(ASTNode::Number(5.0)),
    };
    assert_eq!(format!("{node}"), "-5");
}

#[test]
fn test_display_unary_plus() {
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Number(5.0)),
    };
    assert_eq!(format!("{node}"), "+5");
}

#[test]
fn test_display_unary_percent() {
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Percent,
        operand: Box::new(ASTNode::Number(50.0)),
    };
    assert_eq!(format!("{node}"), "50%");
}

#[test]
fn display_unary_implicit_intersection() {
    let node = ASTNode::UnaryOp {
        op: UnaryOp::ImplicitIntersection,
        operand: Box::new(ASTNode::Identifier("value".to_string())),
    };
    assert_eq!(format!("{node}"), "@value");
}

#[test]
fn test_display_function() {
    let node = ASTNode::Function {
        name: "SUM".into(),
        args: vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
    };
    assert_eq!(format!("{node}"), "SUM(1,2)");
}

#[test]
fn test_display_function_no_args() {
    let node = ASTNode::Function {
        name: "NOW".into(),
        args: vec![],
    };
    assert_eq!(format!("{node}"), "NOW()");
}

#[test]
fn test_display_paren() {
    let node = ASTNode::Paren(Box::new(ASTNode::BinaryOp {
        op: BinOp::Add,
        left: Box::new(ASTNode::Number(1.0)),
        right: Box::new(ASTNode::Number(2.0)),
    }));
    assert_eq!(format!("{node}"), "(1+2)");
}

#[test]
fn test_display_identifier() {
    assert_eq!(
        format!("{}", ASTNode::Identifier("myRange".to_string())),
        "myRange"
    );
}

#[test]
fn display_optional_lambda_param() {
    assert_eq!(
        format!("{}", ASTNode::OptionalLambdaParam("value".to_string())),
        "[value]"
    );
}

#[test]
fn test_display_array() {
    let node = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
        ],
    };
    assert_eq!(format!("{node}"), "{1,2;3,4}");
}

#[test]
fn test_display_call_expression() {
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Identifier("myFunc".to_string())),
        args: vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
    };
    assert_eq!(format!("{node}"), "myFunc(3,4)");
}

#[test]
fn test_display_omitted() {
    assert_eq!(format!("{}", ASTNode::Omitted), "");
}

#[test]
fn range_op_display() {
    let node = ASTNode::RangeOp {
        start: Box::new(ASTNode::Identifier("left".to_string())),
        end: Box::new(ASTNode::Identifier("right".to_string())),
    };

    assert_eq!(format!("{node}"), "left:right");
}

#[test]
fn union_display() {
    let node = ASTNode::Union {
        ranges: vec![
            ASTNode::Identifier("left".to_string()),
            ASTNode::Identifier("right".to_string()),
        ],
    };

    assert_eq!(format!("{node}"), "(left,right)");
}

#[test]
fn needs_quoting_rules() {
    assert!(needs_quoting(""));
    assert!(needs_quoting("1Sheet"));
    assert!(needs_quoting("My Sheet"));
    assert!(needs_quoting("D&A"));
    assert!(needs_quoting("Sheet's"));
    assert!(needs_quoting("Café"));
    assert!(needs_quoting("A1"));
    assert!(needs_quoting("XFD1048576"));
    assert!(needs_quoting("RC"));
    assert!(needs_quoting("R1C1"));
    assert!(needs_quoting("R"));
    assert!(needs_quoting("C"));
    assert!(!needs_quoting("XFE1"));
    assert!(!needs_quoting("A1048577"));
    assert!(!needs_quoting("R0C1"));
    assert!(!needs_quoting("Sheet1"));
    assert!(!needs_quoting("_Sheet"));
}
