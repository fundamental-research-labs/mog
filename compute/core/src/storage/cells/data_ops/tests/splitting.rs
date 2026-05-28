use super::super::*;

// ===================================================================
// Pure function tests: split_by_fixed_width
// ===================================================================

#[test]
fn test_split_fixed_width_basic() {
    let result = split_by_fixed_width("Hello World Test", &[5, 11]);
    assert_eq!(result, vec!["Hello", "World", "Test"]);
}

#[test]
fn test_split_fixed_width_empty_value() {
    let result = split_by_fixed_width("", &[5]);
    assert_eq!(result, vec![""]);
}

#[test]
fn test_split_fixed_width_no_breaks() {
    let result = split_by_fixed_width("Hello", &[]);
    assert_eq!(result, vec!["Hello"]);
}

#[test]
fn test_split_fixed_width_unsorted_breaks() {
    let result = split_by_fixed_width("ABCDEFGHIJ", &[6, 3]);
    assert_eq!(result, vec!["ABC", "DEF", "GHIJ"]);
}

#[test]
fn test_split_fixed_width_break_beyond_length() {
    let result = split_by_fixed_width("ABC", &[3, 10]);
    assert_eq!(result, vec!["ABC"]);
}

#[test]
fn test_split_fixed_width_trims_parts() {
    let result = split_by_fixed_width("  AB   CD  ", &[5]);
    assert_eq!(result, vec!["AB", "CD"]);
}

// ===================================================================
// Pure function tests: split_by_delimiter
// ===================================================================

#[test]
fn test_split_delimiter_comma() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter("a,b,c", &re, &TextQualifier::None);
    assert_eq!(result, vec!["a", "b", "c"]);
}

#[test]
fn test_split_delimiter_empty_string() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter("", &re, &TextQualifier::None);
    assert_eq!(result, vec![""]);
}

#[test]
fn test_split_delimiter_no_delimiter() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter("hello", &re, &TextQualifier::None);
    assert_eq!(result, vec!["hello"]);
}

#[test]
fn test_split_delimiter_consecutive_as_one() {
    let re = build_delimiter_regex(&Delimiters::default(), true);
    let result = split_by_delimiter("a,,b,,,c", &re, &TextQualifier::None);
    assert_eq!(result, vec!["a", "b", "c"]);
}

#[test]
fn test_split_delimiter_with_double_quote_qualifier() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter("\"hello,world\",test", &re, &TextQualifier::DoubleQuote);
    assert_eq!(result, vec!["hello,world", "test"]);
}

#[test]
fn test_split_delimiter_escaped_quotes() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    let result = split_by_delimiter(
        "\"He said \"\"hi\"\"\",done",
        &re,
        &TextQualifier::DoubleQuote,
    );
    assert_eq!(result, vec!["He said \"hi\"", "done"]);
}

#[test]
fn test_split_delimiter_tab() {
    let delimiters = Delimiters {
        tab: true,
        semicolon: false,
        comma: false,
        space: false,
        other: None,
    };
    let re = build_delimiter_regex(&delimiters, false);
    let result = split_by_delimiter("a\tb\tc", &re, &TextQualifier::None);
    assert_eq!(result, vec!["a", "b", "c"]);
}

// ===================================================================
// Pure function tests: build_delimiter_regex
// ===================================================================

#[test]
fn test_build_regex_comma_only() {
    let re = build_delimiter_regex(&Delimiters::default(), false);
    assert!(re.is_match(","));
    assert!(!re.is_match("a"));
}

#[test]
fn test_build_regex_semicolon() {
    let d = Delimiters {
        tab: false,
        semicolon: true,
        comma: false,
        space: false,
        other: None,
    };
    let re = build_delimiter_regex(&d, false);
    assert!(re.is_match(";"));
    assert!(!re.is_match(","));
}

#[test]
fn test_build_regex_multiple_delimiters() {
    let d = Delimiters {
        tab: true,
        semicolon: true,
        comma: true,
        space: true,
        other: None,
    };
    let re = build_delimiter_regex(&d, false);
    assert!(re.is_match(","));
    assert!(re.is_match(";"));
    assert!(re.is_match(" "));
    assert!(re.is_match("\t"));
}

#[test]
fn test_build_regex_other_char() {
    let d = Delimiters {
        tab: false,
        semicolon: false,
        comma: false,
        space: false,
        other: Some("|".to_string()),
    };
    let re = build_delimiter_regex(&d, false);
    assert!(re.is_match("|"));
    assert!(!re.is_match(","));
}

#[test]
fn test_build_regex_empty_defaults_to_comma() {
    let d = Delimiters {
        tab: false,
        semicolon: false,
        comma: false,
        space: false,
        other: None,
    };
    let re = build_delimiter_regex(&d, false);
    assert!(re.is_match(","));
}

#[test]
fn test_build_regex_consecutive() {
    let re = build_delimiter_regex(&Delimiters::default(), true);
    // Should match multiple consecutive commas
    let caps: Vec<_> = re.find_iter(",,,").collect();
    assert_eq!(caps.len(), 1); // One match for the whole run
}
