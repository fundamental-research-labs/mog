use super::super::wildcard::has_wildcards;
use super::*;

#[test]
fn test_wildcard_match_star() {
    assert!(matches_wildcard_pattern("hello world", "hello*"));
    assert!(matches_wildcard_pattern("hello world", "*world"));
    assert!(matches_wildcard_pattern("hello world", "*llo wo*"));
    assert!(!matches_wildcard_pattern("hello", "world*"));
}

#[test]
fn test_wildcard_match_question() {
    assert!(matches_wildcard_pattern("hello", "hell?"));
    assert!(matches_wildcard_pattern("hello", "?ello"));
    assert!(!matches_wildcard_pattern("hello", "hell??"));
}

#[test]
fn test_wildcard_star_empty() {
    assert!(matches_wildcard_pattern("", "*"));
    assert!(matches_wildcard_pattern("anything", "*"));
    assert!(!matches_wildcard_pattern("", "?"));
}

#[test]
fn test_wildcard_exact_match() {
    assert!(matches_wildcard_pattern("hello", "hello"));
    assert!(!matches_wildcard_pattern("hello", "hell"));
    assert!(!matches_wildcard_pattern("hell", "hello"));
}

#[test]
fn test_wildcard_complex_patterns() {
    assert!(matches_wildcard_pattern("abcde", "*b*d*"));
    assert!(matches_wildcard_pattern("abcde", "?b?d?"));
    assert!(!matches_wildcard_pattern("abcde", "?b?d"));
}

#[test]
fn test_wildcard_tilde_escape() {
    // ~* matches literal *
    assert!(matches_wildcard_pattern("a*b", "a~*b"));
    assert!(!matches_wildcard_pattern("aXb", "a~*b"));
    // ~? matches literal ?
    assert!(matches_wildcard_pattern("a?b", "a~?b"));
    assert!(!matches_wildcard_pattern("aXb", "a~?b"));
    // ~~ matches literal ~
    assert!(matches_wildcard_pattern("a~b", "a~~b"));
    assert!(!matches_wildcard_pattern("aXb", "a~~b"));
}

#[test]
fn test_has_wildcards() {
    assert!(has_wildcards("hello*"));
    assert!(has_wildcards("hello?"));
    assert!(!has_wildcards("hello~*")); // escaped
    assert!(!has_wildcards("hello~?")); // escaped
    assert!(!has_wildcards("hello"));
    assert!(!has_wildcards("hello~~")); // escaped tilde, no wildcard
}

#[test]
fn test_unicode_wildcard() {
    assert!(matches_wildcard_pattern("café", "caf?"));
    assert!(matches_wildcard_pattern("café", "ca*"));
    assert!(matches_wildcard_pattern("日本語", "日*語"));
}

#[test]
fn wildcard_triple_star_matches_anything() {
    // Multiple consecutive stars should behave like a single star.
    assert!(matches_wildcard_pattern("anything", "***"));
    assert!(matches_wildcard_pattern("", "***"));
    assert!(matches_wildcard_pattern("hello world", "***"));
}

#[test]
fn wildcard_single_question_matches_one_char() {
    assert!(matches_wildcard_pattern("a", "?"));
    assert!(matches_wildcard_pattern("z", "?"));
    assert!(!matches_wildcard_pattern("", "?"));
    assert!(!matches_wildcard_pattern("ab", "?"));
}

#[test]
fn wildcard_double_question_matches_two_chars() {
    assert!(matches_wildcard_pattern("ab", "??"));
    assert!(matches_wildcard_pattern("zz", "??"));
    assert!(!matches_wildcard_pattern("a", "??"));
    assert!(!matches_wildcard_pattern("abc", "??"));
    assert!(!matches_wildcard_pattern("", "??"));
}

#[test]
fn wildcard_escaped_star_in_context() {
    // "a~*b" should match literal "a*b" but not "axb".
    assert!(matches_wildcard_pattern("a*b", "a~*b"));
    assert!(!matches_wildcard_pattern("axb", "a~*b"));
}

#[test]
fn wildcard_escaped_star_followed_by_star() {
    // "~**" means literal * followed by anything.
    assert!(matches_wildcard_pattern("*", "~**"));
    assert!(matches_wildcard_pattern("*hello", "~**"));
    assert!(!matches_wildcard_pattern("hello", "~**"));
}

#[test]
fn wildcard_escaped_question_followed_by_question() {
    // "~??" means literal ? followed by any single char.
    assert!(matches_wildcard_pattern("?a", "~??"));
    assert!(matches_wildcard_pattern("?z", "~??"));
    assert!(!matches_wildcard_pattern("az", "~??"));
    assert!(!matches_wildcard_pattern("?", "~??"));
    assert!(!matches_wildcard_pattern("?ab", "~??"));
}

#[test]
fn wildcard_unicode_cafe_question() {
    assert!(matches_wildcard_pattern("café", "caf?"));
}

#[test]
fn wildcard_unicode_japanese_with_star() {
    // Wildcard * in a startswith-like context with Unicode.
    assert!(matches_wildcard_pattern("日本語テスト", "日本*"));
}

#[test]
fn wildcard_unicode_question_matches_one_char_not_one_byte() {
    // Each ? should match one Unicode character, not one byte.
    // "日本語" is 3 chars, so "???" should match.
    assert!(matches_wildcard_pattern("日本語", "???"));
    // "??" should not match 3 chars.
    assert!(!matches_wildcard_pattern("日本語", "??"));
    // "????" should not match 3 chars.
    assert!(!matches_wildcard_pattern("日本語", "????"));
}
