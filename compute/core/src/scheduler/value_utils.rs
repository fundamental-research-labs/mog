//! Value utility functions — parsing, comparison, and string truncation.

use value_types::CellValue;

use crate::storage::cells::values::{
    InputParseContext, ParsedValue, parse_input_value_with_context,
};

/// Truncate a string to at most `max_chars` characters (not bytes).
/// Safe for all Unicode — never panics on multi-byte boundaries.
pub(super) fn truncate_chars(s: &str, max_chars: usize) -> &str {
    match s.char_indices().nth(max_chars) {
        // `idx` from char_indices is always at a char boundary by construction.
        #[allow(clippy::string_slice)]
        Some((idx, _)) => &s[..idx],
        None => s,
    }
}

#[cfg(test)]
pub(super) fn parse_plain_value(input: &str) -> CellValue {
    match crate::storage::cells::values::parse_input_value(input, None) {
        ParsedValue::Empty => CellValue::Null,
        ParsedValue::Number(n) => CellValue::number(n),
        ParsedValue::Boolean(b) => CellValue::Boolean(b),
        ParsedValue::Error(e) => CellValue::Error(e, None),
        // Preserve the original (non-trimmed) input for text — the caller
        // relies on this to round-trip trailing whitespace in literal text.
        ParsedValue::Text(_) => CellValue::Text(input.to_string().into()),
    }
}

pub(super) fn parse_plain_value_with_context(
    input: &str,
    context: &InputParseContext,
) -> (
    CellValue,
    Option<crate::snapshot::AutomaticConversionCategory>,
) {
    let parsed = parse_input_value_with_context(input, context);
    let value = match parsed.value {
        ParsedValue::Empty => CellValue::Null,
        ParsedValue::Number(n) => CellValue::number(n),
        ParsedValue::Boolean(b) => CellValue::Boolean(b),
        ParsedValue::Error(e) => CellValue::Error(e, None),
        ParsedValue::Text(_) => CellValue::Text(input.to_string().into()),
    };
    (value, parsed.preserved_category)
}

/// Compare two CellValues for equality (used to detect actual changes).
/// This uses a stricter comparison than the PartialEq impl on CellValue,
/// which does case-insensitive text comparison.
pub(super) fn values_equal(a: &CellValue, b: &CellValue) -> bool {
    match (a, b) {
        (CellValue::Number(x), CellValue::Number(y)) => {
            // Handle NaN: NaN != NaN in float comparison
            (x.is_nan() && y.is_nan()) || x == y
        }
        (CellValue::Text(x), CellValue::Text(y)) => x == y,
        (CellValue::Boolean(x), CellValue::Boolean(y)) => x == y,
        (CellValue::Error(x, None), CellValue::Error(y, None)) => x == y,
        (CellValue::Null, CellValue::Null) => true,
        (CellValue::Array(a_arr), CellValue::Array(b_arr)) => {
            if a_arr.rows() != b_arr.rows() || a_arr.cols() != b_arr.cols() {
                return false;
            }
            a_arr
                .rows_iter()
                .zip(b_arr.rows_iter())
                .all(|(row_a, row_b)| {
                    row_a
                        .iter()
                        .zip(row_b.iter())
                        .all(|(va, vb)| values_equal(va, vb))
                })
        }
        _ => false,
    }
}
