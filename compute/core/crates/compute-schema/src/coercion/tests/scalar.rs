use value_types::CellValue;

use super::{
    SchemaType, assert_bool_result, assert_err, assert_num_result, assert_text_result, coerce, num,
    text,
};

#[test]
fn bool_to_bool() {
    let r = coerce(&CellValue::Boolean(true), SchemaType::Boolean);
    assert_bool_result(&r, true);
    let r = coerce(&CellValue::Boolean(false), SchemaType::Boolean);
    assert_bool_result(&r, false);
}

#[test]
fn number_to_bool() {
    let r = coerce(&num(0.0), SchemaType::Boolean);
    assert_bool_result(&r, false);
    let r = coerce(&num(1.0), SchemaType::Boolean);
    assert_bool_result(&r, true);
    let r = coerce(&num(-5.0), SchemaType::Boolean);
    assert_bool_result(&r, true);
}

#[test]
fn text_true_to_bool() {
    assert_bool_result(&coerce(&text("true"), SchemaType::Boolean), true);
    assert_bool_result(&coerce(&text("yes"), SchemaType::Boolean), true);
    assert_bool_result(&coerce(&text("1"), SchemaType::Boolean), true);
    assert_bool_result(&coerce(&text("on"), SchemaType::Boolean), true);
    assert_bool_result(&coerce(&text("TRUE"), SchemaType::Boolean), true);
    assert_bool_result(&coerce(&text("Yes"), SchemaType::Boolean), true);
}

#[test]
fn text_false_to_bool() {
    assert_bool_result(&coerce(&text("false"), SchemaType::Boolean), false);
    assert_bool_result(&coerce(&text("no"), SchemaType::Boolean), false);
    assert_bool_result(&coerce(&text("0"), SchemaType::Boolean), false);
    assert_bool_result(&coerce(&text("off"), SchemaType::Boolean), false);
    assert_bool_result(&coerce(&text(""), SchemaType::Boolean), false);
}

#[test]
fn invalid_text_to_bool() {
    assert_err(&coerce(&text("maybe"), SchemaType::Boolean));
}

#[test]
fn integer_coercion_rounds() {
    assert_num_result(&coerce(&num(3.7), SchemaType::Integer), 4.0);
    assert_num_result(&coerce(&num(3.2), SchemaType::Integer), 3.0);
    assert_num_result(&coerce(&num(5.0), SchemaType::Integer), 5.0);
}

#[test]
fn integer_from_text() {
    assert_num_result(&coerce(&text("42"), SchemaType::Integer), 42.0);
    assert_num_result(&coerce(&text("3.7"), SchemaType::Integer), 4.0);
    assert_num_result(&coerce(&text("3.2"), SchemaType::Integer), 3.0);
}

#[test]
fn integer_from_non_numeric_text_fails() {
    assert_err(&coerce(&text("abc"), SchemaType::Integer));
}

#[test]
fn string_identity() {
    assert_text_result(&coerce(&text("hello"), SchemaType::String), "hello");
}

#[test]
fn number_to_string() {
    assert_text_result(&coerce(&num(42.0), SchemaType::String), "42");
    assert_text_result(&coerce(&num(42.5), SchemaType::String), "42.5");
}

#[test]
fn bool_to_string() {
    assert_text_result(
        &coerce(&CellValue::Boolean(true), SchemaType::String),
        "true",
    );
}

#[test]
fn null_coerced_to_empty_string() {
    assert_text_result(&coerce(&CellValue::Null, SchemaType::String), "");
}
