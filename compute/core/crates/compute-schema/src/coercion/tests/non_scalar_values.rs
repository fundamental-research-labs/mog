use super::{
    SchemaType, array_value, assert_bool_result, assert_err, assert_text_result, coerce,
    control_value, error_value, image_value,
};

#[test]
fn error_to_number_fails() {
    let err_val = error_value();
    assert_err(&coerce(&err_val, SchemaType::Number));
}

#[test]
fn error_to_string_produces_text() {
    let err_val = error_value();
    let r = coerce(&err_val, SchemaType::String);
    assert!(r.success, "Error should be coercible to string");
}

#[test]
fn any_error_fails() {
    let err_val = error_value();
    assert_err(&coerce(&err_val, SchemaType::Any));
}

#[test]
fn array_to_string_produces_array_text() {
    let arr = array_value();
    let r = coerce(&arr, SchemaType::String);
    assert!(r.success);
    assert_text_result(&r, "[Array]");
}

#[test]
fn array_to_number_fails() {
    let arr = array_value();
    assert_err(&coerce(&arr, SchemaType::Number));
}

#[test]
fn control_to_string_produces_boolean_text() {
    let control = control_value();
    assert_text_result(&coerce(&control, SchemaType::String), "true");
}

#[test]
fn control_to_any_produces_boolean() {
    let control = control_value();
    assert_bool_result(&coerce(&control, SchemaType::Any), true);
}

#[test]
fn image_to_string_uses_fallback_text() {
    let image = image_value();
    assert_text_result(&coerce(&image, SchemaType::String), "Example image");
}

#[test]
fn image_to_any_uses_fallback_text() {
    let image = image_value();
    assert_text_result(&coerce(&image, SchemaType::Any), "Example image");
}
