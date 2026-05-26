use super::*;

// ── number_literal ──────────────────────────────────────────────────────

#[test]
fn test_number_literal_integers() {
    assert_eq!(number_literal.parse_peek("42rest"), Ok(("rest", 42.0)));
    assert_eq!(number_literal.parse_peek("0"), Ok(("", 0.0)));
    assert_eq!(number_literal.parse_peek("0.0"), Ok(("", 0.0)));
    assert_eq!(
        number_literal.parse_peek("999999999999"),
        Ok(("", 999_999_999_999.0))
    );
}

#[test]
#[allow(clippy::approx_constant)]
fn test_number_literal_floats() {
    assert_eq!(number_literal.parse_peek("3.14x"), Ok(("x", 3.14)));
    assert_eq!(number_literal.parse_peek("0.001"), Ok(("", 0.001)));
}

#[test]
fn test_number_literal_scientific_notation() {
    assert_eq!(number_literal.parse_peek("1e10"), Ok(("", 1e10)));
    assert_eq!(number_literal.parse_peek("2.5E-3"), Ok(("", 2.5e-3)));
    assert_eq!(number_literal.parse_peek("1e-10"), Ok(("", 1e-10)));
    assert_eq!(number_literal.parse_peek("2.5E+3"), Ok(("", 2.5e+3)));
    assert_eq!(number_literal.parse_peek("1E0"), Ok(("", 1.0)));
}

#[test]
fn test_number_literal_partial_exponent() {
    // `1e` — the exponent part requires digits after e; `opt` backtracks
    // so only "1" is consumed and "e" remains.
    assert_eq!(number_literal.parse_peek("1e"), Ok(("e", 1.0)));
    assert_eq!(number_literal.parse_peek("1e+"), Ok(("e+", 1.0)));
    assert_eq!(number_literal.parse_peek("1e-"), Ok(("e-", 1.0)));
    // Exponent with sign but no digits, followed by more text
    assert_eq!(number_literal.parse_peek("5E+abc"), Ok(("E+abc", 5.0)));
}

#[test]
fn test_number_literal_fails_on_non_digit() {
    assert!(number_literal.parse_peek("abc").is_err());
    assert!(number_literal.parse_peek("").is_err());
    assert!(number_literal.parse_peek(".5").is_err()); // leading dot not supported here
}

// ── number_literal_with_leading_dot ─────────────────────────────────────

#[test]
fn test_number_literal_with_leading_dot_basic() {
    assert_eq!(
        number_literal_with_leading_dot.parse_peek(".5"),
        Ok(("", 0.5))
    );
    assert_eq!(
        number_literal_with_leading_dot.parse_peek(".0"),
        Ok(("", 0.0))
    );
    assert_eq!(
        number_literal_with_leading_dot.parse_peek(".123rest"),
        Ok(("rest", 0.123))
    );
}

#[test]
fn test_number_literal_with_leading_dot_scientific() {
    assert_eq!(
        number_literal_with_leading_dot.parse_peek(".123e4"),
        Ok(("", 0.123e4))
    );
    assert_eq!(
        number_literal_with_leading_dot.parse_peek(".5E-2"),
        Ok(("", 0.5e-2))
    );
}

#[test]
#[allow(clippy::approx_constant)]
fn test_number_literal_with_leading_dot_regular_numbers() {
    // It's a superset — regular numbers still work
    assert_eq!(
        number_literal_with_leading_dot.parse_peek("42"),
        Ok(("", 42.0))
    );
    assert_eq!(
        number_literal_with_leading_dot.parse_peek("3.14"),
        Ok(("", 3.14))
    );
    assert_eq!(
        number_literal_with_leading_dot.parse_peek("1e10"),
        Ok(("", 1e10))
    );
}

#[test]
fn test_number_literal_with_leading_dot_fails() {
    assert!(number_literal_with_leading_dot.parse_peek("abc").is_err());
    assert!(number_literal_with_leading_dot.parse_peek("").is_err());
    // A bare dot with no digits should fail
    assert!(number_literal_with_leading_dot.parse_peek(".abc").is_err());
}

// ── string_literal ──────────────────────────────────────────────────────

#[test]
fn test_string_literal_basic() {
    let mut input = r#""hello""#;
    assert_eq!(string_literal(&mut input).unwrap(), "hello");
    assert_eq!(input, "");
}

#[test]
fn test_string_literal_empty() {
    let mut input = r#""""#;
    assert_eq!(string_literal(&mut input).unwrap(), "");
}

#[test]
fn test_string_literal_escaped_quotes() {
    let mut input = r#""say ""hi""""#;
    assert_eq!(string_literal(&mut input).unwrap(), r#"say "hi""#);
}

#[test]
fn test_string_literal_only_escaped_quotes() {
    // """""" is: open-quote, "" (escaped), "" (escaped), close-quote → `""`
    let mut input = "\"\"\"\"\"\"";
    assert_eq!(string_literal(&mut input).unwrap(), "\"\"");
    assert_eq!(input, "");
}

#[test]
fn test_string_literal_with_newlines() {
    let mut input = "\"line1\nline2\nline3\"";
    assert_eq!(string_literal(&mut input).unwrap(), "line1\nline2\nline3");
}

#[test]
fn test_string_literal_long() {
    let long_content = "a".repeat(1000);
    let long_input = format!("\"{long_content}\"");
    let mut input = long_input.as_str();
    assert_eq!(string_literal(&mut input).unwrap(), long_content);
}

#[test]
fn test_string_literal_with_remaining() {
    let mut input = r#""hello"+rest"#;
    assert_eq!(string_literal(&mut input).unwrap(), "hello");
    assert_eq!(input, "+rest");
}

#[test]
fn test_string_literal_special_characters() {
    let mut input = "\"tab\there\"";
    assert_eq!(string_literal(&mut input).unwrap(), "tab\there");

    let mut input = "\"emoji: \u{1F600}\"";
    assert_eq!(string_literal(&mut input).unwrap(), "emoji: \u{1F600}");
}

// ── error_literal ───────────────────────────────────────────────────────

#[test]
fn test_error_literal_all_variants() {
    let cases = [
        ("#DIV/0!", CellError::Div0),
        ("#N/A", CellError::Na),
        ("#NAME?", CellError::Name),
        ("#NULL!", CellError::Null),
        ("#NUM!", CellError::Num),
        ("#REF!", CellError::Ref),
        ("#VALUE!", CellError::Value),
        ("#SPILL!", CellError::Spill),
        ("#CALC!", CellError::Calc),
        ("#GETTING_DATA", CellError::GettingData),
    ];
    for (text, expected) in cases {
        let mut input = text;
        assert_eq!(
            error_literal(&mut input).unwrap(),
            expected,
            "Failed to parse error literal: {text}"
        );
        assert_eq!(input, "", "Input not fully consumed for: {text}");
    }
}

#[test]
fn test_error_literal_with_remaining() {
    // Error followed by more text — parser stops at the right place
    let mut input = "#REF!+1";
    assert_eq!(error_literal(&mut input).unwrap(), CellError::Ref);
    assert_eq!(input, "+1");
}

#[test]
fn test_error_literal_case_insensitive() {
    // parse_error_str uses to_uppercase(), so case variations work
    let mut input = "#div/0!";
    assert_eq!(error_literal(&mut input).unwrap(), CellError::Div0);

    let mut input = "#n/a";
    assert_eq!(error_literal(&mut input).unwrap(), CellError::Na);

    let mut input = "#Ref!";
    assert_eq!(error_literal(&mut input).unwrap(), CellError::Ref);
}

#[test]
fn test_error_literal_unknown() {
    let mut input = "#UNKNOWN!";
    assert!(error_literal(&mut input).is_err());
}

#[test]
fn test_error_literal_no_panic_on_multibyte_utf8() {
    // Hebrew characters are multi-byte in UTF-8. Slicing by byte offset
    // into such strings can panic if the index is not a char boundary.
    // This test ensures the error_literal parser safely rejects non-error
    // prefixes that contain multi-byte characters without panicking.
    let mut input = "#REF!-('מחיר לטון אשלג מול מנית כיל'!B2)";
    assert_eq!(error_literal(&mut input).unwrap(), CellError::Ref);
    assert_eq!(input, "-('מחיר לטון אשלג מול מנית כיל'!B2)");

    // A short Hebrew string that doesn't start with any error prefix
    let mut input = "#היי";
    assert!(error_literal(&mut input).is_err());
}

// ── identifier ──────────────────────────────────────────────────────────

#[test]
fn test_identifier_function_names() {
    assert_eq!(identifier.parse_peek("SUM+"), Ok(("+", "SUM")));
    assert_eq!(identifier.parse_peek("VLOOKUP("), Ok(("(", "VLOOKUP")));
    assert_eq!(identifier.parse_peek("IF("), Ok(("(", "IF")));
}

#[test]
fn test_identifier_underscore_prefixed() {
    assert_eq!(identifier.parse_peek("_foo+"), Ok(("+", "_foo")));
    assert_eq!(identifier.parse_peek("_"), Ok(("", "_")));
    assert_eq!(identifier.parse_peek("_123"), Ok(("", "_123")));
}

#[test]
fn test_identifier_dot_containing() {
    // Dots are valid in identifiers after the first character
    assert_eq!(identifier.parse_peek("foo.bar+"), Ok(("+", "foo.bar")));
    assert_eq!(identifier.parse_peek("a.b.c"), Ok(("", "a.b.c")));
}

#[test]
fn test_identifier_backslash_prefixed() {
    assert_eq!(identifier.parse_peek("\\foo+"), Ok(("+", "\\foo")));
    assert_eq!(identifier.parse_peek("\\x"), Ok(("", "\\x")));
}

#[test]
fn test_identifier_fails_on_digit_start() {
    assert!(identifier.parse_peek("123abc").is_err());
    assert!(identifier.parse_peek("").is_err());
}

// ── col_letters ─────────────────────────────────────────────────────────

#[test]
fn test_col_letters_basic() {
    assert_eq!(col_letters.parse_peek("A1"), Ok(("1", "A")));
    assert_eq!(col_letters.parse_peek("ZZ99"), Ok(("99", "ZZ")));
    assert_eq!(col_letters.parse_peek("XFD1"), Ok(("1", "XFD")));
}

#[test]
fn test_col_letters_full_consumption() {
    assert_eq!(col_letters.parse_peek("ABC"), Ok(("", "ABC")));
}

#[test]
fn test_col_letters_fails_on_empty() {
    assert!(col_letters.parse_peek("").is_err());
    assert!(col_letters.parse_peek("123").is_err());
}

// ── row_digits ──────────────────────────────────────────────────────────

#[test]
fn test_row_digits_basic() {
    assert_eq!(row_digits.parse_peek("1+"), Ok(("+", "1")));
    assert_eq!(row_digits.parse_peek("999"), Ok(("", "999")));
    assert_eq!(row_digits.parse_peek("1048576"), Ok(("", "1048576")));
}

#[test]
fn test_row_digits_fails_on_empty() {
    assert!(row_digits.parse_peek("").is_err());
    assert!(row_digits.parse_peek("ABC").is_err());
}

// ── quoted_sheet_name ───────────────────────────────────────────────────

#[test]
fn test_quoted_sheet_name_basic() {
    let mut input = "'Sheet 1'";
    assert_eq!(quoted_sheet_name(&mut input).unwrap(), "Sheet 1");
    assert_eq!(input, "");
}

#[test]
fn test_quoted_sheet_name_escaped_quote() {
    let mut input = "'It''s a sheet'";
    assert_eq!(quoted_sheet_name(&mut input).unwrap(), "It's a sheet");
}

#[test]
fn test_quoted_sheet_name_multiple_escaped_quotes() {
    let mut input = "'a''b''c'";
    assert_eq!(quoted_sheet_name(&mut input).unwrap(), "a'b'c");
}

#[test]
fn test_quoted_sheet_name_just_space() {
    let mut input = "' '";
    assert_eq!(quoted_sheet_name(&mut input).unwrap(), " ");
}

#[test]
fn test_quoted_sheet_name_special_characters() {
    let mut input = "'Sheet (1)'";
    assert_eq!(quoted_sheet_name(&mut input).unwrap(), "Sheet (1)");

    let mut input = "'Data-2024'";
    assert_eq!(quoted_sheet_name(&mut input).unwrap(), "Data-2024");
}

#[test]
fn test_quoted_sheet_name_with_remaining() {
    let mut input = "'Sheet 1'!A1";
    assert_eq!(quoted_sheet_name(&mut input).unwrap(), "Sheet 1");
    assert_eq!(input, "!A1");
}

#[test]
fn test_quoted_sheet_name_empty() {
    let mut input = "''";
    assert_eq!(quoted_sheet_name(&mut input).unwrap(), "");
}

// ── unquoted_sheet_name ─────────────────────────────────────────────────

#[test]
fn test_unquoted_sheet_name() {
    assert_eq!(
        unquoted_sheet_name.parse_peek("Sheet1!A1"),
        Ok(("!A1", "Sheet1"))
    );
    assert_eq!(
        unquoted_sheet_name.parse_peek("Data_2024"),
        Ok(("", "Data_2024"))
    );
}

#[test]
fn test_unquoted_sheet_name_fails() {
    assert!(unquoted_sheet_name.parse_peek("").is_err());
    // Spaces are not allowed in unquoted names
    assert_eq!(
        unquoted_sheet_name.parse_peek("Sheet 1"),
        Ok((" 1", "Sheet"))
    );
}

// ── ws ──────────────────────────────────────────────────────────────────

#[test]
fn test_ws_spaces_and_tabs() {
    assert_eq!(ws.parse_peek("  \t rest"), Ok(("rest", "  \t ")));
    assert_eq!(ws.parse_peek("rest"), Ok(("rest", "")));
    assert_eq!(ws.parse_peek(""), Ok(("", "")));
}

#[test]
fn test_ws_newlines() {
    assert_eq!(ws.parse_peek("\n\r\n x"), Ok(("x", "\n\r\n ")));
}
