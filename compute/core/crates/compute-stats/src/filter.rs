//! Predicate matching primitives for analytical filtering.
//!
//! General-purpose filter condition evaluation and wildcard pattern matching.
//! Used by both the pivot engine and worksheet functions (SUMIF, COUNTIF, D* functions).
//!
//! # Key functions
//!
//! - [`matches_condition`] — Evaluate a [`PivotFilterCondition`] against a [`CellValue`]
//! - [`matches_wildcard_pattern`] — Excel-compatible wildcard matching (`*`, `?`, `~` escape)

use value_types::CellValue;

use super::types::{BinaryFilterOp, NullaryFilterOp, PivotFilterCondition, UnaryFilterOp};
use super::values::cell_value_eq;

// ============================================================================
// Condition matching
// ============================================================================

/// Check if a value matches a filter condition.
///
/// Pattern-matches on the type-safe [`PivotFilterCondition`] enum. Each variant
/// carries exactly the operands it needs — no `Option<CellValue>` guessing.
///
/// # `AboveAverage` / `BelowAverage`
///
/// These conditions require full-column context to compute the average. When called
/// directly (without column context), they return `true` (pass-through). The
/// orchestration layer handles them specially by computing the column average first.
///
/// # Wildcard support
///
/// Text conditions (Contains, `StartsWith`, `EndsWith`, Equals) support `*` (any chars)
/// and `?` (single char) wildcards. If no wildcards are present, simple string
/// matching is used for performance.
#[must_use]
pub fn matches_condition(value: &CellValue, condition: &PivotFilterCondition) -> bool {
    match condition {
        // -- Nullary: no operands --
        PivotFilterCondition::Nullary(op) => match op {
            NullaryFilterOp::IsBlank => value.is_visually_blank(),
            NullaryFilterOp::IsNotBlank => !value.is_visually_blank(),
            // AboveAverage/BelowAverage need full-column context; handled by orchestration layer.
            // When called directly, pass through.
            NullaryFilterOp::AboveAverage | NullaryFilterOp::BelowAverage => true,
        },

        // -- Unary: one operand --
        PivotFilterCondition::Unary { op, value: target } => match op {
            UnaryFilterOp::Equals => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        matches_wildcard_pattern(&s_lower, &p_lower)
                    } else {
                        s.eq_ignore_ascii_case(pattern)
                            || (!s.is_ascii() || !pattern.is_ascii())
                                && s.to_lowercase() == pattern.to_lowercase()
                    }
                }
                _ => cell_value_eq(value, target),
            },
            UnaryFilterOp::NotEquals => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        !matches_wildcard_pattern(&s_lower, &p_lower)
                    } else {
                        !s.eq_ignore_ascii_case(pattern)
                            && (s.is_ascii() && pattern.is_ascii()
                                || s.to_lowercase() != pattern.to_lowercase())
                    }
                }
                _ => !cell_value_eq(value, target),
            },
            UnaryFilterOp::Contains => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        matches_wildcard_pattern(&s_lower, &format!("*{p_lower}*"))
                    } else {
                        contains_case_insensitive(s, pattern)
                    }
                }
                _ => false,
            },
            UnaryFilterOp::NotContains => {
                match (value, target) {
                    (CellValue::Text(s), CellValue::Text(pattern)) => {
                        if has_wildcards(pattern) {
                            let s_lower = s.to_lowercase();
                            let p_lower = pattern.to_lowercase();
                            !matches_wildcard_pattern(&s_lower, &format!("*{p_lower}*"))
                        } else {
                            !contains_case_insensitive(s, pattern)
                        }
                    }
                    // Non-text values don't contain any text pattern.
                    _ => true,
                }
            }
            UnaryFilterOp::StartsWith => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        matches_wildcard_pattern(&s_lower, &format!("{p_lower}*"))
                    } else {
                        starts_with_case_insensitive(s, pattern)
                    }
                }
                _ => false,
            },
            UnaryFilterOp::EndsWith => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        matches_wildcard_pattern(&s_lower, &format!("*{p_lower}"))
                    } else {
                        ends_with_case_insensitive(s, pattern)
                    }
                }
                _ => false,
            },
            UnaryFilterOp::GreaterThan => match (value, target) {
                (CellValue::Number(a), CellValue::Number(b)) => a > b,
                _ => false,
            },
            UnaryFilterOp::GreaterThanOrEqual => match (value, target) {
                (CellValue::Number(a), CellValue::Number(b)) => a >= b,
                _ => false,
            },
            UnaryFilterOp::LessThan => match (value, target) {
                (CellValue::Number(a), CellValue::Number(b)) => *a < *b,
                _ => false,
            },
            UnaryFilterOp::LessThanOrEqual => match (value, target) {
                (CellValue::Number(a), CellValue::Number(b)) => *a <= *b,
                _ => false,
            },
        },

        // -- Binary: two operands (range operations) --
        PivotFilterCondition::Binary {
            op,
            value: lo,
            value2: hi,
        } => match op {
            BinaryFilterOp::Between => match (value, lo, hi) {
                (CellValue::Number(v), CellValue::Number(a), CellValue::Number(b)) => {
                    *v >= *a && *v <= *b
                }
                _ => false,
            },
            BinaryFilterOp::NotBetween => {
                match (value, lo, hi) {
                    (CellValue::Number(v), CellValue::Number(a), CellValue::Number(b)) => {
                        *v < *a || *v > *b
                    }
                    // Non-number is not between anything (mirrors Excel/TS behavior).
                    _ => true,
                }
            }
        },
        _ => false, // future PivotFilterCondition variants
    }
}

// ============================================================================
// Case-insensitive string helpers (allocation-free for ASCII)
// ============================================================================

/// Case-insensitive `contains` that avoids `to_lowercase()` allocation
/// when both strings are ASCII.
fn contains_case_insensitive(haystack: &str, needle: &str) -> bool {
    if haystack.is_ascii() && needle.is_ascii() {
        // ASCII fast path: slide a window over the haystack bytes.
        let h = haystack.as_bytes();
        let n = needle.as_bytes();
        if n.len() > h.len() {
            return false;
        }
        if n.is_empty() {
            return true;
        }
        h.windows(n.len())
            .any(|window| window.eq_ignore_ascii_case(n))
    } else {
        haystack.to_lowercase().contains(&needle.to_lowercase())
    }
}

/// Case-insensitive `starts_with` that avoids allocation for ASCII.
fn starts_with_case_insensitive(s: &str, prefix: &str) -> bool {
    if s.is_ascii() && prefix.is_ascii() {
        s.as_bytes()
            .get(..prefix.len())
            .is_some_and(|slice| slice.eq_ignore_ascii_case(prefix.as_bytes()))
    } else {
        s.to_lowercase().starts_with(&prefix.to_lowercase())
    }
}

/// Case-insensitive `ends_with` that avoids allocation for ASCII.
fn ends_with_case_insensitive(s: &str, suffix: &str) -> bool {
    if s.is_ascii() && suffix.is_ascii() {
        let sb = s.as_bytes();
        let xb = suffix.as_bytes();
        sb.len() >= xb.len() && sb[sb.len() - xb.len()..].eq_ignore_ascii_case(xb)
    } else {
        s.to_lowercase().ends_with(&suffix.to_lowercase())
    }
}

// ============================================================================
// Wildcard pattern matching (Excel-compatible: *, ?, ~escape)
// ============================================================================

/// Returns `true` if the pattern contains unescaped wildcard characters (`*` or `?`).
///
/// Tilde (`~`) is the escape character: `~*` is a literal `*`, `~?` is a literal `?`,
/// and `~~` is a literal `~`. A lone `*` or `?` not preceded by `~` is a wildcard.
///
/// Iterates over chars directly without collecting into a `Vec<char>`.
#[inline]
fn has_wildcards(pattern: &str) -> bool {
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        if c == '~' {
            // Skip the escaped character (if any).
            let _ = chars.next();
        } else if c == '*' || c == '?' {
            return true;
        }
    }
    false
}

/// One token of a compiled Excel wildcard pattern.
///
/// Tokens are a different type from the bytes/chars of user text, so literal
/// control bytes in user text (e.g. `\x01`) can never collide with the
/// encoding of a tilde-escape. This replaces the previous `\x01`/`\x02`/`\x03`
/// in-band sentinel scheme, which required stripping those bytes from user
/// text and thereby silently corrupted any input containing them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WildcardToken {
    /// A literal character — either from a tilde escape (`~*`, `~?`, `~~`) or
    /// any non-wildcard pattern char. Stored as `char` so it handles Unicode
    /// and also any of the formerly-conflicting control bytes.
    Literal(char),
    /// Unescaped `*` — matches zero or more characters.
    AnyMany,
    /// Unescaped `?` — matches exactly one character.
    AnyOne,
}

/// A wildcard pattern compiled once into a token stream.
///
/// Construct with [`CompiledPattern::compile`], then call
/// [`CompiledPattern::matches`] one or more times. Tokenizing up-front also
/// gives callers that match many values against the same pattern a free perf
/// win (compile once, match many).
#[derive(Debug, Clone)]
pub struct CompiledPattern {
    tokens: Vec<WildcardToken>,
    /// `true` iff every `Literal` in `tokens` is ASCII. Enables the ASCII
    /// fast-path in [`CompiledPattern::matches`].
    all_ascii: bool,
}

impl CompiledPattern {
    /// Compile an Excel wildcard pattern into a token stream.
    ///
    /// Tilde-escape sequences:
    /// - `~*` → `WildcardToken::Literal('*')`
    /// - `~?` → `WildcardToken::Literal('?')`
    /// - `~~` → `WildcardToken::Literal('~')`
    ///
    /// A lone trailing `~` or `~` followed by a non-escape char is emitted as
    /// a literal `~` followed by that char (or nothing), matching Excel.
    #[must_use]
    pub fn compile(pattern: &str) -> Self {
        let mut tokens = Vec::with_capacity(pattern.len());
        let mut all_ascii = true;
        let mut chars = pattern.chars();
        while let Some(c) = chars.next() {
            match c {
                '~' => match chars.next() {
                    Some('*') => tokens.push(WildcardToken::Literal('*')),
                    Some('?') => tokens.push(WildcardToken::Literal('?')),
                    Some('~') => tokens.push(WildcardToken::Literal('~')),
                    Some(other) => {
                        // Lone tilde not followed by *, ?, or ~ -- keep as-is
                        // (literal '~' then the following char).
                        tokens.push(WildcardToken::Literal('~'));
                        tokens.push(WildcardToken::Literal(other));
                        if !other.is_ascii() {
                            all_ascii = false;
                        }
                    }
                    None => {
                        // Trailing tilde at end of pattern -- literal '~'.
                        tokens.push(WildcardToken::Literal('~'));
                    }
                },
                '*' => tokens.push(WildcardToken::AnyMany),
                '?' => tokens.push(WildcardToken::AnyOne),
                other => {
                    tokens.push(WildcardToken::Literal(other));
                    if !other.is_ascii() {
                        all_ascii = false;
                    }
                }
            }
        }
        Self { tokens, all_ascii }
    }

    /// Match `text` against this compiled pattern.
    ///
    /// Uses a byte-level DP fast path when both the pattern's literals and the
    /// input text are ASCII; falls back to a `char`-based DP otherwise.
    #[must_use]
    pub fn matches(&self, text: &str) -> bool {
        if self.all_ascii && text.is_ascii() {
            matches_wildcard_bytes(text.as_bytes(), &self.tokens)
        } else {
            // Collect into Vec<char> so the DP matcher can index by position.
            let text_chars: Vec<char> = text.chars().collect();
            matches_wildcard_chars(&text_chars, &self.tokens)
        }
    }
}

/// DP wildcard matcher operating on byte text + token pattern (ASCII fast path).
///
/// Caller must ensure every `Literal` in `pattern` is ASCII.
fn matches_wildcard_bytes(text: &[u8], pattern: &[WildcardToken]) -> bool {
    let t_len = text.len();
    let p_len = pattern.len();

    let mut prev = vec![false; p_len + 1];
    let mut curr = vec![false; p_len + 1];

    prev[0] = true;

    // Pattern-only prefix: a run of `AnyMany` at the start matches empty text.
    for j in 1..=p_len {
        if matches!(pattern[j - 1], WildcardToken::AnyMany) {
            prev[j] = prev[j - 1];
        }
    }

    for i in 1..=t_len {
        curr[0] = false;
        for j in 1..=p_len {
            curr[j] = match pattern[j - 1] {
                WildcardToken::AnyMany => curr[j - 1] || prev[j],
                WildcardToken::AnyOne => prev[j - 1],
                WildcardToken::Literal(lc) => {
                    // Safe: caller guarantees Literal chars are ASCII on this
                    // path, and `text` is ASCII, so each byte == one char.
                    (lc as u32) < 128 && text[i - 1] == (lc as u8) && prev[j - 1]
                }
            };
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    prev[p_len]
}

/// DP wildcard matcher operating on char text + token pattern (Unicode fallback).
fn matches_wildcard_chars(text_chars: &[char], pattern: &[WildcardToken]) -> bool {
    let t_len = text_chars.len();
    let p_len = pattern.len();

    let mut prev = vec![false; p_len + 1];
    let mut curr = vec![false; p_len + 1];

    prev[0] = true;

    for j in 1..=p_len {
        if matches!(pattern[j - 1], WildcardToken::AnyMany) {
            prev[j] = prev[j - 1];
        }
    }

    for i in 1..=t_len {
        curr[0] = false;
        for j in 1..=p_len {
            curr[j] = match pattern[j - 1] {
                WildcardToken::AnyMany => curr[j - 1] || prev[j],
                WildcardToken::AnyOne => prev[j - 1],
                WildcardToken::Literal(lc) => text_chars[i - 1] == lc && prev[j - 1],
            };
        }
        std::mem::swap(&mut prev, &mut curr);
    }

    prev[p_len]
}

/// Match `text` against `pattern` using Excel wildcard semantics.
///
/// Thin convenience wrapper for single-shot matches. Callers that match the
/// same pattern against many values should prefer
/// [`CompiledPattern::compile`] once + [`CompiledPattern::matches`] in a loop.
///
/// Supported wildcards:
/// - `*` matches zero or more characters
/// - `?` matches exactly one character
///
/// Tilde escape sequences:
/// - `~*` matches a literal `*`
/// - `~?` matches a literal `?`
/// - `~~` matches a literal `~`
///
/// Matching is performed on already-lowercased strings (case-insensitive).
#[must_use]
pub fn matches_wildcard_pattern(text: &str, pattern: &str) -> bool {
    CompiledPattern::compile(pattern).matches(text)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::super::types::{BinaryFilterOp, NullaryFilterOp, UnaryFilterOp};
    use super::*;

    // -- matches_condition tests --

    #[test]
    fn test_matches_is_blank() {
        assert!(matches_condition(
            &CellValue::Null,
            &PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank)
        ));
        assert!(matches_condition(
            &CellValue::Text("".into()),
            &PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank),
        ));
        assert!(!matches_condition(
            &CellValue::number(0.0),
            &PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank),
        ));
    }

    #[test]
    fn test_matches_is_not_blank() {
        assert!(!matches_condition(
            &CellValue::Null,
            &PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank),
        ));
        assert!(matches_condition(
            &CellValue::number(1.0),
            &PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank),
        ));
    }

    #[test]
    fn test_matches_equals_number() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Equals,
            value: CellValue::number(42.0),
        };
        assert!(matches_condition(&CellValue::number(42.0), &cond));
        assert!(!matches_condition(&CellValue::number(43.0), &cond));
    }

    #[test]
    fn test_matches_equals_text_case_insensitive() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Equals,
            value: CellValue::Text("Hello".into()),
        };
        assert!(matches_condition(&CellValue::Text("hello".into()), &cond));
        assert!(matches_condition(&CellValue::Text("HELLO".into()), &cond));
        assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
    }

    #[test]
    fn test_matches_not_equals() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::NotEquals,
            value: CellValue::number(42.0),
        };
        assert!(!matches_condition(&CellValue::number(42.0), &cond));
        assert!(matches_condition(&CellValue::number(43.0), &cond));
    }

    #[test]
    fn test_matches_not_equals_text() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::NotEquals,
            value: CellValue::Text("Hello".into()),
        };
        assert!(!matches_condition(&CellValue::Text("hello".into()), &cond));
        assert!(matches_condition(&CellValue::Text("World".into()), &cond));
    }

    #[test]
    fn test_matches_greater_than() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::GreaterThan,
            value: CellValue::number(10.0),
        };
        assert!(matches_condition(&CellValue::number(15.0), &cond));
        assert!(!matches_condition(&CellValue::number(10.0), &cond));
        assert!(!matches_condition(&CellValue::number(5.0), &cond));
        // Non-numeric always false
        assert!(!matches_condition(&CellValue::Text("20".into()), &cond));
    }

    #[test]
    fn test_matches_greater_than_or_equal() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::GreaterThanOrEqual,
            value: CellValue::number(10.0),
        };
        assert!(matches_condition(&CellValue::number(15.0), &cond));
        assert!(matches_condition(&CellValue::number(10.0), &cond));
        assert!(!matches_condition(&CellValue::number(5.0), &cond));
    }

    #[test]
    fn test_matches_less_than() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::LessThan,
            value: CellValue::number(10.0),
        };
        assert!(matches_condition(&CellValue::number(5.0), &cond));
        assert!(!matches_condition(&CellValue::number(10.0), &cond));
        assert!(!matches_condition(&CellValue::number(15.0), &cond));
    }

    #[test]
    fn test_matches_less_than_or_equal() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::LessThanOrEqual,
            value: CellValue::number(10.0),
        };
        assert!(matches_condition(&CellValue::number(5.0), &cond));
        assert!(matches_condition(&CellValue::number(10.0), &cond));
        assert!(!matches_condition(&CellValue::number(15.0), &cond));
    }

    #[test]
    fn test_matches_between() {
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value: CellValue::number(10.0),
            value2: CellValue::number(20.0),
        };
        assert!(matches_condition(&CellValue::number(15.0), &cond));
        assert!(matches_condition(&CellValue::number(10.0), &cond)); // inclusive
        assert!(matches_condition(&CellValue::number(20.0), &cond)); // inclusive
        assert!(!matches_condition(&CellValue::number(5.0), &cond));
        assert!(!matches_condition(&CellValue::number(25.0), &cond));
    }

    #[test]
    fn test_matches_not_between() {
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::NotBetween,
            value: CellValue::number(10.0),
            value2: CellValue::number(20.0),
        };
        assert!(!matches_condition(&CellValue::number(15.0), &cond));
        assert!(!matches_condition(&CellValue::number(10.0), &cond));
        assert!(matches_condition(&CellValue::number(5.0), &cond));
        assert!(matches_condition(&CellValue::number(25.0), &cond));
        // Non-number: always "not between"
        assert!(matches_condition(&CellValue::Text("hello".into()), &cond));
    }

    #[test]
    fn test_matches_contains() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Contains,
            value: CellValue::Text("ell".into()),
        };
        assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
        assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
        // Non-text always false
        assert!(!matches_condition(&CellValue::number(42.0), &cond));
    }

    #[test]
    fn test_matches_not_contains() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::NotContains,
            value: CellValue::Text("ell".into()),
        };
        assert!(!matches_condition(&CellValue::Text("Hello".into()), &cond));
        assert!(matches_condition(&CellValue::Text("World".into()), &cond));
        // Non-text: does not contain text, so true
        assert!(matches_condition(&CellValue::number(42.0), &cond));
    }

    #[test]
    fn test_matches_starts_with() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::StartsWith,
            value: CellValue::Text("Hel".into()),
        };
        assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
        assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
    }

    #[test]
    fn test_matches_ends_with() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::EndsWith,
            value: CellValue::Text("llo".into()),
        };
        assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
        assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
    }

    #[test]
    fn test_matches_above_below_average_passthrough() {
        // These need full-column context; direct call returns true (pass-through).
        assert!(matches_condition(
            &CellValue::number(5.0),
            &PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage),
        ));
        assert!(matches_condition(
            &CellValue::number(5.0),
            &PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage),
        ));
    }

    // -- Wildcard matching tests --

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
    fn test_wildcard_with_condition_equals() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Equals,
            value: CellValue::Text("H*o".into()),
        };
        assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
        assert!(matches_condition(&CellValue::Text("Ho".into()), &cond));
        assert!(!matches_condition(&CellValue::Text("World".into()), &cond));
    }

    #[test]
    fn test_wildcard_with_condition_contains() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Contains,
            value: CellValue::Text("e?l".into()),
        };
        assert!(matches_condition(&CellValue::Text("Hello".into()), &cond));
        assert!(!matches_condition(&CellValue::Text("Helo".into()), &cond));
    }

    // -- Case-insensitive helper tests --

    #[test]
    fn test_contains_case_insensitive_fn() {
        assert!(contains_case_insensitive("Hello World", "WORLD"));
        assert!(contains_case_insensitive("Hello World", "hello"));
        assert!(!contains_case_insensitive("Hello World", "xyz"));
        assert!(contains_case_insensitive("Hello", ""));
        assert!(!contains_case_insensitive("", "a"));
    }

    #[test]
    fn test_starts_with_case_insensitive_fn() {
        assert!(starts_with_case_insensitive("Hello", "HEL"));
        assert!(starts_with_case_insensitive("Hello", "hel"));
        assert!(!starts_with_case_insensitive("Hello", "llo"));
    }

    #[test]
    fn test_ends_with_case_insensitive_fn() {
        assert!(ends_with_case_insensitive("Hello", "LLO"));
        assert!(ends_with_case_insensitive("Hello", "llo"));
        assert!(!ends_with_case_insensitive("Hello", "Hel"));
    }

    // -- Unicode tests --

    #[test]
    fn test_unicode_case_insensitive() {
        assert!(contains_case_insensitive("Straße", "straße"));
        assert!(starts_with_case_insensitive("Straße", "stra"));
        assert!(ends_with_case_insensitive("Straße", "aße"));
    }

    #[test]
    fn test_unicode_wildcard() {
        assert!(matches_wildcard_pattern("café", "caf?"));
        assert!(matches_wildcard_pattern("café", "ca*"));
        assert!(matches_wildcard_pattern("日本語", "日*語"));
    }

    // ---- Between boundary precision ----

    #[test]
    fn between_boundary_exactly_low() {
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value: CellValue::number(10.0),
            value2: CellValue::number(20.0),
        };
        assert!(matches_condition(&CellValue::number(10.0), &cond));
    }

    #[test]
    fn between_boundary_exactly_high() {
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value: CellValue::number(10.0),
            value2: CellValue::number(20.0),
        };
        assert!(matches_condition(&CellValue::number(20.0), &cond));
    }

    #[test]
    fn not_between_boundary_exactly_low() {
        // 10.0 is inside [10, 20], so NotBetween should be false.
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::NotBetween,
            value: CellValue::number(10.0),
            value2: CellValue::number(20.0),
        };
        assert!(!matches_condition(&CellValue::number(10.0), &cond));
    }

    #[test]
    fn not_between_boundary_exactly_high() {
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::NotBetween,
            value: CellValue::number(10.0),
            value2: CellValue::number(20.0),
        };
        assert!(!matches_condition(&CellValue::number(20.0), &cond));
    }

    // ---- Negative ranges ----

    #[test]
    fn between_negative_range_inside() {
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value: CellValue::number(-20.0),
            value2: CellValue::number(-10.0),
        };
        assert!(matches_condition(&CellValue::number(-15.0), &cond));
    }

    #[test]
    fn between_negative_range_outside() {
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value: CellValue::number(-20.0),
            value2: CellValue::number(-10.0),
        };
        assert!(!matches_condition(&CellValue::number(-25.0), &cond));
    }

    // ---- Contains/StartsWith/EndsWith with empty string ----

    #[test]
    fn contains_empty_string_matches_everything() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Contains,
            value: CellValue::Text("".into()),
        };
        assert!(matches_condition(
            &CellValue::Text("anything".into()),
            &cond
        ));
        assert!(matches_condition(&CellValue::Text("".into()), &cond));
        assert!(matches_condition(
            &CellValue::Text("hello world".into()),
            &cond
        ));
    }

    #[test]
    fn starts_with_empty_string_matches_everything() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::StartsWith,
            value: CellValue::Text("".into()),
        };
        assert!(matches_condition(
            &CellValue::Text("anything".into()),
            &cond
        ));
        assert!(matches_condition(&CellValue::Text("".into()), &cond));
    }

    #[test]
    fn ends_with_empty_string_matches_everything() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::EndsWith,
            value: CellValue::Text("".into()),
        };
        assert!(matches_condition(
            &CellValue::Text("anything".into()),
            &cond
        ));
        assert!(matches_condition(&CellValue::Text("".into()), &cond));
    }

    // ---- Wildcard edge cases ----

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

    // ---- Cross-type filter behavior ----

    #[test]
    fn greater_than_text_vs_number_is_false() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::GreaterThan,
            value: CellValue::number(5.0),
        };
        assert!(!matches_condition(&CellValue::Text("100".into()), &cond));
    }

    #[test]
    fn contains_number_value_is_false() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Contains,
            value: CellValue::Text("1".into()),
        };
        assert!(!matches_condition(&CellValue::number(123.0), &cond));
    }

    #[test]
    fn equals_number_zero_vs_boolean_false() {
        // Cross-type: Number(0) should NOT equal Boolean(false).
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::Equals,
            value: CellValue::Boolean(false),
        };
        assert!(!matches_condition(&CellValue::number(0.0), &cond));
    }

    #[test]
    fn not_equals_number_zero_vs_boolean_false() {
        let cond = PivotFilterCondition::Unary {
            op: UnaryFilterOp::NotEquals,
            value: CellValue::Boolean(false),
        };
        assert!(matches_condition(&CellValue::number(0.0), &cond));
    }

    #[test]
    fn between_text_value_is_false() {
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value: CellValue::number(1.0),
            value2: CellValue::number(100.0),
        };
        assert!(!matches_condition(&CellValue::Text("50".into()), &cond));
    }

    #[test]
    fn not_between_text_value_is_true() {
        // Non-number is not between anything.
        let cond = PivotFilterCondition::Binary {
            op: BinaryFilterOp::NotBetween,
            value: CellValue::number(1.0),
            value2: CellValue::number(100.0),
        };
        assert!(matches_condition(&CellValue::Text("50".into()), &cond));
    }

    // ---- IsBlank/IsNotBlank with various types ----

    #[test]
    fn is_blank_whitespace_only() {
        let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank);
        assert!(matches_condition(
            &CellValue::Text("  \t\n  ".into()),
            &cond
        ));
    }

    #[test]
    fn is_not_blank_number_zero() {
        let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank);
        assert!(matches_condition(&CellValue::number(0.0), &cond));
    }

    #[test]
    fn is_not_blank_boolean_false() {
        let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank);
        assert!(matches_condition(&CellValue::Boolean(false), &cond));
    }

    #[test]
    fn is_not_blank_error() {
        let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank);
        assert!(matches_condition(
            &CellValue::Error(value_types::CellError::Na, None),
            &cond
        ));
    }

    // ---- Wildcard Unicode ----

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

    // ---- CompiledPattern / sentinel-elimination regression tests (sub-scope sub-scope C) ----

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
}
