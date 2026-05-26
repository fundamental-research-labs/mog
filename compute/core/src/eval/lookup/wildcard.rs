//! Wildcard matching internals for lookup functions.
//!
//! Supports `*` (any sequence), `?` (any single character), and
//! `~` escapes (`~*`, `~?`, `~~`).

// ---------------------------------------------------------------------------
// Wildcard matching internals
// ---------------------------------------------------------------------------

/// Compiled wildcard pattern element.
#[derive(Debug, Clone, PartialEq)]
pub(in crate::eval::lookup) enum WildcardToken {
    /// Match any sequence of characters (including empty)
    Star,
    /// Match exactly one character
    Question,
    /// Match a literal character
    Literal(char),
}

/// Compile a wildcard pattern string into a sequence of tokens.
/// Handles `~*`, `~?`, and `~~` escapes.
pub(in crate::eval::lookup) fn compile_wildcard(pattern: &str) -> Vec<WildcardToken> {
    let mut tokens = Vec::new();
    let mut chars = pattern.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '~' => {
                // Escape: next char is literal
                match chars.next() {
                    Some('*') => tokens.push(WildcardToken::Literal('*')),
                    Some('?') => tokens.push(WildcardToken::Literal('?')),
                    Some('~') => tokens.push(WildcardToken::Literal('~')),
                    Some(other) => {
                        // Tilde followed by non-special char: treat tilde as literal
                        tokens.push(WildcardToken::Literal('~'));
                        tokens.push(WildcardToken::Literal(other));
                    }
                    None => {
                        // Trailing tilde: treat as literal
                        tokens.push(WildcardToken::Literal('~'));
                    }
                }
            }
            '*' => tokens.push(WildcardToken::Star),
            '?' => tokens.push(WildcardToken::Question),
            _ => tokens.push(WildcardToken::Literal(ch)),
        }
    }

    tokens
}

/// Match a string against a compiled wildcard pattern using backtracking.
pub(in crate::eval::lookup) fn wildcard_match(pattern: &[WildcardToken], text: &str) -> bool {
    let text_chars: Vec<char> = text.chars().collect();
    wildcard_match_impl(pattern, &text_chars, 0, 0)
}

fn wildcard_match_impl(
    pattern: &[WildcardToken],
    text: &[char],
    mut pi: usize,
    mut ti: usize,
) -> bool {
    // Iterative approach with backtracking for Star tokens
    let mut star_pi: Option<usize> = None;
    let mut star_ti: usize = 0;

    loop {
        if pi < pattern.len() {
            match &pattern[pi] {
                WildcardToken::Star => {
                    star_pi = Some(pi);
                    star_ti = ti;
                    pi += 1;
                    continue;
                }
                WildcardToken::Question => {
                    if ti < text.len() {
                        pi += 1;
                        ti += 1;
                        continue;
                    }
                }
                WildcardToken::Literal(c) => {
                    if ti < text.len() && text[ti] == *c {
                        pi += 1;
                        ti += 1;
                        continue;
                    }
                }
            }
        } else if ti == text.len() {
            return true;
        }

        // Backtrack to last star
        if let Some(sp) = star_pi {
            star_ti += 1;
            if star_ti > text.len() {
                return false;
            }
            pi = sp + 1;
            ti = star_ti;
        } else {
            return false;
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compile_wildcard_basic() {
        let tokens = compile_wildcard("a*b?c");
        assert_eq!(
            tokens,
            vec![
                WildcardToken::Literal('a'),
                WildcardToken::Star,
                WildcardToken::Literal('b'),
                WildcardToken::Question,
                WildcardToken::Literal('c'),
            ]
        );
    }

    #[test]
    fn test_compile_wildcard_escapes() {
        let tokens = compile_wildcard("a~*b~?c~~d");
        assert_eq!(
            tokens,
            vec![
                WildcardToken::Literal('a'),
                WildcardToken::Literal('*'),
                WildcardToken::Literal('b'),
                WildcardToken::Literal('?'),
                WildcardToken::Literal('c'),
                WildcardToken::Literal('~'),
                WildcardToken::Literal('d'),
            ]
        );
    }

    #[test]
    fn test_wildcard_match_empty_pattern() {
        let tokens = compile_wildcard("");
        assert!(wildcard_match(&tokens, ""));
        assert!(!wildcard_match(&tokens, "a"));
    }

    #[test]
    fn test_wildcard_match_star_only() {
        let tokens = compile_wildcard("*");
        assert!(wildcard_match(&tokens, ""));
        assert!(wildcard_match(&tokens, "anything"));
    }

    #[test]
    fn test_wildcard_match_complex() {
        let tokens = compile_wildcard("a*b*c");
        assert!(wildcard_match(&tokens, "abc"));
        assert!(wildcard_match(&tokens, "aXbYc"));
        assert!(wildcard_match(&tokens, "aXXbYYc"));
        assert!(!wildcard_match(&tokens, "aXcYb"));
    }
}
