// Structured-ref scanning splits only at ASCII formula syntax bytes.
#![allow(clippy::string_slice)]

use super::scan::skip_double_quoted;

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
            let end = skip_double_quoted(bytes, i + 1);
            out.push_str(&formula[i..end]);
            i = end;
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
