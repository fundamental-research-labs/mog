use value_types::CellValue;

use super::{SchemaType, assert_err, assert_num_result, coerce, num, text};

#[test]
fn number_to_number() {
    let r = coerce(&num(42.5), SchemaType::Number);
    assert_num_result(&r, 42.5);
}

#[test]
fn bool_to_number() {
    assert_num_result(&coerce(&CellValue::Boolean(true), SchemaType::Number), 1.0);
    assert_num_result(&coerce(&CellValue::Boolean(false), SchemaType::Number), 0.0);
}

#[test]
fn text_to_number() {
    assert_num_result(&coerce(&text("42"), SchemaType::Number), 42.0);
    assert_num_result(&coerce(&text("3.14"), SchemaType::Number), 3.14);
    assert_num_result(&coerce(&text("-7"), SchemaType::Number), -7.0);
}

#[test]
fn currency_text_to_number() {
    assert_num_result(&coerce(&text("$1,234.56"), SchemaType::Number), 1234.56);
    assert_num_result(&coerce(&text("\u{20ac}50.00"), SchemaType::Number), 50.0);
    assert_num_result(&coerce(&text("\u{00a3}99.99"), SchemaType::Number), 99.99);
}

#[test]
fn percentage_text_to_number() {
    assert_num_result(&coerce(&text("50%"), SchemaType::Number), 0.5);
    assert_num_result(&coerce(&text("12.5%"), SchemaType::Number), 0.125);
}

#[test]
fn invalid_text_to_number() {
    assert_err(&coerce(&text("abc"), SchemaType::Number));
}

#[test]
fn distribution_coerces_as_number() {
    assert_num_result(&coerce(&num(3.14), SchemaType::Distribution), 3.14);
}
