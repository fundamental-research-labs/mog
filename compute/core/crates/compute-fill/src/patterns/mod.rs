//! Fill pattern detection — port of `fill-patterns.ts`.
//!
//! Examines a slice of `CellValue`s and returns the best-matching `FillPattern`.
//! Detection priority mirrors the TypeScript implementation exactly:
//!
//! 1. Empty input returns copy fallback
//! 2. Single-value special handling
//! 3. Date pattern
//! 4. Time pattern
//! 5. Weekday pattern
//! 6. Month pattern
//! 7. Quarter pattern
//! 8. Custom list pattern
//! 9. Ordinal pattern
//! 10. Text+number pattern
//! 11. Linear pattern
//! 12. Growth pattern
//! 13. Copy fallback

mod cyclic;
mod date_time;
mod locale;
mod numeric;
#[cfg(test)]
mod tests;
mod text_numeric;
mod values;

use value_types::CellValue;

use crate::types::{CustomList, FillPattern, FillPatternType, LocaleNames};

pub(crate) use cyclic::{detect_custom_list_pattern, detect_quarter_pattern, find_quarter_index};
pub(crate) use date_time::{detect_date_pattern, detect_time_pattern};
pub(crate) use locale::{
    detect_month_pattern, detect_weekday_pattern, find_month_index, find_weekday_index,
};
pub(crate) use numeric::{detect_growth_pattern, detect_linear_pattern};
pub(crate) use text_numeric::{
    detect_ordinal_pattern, detect_text_with_number_pattern, parse_ordinal, parse_text_number,
};

/// Detect the fill pattern from a sequence of cell values.
///
/// Returns `FillPattern` with `pattern_type == Copy` when no pattern is found
/// (including the empty-input case).
pub fn detect_fill_pattern(
    values: &[CellValue],
    custom_lists: &[CustomList],
    locale: &LocaleNames,
) -> FillPattern {
    if values.is_empty() {
        return copy_pattern();
    }

    if values.len() == 1 {
        return detect_single_value(&values[0], custom_lists, locale);
    }

    type Detector = fn(&[CellValue], &[CustomList], &LocaleNames) -> Option<FillPattern>;
    let detectors: &[Detector] = &[
        |v, _, _| detect_date_pattern(v),
        |v, _, _| detect_time_pattern(v),
        |v, _, l| detect_weekday_pattern(v, l),
        |v, _, l| detect_month_pattern(v, l),
        |v, _, _| detect_quarter_pattern(v),
        |v, cl, _| detect_custom_list_pattern(v, cl),
        |v, _, _| detect_ordinal_pattern(v),
        |v, _, _| detect_text_with_number_pattern(v),
        |v, _, _| detect_linear_pattern(v),
        |v, _, _| detect_growth_pattern(v),
    ];

    for detect in detectors {
        if let Some(pat) = detect(values, custom_lists, locale) {
            return pat;
        }
    }

    copy_pattern()
}

fn detect_single_value(
    value: &CellValue,
    custom_lists: &[CustomList],
    locale: &LocaleNames,
) -> FillPattern {
    // Single number -> Copy (repeat the constant).
    // Excel repeats a single numeric cell on drag; a series (increment) only
    // happens when there are 2+ values establishing a step, or when the user
    // explicitly chooses "Fill Series" / LinearTrend mode.
    if let CellValue::Number(_) = value {
        return copy_pattern();
    }

    // Single text: try ordinal, text+number, custom list, weekday, month.
    if let CellValue::Text(_) = value {
        let slice = std::slice::from_ref(value);
        if let Some(p) = detect_ordinal_pattern(slice) {
            return p;
        }
        if let Some(p) = detect_text_with_number_pattern(slice) {
            return p;
        }
        if let Some(p) = detect_custom_list_pattern(slice, custom_lists) {
            return p;
        }
        // Single weekday/month starts a cyclic series (e.g. "Mon" -> Tue, Wed, ...).
        if let Some(p) = detect_weekday_pattern(slice, locale) {
            return p;
        }
        if let Some(p) = detect_month_pattern(slice, locale) {
            return p;
        }
    }

    copy_pattern()
}

fn copy_pattern() -> FillPattern {
    FillPattern {
        pattern_type: FillPatternType::Copy,
        ..default_pattern()
    }
}

fn default_pattern() -> FillPattern {
    FillPattern {
        pattern_type: FillPatternType::Copy,
        step: None,
        multiplier: None,
        date_unit: None,
        time_unit: None,
        start_index: None,
        prefix: None,
        num_digits: None,
        list_id: None,
    }
}
