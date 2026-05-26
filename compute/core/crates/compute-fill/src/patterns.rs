//! Fill pattern detection — port of `fill-patterns.ts`.
//!
//! Examines a slice of `CellValue`s and returns the best-matching `FillPattern`.
//! Detection priority mirrors the TypeScript implementation exactly:
//!
//! 1. Single-value special handling
//! 2. Date pattern
//! 3. Time pattern
//! 4. Weekday pattern
//! 5. Month pattern
//! 6. Quarter pattern
//! 7. Custom list pattern
//! 8. Ordinal pattern
//! 9. Text+number pattern
//! 10. Linear pattern
//! 11. Growth pattern
//! 12. Copy (fallback)

use value_types::CellValue;
use value_types::date_serial::serial_to_ymd;

use crate::types::{CustomList, DateUnit, FillPattern, FillPatternType, LocaleNames, TimeUnit};

/// Tolerance for floating-point comparisons (matches TS `1e-10`).
const TOLERANCE: f64 = 1e-10;

/// Excel valid date serial range: 1 .. 2_958_465 (1900-01-01 .. 9999-12-31).
const MIN_DATE_SERIAL: f64 = 1.0;
const MAX_DATE_SERIAL: f64 = 2_958_465.0;

// ─── public entry point ──────────────────────────────────────────────────────

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

    // ── Single-value special handling ────────────────────────────────────
    if values.len() == 1 {
        return detect_single_value(&values[0], custom_lists, locale);
    }

    // ── Multi-value: try detectors in priority order ─────────────────────
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

// ─── single-value logic ──────────────────────────────────────────────────────

fn detect_single_value(
    value: &CellValue,
    custom_lists: &[CustomList],
    locale: &LocaleNames,
) -> FillPattern {
    // Single number → Copy (repeat the constant).
    // Excel repeats a single numeric cell on drag; a series (increment) only
    // happens when there are 2+ values establishing a step, or when the user
    // explicitly chooses "Fill Series" / LinearTrend mode.
    if let CellValue::Number(_) = value {
        return copy_pattern();
    }

    // Single text: try ordinal, text+number, custom list, weekday, month
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
        // Single weekday/month starts a cyclic series (e.g. "Mon" → Tue, Wed, …)
        if let Some(p) = detect_weekday_pattern(slice, locale) {
            return p;
        }
        if let Some(p) = detect_month_pattern(slice, locale) {
            return p;
        }
    }

    copy_pattern()
}

// ─── individual pattern detectors ────────────────────────────────────────────

/// Extract all values as f64 if they are all `Number` variants.
fn all_numbers(values: &[CellValue]) -> Option<Vec<f64>> {
    let mut nums = Vec::with_capacity(values.len());
    for v in values {
        match v {
            CellValue::Number(n) => nums.push(n.get()),
            _ => return None,
        }
    }
    Some(nums)
}

/// Extract all values as `&str` if they are all `Text` variants.
fn all_texts(values: &[CellValue]) -> Option<Vec<&str>> {
    let mut texts = Vec::with_capacity(values.len());
    for v in values {
        match v {
            CellValue::Text(s) => texts.push(s.as_ref()),
            _ => return None,
        }
    }
    Some(texts)
}

fn is_valid_date_serial(serial: f64) -> bool {
    (MIN_DATE_SERIAL..=MAX_DATE_SERIAL).contains(&serial)
}

// ─── date ────────────────────────────────────────────────────────────────────

pub(crate) fn detect_date_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let nums = all_numbers(values)?;
    if nums.len() < 2 {
        return None;
    }
    // All must be valid date serials
    if !nums
        .iter()
        .all(|&n| n.is_finite() && is_valid_date_serial(n))
    {
        return None;
    }

    // Convert to (year, month, day) tuples
    let ymds: Vec<(i32, i32, i32)> = nums.iter().map(|&n| serial_to_ymd(n)).collect();

    // Day-based serial differences (integer serial diffs)
    let serial_ints: Vec<i64> = nums.iter().map(|&n| n.floor() as i64).collect();
    let day_diff = serial_ints[1] - serial_ints[0];

    if day_diff != 0 {
        let mut consistent = true;
        for i in 2..serial_ints.len() {
            if serial_ints[i] - serial_ints[i - 1] != day_diff {
                consistent = false;
                break;
            }
        }
        if consistent {
            // Check weekday-only pattern
            // day_of_week: 0=Sunday .. 6=Saturday (like JS Date.getDay())
            let dows: Vec<u32> = nums.iter().map(|&n| day_of_week_from_serial(n)).collect();
            let is_weekday_only = dows.iter().all(|&d| (1..=5).contains(&d));

            if is_weekday_only && (1..=5).contains(&day_diff) {
                let mut skipped_weekend = false;
                for i in 1..dows.len() {
                    let prev = dows[i - 1];
                    let curr = dows[i];
                    // Friday(5) → Monday(1) means we skipped a weekend
                    if prev == 5 && curr == 1 {
                        skipped_weekend = true;
                        break;
                    }
                    let expected = (prev + day_diff as u32) % 7;
                    if curr != expected && (curr == 1 || expected == 0 || expected == 6) {
                        skipped_weekend = true;
                        break;
                    }
                }
                if skipped_weekend {
                    return Some(FillPattern {
                        pattern_type: FillPatternType::Date,
                        date_unit: Some(DateUnit::Weekday),
                        step: Some(day_diff as f64),
                        ..default_pattern()
                    });
                }
            }

            return Some(FillPattern {
                pattern_type: FillPatternType::Date,
                date_unit: Some(DateUnit::Day),
                step: Some(day_diff as f64),
                ..default_pattern()
            });
        }
    }

    // Year increment (check before month so 12-month intervals → yearly)
    let year_diff = ymds[1].0 - ymds[0].0;
    if year_diff != 0 && ymds[0].1 == ymds[1].1 && ymds[0].2 == ymds[1].2 {
        let mut consistent = true;
        for i in 2..ymds.len() {
            let diff = ymds[i].0 - ymds[i - 1].0;
            if diff != year_diff || ymds[i].1 != ymds[0].1 || ymds[i].2 != ymds[0].2 {
                consistent = false;
                break;
            }
        }
        if consistent {
            return Some(FillPattern {
                pattern_type: FillPatternType::Date,
                date_unit: Some(DateUnit::Year),
                step: Some(year_diff as f64),
                ..default_pattern()
            });
        }
    }

    // Month increment
    let month_diff = (ymds[1].0 - ymds[0].0) * 12 + (ymds[1].1 - ymds[0].1);
    if month_diff != 0 && ymds[0].2 == ymds[1].2 {
        let mut consistent = true;
        for i in 2..ymds.len() {
            let diff = (ymds[i].0 - ymds[i - 1].0) * 12 + (ymds[i].1 - ymds[i - 1].1);
            if diff != month_diff || ymds[i].2 != ymds[0].2 {
                consistent = false;
                break;
            }
        }
        if consistent {
            return Some(FillPattern {
                pattern_type: FillPatternType::Date,
                date_unit: Some(DateUnit::Month),
                step: Some(month_diff as f64),
                ..default_pattern()
            });
        }
    }

    None
}

/// Compute day-of-week from an Excel serial number. 0=Sunday .. 6=Saturday.
/// Excel serial 1 = 1900-01-01 which was a Monday (dow=1).
fn day_of_week_from_serial(serial: f64) -> u32 {
    // serial 1 = Monday, serial 7 = Sunday.
    // (serial + 6) % 7 gives: 0=Saturday, 1=Sunday, ... 6=Friday — wrong.
    // Actually: serial 1=Mon, 2=Tue, ..., 6=Sat, 7=Sun.
    // So (serial_int % 7): 1=Mon,2=Tue,...,6=Sat,0=Sun.
    // We need JS convention: 0=Sun,1=Mon,...,6=Sat.
    let s = serial.floor() as i64;
    let r = ((s % 7) + 7) % 7; // ensure non-negative
    // r: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    r as u32
}

// ─── time ────────────────────────────────────────────────────────────────────

pub(crate) fn detect_time_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let nums = all_numbers(values)?;
    if nums.len() < 2 {
        return None;
    }

    // All must share the same integer part (same date)
    let int_parts: Vec<i64> = nums.iter().map(|&n| n.floor() as i64).collect();
    if !int_parts.iter().all(|&d| d == int_parts[0]) {
        return None;
    }

    let fractions: Vec<f64> = nums.iter().map(|&n| n % 1.0).collect();
    let time_diff = fractions[1] - fractions[0];
    if time_diff == 0.0 {
        return None;
    }

    for i in 2..fractions.len() {
        let diff = fractions[i] - fractions[i - 1];
        if (diff - time_diff).abs() > TOLERANCE {
            return None;
        }
    }

    let minutes_diff = (time_diff * 1440.0).round() as i64;
    let hours_diff = minutes_diff as f64 / 60.0;

    if hours_diff == hours_diff.floor() && hours_diff != 0.0 {
        return Some(FillPattern {
            pattern_type: FillPatternType::Time,
            time_unit: Some(TimeUnit::Hour),
            step: Some(hours_diff),
            ..default_pattern()
        });
    }
    if minutes_diff != 0 {
        return Some(FillPattern {
            pattern_type: FillPatternType::Time,
            time_unit: Some(TimeUnit::Minute),
            step: Some(minutes_diff as f64),
            ..default_pattern()
        });
    }

    None
}

// ─── weekday ─────────────────────────────────────────────────────────────────

/// Returns `(index_0_based, is_short)`.
pub(crate) fn find_weekday_index(name: &str, locale: &LocaleNames) -> Option<(usize, bool)> {
    let lower = name.to_lowercase();
    let trimmed = lower.trim();

    // Check full names first
    for (i, wd) in locale.weekdays.iter().enumerate() {
        if wd.to_lowercase() == trimmed {
            return Some((i, false));
        }
    }
    // Check short names
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

// ─── month ───────────────────────────────────────────────────────────────────

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

// ─── quarter ─────────────────────────────────────────────────────────────────

/// Parse "Q1" → 0, "Q2" → 1, "Q3" → 2, "Q4" → 3.
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

// ─── custom list ─────────────────────────────────────────────────────────────

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

        // Verify all values match in sequence
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

// ─── ordinal ─────────────────────────────────────────────────────────────────

/// Parse an ordinal string like "1st", "2nd", "3rd", "4th" → its numeric value.
/// Returns `None` if not a valid ordinal or the suffix doesn't match the number.
pub(crate) fn parse_ordinal(s: &str) -> Option<i64> {
    let s = s.trim();
    // Find where digits end
    let digit_end = s.bytes().position(|b| !b.is_ascii_digit())?;
    if digit_end == 0 {
        return None;
    }
    let num_str = &s[..digit_end];
    let suffix = &s[digit_end..];

    // Suffix must be exactly 2 chars: st, nd, rd, or th
    if suffix.len() != 2 {
        return None;
    }
    let suffix_lower = suffix.to_lowercase();

    let num: i64 = num_str.parse().ok()?;

    // Validate suffix matches the number
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

// ─── text + number ───────────────────────────────────────────────────────────

/// Parse "Item003" → ("Item", 3, 3).  Returns `(prefix, number, digit_count)`.
pub(crate) fn parse_text_number(s: &str) -> Option<(String, i64, usize)> {
    // Find the last run of digits at the end of the string
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }

    // Walk backward from end to find where digits start
    let mut digit_start = bytes.len();
    while digit_start > 0 && bytes[digit_start - 1].is_ascii_digit() {
        digit_start -= 1;
    }

    // Must have at least one digit at the end
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

    // All must share the same prefix
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

    // Determine leading-zero padding
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

// ─── linear ──────────────────────────────────────────────────────────────────

pub(crate) fn detect_linear_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let nums = all_numbers(values)?;
    if nums.len() < 2 {
        return None;
    }

    let step = nums[1] - nums[0];

    for i in 2..nums.len() {
        if (nums[i] - nums[i - 1] - step).abs() > TOLERANCE {
            return None;
        }
    }

    Some(FillPattern {
        pattern_type: FillPatternType::Linear,
        step: Some(step),
        ..default_pattern()
    })
}

// ─── growth ──────────────────────────────────────────────────────────────────

pub(crate) fn detect_growth_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let nums = all_numbers(values)?;
    if nums.len() < 2 {
        return None;
    }

    // All must be non-zero
    if nums.contains(&0.0) {
        return None;
    }

    let multiplier = nums[1] / nums[0];

    // Reject multiplier ≈ 1 (that's linear with step ≈ 0)
    if (multiplier - 1.0).abs() < TOLERANCE {
        return None;
    }

    for i in 2..nums.len() {
        if (nums[i] / nums[i - 1] - multiplier).abs() > TOLERANCE {
            return None;
        }
    }

    Some(FillPattern {
        pattern_type: FillPatternType::Growth,
        multiplier: Some(multiplier),
        ..default_pattern()
    })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use value_types::FiniteF64;
    use value_types::date_serial::ymd_to_serial;

    // Convenience helpers
    fn num(n: f64) -> CellValue {
        CellValue::Number(FiniteF64::new(n).unwrap())
    }

    fn text(s: &str) -> CellValue {
        CellValue::Text(Arc::from(s))
    }

    fn locale() -> LocaleNames {
        LocaleNames::default()
    }

    fn no_lists() -> Vec<CustomList> {
        vec![]
    }

    fn detect(values: &[CellValue]) -> FillPattern {
        detect_fill_pattern(values, &no_lists(), &locale())
    }

    fn detect_with_lists(values: &[CellValue], lists: &[CustomList]) -> FillPattern {
        detect_fill_pattern(values, lists, &locale())
    }

    // ── empty / single value ─────────────────────────────────────────────

    #[test]
    fn empty_returns_copy() {
        let p = detect(&[]);
        assert_eq!(p.pattern_type, FillPatternType::Copy);
    }

    #[test]
    fn single_number_returns_copy() {
        // Excel repeats a single constant on drag (Auto mode).
        let p = detect(&[num(5.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Copy);
    }

    #[test]
    fn single_zero_returns_copy() {
        // Regression: autoFill from a cell containing 0 must repeat 0, not
        // produce 0,1,2,… (see MOG_14_1 benchmark — 3 tasks affected).
        let p = detect(&[num(0.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Copy);
    }

    #[test]
    fn single_text_returns_copy() {
        let p = detect(&[text("hello")]);
        assert_eq!(p.pattern_type, FillPatternType::Copy);
    }

    #[test]
    fn single_boolean_returns_copy() {
        let p = detect(&[CellValue::Boolean(true)]);
        assert_eq!(p.pattern_type, FillPatternType::Copy);
    }

    #[test]
    fn single_null_returns_copy() {
        let p = detect(&[CellValue::Null]);
        assert_eq!(p.pattern_type, FillPatternType::Copy);
    }

    #[test]
    fn single_ordinal_returns_ordinal() {
        let p = detect(&[text("1st")]);
        assert_eq!(p.pattern_type, FillPatternType::Ordinal);
        assert_eq!(p.step, Some(1.0));
        assert_eq!(p.start_index, Some(1));
    }

    #[test]
    fn single_text_number_returns_text_with_number() {
        let p = detect(&[text("Item1")]);
        assert_eq!(p.pattern_type, FillPatternType::TextWithNumber);
        assert_eq!(p.prefix, Some("Item".to_string()));
        assert_eq!(p.step, Some(1.0));
    }

    // ── linear ───────────────────────────────────────────────────────────

    #[test]
    fn linear_ascending() {
        // Use negative values to avoid date serial range (>= 1)
        let p = detect(&[num(-6.0), num(-4.0), num(-2.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Linear);
        assert_eq!(p.step, Some(2.0));
    }

    #[test]
    fn linear_descending() {
        // Use negative values to avoid date serial range
        let p = detect(&[num(-4.0), num(-7.0), num(-10.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Linear);
        assert_eq!(p.step, Some(-3.0));
    }

    #[test]
    fn linear_two_values() {
        // Use negative values to avoid date serial range
        let p = detect(&[num(-3.0), num(-1.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Linear);
        assert_eq!(p.step, Some(2.0));
    }

    #[test]
    fn small_integers_detected_as_date() {
        // Small positive integers (>= 1) fall in date serial range → date wins
        let p = detect(&[num(2.0), num(4.0), num(6.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Date);
        assert_eq!(p.date_unit, Some(DateUnit::Day));
    }

    #[test]
    fn linear_fractional_step() {
        let p = detect(&[num(0.0), num(0.5), num(1.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Linear);
        assert!((p.step.unwrap() - 0.5).abs() < TOLERANCE);
    }

    #[test]
    fn linear_negative_values() {
        let p = detect(&[num(-6.0), num(-3.0), num(0.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Linear);
        assert_eq!(p.step, Some(3.0));
    }

    #[test]
    fn not_linear_inconsistent_step() {
        let p = detect(&[num(1.0), num(2.0), num(4.0)]);
        // This is growth (2, ×2)
        assert_ne!(p.pattern_type, FillPatternType::Linear);
    }

    #[test]
    fn linear_constant_step_zero() {
        // All same number → linear with step 0
        let p = detect(&[num(5.0), num(5.0), num(5.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Linear);
        assert_eq!(p.step, Some(0.0));
    }

    // ── tolerance boundary ───────────────────────────────────────────────

    #[test]
    fn linear_within_tolerance() {
        // Step should be 1.0, with tiny deviation below tolerance
        let p = detect(&[num(0.0), num(1.0), num(2.0 + 5e-11)]);
        assert_eq!(p.pattern_type, FillPatternType::Linear);
    }

    #[test]
    fn linear_outside_tolerance() {
        // Deviation exceeds 1e-10
        let p = detect(&[num(0.0), num(1.0), num(2.0 + 2e-10)]);
        assert_ne!(p.pattern_type, FillPatternType::Linear);
    }

    // ── growth ───────────────────────────────────────────────────────────

    #[test]
    fn growth_doubling() {
        let p = detect(&[num(2.0), num(4.0), num(8.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Growth);
        assert!((p.multiplier.unwrap() - 2.0).abs() < TOLERANCE);
    }

    #[test]
    fn growth_one_third() {
        let p = detect(&[num(81.0), num(27.0), num(9.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Growth);
        assert!((p.multiplier.unwrap() - 1.0 / 3.0).abs() < TOLERANCE);
    }

    #[test]
    fn growth_two_values() {
        // With only 2 values, linear always matches (any 2 points define a line).
        // Growth only wins for 3+ values where step is inconsistent but ratio is constant.
        let p = detect(&[num(-3.0), num(-9.0), num(-27.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Growth);
        assert!((p.multiplier.unwrap() - 3.0).abs() < TOLERANCE);
    }

    #[test]
    fn growth_rejected_when_multiplier_one() {
        // 5, 5, 5 → linear step 0, not growth
        let p = detect(&[num(5.0), num(5.0), num(5.0)]);
        assert_ne!(p.pattern_type, FillPatternType::Growth);
    }

    #[test]
    fn growth_rejected_when_zero_present() {
        let p = detect(&[num(0.0), num(1.0), num(2.0)]);
        // Should be linear, not growth (zero in sequence)
        assert_eq!(p.pattern_type, FillPatternType::Linear);
    }

    // ── date ─────────────────────────────────────────────────────────────

    #[test]
    fn date_daily() {
        // 2024-01-01 .. 2024-01-03 as serial numbers
        let s1 = ymd_to_serial(2024, 1, 1);
        let s2 = ymd_to_serial(2024, 1, 2);
        let s3 = ymd_to_serial(2024, 1, 3);
        let p = detect(&[num(s1), num(s2), num(s3)]);
        assert_eq!(p.pattern_type, FillPatternType::Date);
        assert_eq!(p.date_unit, Some(DateUnit::Day));
        assert_eq!(p.step, Some(1.0));
    }

    #[test]
    fn date_daily_step_7() {
        // Weekly: every 7 days
        let s1 = ymd_to_serial(2024, 1, 1);
        let s2 = ymd_to_serial(2024, 1, 8);
        let s3 = ymd_to_serial(2024, 1, 15);
        let p = detect(&[num(s1), num(s2), num(s3)]);
        assert_eq!(p.pattern_type, FillPatternType::Date);
        assert_eq!(p.date_unit, Some(DateUnit::Day));
        assert_eq!(p.step, Some(7.0));
    }

    #[test]
    fn date_monthly() {
        let s1 = ymd_to_serial(2024, 1, 15);
        let s2 = ymd_to_serial(2024, 2, 15);
        let s3 = ymd_to_serial(2024, 3, 15);
        let p = detect(&[num(s1), num(s2), num(s3)]);
        assert_eq!(p.pattern_type, FillPatternType::Date);
        assert_eq!(p.date_unit, Some(DateUnit::Month));
        assert_eq!(p.step, Some(1.0));
    }

    #[test]
    fn date_yearly() {
        let s1 = ymd_to_serial(2022, 6, 15);
        let s2 = ymd_to_serial(2023, 6, 15);
        let s3 = ymd_to_serial(2024, 6, 15);
        let p = detect(&[num(s1), num(s2), num(s3)]);
        assert_eq!(p.pattern_type, FillPatternType::Date);
        assert_eq!(p.date_unit, Some(DateUnit::Year));
        assert_eq!(p.step, Some(1.0));
    }

    #[test]
    fn date_twelve_month_interval_is_yearly() {
        // With only 2 values, day diff is always consistent so day wins.
        // Need 3+ values so that day diffs are inconsistent (365 vs 366 for leap year)
        // but year diffs are consistent.
        let s1 = ymd_to_serial(2019, 6, 15);
        let s2 = ymd_to_serial(2020, 6, 15);
        let s3 = ymd_to_serial(2021, 6, 15);
        let p = detect(&[num(s1), num(s2), num(s3)]);
        assert_eq!(p.pattern_type, FillPatternType::Date);
        assert_eq!(p.date_unit, Some(DateUnit::Year));
    }

    #[test]
    fn date_not_detected_for_non_date_serials() {
        // Values below MIN_DATE_SERIAL should not be treated as dates
        let p = detect(&[num(-5.0), num(-4.0), num(-3.0)]);
        assert_eq!(p.pattern_type, FillPatternType::Linear);
    }

    // ── time ─────────────────────────────────────────────────────────────

    #[test]
    fn time_hourly() {
        // 6:00, 12:00, 18:00 as fractional days
        let p = detect(&[num(0.25), num(0.5), num(0.75)]);
        assert_eq!(p.pattern_type, FillPatternType::Time);
        assert_eq!(p.time_unit, Some(TimeUnit::Hour));
        assert_eq!(p.step, Some(6.0));
    }

    #[test]
    fn time_thirty_minutes() {
        // 12:00, 12:30 as fractional days
        let half_hour = 30.0 / 1440.0;
        let p = detect(&[num(0.5), num(0.5 + half_hour)]);
        assert_eq!(p.pattern_type, FillPatternType::Time);
        assert_eq!(p.time_unit, Some(TimeUnit::Minute));
        assert_eq!(p.step, Some(30.0));
    }

    #[test]
    fn time_not_detected_across_dates() {
        // Different integer parts → different dates → not a time pattern
        let p = detect(&[num(1.25), num(2.5)]);
        // This would be detected as date (day step) or linear, not time
        assert_ne!(p.time_unit, Some(TimeUnit::Hour));
    }

    // ── weekday ──────────────────────────────────────────────────────────

    #[test]
    fn weekday_full() {
        let p = detect(&[text("Monday"), text("Tuesday"), text("Wednesday")]);
        assert_eq!(p.pattern_type, FillPatternType::Weekday);
        assert_eq!(p.start_index, Some(1)); // Monday=1 in Sunday-first
    }

    #[test]
    fn weekday_short() {
        let p = detect(&[text("Mon"), text("Tue"), text("Wed")]);
        assert_eq!(p.pattern_type, FillPatternType::WeekdayShort);
        assert_eq!(p.start_index, Some(1));
    }

    #[test]
    fn weekday_wraps_around() {
        let p = detect(&[
            text("Friday"),
            text("Saturday"),
            text("Sunday"),
            text("Monday"),
        ]);
        assert_eq!(p.pattern_type, FillPatternType::Weekday);
        assert_eq!(p.start_index, Some(5)); // Friday=5
    }

    #[test]
    fn weekday_case_insensitive() {
        let p = detect(&[text("monday"), text("tuesday")]);
        assert_eq!(p.pattern_type, FillPatternType::Weekday);
    }

    #[test]
    fn weekday_mixed_variant_rejected() {
        // "Monday" (full) + "Tue" (short) → not a weekday pattern
        let p = detect(&[text("Monday"), text("Tue")]);
        assert_ne!(p.pattern_type, FillPatternType::Weekday);
        assert_ne!(p.pattern_type, FillPatternType::WeekdayShort);
    }

    #[test]
    fn weekday_non_consecutive_rejected() {
        let p = detect(&[text("Monday"), text("Wednesday")]);
        // Not consecutive → falls through
        assert_ne!(p.pattern_type, FillPatternType::Weekday);
    }

    // ── month ────────────────────────────────────────────────────────────

    #[test]
    fn month_full() {
        let p = detect(&[text("January"), text("February"), text("March")]);
        assert_eq!(p.pattern_type, FillPatternType::Month);
        assert_eq!(p.start_index, Some(0));
    }

    #[test]
    fn month_short() {
        let p = detect(&[text("Jan"), text("Feb"), text("Mar")]);
        assert_eq!(p.pattern_type, FillPatternType::MonthShort);
        assert_eq!(p.start_index, Some(0));
    }

    #[test]
    fn month_wraps_around() {
        let p = detect(&[text("November"), text("December"), text("January")]);
        assert_eq!(p.pattern_type, FillPatternType::Month);
        assert_eq!(p.start_index, Some(10));
    }

    #[test]
    fn month_case_insensitive() {
        let p = detect(&[text("january"), text("february")]);
        assert_eq!(p.pattern_type, FillPatternType::Month);
    }

    #[test]
    fn month_non_consecutive_rejected() {
        let p = detect(&[text("January"), text("March")]);
        assert_ne!(p.pattern_type, FillPatternType::Month);
    }

    // ── quarter ──────────────────────────────────────────────────────────

    #[test]
    fn quarter_basic() {
        let p = detect(&[text("Q1"), text("Q2"), text("Q3")]);
        assert_eq!(p.pattern_type, FillPatternType::Quarter);
        assert_eq!(p.start_index, Some(0));
    }

    #[test]
    fn quarter_wraps_around() {
        let p = detect(&[text("Q3"), text("Q4"), text("Q1")]);
        assert_eq!(p.pattern_type, FillPatternType::Quarter);
        assert_eq!(p.start_index, Some(2));
    }

    #[test]
    fn quarter_case_insensitive() {
        let p = detect(&[text("q1"), text("q2")]);
        assert_eq!(p.pattern_type, FillPatternType::Quarter);
    }

    #[test]
    fn quarter_non_consecutive_rejected() {
        let p = detect(&[text("Q1"), text("Q3")]);
        assert_ne!(p.pattern_type, FillPatternType::Quarter);
    }

    // ── custom list ──────────────────────────────────────────────────────

    #[test]
    fn custom_list_basic() {
        let lists = vec![CustomList {
            id: "priority".into(),
            values: vec!["High".into(), "Medium".into(), "Low".into()],
        }];
        let p = detect_with_lists(&[text("High"), text("Medium"), text("Low")], &lists);
        assert_eq!(p.pattern_type, FillPatternType::CustomList);
        assert_eq!(p.list_id, Some("priority".into()));
        assert_eq!(p.start_index, Some(0));
    }

    #[test]
    fn custom_list_partial_match() {
        let lists = vec![CustomList {
            id: "dirs".into(),
            values: vec!["North".into(), "South".into(), "East".into(), "West".into()],
        }];
        let p = detect_with_lists(&[text("South"), text("East")], &lists);
        assert_eq!(p.pattern_type, FillPatternType::CustomList);
        assert_eq!(p.start_index, Some(1));
    }

    #[test]
    fn custom_list_wraps_around() {
        let lists = vec![CustomList {
            id: "dirs".into(),
            values: vec!["North".into(), "South".into(), "East".into(), "West".into()],
        }];
        let p = detect_with_lists(&[text("West"), text("North")], &lists);
        assert_eq!(p.pattern_type, FillPatternType::CustomList);
        assert_eq!(p.start_index, Some(3));
    }

    #[test]
    fn custom_list_case_insensitive() {
        let lists = vec![CustomList {
            id: "p".into(),
            values: vec!["High".into(), "Medium".into(), "Low".into()],
        }];
        let p = detect_with_lists(&[text("high"), text("medium")], &lists);
        assert_eq!(p.pattern_type, FillPatternType::CustomList);
    }

    #[test]
    fn custom_list_no_match() {
        let lists = vec![CustomList {
            id: "p".into(),
            values: vec!["High".into(), "Medium".into(), "Low".into()],
        }];
        let p = detect_with_lists(&[text("Foo"), text("Bar")], &lists);
        assert_ne!(p.pattern_type, FillPatternType::CustomList);
    }

    // ── ordinal ──────────────────────────────────────────────────────────

    #[test]
    fn ordinal_basic() {
        let p = detect(&[text("1st"), text("2nd"), text("3rd")]);
        assert_eq!(p.pattern_type, FillPatternType::Ordinal);
        assert_eq!(p.start_index, Some(1));
        assert_eq!(p.step, Some(1.0));
    }

    #[test]
    fn ordinal_step_two() {
        let p = detect(&[text("1st"), text("3rd"), text("5th")]);
        assert_eq!(p.pattern_type, FillPatternType::Ordinal);
        assert_eq!(p.step, Some(2.0));
    }

    #[test]
    fn ordinal_with_teens() {
        let p = detect(&[text("11th"), text("12th"), text("13th")]);
        assert_eq!(p.pattern_type, FillPatternType::Ordinal);
        assert_eq!(p.start_index, Some(11));
    }

    #[test]
    fn ordinal_wrong_suffix_rejected() {
        // "1nd" is not valid
        assert!(parse_ordinal("1nd").is_none());
    }

    #[test]
    fn ordinal_21st_valid() {
        assert_eq!(parse_ordinal("21st"), Some(21));
    }

    #[test]
    fn ordinal_113th_valid() {
        // 113 ends in 13 → special teen case → "th"
        assert_eq!(parse_ordinal("113th"), Some(113));
    }

    // ── text + number ────────────────────────────────────────────────────

    #[test]
    fn text_number_basic() {
        let p = detect(&[text("Item1"), text("Item2"), text("Item3")]);
        assert_eq!(p.pattern_type, FillPatternType::TextWithNumber);
        assert_eq!(p.prefix, Some("Item".into()));
        assert_eq!(p.step, Some(1.0));
        assert_eq!(p.num_digits, None);
    }

    #[test]
    fn text_number_with_padding() {
        let p = detect(&[text("File001"), text("File002"), text("File003")]);
        assert_eq!(p.pattern_type, FillPatternType::TextWithNumber);
        assert_eq!(p.prefix, Some("File".into()));
        assert_eq!(p.step, Some(1.0));
        assert_eq!(p.num_digits, Some(3));
    }

    #[test]
    fn text_number_step_two() {
        let p = detect(&[text("Row-5"), text("Row-7"), text("Row-9")]);
        assert_eq!(p.pattern_type, FillPatternType::TextWithNumber);
        assert_eq!(p.prefix, Some("Row-".into()));
        assert_eq!(p.step, Some(2.0));
    }

    #[test]
    fn text_number_different_prefix_rejected() {
        let p = detect(&[text("Item1"), text("Thing2")]);
        assert_ne!(p.pattern_type, FillPatternType::TextWithNumber);
    }

    #[test]
    fn text_number_no_digits_rejected() {
        let p = detect(&[text("Hello"), text("World")]);
        assert_ne!(p.pattern_type, FillPatternType::TextWithNumber);
    }

    // ── mixed types ──────────────────────────────────────────────────────

    #[test]
    fn mixed_number_and_text_returns_copy() {
        let p = detect(&[num(1.0), text("hello")]);
        assert_eq!(p.pattern_type, FillPatternType::Copy);
    }

    #[test]
    fn mixed_number_and_boolean_returns_copy() {
        let p = detect(&[num(1.0), CellValue::Boolean(true)]);
        assert_eq!(p.pattern_type, FillPatternType::Copy);
    }

    // ── priority order ───────────────────────────────────────────────────

    #[test]
    fn date_takes_priority_over_linear() {
        // Daily date serials are also a linear numeric series, but date wins
        let s1 = ymd_to_serial(2024, 1, 1);
        let s2 = ymd_to_serial(2024, 1, 2);
        let s3 = ymd_to_serial(2024, 1, 3);
        let p = detect(&[num(s1), num(s2), num(s3)]);
        assert_eq!(p.pattern_type, FillPatternType::Date);
    }

    #[test]
    fn time_takes_priority_over_linear() {
        // Hourly time fractions are also a linear series, but time wins
        let p = detect(&[num(0.25), num(0.5), num(0.75)]);
        // 0.25..0.75 are below MIN_DATE_SERIAL, so date detection won't fire.
        // But they also aren't same-date time patterns unless integer part is same.
        // Here integer parts are all 0, fractions differ → time wins.
        assert_eq!(p.pattern_type, FillPatternType::Time);
    }

    // ── locale-aware tests ───────────────────────────────────────────────

    #[test]
    fn german_weekday_names() {
        let german = LocaleNames {
            weekdays: [
                "Sonntag".into(),
                "Montag".into(),
                "Dienstag".into(),
                "Mittwoch".into(),
                "Donnerstag".into(),
                "Freitag".into(),
                "Samstag".into(),
            ],
            weekdays_short: [
                "So".into(),
                "Mo".into(),
                "Di".into(),
                "Mi".into(),
                "Do".into(),
                "Fr".into(),
                "Sa".into(),
            ],
            months: LocaleNames::default().months.clone(),
            months_short: LocaleNames::default().months_short.clone(),
        };
        let values = [text("Montag"), text("Dienstag"), text("Mittwoch")];
        let p = detect_fill_pattern(&values, &no_lists(), &german);
        assert_eq!(p.pattern_type, FillPatternType::Weekday);
        assert_eq!(p.start_index, Some(1));
    }

    #[test]
    fn french_month_names() {
        let french = LocaleNames {
            weekdays: LocaleNames::default().weekdays.clone(),
            weekdays_short: LocaleNames::default().weekdays_short.clone(),
            months: [
                "Janvier".into(),
                "Février".into(),
                "Mars".into(),
                "Avril".into(),
                "Mai".into(),
                "Juin".into(),
                "Juillet".into(),
                "Août".into(),
                "Septembre".into(),
                "Octobre".into(),
                "Novembre".into(),
                "Décembre".into(),
            ],
            months_short: [
                "Janv.".into(),
                "Févr.".into(),
                "Mars".into(),
                "Avr.".into(),
                "Mai".into(),
                "Juin".into(),
                "Juil.".into(),
                "Août".into(),
                "Sept.".into(),
                "Oct.".into(),
                "Nov.".into(),
                "Déc.".into(),
            ],
        };
        let values = [text("Janvier"), text("Février"), text("Mars")];
        let p = detect_fill_pattern(&values, &no_lists(), &french);
        assert_eq!(p.pattern_type, FillPatternType::Month);
        assert_eq!(p.start_index, Some(0));
    }

    // ── helper unit tests ────────────────────────────────────────────────

    #[test]
    fn parse_ordinal_valid_cases() {
        assert_eq!(parse_ordinal("1st"), Some(1));
        assert_eq!(parse_ordinal("2nd"), Some(2));
        assert_eq!(parse_ordinal("3rd"), Some(3));
        assert_eq!(parse_ordinal("4th"), Some(4));
        assert_eq!(parse_ordinal("11th"), Some(11));
        assert_eq!(parse_ordinal("12th"), Some(12));
        assert_eq!(parse_ordinal("13th"), Some(13));
        assert_eq!(parse_ordinal("21st"), Some(21));
        assert_eq!(parse_ordinal("22nd"), Some(22));
        assert_eq!(parse_ordinal("23rd"), Some(23));
        assert_eq!(parse_ordinal("100th"), Some(100));
    }

    #[test]
    fn parse_ordinal_invalid_cases() {
        assert_eq!(parse_ordinal("1nd"), None);
        assert_eq!(parse_ordinal("2st"), None);
        assert_eq!(parse_ordinal("11st"), None); // 11 → th
        assert_eq!(parse_ordinal("abc"), None);
        assert_eq!(parse_ordinal(""), None);
        assert_eq!(parse_ordinal("1"), None); // no suffix
        assert_eq!(parse_ordinal("st"), None); // no number
    }

    #[test]
    fn parse_text_number_valid() {
        assert_eq!(parse_text_number("Item003"), Some(("Item".into(), 3, 3)));
        assert_eq!(parse_text_number("Row1"), Some(("Row".into(), 1, 1)));
        assert_eq!(parse_text_number("A-10"), Some(("A-".into(), 10, 2)));
        assert_eq!(parse_text_number("123"), Some(("".into(), 123, 3)));
    }

    #[test]
    fn parse_text_number_invalid() {
        assert_eq!(parse_text_number("Hello"), None);
        assert_eq!(parse_text_number(""), None);
    }

    #[test]
    fn find_quarter_index_valid() {
        assert_eq!(find_quarter_index("Q1"), Some(0));
        assert_eq!(find_quarter_index("Q2"), Some(1));
        assert_eq!(find_quarter_index("Q3"), Some(2));
        assert_eq!(find_quarter_index("Q4"), Some(3));
        assert_eq!(find_quarter_index("q1"), Some(0));
    }

    #[test]
    fn find_quarter_index_invalid() {
        assert_eq!(find_quarter_index("Q5"), None);
        assert_eq!(find_quarter_index("hello"), None);
    }

    #[test]
    fn find_weekday_index_basics() {
        let loc = locale();
        assert_eq!(find_weekday_index("Sunday", &loc), Some((0, false)));
        assert_eq!(find_weekday_index("Mon", &loc), Some((1, true)));
        assert_eq!(find_weekday_index("saturday", &loc), Some((6, false)));
        assert_eq!(find_weekday_index("xyz", &loc), None);
    }

    #[test]
    fn find_month_index_basics() {
        let loc = locale();
        assert_eq!(find_month_index("January", &loc), Some((0, false)));
        assert_eq!(find_month_index("Dec", &loc), Some((11, true)));
        assert_eq!(find_month_index("xyz", &loc), None);
    }

    #[test]
    fn day_of_week_serial_1_is_monday() {
        // Serial 1 = 1900-01-01 = Monday = 1
        assert_eq!(day_of_week_from_serial(1.0), 1);
    }

    #[test]
    fn day_of_week_serial_7_is_sunday() {
        // Serial 7 = 1900-01-07 = Sunday = 0
        assert_eq!(day_of_week_from_serial(7.0), 0);
    }
}
