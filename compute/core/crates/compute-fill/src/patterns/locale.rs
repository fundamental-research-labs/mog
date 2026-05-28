use value_types::CellValue;

use crate::types::{FillPattern, FillPatternType, LocaleNames};

use super::default_pattern;
use super::values::all_texts;

/// Returns `(index_0_based, is_short)`.
pub(crate) fn find_weekday_index(name: &str, locale: &LocaleNames) -> Option<(usize, bool)> {
    let lower = name.to_lowercase();
    let trimmed = lower.trim();

    // Check full names first.
    for (i, wd) in locale.weekdays.iter().enumerate() {
        if wd.to_lowercase() == trimmed {
            return Some((i, false));
        }
    }
    // Check short names.
    for (i, wd) in locale.weekdays_short.iter().enumerate() {
        if wd.to_lowercase() == trimmed {
            return Some((i, true));
        }
    }
    None
}

pub(crate) fn detect_weekday_pattern(
    values: &[CellValue],
    locale: &LocaleNames,
) -> Option<FillPattern> {
    let texts = all_texts(values)?;
    if texts.is_empty() {
        return None;
    }

    let (start_index, is_short) = find_weekday_index(texts[0], locale)?;

    for (i, &text) in texts.iter().enumerate().skip(1) {
        let (idx, short) = find_weekday_index(text, locale)?;
        if short != is_short {
            return None;
        }
        let expected = (start_index + i) % 7;
        if idx != expected {
            return None;
        }
    }

    let pt = if is_short {
        FillPatternType::WeekdayShort
    } else {
        FillPatternType::Weekday
    };
    Some(FillPattern {
        pattern_type: pt,
        start_index: Some(start_index),
        ..default_pattern()
    })
}

/// Returns `(index_0_based, is_short)`.
pub(crate) fn find_month_index(name: &str, locale: &LocaleNames) -> Option<(usize, bool)> {
    let lower = name.to_lowercase();
    let trimmed = lower.trim();

    for (i, m) in locale.months.iter().enumerate() {
        if m.to_lowercase() == trimmed {
            return Some((i, false));
        }
    }
    for (i, m) in locale.months_short.iter().enumerate() {
        if m.to_lowercase() == trimmed {
            return Some((i, true));
        }
    }
    None
}

pub(crate) fn detect_month_pattern(
    values: &[CellValue],
    locale: &LocaleNames,
) -> Option<FillPattern> {
    let texts = all_texts(values)?;
    if texts.is_empty() {
        return None;
    }

    let (start_index, is_short) = find_month_index(texts[0], locale)?;

    for (i, &text) in texts.iter().enumerate().skip(1) {
        let (idx, short) = find_month_index(text, locale)?;
        if short != is_short {
            return None;
        }
        let expected = (start_index + i) % 12;
        if idx != expected {
            return None;
        }
    }

    let pt = if is_short {
        FillPatternType::MonthShort
    } else {
        FillPatternType::Month
    };
    Some(FillPattern {
        pattern_type: pt,
        start_index: Some(start_index),
        ..default_pattern()
    })
}
