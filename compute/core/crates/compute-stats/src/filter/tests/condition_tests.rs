use super::*;

#[test]
fn test_matches_is_blank() {
    assert!(matches_condition(
        &CellValue::Null,
        &PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank)
    ));
    assert!(matches_condition(
        &CellValue::Text("".into()),
        &PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank),
    ));
    assert!(!matches_condition(
        &CellValue::number(0.0),
        &PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank),
    ));
}

#[test]
fn test_matches_is_not_blank() {
    assert!(!matches_condition(
        &CellValue::Null,
        &PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank),
    ));
    assert!(matches_condition(
        &CellValue::number(1.0),
        &PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank),
    ));
}

#[test]
fn test_matches_equals_number() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Equals,
        value: CellValue::number(42.0),
    };
    assert!(matches_condition(&CellValue::number(42.0), &cond));
    assert!(!matches_condition(&CellValue::number(43.0), &cond));
}

#[test]
fn test_matches_equals_text_case_insensitive() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Equals,
        value: CellValue::Text("Hello".into()),
    };
    assert!(matches_condition(&CellValue::Text("hello".into()), &cond));
    assert!(matches_condition(&CellValue::Text("HELLO".into()), &cond));
    assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
}

#[test]
fn test_matches_not_equals() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::NotEquals,
        value: CellValue::number(42.0),
    };
    assert!(!matches_condition(&CellValue::number(42.0), &cond));
    assert!(matches_condition(&CellValue::number(43.0), &cond));
}

#[test]
fn test_matches_not_equals_text() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::NotEquals,
        value: CellValue::Text("Hello".into()),
    };
    assert!(!matches_condition(&CellValue::Text("hello".into()), &cond));
    assert!(matches_condition(&CellValue::Text("World".into()), &cond));
}

#[test]
fn test_matches_greater_than() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::GreaterThan,
        value: CellValue::number(10.0),
    };
    assert!(matches_condition(&CellValue::number(15.0), &cond));
    assert!(!matches_condition(&CellValue::number(10.0), &cond));
    assert!(!matches_condition(&CellValue::number(5.0), &cond));
    // Non-numeric always false
    assert!(!matches_condition(&CellValue::Text("20".into()), &cond));
}

#[test]
fn test_matches_greater_than_or_equal() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::GreaterThanOrEqual,
        value: CellValue::number(10.0),
    };
    assert!(matches_condition(&CellValue::number(15.0), &cond));
    assert!(matches_condition(&CellValue::number(10.0), &cond));
    assert!(!matches_condition(&CellValue::number(5.0), &cond));
}

#[test]
fn test_matches_less_than() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::LessThan,
        value: CellValue::number(10.0),
    };
    assert!(matches_condition(&CellValue::number(5.0), &cond));
    assert!(!matches_condition(&CellValue::number(10.0), &cond));
    assert!(!matches_condition(&CellValue::number(15.0), &cond));
}

#[test]
fn test_matches_less_than_or_equal() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::LessThanOrEqual,
        value: CellValue::number(10.0),
    };
    assert!(matches_condition(&CellValue::number(5.0), &cond));
    assert!(matches_condition(&CellValue::number(10.0), &cond));
    assert!(!matches_condition(&CellValue::number(15.0), &cond));
}

#[test]
fn test_matches_between() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::Between,
        value: CellValue::number(10.0),
        value2: CellValue::number(20.0),
    };
    assert!(matches_condition(&CellValue::number(15.0), &cond));
    assert!(matches_condition(&CellValue::number(10.0), &cond)); // inclusive
    assert!(matches_condition(&CellValue::number(20.0), &cond)); // inclusive
    assert!(!matches_condition(&CellValue::number(5.0), &cond));
    assert!(!matches_condition(&CellValue::number(25.0), &cond));
}

#[test]
fn test_matches_not_between() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::NotBetween,
        value: CellValue::number(10.0),
        value2: CellValue::number(20.0),
    };
    assert!(!matches_condition(&CellValue::number(15.0), &cond));
    assert!(!matches_condition(&CellValue::number(10.0), &cond));
    assert!(matches_condition(&CellValue::number(5.0), &cond));
    assert!(matches_condition(&CellValue::number(25.0), &cond));
    // Non-number: always "not between"
    assert!(matches_condition(&CellValue::Text("hello".into()), &cond));
}

#[test]
fn test_matches_contains() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Contains,
        value: CellValue::Text("ell".into()),
    };
    assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
    assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
    // Non-text always false
    assert!(!matches_condition(&CellValue::number(42.0), &cond));
}

#[test]
fn test_matches_not_contains() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::NotContains,
        value: CellValue::Text("ell".into()),
    };
    assert!(!matches_condition(&CellValue::Text("Hello".into()), &cond));
    assert!(matches_condition(&CellValue::Text("World".into()), &cond));
    // Non-text: does not contain text, so true
    assert!(matches_condition(&CellValue::number(42.0), &cond));
}

#[test]
fn test_matches_starts_with() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::StartsWith,
        value: CellValue::Text("Hel".into()),
    };
    assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
    assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
}

#[test]
fn test_matches_ends_with() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::EndsWith,
        value: CellValue::Text("llo".into()),
    };
    assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
    assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
}

#[test]
fn test_matches_above_below_average_passthrough() {
    // These need full-column context; direct call returns true (pass-through).
    assert!(matches_condition(
        &CellValue::number(5.0),
        &PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage),
    ));
    assert!(matches_condition(
        &CellValue::number(5.0),
        &PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage),
    ));
}

#[test]
fn test_wildcard_with_condition_equals() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Equals,
        value: CellValue::Text("H*o".into()),
    };
    assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
    assert!(matches_condition(&CellValue::Text("Ho".into()), &cond));
    assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
}

#[test]
fn test_wildcard_with_condition_contains() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Contains,
        value: CellValue::Text("e?l".into()),
    };
    assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
    assert!(!matches_condition(&CellValue::Text("Helo".into()), &cond));
}

#[test]
fn between_boundary_exactly_low() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::Between,
        value: CellValue::number(10.0),
        value2: CellValue::number(20.0),
    };
    assert!(matches_condition(&CellValue::number(10.0), &cond));
}

#[test]
fn between_boundary_exactly_high() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::Between,
        value: CellValue::number(10.0),
        value2: CellValue::number(20.0),
    };
    assert!(matches_condition(&CellValue::number(20.0), &cond));
}

#[test]
fn not_between_boundary_exactly_low() {
    // 10.0 is inside [10, 20], so NotBetween should be false.
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::NotBetween,
        value: CellValue::number(10.0),
        value2: CellValue::number(20.0),
    };
    assert!(!matches_condition(&CellValue::number(10.0), &cond));
}

#[test]
fn not_between_boundary_exactly_high() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::NotBetween,
        value: CellValue::number(10.0),
        value2: CellValue::number(20.0),
    };
    assert!(!matches_condition(&CellValue::number(20.0), &cond));
}

#[test]
fn between_negative_range_inside() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::Between,
        value: CellValue::number(-20.0),
        value2: CellValue::number(-10.0),
    };
    assert!(matches_condition(&CellValue::number(-15.0), &cond));
}

#[test]
fn between_negative_range_outside() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::Between,
        value: CellValue::number(-20.0),
        value2: CellValue::number(-10.0),
    };
    assert!(!matches_condition(&CellValue::number(-25.0), &cond));
}

#[test]
fn greater_than_text_vs_number_is_false() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::GreaterThan,
        value: CellValue::number(5.0),
    };
    assert!(!matches_condition(&CellValue::Text("100".into()), &cond));
}

#[test]
fn contains_number_value_is_false() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Contains,
        value: CellValue::Text("1".into()),
    };
    assert!(!matches_condition(&CellValue::number(123.0), &cond));
}

#[test]
fn equals_number_zero_vs_boolean_false() {
    // Cross-type: Number(0) should NOT equal Boolean(false).
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Equals,
        value: CellValue::Boolean(false),
    };
    assert!(!matches_condition(&CellValue::number(0.0), &cond));
}

#[test]
fn not_equals_number_zero_vs_boolean_false() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::NotEquals,
        value: CellValue::Boolean(false),
    };
    assert!(matches_condition(&CellValue::number(0.0), &cond));
}

#[test]
fn between_text_value_is_false() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::Between,
        value: CellValue::number(1.0),
        value2: CellValue::number(100.0),
    };
    assert!(!matches_condition(&CellValue::Text("50".into()), &cond));
}

#[test]
fn not_between_text_value_is_true() {
    // Non-number is not between anything.
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::NotBetween,
        value: CellValue::number(1.0),
        value2: CellValue::number(100.0),
    };
    assert!(matches_condition(&CellValue::Text("50".into()), &cond));
}

#[test]
fn is_blank_whitespace_only() {
    let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank);
    assert!(matches_condition(
        &CellValue::Text("  \t\n  ".into()),
        &cond
    ));
}

#[test]
fn is_not_blank_number_zero() {
    let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank);
    assert!(matches_condition(&CellValue::number(0.0), &cond));
}

#[test]
fn is_not_blank_boolean_false() {
    let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank);
    assert!(matches_condition(&CellValue::Boolean(false), &cond));
}

#[test]
fn is_not_blank_error() {
    let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank);
    assert!(matches_condition(
        &CellValue::Error(CellError::Na, None),
        &cond
    ));
}
