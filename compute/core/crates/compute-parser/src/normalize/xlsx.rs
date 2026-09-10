// XLSX prefixes are ASCII, so prefix byte slices stay on UTF-8 boundaries.
#![allow(clippy::string_slice)]

use std::borrow::Cow;

use super::scan::{skip_double_quoted, skip_single_quoted};
use super::xml::decode_xml_entities;

/// Normalize an XLSX formula string:
/// 1. Decode XML entities everywhere (undoes XML encoding -- always correct)
/// 2. Strip `_xlfn._xlws.`, `_xlfn.`, `_xlpm.` prefixes outside of
///    string literals, sheet names, and structured references
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

    // Entity decoding can reveal a prefix or a quote, so lexical decisions
    // must use the decoded formula rather than the original XML text.
    let decoded = decode_xml_entities(formula);
    let cleaned = match strip_xlsx_prefixes(&decoded) {
        Some(stripped) => Cow::Owned(stripped),
        None => decoded,
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

/// Strip OOXML prefixes only from complete formula identifiers. Return `None`
/// for unchanged formulas so the import fast path does not allocate.
fn strip_xlsx_prefixes(s: &str) -> Option<String> {
    if !s.contains("_x") && !s.contains("_X") {
        return None;
    }

    let bytes = s.as_bytes();
    let mut i = 0;
    let mut copied_until = 0;
    let mut out = None::<String>;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                i = skip_double_quoted(bytes, i + 1);
                continue;
            }
            b'\'' => {
                i = skip_single_quoted(bytes, i + 1);
                continue;
            }
            b'[' => {
                i = skip_bracketed_reference(bytes, i);
                continue;
            }
            _ => {}
        }

        let ch = s[i..].chars().next().unwrap();
        if !is_identifier_char(ch) {
            i += ch.len_utf8();
            continue;
        }

        // Consume the whole identifier so embedded prefix-looking text cannot
        // become a rewrite candidate. Unicode names are identifiers too.
        let start = i;
        i += ch.len_utf8();
        while i < bytes.len() {
            let next = s[i..].chars().next().unwrap();
            if !is_identifier_char(next) {
                break;
            }
            i += next.len_utf8();
        }
        // A sheet or table name can legitimately start with an OOXML prefix.
        if s[..start].trim_end().ends_with('!')
            || s[i..].trim_start().starts_with(['!', '['])
            || starts_sheet_range(s, i)
        {
            continue;
        }
        let identifier = &s[start..i];
        for prefix in ["_xlfn._xlws.", "_xlfn.", "_xlpm."] {
            if identifier
                .get(..prefix.len())
                .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
                && identifier.len() > prefix.len()
            {
                let out = out.get_or_insert_with(|| String::with_capacity(s.len()));
                out.push_str(&s[copied_until..start]);
                copied_until = start + prefix.len();
                break;
            }
        }
    }
    out.map(|mut out| {
        out.push_str(&s[copied_until..]);
        out
    })
}

fn is_identifier_char(ch: char) -> bool {
    ch.is_alphanumeric()
        || matches!(ch, '_' | '.' | '\\')
        || (!ch.is_ascii() && !ch.is_whitespace())
}

/// In an unquoted 3D reference (`Start:End!A1`), the first name is a
/// sheet qualifier as well as the name immediately before `!`.
fn starts_sheet_range(s: &str, end: usize) -> bool {
    let Some(second_sheet) = s[end..].trim_start().strip_prefix(':') else {
        return false;
    };
    let second_sheet = second_sheet.trim_start();
    let end = if second_sheet.starts_with('\'') {
        skip_single_quoted(second_sheet.as_bytes(), 1)
    } else {
        second_sheet
            .chars()
            .take_while(|&ch| is_identifier_char(ch))
            .map(char::len_utf8)
            .sum::<usize>()
    };
    second_sheet[end..].trim_start().starts_with('!')
}

/// Protect nested structured references and external workbook qualifiers.
/// Apostrophes escape special characters within a structured-reference header.
fn skip_bracketed_reference(bytes: &[u8], mut i: usize) -> usize {
    let mut depth = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' if matches!(bytes.get(i + 1), Some(b'[' | b']' | b'#' | b'\'' | b'@')) => {
                i += 2;
                continue;
            }
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return i + 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    i
}
