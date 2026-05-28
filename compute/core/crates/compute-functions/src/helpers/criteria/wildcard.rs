/// Pre-compiled wildcard pattern for efficient repeated matching.
///
/// The pattern is lowercased and split into chars once at construction time.
/// When both pattern and text are ASCII, matching is zero-allocation (compares
/// bytes directly with inline `to_ascii_lowercase`). Non-ASCII text falls back
/// to `to_lowercase()` + `Vec<char>`.
pub struct WildcardPattern {
    chars: Vec<char>,
    all_ascii: bool,
}

impl WildcardPattern {
    /// Compile a wildcard pattern (lowercased once, reusable for many matches).
    pub fn new(pattern: &str) -> Self {
        let chars: Vec<char> = pattern.to_lowercase().chars().collect();
        let all_ascii = chars.iter().all(|c| c.is_ascii());
        Self { chars, all_ascii }
    }

    /// Test whether `text` matches this wildcard pattern (case-insensitive).
    pub fn matches(&self, text: &str) -> bool {
        if self.all_ascii && text.is_ascii() {
            wildcard_match_ascii(&self.chars, text.as_bytes())
        } else {
            let t: Vec<char> = text.to_lowercase().chars().collect();
            wildcard_match_chars(&self.chars, &t)
        }
    }
}

/// Simple wildcard pattern matching for SUMIF/COUNTIF criteria.
/// Supports `*` (any chars) and `?` (single char).
///
/// Prefer [`WildcardPattern::new`] + [`WildcardPattern::matches`] when the
/// same pattern is compared against many texts (avoids re-lowercasing the
/// pattern on every call).
pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    WildcardPattern::new(pattern).matches(text)
}

// -- ASCII fast path (zero allocation) --

fn wildcard_match_ascii(pattern: &[char], text: &[u8]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }
    if pattern[0] == '~' {
        if pattern.len() > 1 && matches!(pattern[1], '*' | '?' | '~') {
            if text.is_empty() || text[0].to_ascii_lowercase() != pattern[1] as u8 {
                return false;
            }
            return wildcard_match_ascii(&pattern[2..], &text[1..]);
        }
        if text.is_empty() || text[0] != b'~' {
            return false;
        }
        return wildcard_match_ascii(&pattern[1..], &text[1..]);
    }
    if pattern[0] == '*' {
        for i in 0..=text.len() {
            if wildcard_match_ascii(&pattern[1..], &text[i..]) {
                return true;
            }
        }
        false
    } else if text.is_empty() {
        false
    } else if pattern[0] == '?' || pattern[0] as u8 == text[0].to_ascii_lowercase() {
        wildcard_match_ascii(&pattern[1..], &text[1..])
    } else {
        false
    }
}

// -- Unicode fallback (same algorithm as before, on &[char]) --

fn wildcard_match_chars(pattern: &[char], text: &[char]) -> bool {
    if pattern.is_empty() {
        return text.is_empty();
    }
    if pattern[0] == '~' {
        if pattern.len() > 1 && matches!(pattern[1], '*' | '?' | '~') {
            if text.is_empty() || text[0] != pattern[1] {
                return false;
            }
            return wildcard_match_chars(&pattern[2..], &text[1..]);
        }
        if text.is_empty() || text[0] != '~' {
            return false;
        }
        return wildcard_match_chars(&pattern[1..], &text[1..]);
    }
    if pattern[0] == '*' {
        for i in 0..=text.len() {
            if wildcard_match_chars(&pattern[1..], &text[i..]) {
                return true;
            }
        }
        false
    } else if text.is_empty() {
        false
    } else if pattern[0] == '?' || pattern[0] == text[0] {
        wildcard_match_chars(&pattern[1..], &text[1..])
    } else {
        false
    }
}
