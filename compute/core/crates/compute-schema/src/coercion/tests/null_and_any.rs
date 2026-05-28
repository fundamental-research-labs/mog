use value_types::CellValue;

use super::{
    SchemaType, assert_bool_result, assert_err, assert_null_result, assert_num_result,
    assert_text_result, coerce, num, text,
};

#[test]
fn null_to_null() {
    let r = coerce(&CellValue::Null, SchemaType::Null);
    assert_null_result(&r);
}

#[test]
fn null_to_any() {
    let r = coerce(&CellValue::Null, SchemaType::Any);
    assert_null_result(&r);
}

#[test]
fn null_to_string() {
    let r = coerce(&CellValue::Null, SchemaType::String);
    assert_text_result(&r, "");
}

#[test]
fn null_to_number() {
    let r = coerce(&CellValue::Null, SchemaType::Number);
    assert_err(&r);
}

#[test]
fn any_accepts_everything() {
    assert_num_result(&coerce(&num(42.0), SchemaType::Any), 42.0);
    assert_text_result(&coerce(&text("hello"), SchemaType::Any), "hello");
    assert_bool_result(&coerce(&CellValue::Boolean(true), SchemaType::Any), true);
    assert_null_result(&coerce(&CellValue::Null, SchemaType::Any));
}

#[test]
fn coerce_falsy_to_null() {
    assert_null_result(&coerce(&text(""), SchemaType::Null));
    assert_null_result(&coerce(&num(0.0), SchemaType::Null));
    assert_null_result(&coerce(&CellValue::Boolean(false), SchemaType::Null));
}

#[test]
fn coerce_truthy_to_null_fails() {
    assert_err(&coerce(&text("hello"), SchemaType::Null));
    assert_err(&coerce(&num(42.0), SchemaType::Null));
}

#[test]
fn null_to_boolean_fails() {
    assert_err(&coerce(&CellValue::Null, SchemaType::Boolean));
}

#[test]
fn null_to_date_fails() {
    assert_err(&coerce(&CellValue::Null, SchemaType::Date));
}

#[test]
fn null_to_time_fails() {
    assert_err(&coerce(&CellValue::Null, SchemaType::Time));
}

#[test]
fn null_to_integer_fails() {
    assert_err(&coerce(&CellValue::Null, SchemaType::Integer));
}

#[test]
fn null_to_entity_types() {
    assert_text_result(&coerce(&CellValue::Null, SchemaType::Email), "");
    assert_text_result(&coerce(&CellValue::Null, SchemaType::Url), "");
    assert_text_result(&coerce(&CellValue::Null, SchemaType::Phone), "");
    assert_text_result(&coerce(&CellValue::Null, SchemaType::Company), "");
    assert_text_result(&coerce(&CellValue::Null, SchemaType::Person), "");
    assert_text_result(&coerce(&CellValue::Null, SchemaType::Stock), "");
    assert_text_result(&coerce(&CellValue::Null, SchemaType::Location), "");
}
