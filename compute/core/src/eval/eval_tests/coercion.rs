//! Null coercion in comparisons, empty-string comparison and arithmetic semantics.

use super::*;

// -----------------------------------------------------------------------
// Null coercion in comparison operators (Excel blank-cell semantics)
// -----------------------------------------------------------------------
// Excel coerces blank (Null) to the peer type's zero value:
//   Null vs Number  → 0.0  vs Number
//   Null vs Text    → ""   vs Text
//   Null vs Boolean → false vs Boolean

#[test]
fn test_null_eq_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null = 0 → TRUE (blank coerces to 0)
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Omitted, ASTNode::Number(0.0)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_neq_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null <> 0 → FALSE
    assert_eq!(
        eval(
            &binop(BinOp::Neq, ASTNode::Omitted, ASTNode::Number(0.0)),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

#[test]
fn test_null_lt_positive() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null < 5 → TRUE (0 < 5)
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Omitted, ASTNode::Number(5.0)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_gt_negative() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null > -1 → TRUE (0 > -1)
    assert_eq!(
        eval(
            &binop(BinOp::Gt, ASTNode::Omitted, ASTNode::Number(-1.0)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_gte_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null >= 0 → TRUE (0 >= 0)
    assert_eq!(
        eval(
            &binop(BinOp::Gte, ASTNode::Omitted, ASTNode::Number(0.0)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_lte_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null <= 0 → TRUE (0 <= 0)
    assert_eq!(
        eval(
            &binop(BinOp::Lte, ASTNode::Omitted, ASTNode::Number(0.0)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_eq_false() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null = FALSE → TRUE (blank coerces to false)
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Omitted, ASTNode::Boolean(false)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_neq_false() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null <> FALSE → FALSE
    assert_eq!(
        eval(
            &binop(BinOp::Neq, ASTNode::Omitted, ASTNode::Boolean(false)),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

#[test]
fn test_null_lt_true() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null < TRUE → TRUE (false < true)
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Omitted, ASTNode::Boolean(true)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_eq_empty_string() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null = "" → TRUE (Null coerces to Text(""), "" = "")
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Omitted, ASTNode::Text("".into())),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_neq_text() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null <> "a" → TRUE (blank coerces to "", "" ≠ "a")
    assert_eq!(
        eval(
            &binop(BinOp::Neq, ASTNode::Omitted, ASTNode::Text("a".into())),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_lt_text() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null < "a" → TRUE (blank coerces to "", "" < "a")
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Omitted, ASTNode::Text("a".into())),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_null_comparisons_symmetric() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // 0 = Null → TRUE (symmetric)
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Number(0.0), ASTNode::Omitted),
            &ctx
        ),
        CellValue::Boolean(true)
    );
    // 0 <> Null → FALSE
    assert_eq!(
        eval(
            &binop(BinOp::Neq, ASTNode::Number(0.0), ASTNode::Omitted),
            &ctx
        ),
        CellValue::Boolean(false)
    );
    // -1 < Null → TRUE (-1 < 0)
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Number(-1.0), ASTNode::Omitted),
            &ctx
        ),
        CellValue::Boolean(true)
    );
    // FALSE = Null → TRUE
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Boolean(false), ASTNode::Omitted),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_non_null_cross_type_unchanged() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Non-null cross-type ordering: Number < Text < Boolean (unchanged by Null fix)
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Number(999.0), ASTNode::Text("a".into())),
            &ctx
        ),
        CellValue::Boolean(true)
    );
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Text("z".into()), ASTNode::Boolean(true)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Number(999.0), ASTNode::Boolean(false)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

// ---------------------------------------------------------------------------
// Empty-string comparison semantics (format-aware input)
// In Excel, Text("") is a typed value — NOT the same as Null (empty cell).
// Number vs Text("") is a cross-type comparison: = → FALSE, <> → TRUE.
// ---------------------------------------------------------------------------

#[test]
fn test_number_eq_empty_string_is_false() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // 0 = "" → FALSE (cross-type: Number ≠ Text)
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Number(0.0), ASTNode::Text("".into())),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

#[test]
fn test_number_neq_empty_string_is_true() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // 0 <> "" → TRUE (cross-type: Number ≠ Text)
    assert_eq!(
        eval(
            &binop(BinOp::Neq, ASTNode::Number(0.0), ASTNode::Text("".into())),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_nonzero_number_eq_empty_string_is_false() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // 1 = "" → FALSE (cross-type)
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Number(1.0), ASTNode::Text("".into())),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

#[test]
fn test_empty_string_eq_number_is_false() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" = 0 → FALSE (symmetric cross-type)
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Text("".into()), ASTNode::Number(0.0)),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

#[test]
fn test_empty_string_neq_number_is_true() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" <> 0 → TRUE (symmetric cross-type)
    assert_eq!(
        eval(
            &binop(BinOp::Neq, ASTNode::Text("".into()), ASTNode::Number(0.0)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_empty_string_eq_empty_string() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" = "" → TRUE (same type, equal)
    assert_eq!(
        eval(
            &binop(
                BinOp::Eq,
                ASTNode::Text("".into()),
                ASTNode::Text("".into())
            ),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_empty_string_neq_empty_string() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" <> "" → FALSE (same type, equal)
    assert_eq!(
        eval(
            &binop(
                BinOp::Neq,
                ASTNode::Text("".into()),
                ASTNode::Text("".into())
            ),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

#[test]
fn test_null_neq_empty_string() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null <> "" → FALSE (Null coerces to Text(""), "" = "")
    assert_eq!(
        eval(
            &binop(BinOp::Neq, ASTNode::Omitted, ASTNode::Text("".into())),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

// ---------------------------------------------------------------------------
// Empty-string arithmetic coercion (empty-string arithmetic)
// In Excel, Text("") in arithmetic produces #VALUE! — it is NOT the same as Null.
// Null (empty cell) coerces to 0 in arithmetic; Text("") does not.
// ---------------------------------------------------------------------------

#[test]
fn test_empty_string_add_number_is_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" + 1 → #VALUE! (Text("") is not numeric)
    assert_eq!(
        eval(
            &binop(BinOp::Add, ASTNode::Text("".into()), ASTNode::Number(1.0)),
            &ctx
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_number_add_empty_string_is_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // 1 + "" → #VALUE! (symmetric)
    assert_eq!(
        eval(
            &binop(BinOp::Add, ASTNode::Number(1.0), ASTNode::Text("".into())),
            &ctx
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_empty_string_mul_number_is_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" * 5 → #VALUE!
    assert_eq!(
        eval(
            &binop(BinOp::Mul, ASTNode::Text("".into()), ASTNode::Number(5.0)),
            &ctx
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_empty_string_pow_is_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" ^ 2 → #VALUE!
    assert_eq!(
        eval(
            &binop(BinOp::Pow, ASTNode::Text("".into()), ASTNode::Number(2.0)),
            &ctx
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_empty_string_sub_is_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" - 0 → #VALUE!
    assert_eq!(
        eval(
            &binop(BinOp::Sub, ASTNode::Text("".into()), ASTNode::Number(0.0)),
            &ctx
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_empty_string_div_is_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "" / 1 → #VALUE!
    assert_eq!(
        eval(
            &binop(BinOp::Div, ASTNode::Text("".into()), ASTNode::Number(1.0)),
            &ctx
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_unary_minus_empty_string_is_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // -"" → #VALUE!
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Minus,
        operand: Box::new(ASTNode::Text("".into())),
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_unary_percent_empty_string_is_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // ""% → #VALUE!
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Percent,
        operand: Box::new(ASTNode::Text("".into())),
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_null_arithmetic_still_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null * 5 → 0 (empty cell coerces to 0 — unchanged)
    assert_eq!(
        eval(
            &binop(BinOp::Mul, ASTNode::Omitted, ASTNode::Number(5.0)),
            &ctx
        ),
        CellValue::number(0.0)
    );
    // Null - 3 → -3
    assert_eq!(
        eval(
            &binop(BinOp::Sub, ASTNode::Omitted, ASTNode::Number(3.0)),
            &ctx
        ),
        CellValue::number(-3.0)
    );
}

#[test]
fn test_numeric_string_still_coerces() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // "5" + 1 → 6 (parseable numeric strings still coerce)
    assert_eq!(
        eval(
            &binop(BinOp::Add, ASTNode::Text("5".into()), ASTNode::Number(1.0)),
            &ctx
        ),
        CellValue::number(6.0)
    );
    // "3.14" * 2 → 6.28
    #[allow(clippy::approx_constant)]
    let expected_tau_approx = 6.28;
    assert_eq!(
        eval(
            &binop(
                BinOp::Mul,
                ASTNode::Text("3.14".into()),
                ASTNode::Number(2.0)
            ),
            &ctx
        ),
        CellValue::number(expected_tau_approx)
    );
}
