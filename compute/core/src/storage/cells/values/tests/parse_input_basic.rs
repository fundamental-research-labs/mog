use super::*;

#[test]
fn test_parse_empty() {
    assert_eq!(parse_input_value("", None), ParsedValue::Empty);
    assert_eq!(parse_input_value("   ", None), ParsedValue::Empty);
    assert_eq!(parse_input_value("\t", None), ParsedValue::Empty);
}

// -----------------------------------------------------------------------
// Test: parse_input_value — booleans
// -----------------------------------------------------------------------

#[test]
fn test_parse_boolean_true() {
    assert_eq!(parse_input_value("TRUE", None), ParsedValue::Boolean(true));
    assert_eq!(parse_input_value("true", None), ParsedValue::Boolean(true));
    assert_eq!(parse_input_value("True", None), ParsedValue::Boolean(true));
    assert_eq!(parse_input_value("tRuE", None), ParsedValue::Boolean(true));
}

#[test]
fn test_parse_boolean_false() {
    assert_eq!(
        parse_input_value("FALSE", None),
        ParsedValue::Boolean(false)
    );
    assert_eq!(
        parse_input_value("false", None),
        ParsedValue::Boolean(false)
    );
    assert_eq!(
        parse_input_value("False", None),
        ParsedValue::Boolean(false)
    );
}

// -----------------------------------------------------------------------
// Test: parse_input_value — plain numbers
// -----------------------------------------------------------------------

#[test]
fn test_parse_plain_integer() {
    assert_eq!(parse_input_value("42", None), ParsedValue::Number(42.0));
    assert_eq!(parse_input_value("0", None), ParsedValue::Number(0.0));
    assert_eq!(parse_input_value("-7", None), ParsedValue::Number(-7.0));
}

#[test]
fn test_parse_plain_decimal() {
    #[allow(clippy::approx_constant)]
    let expected = 3.14;
    assert_eq!(
        parse_input_value("3.14", None),
        ParsedValue::Number(expected)
    );
    assert_eq!(parse_input_value("-0.5", None), ParsedValue::Number(-0.5));
    assert_eq!(parse_input_value(".5", None), ParsedValue::Number(0.5));
}

#[test]
fn test_parse_number_with_whitespace() {
    assert_eq!(parse_input_value("  42  ", None), ParsedValue::Number(42.0));
    #[allow(clippy::approx_constant)]
    let expected = -3.14;
    assert_eq!(
        parse_input_value(" -3.14 ", None),
        ParsedValue::Number(expected)
    );
}

// -----------------------------------------------------------------------
// Test: parse_input_value — formatted numbers
// -----------------------------------------------------------------------

#[test]
fn test_parse_text() {
    assert_eq!(
        parse_input_value("hello", None),
        ParsedValue::Text("hello".to_string())
    );
    assert_eq!(
        parse_input_value("Hello World", None),
        ParsedValue::Text("Hello World".to_string())
    );
}

#[test]
fn test_parse_text_formula_not_parsed() {
    // Formulas should be returned as text (caller checks isFormula separately)
    assert_eq!(
        parse_input_value("=SUM(A1)", None),
        ParsedValue::Text("=SUM(A1)".to_string())
    );
}

// -----------------------------------------------------------------------
// Test: set_cell_value and get operations (round-trip)
// -----------------------------------------------------------------------

#[test]
fn test_parse_input_value_comprehensive() {
    // Numbers
    assert_eq!(parse_input_value("0", None), ParsedValue::Number(0.0));
    assert_eq!(
        parse_input_value("999999", None),
        ParsedValue::Number(999999.0)
    );
    assert_eq!(
        parse_input_value("-1234.5678", None),
        ParsedValue::Number(-1234.5678)
    );

    // Booleans
    assert_eq!(parse_input_value("TRUE", None), ParsedValue::Boolean(true));
    assert_eq!(
        parse_input_value("FALSE", None),
        ParsedValue::Boolean(false)
    );

    // Text
    assert!(matches!(
        parse_input_value("hello world", None),
        ParsedValue::Text(_)
    ));
    assert!(matches!(
        parse_input_value("abc123", None),
        ParsedValue::Text(_)
    ));

    // Empty
    assert_eq!(parse_input_value("", None), ParsedValue::Empty);
}
