//! Formula normalization — two pipelines:
//!
//! 1. **XLSX import** (`normalize_xlsx_formula`): decodes XML entities and strips
//!    XLSX-internal prefixes (`_xlfn.`, `_xlfn._xlws.`, `_xlpm.`).
//!
//! 2. **User/agent input** (`normalize_formula_input`): applies Excel-compatible
//!    on-entry corrections — auto-quoting sheet names, closing trailing parens,
//!    stripping unnecessary quotes, uppercasing cell references.
//!
//! Each pipeline is applied **once** at its respective entry boundary so the
//! parser only sees clean, canonical formula strings.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file uses byte
//! offsets produced by `find(ASCII_CHAR)` or by scanning ASCII-only
//! prefixes (`_xlfn.`, `_xlpm.`, XML entity markers like `&amp;`).
//! Char-boundary by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

/// Normalize an XLSX formula string:
/// 1. Decode XML entities everywhere (undoes XML encoding -- always correct)
/// 2. Strip `_xlfn._xlws.`, `_xlfn.`, `_xlpm.` prefixes outside of
///    double-quoted string literals
/// 3. Ensure `=` prefix (XLSX `<f>` elements store formulas without `=`,
///    but our internal `formula_strings` contract requires it)
///
/// Call this once at the import boundary before parsing.
///
/// # Example
/// ```
/// use compute_parser::normalize_xlsx_formula;
/// let normalized = normalize_xlsx_formula("_xlfn.SUM(A1:B10)");
/// assert_eq!(normalized, "=SUM(A1:B10)");
/// ```
#[must_use]
pub fn normalize_xlsx_formula(formula: &str) -> String {
    if formula.is_empty() {
        return String::new();
    }

    let needs_entity_decode = formula.contains('&');
    let needs_prefix_strip = needs_xlsx_prefix_strip(formula);

    let cleaned: Cow<'_, str> = if !needs_entity_decode && !needs_prefix_strip {
        Cow::Borrowed(formula)
    } else if needs_entity_decode {
        let decoded = decode_xml_entities(formula);
        if needs_prefix_strip {
            Cow::Owned(strip_xlsx_prefixes(&decoded))
        } else {
            decoded
        }
    } else {
        Cow::Owned(strip_xlsx_prefixes(formula))
    };

    // Ensure `=` prefix. All other formula_strings insertion paths (user edits
    // via parse_and_register_formula, structural changes via to_a1_string)
    // already produce `=`-prefixed strings. This is the only entry point that
    // receives formulas without it (XLSX `<f>` elements omit the `=`).
    if cleaned.starts_with('=') {
        cleaned.into_owned()
    } else {
        format!("={cleaned}")
    }
}

/// Decode the 5 standard XML entities + numeric character references.
/// Suitable for use on arbitrary strings (sheet names, formula text, etc.).
///
/// # Examples
///
/// ```
/// use compute_parser::decode_xml_entities_str;
///
/// assert_eq!(decode_xml_entities_str("A &amp; B"), "A & B");
/// assert_eq!(decode_xml_entities_str("&lt;hello&gt;"), "<hello>");
/// ```
#[must_use]
pub fn decode_xml_entities_str(s: &str) -> String {
    decode_xml_entities(s).into_owned()
}

// ─── user/agent input normalization ─────────────────────────────────────────

use std::borrow::Cow;

use crate::ast::needs_quoting;

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
fn auto_quote_sheet_names<'a>(formula: &'a str, sheet_names: &[&str]) -> Cow<'a, str> {
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
fn auto_close_parentheses(formula: &str) -> Cow<'_, str> {
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
fn strip_unnecessary_sheet_quotes(formula: &str) -> Cow<'_, str> {
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
fn uppercase_cell_references(formula: &str) -> Cow<'_, str> {
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

// ─── internals ───────────────────────────────────────────────────────────────

// ─── shared string-skipping helpers ─────────────────────────────────────────
//
// Several functions need to walk a formula byte-by-byte while skipping over
// double-quoted string literals (`"..."` with `""` escapes) and single-quoted
// sheet names (`'...'` with `''` escapes).  These helpers encapsulate that
// logic so each call site doesn't duplicate it.

/// Advance past a double-quoted string body.  `pos` should point to the byte
/// *after* the opening `"`.  Returns the index of the first byte *after* the
/// closing quote (or `bytes.len()` if the string is unterminated).
fn skip_double_quoted(bytes: &[u8], mut pos: usize) -> usize {
    let len = bytes.len();
    while pos < len {
        if bytes[pos] == b'"' {
            pos += 1;
            if pos < len && bytes[pos] == b'"' {
                pos += 1; // escaped ""
            } else {
                return pos; // past closing quote
            }
        } else {
            pos += 1;
        }
    }
    pos
}

/// Advance past a single-quoted sheet name body.  `pos` should point to the
/// byte *after* the opening `'`.  Returns the index of the first byte *after*
/// the closing quote (or `bytes.len()` if unterminated).
fn skip_single_quoted(bytes: &[u8], mut pos: usize) -> usize {
    let len = bytes.len();
    while pos < len {
        if bytes[pos] == b'\'' {
            pos += 1;
            if pos < len && bytes[pos] == b'\'' {
                pos += 1; // escaped ''
            } else {
                return pos; // past closing quote
            }
        } else {
            pos += 1;
        }
    }
    pos
}

/// Quick scan: returns `true` if there is at least one single-quoted sheet
/// reference whose quotes are unnecessary (i.e. the name inside doesn't
/// actually need quoting).  Used by `strip_unnecessary_sheet_quotes` to
/// short-circuit when no work is needed.
fn has_strippable_sheet_quotes(formula: &str) -> bool {
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
fn has_lowercase_cell_refs(formula: &str) -> bool {
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

// ─── XML / XLSX helpers ─────────────────────────────────────────────────────

/// Decode XML entities: `&amp;`→`&`, `&lt;`→`<`, `&gt;`→`>`, `&quot;`→`"`,
/// `&apos;`→`'`, `&#NN;`→char, `&#xHH;`→char.
fn decode_xml_entities(s: &str) -> Cow<'_, str> {
    if !s.contains('&') {
        return Cow::Borrowed(s);
    }

    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'&' {
            // Find the closing ';'
            if let Some(semi_offset) = bytes[i..].iter().position(|&b| b == b';') {
                let entity = &s[i + 1..i + semi_offset]; // between & and ;
                if let Some(ch) = resolve_entity(entity) {
                    out.push(ch);
                    i += semi_offset + 1;
                    continue;
                }
            }
            // Not a recognized entity — emit '&' literally
            out.push('&');
            i += 1;
        } else if let Some(ch) = s[i..].chars().next() {
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    Cow::Owned(out)
}

/// Resolve the content between `&` and `;` to a char.
fn resolve_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => {
            // Numeric character references: &#NN; or &#xHH;
            entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| {
                    entity
                        .strip_prefix('#')
                        .and_then(|dec| dec.parse::<u32>().ok())
                })
                .and_then(char::from_u32)
        }
    }
}

/// Quick check whether a formula string contains any XLSX prefixes that need
/// stripping. This is a cheap scan (no allocation) used to skip
/// `strip_xlsx_prefixes` entirely when the formula is already clean.
///
/// Only checks outside of double-quoted string literals, matching the same
/// semantics as `strip_xlsx_prefixes`.
fn needs_xlsx_prefix_strip(s: &str) -> bool {
    // Cheap pre-check: the prefixes always start with '_x' (case-insensitive).
    // If the formula doesn't contain '_x' or '_X', no prefix can be present.
    if !s.contains("_x") && !s.contains("_X") {
        return false;
    }

    // Walk the string respecting double-quoted literals (same as strip_xlsx_prefixes).
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if bytes[i] == b'"' {
            i = skip_double_quoted(bytes, i + 1);
            continue;
        }
        // Check for prefixes using byte comparison (prefixes are pure ASCII).
        if i + 12 <= len && bytes[i..i + 12].eq_ignore_ascii_case(b"_xlfn._xlws.") {
            return true;
        }
        if i + 6 <= len
            && (bytes[i..i + 6].eq_ignore_ascii_case(b"_xlfn.")
                || bytes[i..i + 6].eq_ignore_ascii_case(b"_xlpm."))
        {
            return true;
        }
        i += 1;
    }
    false
}

/// Strip `_xlfn._xlws.`, `_xlfn.`, `_xlpm.` prefixes from a formula string,
/// but NOT inside double-quoted string literals.
///
/// The prefixes are matched case-insensitively.
fn strip_xlsx_prefixes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.char_indices().peekable();

    while let Some(&(i, ch)) = chars.peek() {
        // Inside a double-quoted string — copy verbatim until closing quote
        if ch == '"' {
            out.push('"');
            chars.next();
            while let Some(&(_, qch)) = chars.peek() {
                if qch == '"' {
                    out.push('"');
                    chars.next();
                    // Doubled quote ("") is an escape inside Excel strings
                    if let Some(&(_, next_ch)) = chars.peek() {
                        if next_ch == '"' {
                            out.push('"');
                            chars.next();
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                } else {
                    out.push(qch);
                    chars.next();
                }
            }
            continue;
        }

        // Try to match prefixes (case-insensitive), longest first.
        // Prefixes are pure ASCII so .get() on byte indices is safe.
        let remaining = &s[i..];
        if remaining.len() >= 12
            && remaining
                .get(..12)
                .is_some_and(|p| p.eq_ignore_ascii_case("_xlfn._xlws."))
        {
            // Advance past the 12-byte prefix (all ASCII, so 12 chars)
            for _ in 0..12 {
                chars.next();
            }
        } else if remaining.len() >= 6
            && remaining.get(..6).is_some_and(|p| {
                p.eq_ignore_ascii_case("_xlfn.") || p.eq_ignore_ascii_case("_xlpm.")
            })
        {
            for _ in 0..6 {
                chars.next();
            }
        } else {
            out.push(ch);
            chars.next();
        }
    }
    out
}

/// Qualify implicit structured references by prepending the table name.
///
/// Rewrites `[@Column]` to `TableName[@Column]` throughout the formula.
/// Only applies when `table_name` is `Some` (cell is inside a table).
///
/// # Examples
/// ```
/// use compute_parser::qualify_implicit_structured_refs;
///
/// // Basic implicit ref
/// assert_eq!(
///     qualify_implicit_structured_refs("=[@Score]*2", Some("Table1")),
///     "=Table1[@Score]*2"
/// );
///
/// // Multiple implicit refs
/// assert_eq!(
///     qualify_implicit_structured_refs("=[@Price]*[@Qty]", Some("Data")),
///     "=Data[@Price]*Data[@Qty]"
/// );
///
/// // Already qualified — no change
/// assert_eq!(
///     qualify_implicit_structured_refs("=Table1[@Score]*2", Some("Table1")),
///     "=Table1[@Score]*2"
/// );
///
/// // No table context — no change
/// assert_eq!(
///     qualify_implicit_structured_refs("=[@Score]*2", None),
///     "=[@Score]*2"
/// );
/// ```
#[must_use]
pub fn qualify_implicit_structured_refs(formula: &str, table_name: Option<&str>) -> String {
    let table_name = match table_name {
        Some(n) if !n.is_empty() => n,
        _ => return formula.to_string(),
    };

    if !formula.starts_with('=') {
        return formula.to_string();
    }

    let bytes = formula.as_bytes();
    let len = bytes.len();
    let mut out = String::with_capacity(len + table_name.len() * 2);
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
                        // Escaped quote
                        out.push('"');
                        i += 1;
                    } else {
                        break;
                    }
                } else {
                    let ch = formula[i..].chars().next().unwrap();
                    out.push(ch);
                    i += ch.len_utf8();
                }
            }
            continue;
        }

        // Check for `[@` pattern
        if bytes[i] == b'[' && i + 1 < len && bytes[i + 1] == b'@' {
            // Check if preceded by an identifier char (means it's already qualified)
            let preceded_by_ident = if i > 0 {
                let prev = bytes[i - 1];
                prev.is_ascii_alphanumeric() || prev == b'_' || prev == b'.'
            } else {
                false
            };

            if !preceded_by_ident {
                // Unqualified implicit ref — prepend table name
                out.push_str(table_name);
            }
        }

        let ch = formula[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // XML entity decoding

    #[test]
    fn test_decode_standard_entities() {
        assert_eq!(decode_xml_entities("A&amp;B"), "A&B");
        assert_eq!(decode_xml_entities("1&lt;2"), "1<2");
        assert_eq!(decode_xml_entities("2&gt;1"), "2>1");
        assert_eq!(decode_xml_entities("&quot;hi&quot;"), "\"hi\"");
        assert_eq!(decode_xml_entities("it&apos;s"), "it's");
    }

    #[test]
    fn test_decode_numeric_entities() {
        assert_eq!(decode_xml_entities("&#65;"), "A");
        assert_eq!(decode_xml_entities("&#x41;"), "A");
        assert_eq!(decode_xml_entities("&#X41;"), "A");
        assert_eq!(decode_xml_entities("&#169;"), "\u{00A9}"); // ©
    }

    #[test]
    fn test_decode_no_entities() {
        assert_eq!(decode_xml_entities("SUM(A1:B10)"), "SUM(A1:B10)");
    }

    #[test]
    fn test_decode_unrecognized_entity() {
        assert_eq!(decode_xml_entities("&foo;bar"), "&foo;bar");
    }

    #[test]
    fn test_decode_ampersand_without_semicolon() {
        assert_eq!(decode_xml_entities("A&B"), "A&B");
    }

    #[test]
    fn test_decode_multiple_entities() {
        assert_eq!(decode_xml_entities("A&amp;B&lt;C&gt;D"), "A&B<C>D");
    }

    // Prefix stripping

    #[test]
    fn test_strip_xlfn() {
        assert_eq!(
            normalize_xlsx_formula("_xlfn.FILTER(A1:A10,B1:B10)"),
            "=FILTER(A1:A10,B1:B10)"
        );
    }

    #[test]
    fn test_strip_xlfn_xlws() {
        assert_eq!(
            normalize_xlsx_formula("_xlfn._xlws.SORT(A1:A10)"),
            "=SORT(A1:A10)"
        );
    }

    #[test]
    fn test_strip_xlfn_single_and_anchorarray() {
        assert_eq!(
            normalize_xlsx_formula("_xlfn.SINGLE(A1:A5)"),
            "=SINGLE(A1:A5)"
        );
        assert_eq!(
            normalize_xlsx_formula("_xlfn.ANCHORARRAY(A1)"),
            "=ANCHORARRAY(A1)"
        );
    }

    #[test]
    fn test_strip_xlfn_xlws_single_and_anchorarray() {
        assert_eq!(
            normalize_xlsx_formula("_xlfn._xlws.SINGLE(A1:A5)"),
            "=SINGLE(A1:A5)"
        );
        assert_eq!(
            normalize_xlsx_formula("_XLFN._XLWS.ANCHORARRAY(A1)"),
            "=ANCHORARRAY(A1)"
        );
    }

    #[test]
    fn test_strip_xlpm() {
        assert_eq!(
            normalize_xlsx_formula("_xlfn.LET(_xlpm.pos,1,_xlpm.pos+1)"),
            "=LET(pos,1,pos+1)"
        );
    }

    #[test]
    fn test_strip_case_insensitive() {
        assert_eq!(
            normalize_xlsx_formula("_XLFN.FILTER(A1:A10,B1:B10)"),
            "=FILTER(A1:A10,B1:B10)"
        );
        assert_eq!(normalize_xlsx_formula("_Xlpm.var"), "=var");
    }

    #[test]
    fn test_preserve_strings() {
        assert_eq!(
            normalize_xlsx_formula(r#"IF(A1="_xlfn.test","_xlpm.val",B1)"#),
            r#"=IF(A1="_xlfn.test","_xlpm.val",B1)"#
        );
        assert_eq!(
            normalize_xlsx_formula(r#"IF(A1="_xlfn.SINGLE(A1:A5)","_xlfn.ANCHORARRAY(A1)",B1)"#),
            r#"=IF(A1="_xlfn.SINGLE(A1:A5)","_xlfn.ANCHORARRAY(A1)",B1)"#
        );
    }

    #[test]
    fn test_preserve_doubled_quotes_in_strings() {
        assert_eq!(
            normalize_xlsx_formula(r#"IF(A1="""_xlfn.x""",1,2)"#),
            r#"=IF(A1="""_xlfn.x""",1,2)"#
        );
    }

    // Combined: entities + prefixes

    #[test]
    fn test_combined_entity_and_prefix() {
        assert_eq!(
            normalize_xlsx_formula("_xlfn.IF(A1&amp;B1&gt;0,1,0)"),
            "=IF(A1&B1>0,1,0)"
        );
    }

    #[test]
    fn test_cross_sheet_entity() {
        assert_eq!(decode_xml_entities_str("Sheet &amp; Data"), "Sheet & Data");
    }

    #[test]
    fn test_full_formula_normalization() {
        let raw = "_xlfn.LET(_xlpm.x,Sheet1!A1&amp;B1,_xlfn.IF(_xlpm.x&gt;0,1,0))";
        let expected = "=LET(x,Sheet1!A1&B1,IF(x>0,1,0))";
        assert_eq!(normalize_xlsx_formula(raw), expected);
    }

    #[test]
    fn test_unicode_in_formula() {
        // Multi-byte UTF-8 chars (checkmark, X mark, etc.) must not panic
        assert_eq!(
            normalize_xlsx_formula(r#"IF(A1>0,"✓ Pass","✗ Fail")"#),
            r#"=IF(A1>0,"✓ Pass","✗ Fail")"#
        );
        assert_eq!(
            normalize_xlsx_formula("_xlfn.IF(A1>0,\"✓\",\"✗\")"),
            "=IF(A1>0,\"✓\",\"✗\")"
        );
        assert_eq!(normalize_xlsx_formula("'Просрочка'!A1"), "='Просрочка'!A1");
    }

    #[test]
    fn test_no_change_for_clean_formula() {
        // Bare formula from XLSX gets `=` prepended
        assert_eq!(
            normalize_xlsx_formula("SUM(A1:B10)+C1*2"),
            "=SUM(A1:B10)+C1*2"
        );
    }

    #[test]
    fn test_already_has_equals_prefix() {
        // Formulas that already have `=` (e.g. from our own snapshot round-trip)
        // must not get double `=`
        assert_eq!(normalize_xlsx_formula("=SUM(A1:B10)"), "=SUM(A1:B10)");
        assert_eq!(
            normalize_xlsx_formula("=_xlfn.FILTER(A1:A10,B1:B10)"),
            "=FILTER(A1:A10,B1:B10)"
        );
    }

    #[test]
    fn test_empty_string() {
        assert_eq!(normalize_xlsx_formula(""), "");
    }

    // ─── auto_quote_sheet_names tests ───────────────────────────────────────

    #[test]
    fn test_auto_quote_ampersand() {
        let names = &["D&A_BUILD"];
        assert_eq!(
            auto_quote_sheet_names("=D&A_BUILD!E1", &names[..]),
            "='D&A_BUILD'!E1"
        );
    }

    #[test]
    fn test_auto_quote_space() {
        let names = &["Revenue Summary"];
        assert_eq!(
            auto_quote_sheet_names("=Revenue Summary!A1", &names[..]),
            "='Revenue Summary'!A1"
        );
    }

    #[test]
    fn test_auto_quote_dash() {
        let names = &["Q1-2026"];
        assert_eq!(
            auto_quote_sheet_names("=Q1-2026!B2", &names[..]),
            "='Q1-2026'!B2"
        );
    }

    #[test]
    fn test_auto_quote_already_quoted() {
        let names = &["D&A_BUILD"];
        assert_eq!(
            auto_quote_sheet_names("='D&A_BUILD'!E1", &names[..]),
            "='D&A_BUILD'!E1"
        );
    }

    #[test]
    fn test_auto_quote_no_special_chars() {
        let names = &["Sheet1"];
        // Sheet1 doesn't need quoting — should be unchanged
        assert_eq!(
            auto_quote_sheet_names("=Sheet1!A1", &names[..]),
            "=Sheet1!A1"
        );
    }

    #[test]
    fn test_auto_quote_multiple_refs() {
        let names = &["D&A_BUILD"];
        assert_eq!(
            auto_quote_sheet_names("=D&A_BUILD!E1+D&A_BUILD!F1", &names[..]),
            "='D&A_BUILD'!E1+'D&A_BUILD'!F1"
        );
    }

    #[test]
    fn test_auto_quote_mixed() {
        let names = &["D&A_BUILD", "Sheet1"];
        assert_eq!(
            auto_quote_sheet_names("=D&A_BUILD!E1+Sheet1!A1", &names[..]),
            "='D&A_BUILD'!E1+Sheet1!A1"
        );
    }

    #[test]
    fn test_auto_quote_inside_string() {
        let names = &["D&A_BUILD"];
        // Name inside double-quoted string should NOT be quoted
        assert_eq!(
            auto_quote_sheet_names(r#"=IF(A1,"D&A_BUILD!E1",0)"#, &names[..]),
            r#"=IF(A1,"D&A_BUILD!E1",0)"#
        );
    }

    #[test]
    fn test_auto_quote_longest_first() {
        let names = &["D&A", "D&A_BUILD"];
        // D&A_BUILD should match, not D&A
        assert_eq!(
            auto_quote_sheet_names("=D&A_BUILD!E1", &names[..]),
            "='D&A_BUILD'!E1"
        );
    }

    #[test]
    fn test_auto_quote_single_quote_in_name() {
        let names = &["Dept's"];
        assert_eq!(
            auto_quote_sheet_names("=Dept's!A1", &names[..]),
            "='Dept''s'!A1"
        );
    }

    #[test]
    fn test_auto_quote_not_formula() {
        let names = &["D&A_BUILD"];
        assert_eq!(auto_quote_sheet_names("hello", &names[..]), "hello");
    }

    #[test]
    fn test_auto_quote_dot_in_name() {
        let names = &["v2.0"];
        assert_eq!(auto_quote_sheet_names("=v2.0!A1", &names[..]), "='v2.0'!A1");
    }

    #[test]
    fn test_auto_quote_case_insensitive() {
        // Matches case-insensitively but preserves the user's original casing
        let names = &["D&A_BUILD"];
        assert_eq!(
            auto_quote_sheet_names("=d&a_build!E1", &names[..]),
            "='d&a_build'!E1"
        );
    }

    // ─── auto_close_parentheses tests ───────────────────────────────────────

    #[test]
    fn test_close_one_missing() {
        assert_eq!(auto_close_parentheses("=SUM(A1:A10"), "=SUM(A1:A10)");
    }

    #[test]
    fn test_close_two_missing() {
        assert_eq!(
            auto_close_parentheses("=IF(A1>0,SUM(A1"),
            "=IF(A1>0,SUM(A1))"
        );
    }

    #[test]
    fn test_close_none_missing() {
        assert_eq!(auto_close_parentheses("=SUM(A1)"), "=SUM(A1)");
    }

    #[test]
    fn test_close_extra_closing() {
        // Depth goes negative — no fix
        assert_eq!(auto_close_parentheses("=SUM(A1))"), "=SUM(A1))");
    }

    #[test]
    fn test_close_parens_in_string() {
        assert_eq!(
            auto_close_parentheses(r#"=IF(A1,"(",B1)"#),
            r#"=IF(A1,"(",B1)"#
        );
    }

    #[test]
    fn test_close_parens_in_sheet_name() {
        assert_eq!(auto_close_parentheses("='Sheet (1)'!A1"), "='Sheet (1)'!A1");
    }

    #[test]
    fn test_close_not_formula() {
        assert_eq!(auto_close_parentheses("hello("), "hello(");
    }

    #[test]
    fn test_close_balanced_complex() {
        assert_eq!(
            auto_close_parentheses("=IF(SUM(A1:A10)>0,1,0)"),
            "=IF(SUM(A1:A10)>0,1,0)"
        );
    }

    // ─── strip_unnecessary_sheet_quotes tests ───────────────────────────────

    #[test]
    fn test_strip_simple_name() {
        assert_eq!(strip_unnecessary_sheet_quotes("='Sheet1'!A1"), "=Sheet1!A1");
    }

    #[test]
    fn test_strip_keeps_required() {
        assert_eq!(strip_unnecessary_sheet_quotes("='D&A'!A1"), "='D&A'!A1");
    }

    #[test]
    fn test_strip_mixed() {
        assert_eq!(
            strip_unnecessary_sheet_quotes("='Sheet1'!A1+'D&A'!B1"),
            "=Sheet1!A1+'D&A'!B1"
        );
    }

    #[test]
    fn test_strip_already_unquoted() {
        assert_eq!(strip_unnecessary_sheet_quotes("=Sheet1!A1"), "=Sheet1!A1");
    }

    #[test]
    fn test_strip_name_with_underscore() {
        assert_eq!(
            strip_unnecessary_sheet_quotes("='Data_2024'!A1"),
            "=Data_2024!A1"
        );
    }

    #[test]
    fn test_strip_name_starting_digit() {
        // Digit-starting names need quoting
        assert_eq!(
            strip_unnecessary_sheet_quotes("='2024Data'!A1"),
            "='2024Data'!A1"
        );
    }

    // ─── uppercase_cell_references tests ────────────────────────────────────

    #[test]
    fn test_upper_simple() {
        assert_eq!(uppercase_cell_references("=a1+b2"), "=A1+B2");
    }

    #[test]
    fn test_upper_range() {
        assert_eq!(uppercase_cell_references("=sum(a1:b10)"), "=sum(A1:B10)");
    }

    #[test]
    fn test_upper_in_string() {
        assert_eq!(uppercase_cell_references(r#"="a1""#), r#"="a1""#);
    }

    #[test]
    fn test_upper_already_upper() {
        assert_eq!(uppercase_cell_references("=A1"), "=A1");
    }

    #[test]
    fn test_upper_mixed() {
        assert_eq!(uppercase_cell_references("=a1+B2+c3"), "=A1+B2+C3");
    }

    #[test]
    fn test_upper_sheet_qualified() {
        assert_eq!(uppercase_cell_references("=Sheet1!a1"), "=Sheet1!A1");
    }

    #[test]
    fn test_upper_absolute() {
        assert_eq!(uppercase_cell_references("=$a$1"), "=$A$1");
    }

    // ─── normalize_formula_input pipeline tests ─────────────────────────────

    #[test]
    fn test_pipeline_combined() {
        let names = &["D&A_BUILD"];
        assert_eq!(
            normalize_formula_input("=D&A_BUILD!a1+SUM(b1:b10", &names[..]),
            "='D&A_BUILD'!A1+SUM(B1:B10)"
        );
    }

    #[test]
    fn test_pipeline_no_op() {
        let names = &["Sheet1"];
        assert_eq!(
            normalize_formula_input("=SUM(A1:A10)", &names[..]),
            "=SUM(A1:A10)"
        );
    }

    #[test]
    fn test_pipeline_not_formula() {
        let names = &["Sheet1"];
        assert_eq!(normalize_formula_input("hello", &names[..]), "hello");
    }

    #[test]
    fn test_pipeline_empty_names() {
        let names: &[&str] = &[];
        assert_eq!(
            normalize_formula_input("=SUM(a1:a10", names),
            "=SUM(A1:A10)"
        );
    }

    #[test]
    fn test_pipeline_strip_then_uppercase() {
        // Unnecessary quotes stripped, then cell ref uppercased
        let names: &[&str] = &[];
        assert_eq!(normalize_formula_input("='Sheet1'!a1", names), "=Sheet1!A1");
    }

    // ─── UTF-8 multi-byte regression tests ─────────────────────────────────
    //
    // Regression: auto_quote_sheet_names iterated byte-by-byte inside
    // double-quoted string literals (`bytes[i] as char; i += 1`), corrupting
    // multi-byte UTF-8 characters.  En-dash (U+2013, 3 bytes: E2 80 93)
    // became "â" (Latin-1 interpretation of 0xE2).
    //
    // These tests ensure multi-byte chars survive every code path that
    // iterates over formula bytes.

    #[test]
    fn test_auto_quote_preserves_en_dash_in_string_literal() {
        // The exact pattern from the 0C4IrPq regression: en-dash inside a
        // string literal, with a quotable sheet name triggering the loop.
        let names = &["D&A"];
        assert_eq!(
            auto_quote_sheet_names(r#"=IF(D&A!A1<>"","N/A – Amendment","OK")"#, &names[..],),
            r#"=IF('D&A'!A1<>"","N/A – Amendment","OK")"#
        );
    }

    #[test]
    fn test_auto_quote_preserves_em_dash_and_bullet_in_strings() {
        let names = &["Rev Summary"];
        assert_eq!(
            auto_quote_sheet_names(r#"=IF(Rev Summary!B1>0,"Pass — yes","• Fail")"#, &names[..],),
            r#"=IF('Rev Summary'!B1>0,"Pass — yes","• Fail")"#
        );
    }

    #[test]
    fn test_auto_quote_preserves_cjk_and_emoji_in_strings() {
        let names = &["D&A"];
        assert_eq!(
            auto_quote_sheet_names(r#"=IF(D&A!A1>0,"結果🎉","失敗")"#, &names[..],),
            r#"=IF('D&A'!A1>0,"結果🎉","失敗")"#
        );
    }

    #[test]
    fn test_auto_quote_preserves_en_dash_outside_strings() {
        // En-dash in a single-quoted sheet name (not in a double-quoted string)
        let names = &["Q1–Q2"];
        assert_eq!(
            auto_quote_sheet_names("=Q1–Q2!A1", &names[..]),
            "='Q1–Q2'!A1"
        );
    }

    #[test]
    fn test_auto_quote_mixed_utf8_and_entities_full_formula() {
        // Realistic formula from the regression file:
        // quotable sheet name + en-dash string literals + comparisons
        let names = &["1| Rillet Customer Contracts"];
        let input = r#"=IF(AND('1| Rillet Customer Contracts'!AE5<>"Contract",'1| Rillet Customer Contracts'!AE5<>""),"N/A – Amendment","OK")"#;
        // Sheet name is already quoted, so no rewriting — just ensure en-dash
        // inside the string literal survives the iteration.
        assert_eq!(auto_quote_sheet_names(input, &names[..]), input);
    }

    #[test]
    fn test_normalize_formula_input_preserves_en_dash() {
        // Full pipeline: auto_quote → auto_close → strip_quotes → uppercase
        let names = &["D&A"];
        assert_eq!(
            normalize_formula_input(
                r#"=IF(D&A!a1<>"","Amendment – Price Increase","OK")"#,
                &names[..],
            ),
            r#"=IF('D&A'!A1<>"","Amendment – Price Increase","OK")"#
        );
    }

    #[test]
    fn test_normalize_xlsx_formula_preserves_en_dash() {
        // XLSX import path: entity decode + prefix strip
        assert_eq!(
            normalize_xlsx_formula(
                r#"IF(AND(AE5&lt;&gt;"Contract",AE5&lt;&gt;""),"N/A – Amendment","OK")"#
            ),
            r#"=IF(AND(AE5<>"Contract",AE5<>""),"N/A – Amendment","OK")"#
        );
    }

    #[test]
    fn test_normalize_xlsx_formula_preserves_multiple_unicode_chars() {
        // Various multi-byte chars scattered throughout a formula
        assert_eq!(
            normalize_xlsx_formula(r#"_xlfn.IF(A1&gt;0,"✓ résumé – Pro™","• échec €0")"#),
            r#"=IF(A1>0,"✓ résumé – Pro™","• échec €0")"#
        );
    }
}
