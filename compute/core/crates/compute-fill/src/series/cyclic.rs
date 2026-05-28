use value_types::CellValue;

use crate::types::{CustomList, FillPattern, LocaleNames};

use super::common::{anchor_text, generate_copy, positive_mod};

pub(super) fn generate_weekday(
    source_values: &[CellValue],
    count: usize,
    direction_mult: i32,
    locale: &LocaleNames,
) -> Vec<CellValue> {
    generate_cyclic_text(source_values, count, direction_mult, &locale.weekdays)
}

pub(super) fn generate_weekday_short(
    source_values: &[CellValue],
    count: usize,
    direction_mult: i32,
    locale: &LocaleNames,
) -> Vec<CellValue> {
    generate_cyclic_text(source_values, count, direction_mult, &locale.weekdays_short)
}

pub(super) fn generate_month(
    source_values: &[CellValue],
    count: usize,
    direction_mult: i32,
    locale: &LocaleNames,
) -> Vec<CellValue> {
    generate_cyclic_text(source_values, count, direction_mult, &locale.months)
}

pub(super) fn generate_month_short(
    source_values: &[CellValue],
    count: usize,
    direction_mult: i32,
    locale: &LocaleNames,
) -> Vec<CellValue> {
    generate_cyclic_text(source_values, count, direction_mult, &locale.months_short)
}

/// Generate cyclic text series (weekdays, months).
/// `names` is the array to cycle through (7 for weekdays, 12 for months).
fn generate_cyclic_text<const N: usize>(
    source_values: &[CellValue],
    count: usize,
    direction_mult: i32,
    names: &[String; N],
) -> Vec<CellValue> {
    let anchor = match anchor_text(source_values, direction_mult) {
        Some(s) => s,
        None => return generate_copy(source_values, count),
    };

    // Find the anchor in the names array (case-insensitive)
    let anchor_lower = anchor.to_lowercase();
    let start_idx = match names.iter().position(|n| n.to_lowercase() == anchor_lower) {
        Some(idx) => idx as i64,
        None => return generate_copy(source_values, count),
    };

    let n = N as i64;
    let mult = i64::from(direction_mult);
    (0..count)
        .map(|i| {
            let idx = positive_mod(start_idx + (i as i64 + 1) * mult, n);
            CellValue::Text(names[idx].as_str().into())
        })
        .collect()
}

pub(super) fn generate_quarter(
    pattern: &FillPattern,
    count: usize,
    direction_mult: i32,
) -> Vec<CellValue> {
    let start_idx = pattern.start_index.unwrap_or(0) as i64;
    let mult = i64::from(direction_mult);
    (0..count)
        .map(|i| {
            let idx = positive_mod(start_idx + (i as i64 + 1) * mult, 4);
            CellValue::Text(format!("Q{}", idx + 1).into())
        })
        .collect()
}

pub(super) fn generate_custom_list(
    source_values: &[CellValue],
    count: usize,
    direction_mult: i32,
    pattern: &FillPattern,
    custom_lists: &[CustomList],
) -> Vec<CellValue> {
    let list_id = match pattern.list_id.as_deref() {
        Some(id) => id,
        None => return generate_copy(source_values, count),
    };

    let list = match custom_lists.iter().find(|l| l.id == list_id) {
        Some(l) => l,
        None => return generate_copy(source_values, count),
    };

    if list.values.is_empty() {
        return generate_copy(source_values, count);
    }

    // Find anchor value in list (case-insensitive)
    let anchor = match anchor_text(source_values, direction_mult) {
        Some(s) => s,
        None => return generate_copy(source_values, count),
    };
    let anchor_lower = anchor.to_lowercase();
    let start_idx = match list
        .values
        .iter()
        .position(|v| v.to_lowercase() == anchor_lower)
    {
        Some(idx) => idx as i64,
        None => return generate_copy(source_values, count),
    };

    let n = list.values.len() as i64;
    let mult = i64::from(direction_mult);
    (0..count)
        .map(|i| {
            let idx = positive_mod(start_idx + (i as i64 + 1) * mult, n);
            CellValue::Text(list.values[idx].as_str().into())
        })
        .collect()
}
