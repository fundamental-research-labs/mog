//! Date period matching rules for conditional formatting.
//!
//! Evaluates whether a cell's Excel serial date falls within a specified time period
//! (yesterday, today, tomorrow, last 7 days, etc.).
//!
//! Date rules are evaluated at render time relative to "now", not stored as
//! absolute dates. This ensures rules stay dynamic.
//!
//! Ported from: spreadsheet-model/src/conditional-format/date-evaluator.ts

use chrono::{Datelike, Duration, NaiveDate};

use crate::types::DatePeriod;
use value_types::CellValue;
use value_types::date_serial::serial_to_date;

// =============================================================================
// Excel Serial Date Helpers
// =============================================================================

/// Convert Excel serial date to NaiveDate.
/// Excel serial 1 = Jan 1, 1900.
/// Handles the Lotus 1-2-3 leap year bug (serial 60 = Feb 29, 1900 which doesn't exist).
///
/// Delegates to `value_types::date_serial::serial_to_date` which already handles
/// the Lotus bug correctly.
pub(crate) fn excel_serial_to_date(serial: f64) -> Option<NaiveDate> {
    serial_to_date(serial)
}

/// Check if a value is a valid Excel serial date.
/// Must be a finite number in range [1, 2958465] (Jan 1, 1900 through Dec 31, 9999).
pub(crate) fn is_valid_excel_date(value: f64) -> bool {
    value.is_finite() && (1.0..=2958465.0).contains(&value)
}

// =============================================================================
// Date Period Range Calculation
// =============================================================================

/// Get the quarter (0-based: 0=Q1, 1=Q2, 2=Q3, 3=Q4) for a date.
fn get_quarter(date: &NaiveDate) -> u32 {
    (date.month() - 1) / 3
}

/// Get the start of a week (Sunday).
/// Excel uses Sunday as the first day of the week.
fn start_of_week(date: &NaiveDate) -> NaiveDate {
    // chrono Weekday: Mon=0..Sun=6
    // Excel week: Sun=0..Sat=6
    // days_from_sunday: Sun=0, Mon=1, Tue=2, ..., Sat=6
    let days_from_sunday = date.weekday().num_days_from_sunday();
    *date - Duration::days(days_from_sunday as i64)
}

/// Get the end of a week (Saturday).
fn end_of_week(date: &NaiveDate) -> NaiveDate {
    let days_from_sunday = date.weekday().num_days_from_sunday();
    *date + Duration::days((6 - days_from_sunday) as i64)
}

/// Get the first day of the month.
fn start_of_month(date: &NaiveDate) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(date.year(), date.month(), 1)
}

/// Get the last day of the month.
fn end_of_month(date: &NaiveDate) -> Option<NaiveDate> {
    // Go to day 1 of next month, subtract 1 day.
    let (y, m) = if date.month() == 12 {
        (date.year() + 1, 1)
    } else {
        (date.year(), date.month() + 1)
    };
    NaiveDate::from_ymd_opt(y, m, 1).map(|d| d - Duration::days(1))
}

/// Get the first day of the quarter.
fn start_of_quarter(date: &NaiveDate) -> Option<NaiveDate> {
    let month = get_quarter(date) * 3 + 1;
    NaiveDate::from_ymd_opt(date.year(), month, 1)
}

/// Get the last day of the quarter.
fn end_of_quarter(date: &NaiveDate) -> Option<NaiveDate> {
    let end_month = (get_quarter(date) + 1) * 3; // last month of the quarter (3, 6, 9, 12)
    let first = NaiveDate::from_ymd_opt(date.year(), end_month, 1)?;
    end_of_month(&first)
}

/// Get the first day of the year.
fn start_of_year(date: &NaiveDate) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(date.year(), 1, 1)
}

/// Get the last day of the year.
fn end_of_year(date: &NaiveDate) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(date.year(), 12, 31)
}

/// Add months to a date (clamping to the last day of the target month if needed).
fn add_months(date: &NaiveDate, months: i32) -> Option<NaiveDate> {
    let total_months = date.year() * 12 + (date.month() as i32 - 1) + months;
    let y = total_months.div_euclid(12);
    let m = (total_months.rem_euclid(12) + 1) as u32;
    // Clamp day to valid range for the target month.
    let max_day = end_of_month(&NaiveDate::from_ymd_opt(y, m, 1)?)?.day();
    let d = date.day().min(max_day);
    NaiveDate::from_ymd_opt(y, m, d)
}

/// Get the start and end dates for a date period relative to `now`.
///
/// Returns inclusive [start, end] date range, or None if the period is somehow invalid.
pub fn get_date_period_range(
    period: &DatePeriod,
    now: NaiveDate,
) -> Option<(NaiveDate, NaiveDate)> {
    let today = now;

    match period {
        // Single day periods
        DatePeriod::Yesterday => {
            let d = today - Duration::days(1);
            Some((d, d))
        }
        DatePeriod::Today => Some((today, today)),
        DatePeriod::Tomorrow => {
            let d = today + Duration::days(1);
            Some((d, d))
        }

        // Rolling periods
        DatePeriod::Last7Days => {
            // Last 7 days INCLUDING today
            let start = today - Duration::days(6);
            Some((start, today))
        }

        // Week periods (Sunday-based)
        DatePeriod::LastWeek => {
            let this_week_start = start_of_week(&today);
            let last_week_start = this_week_start - Duration::days(7);
            let last_week_end = end_of_week(&last_week_start);
            Some((last_week_start, last_week_end))
        }
        DatePeriod::ThisWeek => Some((start_of_week(&today), end_of_week(&today))),
        DatePeriod::NextWeek => {
            let this_week_start = start_of_week(&today);
            let next_week_start = this_week_start + Duration::days(7);
            let next_week_end = end_of_week(&next_week_start);
            Some((next_week_start, next_week_end))
        }

        // Month periods
        DatePeriod::LastMonth => {
            // add_months on day=1 always returns day=1 (clamping never reduces day 1),
            // so the outer start_of_month is unnecessary.
            let last_month_start = add_months(&start_of_month(&today)?, -1)?;
            let last_month_end = end_of_month(&last_month_start)?;
            Some((last_month_start, last_month_end))
        }
        DatePeriod::ThisMonth => Some((start_of_month(&today)?, end_of_month(&today)?)),
        DatePeriod::NextMonth => {
            // add_months on day=1 always returns day=1; outer start_of_month is redundant.
            let next_month_start = add_months(&start_of_month(&today)?, 1)?;
            let next_month_end = end_of_month(&next_month_start)?;
            Some((next_month_start, next_month_end))
        }

        // Quarter periods
        DatePeriod::LastQuarter => {
            let sq = start_of_quarter(&today)?;
            // add_months on a quarter-start (day=1) by -3 always lands on another
            // quarter-start (day=1 of the first month of the previous quarter),
            // so the outer start_of_quarter is redundant.
            let last_q_start = add_months(&sq, -3)?;
            let last_q_end = end_of_quarter(&last_q_start)?;
            Some((last_q_start, last_q_end))
        }
        DatePeriod::ThisQuarter => Some((start_of_quarter(&today)?, end_of_quarter(&today)?)),
        DatePeriod::NextQuarter => {
            let sq = start_of_quarter(&today)?;
            // add_months on a quarter-start (day=1) by +3 always lands on another
            // quarter-start; outer start_of_quarter is redundant.
            let next_q_start = add_months(&sq, 3)?;
            let next_q_end = end_of_quarter(&next_q_start)?;
            Some((next_q_start, next_q_end))
        }

        // Year periods
        DatePeriod::LastYear => {
            let year = today.year().checked_sub(1)?;
            let last_year_start = NaiveDate::from_ymd_opt(year, 1, 1)?;
            let last_year_end = end_of_year(&last_year_start)?;
            Some((last_year_start, last_year_end))
        }
        DatePeriod::ThisYear => Some((start_of_year(&today)?, end_of_year(&today)?)),
        DatePeriod::NextYear => {
            let year = today.year().checked_add(1)?;
            let next_year_start = NaiveDate::from_ymd_opt(year, 1, 1)?;
            let next_year_end = end_of_year(&next_year_start)?;
            Some((next_year_start, next_year_end))
        }
    }
}

// =============================================================================
// Evaluation Functions
// =============================================================================

/// Evaluate a time period CF rule with a given "now" date.
///
/// Returns `true` if the cell value (Excel serial date) falls
/// within the date period, `false` otherwise.
pub fn evaluate_time_period(value: &CellValue, period: &DatePeriod, now: NaiveDate) -> bool {
    // Extract numeric value from the cell.
    let serial = match value {
        CellValue::Number(n) => n.get(),
        _ => return false,
    };

    // Must be a valid Excel serial date.
    if !is_valid_excel_date(serial) {
        return false;
    }

    // Convert to a NaiveDate.
    let Some(cell_date) = excel_serial_to_date(serial) else {
        return false;
    };

    // Get the date range for the period.
    let Some((start, end)) = get_date_period_range(period, now) else {
        return false;
    };

    // Check if the cell date falls within the range (inclusive).
    cell_date >= start && cell_date <= end
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
#[path = "time_period_tests.rs"]
mod tests;
