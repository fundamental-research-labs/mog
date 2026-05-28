use value_types::CellValue;

/// Returns true if the criteria value can use exact-match frequency lookup.
///
/// Returns false for:
/// - Text with operator prefixes (`>`, `<`, `=`, `<>`, `>=`, `<=`)
/// - Text containing unescaped wildcards (`*`, `?`)
/// - Text "TRUE"/"FALSE" (cross-type boolean matching not handled by NormalizedKey)
pub fn is_exact_match_criteria(criteria: &CellValue) -> bool {
    match criteria {
        CellValue::Text(s) => {
            let trimmed = s.trim();
            if trimmed.starts_with(">=")
                || trimmed.starts_with("<=")
                || trimmed.starts_with("<>")
                || trimmed.starts_with('>')
                || trimmed.starts_with('<')
                || trimmed.starts_with('=')
            {
                return false;
            }
            if has_unescaped_wildcard(s) {
                return false;
            }
            if trimmed.eq_ignore_ascii_case("TRUE") || trimmed.eq_ignore_ascii_case("FALSE") {
                return false;
            }
            true
        }
        CellValue::Number(_)
        | CellValue::Boolean(_)
        | CellValue::Control(_)
        | CellValue::Image(_)
        | CellValue::Null
        | CellValue::Error(..) => true,
        CellValue::Array(arr) => match arr.get(0, 0) {
            Some(inner) => is_exact_match_criteria(inner),
            None => true,
        },
    }
}

/// Check if a string contains unescaped `*` or `?` wildcards.
/// Tilde (`~`) escapes the next character: `~*` is literal `*`.
pub(super) fn has_unescaped_wildcard(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '~' {
            i += 2;
        } else if chars[i] == '*' || chars[i] == '?' {
            return true;
        } else {
            i += 1;
        }
    }
    false
}
