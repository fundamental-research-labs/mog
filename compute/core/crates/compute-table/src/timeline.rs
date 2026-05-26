//! Timeline Slicer — Date utilities and period generation for timeline slicers.
//!
//! Ported from `spreadsheet-model/src/slicers/timeline.ts`.
//!
//! Timeline slicers are specialized date-range slicers that display a horizontal
//! timeline with period bars for filtering. This module provides:
//! - Date serial detection and column classification
//! - Period generation at different aggregation levels (years, quarters, months, days)
//! - Date serial conversion utilities
//!
//! Every function is PURE and STATELESS. No DOM, no Yjs, no React.

use serde::{Deserialize, Serialize};

// ============================================================================
// Types
// ============================================================================

/// Aggregation level for timeline slicers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimelineLevel {
    Years,
    Quarters,
    Months,
    Days,
}

/// A single period in a timeline slicer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePeriod {
    /// Start date serial (inclusive).
    pub start_date: f64,
    /// End date serial (inclusive).
    pub end_date: f64,
    /// Display label (e.g., "2023", "Q1", "Jan", "15").
    pub label: String,
    /// Short label for narrow display.
    pub short_label: String,
    /// Whether this period is currently selected.
    pub is_selected: bool,
    /// Whether any data exists in this period.
    pub has_data: bool,
    /// Number of data rows in this period.
    pub count: u32,
}

/// Result of date range detection.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DateRange {
    pub min_date: f64,
    pub max_date: f64,
}

// ============================================================================
// Date Utilities
// ============================================================================

/// Check if a value is a date serial number.
///
/// Excel date serials are positive numbers where:
/// - 1 = January 1, 1900
/// - 44561 = December 31, 2021
///
/// Reasonable range for dates: 1 to 110000 (1900 to ~2200).
pub fn is_date_value(value: f64) -> bool {
    value.is_finite() && (1.0..=110000.0).contains(&value)
}

/// Detect if a collection of values contains primarily date values.
///
/// Heuristic: If > 70% of non-empty finite values are date serials, it's a date column.
/// Requires at least 3 non-empty values.
pub fn is_date_column(values: &[Option<f64>]) -> bool {
    if values.is_empty() {
        return false;
    }

    let mut date_count = 0u32;
    let mut total_count = 0u32;

    for v in values.iter().flatten() {
        total_count += 1;
        if is_date_value(*v) {
            date_count += 1;
        }
    }

    if total_count < 3 {
        return false;
    }

    (date_count as f64 / total_count as f64) >= 0.7
}

/// Get the date range from an array of date values.
///
/// Returns None if no valid dates are found.
pub fn get_date_range(values: &[f64]) -> Option<DateRange> {
    let mut min_date = f64::INFINITY;
    let mut max_date = f64::NEG_INFINITY;
    let mut has_valid = false;

    for &v in values {
        if is_date_value(v) {
            min_date = min_date.min(v);
            max_date = max_date.max(v);
            has_valid = true;
        }
    }

    if !has_valid {
        return None;
    }

    Some(DateRange { min_date, max_date })
}

// ============================================================================
// Date Serial Conversion (Module-Private)
// ============================================================================

/// Excel epoch: Dec 31, 1899. Serial 1 = Jan 1, 1900.
const MS_PER_DAY: f64 = 24.0 * 60.0 * 60.0 * 1000.0;

/// Approximate conversion from serial to year.
fn serial_to_year(serial: f64) -> i32 {
    let years_since_1900 = ((serial - 1.0) / 365.25).floor() as i32;
    1900 + years_since_1900
}

/// Convert serial to (year, month 1-12, day 1-31) using the JS Date-like approach.
///
/// Adjusts for Excel's 1900 leap year bug (serial 60 = Feb 29, 1900 which doesn't exist).
fn serial_to_ymd(serial: f64) -> (i32, u32, u32) {
    // Excel epoch: UTC midnight Dec 31, 1899
    let adjusted = if serial > 60.0 { serial - 1.0 } else { serial };

    // Convert to days since Unix epoch (Jan 1, 1970)
    // Excel epoch Dec 31 1899 -> Unix epoch = 25569 days difference
    let days_since_unix = adjusted - 25569.0;
    let ms = days_since_unix * MS_PER_DAY;

    // Use a simple date calculation (no chrono dependency needed for approximate dates)
    let total_days = (ms / MS_PER_DAY).floor() as i64;

    // Convert days since Unix epoch to y/m/d
    // Algorithm from https://howardhinnant.github.io/date_algorithms.html
    let z = total_days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    (y as i32, m, d)
}

/// Get the quarter (1-4) for a month (1-12).
fn quarter_from_month(month: u32) -> u32 {
    ((month - 1) / 3) + 1
}

/// Get quarter label.
fn quarter_label(quarter: u32) -> String {
    format!("Q{}", quarter)
}

/// Month names.
const MONTH_NAMES: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Convert a (year, month, day) to an Excel serial, with leap year bug adjustment.
fn ymd_to_serial(year: i32, month: u32, day: u32) -> f64 {
    // Convert to days since Unix epoch using the civil_from_days inverse
    let y = if month <= 2 {
        year as i64 - 1
    } else {
        year as i64
    };
    let m = if month <= 2 { month + 9 } else { month - 3 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let total_days = era * 146097 + doe as i64 - 719468;

    let mut serial = total_days as f64 + 25569.0;
    // Adjust for Excel's 1900 leap year bug
    if serial > 59.0 {
        serial += 1.0;
    }
    serial
}

/// Get the last day of a month.
fn last_day_of_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

/// Get the period key for counting items per period.
fn get_period_key(serial: f64, level: TimelineLevel) -> String {
    let (year, month, day) = serial_to_ymd(serial);
    match level {
        TimelineLevel::Years => format!("{}", year),
        TimelineLevel::Quarters => format!("{}-Q{}", year, quarter_from_month(month)),
        TimelineLevel::Months => format!("{}-{}", year, month),
        TimelineLevel::Days => format!("{}-{}-{}", year, month, day),
    }
}

// ============================================================================
// Period Generation
// ============================================================================

/// Generate timeline periods for a date range at a specified aggregation level.
///
/// `date_values` is the array of all date serials in the data (for counting).
/// `selected_start_date` and `selected_end_date` define the current selection.
pub fn generate_timeline_periods(
    min_date: f64,
    max_date: f64,
    level: TimelineLevel,
    date_values: &[f64],
    selected_start_date: Option<f64>,
    selected_end_date: Option<f64>,
) -> Vec<TimelinePeriod> {
    let mut periods = Vec::new();

    // Count date values per period
    let mut date_counts = std::collections::HashMap::new();
    for &v in date_values {
        if is_date_value(v) {
            let key = get_period_key(v, level);
            *date_counts.entry(key).or_insert(0u32) += 1;
        }
    }

    let start_year = serial_to_year(min_date);
    let end_year = serial_to_year(max_date);

    let is_selected = |period_start: f64, period_end: f64| -> bool {
        match (selected_start_date, selected_end_date) {
            (Some(sel_start), Some(sel_end)) => period_start <= sel_end && period_end >= sel_start,
            _ => false,
        }
    };

    match level {
        TimelineLevel::Years => {
            for year in start_year..=end_year {
                let period_start = ymd_to_serial(year, 1, 1);
                let period_end = ymd_to_serial(year, 12, 31);
                let key = format!("{}", year);
                let count = date_counts.get(&key).copied().unwrap_or(0);

                periods.push(TimelinePeriod {
                    start_date: period_start,
                    end_date: period_end,
                    label: year.to_string(),
                    short_label: year.to_string(),
                    is_selected: is_selected(period_start, period_end),
                    has_data: count > 0,
                    count,
                });
            }
        }
        TimelineLevel::Quarters => {
            for year in start_year..=end_year {
                for quarter in 1..=4u32 {
                    let month = (quarter - 1) * 3 + 1;
                    let end_month = quarter * 3;
                    let period_start = ymd_to_serial(year, month, 1);
                    let period_end =
                        ymd_to_serial(year, end_month, last_day_of_month(year, end_month));

                    if period_end < min_date {
                        continue;
                    }
                    if period_start > max_date {
                        continue;
                    }

                    let key = format!("{}-Q{}", year, quarter);
                    let count = date_counts.get(&key).copied().unwrap_or(0);

                    periods.push(TimelinePeriod {
                        start_date: period_start,
                        end_date: period_end,
                        label: quarter_label(quarter),
                        short_label: quarter_label(quarter),
                        is_selected: is_selected(period_start, period_end),
                        has_data: count > 0,
                        count,
                    });
                }
            }
        }
        TimelineLevel::Months => {
            for year in start_year..=end_year {
                for month in 1..=12u32 {
                    let period_start = ymd_to_serial(year, month, 1);
                    let period_end = ymd_to_serial(year, month, last_day_of_month(year, month));

                    if period_end < min_date {
                        continue;
                    }
                    if period_start > max_date {
                        continue;
                    }

                    let key = format!("{}-{}", year, month);
                    let count = date_counts.get(&key).copied().unwrap_or(0);
                    let label = MONTH_NAMES[(month - 1) as usize];

                    periods.push(TimelinePeriod {
                        start_date: period_start,
                        end_date: period_end,
                        label: label.to_string(),
                        short_label: label.chars().next().unwrap().to_string(),
                        is_selected: is_selected(period_start, period_end),
                        has_data: count > 0,
                        count,
                    });
                }
            }
        }
        TimelineLevel::Days => {
            let start = min_date.floor() as i64;
            let end = max_date.ceil() as i64;
            for serial in start..=end {
                let serial_f = serial as f64;
                let (_, _, day) = serial_to_ymd(serial_f);
                let key = get_period_key(serial_f, TimelineLevel::Days);
                let count = date_counts.get(&key).copied().unwrap_or(0);

                periods.push(TimelinePeriod {
                    start_date: serial_f,
                    end_date: serial_f,
                    label: day.to_string(),
                    short_label: day.to_string(),
                    is_selected: is_selected(serial_f, serial_f),
                    has_data: count > 0,
                    count,
                });
            }
        }
    }

    periods
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- is_date_value ----

    #[test]
    fn date_value_valid() {
        assert!(is_date_value(1.0));
        assert!(is_date_value(44561.0));
        assert!(is_date_value(110000.0));
    }

    #[test]
    fn date_value_invalid() {
        assert!(!is_date_value(0.0));
        assert!(!is_date_value(-1.0));
        assert!(!is_date_value(110001.0));
        assert!(!is_date_value(f64::NAN));
        assert!(!is_date_value(f64::INFINITY));
    }

    // ---- is_date_column ----

    #[test]
    fn date_column_yes() {
        let values = vec![Some(44561.0), Some(44562.0), Some(44563.0), Some(44564.0)];
        assert!(is_date_column(&values));
    }

    #[test]
    fn date_column_no() {
        let values = vec![Some(0.5), Some(0.6), Some(0.7), Some(0.8)];
        assert!(!is_date_column(&values));
    }

    #[test]
    fn date_column_mixed_above_threshold() {
        // 3 dates out of 4 = 75% > 70%
        let values = vec![Some(44561.0), Some(44562.0), Some(44563.0), Some(0.5)];
        assert!(is_date_column(&values));
    }

    #[test]
    fn date_column_too_few() {
        let values = vec![Some(44561.0), Some(44562.0)];
        assert!(!is_date_column(&values));
    }

    #[test]
    fn date_column_empty() {
        assert!(!is_date_column(&[]));
    }

    #[test]
    fn date_column_with_nones() {
        let values = vec![
            None,
            Some(44561.0),
            None,
            Some(44562.0),
            Some(44563.0),
            None,
        ];
        assert!(is_date_column(&values));
    }

    // ---- get_date_range ----

    #[test]
    fn date_range_basic() {
        let values = vec![44561.0, 44562.0, 44600.0, 44550.0];
        let range = get_date_range(&values).unwrap();
        assert_eq!(range.min_date, 44550.0);
        assert_eq!(range.max_date, 44600.0);
    }

    #[test]
    fn date_range_no_valid() {
        let values = vec![0.0, -1.0, f64::NAN];
        assert!(get_date_range(&values).is_none());
    }

    #[test]
    fn date_range_single() {
        let values = vec![44561.0];
        let range = get_date_range(&values).unwrap();
        assert_eq!(range.min_date, 44561.0);
        assert_eq!(range.max_date, 44561.0);
    }

    // ---- serial_to_year ----

    #[test]
    fn serial_to_year_1900() {
        assert_eq!(serial_to_year(1.0), 1900);
    }

    #[test]
    fn serial_to_year_2020_approx() {
        // Serial ~43831 is around Jan 1, 2020
        let year = serial_to_year(43831.0);
        assert!(year >= 2019 && year <= 2020);
    }

    // ---- generate_timeline_periods ----

    #[test]
    fn generate_years() {
        // Jan 1, 2020 (serial ~43831) to Dec 31, 2021 (serial ~44561)
        let date_values = vec![43831.0, 44196.0, 44561.0];
        let periods = generate_timeline_periods(
            43831.0,
            44561.0,
            TimelineLevel::Years,
            &date_values,
            None,
            None,
        );
        assert!(periods.len() >= 2);
        assert!(!periods[0].is_selected);
    }

    #[test]
    fn generate_months_has_labels() {
        let date_values = vec![43831.0, 43862.0, 43891.0];
        let periods = generate_timeline_periods(
            43831.0,
            43891.0,
            TimelineLevel::Months,
            &date_values,
            None,
            None,
        );
        assert!(!periods.is_empty());
        // All periods should have month name labels
        for p in &periods {
            assert!(!p.label.is_empty());
            assert!(!p.short_label.is_empty());
        }
    }

    #[test]
    fn generate_days() {
        let date_values = vec![44561.0, 44562.0, 44563.0];
        let periods = generate_timeline_periods(
            44561.0,
            44563.0,
            TimelineLevel::Days,
            &date_values,
            None,
            None,
        );
        assert_eq!(periods.len(), 3);
        for p in &periods {
            assert!(p.has_data);
            assert_eq!(p.count, 1);
        }
    }

    #[test]
    fn selection_marks_periods() {
        let date_values = vec![44561.0, 44562.0, 44563.0, 44564.0, 44565.0];
        let periods = generate_timeline_periods(
            44561.0,
            44565.0,
            TimelineLevel::Days,
            &date_values,
            Some(44562.0),
            Some(44564.0),
        );
        assert_eq!(periods.len(), 5);
        assert!(!periods[0].is_selected); // 44561
        assert!(periods[1].is_selected); // 44562
        assert!(periods[2].is_selected); // 44563
        assert!(periods[3].is_selected); // 44564
        assert!(!periods[4].is_selected); // 44565
    }

    #[test]
    fn empty_date_values() {
        let periods =
            generate_timeline_periods(44561.0, 44563.0, TimelineLevel::Days, &[], None, None);
        // Still generates period entries, just with count=0
        assert_eq!(periods.len(), 3);
        for p in &periods {
            assert!(!p.has_data);
            assert_eq!(p.count, 0);
        }
    }

    // ---- quarter_from_month ----

    #[test]
    fn quarters() {
        assert_eq!(quarter_from_month(1), 1);
        assert_eq!(quarter_from_month(3), 1);
        assert_eq!(quarter_from_month(4), 2);
        assert_eq!(quarter_from_month(6), 2);
        assert_eq!(quarter_from_month(7), 3);
        assert_eq!(quarter_from_month(9), 3);
        assert_eq!(quarter_from_month(10), 4);
        assert_eq!(quarter_from_month(12), 4);
    }

    // ---- last_day_of_month ----

    #[test]
    fn month_lengths() {
        assert_eq!(last_day_of_month(2020, 1), 31);
        assert_eq!(last_day_of_month(2020, 2), 29); // leap year
        assert_eq!(last_day_of_month(2021, 2), 28);
        assert_eq!(last_day_of_month(2020, 4), 30);
        assert_eq!(last_day_of_month(2020, 12), 31);
        assert_eq!(last_day_of_month(1900, 2), 28); // 1900 is not a leap year
        assert_eq!(last_day_of_month(2000, 2), 29); // 2000 is a leap year
    }

    // ---- TimelinePeriod serde ----

    #[test]
    fn timeline_period_round_trip() {
        let period = TimelinePeriod {
            start_date: 44561.0,
            end_date: 44926.0,
            label: "2022".to_string(),
            short_label: "2022".to_string(),
            is_selected: true,
            has_data: true,
            count: 42,
        };
        let json = serde_json::to_string(&period).unwrap();
        let back: TimelinePeriod = serde_json::from_str(&json).unwrap();
        assert_eq!(period, back);
    }
}
