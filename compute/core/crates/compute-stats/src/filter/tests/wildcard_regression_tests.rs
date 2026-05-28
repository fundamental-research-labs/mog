use super::*;

#[test]
fn compiled_pattern_tilde_star_matches_literal_star() {
    // `~*` should match a literal '*'.
    assert!(CompiledPattern::compile("~*").matches("*"));
}

#[test]
fn compiled_pattern_tilde_star_does_not_match_control_byte_0x01() {
    // REGRESSION: under the previous sentinel scheme, `~*` was rewritten to
    // '\x01' inside the pattern, and `preprocess_text_for_sentinels` then
    // stripped '\x01' from user text — which made `~*` incorrectly match
    // an empty string (and, symmetrically, match a literal '\x01' when the
    // stripping was bypassed). The token-based matcher makes this impossible.
    assert!(!CompiledPattern::compile("~*").matches("\x01"));
    assert!(!CompiledPattern::compile("~?").matches("\x02"));
    assert!(!CompiledPattern::compile("~~").matches("\x03"));
}

#[test]
fn compiled_pattern_literal_control_byte_in_text_is_any_char() {
    // Literal control bytes in user text must flow through the matcher
    // as ordinary characters (one-of-any-char for `*` / `?`).
    assert!(CompiledPattern::compile("a*b").matches("a\x01b"));
    assert!(CompiledPattern::compile("a?b").matches("a\x01b"));
    assert!(CompiledPattern::compile("a?b").matches("a\x02b"));
}

#[test]
fn compiled_pattern_literal_control_byte_in_pattern_not_confused_with_token() {
    // A pattern containing a literal '\x02' (which was the old sentinel
    // for `~?`) must be treated as a literal character, not as `AnyOne`.
    // So `"abc\x02def"` should NOT match `"abc?def"` (which has a '?' in
    // the text, not a '\x02').
    let pat = CompiledPattern::compile("abc\x02def");
    assert!(pat.matches("abc\x02def"));
    assert!(!pat.matches("abc?def"));
    assert!(!pat.matches("abcXdef"));
}

#[test]
fn compiled_pattern_tilde_unicode_escape_roundtrip() {
    // `~é` — tilde before a non-wildcard Unicode char keeps both literally
    // (Excel semantics; `~` is an escape only before `*`, `?`, or `~`).
    let pat = CompiledPattern::compile("~é");
    assert!(pat.matches("~é"));
    assert!(!pat.matches("é"));
}

#[test]
fn compiled_pattern_tokenize_inventory() {
    // Spot-check the tokenizer output shape.
    let pat = CompiledPattern::compile("a*b?c~*~?~~d");
    assert_eq!(
        pat.tokens,
        vec![
            WildcardToken::Literal('a'),
            WildcardToken::AnyMany,
            WildcardToken::Literal('b'),
            WildcardToken::AnyOne,
            WildcardToken::Literal('c'),
            WildcardToken::Literal('*'),
            WildcardToken::Literal('?'),
            WildcardToken::Literal('~'),
            WildcardToken::Literal('d'),
        ]
    );
}

#[test]
fn compiled_pattern_trailing_tilde_is_literal() {
    // Trailing `~` at end of pattern is kept as a literal '~'.
    let pat = CompiledPattern::compile("abc~");
    assert_eq!(
        pat.tokens,
        vec![
            WildcardToken::Literal('a'),
            WildcardToken::Literal('b'),
            WildcardToken::Literal('c'),
            WildcardToken::Literal('~'),
        ]
    );
    assert!(pat.matches("abc~"));
}

#[test]
fn compiled_pattern_lone_tilde_then_non_escape_is_literal_tilde_plus_char() {
    // `~x` — tilde before a non-escape char emits both literally.
    let pat = CompiledPattern::compile("~x");
    assert_eq!(
        pat.tokens,
        vec![WildcardToken::Literal('~'), WildcardToken::Literal('x')]
    );
    assert!(pat.matches("~x"));
    assert!(!pat.matches("x"));
}

#[test]
fn compiled_pattern_compile_once_match_many() {
    // Compile-once/match-many is the intended perf win of the new API.
    // This test just asserts correctness across a mix of inputs; the
    // performance claim is verified by callers.
    let pat = CompiledPattern::compile("*foo*");
    assert!(pat.matches("foo"));
    assert!(pat.matches("xfoo"));
    assert!(pat.matches("fooy"));
    assert!(pat.matches("xfooy"));
    assert!(!pat.matches("fo"));
    assert!(!pat.matches(""));
}

#[test]
fn compiled_pattern_ascii_fastpath_vs_unicode_agree() {
    // ASCII-only and non-ASCII branches must agree on ASCII inputs.
    // (Regression guard: if the fast-path ever diverges, this catches it.)
    let ascii_pat = CompiledPattern::compile("a*b?c");
    assert!(ascii_pat.all_ascii);
    assert!(ascii_pat.matches("abXc")); // ASCII fast path
    assert!(!ascii_pat.matches("abXd"));

    // Force the Unicode path by having a Unicode literal in the pattern.
    let unicode_pat = CompiledPattern::compile("a*béc");
    assert!(!unicode_pat.all_ascii);
    assert!(unicode_pat.matches("abXXbéc"));
    assert!(!unicode_pat.matches("abXXbec"));
}
