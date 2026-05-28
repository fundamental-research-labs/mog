use crate::types::{
    ConditionFilter, DynamicFilterRule, FilterCriteria, FilterLogic, FilterOperator,
    TableFilterCondition,
};
use chrono::{Datelike, Duration, NaiveDate, Weekday};
use value_types::{CellValue, date_to_serial};

/// Compute date range (start, end) for a dynamic date rule, then create
/// a ConditionFilter with a `between` condition using millisecond timestamps.
#[cfg(test)]
pub fn resolve_date_range_filter(
    rule: &DynamicFilterRule,
    now: NaiveDate,
    week_start_day: Weekday,
) -> FilterCriteria {
    match resolve_date_range_filter_for_rule(rule, now, week_start_day) {
        Some(condition) => FilterCriteria::Condition(condition),
        None => FilterCriteria::Condition(ConditionFilter {
            conditions: vec![],
            logic: FilterLogic::And,
        }),
    }
}

pub(super) fn resolve_date_range_filter_for_rule(
    rule: &DynamicFilterRule,
    now: NaiveDate,
    week_start_day: Weekday,
) -> Option<ConditionFilter> {
    let (start, end) = compute_date_range(rule, now, week_start_day)?;
    let start_ms = date_to_start_of_day_ms(start)?;
    let end_ms = date_to_end_of_day_ms(end)?;

    Some(ConditionFilter {
        conditions: vec![TableFilterCondition {
            operator: FilterOperator::Between,
            value: CellValue::number(start_ms as f64),
            value2: Some(CellValue::number(end_ms as f64)),
        }],
        logic: FilterLogic::And,
    })
}

/// Compute the start and end NaiveDate for a dynamic filter rule.
///
/// Returns the inclusive [start, end] date range corresponding to a dynamic
/// date rule (today, this week, last month, year-to-date, etc.) given a
/// reference "now" date and the configured week-start day.
///
/// Returns `Some((now, now))` for the non-date rules `AboveAverage` /
/// `BelowAverage` — those callers should use `resolve_dynamic_filter`
/// instead, but this fallback prevents panics if the function is called
/// generically.
pub fn compute_date_range(
    rule: &DynamicFilterRule,
    now: NaiveDate,
    week_start_day: Weekday,
) -> Option<(NaiveDate, NaiveDate)> {
    match rule {
        DynamicFilterRule::Today => Some((now, now)),

        DynamicFilterRule::Yesterday => {
            let d = now - Duration::days(1);
            Some((d, d))
        }

        DynamicFilterRule::Tomorrow => {
            let d = now + Duration::days(1);
            Some((d, d))
        }

        DynamicFilterRule::ThisWeek => {
            let start = start_of_week(now, week_start_day);
            let end = start + Duration::days(6);
            Some((start, end))
        }

        DynamicFilterRule::LastWeek => {
            let last_week_day = now - Duration::days(7);
            let start = start_of_week(last_week_day, week_start_day);
            let end = start + Duration::days(6);
            Some((start, end))
        }

        DynamicFilterRule::NextWeek => {
            let next_week_day = now + Duration::days(7);
            let start = start_of_week(next_week_day, week_start_day);
            let end = start + Duration::days(6);
            Some((start, end))
        }

        DynamicFilterRule::ThisMonth => {
            let start = NaiveDate::from_ymd_opt(now.year(), now.month(), 1)?;
            let end = end_of_month(now.year(), now.month())?;
            Some((start, end))
        }

        DynamicFilterRule::LastMonth => {
            let (y, m) = prev_month(now.year(), now.month());
            let start = NaiveDate::from_ymd_opt(y, m, 1)?;
            let end = end_of_month(y, m)?;
            Some((start, end))
        }

        DynamicFilterRule::NextMonth => {
            let (y, m) = next_month(now.year(), now.month());
            let start = NaiveDate::from_ymd_opt(y, m, 1)?;
            let end = end_of_month(y, m)?;
            Some((start, end))
        }

        DynamicFilterRule::ThisQuarter => {
            let q = quarter(now.month());
            let start_month = (q - 1) * 3 + 1;
            let end_month = q * 3;
            let start = NaiveDate::from_ymd_opt(now.year(), start_month, 1)?;
            let end = end_of_month(now.year(), end_month)?;
            Some((start, end))
        }

        DynamicFilterRule::LastQuarter => {
            // Subtract 3 months to get a date in the previous quarter
            let (y, m) = subtract_months(now.year(), now.month(), 3);
            let q = quarter(m);
            let start_month = (q - 1) * 3 + 1;
            let end_month = q * 3;
            let start = NaiveDate::from_ymd_opt(y, start_month, 1)?;
            let end = end_of_month(y, end_month)?;
            Some((start, end))
        }

        DynamicFilterRule::NextQuarter => {
            // Add 3 months to get a date in the next quarter
            let (y, m) = add_months(now.year(), now.month(), 3);
            let q = quarter(m);
            let start_month = (q - 1) * 3 + 1;
            let end_month = q * 3;
            let start = NaiveDate::from_ymd_opt(y, start_month, 1)?;
            let end = end_of_month(y, end_month)?;
            Some((start, end))
        }

        DynamicFilterRule::ThisYear => {
            let start = NaiveDate::from_ymd_opt(now.year(), 1, 1)?;
            let end = NaiveDate::from_ymd_opt(now.year(), 12, 31)?;
            Some((start, end))
        }

        DynamicFilterRule::LastYear => {
            let start = NaiveDate::from_ymd_opt(now.year() - 1, 1, 1)?;
            let end = NaiveDate::from_ymd_opt(now.year() - 1, 12, 31)?;
            Some((start, end))
        }

        DynamicFilterRule::NextYear => {
            let start = NaiveDate::from_ymd_opt(now.year() + 1, 1, 1)?;
            let end = NaiveDate::from_ymd_opt(now.year() + 1, 12, 31)?;
            Some((start, end))
        }

        // AboveAverage / BelowAverage are not date rules; handled by resolve_dynamic_filter.
        DynamicFilterRule::AboveAverage | DynamicFilterRule::BelowAverage => {
            // Should not reach here; return a dummy range
            Some((now, now))
        }
    }
}

/// Compute the start/end Excel-serial range for a dynamic date rule.
///
/// Returns `(start_serial, end_serial)` as `f64` Excel serial numbers,
/// inclusive on both ends.  Returns `None` for non-date rules
/// (`AboveAverage` / `BelowAverage`) which are not date-based.
///
/// This is the canonical conversion used by both:
///   * the kernel TS filter API (constructs a Between condition over Excel
///     serials, which is how date cells are stored), and
///   * the Rust `evaluate_column_filter` path when it needs to compare a
///     dynamic-rule range to cell values that are themselves Excel serials.
///
/// Cell date columns are stored as Excel serials (days since 1899-12-30 with
/// the Lotus 1900 leap-year compatibility offset), so range bounds must be
/// in the same number space — Unix milliseconds would compare as a
/// thousand-year offset and silently mismatch every row.
#[must_use]
pub fn compute_date_range_serial(
    rule: &DynamicFilterRule,
    now: NaiveDate,
    week_start_day: Weekday,
) -> Option<(f64, f64)> {
    match rule {
        DynamicFilterRule::AboveAverage | DynamicFilterRule::BelowAverage => None,
        _ => {
            let (start, end) = compute_date_range(rule, now, week_start_day)?;
            Some((date_to_serial(&start), date_to_serial(&end)))
        }
    }
}

/// Convert a NaiveDate to milliseconds since Unix epoch at start of day (00:00:00.000).
pub(super) fn date_to_start_of_day_ms(d: NaiveDate) -> Option<i64> {
    Some(
        d.and_hms_milli_opt(0, 0, 0, 0)?
            .and_utc()
            .timestamp_millis(),
    )
}

/// Convert a NaiveDate to milliseconds since Unix epoch at end of day (23:59:59.999).
pub(super) fn date_to_end_of_day_ms(d: NaiveDate) -> Option<i64> {
    Some(
        d.and_hms_milli_opt(23, 59, 59, 999)?
            .and_utc()
            .timestamp_millis(),
    )
}

/// Start of week containing `d`, given the configured week start day.
pub(super) fn start_of_week(d: NaiveDate, week_start_day: Weekday) -> NaiveDate {
    let current_weekday = d.weekday();
    // Number of days since week_start_day (mod 7)
    let diff = (current_weekday.num_days_from_sunday() as i64
        - week_start_day.num_days_from_sunday() as i64
        + 7)
        % 7;
    d - Duration::days(diff)
}

/// Get the last day of a given year/month.
pub(super) fn end_of_month(year: i32, month: u32) -> Option<NaiveDate> {
    // Go to first of next month, subtract 1 day
    let (next_y, next_m) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    Some(NaiveDate::from_ymd_opt(next_y, next_m, 1)? - Duration::days(1))
}

/// Get the quarter number (1-4) for a month (1-12).
pub(super) fn quarter(month: u32) -> u32 {
    (month - 1) / 3 + 1
}

/// Subtract N months from (year, month). Returns (new_year, new_month).
pub(super) fn subtract_months(year: i32, month: u32, n: u32) -> (i32, u32) {
    let total_months = year * 12 + month as i32 - 1 - n as i32;
    let new_year = total_months.div_euclid(12);
    let new_month = (total_months.rem_euclid(12) + 1) as u32;
    (new_year, new_month)
}

/// Add N months to (year, month). Returns (new_year, new_month).
pub(super) fn add_months(year: i32, month: u32, n: u32) -> (i32, u32) {
    let total_months = year * 12 + month as i32 - 1 + n as i32;
    let new_year = total_months.div_euclid(12);
    let new_month = (total_months.rem_euclid(12) + 1) as u32;
    (new_year, new_month)
}

/// Previous month from (year, month).
fn prev_month(year: i32, month: u32) -> (i32, u32) {
    subtract_months(year, month, 1)
}

/// Next month from (year, month).
fn next_month(year: i32, month: u32) -> (i32, u32) {
    add_months(year, month, 1)
}
