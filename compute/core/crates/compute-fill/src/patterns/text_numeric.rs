use value_types::CellValue;

use crate::types::{FillPattern, FillPatternType};

use super::default_pattern;
use super::values::all_texts;

/// Parse an ordinal string like "1st", "2nd", "3rd", "4th" -> its numeric value.
/// Returns `None` if not a valid ordinal or the suffix doesn't match the number.
pub(crate) fn parse_ordinal(s: &str) -> Option<i64> {
    let s = s.trim();
    // Find where digits end.
    let digit_end = s.bytes().position(|b| !b.is_ascii_digit())?;
    if digit_end == 0 {
        return None;
    }
    let num_str = &s[..digit_end];
    let suffix = &s[digit_end..];

    // Suffix must be exactly 2 chars: st, nd, rd, or th.
    if suffix.len() != 2 {
        return None;
    }
    let suffix_lower = suffix.to_lowercase();

    let num: i64 = num_str.parse().ok()?;

    let expected_suffix = ordinal_suffix(num);
    if suffix_lower != expected_suffix {
        return None;
    }

    Some(num)
}

fn ordinal_suffix(n: i64) -> &'static str {
    let abs = n.unsigned_abs();
    let last_two = abs % 100;
    if (11..=13).contains(&last_two) {
        return "th";
    }
    match abs % 10 {
        1 => "st",
        2 => "nd",
        3 => "rd",
        _ => "th",
    }
}

pub(crate) fn detect_ordinal_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let texts = all_texts(values)?;
    if texts.is_empty() {
        return None;
    }

    let parsed: Vec<i64> = texts
        .iter()
        .map(|&t| parse_ordinal(t))
        .collect::<Option<Vec<_>>>()?;

    let start_index = parsed[0] as usize;

    if parsed.len() == 1 {
        return Some(FillPattern {
            pattern_type: FillPatternType::Ordinal,
            start_index: Some(start_index),
            step: Some(1.0),
            ..default_pattern()
        });
    }

    let step = parsed[1] - parsed[0];
    if step == 0 {
        return None;
    }

    for i in 2..parsed.len() {
        if parsed[i] - parsed[i - 1] != step {
            return None;
        }
    }

    Some(FillPattern {
        pattern_type: FillPatternType::Ordinal,
        start_index: Some(start_index),
        step: Some(step as f64),
        ..default_pattern()
    })
}

/// Parse "Item003" -> ("Item", 3, 3). Returns `(prefix, number, digit_count)`.
pub(crate) fn parse_text_number(s: &str) -> Option<(String, i64, usize)> {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }

    let mut digit_start = bytes.len();
    while digit_start > 0 && bytes[digit_start - 1].is_ascii_digit() {
        digit_start -= 1;
    }

    if digit_start == bytes.len() {
        return None;
    }

    let prefix = &s[..digit_start];
    let num_str = &s[digit_start..];
    let num: i64 = num_str.parse().ok()?;
    let num_digits = num_str.len();

    Some((prefix.to_string(), num, num_digits))
}

pub(crate) fn detect_text_with_number_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let texts = all_texts(values)?;
    if texts.is_empty() {
        return None;
    }

    let parsed: Vec<(String, i64, usize)> = texts
        .iter()
        .map(|&t| parse_text_number(t))
        .collect::<Option<Vec<_>>>()?;

    let prefix = &parsed[0].0;
    if !parsed.iter().all(|p| &p.0 == prefix) {
        return None;
    }

    if parsed.len() == 1 {
        let has_leading_zero = parsed[0].2 > 1
            && texts[0].ends_with(&format!("{:0>width$}", parsed[0].1, width = parsed[0].2));
        let num_digits = if has_leading_zero {
            Some(parsed[0].2)
        } else {
            None
        };
        return Some(FillPattern {
            pattern_type: FillPatternType::TextWithNumber,
            prefix: Some(prefix.clone()),
            step: Some(1.0),
            num_digits,
            ..default_pattern()
        });
    }

    let step = parsed[1].1 - parsed[0].1;
    if step == 0 {
        return None;
    }

    for i in 2..parsed.len() {
        if parsed[i].1 - parsed[i - 1].1 != step {
            return None;
        }
    }

    let first_digits = parsed[0].2;
    let has_leading_zero = first_digits > 1 && {
        let num_str = &texts[0][parsed[0].0.len()..];
        num_str.starts_with('0')
    };
    let consistent_padding = has_leading_zero && parsed.iter().all(|p| p.2 == first_digits);
    let num_digits = if consistent_padding {
        Some(first_digits)
    } else {
        None
    };

    Some(FillPattern {
        pattern_type: FillPatternType::TextWithNumber,
        prefix: Some(prefix.clone()),
        step: Some(step as f64),
        num_digits,
        ..default_pattern()
    })
}
