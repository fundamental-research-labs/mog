// Formula scans split only at ASCII syntax bytes and preserve UTF-8 character copies.
#![allow(clippy::string_slice)]

use std::borrow::Cow;

use crate::ast::needs_quoting;

use super::scan::{skip_double_quoted, skip_single_quoted};

/// Normalize a formula string for user/agent input.
///
/// Applies Excel-compatible on-entry corrections:
/// 1. Auto-quote sheet names containing special characters
/// 2. Auto-close unmatched trailing parentheses
/// 3. Strip unnecessary quotes from simple sheet names
/// 4. Uppercase cell reference column letters
///
/// Called before `parse_formula()` so the parser sees valid, canonical syntax.
/// The normalized string is what gets stored in `formula_strings` and returned
/// by `getFormula()`, matching Excel's behavior of storing the corrected form.
///
/// # Examples
///
/// Auto-close trailing parentheses:
///
/// ```
/// use compute_parser::normalize_formula_input;
///
/// let result = normalize_formula_input("=SUM(A1:B10", &[]);
/// assert_eq!(result, "=SUM(A1:B10)");
/// ```
///
/// Uppercase cell reference column letters:
///
/// ```
/// use compute_parser::normalize_formula_input;
///
/// let result = normalize_formula_input("=sum(a1:b10)", &[]);
/// assert_eq!(result, "=sum(A1:B10)");
/// ```
///
/// Auto-quote sheet names with special characters:
///
/// ```
/// use compute_parser::normalize_formula_input;
///
/// let result = normalize_formula_input("=D&A_BUILD!A1", &["D&A_BUILD"]);
/// assert_eq!(result, "='D&A_BUILD'!A1");
/// ```
#[must_use]
pub fn normalize_formula_input(formula: &str, sheet_names: &[&str]) -> String {
    if !formula.starts_with('=') {
        return formula.to_string();
    }

    // Order matters: quote before paren-close (quoting may add chars that
    // affect paren counting), strip-unnecessary-quotes last (cosmetic).
    let quoted = auto_quote_sheet_names(formula, sheet_names);
    let closed = auto_close_parentheses(&quoted);
    let stripped = strip_unnecessary_sheet_quotes(&closed);
    let uppercased = uppercase_cell_references(&stripped);

    uppercased.into_owned()
}

/// Auto-quote unquoted sheet name references in a formula string.
///
/// Given known sheet names, finds `D&A_BUILD!A1` and rewrites to `'D&A_BUILD'!A1`.
/// Only rewrites names that need quoting, aren't already quoted, and are followed by `!`.
/// Names sorted longest-first to prevent partial matches.
/// Case-insensitive matching (Excel normalizes case on entry).
/// Left-boundary check prevents false matches on suffixes.
pub(super) fn auto_quote_sheet_names<'a>(formula: &'a str, sheet_names: &[&str]) -> Cow<'a, str> {
    // Filter to only names that need quoting, sort longest-first
    let mut quotable: Vec<&str> = sheet_names
        .iter()
        .copied()
        .filter(|n| needs_quoting(n))
        .collect();
    if quotable.is_empty() {
        return Cow::Borrowed(formula);
    }
    quotable.sort_by_key(|b| std::cmp::Reverse(b.len()));

    let bytes = formula.as_bytes();
    let len = bytes.len();
    let mut out = String::with_capacity(len + 16);
    let mut i = 0;

    while i < len {
        // Skip double-quoted strings
        if bytes[i] == b'"' {
            out.push('"');
            i += 1;
            while i < len {
                if bytes[i] == b'"' {
                    out.push('"');
                    i += 1;
                    if i < len && bytes[i] == b'"' {
                        out.push('"');
                        i += 1;
                    } else {
                        break;
                    }
                } else if let Some(ch) = formula[i..].chars().next() {
                    out.push(ch);
                    i += ch.len_utf8();
                }
            }
            continue;
        }

        // Skip single-quoted sheet names (already quoted)
        if bytes[i] == b'\'' {
            out.push('\'');
            i += 1;
            while i < len {
                if bytes[i] == b'\'' {
                    out.push('\'');
                    i += 1;
                    if i < len && bytes[i] == b'\'' {
                        out.push('\'');
                        i += 1;
                    } else {
                        break;
                    }
                } else if let Some(ch) = formula[i..].chars().next() {
                    // Handle multi-byte UTF-8 characters
                    out.push(ch);
                    i += ch.len_utf8();
                }
            }
            continue;
        }

        // Left-boundary check: preceding char must not be alphanumeric or underscore
        let at_boundary = if i == 0 || i == 1 {
            // Position 0 is '=', position 1 is always a boundary
            true
        } else {
            let prev = bytes[i - 1];
            !prev.is_ascii_alphanumeric() && prev != b'_'
        };

        if at_boundary {
            // Try to match each quotable sheet name at this position
            let mut matched = false;
            for &name in &quotable {
                let name_len = name.len();
                if i + name_len < len
                    && bytes[i + name_len] == b'!'
                    && formula[i..i + name_len].eq_ignore_ascii_case(name)
                {
                    // Match found — emit quoted form, preserving user's original casing
                    let user_text = &formula[i..i + name_len];
                    let escaped = user_text.replace('\'', "''");
                    out.push('\'');
                    out.push_str(&escaped);
                    out.push('\'');
                    i += name_len;
                    matched = true;
                    break;
                }
            }
            if matched {
                continue;
            }
        }

        // No match — emit current character
        if let Some(ch) = formula[i..].chars().next() {
            out.push(ch);
            i += ch.len_utf8();
        }
    }

    Cow::Owned(out)
}

/// Auto-close unmatched trailing parentheses in a formula.
///
/// Counts open/close parens outside of string literals. If there are more
/// opens than closes, appends the missing `)` characters at the end.
///
/// Only closes TRAILING missing parens (the common typo). Does NOT attempt to fix
/// extra closing parens or mismatched parens in the middle.
///
/// Returns `Cow::Borrowed` when parens are already balanced (zero allocation).
pub(super) fn auto_close_parentheses(formula: &str) -> Cow<'_, str> {
    if !formula.starts_with('=') {
        return Cow::Borrowed(formula);
    }

    let mut depth: i32 = 0;
    let bytes = formula.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    // Safety: we only match ASCII bytes (0x22, 0x27, 0x28, 0x29) which cannot
    // appear as continuation bytes in valid UTF-8, so byte-level iteration is correct.
    while i < len {
        match bytes[i] {
            b'"' => {
                i = skip_double_quoted(bytes, i + 1);
            }
            b'\'' => {
                i = skip_single_quoted(bytes, i + 1);
            }
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth -= 1;
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }

    if depth > 0 {
        let mut result = formula.to_string();
        for _ in 0..depth {
            result.push(')');
        }
        Cow::Owned(result)
    } else {
        Cow::Borrowed(formula)
    }
}

/// Strip unnecessary single quotes from sheet references where the name
/// contains only `[a-zA-Z_][a-zA-Z0-9_]*` characters.
///
/// `='Sheet1'!A1` → `=Sheet1!A1`  (quotes unnecessary)
/// `='D&A'!A1` → `='D&A'!A1`     (quotes required, unchanged)
///
/// Returns `Cow::Borrowed` when no unnecessary quotes are found (zero allocation).
pub(super) fn strip_unnecessary_sheet_quotes(formula: &str) -> Cow<'_, str> {
    if !formula.starts_with('=') {
        return Cow::Borrowed(formula);
    }

    // Quick check: if there are no single quotes, nothing to strip.
    if !formula.contains('\'') {
        return Cow::Borrowed(formula);
    }

    // Scan to see if any single-quoted sheet name has unnecessary quotes.
    // If none do, we can skip allocation entirely.
    if !has_strippable_sheet_quotes(formula) {
        return Cow::Borrowed(formula);
    }

    let bytes = formula.as_bytes();
    let len = bytes.len();
    let mut out = String::with_capacity(len);
    let mut i = 0;

    while i < len {
        // Skip double-quoted strings
        if bytes[i] == b'"' {
            let end = skip_double_quoted(bytes, i + 1);
            out.push_str(&formula[i..end]);
            i = end;
            continue;
        }

        // Check for single-quoted sheet name followed by !
        if bytes[i] == b'\'' {
            // Extract the name between quotes
            let start = i + 1;
            let mut j = start;
            let mut name = String::new();
            let mut has_escaped_quotes = false;
            while j < len {
                if bytes[j] == b'\'' {
                    if j + 1 < len && bytes[j + 1] == b'\'' {
                        // Escaped single quote
                        name.push('\'');
                        has_escaped_quotes = true;
                        j += 2;
                    } else {
                        // End of quoted name
                        break;
                    }
                } else if let Some(ch) = formula[j..].chars().next() {
                    name.push(ch);
                    j += ch.len_utf8();
                }
            }

            // j points to the closing quote
            if j < len && bytes[j] == b'\'' && j + 1 < len && bytes[j + 1] == b'!' {
                // Check if the name actually needs quoting
                if !has_escaped_quotes && !needs_quoting(&name) {
                    // Doesn't need quotes — emit bare name
                    out.push_str(&name);
                    i = j + 1; // skip past closing quote, the ! will be emitted next iteration
                    continue;
                }
            }

            // Needs quotes or not followed by ! — emit as-is
            out.push('\'');
            i += 1;
            continue;
        }

        if let Some(ch) = formula[i..].chars().next() {
            out.push(ch);
            i += ch.len_utf8();
        }
    }

    Cow::Owned(out)
}

/// Uppercase column letters in cell references.
///
/// `=a1+b2` → `=A1+B2`
/// `=sum(a1:b10)` → `=sum(A1:B10)`  (function names handled by parser)
/// `="hello a1"` → `="hello a1"`    (strings untouched)
///
/// Only uppercases patterns matching cell references: 1-3 letters followed by
/// 1-7 digits, with boundary checks. Does NOT uppercase function names.
///
/// Returns `Cow::Borrowed` when all cell references are already uppercase (zero allocation).
pub(super) fn uppercase_cell_references(formula: &str) -> Cow<'_, str> {
    if !formula.starts_with('=') {
        return Cow::Borrowed(formula);
    }

    // Quick check: if there are no lowercase ASCII letters outside of string
    // literals that could be part of a cell reference, skip allocation.
    if !has_lowercase_cell_refs(formula) {
        return Cow::Borrowed(formula);
    }

    let bytes = formula.as_bytes();
    let len = bytes.len();
    let mut out = Vec::with_capacity(len);
    let mut i = 0;

    while i < len {
        // Skip double-quoted strings
        if bytes[i] == b'"' {
            let end = skip_double_quoted(bytes, i + 1);
            out.extend_from_slice(&bytes[i..end]);
            i = end;
            continue;
        }

        // Skip single-quoted sheet names
        if bytes[i] == b'\'' {
            let end = skip_single_quoted(bytes, i + 1);
            out.extend_from_slice(&bytes[i..end]);
            i = end;
            continue;
        }

        // Check for $ prefix (absolute reference)
        let dollar_start = i;
        let mut ci = i;
        if ci < len && bytes[ci] == b'$' {
            ci += 1;
        }

        // Try to match [a-zA-Z]{1,3}
        let letter_start = ci;
        while ci < len && bytes[ci].is_ascii_alphabetic() && ci - letter_start < 3 {
            ci += 1;
        }
        let letter_count = ci - letter_start;

        if letter_count > 0 && letter_count <= 3 {
            // Skip optional $ before row
            let mut ri = ci;
            if ri < len && bytes[ri] == b'$' {
                ri += 1;
            }

            // Try to match [0-9]{1,7}
            let digit_start = ri;
            while ri < len && bytes[ri].is_ascii_digit() && ri - digit_start < 7 {
                ri += 1;
            }
            let digit_count = ri - digit_start;

            if digit_count > 0 {
                // Check left boundary: must not be preceded by alphanumeric or underscore
                let left_ok = if dollar_start == 0 {
                    true
                } else {
                    let prev = bytes[dollar_start - 1];
                    !prev.is_ascii_alphanumeric() && prev != b'_'
                };

                // Check right boundary: must not be followed by alphanumeric or underscore
                let right_ok = if ri >= len {
                    true
                } else {
                    let next = bytes[ri];
                    !next.is_ascii_alphabetic() && next != b'_'
                };

                if left_ok && right_ok {
                    // Emit everything from dollar_start to letter_start as-is
                    out.extend_from_slice(&bytes[dollar_start..letter_start]);
                    // Uppercase the letters
                    for b in &bytes[letter_start..letter_start + letter_count] {
                        out.push(b.to_ascii_uppercase());
                    }
                    // Emit $ + digits as-is
                    out.extend_from_slice(&bytes[letter_start + letter_count..ri]);
                    i = ri;
                    continue;
                }
            }
        }

        // No cell reference match — emit current byte
        out.push(bytes[i]);
        i += 1;
    }

    // Safety: we only manipulated ASCII bytes, preserving all multi-byte sequences
    // from the skip-string paths. But to be safe:
    Cow::Owned(String::from_utf8(out).expect("ASCII operations preserve UTF-8 validity"))
}

/// Quick scan: returns `true` if there is at least one single-quoted sheet
/// reference whose quotes are unnecessary (i.e. the name inside doesn't
/// actually need quoting).  Used by `strip_unnecessary_sheet_quotes` to
/// short-circuit when no work is needed.
pub(super) fn has_strippable_sheet_quotes(formula: &str) -> bool {
    let bytes = formula.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'"' {
            i = skip_double_quoted(bytes, i + 1);
            continue;
        }
        if bytes[i] == b'\'' {
            // Extract the name between quotes to check if it needs quoting.
            let start = i + 1;
            let mut j = start;
            let mut has_escaped = false;
            while j < len {
                if bytes[j] == b'\'' {
                    if j + 1 < len && bytes[j + 1] == b'\'' {
                        has_escaped = true;
                        j += 2;
                    } else {
                        break;
                    }
                } else {
                    j += 1;
                }
            }
            // j is at closing quote (or len if unterminated)
            if j < len && bytes[j] == b'\'' && j + 1 < len && bytes[j + 1] == b'!' && !has_escaped {
                let name = &formula[start..j];
                if !needs_quoting(name) {
                    return true; // found one that can be stripped
                }
            }
            i = if j < len { j + 1 } else { j };
            continue;
        }
        i += 1;
    }
    false
}

/// Quick scan: returns `true` if the formula contains any lowercase letter
/// outside string literals that could be part of a cell reference (letter(s)
/// followed by digit(s) with boundary checks).  Used by
/// `uppercase_cell_references` to short-circuit.
pub(super) fn has_lowercase_cell_refs(formula: &str) -> bool {
    let bytes = formula.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'"' {
            i = skip_double_quoted(bytes, i + 1);
            continue;
        }
        if bytes[i] == b'\'' {
            i = skip_single_quoted(bytes, i + 1);
            continue;
        }

        // Check for a potential lowercase cell reference at this position.
        let start = i;
        let mut ci = i;
        if ci < len && bytes[ci] == b'$' {
            ci += 1;
        }

        let letter_start = ci;
        while ci < len && bytes[ci].is_ascii_alphabetic() && ci - letter_start < 3 {
            ci += 1;
        }
        let letter_count = ci - letter_start;

        if letter_count > 0 && letter_count <= 3 {
            let mut ri = ci;
            if ri < len && bytes[ri] == b'$' {
                ri += 1;
            }
            let digit_start = ri;
            while ri < len && bytes[ri].is_ascii_digit() && ri - digit_start < 7 {
                ri += 1;
            }
            if ri - digit_start > 0 {
                // boundary checks
                let left_ok = if start == 0 {
                    true
                } else {
                    let prev = bytes[start - 1];
                    !prev.is_ascii_alphanumeric() && prev != b'_'
                };
                let right_ok = if ri >= len {
                    true
                } else {
                    let next = bytes[ri];
                    !next.is_ascii_alphabetic() && next != b'_'
                };
                if left_ok && right_ok {
                    // Check if any letter is lowercase
                    for b in &bytes[letter_start..letter_start + letter_count] {
                        if b.is_ascii_lowercase() {
                            return true;
                        }
                    }
                }
                i = ri;
                continue;
            }
        }

        i += 1;
    }
    false
}
