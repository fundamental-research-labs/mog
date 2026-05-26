//! Series generation — produce fill values from detected patterns.
//!
//! Given a [`FillPattern`] and source values, generates the next `count` values
//! in the series. Each pattern type has its own generation strategy.

use value_types::date_serial::add_months_to_serial;
use value_types::{CellValue, FiniteF64};

use crate::types::{CustomList, DateUnit, FillPattern, FillPatternType, LocaleNames, TimeUnit};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Generate `count` fill values for the given pattern, starting from the source values.
/// `direction_mult` is +1 for Down/Right, -1 for Up/Left.
pub fn generate_series_values(
    pattern: &FillPattern,
    source_values: &[CellValue],
    count: usize,
    direction_mult: i32,
    locale: &LocaleNames,
    custom_lists: &[CustomList],
) -> Vec<CellValue> {
    if count == 0 || source_values.is_empty() {
        return Vec::new();
    }

    match pattern.pattern_type {
        FillPatternType::Copy => generate_copy(source_values, count),
        FillPatternType::Linear => {
            let step = pattern.step.unwrap_or(1.0);
            generate_linear(source_values, count, step, direction_mult)
        }
        FillPatternType::Growth => {
            let multiplier = pattern.multiplier.unwrap_or(2.0);
            generate_growth(source_values, count, multiplier, direction_mult)
        }
        FillPatternType::Date => {
            let unit = pattern.date_unit.unwrap_or(DateUnit::Day);
            let step = pattern.step.unwrap_or(1.0) as i32;
            generate_date(source_values, count, unit, step, direction_mult)
        }
        FillPatternType::Time => {
            let unit = pattern.time_unit.unwrap_or(TimeUnit::Hour);
            let step = pattern.step.unwrap_or(1.0);
            generate_time(source_values, count, unit, step, direction_mult)
        }
        FillPatternType::Weekday => {
            generate_cyclic_text(source_values, count, direction_mult, &locale.weekdays)
        }
        FillPatternType::WeekdayShort => {
            generate_cyclic_text(source_values, count, direction_mult, &locale.weekdays_short)
        }
        FillPatternType::Month => {
            generate_cyclic_text(source_values, count, direction_mult, &locale.months)
        }
        FillPatternType::MonthShort => {
            generate_cyclic_text(source_values, count, direction_mult, &locale.months_short)
        }
        FillPatternType::Quarter => generate_quarter(pattern, count, direction_mult),
        FillPatternType::TextWithNumber => {
            let prefix = pattern.prefix.as_deref().unwrap_or("");
            let step = pattern.step.unwrap_or(1.0) as i64;
            let num_digits = pattern.num_digits.unwrap_or(0);
            generate_text_with_number(
                source_values,
                count,
                prefix,
                step,
                num_digits,
                direction_mult,
            )
        }
        FillPatternType::Ordinal => {
            let step = pattern.step.unwrap_or(1.0) as i64;
            generate_ordinal(source_values, count, step, direction_mult)
        }
        FillPatternType::CustomList => {
            generate_custom_list(source_values, count, direction_mult, pattern, custom_lists)
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Wrap an f64 into `CellValue::Number`, falling back to `CellValue::Error` for NaN/Inf.
fn num_or_error(v: f64) -> CellValue {
    match FiniteF64::new(v) {
        Some(f) => CellValue::Number(f),
        None => CellValue::Error(value_types::CellError::Value, None),
    }
}

/// Extract the f64 from the last source value (for forward) or first (for backward).
fn anchor_number(source_values: &[CellValue], direction_mult: i32) -> Option<f64> {
    let val = if direction_mult >= 0 {
        source_values.last()?
    } else {
        source_values.first()?
    };
    match val {
        CellValue::Number(f) => Some(f.get()),
        _ => None,
    }
}

/// Extract a &str from the anchor value.
fn anchor_text(source_values: &[CellValue], direction_mult: i32) -> Option<&str> {
    let val = if direction_mult >= 0 {
        source_values.last()?
    } else {
        source_values.first()?
    };
    match val {
        CellValue::Text(s) => Some(&**s),
        _ => None,
    }
}

/// Ordinal suffix for an integer (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, …).
fn ordinal_suffix(n: i64) -> &'static str {
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

/// Euclidean modulo that always returns a non-negative result.
fn positive_mod(a: i64, m: i64) -> usize {
    (a.rem_euclid(m)) as usize
}

// ---------------------------------------------------------------------------
// Pattern-specific generators
// ---------------------------------------------------------------------------

fn generate_copy(source_values: &[CellValue], count: usize) -> Vec<CellValue> {
    let len = source_values.len();
    (0..count).map(|i| source_values[i % len].clone()).collect()
}

fn generate_linear(
    source_values: &[CellValue],
    count: usize,
    step: f64,
    direction_mult: i32,
) -> Vec<CellValue> {
    let last = match anchor_number(source_values, 1) {
        Some(v) => v,
        None => return generate_copy(source_values, count),
    };
    let mult = f64::from(direction_mult);
    (0..count)
        .map(|i| num_or_error(last + step * (i as f64 + 1.0) * mult))
        .collect()
}

fn generate_growth(
    source_values: &[CellValue],
    count: usize,
    multiplier: f64,
    direction_mult: i32,
) -> Vec<CellValue> {
    let last = match anchor_number(source_values, 1) {
        Some(v) => v,
        None => return generate_copy(source_values, count),
    };
    let mut result = Vec::with_capacity(count);
    let mut current = last;
    for _ in 0..count {
        if direction_mult >= 0 {
            current *= multiplier;
        } else {
            current /= multiplier;
        }
        result.push(num_or_error(current));
    }
    result
}

fn generate_date(
    source_values: &[CellValue],
    count: usize,
    unit: DateUnit,
    step: i32,
    direction_mult: i32,
) -> Vec<CellValue> {
    let last_serial = match anchor_number(source_values, 1) {
        Some(v) => v,
        None => return generate_copy(source_values, count),
    };

    let mut result = Vec::with_capacity(count);
    let mut current_serial = last_serial;

    for _ in 0..count {
        match unit {
            DateUnit::Day => {
                current_serial += f64::from(step * direction_mult);
            }
            DateUnit::Weekday => {
                let mut days_remaining = (step * direction_mult).abs();
                let dir = if step * direction_mult > 0 { 1.0 } else { -1.0 };
                while days_remaining > 0 {
                    current_serial += dir;
                    if !is_weekend_serial(current_serial) {
                        days_remaining -= 1;
                    }
                }
            }
            DateUnit::Month => {
                current_serial = add_months_to_serial(current_serial, step * direction_mult);
            }
            DateUnit::Year => {
                current_serial = add_months_to_serial(current_serial, step * direction_mult * 12);
            }
        }
        result.push(num_or_error(current_serial));
    }
    result
}

/// Check if a serial date falls on a weekend (Saturday or Sunday).
///
/// Excel serial 1 = Jan 1, 1900 which was a Sunday.
/// So serial % 7: 0 = Saturday, 1 = Sunday, 2 = Monday, ..., 6 = Friday.
fn is_weekend_serial(serial: f64) -> bool {
    let day_int = serial.floor() as i64;
    let dow = day_int.rem_euclid(7);
    // 0 = Saturday, 1 = Sunday
    dow == 0 || dow == 1
}

fn generate_time(
    source_values: &[CellValue],
    count: usize,
    unit: TimeUnit,
    step: f64,
    direction_mult: i32,
) -> Vec<CellValue> {
    let last = match anchor_number(source_values, 1) {
        Some(v) => v,
        None => return generate_copy(source_values, count),
    };

    let increment_per_unit = match unit {
        TimeUnit::Hour => 1.0 / 24.0,
        TimeUnit::Minute => 1.0 / 1440.0,
        TimeUnit::Second => 1.0 / 86400.0,
    };

    let mult = f64::from(direction_mult);
    let mut result = Vec::with_capacity(count);
    let mut current = last;
    for _ in 0..count {
        current += step * mult * increment_per_unit;
        result.push(num_or_error(current));
    }
    result
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

fn generate_quarter(pattern: &FillPattern, count: usize, direction_mult: i32) -> Vec<CellValue> {
    let start_idx = pattern.start_index.unwrap_or(0) as i64;
    let mult = i64::from(direction_mult);
    (0..count)
        .map(|i| {
            let idx = positive_mod(start_idx + (i as i64 + 1) * mult, 4);
            CellValue::Text(format!("Q{}", idx + 1).into())
        })
        .collect()
}

fn generate_text_with_number(
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

fn generate_ordinal(
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

fn generate_custom_list(
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

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;
    use value_types::date_serial::ymd_to_serial;

    fn cv_num(v: f64) -> CellValue {
        CellValue::Number(FiniteF64::new(v).unwrap())
    }

    fn cv_text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn default_pattern(pt: FillPatternType) -> FillPattern {
        FillPattern {
            pattern_type: pt,
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

    fn extract_numbers(vals: &[CellValue]) -> Vec<f64> {
        vals.iter()
            .map(|v| match v {
                CellValue::Number(f) => f.get(),
                _ => panic!("expected Number, got {:?}", v),
            })
            .collect()
    }

    fn extract_texts(vals: &[CellValue]) -> Vec<String> {
        vals.iter()
            .map(|v| match v {
                CellValue::Text(s) => s.to_string(),
                _ => panic!("expected Text, got {:?}", v),
            })
            .collect()
    }

    fn locale() -> LocaleNames {
        LocaleNames::default()
    }

    // -----------------------------------------------------------------------
    // Copy
    // -----------------------------------------------------------------------

    #[test]
    fn copy_cycles_through_source() {
        let pat = default_pattern(FillPatternType::Copy);
        let src = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
        let result = generate_series_values(&pat, &src, 6, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![1.0, 2.0, 3.0, 1.0, 2.0, 3.0]);
    }

    #[test]
    fn copy_single_value() {
        let pat = default_pattern(FillPatternType::Copy);
        let src = vec![cv_text("x")];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["x", "x", "x"]);
    }

    // -----------------------------------------------------------------------
    // Linear
    // -----------------------------------------------------------------------

    #[test]
    fn linear_step_2_forward() {
        let mut pat = default_pattern(FillPatternType::Linear);
        pat.step = Some(2.0);
        let src = vec![cv_num(2.0), cv_num(4.0), cv_num(6.0)];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![8.0, 10.0, 12.0]);
    }

    #[test]
    fn linear_step_2_backward() {
        let mut pat = default_pattern(FillPatternType::Linear);
        pat.step = Some(2.0);
        let src = vec![cv_num(6.0), cv_num(4.0), cv_num(2.0)];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        // Last value is 2.0 (always uses last for linear), step=2, mult=-1
        // 2 + 2*1*(-1) = 0, 2 + 2*2*(-1) = -2, 2 + 2*3*(-1) = -4
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![0.0, -2.0, -4.0]);
    }

    #[test]
    fn linear_default_step() {
        let pat = default_pattern(FillPatternType::Linear);
        let src = vec![cv_num(10.0)];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![11.0, 12.0, 13.0]);
    }

    #[test]
    fn linear_fractional_step() {
        let mut pat = default_pattern(FillPatternType::Linear);
        pat.step = Some(0.5);
        let src = vec![cv_num(1.0)];
        let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![1.5, 2.0, 2.5, 3.0]);
    }

    // -----------------------------------------------------------------------
    // Growth
    // -----------------------------------------------------------------------

    #[test]
    fn growth_multiplier_2_forward() {
        let mut pat = default_pattern(FillPatternType::Growth);
        pat.multiplier = Some(2.0);
        let src = vec![cv_num(2.0), cv_num(4.0), cv_num(8.0)];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![16.0, 32.0, 64.0]);
    }

    #[test]
    fn growth_multiplier_2_backward() {
        let mut pat = default_pattern(FillPatternType::Growth);
        pat.multiplier = Some(2.0);
        let src = vec![cv_num(64.0)];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![32.0, 16.0, 8.0]);
    }

    #[test]
    fn growth_multiplier_3() {
        let mut pat = default_pattern(FillPatternType::Growth);
        pat.multiplier = Some(3.0);
        let src = vec![cv_num(1.0)];
        let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![3.0, 9.0, 27.0, 81.0]);
    }

    // -----------------------------------------------------------------------
    // Date — Day
    // -----------------------------------------------------------------------

    #[test]
    fn date_daily_forward() {
        // Jan 1, 2024 = serial
        let serial_jan1 = ymd_to_serial(2024, 1, 1);
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Day);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial_jan1)];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2024, 1, 2));
        assert_eq!(nums[1], ymd_to_serial(2024, 1, 3));
        assert_eq!(nums[2], ymd_to_serial(2024, 1, 4));
    }

    #[test]
    fn date_daily_step_3() {
        let serial_jan1 = ymd_to_serial(2024, 1, 1);
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Day);
        pat.step = Some(3.0);
        let src = vec![cv_num(serial_jan1)];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2024, 1, 4));
        assert_eq!(nums[1], ymd_to_serial(2024, 1, 7));
        assert_eq!(nums[2], ymd_to_serial(2024, 1, 10));
    }

    #[test]
    fn date_daily_backward() {
        let serial_jan5 = ymd_to_serial(2024, 1, 5);
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Day);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial_jan5)];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2024, 1, 4));
        assert_eq!(nums[1], ymd_to_serial(2024, 1, 3));
        assert_eq!(nums[2], ymd_to_serial(2024, 1, 2));
    }

    // -----------------------------------------------------------------------
    // Date — Weekday
    // -----------------------------------------------------------------------

    #[test]
    fn date_weekday_skips_weekend() {
        // Friday Jan 5, 2024: step=1 weekday should skip Sat/Sun and land on Mon Jan 8
        let serial_fri = ymd_to_serial(2024, 1, 5); // Friday
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Weekday);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial_fri)];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        // Next weekday after Fri = Mon Jan 8
        assert_eq!(nums[0], ymd_to_serial(2024, 1, 8));
        // Then Tue Jan 9
        assert_eq!(nums[1], ymd_to_serial(2024, 1, 9));
        // Then Wed Jan 10
        assert_eq!(nums[2], ymd_to_serial(2024, 1, 10));
    }

    #[test]
    fn date_weekday_backward_skips_weekend() {
        // Monday Jan 8, 2024: step=1 weekday backward should skip Sat/Sun and land on Fri Jan 5
        let serial_mon = ymd_to_serial(2024, 1, 8); // Monday
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Weekday);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial_mon)];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2024, 1, 5)); // Fri
        assert_eq!(nums[1], ymd_to_serial(2024, 1, 4)); // Thu
        assert_eq!(nums[2], ymd_to_serial(2024, 1, 3)); // Wed
    }

    // -----------------------------------------------------------------------
    // Date — Month
    // -----------------------------------------------------------------------

    #[test]
    fn date_monthly_forward() {
        let serial_jan15 = ymd_to_serial(2024, 1, 15);
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Month);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial_jan15)];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2024, 2, 15));
        assert_eq!(nums[1], ymd_to_serial(2024, 3, 15));
        assert_eq!(nums[2], ymd_to_serial(2024, 4, 15));
    }

    #[test]
    fn date_monthly_clamps_to_month_end() {
        // Jan 31 -> Feb 28 (or 29 in leap year 2024)
        let serial_jan31 = ymd_to_serial(2024, 1, 31);
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Month);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial_jan31)];
        let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2024, 2, 29)); // leap year
        assert_eq!(nums[1], ymd_to_serial(2024, 3, 29)); // clamped from 31
    }

    #[test]
    fn date_monthly_jan31_non_leap() {
        // Jan 31, 2025 -> Feb 28 (non-leap)
        let serial = ymd_to_serial(2025, 1, 31);
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Month);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial)];
        let result = generate_series_values(&pat, &src, 1, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2025, 2, 28));
    }

    // -----------------------------------------------------------------------
    // Date — Year
    // -----------------------------------------------------------------------

    #[test]
    fn date_yearly_forward() {
        let serial = ymd_to_serial(2024, 3, 15);
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Year);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial)];
        let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2025, 3, 15));
        assert_eq!(nums[1], ymd_to_serial(2026, 3, 15));
    }

    #[test]
    fn date_yearly_leap_day_clamps() {
        // Feb 29, 2024 -> Feb 28, 2025 (non-leap)
        let serial = ymd_to_serial(2024, 2, 29);
        let mut pat = default_pattern(FillPatternType::Date);
        pat.date_unit = Some(DateUnit::Year);
        pat.step = Some(1.0);
        let src = vec![cv_num(serial)];
        let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums[0], ymd_to_serial(2025, 2, 28));
        assert_eq!(nums[1], ymd_to_serial(2026, 2, 28));
    }

    // -----------------------------------------------------------------------
    // Time
    // -----------------------------------------------------------------------

    #[test]
    fn time_quarter_day_step() {
        let mut pat = default_pattern(FillPatternType::Time);
        pat.time_unit = Some(TimeUnit::Hour);
        pat.step = Some(6.0); // 6 hours = 0.25 day
        let src = vec![cv_num(0.25)]; // 6:00 AM
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert!((nums[0] - 0.5).abs() < 1e-10);
        assert!((nums[1] - 0.75).abs() < 1e-10);
        assert!((nums[2] - 1.0).abs() < 1e-10);
    }

    #[test]
    fn time_step_fractional_day_directly() {
        // Using step=0.25 with hour unit: 0.25 hours = 15 min
        let mut pat = default_pattern(FillPatternType::Time);
        pat.time_unit = Some(TimeUnit::Hour);
        pat.step = Some(1.0);
        let src = vec![cv_num(0.5)]; // 12:00
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        // 12:00 + 1h = 13:00 = 0.5 + 1/24
        assert!((nums[0] - (0.5 + 1.0 / 24.0)).abs() < 1e-10);
        assert!((nums[1] - (0.5 + 2.0 / 24.0)).abs() < 1e-10);
        assert!((nums[2] - (0.5 + 3.0 / 24.0)).abs() < 1e-10);
    }

    #[test]
    fn time_minute_step() {
        let mut pat = default_pattern(FillPatternType::Time);
        pat.time_unit = Some(TimeUnit::Minute);
        pat.step = Some(30.0);
        let src = vec![cv_num(0.5)]; // 12:00
        let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
        let nums = extract_numbers(&result);
        // 12:00 + 30min = 12:30 = 0.5 + 30/1440
        assert!((nums[0] - (0.5 + 30.0 / 1440.0)).abs() < 1e-10);
        assert!((nums[1] - (0.5 + 60.0 / 1440.0)).abs() < 1e-10);
    }

    #[test]
    fn time_backward() {
        let mut pat = default_pattern(FillPatternType::Time);
        pat.time_unit = Some(TimeUnit::Hour);
        pat.step = Some(1.0);
        let src = vec![cv_num(0.5)]; // 12:00
        let result = generate_series_values(&pat, &src, 2, -1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert!((nums[0] - (0.5 - 1.0 / 24.0)).abs() < 1e-10);
        assert!((nums[1] - (0.5 - 2.0 / 24.0)).abs() < 1e-10);
    }

    // -----------------------------------------------------------------------
    // Weekday
    // -----------------------------------------------------------------------

    #[test]
    fn weekday_forward() {
        let pat = default_pattern(FillPatternType::Weekday);
        let src = vec![cv_text("Monday")];
        let result = generate_series_values(&pat, &src, 5, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(
            texts,
            vec!["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        );
    }

    #[test]
    fn weekday_wraps_around() {
        let pat = default_pattern(FillPatternType::Weekday);
        let src = vec![cv_text("Saturday")];
        let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Sunday", "Monday"]);
    }

    #[test]
    fn weekday_backward() {
        let pat = default_pattern(FillPatternType::Weekday);
        let src = vec![cv_text("Wednesday")];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Tuesday", "Monday", "Sunday"]);
    }

    // -----------------------------------------------------------------------
    // WeekdayShort
    // -----------------------------------------------------------------------

    #[test]
    fn weekday_short_forward() {
        let pat = default_pattern(FillPatternType::WeekdayShort);
        let src = vec![cv_text("Mon")];
        let result = generate_series_values(&pat, &src, 5, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Tue", "Wed", "Thu", "Fri", "Sat"]);
    }

    #[test]
    fn weekday_short_backward() {
        let pat = default_pattern(FillPatternType::WeekdayShort);
        let src = vec![cv_text("Mon")];
        let result = generate_series_values(&pat, &src, 2, -1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Sun", "Sat"]);
    }

    // -----------------------------------------------------------------------
    // Month
    // -----------------------------------------------------------------------

    #[test]
    fn month_forward_wraps() {
        let pat = default_pattern(FillPatternType::Month);
        let src = vec![cv_text("November")];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["December", "January", "February"]);
    }

    #[test]
    fn month_backward() {
        let pat = default_pattern(FillPatternType::Month);
        let src = vec![cv_text("March")];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["February", "January", "December"]);
    }

    // -----------------------------------------------------------------------
    // MonthShort
    // -----------------------------------------------------------------------

    #[test]
    fn month_short_forward_wraps() {
        let pat = default_pattern(FillPatternType::MonthShort);
        let src = vec![cv_text("Nov")];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Dec", "Jan", "Feb"]);
    }

    #[test]
    fn month_short_backward() {
        let pat = default_pattern(FillPatternType::MonthShort);
        let src = vec![cv_text("Feb")];
        let result = generate_series_values(&pat, &src, 2, -1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Jan", "Dec"]);
    }

    // -----------------------------------------------------------------------
    // Quarter
    // -----------------------------------------------------------------------

    #[test]
    fn quarter_forward_wraps() {
        let mut pat = default_pattern(FillPatternType::Quarter);
        pat.start_index = Some(2); // Q3
        let src = vec![cv_text("Q3")];
        let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Q4", "Q1", "Q2", "Q3"]);
    }

    #[test]
    fn quarter_backward() {
        let mut pat = default_pattern(FillPatternType::Quarter);
        pat.start_index = Some(1); // Q2
        let src = vec![cv_text("Q2")];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Q1", "Q4", "Q3"]);
    }

    // -----------------------------------------------------------------------
    // TextWithNumber
    // -----------------------------------------------------------------------

    #[test]
    fn text_with_number_forward() {
        let mut pat = default_pattern(FillPatternType::TextWithNumber);
        pat.prefix = Some("Item".into());
        pat.step = Some(1.0);
        pat.num_digits = Some(0);
        let src = vec![cv_text("Item3")];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Item4", "Item5", "Item6"]);
    }

    #[test]
    fn text_with_number_zero_padded() {
        let mut pat = default_pattern(FillPatternType::TextWithNumber);
        pat.prefix = Some("File".into());
        pat.step = Some(1.0);
        pat.num_digits = Some(3);
        let src = vec![cv_text("File008")];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["File009", "File010", "File011"]);
    }

    #[test]
    fn text_with_number_backward() {
        let mut pat = default_pattern(FillPatternType::TextWithNumber);
        pat.prefix = Some("Row".into());
        pat.step = Some(1.0);
        pat.num_digits = Some(0);
        let src = vec![cv_text("Row5")];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Row4", "Row3", "Row2"]);
    }

    #[test]
    fn text_with_number_step_2() {
        let mut pat = default_pattern(FillPatternType::TextWithNumber);
        pat.prefix = Some("V".into());
        pat.step = Some(2.0);
        pat.num_digits = Some(0);
        let src = vec![cv_text("V10")];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["V12", "V14", "V16"]);
    }

    // -----------------------------------------------------------------------
    // Ordinal
    // -----------------------------------------------------------------------

    #[test]
    fn ordinal_forward() {
        let mut pat = default_pattern(FillPatternType::Ordinal);
        pat.step = Some(1.0);
        let src = vec![cv_text("1st")];
        let result = generate_series_values(&pat, &src, 5, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["2nd", "3rd", "4th", "5th", "6th"]);
    }

    #[test]
    fn ordinal_teens() {
        let mut pat = default_pattern(FillPatternType::Ordinal);
        pat.step = Some(1.0);
        let src = vec![cv_text("9th")];
        let result = generate_series_values(&pat, &src, 5, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["10th", "11th", "12th", "13th", "14th"]);
    }

    #[test]
    fn ordinal_twenties() {
        let mut pat = default_pattern(FillPatternType::Ordinal);
        pat.step = Some(1.0);
        let src = vec![cv_text("20th")];
        let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["21st", "22nd", "23rd", "24th"]);
    }

    #[test]
    fn ordinal_hundreds() {
        let mut pat = default_pattern(FillPatternType::Ordinal);
        pat.step = Some(1.0);
        let src = vec![cv_text("110th")];
        let result = generate_series_values(&pat, &src, 4, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["111th", "112th", "113th", "114th"]);
    }

    #[test]
    fn ordinal_backward() {
        let mut pat = default_pattern(FillPatternType::Ordinal);
        pat.step = Some(1.0);
        let src = vec![cv_text("5th")];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["4th", "3rd", "2nd"]);
    }

    #[test]
    fn ordinal_step_10() {
        let mut pat = default_pattern(FillPatternType::Ordinal);
        pat.step = Some(10.0);
        let src = vec![cv_text("10th")];
        let result = generate_series_values(&pat, &src, 3, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["20th", "30th", "40th"]);
    }

    // -----------------------------------------------------------------------
    // Ordinal suffix unit tests
    // -----------------------------------------------------------------------

    #[test]
    fn ordinal_suffix_correctness() {
        assert_eq!(ordinal_suffix(1), "st");
        assert_eq!(ordinal_suffix(2), "nd");
        assert_eq!(ordinal_suffix(3), "rd");
        assert_eq!(ordinal_suffix(4), "th");
        assert_eq!(ordinal_suffix(10), "th");
        assert_eq!(ordinal_suffix(11), "th");
        assert_eq!(ordinal_suffix(12), "th");
        assert_eq!(ordinal_suffix(13), "th");
        assert_eq!(ordinal_suffix(14), "th");
        assert_eq!(ordinal_suffix(21), "st");
        assert_eq!(ordinal_suffix(22), "nd");
        assert_eq!(ordinal_suffix(23), "rd");
        assert_eq!(ordinal_suffix(100), "th");
        assert_eq!(ordinal_suffix(101), "st");
        assert_eq!(ordinal_suffix(111), "th");
        assert_eq!(ordinal_suffix(112), "th");
        assert_eq!(ordinal_suffix(113), "th");
        assert_eq!(ordinal_suffix(121), "st");
    }

    // -----------------------------------------------------------------------
    // CustomList
    // -----------------------------------------------------------------------

    #[test]
    fn custom_list_forward() {
        let mut pat = default_pattern(FillPatternType::CustomList);
        pat.list_id = Some("priority".into());
        let lists = vec![CustomList {
            id: "priority".into(),
            values: vec!["High".into(), "Medium".into(), "Low".into()],
        }];
        let src = vec![cv_text("Medium")];
        let result = generate_series_values(&pat, &src, 4, 1, &locale(), &lists);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Low", "High", "Medium", "Low"]);
    }

    #[test]
    fn custom_list_backward() {
        let mut pat = default_pattern(FillPatternType::CustomList);
        pat.list_id = Some("priority".into());
        let lists = vec![CustomList {
            id: "priority".into(),
            values: vec!["High".into(), "Medium".into(), "Low".into()],
        }];
        let src = vec![cv_text("Medium")];
        let result = generate_series_values(&pat, &src, 4, -1, &locale(), &lists);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["High", "Low", "Medium", "High"]);
    }

    #[test]
    fn custom_list_case_insensitive() {
        let mut pat = default_pattern(FillPatternType::CustomList);
        pat.list_id = Some("priority".into());
        let lists = vec![CustomList {
            id: "priority".into(),
            values: vec!["High".into(), "Medium".into(), "Low".into()],
        }];
        let src = vec![cv_text("medium")]; // lowercase
        let result = generate_series_values(&pat, &src, 2, 1, &locale(), &lists);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Low", "High"]);
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn zero_count_returns_empty() {
        let pat = default_pattern(FillPatternType::Copy);
        let src = vec![cv_num(1.0)];
        let result = generate_series_values(&pat, &src, 0, 1, &locale(), &[]);
        assert!(result.is_empty());
    }

    #[test]
    fn empty_source_returns_empty() {
        let pat = default_pattern(FillPatternType::Linear);
        let result = generate_series_values(&pat, &[], 5, 1, &locale(), &[]);
        assert!(result.is_empty());
    }

    #[test]
    fn growth_backward_from_large() {
        let mut pat = default_pattern(FillPatternType::Growth);
        pat.multiplier = Some(10.0);
        let src = vec![cv_num(1000.0)];
        let result = generate_series_values(&pat, &src, 3, -1, &locale(), &[]);
        let nums = extract_numbers(&result);
        assert_eq!(nums, vec![100.0, 10.0, 1.0]);
    }

    #[test]
    fn is_weekend_serial_check() {
        // Jan 1, 1900 = serial 1, which was a Monday in real life,
        // but in Excel's world serial 1 maps to 1 % 7 = 1.
        // Let's verify our weekend logic with known dates.
        // Jan 5, 2024 = Friday. Let's check its serial.
        let fri = ymd_to_serial(2024, 1, 5);
        assert!(!is_weekend_serial(fri), "Friday should not be weekend");
        let sat = ymd_to_serial(2024, 1, 6);
        assert!(is_weekend_serial(sat), "Saturday should be weekend");
        let sun = ymd_to_serial(2024, 1, 7);
        assert!(is_weekend_serial(sun), "Sunday should be weekend");
        let mon = ymd_to_serial(2024, 1, 8);
        assert!(!is_weekend_serial(mon), "Monday should not be weekend");
    }

    #[test]
    fn weekday_case_insensitive_match() {
        let pat = default_pattern(FillPatternType::Weekday);
        let src = vec![cv_text("monday")]; // lowercase
        let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["Tuesday", "Wednesday"]);
    }

    #[test]
    fn month_case_insensitive_match() {
        let pat = default_pattern(FillPatternType::Month);
        let src = vec![cv_text("january")]; // lowercase
        let result = generate_series_values(&pat, &src, 2, 1, &locale(), &[]);
        let texts = extract_texts(&result);
        assert_eq!(texts, vec!["February", "March"]);
    }
}
