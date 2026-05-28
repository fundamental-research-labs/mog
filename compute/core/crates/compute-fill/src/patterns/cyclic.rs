use value_types::CellValue;

use crate::types::{CustomList, FillPattern, FillPatternType};

use super::default_pattern;
use super::values::all_texts;

/// Parse "Q1" -> 0, "Q2" -> 1, "Q3" -> 2, "Q4" -> 3.
pub(crate) fn find_quarter_index(name: &str) -> Option<usize> {
    let upper = name.trim().to_uppercase();
    match upper.as_str() {
        "Q1" => Some(0),
        "Q2" => Some(1),
        "Q3" => Some(2),
        "Q4" => Some(3),
        _ => None,
    }
}

pub(crate) fn detect_quarter_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let texts = all_texts(values)?;
    if texts.is_empty() {
        return None;
    }

    let start_index = find_quarter_index(texts[0])?;

    for (i, &text) in texts.iter().enumerate().skip(1) {
        let idx = find_quarter_index(text)?;
        let expected = (start_index + i) % 4;
        if idx != expected {
            return None;
        }
    }

    Some(FillPattern {
        pattern_type: FillPatternType::Quarter,
        start_index: Some(start_index),
        ..default_pattern()
    })
}

pub(crate) fn detect_custom_list_pattern(
    values: &[CellValue],
    custom_lists: &[CustomList],
) -> Option<FillPattern> {
    let texts = all_texts(values)?;
    if texts.is_empty() {
        return None;
    }

    let first_lower = texts[0].to_lowercase();
    let first_trimmed = first_lower.trim();

    for list in custom_lists {
        let norm_vals: Vec<String> = list.values.iter().map(|v| v.to_lowercase()).collect();
        let first_idx = norm_vals.iter().position(|v| v.trim() == first_trimmed);
        let first_idx = match first_idx {
            Some(i) => i,
            None => continue,
        };

        let mut ok = true;
        for (i, &text) in texts.iter().enumerate() {
            let expected_idx = (first_idx + i) % list.values.len();
            if norm_vals[expected_idx].trim() != text.to_lowercase().trim() {
                ok = false;
                break;
            }
        }
        if ok {
            return Some(FillPattern {
                pattern_type: FillPatternType::CustomList,
                start_index: Some(first_idx),
                list_id: Some(list.id.clone()),
                ..default_pattern()
            });
        }
    }

    None
}
