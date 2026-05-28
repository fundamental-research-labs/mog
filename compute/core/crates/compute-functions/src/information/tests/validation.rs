use value_types::CellError;

use crate::PureFunction;
use crate::information::validation::{FnIsDate, FnIsEmail, FnIsUrl};

use super::helpers::{array, bool_val, err, null, num, text};

#[test]
fn test_isdate_numbers() {
    assert_eq!(FnIsDate.call(&[num(1.0)]), bool_val(true));
    assert_eq!(FnIsDate.call(&[num(60.0)]), bool_val(true));
    assert_eq!(FnIsDate.call(&[num(61.0)]), bool_val(true));
    assert_eq!(FnIsDate.call(&[num(45_292.75)]), bool_val(true));
    assert_eq!(FnIsDate.call(&[num(0.0)]), bool_val(false));
    assert_eq!(FnIsDate.call(&[num(0.75)]), bool_val(false));
    assert_eq!(FnIsDate.call(&[num(-1.0)]), bool_val(false));
    assert_eq!(FnIsDate.call(&[num(2_958_466.0)]), bool_val(false));
}

#[test]
fn test_isdate_text() {
    assert_eq!(FnIsDate.call(&[text("2024-03-15")]), bool_val(true));
    assert_eq!(FnIsDate.call(&[text("3/15/2024")]), bool_val(true));
    assert_eq!(FnIsDate.call(&[text("July 20 1969")]), bool_val(true));
    assert_eq!(FnIsDate.call(&[text("15-Jul-2024")]), bool_val(true));
    assert_eq!(
        FnIsDate.call(&[text("January 15, 2024 3:00 PM")]),
        bool_val(true)
    );
    assert_eq!(FnIsDate.call(&[text("")]), bool_val(false));
    assert_eq!(FnIsDate.call(&[text("July")]), bool_val(false));
    assert_eq!(FnIsDate.call(&[text("Feb 30")]), bool_val(false));
    assert_eq!(FnIsDate.call(&[text("13/32/2024")]), bool_val(false));
    assert_eq!(FnIsDate.call(&[text("12:30 PM")]), bool_val(false));
    assert_eq!(FnIsDate.call(&[text("12345")]), bool_val(false));
}

#[test]
fn test_isdate_non_matches_and_arrays() {
    assert_eq!(FnIsDate.call(&[bool_val(true)]), bool_val(false));
    assert_eq!(FnIsDate.call(&[null()]), bool_val(false));
    assert_eq!(FnIsDate.call(&[err(CellError::Div0)]), bool_val(false));
    assert_eq!(
        FnIsDate.call(&[array(vec![vec![
            num(1.0),
            text("July"),
            err(CellError::Na),
        ]])]),
        array(vec![vec![bool_val(true), bool_val(false), bool_val(false)]])
    );
}

#[test]
fn test_isemail_valid_shapes() {
    for value in [
        "noreply@google.com",
        "johndoe@yourname.com",
        "janesmith@yourname.xyz",
        "first.last+tag@example.co.uk",
        "a_b-c@example-domain.com",
    ] {
        assert_eq!(FnIsEmail.call(&[text(value)]), bool_val(true), "{value}");
    }
}

#[test]
fn test_isemail_invalid_shapes() {
    for value in [
        "",
        "missing-domain@",
        "@missing-local.com",
        "a@@example.com",
        "a b@example.com",
        "a@example",
        "a@example..com",
        "a@-example.com",
        ".a@example.com",
        "a.@example.com",
        "a..b@example.com",
        "\"a\"@example.com",
        "Alice <a@example.com>",
        "a@[127.0.0.1]",
    ] {
        assert_eq!(FnIsEmail.call(&[text(value)]), bool_val(false), "{value}");
    }
}

#[test]
fn test_isemail_non_text_and_arrays() {
    assert_eq!(FnIsEmail.call(&[num(1.0)]), bool_val(false));
    assert_eq!(FnIsEmail.call(&[bool_val(true)]), bool_val(false));
    assert_eq!(FnIsEmail.call(&[null()]), bool_val(false));
    assert_eq!(FnIsEmail.call(&[err(CellError::Value)]), bool_val(false));
    assert_eq!(
        FnIsEmail.call(&[array(vec![vec![text("a@example.com"), text("bad")]])]),
        array(vec![vec![bool_val(true), bool_val(false)]])
    );
}

#[test]
fn test_isurl_valid_shapes() {
    for value in [
        "https://example.com",
        "http://example.com/path?q=1#top",
        "ftp://files.example.org/pub",
        "gopher://example.com",
        "telnet://example.com:23",
        "news:example.com",
        "aim:example.com",
        "www.example.com",
        "google.com/search?q=sheets",
        "mailto:noreply@example.com",
    ] {
        assert_eq!(FnIsUrl.call(&[text(value)]), bool_val(true), "{value}");
    }
}

#[test]
fn test_isurl_invalid_shapes() {
    for value in [
        "",
        "https://",
        "ssh://example.com",
        "http://example",
        "http://example..com",
        "http://-example.com",
        "http://example.invalid123",
        "example",
        "example.c",
        "http://127.0.0.1",
        "https://example.com/a b",
        " mailto:noreply@example.com",
        "mailto:not-email",
    ] {
        assert_eq!(FnIsUrl.call(&[text(value)]), bool_val(false), "{value}");
    }
}

#[test]
fn test_isurl_non_text_and_arrays() {
    assert_eq!(FnIsUrl.call(&[num(1.0)]), bool_val(false));
    assert_eq!(FnIsUrl.call(&[bool_val(false)]), bool_val(false));
    assert_eq!(FnIsUrl.call(&[null()]), bool_val(false));
    assert_eq!(FnIsUrl.call(&[err(CellError::Name)]), bool_val(false));
    assert_eq!(
        FnIsUrl.call(&[array(vec![vec![text("example.com"), text("not url")]])]),
        array(vec![vec![bool_val(true), bool_val(false)]])
    );
}

#[test]
fn test_isurl_port_rules_and_bracketed_hosts() {
    assert_eq!(
        FnIsUrl.call(&[text("https://example.com:443")]),
        bool_val(true)
    );
    assert_eq!(
        FnIsUrl.call(&[text("https://example.com:0")]),
        bool_val(false)
    );
    assert_eq!(
        FnIsUrl.call(&[text("https://example.com:70000")]),
        bool_val(false)
    );
    assert_eq!(
        FnIsUrl.call(&[text("https://[example.com]")]),
        bool_val(false)
    );
}
