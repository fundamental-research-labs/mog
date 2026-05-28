/// Case-insensitive `contains` that avoids `to_lowercase()` allocation
/// when both strings are ASCII.
pub(super) fn contains_case_insensitive(haystack: &str, needle: &str) -> bool {
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
pub(super) fn starts_with_case_insensitive(s: &str, prefix: &str) -> bool {
    if s.is_ascii() && prefix.is_ascii() {
        s.as_bytes()
            .get(..prefix.len())
            .is_some_and(|slice| slice.eq_ignore_ascii_case(prefix.as_bytes()))
    } else {
        s.to_lowercase().starts_with(&prefix.to_lowercase())
    }
}

/// Case-insensitive `ends_with` that avoids allocation for ASCII.
pub(super) fn ends_with_case_insensitive(s: &str, suffix: &str) -> bool {
    if s.is_ascii() && suffix.is_ascii() {
        let sb = s.as_bytes();
        let xb = suffix.as_bytes();
        sb.len() >= xb.len() && sb[sb.len() - xb.len()..].eq_ignore_ascii_case(xb)
    } else {
        s.to_lowercase().ends_with(&suffix.to_lowercase())
    }
}
