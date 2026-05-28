use super::super::super::test_helpers::{err, num, text};
use super::super::before_after::{FnTextAfter, FnTextBefore};
use crate::PureFunction;
use value_types::CellError;

#[test]
fn test_textbefore_basic() {
    let f = FnTextBefore;
    assert_eq!(f.call(&[text("hello-world"), text("-")]), text("hello"));
    assert_eq!(f.call(&[text("hello"), text("-")]), err(CellError::Na));
}

#[test]
fn test_textbefore_instance_num() {
    let f = FnTextBefore;
    assert_eq!(f.call(&[text("a-b-c"), text("-"), num(2.0)]), text("a-b"));
    assert_eq!(f.call(&[text("a-b-c"), text("-"), num(-1.0)]), text("a-b"));
}

#[test]
fn test_textbefore_case_insensitive() {
    let f = FnTextBefore;
    assert_eq!(
        f.call(&[text("helloXworld"), text("x"), num(1.0), num(1.0)]),
        text("hello")
    );
}

#[test]
fn test_textafter_basic() {
    let f = FnTextAfter;
    assert_eq!(f.call(&[text("hello-world"), text("-")]), text("world"));
    assert_eq!(f.call(&[text("hello"), text("-")]), err(CellError::Na));
}

#[test]
fn test_textafter_instance_num() {
    let f = FnTextAfter;
    assert_eq!(f.call(&[text("a-b-c"), text("-"), num(2.0)]), text("c"));
}

#[test]
fn test_textafter_if_not_found() {
    let f = FnTextAfter;
    assert_eq!(
        f.call(&[
            text("hello"),
            text("-"),
            num(1.0),
            num(0.0),
            num(0.0),
            text("N/A")
        ]),
        text("N/A")
    );
}

#[test]
fn test_textbefore_unicode_no_panic() {
    let f = FnTextBefore;
    assert_eq!(
        f.call(&[text("caf\u{00e9}\u{2615}test"), text("\u{2615}")]),
        text("caf\u{00e9}")
    );
    assert_eq!(
        f.call(&[text("hello\u{1F600}world"), text("\u{1F600}")]),
        text("hello")
    );
}

#[test]
fn test_textafter_unicode_no_panic() {
    let f = FnTextAfter;
    assert_eq!(
        f.call(&[text("caf\u{00e9}\u{2615}test"), text("\u{2615}")]),
        text("test")
    );
    assert_eq!(
        f.call(&[text("hello\u{1F600}world"), text("\u{1F600}")]),
        text("world")
    );
}

#[test]
fn test_textbefore_case_insensitive_unicode() {
    let f = FnTextBefore;
    assert_eq!(
        f.call(&[
            text("hello\u{00DC}world"),
            text("\u{00fc}"),
            num(1.0),
            num(1.0)
        ]),
        text("hello")
    );
}

#[test]
fn test_textbefore_no_overlapping_matches() {
    let f = FnTextBefore;
    assert_eq!(f.call(&[text("aaa"), text("aa"), num(1.0)]), text(""));
    assert_eq!(
        f.call(&[text("aaa"), text("aa"), num(2.0)]),
        err(CellError::Na)
    );
}

#[test]
fn test_textafter_no_overlapping_matches() {
    let f = FnTextAfter;
    assert_eq!(f.call(&[text("aaa"), text("aa"), num(1.0)]), text("a"));
}

#[test]
fn test_textbefore_simple() {
    assert_eq!(
        FnTextBefore.call(&[text("hello-world"), text("-")]),
        text("hello")
    );
}

#[test]
fn test_textbefore_not_found_default_na() {
    assert_eq!(
        FnTextBefore.call(&[text("hello"), text("x")]),
        err(CellError::Na)
    );
}

#[test]
fn test_textbefore_instance_2() {
    assert_eq!(
        FnTextBefore.call(&[text("a-b-c"), text("-"), num(2.0)]),
        text("a-b")
    );
}

#[test]
fn test_textbefore_negative_instance_from_end() {
    assert_eq!(
        FnTextBefore.call(&[text("a-b-c"), text("-"), num(-1.0)]),
        text("a-b")
    );
    assert_eq!(
        FnTextBefore.call(&[text("a-b-c"), text("-"), num(-2.0)]),
        text("a")
    );
}

#[test]
fn test_textbefore_negative_instance_too_large() {
    assert_eq!(
        FnTextBefore.call(&[text("a-b-c"), text("-"), num(-3.0)]),
        err(CellError::Na)
    );
}

#[test]
fn test_textbefore_instance_zero_error() {
    assert_eq!(
        FnTextBefore.call(&[text("a-b"), text("-"), num(0.0)]),
        err(CellError::Value)
    );
}

#[test]
fn test_textbefore_case_insensitive_mode() {
    assert_eq!(
        FnTextBefore.call(&[text("HelloXworld"), text("x"), num(1.0), num(1.0)]),
        text("Hello")
    );
}

#[test]
fn test_textbefore_case_sensitive_default() {
    assert_eq!(
        FnTextBefore.call(&[text("HelloXworld"), text("x"), num(1.0), num(0.0)]),
        err(CellError::Na)
    );
}

#[test]
fn test_textbefore_if_not_found_custom() {
    assert_eq!(
        FnTextBefore.call(&[
            text("hello"),
            text("x"),
            num(1.0),
            num(0.0),
            num(0.0),
            text("NOT FOUND")
        ]),
        text("NOT FOUND")
    );
}

#[test]
fn test_textbefore_empty_delimiter_default() {
    assert_eq!(
        FnTextBefore.call(&[text("hello"), text("")]),
        err(CellError::Value)
    );
}

#[test]
fn test_textbefore_empty_delimiter_match_end() {
    assert_eq!(
        FnTextBefore.call(&[text("hello"), text(""), num(1.0), num(0.0), num(1.0)]),
        text("hello")
    );
}

#[test]
fn test_textbefore_delimiter_at_start() {
    assert_eq!(FnTextBefore.call(&[text("-hello"), text("-")]), text(""));
}

#[test]
fn test_textafter_simple() {
    assert_eq!(
        FnTextAfter.call(&[text("hello-world"), text("-")]),
        text("world")
    );
}

#[test]
fn test_textafter_not_found_default_na() {
    assert_eq!(
        FnTextAfter.call(&[text("hello"), text("x")]),
        err(CellError::Na)
    );
}

#[test]
fn test_textafter_instance_2() {
    assert_eq!(
        FnTextAfter.call(&[text("a-b-c"), text("-"), num(2.0)]),
        text("c")
    );
}

#[test]
fn test_textafter_negative_instance() {
    assert_eq!(
        FnTextAfter.call(&[text("a-b-c"), text("-"), num(-1.0)]),
        text("c")
    );
    assert_eq!(
        FnTextAfter.call(&[text("a-b-c"), text("-"), num(-2.0)]),
        text("b-c")
    );
}

#[test]
fn test_textafter_instance_zero_error() {
    assert_eq!(
        FnTextAfter.call(&[text("a-b"), text("-"), num(0.0)]),
        err(CellError::Value)
    );
}

#[test]
fn test_textafter_case_insensitive() {
    assert_eq!(
        FnTextAfter.call(&[text("HelloXworld"), text("x"), num(1.0), num(1.0)]),
        text("world")
    );
}

#[test]
fn test_textafter_empty_delimiter_default() {
    assert_eq!(
        FnTextAfter.call(&[text("hello"), text("")]),
        err(CellError::Value)
    );
}

#[test]
fn test_textafter_empty_delimiter_match_end() {
    assert_eq!(
        FnTextAfter.call(&[text("hello"), text(""), num(1.0), num(0.0), num(1.0)]),
        text("")
    );
}

#[test]
fn test_textafter_delimiter_at_end() {
    assert_eq!(FnTextAfter.call(&[text("hello-"), text("-")]), text(""));
}

#[test]
fn test_textafter_if_not_found_custom() {
    assert_eq!(
        FnTextAfter.call(&[
            text("hello"),
            text("x"),
            num(1.0),
            num(0.0),
            num(0.0),
            text("MISSING")
        ]),
        text("MISSING")
    );
}

#[test]
fn test_textafter_instance_exceeds_count() {
    assert_eq!(
        FnTextAfter.call(&[text("a-b"), text("-"), num(2.0)]),
        err(CellError::Na)
    );
}
