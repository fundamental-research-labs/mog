//! Parsing functions for structured references.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file uses byte
//! offsets produced by ASCII-delimiter tests (`[`, `]`, `@`, `#`,
//! `,`, `:`) — the structured-reference grammar uses only ASCII
//! delimiters, and column names inside `[...]` are sliced as whole
//! substrings at ASCII-bracket boundaries. Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use formula_types::{SpecialItem, StructuredRef, StructuredRefSpecifier};

/// Parse a structured reference string into a `StructuredRef`.
///
/// # Errors
///
/// Returns [`ParseError`](crate::parser::ParseError) when the input is empty,
/// missing brackets, or contains malformed structured reference syntax.
///
/// # Examples
///
/// Simple column reference:
///
/// ```
/// use compute_parser::parse_structured_ref;
///
/// let sr = parse_structured_ref("Table1[Column1]").unwrap();
/// assert_eq!(sr.table_name, "Table1");
/// assert_eq!(sr.specifiers.len(), 1);
/// ```
///
/// This-row shorthand with `@`:
///
/// ```
/// use compute_parser::parse_structured_ref;
///
/// let sr = parse_structured_ref("Sales[@Revenue]").unwrap();
/// assert_eq!(sr.table_name, "Sales");
/// assert_eq!(sr.specifiers.len(), 2); // ThisRow + Column
/// ```
///
/// Invalid input returns an error:
///
/// ```
/// use compute_parser::parse_structured_ref;
///
/// assert!(parse_structured_ref("NoColumn").is_err());
/// ```
#[allow(clippy::cast_possible_truncation)] // structured ref lengths are always < u32::MAX
pub fn parse_structured_ref(input: &str) -> Result<StructuredRef, crate::parser::ParseError> {
    use crate::ast::Span;
    use crate::parser::{ParseError, ParseErrorKind};

    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ParseError::new(
            ParseErrorKind::MalformedStructuredRef {
                detail: "empty input".to_string(),
            },
            Span::new(0, input.len() as u32),
        ));
    }

    // Find table name — everything before the first '['
    let first_bracket = trimmed.find('[').ok_or_else(|| {
        ParseError::new(
            ParseErrorKind::MalformedStructuredRef {
                detail: "missing '['".to_string(),
            },
            Span::new(0, input.len() as u32),
        )
    })?;
    if first_bracket == 0 {
        return Err(ParseError::new(
            ParseErrorKind::MalformedStructuredRef {
                detail: "missing table name before '['".to_string(),
            },
            Span::new(0, input.len() as u32),
        ));
    }

    let table_name = trimmed[..first_bracket].trim();
    if !is_valid_table_name(table_name) {
        return Err(ParseError::new(
            ParseErrorKind::MalformedStructuredRef {
                detail: format!("invalid table name '{table_name}'"),
            },
            Span::new(0, first_bracket as u32),
        ));
    }

    // The rest is the bracket expression
    let bracket_expr = &trimmed[first_bracket..];

    // Parse the bracket expression into specifiers
    let specifiers = parse_bracket_expression(bracket_expr).ok_or_else(|| {
        ParseError::new(
            ParseErrorKind::MalformedStructuredRef {
                detail: format!("invalid bracket expression '{bracket_expr}'"),
            },
            Span::new(first_bracket as u32, input.len() as u32),
        )
    })?;

    Ok(StructuredRef {
        table_name: table_name.to_string(),
        specifiers,
    })
}

/// Validate a table name.
///
/// Must start with a letter, underscore, or backslash, followed by letters, digits,
/// underscores, or periods. Spaces are NOT allowed.
#[must_use]
pub fn is_valid_table_name(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() && first != '_' && first != '\\' {
        return false;
    }
    for ch in chars {
        if !ch.is_ascii_alphanumeric() && ch != '_' && ch != '.' {
            return false;
        }
    }
    true
}

/// Reverse escaping in a column name:
///   `''` -> `'`, `]]` -> `]`, `[[` -> `[`
///
/// Also strips surrounding single quotes if present.
#[must_use]
pub fn unescape_column_name(escaped: &str) -> String {
    let trimmed = escaped.trim();
    // Strip surrounding single quotes if present
    let inner = if trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2 {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };
    let mut result = String::with_capacity(inner.len());
    let mut chars = inner.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\'' if chars.peek() == Some(&'\'') => {
                chars.next();
                result.push('\'');
            }
            ']' if chars.peek() == Some(&']') => {
                chars.next();
                result.push(']');
            }
            '[' if chars.peek() == Some(&'[') => {
                chars.next();
                result.push('[');
            }
            _ => result.push(ch),
        }
    }
    result
}

/// Parse the bracket expression portion of a structured reference.
///
/// Handles:
///   `[Column1]`                    -- single column
///   `[@Column1]`                   -- this row + column (@ shorthand)
///   `[#Headers]`                   -- special item
///   `[[#Headers],[Column1]]`       -- combined: special + column
///   `[[#Totals],[Col1]:[Col3]]`    -- combined: special + column range
///   `[[Col1]:[Col3]]`              -- column range
///
/// Returns an empty `Vec` on parse failure.
#[must_use]
#[cfg(any(test, feature = "test-utils"))]
pub fn parse_bracket_content(content: &str) -> Vec<StructuredRefSpecifier> {
    // Delegate to parse_bracket_expression, returning empty vec on failure
    parse_bracket_expression(content).unwrap_or_default()
}

/// Internal: parse bracket expression, returning None on failure.
fn parse_bracket_expression(expr: &str) -> Option<Vec<StructuredRefSpecifier>> {
    // Must start with [ and end with ]
    if !expr.starts_with('[') || !expr.ends_with(']') {
        return None;
    }

    // Remove outer brackets
    let inner = expr[1..expr.len() - 1].trim();
    if inner.is_empty() {
        return None;
    }

    // Case 1: Nested brackets — [[...],[...]] or [[...]:[...]]
    if inner.starts_with('[') {
        return parse_nested_brackets(inner);
    }

    // Case 2: @ shorthand — @Column or @[Column]
    if let Some(after_at) = inner.strip_prefix('@') {
        let col_name = after_at.trim();
        if col_name.is_empty() {
            // Just [@] means this row (entire row)
            return Some(vec![StructuredRefSpecifier::ThisRow]);
        }
        // Strip optional brackets around column name: @[Column] -> Column
        let clean_col = strip_brackets(col_name);
        return Some(vec![
            StructuredRefSpecifier::ThisRow,
            StructuredRefSpecifier::Column {
                name: unescape_column_name(clean_col),
            },
        ]);
    }

    // Case 3: # special item — #Headers, #Data, #Totals, #All, #This Row
    if inner.starts_with('#') {
        let item = parse_special_item(inner)?;
        if item == SpecialItem::ThisRow {
            return Some(vec![StructuredRefSpecifier::ThisRow]);
        }
        return Some(vec![StructuredRefSpecifier::Special { item }]);
    }

    // Case 4: Simple column name
    Some(vec![StructuredRefSpecifier::Column {
        name: unescape_column_name(inner),
    }])
}

/// Parse nested bracket contents: [spec1],[spec2] or [col1]:[col2]
fn parse_nested_brackets(inner: &str) -> Option<Vec<StructuredRefSpecifier>> {
    // Split on top-level commas (not inside brackets)
    let parts = split_top_level(inner, ',');

    let mut specifiers: Vec<StructuredRefSpecifier> = Vec::new();

    for part in &parts {
        let trimmed_part = part.trim();
        if trimmed_part.is_empty() {
            continue;
        }

        // Check if this part contains a column range with ':'
        if let Some(range_spec) = try_parse_column_range(trimmed_part) {
            specifiers.push(range_spec);
            continue;
        }

        // Must be a bracketed item: [#Headers] or [Column1]
        if trimmed_part.starts_with('[') && trimmed_part.ends_with(']') {
            let bracket_inner = trimmed_part[1..trimmed_part.len() - 1].trim();

            if bracket_inner.starts_with('#') {
                let item = parse_special_item(bracket_inner)?;
                if item == SpecialItem::ThisRow {
                    specifiers.push(StructuredRefSpecifier::ThisRow);
                } else {
                    specifiers.push(StructuredRefSpecifier::Special { item });
                }
            } else if let Some(after_at) = bracket_inner.strip_prefix('@') {
                // [@Column] inside nested
                let col_name = after_at.trim();
                specifiers.push(StructuredRefSpecifier::ThisRow);
                if !col_name.is_empty() {
                    specifiers.push(StructuredRefSpecifier::Column {
                        name: unescape_column_name(col_name),
                    });
                }
            } else {
                specifiers.push(StructuredRefSpecifier::Column {
                    name: unescape_column_name(bracket_inner),
                });
            }
        } else {
            // Not bracketed — invalid in nested context
            return None;
        }
    }

    if specifiers.is_empty() {
        None
    } else {
        Some(specifiers)
    }
}

/// Try to parse a column range expression like `[Col1]:[Col3]`.
/// Uses bracket-aware parsing to correctly handle `]]` escape sequences in column names.
fn try_parse_column_range(expr: &str) -> Option<StructuredRefSpecifier> {
    if !expr.starts_with('[') {
        return None;
    }

    // Find end of first bracket group
    let first_end = find_matching_bracket(expr, 0)?;

    // After the first bracket group, expect ':' then '[...]'
    let after_first = expr[first_end + 1..].trim();
    if !after_first.starts_with(':') {
        return None;
    }

    let rest = after_first[1..].trim();
    if !rest.starts_with('[') || !rest.ends_with(']') {
        return None;
    }

    let second_end = find_matching_bracket(rest, 0)?;
    if second_end != rest.len() - 1 {
        return None;
    }

    let col1 = &expr[1..first_end];
    let col2 = &rest[1..second_end];

    Some(StructuredRefSpecifier::ColumnRange {
        start: unescape_column_name(col1.trim()),
        end: unescape_column_name(col2.trim()),
    })
}

/// Find the matching `]` for a `[` at position `start`, accounting for `]]` escape sequences.
/// Returns the index of the matching `]`, or `None` if not found.
///
/// # Safety of byte-level scanning
///
/// This function uses `s.as_bytes()` for performance. This is safe because:
/// - All structural delimiters (`[`, `]`) are ASCII (single byte, 0x00-0x7F)
/// - UTF-8 guarantees that continuation bytes (0x80-0xBF) and leading bytes of
///   multi-byte sequences (0xC0-0xFD) can NEVER equal any ASCII byte
/// - Therefore, `bytes[i] == b']'` can only match an actual `]` character,
///   never a byte within a multi-byte character like `日` (E6 97 A5)
/// - The returned index always points to an ASCII `]`, which is always a valid
///   `str` boundary for slicing
fn find_matching_bracket(s: &str, start: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    if start >= bytes.len() || bytes[start] != b'[' {
        return None;
    }
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == b']' {
            // Check if it's an escape sequence ]]
            if i + 1 < bytes.len() && bytes[i + 1] == b']' {
                i += 2; // Skip the escaped ]]
                continue;
            }
            return Some(i);
        }
        if bytes[i] == b'[' {
            // Check if it's an escape sequence [[
            if i + 1 < bytes.len() && bytes[i + 1] == b'[' {
                i += 2; // Skip the escaped [[
                continue;
            }
            // Nested bracket — shouldn't happen in column names
            return None;
        }
        i += 1;
    }
    None
}

/// Find the matching `]` for a `[` at position `start`, handling nested bracket depth
/// and `]]`/`[[` escape sequences inside single-quoted column names.
///
/// Returns the index of the closing `]`.
///
/// Unlike the internal `find_matching_bracket`, this function correctly handles
/// nested brackets (e.g., `[[#Headers],[Col1]:[Col2]]`) by tracking bracket depth.
/// It also skips `]]` and `[[` pairs when they appear inside single-quoted column
/// names (e.g., `['Col]]Name']`), treating them as escaped literal characters rather
/// than structural brackets.
///
/// # Safety of byte-level scanning
///
/// This function uses `s.as_bytes()` for performance. This is safe because:
/// - All structural delimiters (`[`, `]`) are ASCII (single byte, 0x00-0x7F)
/// - UTF-8 guarantees that continuation bytes (0x80-0xBF) and leading bytes of
///   multi-byte sequences (0xC0-0xFD) can NEVER equal any ASCII byte
/// - Therefore, `bytes[i] == b']'` can only match an actual `]` character,
///   never a byte within a multi-byte character
/// - The returned index always points to an ASCII `]`, which is always a valid
///   `str` boundary for slicing
#[must_use]
pub fn find_outer_matching_bracket(s: &str, start: usize) -> Option<usize> {
    const MAX_BRACKET_DEPTH: u32 = 1024;

    let bytes = s.as_bytes();
    if start >= bytes.len() || bytes[start] != b'[' {
        return None;
    }
    let mut depth: u32 = 1;
    let mut i = start + 1;
    let mut in_quote = false;
    while i < bytes.len() {
        if bytes[i] == b'\'' {
            in_quote = !in_quote;
            i += 1;
            continue;
        }
        if in_quote {
            // Inside single quotes: treat ]] and [[ as escape sequences
            if bytes[i] == b']' && i + 1 < bytes.len() && bytes[i + 1] == b']' {
                i += 2; // Skip escaped ]]
                continue;
            }
            if bytes[i] == b'[' && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
                i += 2; // Skip escaped [[
                continue;
            }
            i += 1;
            continue;
        }
        // Outside quotes: treat [ and ] as structural
        if bytes[i] == b']' {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        } else if bytes[i] == b'[' {
            depth += 1;
            if depth > MAX_BRACKET_DEPTH {
                return None;
            }
        }
        i += 1;
    }
    None
}

/// Split a string on a delimiter, but only at the top level (not inside brackets).
///
/// Handles `[[` and `]]` escape sequences, and correctly processes multi-byte UTF-8
/// characters (the delimiters `[`, `]`, `,` are all ASCII, so byte-level checks are
/// safe for them, but non-ASCII content must be pushed as full characters).
fn split_top_level(s: &str, delimiter: char) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut depth: u32 = 0;
    let mut current = String::new();
    let bytes = s.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // Handle [[ and ]] escape sequences (ASCII so byte-safe)
        if i + 1 < bytes.len() {
            if bytes[i] == b'[' && bytes[i + 1] == b'[' {
                current.push('[');
                current.push('[');
                i += 2;
                continue;
            }
            if bytes[i] == b']' && bytes[i + 1] == b']' {
                current.push(']');
                current.push(']');
                i += 2;
                continue;
            }
        }

        match bytes[i] {
            b'[' => {
                depth += 1;
                current.push('[');
                i += 1;
            }
            b']' => {
                if depth == 0 {
                    // Malformed input: unmatched ']' — stop parsing
                    break;
                }
                depth -= 1;
                current.push(']');
                i += 1;
            }
            b if b == delimiter as u8 && depth == 0 => {
                parts.push(std::mem::take(&mut current));
                i += 1;
            }
            _ => {
                // For non-ASCII bytes, decode the full character
                if bytes[i] < 0x80 {
                    current.push(bytes[i] as char);
                    i += 1;
                } else {
                    // Multi-byte UTF-8: decode the character
                    let rest = &s[i..];
                    if let Some(ch) = rest.chars().next() {
                        current.push(ch);
                        i += ch.len_utf8();
                    } else {
                        i += 1; // skip invalid byte
                    }
                }
            }
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

/// Parse a special item keyword (after the `#` prefix).
fn parse_special_item(text: &str) -> Option<SpecialItem> {
    // Remove # prefix and match case-insensitively without allocating
    match text[1..].trim() {
        s if s.eq_ignore_ascii_case("all") => Some(SpecialItem::All),
        s if s.eq_ignore_ascii_case("data") => Some(SpecialItem::Data),
        s if s.eq_ignore_ascii_case("headers") => Some(SpecialItem::Headers),
        s if s.eq_ignore_ascii_case("totals") => Some(SpecialItem::Totals),
        s if s.eq_ignore_ascii_case("this row") => Some(SpecialItem::ThisRow),
        _ => None,
    }
}

/// Strip surrounding brackets from a string if present.
fn strip_brackets(s: &str) -> &str {
    if s.starts_with('[') && s.ends_with(']') {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Unicode column names ────────────────────────────────────────────

    #[test]
    fn test_unicode_japanese_column_name() {
        let result = parse_structured_ref("Table1[日本語]");
        assert!(result.is_ok(), "Should parse Japanese column name");
        let sr = result.unwrap();
        assert_eq!(sr.table_name, "Table1");
        assert_eq!(sr.specifiers.len(), 1);
        match &sr.specifiers[0] {
            StructuredRefSpecifier::Column { name } => assert_eq!(name, "日本語"),
            other => panic!("Expected Column, got {other:?}"),
        }
    }

    #[test]
    fn test_unicode_french_column_name() {
        let result = parse_structured_ref("Table1[Données]");
        assert!(result.is_ok());
        let sr = result.unwrap();
        match &sr.specifiers[0] {
            StructuredRefSpecifier::Column { name } => assert_eq!(name, "Données"),
            other => panic!("Expected Column, got {other:?}"),
        }
    }

    #[test]
    fn test_unicode_spanish_column_name() {
        let result = parse_structured_ref("Table1[Ñoño]");
        assert!(result.is_ok());
        let sr = result.unwrap();
        match &sr.specifiers[0] {
            StructuredRefSpecifier::Column { name } => assert_eq!(name, "Ñoño"),
            other => panic!("Expected Column, got {other:?}"),
        }
    }

    #[test]
    fn test_unicode_column_range_with_specifier() {
        let result = parse_structured_ref("Table1[[#Headers],[données]:[résultat]]");
        assert!(
            result.is_ok(),
            "Should parse Unicode column range with specifier"
        );
        let sr = result.unwrap();
        assert_eq!(sr.table_name, "Table1");
        assert_eq!(sr.specifiers.len(), 2);
        assert_eq!(
            sr.specifiers[0],
            StructuredRefSpecifier::Special {
                item: SpecialItem::Headers
            }
        );
        match &sr.specifiers[1] {
            StructuredRefSpecifier::ColumnRange { start, end } => {
                assert_eq!(start, "données");
                assert_eq!(end, "résultat");
            }
            other => panic!("Expected ColumnRange, got {other:?}"),
        }
    }

    #[test]
    fn test_unicode_emoji_column_name() {
        let result = parse_structured_ref("Table1[📊 Revenue]");
        assert!(result.is_ok(), "Should parse emoji column name");
        let sr = result.unwrap();
        match &sr.specifiers[0] {
            StructuredRefSpecifier::Column { name } => assert_eq!(name, "📊 Revenue"),
            other => panic!("Expected Column, got {other:?}"),
        }
    }

    #[test]
    fn test_unicode_cyrillic_column_name() {
        let result = parse_structured_ref("Table1[Данные]");
        assert!(result.is_ok());
        let sr = result.unwrap();
        match &sr.specifiers[0] {
            StructuredRefSpecifier::Column { name } => assert_eq!(name, "Данные"),
            other => panic!("Expected Column, got {other:?}"),
        }
    }

    #[test]
    fn test_unicode_mixed_with_brackets() {
        // Column name with Unicode AND the @ shorthand
        let result = parse_structured_ref("Table1[@données]");
        assert!(result.is_ok());
        let sr = result.unwrap();
        assert_eq!(sr.specifiers.len(), 2);
        assert_eq!(sr.specifiers[0], StructuredRefSpecifier::ThisRow);
        match &sr.specifiers[1] {
            StructuredRefSpecifier::Column { name } => assert_eq!(name, "données"),
            other => panic!("Expected Column, got {other:?}"),
        }
    }

    #[test]
    fn test_unicode_chinese_traditional() {
        let result = parse_structured_ref("Table1[銷售額]");
        assert!(result.is_ok());
        let sr = result.unwrap();
        match &sr.specifiers[0] {
            StructuredRefSpecifier::Column { name } => assert_eq!(name, "銷售額"),
            other => panic!("Expected Column, got {other:?}"),
        }
    }

    // ── find_matching_bracket with Unicode ──────────────────────────────

    #[test]
    fn test_find_matching_bracket_unicode_content() {
        // [日本語] — 3 chars × 3 bytes each = 9 bytes between brackets
        let s = "[日本語]";
        assert_eq!(find_matching_bracket(s, 0), Some(s.len() - 1));
    }

    #[test]
    fn test_find_outer_matching_bracket_unicode_nested() {
        // [[données]:[résultat]] — nested brackets with Unicode
        let s = "[[données]:[résultat]]";
        let result = find_outer_matching_bracket(s, 0);
        assert_eq!(result, Some(s.len() - 1));
    }

    // ── split_top_level with Unicode ────────────────────────────────────

    #[test]
    fn test_split_top_level_unicode_between_brackets() {
        let result = split_top_level("[données],[résultat]", ',');
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "[données]");
        assert_eq!(result[1], "[résultat]");
    }

    #[test]
    fn test_split_top_level_unicode_with_emoji() {
        let result = split_top_level("[📊 Revenue],[💰 Profit]", ',');
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "[📊 Revenue]");
        assert_eq!(result[1], "[💰 Profit]");
    }

    #[test]
    fn test_split_top_level_mixed_ascii_unicode() {
        let result = split_top_level("[Name],[名前],[Nom]", ',');
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], "[Name]");
        assert_eq!(result[1], "[名前]");
        assert_eq!(result[2], "[Nom]");
    }
}
