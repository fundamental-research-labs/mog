use super::{SchemaType, assert_text_result, coerce, text};

#[test]
fn email_coerces_as_string() {
    assert_text_result(
        &coerce(&text("user@example.com"), SchemaType::Email),
        "user@example.com",
    );
}

#[test]
fn url_coerces_as_string() {
    assert_text_result(
        &coerce(&text("https://example.com"), SchemaType::Url),
        "https://example.com",
    );
}

#[test]
fn phone_coerces_as_string() {
    assert_text_result(
        &coerce(&text("+1 555 0100"), SchemaType::Phone),
        "+1 555 0100",
    );
}

#[test]
fn company_coerces_as_string() {
    assert_text_result(&coerce(&text("Mog"), SchemaType::Company), "Mog");
}

#[test]
fn person_coerces_as_string() {
    assert_text_result(
        &coerce(&text("Ada Lovelace"), SchemaType::Person),
        "Ada Lovelace",
    );
}

#[test]
fn stock_coerces_as_string() {
    assert_text_result(&coerce(&text("MOG"), SchemaType::Stock), "MOG");
}

#[test]
fn location_coerces_as_string() {
    assert_text_result(
        &coerce(&text("San Francisco"), SchemaType::Location),
        "San Francisco",
    );
}
