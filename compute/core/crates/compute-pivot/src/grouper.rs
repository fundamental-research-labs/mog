//! Pivot grouping helpers -- date grouping, number grouping, key normalization.
//!
//! This module provides the pure functions used by the pivot engine to bucket
//! values into date or number groups and to normalize cell values into
//! deterministic string keys.
//!
//! - **Date grouping**: buckets serial-date numbers into Year, Quarter, Month,
//!   Week (Excel convention: Sunday start, Week 1 contains Jan 1), Day, Hour,
//!   Minute, Second.
//! - **Number grouping**: buckets numbers into equal-width intervals with
//!   precision-aware labels that avoid floating-point drift.
//! - **Key normalization**: delegates to [`super::values::cell_value_to_key`]
//!   for type-prefixed, collision-free string keys.

use chrono::Datelike;

use value_types::CellValue;
use value_types::date_serial::serial_to_date;

use super::types::{DateGrouping, NumberGrouping};
use super::values::{GroupKey, cell_value_to_group_key, cell_value_to_key};

// ============================================================================
// Date grouping
// ============================================================================

/// Apply date grouping to a value.
///
/// Converts an Excel serial date number into a grouped representation
/// (year, quarter, month name, week number, day, hour, minute, second).
///
/// # Day grouping (Excel parity)
///
/// Day grouping always returns the day-of-month number.  This matches Excel's
/// behavior where Day grouping is designed to be used within a Year > Month > Day
/// hierarchy.  Standalone Day grouping will merge dates from different months
/// that share the same day-of-month (e.g., Jan 15 and Feb 15 both become 15).
///
/// # Week grouping (Excel convention)
///
/// Uses Excel-style weeks: Sunday is the first day of the week, and Week 1
/// contains January 1 regardless of what day it falls on.  This differs from
/// ISO 8601 which uses Monday start and the first-Thursday rule.
#[must_use]
pub fn apply_date_grouping(value: &CellValue, grouping: DateGrouping) -> CellValue {
    match value {
        CellValue::Null => CellValue::Null,
        CellValue::Number(serial) => {
            if serial.is_nan() || serial.is_infinite() {
                return value.clone();
            }

            // Hour/Minute/Second: extract from fractional part of serial number.
            // This works for both full dates (e.g., 44927.75 = some date at 6 PM)
            // and time-only values (e.g., 0.75 = 6:00 PM) where serial_to_date
            // returns None.
            match grouping {
                DateGrouping::Hour => {
                    let frac = serial.get() - serial.floor();
                    // Safety: frac is in [0, 1), so frac * 86400 is in [0, 86400) — fits in u32.
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    let total_seconds = (frac * 86400.0).round() as u32;
                    return CellValue::number(f64::from(total_seconds / 3600));
                }
                DateGrouping::Minute => {
                    let frac = serial.get() - serial.floor();
                    // Safety: frac is in [0, 1), so frac * 86400 is in [0, 86400) — fits in u32.
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    let total_seconds = (frac * 86400.0).round() as u32;
                    return CellValue::number(f64::from((total_seconds % 3600) / 60));
                }
                DateGrouping::Second => {
                    let frac = serial.get() - serial.floor();
                    // Safety: frac is in [0, 1), so frac * 86400 is in [0, 86400) — fits in u32.
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    let total_seconds = (frac * 86400.0).round() as u32;
                    return CellValue::number(f64::from(total_seconds % 60));
                }
                _ => {}
            }

            // Year/Quarter/Month/Week/Day: need a valid date from serial_to_date.
            if let Some(date) = serial_to_date(serial.get()) {
                match grouping {
                    DateGrouping::Year => CellValue::number(f64::from(date.year())),
                    DateGrouping::Quarter => {
                        CellValue::Text(format!("Q{}", (date.month() - 1) / 3 + 1).into())
                    }
                    DateGrouping::Month => {
                        let month_name = match date.month() {
                            1 => "January",
                            2 => "February",
                            3 => "March",
                            4 => "April",
                            5 => "May",
                            6 => "June",
                            7 => "July",
                            8 => "August",
                            9 => "September",
                            10 => "October",
                            11 => "November",
                            12 => "December",
                            _ => unreachable!(),
                        };
                        CellValue::Text(month_name.to_string().into())
                    }
                    DateGrouping::Week => {
                        CellValue::Text(format!("Week {}", excel_week_number(date)).into())
                    }
                    DateGrouping::Day => CellValue::number(f64::from(date.day())),
                    // Hour/Minute/Second already handled above
                    _ => unreachable!(),
                }
            } else {
                // Time-only values (serial < 1.0) for date groupings return raw value
                value.clone()
            }
        }
        _ => value.clone(),
    }
}

/// Compute the Excel-style week number for a date.
///
/// Excel uses Sunday as the first day of the week.  Week 1 always contains
/// January 1.  This means Dec 31 can be Week 53 (or 54 on leap years).
///
/// The formula: `((day_of_year - 1 + weekday_of_jan1_from_sunday) / 7) + 1`
fn excel_week_number(date: chrono::NaiveDate) -> u32 {
    let jan1 = chrono::NaiveDate::from_ymd_opt(date.year(), 1, 1).unwrap();
    let jan1_weekday = jan1.weekday().num_days_from_sunday(); // Sunday = 0
    let day_of_year = date.ordinal(); // 1-based
    ((day_of_year - 1 + jan1_weekday) / 7) + 1
}

// ============================================================================
// Number grouping
// ============================================================================

/// Apply number grouping to a value.
///
/// Buckets a number into an interval range string like `"10 - 19"`.
/// Values below the start produce `"< start"`, values at or above end produce `">= end"`.
///
/// Bucket boundaries are rounded to the same decimal precision as the interval
/// to prevent floating-point label drift (e.g., `"0.30000000000000004"` when
/// using interval 0.1).
#[must_use]
pub fn apply_number_grouping(value: &CellValue, grouping: &NumberGrouping) -> CellValue {
    // Validate number grouping parameters
    if !grouping.interval.is_finite()
        || grouping.interval <= 0.0
        || !grouping.start.is_finite()
        || !grouping.end.is_finite()
    {
        return value.clone();
    }
    if grouping.start >= grouping.end {
        return value.clone();
    }

    match value {
        CellValue::Number(n) => {
            let val = n.get();

            // Guard against NaN/Infinity input value
            if !val.is_finite() {
                return value.clone();
            }
            let start = grouping.start;
            let end = grouping.end;
            let interval = grouping.interval;
            let precision = decimal_precision(interval);

            // Value below range
            if val < start {
                return CellValue::Text(
                    format!(
                        "< {}",
                        format_grouping_number(round_to_precision(start, precision))
                    )
                    .into(),
                );
            }
            // Value above range
            if val >= end {
                return CellValue::Text(
                    format!(
                        ">= {}",
                        format_grouping_number(round_to_precision(end, precision))
                    )
                    .into(),
                );
            }

            // Find the bucket.
            // Round the quotient before flooring to avoid floating-point drift:
            // e.g. (0.3 - 0.0) / 0.1 = 2.9999999999999996 in f64, which would
            // floor to 2 instead of the correct 3.  Rounding to (precision + 6)
            // decimals eliminates the sub-ulp error while preserving the true
            // bucket boundary.
            let raw_quotient = (val - start) / interval;
            let snap_precision = precision + 6;
            // Safety: bucket index is bounded by (end - start) / interval, always a small integer.
            #[allow(clippy::cast_possible_truncation)]
            let bucket_index = round_to_precision(raw_quotient, snap_precision).floor() as i64;
            // Safety: bucket_index is a small integer derived from interval division, no precision loss.
            #[allow(clippy::cast_precision_loss)]
            let bucket_start =
                round_to_precision(start + bucket_index as f64 * interval, precision);
            let bucket_end = round_to_precision((bucket_start + interval).min(end), precision);

            let label_end = if interval.fract() == 0.0 {
                bucket_end - 1.0 // Integer interval: inclusive upper bound (Excel convention)
            } else {
                bucket_end // Non-integer interval: show exact upper bound
            };
            CellValue::Text(
                format!(
                    "{} - {}",
                    format_grouping_number(bucket_start),
                    format_grouping_number(label_end)
                )
                .into(),
            )
        }
        _ => value.clone(),
    }
}

/// Format a number for grouping display: integers as integers, floats as floats.
fn format_grouping_number(n: f64) -> String {
    // Safety: exact equality is intentional — we want to detect integers (no fractional part).
    #[allow(clippy::float_cmp)]
    let is_integer = n == n.trunc() && n.abs() < 1e15;
    if is_integer {
        // Safety: guarded by n.abs() < 1e15, well within i64 range.
        #[allow(clippy::cast_possible_truncation)]
        let int_val = n as i64;
        format!("{int_val}")
    } else {
        format!("{n}")
    }
}

/// Round a value to a given number of decimal places.
///
/// Used to snap bucket boundaries to the interval's precision so that
/// accumulated floating-point error doesn't leak into labels.
fn round_to_precision(value: f64, precision: u32) -> f64 {
    // Safety: precision is a small decimal count (0-15), well within i32 range.
    #[allow(clippy::cast_possible_wrap)]
    let factor = 10_f64.powi(precision as i32);
    (value * factor).round() / factor
}

/// Determine the number of decimal places in a float's shortest representation.
///
/// `decimal_precision(0.1)` returns 1, `decimal_precision(2.5)` returns 1,
/// `decimal_precision(10.0)` returns 0.
fn decimal_precision(interval: f64) -> u32 {
    let s = format!("{interval}");
    // Safety: decimal precision of a formatted f64 is at most ~17 digits, fits in u32.
    #[allow(clippy::cast_possible_truncation)]
    s.find('.').map_or(0, |dot| (s.len() - dot - 1) as u32)
}

// ============================================================================
// Key normalization
// ============================================================================

/// Normalize a value to a structural [`GroupKey`].
///
/// Thin delegation to the canonical [`cell_value_to_group_key`] from
/// `values.rs`. Typed variants prevent cross-type collisions (Number vs
/// Text) and eliminate the in-band `\x00BLANK\x00` / `\x00ARRAY\x00`
/// sentinels that the string form carries for wire-format compatibility.
#[must_use]
pub fn normalize_to_group_key(value: &CellValue) -> GroupKey {
    cell_value_to_group_key(value)
}

/// Normalize a value to the wire-format string key.
///
/// Retained for callers that write into `HashMap<String, _>` structures
/// shared with the XLSX parser or persisted filter state. New engine-
/// internal code should prefer [`normalize_to_group_key`].
#[must_use]
pub fn normalize_to_key(value: &CellValue) -> String {
    cell_value_to_key(value).into_owned()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use value_types::CellError;
    use value_types::date_serial::date_to_serial;

    // ---- apply_date_grouping ----

    #[test]
    fn date_grouping_year() {
        // 2024-06-15
        let date = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let serial = date_to_serial(&date);
        let result = apply_date_grouping(&CellValue::number(serial), DateGrouping::Year);
        assert_eq!(result, CellValue::number(2024.0));
    }

    #[test]
    fn date_grouping_quarter() {
        let date = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let serial = date_to_serial(&date);
        let result = apply_date_grouping(&CellValue::number(serial), DateGrouping::Quarter);
        assert_eq!(result, CellValue::Text("Q2".into()));

        // January -> Q1
        let jan = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let serial_jan = date_to_serial(&jan);
        let result_jan = apply_date_grouping(&CellValue::number(serial_jan), DateGrouping::Quarter);
        assert_eq!(result_jan, CellValue::Text("Q1".into()));

        // October -> Q4
        let oct = NaiveDate::from_ymd_opt(2024, 10, 1).unwrap();
        let serial_oct = date_to_serial(&oct);
        let result_oct = apply_date_grouping(&CellValue::number(serial_oct), DateGrouping::Quarter);
        assert_eq!(result_oct, CellValue::Text("Q4".into()));
    }

    #[test]
    fn date_grouping_month() {
        let date = NaiveDate::from_ymd_opt(2024, 3, 10).unwrap();
        let serial = date_to_serial(&date);
        let result = apply_date_grouping(&CellValue::number(serial), DateGrouping::Month);
        assert_eq!(result, CellValue::Text("March".into()));
    }

    #[test]
    fn date_grouping_week_excel_convention() {
        // Jan 1, 2023 is a Sunday.
        // ISO: Week 52 of 2022.  Excel: Week 1 of 2023.
        let date = NaiveDate::from_ymd_opt(2023, 1, 1).unwrap();
        let serial = date_to_serial(&date);
        let result = apply_date_grouping(&CellValue::number(serial), DateGrouping::Week);
        assert_eq!(result, CellValue::Text("Week 1".into()));
    }

    #[test]
    fn date_grouping_week_mid_january() {
        // Jan 8, 2024 (Monday).  Jan 1, 2024 is Monday.
        // jan1_weekday_from_sunday = 1 (Monday).
        // day_of_year for Jan 8 = 8.
        // ((8-1+1)/7)+1 = (8/7)+1 = 1+1 = 2.
        let date = NaiveDate::from_ymd_opt(2024, 1, 8).unwrap();
        let serial = date_to_serial(&date);
        let result = apply_date_grouping(&CellValue::number(serial), DateGrouping::Week);
        assert_eq!(result, CellValue::Text("Week 2".into()));
    }

    #[test]
    fn date_grouping_day() {
        let date = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let serial = date_to_serial(&date);
        let result = apply_date_grouping(&CellValue::number(serial), DateGrouping::Day);
        assert_eq!(result, CellValue::number(15.0));
    }

    #[test]
    fn date_grouping_null_returns_null() {
        let result = apply_date_grouping(&CellValue::Null, DateGrouping::Year);
        assert_eq!(result, CellValue::Null);
    }

    #[test]
    fn date_grouping_non_number_returns_as_is() {
        let text = CellValue::Text("hello".into());
        let result = apply_date_grouping(&text, DateGrouping::Year);
        assert_eq!(result, CellValue::Text("hello".into()));
    }

    #[test]
    fn date_grouping_hour_minute_second() {
        // A serial with time component: noon on 2024-06-15
        let date = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let serial = date_to_serial(&date) + 0.5; // 0.5 = noon (12:00:00)
        let hour = apply_date_grouping(&CellValue::number(serial), DateGrouping::Hour);
        assert_eq!(hour, CellValue::number(12.0));

        // 6:30:45 PM = 18*3600 + 30*60 + 45 = 66645 seconds, / 86400 = ~0.77135
        let frac = (18.0 * 3600.0 + 30.0 * 60.0 + 45.0) / 86400.0;
        let serial2 = date_to_serial(&date) + frac;
        let hour2 = apply_date_grouping(&CellValue::number(serial2), DateGrouping::Hour);
        assert_eq!(hour2, CellValue::number(18.0));
        let min2 = apply_date_grouping(&CellValue::number(serial2), DateGrouping::Minute);
        assert_eq!(min2, CellValue::number(30.0));
        let sec2 = apply_date_grouping(&CellValue::number(serial2), DateGrouping::Second);
        assert_eq!(sec2, CellValue::number(45.0));
    }

    #[test]
    fn date_grouping_time_only_hour() {
        // 0.75 = 18:00:00 (6 PM) -- time-only serial (no date component)
        let result = apply_date_grouping(&CellValue::number(0.75), DateGrouping::Hour);
        assert_eq!(result, CellValue::number(18.0));
    }

    #[test]
    fn date_grouping_time_only_minute() {
        // 12:15:00 = (12*3600 + 15*60) / 86400 = 0.510416...
        let frac = (12.0 * 3600.0 + 15.0 * 60.0) / 86400.0;
        let result = apply_date_grouping(&CellValue::number(frac), DateGrouping::Minute);
        assert_eq!(result, CellValue::number(15.0));
    }

    #[test]
    fn date_grouping_time_only_second() {
        // 12:00:30 = (12*3600 + 30) / 86400 = 0.500347...
        let frac = (12.0 * 3600.0 + 30.0) / 86400.0;
        let result = apply_date_grouping(&CellValue::number(frac), DateGrouping::Second);
        assert_eq!(result, CellValue::number(30.0));
    }

    // ---- excel_week_number ----

    #[test]
    fn excel_week_jan1_sunday() {
        // Jan 1, 2023 is Sunday.  Excel: Week 1.
        let date = NaiveDate::from_ymd_opt(2023, 1, 1).unwrap();
        assert_eq!(excel_week_number(date), 1);
    }

    #[test]
    fn excel_week_jan1_monday() {
        // Jan 1, 2024 is Monday.  jan1_weekday = 1.
        // ((1-1+1)/7)+1 = (1/7)+1 = 0+1 = 1.
        let date = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        assert_eq!(excel_week_number(date), 1);
    }

    #[test]
    fn excel_week_jan7_2023() {
        // Jan 7, 2023 is Saturday.  Jan 1 = Sunday (weekday=0).
        // ((7-1+0)/7)+1 = (6/7)+1 = 0+1 = 1.
        let date = NaiveDate::from_ymd_opt(2023, 1, 7).unwrap();
        assert_eq!(excel_week_number(date), 1);
    }

    #[test]
    fn excel_week_jan8_2023() {
        // Jan 8, 2023 is Sunday.  Jan 1 = Sunday (weekday=0).
        // ((8-1+0)/7)+1 = (7/7)+1 = 1+1 = 2.
        let date = NaiveDate::from_ymd_opt(2023, 1, 8).unwrap();
        assert_eq!(excel_week_number(date), 2);
    }

    #[test]
    fn excel_week_dec31() {
        // Dec 31, 2023.  Jan 1, 2023 = Sunday (weekday=0).
        // ordinal = 365.  ((365-1+0)/7)+1 = (364/7)+1 = 52+1 = 53.
        let date = NaiveDate::from_ymd_opt(2023, 12, 31).unwrap();
        assert_eq!(excel_week_number(date), 53);
    }

    // ---- apply_number_grouping ----

    #[test]
    fn number_grouping_basic() {
        let grouping = NumberGrouping::new(0.0, 100.0, 10.0);
        let result = apply_number_grouping(&CellValue::number(25.0), &grouping);
        assert_eq!(result, CellValue::Text("20 - 29".into()));
    }

    #[test]
    fn number_grouping_below_range() {
        let grouping = NumberGrouping::new(10.0, 100.0, 10.0);
        let result = apply_number_grouping(&CellValue::number(5.0), &grouping);
        assert_eq!(result, CellValue::Text("< 10".into()));
    }

    #[test]
    fn number_grouping_above_range() {
        let grouping = NumberGrouping::new(0.0, 100.0, 10.0);
        let result = apply_number_grouping(&CellValue::number(100.0), &grouping);
        assert_eq!(result, CellValue::Text(">= 100".into()));

        let result2 = apply_number_grouping(&CellValue::number(150.0), &grouping);
        assert_eq!(result2, CellValue::Text(">= 100".into()));
    }

    #[test]
    fn number_grouping_non_number() {
        let grouping = NumberGrouping::new(0.0, 100.0, 10.0);
        let result = apply_number_grouping(&CellValue::Text("hello".into()), &grouping);
        assert_eq!(result, CellValue::Text("hello".into()));
    }

    #[test]
    fn number_grouping_edge_exact_boundary() {
        let grouping = NumberGrouping::new(0.0, 100.0, 10.0);
        // Exactly at bucket start
        let result = apply_number_grouping(&CellValue::number(10.0), &grouping);
        assert_eq!(result, CellValue::Text("10 - 19".into()));

        // Exactly at start
        let result2 = apply_number_grouping(&CellValue::number(0.0), &grouping);
        assert_eq!(result2, CellValue::Text("0 - 9".into()));
    }

    #[test]
    fn number_grouping_non_integer_interval_half() {
        let grouping = NumberGrouping::new(0.0, 2.0, 0.5);
        // Value 0.0 -> bucket [0, 0.5)
        let r0 = apply_number_grouping(&CellValue::number(0.0), &grouping);
        assert_eq!(r0, CellValue::Text("0 - 0.5".into()));

        // Value 0.3 -> bucket [0, 0.5)
        let r1 = apply_number_grouping(&CellValue::number(0.3), &grouping);
        assert_eq!(r1, CellValue::Text("0 - 0.5".into()));

        // Value 0.5 -> bucket [0.5, 1.0)
        let r2 = apply_number_grouping(&CellValue::number(0.5), &grouping);
        assert_eq!(r2, CellValue::Text("0.5 - 1".into()));

        // Value 1.0 -> bucket [1.0, 1.5)
        let r3 = apply_number_grouping(&CellValue::number(1.0), &grouping);
        assert_eq!(r3, CellValue::Text("1 - 1.5".into()));

        // Value 1.5 -> bucket [1.5, 2.0)
        let r4 = apply_number_grouping(&CellValue::number(1.5), &grouping);
        assert_eq!(r4, CellValue::Text("1.5 - 2".into()));

        // Value 2.0 -> above range
        let r5 = apply_number_grouping(&CellValue::number(2.0), &grouping);
        assert_eq!(r5, CellValue::Text(">= 2".into()));
    }

    #[test]
    fn number_grouping_non_integer_interval_two_point_five() {
        let grouping = NumberGrouping::new(0.0, 10.0, 2.5);
        // Value 0.0 -> bucket [0, 2.5)
        let r0 = apply_number_grouping(&CellValue::number(0.0), &grouping);
        assert_eq!(r0, CellValue::Text("0 - 2.5".into()));

        // Value 2.5 -> bucket [2.5, 5.0)
        let r1 = apply_number_grouping(&CellValue::number(2.5), &grouping);
        assert_eq!(r1, CellValue::Text("2.5 - 5".into()));

        // Value 5.0 -> bucket [5.0, 7.5)
        let r2 = apply_number_grouping(&CellValue::number(5.0), &grouping);
        assert_eq!(r2, CellValue::Text("5 - 7.5".into()));

        // Value 7.5 -> bucket [7.5, 10.0)
        let r3 = apply_number_grouping(&CellValue::number(7.5), &grouping);
        assert_eq!(r3, CellValue::Text("7.5 - 10".into()));
    }

    #[test]
    fn number_grouping_integer_interval_still_correct() {
        // Verify the existing integer interval behavior is preserved
        let grouping = NumberGrouping::new(0.0, 100.0, 10.0);
        let r0 = apply_number_grouping(&CellValue::number(0.0), &grouping);
        assert_eq!(r0, CellValue::Text("0 - 9".into()));

        let r1 = apply_number_grouping(&CellValue::number(15.0), &grouping);
        assert_eq!(r1, CellValue::Text("10 - 19".into()));

        let r2 = apply_number_grouping(&CellValue::number(99.0), &grouping);
        assert_eq!(r2, CellValue::Text("90 - 99".into()));
    }

    #[test]
    fn number_grouping_interval_0_1_no_drift() {
        // interval 0.1 must not produce drifted labels like "0.30000000000000004"
        let grouping = NumberGrouping::new(0.0, 1.0, 0.1);
        let r0 = apply_number_grouping(&CellValue::number(0.0), &grouping);
        assert_eq!(r0, CellValue::Text("0 - 0.1".into()));

        let r3 = apply_number_grouping(&CellValue::number(0.3), &grouping);
        assert_eq!(r3, CellValue::Text("0.3 - 0.4".into()));

        let r9 = apply_number_grouping(&CellValue::number(0.9), &grouping);
        assert_eq!(r9, CellValue::Text("0.9 - 1".into()));
    }

    // ---- normalize_to_key (delegates to cell_value_to_key) ----

    #[test]
    fn normalize_null_to_blank() {
        assert_eq!(
            normalize_to_key(&CellValue::Null),
            super::super::values::BLANK_KEY
        );
    }

    #[test]
    fn normalize_empty_string_to_blank() {
        assert_eq!(
            normalize_to_key(&CellValue::Text("".into())),
            super::super::values::BLANK_KEY
        );
    }

    // ---- normalize_to_group_key (structural, no sentinels) ----

    #[test]
    fn normalize_group_key_null_is_blank() {
        assert_eq!(normalize_to_group_key(&CellValue::Null), GroupKey::Blank);
    }

    #[test]
    fn normalize_group_key_empty_text_is_blank() {
        assert_eq!(
            normalize_to_group_key(&CellValue::Text("".into())),
            GroupKey::Blank
        );
    }

    #[test]
    fn normalize_group_key_text_with_blank_sentinel_is_distinct() {
        // Literal "\x00BLANK\x00" text must not collide with the blank group.
        let k = normalize_to_group_key(&CellValue::Text("\x00BLANK\x00".into()));
        assert_ne!(k, GroupKey::Blank);
        assert!(matches!(k, GroupKey::Text(_)));
    }

    #[test]
    fn normalize_error() {
        assert_eq!(
            normalize_to_key(&CellValue::Error(CellError::Div0, None)),
            "E:#DIV/0!"
        );
    }

    #[test]
    fn normalize_string_lowercased() {
        assert_eq!(
            normalize_to_key(&CellValue::Text("Hello World".into())),
            "T:hello world"
        );
    }

    #[test]
    fn normalize_number() {
        // Numbers use type-prefixed bit representation
        assert_eq!(
            normalize_to_key(&CellValue::number(42.0)),
            cell_value_to_key(&CellValue::number(42.0)).into_owned()
        );
        assert_eq!(
            normalize_to_key(&CellValue::number(3.14)),
            cell_value_to_key(&CellValue::number(3.14)).into_owned()
        );
    }

    #[test]
    fn normalize_boolean() {
        assert_eq!(normalize_to_key(&CellValue::Boolean(true)), "B:true");
        assert_eq!(normalize_to_key(&CellValue::Boolean(false)), "B:false");
    }

    // ---- helpers ----

    #[test]
    fn decimal_precision_integers() {
        // format!("{}", 10.0) = "10" — no decimal point, so precision is 0.
        assert_eq!(decimal_precision(10.0), 0);
        assert_eq!(decimal_precision(1.0), 0);
    }

    #[test]
    fn decimal_precision_fractional() {
        assert_eq!(decimal_precision(0.1), 1);
        assert_eq!(decimal_precision(0.01), 2);
        assert_eq!(decimal_precision(2.5), 1);
    }

    #[test]
    fn round_to_precision_basic() {
        assert!((round_to_precision(0.30000000000000004, 1) - 0.3).abs() < f64::EPSILON);
        assert!((round_to_precision(42.0, 0) - 42.0).abs() < f64::EPSILON);
        assert!((round_to_precision(3.456, 2) - 3.46).abs() < f64::EPSILON);
    }
}
