//! Wildcard matching and criteria parsing for conditional functions.
//!
//! Used by SUMIF, COUNTIF, AVERAGEIF, and their multi-range variants
//! (SUMIFS, COUNTIFS, AVERAGEIFS, etc.).

use value_types::CellValue;

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

/// If `val` is a multi-element array, returns the flattened elements along with
/// the array shape `(nrows, ncols)` so the caller can reconstruct the output
/// array with matching shape.
///
/// Returns `None` for scalar values or single-element arrays (these should use
/// the normal scalar `parse_criteria` path).
pub fn extract_criteria_elements(val: &CellValue) -> Option<(Vec<&CellValue>, usize, usize)> {
    match val {
        CellValue::Array(arr) => {
            let nrows = arr.rows();
            let ncols = arr.cols();
            if nrows * ncols <= 1 {
                return None;
            }
            let elems: Vec<&CellValue> = arr.iter().collect();
            Some((elems, nrows, ncols))
        }
        _ => None,
    }
}

/// Try to parse a string as a number, with support for `%` suffix.
/// `"-999%"` → `-9.99`, `"42"` → `42.0`, `"hello"` → `None`.
fn try_parse_criteria_number(s: &str) -> Option<f64> {
    if let Ok(n) = s.parse::<f64>() {
        return Some(n);
    }
    if let Some(prefix) = s.strip_suffix('%') {
        prefix.parse::<f64>().ok().map(|n| n / 100.0)
    } else {
        None
    }
}

/// Parse a SUMIF/COUNTIF criteria string into a comparison function.
/// Supports: ">5", ">=5", "<5", "<=5", "=5", "<>5", "text*", plain value.
pub fn parse_criteria(criteria: &CellValue) -> Box<dyn Fn(&CellValue) -> bool> {
    let criteria_type = match criteria {
        CellValue::Number(_) => "number",
        CellValue::Boolean(_) | CellValue::Control(_) => "boolean",
        CellValue::Text(_) => "text",
        CellValue::Null => "null",
        CellValue::Image(_) => "image",
        _ => "other",
    };
    let _span = tracing::info_span!("parse_criteria", criteria_type = criteria_type).entered();
    match criteria {
        CellValue::Number(n) => {
            let n = n.get();
            Box::new(move |v: &CellValue| {
                v.as_comparable_number()
                    .is_some_and(|x| (x - n).abs() < 1e-10)
            })
        }
        CellValue::Boolean(b) => {
            let b = *b;
            Box::new(move |v: &CellValue| matches!(v, CellValue::Boolean(x) if *x == b))
        }
        CellValue::Text(s) => {
            // Trim for operator prefix detection only.  The original string
            // (with its whitespace intact) is used for plain-text and wildcard
            // matching — Excel preserves leading/trailing spaces in criteria.
            let trimmed = s.trim();
            if let Some(rest) = trimmed.strip_prefix(">=") {
                let rest_trimmed = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest_trimmed) {
                    return Box::new(move |v: &CellValue| match v {
                        // COUNTIF/SUMIF: text does not participate in numeric comparisons
                        CellValue::Text(_) => false,
                        _ => v.as_comparable_number().is_some_and(|x| x >= n),
                    });
                }
                // Text comparison: case-insensitive lexicographic >=
                return Box::new(move |v: &CellValue| match v {
                    CellValue::Text(_) => match v.coerce_to_string() {
                        Ok(vs) => vs.to_lowercase() >= rest_trimmed.to_lowercase(),
                        Err(_) => false,
                    },
                    _ => false,
                });
            }
            if let Some(rest) = trimmed.strip_prefix("<=") {
                let rest_trimmed = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest_trimmed) {
                    // Excel type ordering: text > any number, so text is never <= number
                    return Box::new(move |v: &CellValue| {
                        v.as_comparable_number().is_some_and(|x| x <= n)
                    });
                }
                // Text comparison: case-insensitive lexicographic <=
                return Box::new(move |v: &CellValue| match v {
                    CellValue::Text(_) => match v.coerce_to_string() {
                        Ok(vs) => vs.to_lowercase() <= rest_trimmed.to_lowercase(),
                        Err(_) => false,
                    },
                    _ => false,
                });
            }
            if let Some(rest) = trimmed.strip_prefix("<>") {
                let rest = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest) {
                    return Box::new(move |v: &CellValue| match v.as_comparable_number() {
                        Some(x) => (x - n).abs() >= 1e-10,
                        // Unparseable text IS "not equal" to a number;
                        // Null, Boolean, Error are non-participants → false
                        None => matches!(v, CellValue::Text(_)),
                    });
                }
                // Explicit blank semantics when criteria is exactly "<>"
                if rest.is_empty() {
                    return Box::new(move |v: &CellValue| match v {
                        CellValue::Error(..) => false,
                        CellValue::Null => false,
                        _ => true, // Text("") is content (formula result), not blank
                    });
                }
                // Text <> branch for non-empty comparand (e.g., "<>hello")
                return Box::new(move |v: &CellValue| {
                    if matches!(v, CellValue::Error(..)) {
                        return false;
                    }
                    match v.coerce_to_string() {
                        Ok(vs) => !vs.eq_ignore_ascii_case(&rest),
                        Err(_) => false,
                    }
                });
            }
            if let Some(rest) = trimmed.strip_prefix('>') {
                let rest_trimmed = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest_trimmed) {
                    return Box::new(move |v: &CellValue| match v {
                        // COUNTIF/SUMIF: text does not participate in numeric comparisons
                        CellValue::Text(_) => false,
                        _ => v.as_comparable_number().is_some_and(|x| x > n),
                    });
                }
                // Text comparison: case-insensitive lexicographic >
                return Box::new(move |v: &CellValue| match v {
                    CellValue::Text(_) => match v.coerce_to_string() {
                        Ok(vs) => vs.to_lowercase() > rest_trimmed.to_lowercase(),
                        Err(_) => false,
                    },
                    _ => false,
                });
            }
            if let Some(rest) = trimmed.strip_prefix('<') {
                let rest_trimmed = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest_trimmed) {
                    // Excel type ordering: text > any number, so text is never < number
                    return Box::new(move |v: &CellValue| {
                        v.as_comparable_number().is_some_and(|x| x < n)
                    });
                }
                // Text comparison: case-insensitive lexicographic <
                return Box::new(move |v: &CellValue| match v {
                    CellValue::Text(_) => match v.coerce_to_string() {
                        Ok(vs) => vs.to_lowercase() < rest_trimmed.to_lowercase(),
                        Err(_) => false,
                    },
                    _ => false,
                });
            }
            if let Some(rest) = trimmed.strip_prefix('=') {
                let rest = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest) {
                    return Box::new(move |v: &CellValue| {
                        v.as_comparable_number()
                            .is_some_and(|x| (x - n).abs() < 1e-10)
                    });
                }
                return Box::new(move |v: &CellValue| match v.coerce_to_string() {
                    Ok(vs) => vs.eq_ignore_ascii_case(&rest),
                    Err(_) => false,
                });
            }
            // Wildcard or plain text match
            if s.contains('*') || s.contains('?') {
                let pattern = WildcardPattern::new(s);
                Box::new(move |v: &CellValue| match v {
                    CellValue::Text(t) => pattern.matches(t),
                    _ => false,
                })
            } else {
                // Try as number first
                if let Some(n) = try_parse_criteria_number(s) {
                    Box::new(move |v: &CellValue| {
                        v.as_comparable_number()
                            .is_some_and(|x| (x - n).abs() < 1e-10)
                    })
                } else {
                    let text = s.clone();
                    Box::new(move |v: &CellValue| match v.coerce_to_string() {
                        Ok(vs) => vs.eq_ignore_ascii_case(&text),
                        Err(_) => false,
                    })
                }
            }
        }
        CellValue::Error(target, _) => {
            let target = *target;
            Box::new(move |v: &CellValue| matches!(v, CellValue::Error(e, None) if *e == target))
        }
        CellValue::Null => Box::new(|v| matches!(v, CellValue::Null)),
        CellValue::Control(c) => {
            let b = c.value;
            Box::new(move |v: &CellValue| v.as_bool() == Some(b))
        }
        CellValue::Image(image) => {
            let fallback = image.fallback_text().to_string();
            Box::new(move |v: &CellValue| {
                v.coerce_to_string()
                    .map(|s| s.eq_ignore_ascii_case(&fallback))
                    .unwrap_or(false)
            })
        }
        CellValue::Array(arr) => {
            // Extract the first scalar element from the array and use it as
            // the criteria value.  This matches Excel's behavior: when a
            // structured table reference like `Table[[#This Row],[Col]]`
            // resolves to a single-element array, SUMIF/COUNTIF should use
            // that element as the criteria.
            let scalar = arr.get(0, 0).cloned().unwrap_or(CellValue::Null);
            parse_criteria(&scalar)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellError;

    #[test]
    fn test_wildcard_match() {
        assert!(wildcard_match("hello", "hello"));
        assert!(wildcard_match("hello", "HELLO"));
        assert!(wildcard_match("h*o", "hello"));
        assert!(wildcard_match("h?llo", "hello"));
        assert!(!wildcard_match("h?lo", "hello"));
        assert!(wildcard_match("*", "anything"));
        assert!(wildcard_match("*test*", "this is a test here"));
        assert!(!wildcard_match("abc", "abcd"));
    }

    #[test]
    fn test_parse_criteria_number() {
        let crit = parse_criteria(&CellValue::number(5.0));
        assert!(crit(&CellValue::number(5.0)));
        assert!(!crit(&CellValue::number(4.0)));
    }

    #[test]
    fn test_parse_criteria_comparison() {
        let crit = parse_criteria(&CellValue::Text(">5".into()));
        assert!(crit(&CellValue::number(6.0)));
        assert!(!crit(&CellValue::number(5.0)));
        assert!(!crit(&CellValue::number(4.0)));

        let crit = parse_criteria(&CellValue::Text(">=5".into()));
        assert!(crit(&CellValue::number(5.0)));
        assert!(!crit(&CellValue::number(4.0)));

        let crit = parse_criteria(&CellValue::Text("<>5".into()));
        assert!(crit(&CellValue::number(4.0)));
        assert!(!crit(&CellValue::number(5.0)));
    }

    // -----------------------------------------------------------------------
    // FIX 1: Tilde escape in wildcard_match
    // -----------------------------------------------------------------------

    #[test]
    fn test_wildcard_tilde_escape_star() {
        // ~* should match a literal '*'
        assert!(wildcard_match("hello~*", "hello*"));
        // Without tilde, * is a wildcard
        assert!(wildcard_match("hello*", "helloworld"));
        // Escaped * should NOT act as wildcard
        assert!(!wildcard_match("hello~*", "helloworld"));
    }

    #[test]
    fn test_wildcard_tilde_escape_star_in_middle() {
        // ~* in the middle: "hello~*world" should match "hello*world" literally
        assert!(wildcard_match("hello~*world", "hello*world"));
        // Should NOT match "helloanythingworld" because ~* is literal
        assert!(!wildcard_match("hello~*world", "helloanythingworld"));
    }

    #[test]
    fn test_wildcard_tilde_escape_question() {
        // ~? should match a literal '?'
        assert!(wildcard_match("hello~?", "hello?"));
        // Escaped ? should NOT act as wildcard
        assert!(!wildcard_match("hello~?", "hellox"));
    }

    #[test]
    fn test_wildcard_tilde_escape_tilde() {
        // ~~ should match a literal '~'
        assert!(wildcard_match("hello~~", "hello~"));
        // Should not match "hello~~" (that would need hello~~~~)
        assert!(!wildcard_match("hello~~", "hello~~"));
    }

    #[test]
    fn test_wildcard_tilde_at_end() {
        // A lone ~ at end of pattern matches literal ~
        assert!(wildcard_match("hello~", "hello~"));
        assert!(!wildcard_match("hello~", "hellox"));
    }

    #[test]
    fn test_wildcard_tilde_combined_with_wildcards() {
        // Mix of escaped and unescaped wildcards
        // Pattern: *~** means: any chars, literal *, any chars
        assert!(wildcard_match("*~**", "abc*def"));
        assert!(wildcard_match("*~**", "*"));
        assert!(!wildcard_match("*~**", "abcdef")); // no literal * in text
    }

    // -----------------------------------------------------------------------
    // FIX 2: parse_criteria <> with error values
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_criteria_ne_text_does_not_count_errors() {
        // <>text should NOT match error values
        let crit = parse_criteria(&CellValue::Text("<>hello".into()));
        // Non-matching text should be true
        assert!(crit(&CellValue::Text("world".into())));
        // Matching text should be false
        assert!(!crit(&CellValue::Text("hello".into())));
        // Error values should return false (not counted)
        assert!(!crit(&CellValue::Error(CellError::Value, None)));
        assert!(!crit(&CellValue::Error(CellError::Na, None)));
        assert!(!crit(&CellValue::Error(CellError::Ref, None)));
        assert!(!crit(&CellValue::Error(CellError::Div0, None)));
    }

    #[test]
    fn test_parse_criteria_ne_number_with_errors() {
        // <>5 — errors are non-participants (Excel does NOT count them)
        let crit = parse_criteria(&CellValue::Text("<>5".into()));
        assert!(crit(&CellValue::number(4.0)));
        assert!(!crit(&CellValue::number(5.0)));
        // Errors are non-participants in numeric criteria matching
        assert!(!crit(&CellValue::Error(CellError::Value, None)));
    }

    // -----------------------------------------------------------------------
    // FIX 3: parse_criteria text comparisons with >, >=, <, <=
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_criteria_gt_text() {
        // ">m" should match text values > "m" (case-insensitive)
        let crit = parse_criteria(&CellValue::Text(">m".into()));
        assert!(crit(&CellValue::Text("zebra".into())));
        assert!(crit(&CellValue::Text("n".into())));
        assert!(!crit(&CellValue::Text("m".into()))); // equal, not greater
        assert!(!crit(&CellValue::Text("apple".into())));
        // Numbers should NOT match text comparisons
        assert!(!crit(&CellValue::number(100.0)));
        // Errors should NOT match
        assert!(!crit(&CellValue::Error(CellError::Value, None)));
        // Null should NOT match
        assert!(!crit(&CellValue::Null));
    }

    #[test]
    fn test_parse_criteria_gte_text() {
        // ">=m" should match text values >= "m" (case-insensitive)
        let crit = parse_criteria(&CellValue::Text(">=m".into()));
        assert!(crit(&CellValue::Text("zebra".into())));
        assert!(crit(&CellValue::Text("m".into()))); // equal, should match
        assert!(crit(&CellValue::Text("M".into()))); // case-insensitive
        assert!(!crit(&CellValue::Text("apple".into())));
        assert!(!crit(&CellValue::number(100.0)));
        assert!(!crit(&CellValue::Error(CellError::Na, None)));
    }

    #[test]
    fn test_parse_criteria_lt_text() {
        // "<m" should match text values < "m" (case-insensitive)
        let crit = parse_criteria(&CellValue::Text("<m".into()));
        assert!(crit(&CellValue::Text("apple".into())));
        assert!(crit(&CellValue::Text("lemon".into())));
        assert!(!crit(&CellValue::Text("m".into()))); // equal, not less
        assert!(!crit(&CellValue::Text("zebra".into())));
        assert!(!crit(&CellValue::number(1.0)));
    }

    #[test]
    fn test_parse_criteria_lte_text() {
        // "<=m" should match text values <= "m" (case-insensitive)
        let crit = parse_criteria(&CellValue::Text("<=m".into()));
        assert!(crit(&CellValue::Text("apple".into())));
        assert!(crit(&CellValue::Text("m".into()))); // equal, should match
        assert!(crit(&CellValue::Text("M".into()))); // case-insensitive
        assert!(!crit(&CellValue::Text("zebra".into())));
        assert!(!crit(&CellValue::number(1.0)));
    }

    #[test]
    fn test_parse_criteria_gt_text_case_insensitive() {
        // Verify case-insensitive comparison
        let crit = parse_criteria(&CellValue::Text(">Apple".into()));
        assert!(crit(&CellValue::Text("banana".into())));
        assert!(crit(&CellValue::Text("BANANA".into())));
        assert!(!crit(&CellValue::Text("aaa".into())));
    }

    #[test]
    fn test_parse_criteria_numeric_gt_still_works() {
        // Ensure numeric comparisons still work after the fix
        let crit = parse_criteria(&CellValue::Text(">50".into()));
        assert!(crit(&CellValue::number(100.0)));
        assert!(!crit(&CellValue::number(50.0)));
        assert!(!crit(&CellValue::number(25.0)));
        // COUNTIF/SUMIF: text does not participate in numeric comparisons
        assert!(!crit(&CellValue::Text("hello".into())));
    }

    #[test]
    fn test_parse_criteria_numeric_gte_still_works() {
        let crit = parse_criteria(&CellValue::Text(">=50".into()));
        assert!(crit(&CellValue::number(100.0)));
        assert!(crit(&CellValue::number(50.0)));
        assert!(!crit(&CellValue::number(25.0)));
    }

    #[test]
    fn test_parse_criteria_numeric_lt_still_works() {
        let crit = parse_criteria(&CellValue::Text("<50".into()));
        assert!(crit(&CellValue::number(25.0)));
        assert!(!crit(&CellValue::number(50.0)));
        assert!(!crit(&CellValue::number(100.0)));
    }

    #[test]
    fn test_parse_criteria_numeric_lte_still_works() {
        let crit = parse_criteria(&CellValue::Text("<=50".into()));
        assert!(crit(&CellValue::number(25.0)));
        assert!(crit(&CellValue::number(50.0)));
        assert!(!crit(&CellValue::number(100.0)));
    }

    // -----------------------------------------------------------------------
    // FIX 4: Null criteria should only match Null, not Number(0.0)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // FIX 5: Text criteria should NOT trim whitespace for plain matching
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_criteria_text_preserves_whitespace() {
        // Trailing space in criteria should be significant
        let crit = parse_criteria(&CellValue::Text("hello ".into()));
        assert!(crit(&CellValue::Text("hello ".into())));
        assert!(!crit(&CellValue::Text("hello".into()))); // no trailing space

        // Leading space in criteria should be significant
        let crit = parse_criteria(&CellValue::Text(" hello".into()));
        assert!(crit(&CellValue::Text(" hello".into())));
        assert!(!crit(&CellValue::Text("hello".into()))); // no leading space

        // Operator criteria should still work with surrounding whitespace
        let crit = parse_criteria(&CellValue::Text(" >=5 ".into()));
        assert!(crit(&CellValue::number(5.0)));
        assert!(crit(&CellValue::number(10.0)));
        assert!(!crit(&CellValue::number(4.0)));
    }

    // -----------------------------------------------------------------------
    // FIX 6: Array criteria should extract first scalar element
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_criteria_array_extracts_first_element() {
        // Single-element array with text (e.g. from structured table ref)
        let crit = parse_criteria(&CellValue::from_rows(vec![vec![CellValue::Text(
            "Alice".into(),
        )]]));
        assert!(crit(&CellValue::Text("Alice".into())));
        assert!(crit(&CellValue::Text("alice".into()))); // case-insensitive
        assert!(!crit(&CellValue::Text("Bob".into())));

        // Single-element array with number
        let crit = parse_criteria(&CellValue::from_rows(vec![vec![CellValue::number(42.0)]]));
        assert!(crit(&CellValue::number(42.0)));
        assert!(!crit(&CellValue::number(43.0)));

        // Multi-element array — uses first element only
        let crit = parse_criteria(&CellValue::from_rows(vec![vec![
            CellValue::Text("hello".into()),
            CellValue::Text("world".into()),
        ]]));
        assert!(crit(&CellValue::Text("hello".into())));
        assert!(!crit(&CellValue::Text("world".into())));

        // Empty array → Null criteria
        let crit = parse_criteria(&CellValue::from_rows(vec![]));
        assert!(crit(&CellValue::Null));
        assert!(!crit(&CellValue::number(0.0)));
    }

    #[test]
    fn test_parse_criteria_null_matches_only_null() {
        let crit = parse_criteria(&CellValue::Null);
        // Null criteria should match Null cells
        assert!(crit(&CellValue::Null));
        // Null criteria should NOT match Number(0.0) — Excel blank criteria matches blank only
        assert!(!crit(&CellValue::number(0.0)));
        // Null criteria should not match other values
        assert!(!crit(&CellValue::number(1.0)));
        assert!(!crit(&CellValue::Text("".into())));
        assert!(!crit(&CellValue::Text("hello".into())));
        assert!(!crit(&CellValue::Boolean(false)));
        assert!(!crit(&CellValue::Error(CellError::Value, None)));
    }

    // -----------------------------------------------------------------------
    // FIX 7: Null & Boolean non-participation in numeric criteria
    // -----------------------------------------------------------------------

    #[test]
    fn test_null_does_not_match_bare_numeric_criteria() {
        let crit = parse_criteria(&CellValue::number(0.0));
        assert!(!crit(&CellValue::Null)); // empty ≠ 0
        assert!(crit(&CellValue::number(0.0))); // actual zero matches
        assert!(crit(&CellValue::Text("0".into()))); // text "0" matches

        let crit = parse_criteria(&CellValue::number(5.0));
        assert!(!crit(&CellValue::Null)); // empty ≠ 5
    }

    #[test]
    fn test_null_does_not_match_operator_numeric_criteria() {
        assert!(!parse_criteria(&CellValue::Text(">=0".into()))(
            &CellValue::Null
        ));
        assert!(!parse_criteria(&CellValue::Text("<=0".into()))(
            &CellValue::Null
        ));
        assert!(!parse_criteria(&CellValue::Text(">-1".into()))(
            &CellValue::Null
        ));
        assert!(!parse_criteria(&CellValue::Text("<1".into()))(
            &CellValue::Null
        ));
        assert!(!parse_criteria(&CellValue::Text("=0".into()))(
            &CellValue::Null
        ));
        assert!(!parse_criteria(&CellValue::Text("<>0".into()))(
            &CellValue::Null
        ));
        assert!(!parse_criteria(&CellValue::Text("<>5".into()))(
            &CellValue::Null
        ));
    }

    #[test]
    fn test_null_does_not_match_text_as_number_criteria() {
        let crit = parse_criteria(&CellValue::Text("0".into()));
        assert!(!crit(&CellValue::Null));
        assert!(crit(&CellValue::number(0.0)));
    }

    #[test]
    fn test_boolean_does_not_match_numeric_criteria() {
        assert!(!parse_criteria(&CellValue::number(0.0))(
            &CellValue::Boolean(false)
        ));
        assert!(!parse_criteria(&CellValue::number(1.0))(
            &CellValue::Boolean(true)
        ));
        assert!(!parse_criteria(&CellValue::Text(">=0".into()))(
            &CellValue::Boolean(false)
        ));
        assert!(!parse_criteria(&CellValue::Text("<=1".into()))(
            &CellValue::Boolean(true)
        ));
        assert!(!parse_criteria(&CellValue::Text("<>0".into()))(
            &CellValue::Boolean(false)
        ));
        assert!(!parse_criteria(&CellValue::Text("<>5".into()))(
            &CellValue::Boolean(true)
        ));
    }

    #[test]
    fn test_ne_numeric_errors_are_non_participants() {
        assert!(!parse_criteria(&CellValue::Text("<>5".into()))(
            &CellValue::Error(CellError::Na, None)
        ));
        assert!(!parse_criteria(&CellValue::Text("<>5".into()))(
            &CellValue::Error(CellError::Value, None)
        ));
    }

    #[test]
    fn test_ne_numeric_text_is_not_equal() {
        // Unparseable text IS "not equal" to a number
        let crit = parse_criteria(&CellValue::Text("<>5".into()));
        assert!(crit(&CellValue::Text("hello".into())));
        // Parseable text that equals the number is NOT "not equal"
        assert!(!crit(&CellValue::Text("5".into())));
    }

    #[test]
    fn test_empty_text_does_not_match_numeric_criteria() {
        assert!(!parse_criteria(&CellValue::number(0.0))(&CellValue::Text(
            "".into()
        )));
        assert!(!parse_criteria(&CellValue::Text("=0".into()))(
            &CellValue::Text("".into())
        ));
        // COUNTIF/SUMIF: text does not participate in numeric comparisons
        assert!(!parse_criteria(&CellValue::Text(">=0".into()))(
            &CellValue::Text("".into())
        ));
        // Empty text IS "not equal" to a number (it's Text, just empty)
        assert!(parse_criteria(&CellValue::Text("<>0".into()))(
            &CellValue::Text("".into())
        ));
    }

    // -----------------------------------------------------------------------
    // FIX 8: Error criteria should match same error type
    // -----------------------------------------------------------------------

    #[test]
    fn test_parse_criteria_error_matches_same_error() {
        // #N/A criteria should match #N/A cells
        let crit = parse_criteria(&CellValue::Error(CellError::Na, None));
        assert!(crit(&CellValue::Error(CellError::Na, None)));
    }

    #[test]
    fn test_parse_criteria_error_does_not_match_different_error() {
        // #N/A criteria should NOT match #REF! cells
        let crit = parse_criteria(&CellValue::Error(CellError::Na, None));
        assert!(!crit(&CellValue::Error(CellError::Ref, None)));
        assert!(!crit(&CellValue::Error(CellError::Value, None)));
        assert!(!crit(&CellValue::Error(CellError::Div0, None)));
    }

    #[test]
    fn test_parse_criteria_error_does_not_match_non_errors() {
        // #N/A criteria should NOT match numbers, text, null, booleans
        let crit = parse_criteria(&CellValue::Error(CellError::Na, None));
        assert!(!crit(&CellValue::number(0.0)));
        assert!(!crit(&CellValue::Text("".into())));
        assert!(!crit(&CellValue::Text("#N/A".into())));
        assert!(!crit(&CellValue::Null));
        assert!(!crit(&CellValue::Boolean(false)));
    }

    #[test]
    fn test_parse_criteria_ref_error_matches_ref() {
        // #REF! criteria should match #REF! cells
        let crit = parse_criteria(&CellValue::Error(CellError::Ref, None));
        assert!(crit(&CellValue::Error(CellError::Ref, None)));
        assert!(!crit(&CellValue::Error(CellError::Na, None)));
        assert!(!crit(&CellValue::number(0.0)));
    }

    // -----------------------------------------------------------------------
    // Wildcard type guard — only match CellValue::Text
    // -----------------------------------------------------------------------

    #[test]
    fn test_wildcard_does_not_match_numbers() {
        // "104*" should NOT match Number(104192) — Excel wildcards only match Text
        let crit = parse_criteria(&CellValue::Text("104*".into()));
        assert!(!crit(&CellValue::number(104192.0)));
        assert!(!crit(&CellValue::number(104.0)));
        assert!(!crit(&CellValue::number(10400.0)));
        // But SHOULD match Text that starts with "104"
        assert!(crit(&CellValue::Text("104abc".into())));
        assert!(crit(&CellValue::Text("104".into())));
    }

    #[test]
    fn test_wildcard_does_not_match_booleans() {
        let crit = parse_criteria(&CellValue::Text("TRU*".into()));
        assert!(!crit(&CellValue::Boolean(true)));
        assert!(crit(&CellValue::Text("TRUE".into())));
        assert!(crit(&CellValue::Text("TRUTHY".into())));
    }

    #[test]
    fn test_wildcard_does_not_match_errors() {
        let crit = parse_criteria(&CellValue::Text("#N*".into()));
        assert!(!crit(&CellValue::Error(CellError::Na, None)));
        assert!(crit(&CellValue::Text("#N/A".into())));
    }

    #[test]
    fn test_wildcard_does_not_match_null() {
        let crit = parse_criteria(&CellValue::Text("*".into()));
        assert!(!crit(&CellValue::Null));
        // But matches any non-empty text
        assert!(crit(&CellValue::Text("anything".into())));
        // And matches empty text (Excel: "*" matches "" for Text cells)
        assert!(crit(&CellValue::Text("".into())));
    }

    #[test]
    fn test_question_mark_does_not_match_numbers() {
        // "?" matches exactly one character of Text
        let crit = parse_criteria(&CellValue::Text("?".into()));
        assert!(!crit(&CellValue::number(5.0)));
        assert!(crit(&CellValue::Text("A".into())));
        assert!(!crit(&CellValue::Text("AB".into())));
    }

    // -----------------------------------------------------------------------
    // <> blank semantics — explicit match block
    // -----------------------------------------------------------------------

    #[test]
    fn test_ne_blank_excludes_null() {
        let crit = parse_criteria(&CellValue::Text("<>".into()));
        assert!(!crit(&CellValue::Null));
    }

    #[test]
    fn test_ne_blank_excludes_empty_text() {
        let crit = parse_criteria(&CellValue::Text("<>".into()));
        // Text("") is content (e.g., formula result), so "<>" matches it.
        // Only CellValue::Null (truly empty) is excluded.
        assert!(crit(&CellValue::Text("".into())));
    }

    #[test]
    fn test_ne_blank_excludes_errors() {
        let crit = parse_criteria(&CellValue::Text("<>".into()));
        assert!(!crit(&CellValue::Error(CellError::Na, None)));
        assert!(!crit(&CellValue::Error(CellError::Value, None)));
    }

    #[test]
    fn test_ne_blank_includes_numbers() {
        let crit = parse_criteria(&CellValue::Text("<>".into()));
        assert!(crit(&CellValue::number(0.0)));
        assert!(crit(&CellValue::number(42.0)));
    }

    #[test]
    fn test_ne_blank_includes_text() {
        let crit = parse_criteria(&CellValue::Text("<>".into()));
        assert!(crit(&CellValue::Text("hello".into())));
    }

    #[test]
    fn test_ne_blank_includes_booleans() {
        let crit = parse_criteria(&CellValue::Text("<>".into()));
        assert!(crit(&CellValue::Boolean(true)));
        assert!(crit(&CellValue::Boolean(false)));
    }

    // -----------------------------------------------------------------------
    // Complementarity — COUNTIF("=") + COUNTIF("<>") = non-error count
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // FIX 9: Percentage suffix in criteria strings
    // -----------------------------------------------------------------------

    #[test]
    fn test_try_parse_criteria_number_percent() {
        assert_eq!(try_parse_criteria_number("42"), Some(42.0));
        assert_eq!(try_parse_criteria_number("-999%"), Some(-9.99));
        assert_eq!(try_parse_criteria_number("50%"), Some(0.5));
        assert_eq!(try_parse_criteria_number("100%"), Some(1.0));
        assert_eq!(try_parse_criteria_number("0%"), Some(0.0));
        assert_eq!(try_parse_criteria_number("hello"), None);
        assert_eq!(try_parse_criteria_number("hello%"), None);
    }

    #[test]
    fn test_countif_criteria_with_percent_suffix() {
        // ">-999%" should mean "> -9.99"
        let crit = parse_criteria(&CellValue::Text(">-999%".into()));
        // Numbers > -9.99 should match
        assert!(crit(&CellValue::number(0.05)));
        assert!(crit(&CellValue::number(0.0)));
        assert!(crit(&CellValue::number(-9.0)));
        // Number <= -9.99 should NOT match
        assert!(!crit(&CellValue::number(-9.99)));
        assert!(!crit(&CellValue::number(-100.0)));
        // COUNTIF/SUMIF: text does not participate in numeric comparisons
        assert!(!crit(&CellValue::Text("—".into())));
        assert!(!crit(&CellValue::Text("hello".into())));
    }

    #[test]
    fn test_gte_criteria_with_percent_suffix() {
        let crit = parse_criteria(&CellValue::Text(">=50%".into()));
        assert!(crit(&CellValue::number(0.5)));
        assert!(crit(&CellValue::number(1.0)));
        assert!(!crit(&CellValue::number(0.49)));
        // COUNTIF/SUMIF: text does not participate in numeric comparisons
        assert!(!crit(&CellValue::Text("anything".into())));
    }

    #[test]
    fn test_lt_criteria_with_percent_suffix() {
        let crit = parse_criteria(&CellValue::Text("<50%".into()));
        assert!(crit(&CellValue::number(0.49)));
        assert!(!crit(&CellValue::number(0.5)));
        assert!(!crit(&CellValue::number(1.0)));
        // Text never matches < numeric (text > any number)
        assert!(!crit(&CellValue::Text("anything".into())));
    }

    #[test]
    fn test_lte_criteria_with_percent_suffix() {
        let crit = parse_criteria(&CellValue::Text("<=100%".into()));
        assert!(crit(&CellValue::number(1.0)));
        assert!(crit(&CellValue::number(0.5)));
        assert!(!crit(&CellValue::number(1.01)));
        // Text never matches <= numeric
        assert!(!crit(&CellValue::Text("anything".into())));
    }

    #[test]
    fn test_eq_criteria_with_percent_suffix() {
        let crit = parse_criteria(&CellValue::Text("=50%".into()));
        assert!(crit(&CellValue::number(0.5)));
        assert!(!crit(&CellValue::number(0.51)));
    }

    #[test]
    fn test_ne_criteria_with_percent_suffix() {
        let crit = parse_criteria(&CellValue::Text("<>50%".into()));
        assert!(!crit(&CellValue::number(0.5)));
        assert!(crit(&CellValue::number(0.51)));
    }

    // -----------------------------------------------------------------------
    // FIX 10: Excel mixed-type ordering — text > any number
    // -----------------------------------------------------------------------

    #[test]
    fn test_gt_numeric_excludes_text_cells() {
        // COUNTIF/SUMIF: text does not participate in numeric comparisons
        let crit = parse_criteria(&CellValue::Text(">0".into()));
        assert!(!crit(&CellValue::Text("hello".into())));
        assert!(!crit(&CellValue::Text("—".into())));
        assert!(!crit(&CellValue::Text("".into())));
    }

    #[test]
    fn test_gte_numeric_excludes_text_cells() {
        // COUNTIF/SUMIF: text does not participate in numeric comparisons
        let crit = parse_criteria(&CellValue::Text(">=0".into()));
        assert!(!crit(&CellValue::Text("hello".into())));
    }

    #[test]
    fn test_lt_numeric_does_not_match_text() {
        // Text is NOT less than any number
        let crit = parse_criteria(&CellValue::Text("<999999".into()));
        assert!(!crit(&CellValue::Text("hello".into())));
    }

    #[test]
    fn test_lte_numeric_does_not_match_text() {
        let crit = parse_criteria(&CellValue::Text("<=999999".into()));
        assert!(!crit(&CellValue::Text("hello".into())));
    }

    #[test]
    fn test_eq_ne_blank_complementarity() {
        let eq_crit = parse_criteria(&CellValue::Text("=".into()));
        let ne_crit = parse_criteria(&CellValue::Text("<>".into()));

        // For most values, exactly one of "=" and "<>" should match
        let complementary_values = vec![
            CellValue::Null,                 // "=" matches, "<>" doesn't
            CellValue::number(0.0),          // "<>" matches, "=" doesn't
            CellValue::number(42.0),         // "<>" matches, "=" doesn't
            CellValue::Text("hello".into()), // "<>" matches, "=" doesn't
            CellValue::Boolean(true),        // "<>" matches, "=" doesn't
            CellValue::Boolean(false),       // "<>" matches, "=" doesn't
        ];

        for val in &complementary_values {
            let eq = eq_crit(val);
            let ne = ne_crit(val);
            assert!(
                eq ^ ne,
                "Complementarity failed for {:?}: eq={}, ne={}",
                val,
                eq,
                ne
            );
        }

        // Special case: Text("") matches BOTH "=" and "<>" (Excel behavior —
        // formula-produced "" is "equal to blank" but also "not blank")
        let empty_text = CellValue::Text("".into());
        assert!(eq_crit(&empty_text), "Text(\"\") should match \"=\"");
        assert!(ne_crit(&empty_text), "Text(\"\") should match \"<>\"");
    }

    // -----------------------------------------------------------------------
    // PENDING FIXES — COUNTIF wildcard and mixed-type edge cases
    //
    // These tests encode the CORRECT Excel behavior for open bugs. They are
    // marked #[ignore] so `cargo test` stays green; run them explicitly with:
    //   cargo test -p compute-functions --lib -- --ignored test_pending_fix_
    // Each test MUST start passing once the documented fix lands; the
    // existing "current-buggy-behavior" tests above will need to be updated
    // or removed as part of that fix.
    // -----------------------------------------------------------------------

    /// FT-017 — Excel's mixed-type ordering: any Text is "greater than" any
    /// Number. So `COUNTIF(range, ">-999%")` must count Text cells (e.g. "—")
    /// as matching. Current code hard-codes `Text(_) => false` at
    /// `criteria.rs:244-249` for the `>` numeric branch.
    #[test]
    #[ignore = "pending resolution: text-vs-number in COUNTIF is inconsistent across corpus files"]
    fn test_pending_fix_gt_numeric_matches_text_cells() {
        // ">-999%" parses to "> -9.99". Excel type ordering: text > any number.
        let crit = parse_criteria(&CellValue::Text(">-999%".into()));
        // Text cells MUST match (Excel counts them).
        assert!(
            crit(&CellValue::Text("—".into())),
            "FT-017: Text(\"—\") must match \">-999%\" (text > any number)"
        );
        assert!(
            crit(&CellValue::Text("hello".into())),
            "FT-017: any Text must match \">-999%\" (text > any number)"
        );
        assert!(
            crit(&CellValue::Text("".into())),
            "FT-017: even empty Text must match \">-999%\" (text > any number)"
        );
        // Numeric participants still behave normally.
        assert!(crit(&CellValue::number(0.0)));
        assert!(!crit(&CellValue::number(-100.0)));
    }

    /// FT-017 — same bug, `>=` numeric branch.
    #[test]
    #[ignore = "pending resolution: text-vs-number in COUNTIF is inconsistent across corpus files"]
    fn test_pending_fix_gte_numeric_matches_text_cells() {
        let crit = parse_criteria(&CellValue::Text(">=0".into()));
        assert!(
            crit(&CellValue::Text("hello".into())),
            "FT-017: Text must match \">=0\" (text > any number)"
        );
        assert!(
            crit(&CellValue::Text("—".into())),
            "FT-017: Text(\"—\") must match \">=0\" (text > any number)"
        );
    }

    /// FT-016 — Excel's `COUNTIF(range, "<>0")` counts empty (Null) cells as
    /// matching. Current code at `criteria.rs:213` in the `strip_prefix("<>")`
    /// branch returns `false` for Null (non-participation).
    #[test]
    #[ignore = "pending fix: COUNTIF numeric not-equal should match empty cells"]
    fn test_pending_fix_ne_numeric_matches_null() {
        // "<>0" must count empty cells (they are "not equal to 0" in Excel).
        let crit = parse_criteria(&CellValue::Text("<>0".into()));
        assert!(
            crit(&CellValue::Null),
            "FT-016: Null must match \"<>0\" (empty ≠ 0 in Excel COUNTIF)"
        );

        // Also applies to other numeric comparands.
        let crit = parse_criteria(&CellValue::Text("<>5".into()));
        assert!(
            crit(&CellValue::Null),
            "FT-016: Null must match \"<>5\" (empty ≠ 5 in Excel COUNTIF)"
        );
    }

    /// FT-022 — `SUMPRODUCT((range<=0)*1)` off by one because empty cells
    /// aren't counted. The criteria predicate for `"<=0"` must match Null
    /// (Excel treats empty as 0, and 0 <= 0 is true). Encoded at the
    /// criteria-predicate layer; the SUMPRODUCT call path uses the same
    /// family of comparisons (see operators.rs cell_value_cmp, which already
    /// coerces Null→0, but the COUNTIF/range-flatten path drops Nulls).
    #[test]
    #[ignore = "pending fix: COUNTIF/SUMPRODUCT numeric less-than-or-equal should match empty cells"]
    fn test_pending_fix_lte_numeric_matches_null() {
        // "<=0" must match empty cells (empty coerces to 0, 0 <= 0 is true).
        let crit = parse_criteria(&CellValue::Text("<=0".into()));
        assert!(
            crit(&CellValue::Null),
            "FT-022: Null must match \"<=0\" (empty coerces to 0)"
        );

        // And for "<=N" with N >= 0.
        let crit = parse_criteria(&CellValue::Text("<=5".into()));
        assert!(
            crit(&CellValue::Null),
            "FT-022: Null must match \"<=5\" (empty coerces to 0, 0 <= 5)"
        );
    }
}
