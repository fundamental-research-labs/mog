use super::{SchemaType, assert_err, assert_num_result, coerce, num, text};

#[test]
fn percentage_from_big_number() {
    assert_num_result(&coerce(&num(50.0), SchemaType::Percentage), 0.5);
}

#[test]
fn percentage_from_small_number() {
    assert_num_result(&coerce(&num(0.5), SchemaType::Percentage), 0.5);
}

#[test]
fn percentage_from_text() {
    assert_num_result(&coerce(&text("75%"), SchemaType::Percentage), 0.75);
    assert_num_result(&coerce(&text("100%"), SchemaType::Percentage), 1.0);
}

#[test]
fn percentage_from_text_number() {
    assert_num_result(&coerce(&text("0.25"), SchemaType::Percentage), 0.25);
    assert_num_result(&coerce(&text("50"), SchemaType::Percentage), 0.5);
}

#[test]
fn percentage_exactly_one_is_decimal_form() {
    let r = coerce(&num(1.0), SchemaType::Percentage);
    assert!(r.success);
    assert_num_result(&r, 1.0);
}

#[test]
fn percentage_negative_one_is_decimal_form() {
    let r = coerce(&num(-1.0), SchemaType::Percentage);
    assert!(r.success);
    assert_num_result(&r, -1.0);
}

#[test]
fn percentage_just_over_one_divides() {
    let r = coerce(&num(1.01), SchemaType::Percentage);
    assert!(r.success);
    assert_num_result(&r, 0.0101);
}

#[test]
fn percentage_zero_text() {
    let r = coerce(&text("0%"), SchemaType::Percentage);
    assert!(r.success);
    assert_num_result(&r, 0.0);
}

#[test]
fn percentage_negative_text() {
    let r = coerce(&text("-50%"), SchemaType::Percentage);
    assert!(r.success);
    assert_num_result(&r, -0.5);
}

#[test]
fn percentage_invalid_text() {
    assert_err(&coerce(&text("abc%"), SchemaType::Percentage));
}

#[test]
fn percentage_bare_percent_sign() {
    assert_err(&coerce(&text("%"), SchemaType::Percentage));
}
