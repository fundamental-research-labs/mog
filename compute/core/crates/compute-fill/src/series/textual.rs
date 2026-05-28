use value_types::CellValue;

use super::common::{anchor_text, generate_copy};

pub(super) fn generate_text_with_number(
    source_values: &[CellValue],
    count: usize,
    prefix: &str,
    step: i64,
    num_digits: usize,
    direction_mult: i32,
) -> Vec<CellValue> {
    let anchor = match anchor_text(source_values, direction_mult) {
        Some(s) => s,
        None => return generate_copy(source_values, count),
    };

    // Parse the trailing number from the anchor
    let current_number = match parse_trailing_number(anchor) {
        Some(n) => n,
        None => return generate_copy(source_values, count),
    };

    let mult = i64::from(direction_mult);
    let mut result = Vec::with_capacity(count);
    let mut num = current_number;
    for _ in 0..count {
        num += step * mult;
        let num_str = if num_digits > 0 {
            format!("{:0>width$}", num, width = num_digits)
        } else {
            num.to_string()
        };
        result.push(CellValue::Text(format!("{}{}", prefix, num_str).into()));
    }
    result
}

/// Parse the trailing integer from a string like "Item123" -> 123.
fn parse_trailing_number(s: &str) -> Option<i64> {
    let end = s.len();
    let mut start = end;
    for (i, c) in s.char_indices().rev() {
        if c.is_ascii_digit() {
            start = i;
        } else {
            break;
        }
    }
    if start == end {
        return None;
    }
    s[start..end].parse::<i64>().ok()
}

pub(super) fn generate_ordinal(
    source_values: &[CellValue],
    count: usize,
    step: i64,
    direction_mult: i32,
) -> Vec<CellValue> {
    let anchor = match anchor_text(source_values, direction_mult) {
        Some(s) => s,
        None => return generate_copy(source_values, count),
    };

    // Parse the number from ordinal like "3rd" -> 3
    let current_number = match parse_ordinal_number(anchor) {
        Some(n) => n,
        None => return generate_copy(source_values, count),
    };

    let mult = i64::from(direction_mult);
    let mut result = Vec::with_capacity(count);
    let mut num = current_number;
    for _ in 0..count {
        num += step * mult;
        result.push(CellValue::Text(format_ordinal(num).into()));
    }
    result
}

/// Parse the leading integer from an ordinal string like "3rd" -> 3.
fn parse_ordinal_number(s: &str) -> Option<i64> {
    let num_end = s
        .char_indices()
        .take_while(|(_, c)| c.is_ascii_digit() || *c == '-')
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0);
    if num_end == 0 {
        return None;
    }
    // Check that what follows is a valid suffix
    let suffix = &s[num_end..];
    let suffix_lower = suffix.to_lowercase();
    if !["st", "nd", "rd", "th"].contains(&suffix_lower.as_str()) {
        return None;
    }
    s[..num_end].parse::<i64>().ok()
}

/// Ordinal suffix for an integer (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, ...).
pub(super) fn ordinal_suffix(n: i64) -> &'static str {
    let abs = n.unsigned_abs();
    let last_two = abs % 100;
    if (11..=13).contains(&last_two) {
        "th"
    } else {
        match abs % 10 {
            1 => "st",
            2 => "nd",
            3 => "rd",
            _ => "th",
        }
    }
}

/// Format a number as an ordinal string (e.g. 1 -> "1st").
fn format_ordinal(n: i64) -> String {
    format!("{}{}", n, ordinal_suffix(n))
}
