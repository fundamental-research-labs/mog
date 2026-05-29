// XLSX prefixes are ASCII, so prefix byte slices stay on UTF-8 boundaries.
#![allow(clippy::string_slice)]

use std::borrow::Cow;

use super::scan::skip_double_quoted;
use super::xml::decode_xml_entities;

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
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // Inside a double-quoted string — copy verbatim until closing quote
        if bytes[i] == b'"' {
            let end = skip_double_quoted(bytes, i + 1);
            out.push_str(&s[i..end]);
            i = end;
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
            i += 12;
        } else if remaining.len() >= 6
            && remaining.get(..6).is_some_and(|p| {
                p.eq_ignore_ascii_case("_xlfn.") || p.eq_ignore_ascii_case("_xlpm.")
            })
        {
            i += 6;
        } else {
            let ch = s[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}
