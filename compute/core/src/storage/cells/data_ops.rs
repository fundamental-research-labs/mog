//! Cell Data Operations — user-facing data transformation operations.
//!
//! Port of `spreadsheet-model/src/cells/cell-data-operations.ts` (646 LOC).
//!
//! ## Responsibilities
//! - **Remove Duplicates**: Remove duplicate rows based on column comparison
//! - **Text to Columns**: Split text values into multiple columns
//!
//! ## Design
//! - Pure helper functions (`split_by_delimiter`, `split_by_fixed_width`,
//!   `build_delimiter_regex`) are testable in isolation.
//! - Plans and previews borrow native cell values. Engine mutations apply plans.

use regex::Regex;

use crate::mirror::CellMirror;
use cell_types::{SheetId, SheetPos};

pub use crate::engine_types::cell_ops::*;

// ===========================================================================
// Pure splitting helpers
// ===========================================================================

/// Build a regex for delimiter-based splitting.
///
/// Constructs a character class `[chars]` from the enabled delimiter flags.
/// If `treat_consecutive_as_one` is true, appends `+` to match runs.
fn build_delimiter_regex(delimiters: &Delimiters, treat_consecutive_as_one: bool) -> Regex {
    let mut chars = Vec::new();

    if delimiters.tab {
        chars.push("\\t".to_string());
    }
    if delimiters.semicolon {
        chars.push(";".to_string());
    }
    if delimiters.comma {
        chars.push(",".to_string());
    }
    if delimiters.space {
        chars.push(" ".to_string());
    }
    if let Some(ref other) = delimiters.other {
        // Escape regex metacharacters
        chars.push(regex::escape(other));
    }

    if chars.is_empty() {
        chars.push(",".to_string());
    }

    let quantifier = if treat_consecutive_as_one { "+" } else { "" };
    let pattern = format!("[{}]{}", chars.join(""), quantifier);
    Regex::new(&pattern).expect("delimiter regex should be valid")
}

/// Split a value by delimiter regex, respecting text qualifiers.
///
/// When `qualifier` is `None`, uses simple regex splitting.
/// When a qualifier is set (e.g. `"` or `'`), handles quoted fields
/// including escaped quotes (doubled qualifier character).
fn split_by_delimiter(
    value: &str,
    delimiter_regex: &Regex,
    qualifier: &TextQualifier,
) -> Vec<String> {
    if value.is_empty() {
        return vec![String::new()];
    }

    if *qualifier == TextQualifier::None {
        return delimiter_regex
            .split(value)
            .map(|s| s.to_string())
            .collect();
    }

    let qual_char = match qualifier {
        TextQualifier::DoubleQuote => '"',
        TextQualifier::SingleQuote => '\'',
        TextQualifier::None => unreachable!(),
    };

    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let chars: Vec<char> = value.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];

        if ch == qual_char {
            if in_quotes {
                // Check for escaped qualifier (doubled)
                if i + 1 < chars.len() && chars[i + 1] == qual_char {
                    current.push(qual_char);
                    i += 2;
                    continue;
                }
                in_quotes = false;
            } else {
                in_quotes = true;
            }
            i += 1;
        } else if !in_quotes {
            // Check if current char is a delimiter
            // char_indices().nth(i).0 is always at a char boundary by construction.
            #[allow(clippy::string_slice)]
            let remaining = &value[value.char_indices().nth(i).unwrap().0..];
            if let Some(m) = delimiter_regex.find(remaining)
                && m.start() == 0
            {
                result.push(current.clone());
                current.clear();
                // Advance by the match length in chars
                let matched_str = m.as_str();
                i += matched_str.chars().count();
                continue;
            }
            current.push(ch);
            i += 1;
        } else {
            current.push(ch);
            i += 1;
        }
    }

    result.push(current);
    result
}

/// Split a string at fixed-width column positions.
///
/// `breaks` are character positions where the string should be split.
/// Resulting parts are trimmed. Breaks are sorted before processing.
fn split_by_fixed_width(value: &str, breaks: &[usize]) -> Vec<String> {
    if value.is_empty() || breaks.is_empty() {
        return vec![if value.is_empty() {
            String::new()
        } else {
            value.to_string()
        }];
    }

    let mut sorted_breaks: Vec<usize> = breaks.to_vec();
    sorted_breaks.sort_unstable();

    let mut result = Vec::new();
    let mut last_pos = 0;

    for &break_pos in &sorted_breaks {
        if break_pos > last_pos && break_pos <= value.len() {
            // `breaks` is documented as char positions but used as byte
            // positions — ASCII-only contract on the fixed-width splitter
            // path. Non-ASCII input at these byte offsets is a separate
            // known latent bug (see data_ops.rs text-to-columns TODO).
            #[allow(clippy::string_slice)]
            let part = value[last_pos..break_pos].trim().to_string();
            result.push(part);
            last_pos = break_pos;
        }
    }

    if last_pos < value.len() {
        // last_pos is a previous `break_pos` (ASCII-only contract, see above).
        #[allow(clippy::string_slice)]
        let tail = value[last_pos..].trim().to_string();
        result.push(tail);
    } else if result.is_empty() {
        result.push(value.to_string());
    }

    result
}

/// Split all source values according to options. Returns a Vec of split rows.
pub fn split_all_values(
    source_values: &[String],
    options: &TextToColumnsOptions,
) -> Vec<Vec<String>> {
    if options.split_type == TextToColumnsSplitType::FixedWidth {
        source_values
            .iter()
            .map(|v| split_by_fixed_width(v, &options.fixed_width_breaks))
            .collect()
    } else {
        let delimiter_regex =
            build_delimiter_regex(&options.delimiters, options.treat_consecutive_as_one);
        source_values
            .iter()
            .map(|v| split_by_delimiter(v, &delimiter_regex, &options.text_qualifier))
            .collect()
    }
}

// ===========================================================================
// Grid index mutation helpers (write txn)
/// Identify the first occurrence of each row using current native values.
/// Column keys remain separate so embedded NUL characters cannot collide.
#[allow(clippy::too_many_arguments)]
pub(crate) fn unique_rows(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: &RemoveDuplicatesOptions,
) -> Vec<u32> {
    let first_data_row = u64::from(start_row) + u64::from(options.has_headers);
    let rows = first_data_row..=u64::from(end_row);
    let columns: Vec<_> = if options.columns_to_compare.is_empty() {
        (start_col..=end_col).collect()
    } else {
        options
            .columns_to_compare
            .iter()
            .copied()
            .filter(|col| (start_col..=end_col).contains(col))
            .collect()
    };
    if columns.is_empty() {
        return rows.map(|row| row as u32).collect();
    }
    let mut seen = std::collections::HashSet::new();
    rows.filter_map(|row| {
        let row = row as u32;
        let key: Vec<_> = columns
            .iter()
            .map(|col| {
                let text = mirror
                    .get_cell_value_at(sheet_id, SheetPos::new(row, *col))
                    .filter(|value| !value.is_null())
                    .map(ToString::to_string)
                    .unwrap_or_default();
                if options.case_sensitive {
                    text
                } else {
                    text.to_lowercase()
                }
            })
            .collect();
        seen.insert(key).then_some(row)
    })
    .collect()
}

/// Returns true if `s` is a numeric-looking token (matches /^-?\d*\.?\d+$/)
/// that has at least one **significant** leading zero — i.e. starts with `0`
/// followed by another digit. Used by `text_to_columns` to preserve identifiers
/// like `"00123"`, `"007"`, or `"0123.45"` as strings instead of coercing them
/// to numeric values, which would silently drop the leading zeros.
///
/// Excel-compatible behaviour: text-to-columns output preserves leading zeros
/// on the General format unless the user explicitly applies a Number format
/// to the destination column.
pub fn has_significant_leading_zero(s: &str) -> bool {
    let bytes = s.trim().as_bytes();
    // Need at least two chars: `0` followed by another digit.
    if bytes.len() < 2 {
        return false;
    }
    let rest = if bytes[0] == b'-' {
        if bytes.len() < 3 {
            return false;
        }
        &bytes[1..]
    } else {
        bytes
    };
    // First character of the unsigned portion must be `0` and the next must
    // also be a digit (so `0`, `0.5`, `-0.5` are NOT flagged — they're
    // ordinary numeric values).
    rest.first() == Some(&b'0') && rest.get(1).is_some_and(|c| c.is_ascii_digit())
}

/// Preview native cell text without allocating identities or changing values.
#[allow(clippy::too_many_arguments)]
pub fn preview_text_to_columns(
    mirror: &crate::mirror::CellMirror,
    sheet_id: SheetId,
    source_start_row: u32,
    source_end_row: u32,
    source_col: u32,
    options: &TextToColumnsOptions,
    max_preview_rows: u32,
) -> Vec<Vec<String>> {
    if source_start_row > source_end_row || mirror.get_sheet(&sheet_id).is_none() {
        return Vec::new();
    }
    let values = (source_start_row..=source_end_row)
        .take(max_preview_rows as usize)
        .map(|row| {
            mirror
                .get_cell_value_at(&sheet_id, cell_types::SheetPos::new(row, source_col))
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
        .collect::<Vec<_>>();
    split_all_values(&values, options)
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests;
