use super::*;

#[test]
fn test_parse_currency_usd() {
    assert_eq!(parse_input_value("$500", None), ParsedValue::Number(500.0));
    assert_eq!(
        parse_input_value("$1,234.56", None),
        ParsedValue::Number(1234.56)
    );
}

#[test]
fn test_parse_currency_euro() {
    assert_eq!(
        parse_input_value("\u{20AC}1.234,56", None),
        ParsedValue::Number(1234.56)
    );
}

#[test]
fn test_parse_percentage() {
    assert_eq!(parse_input_value("50%", None), ParsedValue::Number(0.5));
    assert_eq!(parse_input_value("100%", None), ParsedValue::Number(1.0));
    assert_eq!(parse_input_value("0.5%", None), ParsedValue::Number(0.005));
}

#[test]
fn test_parse_accounting_negative() {
    assert_eq!(
        parse_input_value("(500)", None),
        ParsedValue::Number(-500.0)
    );
    assert_eq!(
        parse_input_value("($1,234.56)", None),
        ParsedValue::Number(-1234.56)
    );
}

#[test]
fn test_parse_thousands_separator() {
    assert_eq!(
        parse_input_value("1,234,567", None),
        ParsedValue::Number(1_234_567.0)
    );
}

// -----------------------------------------------------------------------
// Test: parse_formatted_number directly
// -----------------------------------------------------------------------

#[test]
fn test_parse_formatted_number_empty() {
    assert_eq!(parse_formatted_number(""), None);
}

#[test]
fn test_parse_formatted_number_currency() {
    assert_eq!(parse_formatted_number("$500"), Some(500.0));
    assert_eq!(parse_formatted_number("\u{00A3}100"), Some(100.0)); // £
    assert_eq!(parse_formatted_number("\u{00A5}200"), Some(200.0)); // ¥
    assert_eq!(parse_formatted_number("\u{20B9}300"), Some(300.0)); // ₹
}

#[test]
fn test_parse_formatted_number_negative_sign() {
    assert_eq!(parse_formatted_number("-$500"), Some(-500.0));
}

#[test]
fn test_parse_formatted_number_european() {
    // European: period as thousands, comma as decimal
    assert_eq!(parse_formatted_number("1.234,56"), Some(1234.56));
}

#[test]
fn test_parse_formatted_number_us() {
    assert_eq!(parse_formatted_number("1,234.56"), Some(1234.56));
}

#[test]
fn test_parse_formatted_number_not_a_number() {
    assert_eq!(parse_formatted_number("hello"), None);
    assert_eq!(parse_formatted_number("abc"), None);
}

#[test]
fn test_parse_formatted_number_single_comma_european_decimal() {
    // "1,5" should be treated as European decimal -> 1.5
    assert_eq!(parse_formatted_number("1,5"), Some(1.5));
    assert_eq!(parse_formatted_number("1,50"), Some(1.50));
}

#[test]
fn test_is_plain_number() {
    assert!(is_plain_number("42"));
    assert!(is_plain_number("-42"));
    assert!(is_plain_number("3.14"));
    assert!(is_plain_number("-3.14"));
    assert!(is_plain_number("0"));
    assert!(is_plain_number(".5"));
    assert!(is_plain_number("-.5"));

    assert!(!is_plain_number(""));
    assert!(!is_plain_number("-"));
    assert!(!is_plain_number("abc"));
    assert!(!is_plain_number("42abc"));
    assert!(!is_plain_number("1,234"));
    assert!(!is_plain_number("$42"));
    assert!(!is_plain_number("42."));
}
