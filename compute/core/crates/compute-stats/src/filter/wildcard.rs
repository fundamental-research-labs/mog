/// Returns `true` if the pattern contains unescaped wildcard characters (`*` or `?`).
///
/// Tilde (`~`) is the escape character: `~*` is a literal `*`, `~?` is a literal `?`,
/// and `~~` is a literal `~`. A lone `*` or `?` not preceded by `~` is a wildcard.
///
/// Iterates over chars directly without collecting into a `Vec<char>`.
#[inline]
pub(super) fn has_wildcards(pattern: &str) -> bool {
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
    pub(super) tokens: Vec<WildcardToken>,
    /// `true` iff every `Literal` in `tokens` is ASCII. Enables the ASCII
    /// fast-path in [`CompiledPattern::matches`].
    pub(super) all_ascii: bool,
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
