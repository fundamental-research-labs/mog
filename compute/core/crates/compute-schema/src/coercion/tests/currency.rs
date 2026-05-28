use value_types::CellValue;

use super::{SchemaType, assert_num_result, coerce, num, text};

#[test]
fn currency_from_number() {
    assert_num_result(&coerce(&num(99.99), SchemaType::Currency), 99.99);
}

#[test]
fn currency_from_text() {
    assert_num_result(&coerce(&text("$1,234.56"), SchemaType::Currency), 1234.56);
    assert_num_result(&coerce(&text("\u{20ac}50"), SchemaType::Currency), 50.0);
}

#[test]
fn currency_negative_parentheses() {
    let r = coerce(&text("($100)"), SchemaType::Currency);
    assert_num_result(&r, -100.0);
}

#[test]
fn currency_negative_with_minus_sign() {
    let r = coerce(&text("$-100"), SchemaType::Currency);
    assert!(r.success, "Should successfully coerce $-100");
    assert_num_result(&r, -100.0);
}

#[test]
fn currency_negative_with_leading_minus() {
    let r = coerce(&text("-$100"), SchemaType::Currency);
    assert!(r.success, "Should successfully coerce -$100");
    assert_num_result(&r, -100.0);
}

#[test]
fn currency_parentheses_accounting_notation() {
    let r = coerce(&text("($100)"), SchemaType::Currency);
    assert!(r.success);
    assert_num_result(&r, -100.0);
}

#[test]
fn currency_positive_no_negation() {
    let r = coerce(&text("$100"), SchemaType::Currency);
    assert!(r.success);
    assert_num_result(&r, 100.0);
}

#[test]
fn currency_plain_number_text() {
    let r = coerce(&text("100"), SchemaType::Currency);
    assert!(r.success);
    assert_num_result(&r, 100.0);
}

#[test]
fn currency_from_boolean() {
    let r = coerce(&CellValue::Boolean(true), SchemaType::Currency);
    assert!(r.success);
    assert_num_result(&r, 1.0);
}
