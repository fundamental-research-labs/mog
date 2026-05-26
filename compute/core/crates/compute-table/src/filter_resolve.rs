//! Filter Resolve — Convert data-dependent filter types to concrete form.
//!
//! TableTopBottomFilter and DynamicFilter depend on the actual column data:
//! - TopBottom needs to compute thresholds (top N items, top N%, top by sum)
//! - Dynamic needs to compute averages or resolve date ranges
//!
//! These functions resolve them to a concrete ValueFilter or ConditionFilter
//! that can then be evaluated row-by-row without further data access.
//!
//! Stateless. Pure.
//!
//! Ported from `table-engine/src/filter-resolve.ts`.
//!
//! **BUG FIX**: The TS code uses strict `>` and `<` for aboveAverage/belowAverage.
//! Excel uses `>=` and `<=`. This Rust port fixes this:
//! - aboveAverage -> `GreaterThanOrEqual` (NOT GreaterThan)
//! - belowAverage -> `LessThanOrEqual` (NOT LessThan)

use super::types::{
    ConditionFilter, DynamicFilter, DynamicFilterRule, FilterCriteria, FilterLogic, FilterOperator,
    TableFilterCondition, TableTopBottomFilter, TopBottomBy, TopBottomDirection,
};
use chrono::{Datelike, Duration, NaiveDate, Weekday};
use value_types::{CellValue, date_to_serial};

// =============================================================================
// computeTopBottomCutoff — shared cutoff computation
// =============================================================================

/// Compute the cutoff count for a top/bottom filter from sorted numeric values.
///
/// Modes:
/// - `Items`: take the first `count` entries
/// - `Percent`: take `count`% of the total item count (rounded up, at least 1)
/// - `Sum`: take entries until their absolute values reach `count`% of total absolute sum
fn compute_top_bottom_cutoff(sorted_values: &[f64], count: usize, by: TopBottomBy) -> usize {
    let len = sorted_values.len();
    if len == 0 {
        return 0;
    }

    match by {
        TopBottomBy::Items => count.min(len),

        TopBottomBy::Percent => {
            let cutoff = ((count as f64 / 100.0) * len as f64).ceil() as usize;
            cutoff.max(1).min(len)
        }

        TopBottomBy::Sum => {
            let total_sum: f64 = sorted_values.iter().map(|v| v.abs()).sum();
            if total_sum == 0.0 {
                return len;
            }
            let target_sum = (count as f64 / 100.0) * total_sum;
            let mut running_sum = 0.0;
            let mut cutoff = 0;
            for v in sorted_values {
                running_sum += v.abs();
                cutoff += 1;
                if running_sum >= target_sum {
                    break;
                }
            }
            cutoff
        }
    }
}

// =============================================================================
// evaluateTopBottomDirect
// =============================================================================

/// Evaluate a TableTopBottomFilter directly to a bitmap using index-based selection.
/// This avoids the tie-breaking problem of resolving to ValueFilter.
///
/// When resolving to a ValueFilter, duplicate values at the boundary cause ALL
/// matching rows to be included. This function instead selects exactly the right
/// number of rows by their sorted index.
pub fn evaluate_top_bottom_direct(
    spec: &TableTopBottomFilter,
    column_data: &[CellValue],
) -> Vec<u8> {
    let len = column_data.len();
    let mut bitmap = vec![0u8; len]; // all 0 (hidden)

    // Extract numeric values with their original row indices
    let mut numeric_entries: Vec<(f64, usize)> = Vec::new();
    for (i, v) in column_data.iter().enumerate() {
        if let CellValue::Number(n) = v {
            // FiniteF64 is always finite by construction, no guard needed.
            numeric_entries.push((n.get(), i));
        }
    }

    if numeric_entries.is_empty() {
        return bitmap;
    }

    // Sort: Top = descending, Bottom = ascending
    match spec.direction {
        TopBottomDirection::Top => {
            numeric_entries
                .sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        }
        TopBottomDirection::Bottom => {
            numeric_entries
                .sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        }
    }

    let sorted_values: Vec<f64> = numeric_entries.iter().map(|(v, _)| *v).collect();
    let count = if spec.count.is_finite() && spec.count >= 0.0 {
        spec.count as usize
    } else {
        0
    };
    let cutoff_count = compute_top_bottom_cutoff(&sorted_values, count, spec.by);

    // Set selected rows to visible using their ORIGINAL indices
    for i in 0..cutoff_count {
        bitmap[numeric_entries[i].1] = 1;
    }

    bitmap
}

// =============================================================================
// resolveDynamicFilter
// =============================================================================

/// Resolve a DynamicFilter to a concrete FilterCriteria.
///
/// - aboveAverage / belowAverage: computes column average, returns ConditionFilter
/// - date rules (today, thisMonth, etc.): computes date range, returns ConditionFilter with between
///
/// **BUG FIX**: aboveAverage uses `GreaterThanOrEqual` (not `GreaterThan`),
/// belowAverage uses `LessThanOrEqual` (not `LessThan`).
pub fn resolve_dynamic_filter(
    filter: &DynamicFilter,
    column_data: &[CellValue],
    now: Option<NaiveDate>,
    week_start_day: Weekday,
) -> FilterCriteria {
    match filter.rule {
        DynamicFilterRule::AboveAverage => FilterCriteria::Condition(resolve_average_filter(
            column_data,
            FilterOperator::GreaterThanOrEqual,
        )),
        DynamicFilterRule::BelowAverage => FilterCriteria::Condition(resolve_average_filter(
            column_data,
            FilterOperator::LessThanOrEqual,
        )),
        // All date rules require a `now` date
        _ => {
            let now_date = now.expect("Date-based dynamic filter requires a `now` date parameter");
            match resolve_date_range_filter_for_rule(&filter.rule, now_date, week_start_day) {
                Some(condition) => FilterCriteria::Condition(condition),
                None => {
                    // Invalid date construction (e.g. year overflow); return a filter that matches nothing.
                    FilterCriteria::Condition(ConditionFilter {
                        conditions: vec![],
                        logic: FilterLogic::And,
                    })
                }
            }
        }
    }
}

// =============================================================================
// Internal: average resolution
// =============================================================================

/// Resolve an average filter. Computes average of finite numeric values.
///
/// **BUG FIX**: Uses `GreaterThanOrEqual` for aboveAverage and
/// `LessThanOrEqual` for belowAverage (Excel semantics).
fn resolve_average_filter(column_data: &[CellValue], operator: FilterOperator) -> ConditionFilter {
    let mut sum = 0.0;
    let mut count = 0u64;

    for v in column_data {
        if let CellValue::Number(n) = v {
            // FiniteF64 is always finite by construction, no guard needed.
            sum += n.get();
            count += 1;
        }
    }

    if count == 0 {
        // No numeric data — nothing matches.
        // Use operator with Infinity/-Infinity to produce empty result.
        let no_match_value = if operator == FilterOperator::GreaterThanOrEqual
            || operator == FilterOperator::GreaterThan
        {
            f64::INFINITY
        } else {
            f64::NEG_INFINITY
        };
        return ConditionFilter {
            conditions: vec![TableFilterCondition {
                operator,
                value: CellValue::number(no_match_value),
                value2: None,
            }],
            logic: FilterLogic::And,
        };
    }

    let avg = sum / count as f64;
    ConditionFilter {
        conditions: vec![TableFilterCondition {
            operator,
            value: CellValue::number(avg),
            value2: None,
        }],
        logic: FilterLogic::And,
    }
}

// =============================================================================
// Internal: date range resolution
// =============================================================================

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

fn resolve_date_range_filter_for_rule(
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

// =============================================================================
// Date helpers
// =============================================================================

/// Convert a NaiveDate to milliseconds since Unix epoch at start of day (00:00:00.000).
fn date_to_start_of_day_ms(d: NaiveDate) -> Option<i64> {
    Some(
        d.and_hms_milli_opt(0, 0, 0, 0)?
            .and_utc()
            .timestamp_millis(),
    )
}

/// Convert a NaiveDate to milliseconds since Unix epoch at end of day (23:59:59.999).
fn date_to_end_of_day_ms(d: NaiveDate) -> Option<i64> {
    Some(
        d.and_hms_milli_opt(23, 59, 59, 999)?
            .and_utc()
            .timestamp_millis(),
    )
}

/// Start of week containing `d`, given the configured week start day.
fn start_of_week(d: NaiveDate, week_start_day: Weekday) -> NaiveDate {
    let current_weekday = d.weekday();
    // Number of days since week_start_day (mod 7)
    let diff = (current_weekday.num_days_from_sunday() as i64
        - week_start_day.num_days_from_sunday() as i64
        + 7)
        % 7;
    d - Duration::days(diff)
}

/// Get the last day of a given year/month.
fn end_of_month(year: i32, month: u32) -> Option<NaiveDate> {
    // Go to first of next month, subtract 1 day
    let (next_y, next_m) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    Some(NaiveDate::from_ymd_opt(next_y, next_m, 1)? - Duration::days(1))
}

/// Get the quarter number (1-4) for a month (1-12).
fn quarter(month: u32) -> u32 {
    (month - 1) / 3 + 1
}

/// Subtract N months from (year, month). Returns (new_year, new_month).
fn subtract_months(year: i32, month: u32, n: u32) -> (i32, u32) {
    let total_months = year * 12 + month as i32 - 1 - n as i32;
    let new_year = total_months.div_euclid(12);
    let new_month = (total_months.rem_euclid(12) + 1) as u32;
    (new_year, new_month)
}

/// Add N months to (year, month). Returns (new_year, new_month).
fn add_months(year: i32, month: u32, n: u32) -> (i32, u32) {
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

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellValue, FiniteF64};

    // -- Helpers --------------------------------------------------------------

    fn cv_num(n: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(n))
    }

    fn cv_text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn cv_null() -> CellValue {
        CellValue::Null
    }

    /// Helper: extract the ConditionFilter from a FilterCriteria.
    fn as_condition(fc: &FilterCriteria) -> &ConditionFilter {
        match fc {
            FilterCriteria::Condition(cf) => cf,
            _ => panic!("Expected ConditionFilter, got {:?}", fc),
        }
    }

    /// Helper: compute ms timestamp for start of day in UTC.
    fn start_of_day_ms(year: i32, month: u32, day: u32) -> f64 {
        NaiveDate::from_ymd_opt(year, month, day)
            .unwrap()
            .and_hms_milli_opt(0, 0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis() as f64
    }

    /// Helper: compute ms timestamp for end of day in UTC.
    fn end_of_day_ms(year: i32, month: u32, day: u32) -> f64 {
        NaiveDate::from_ymd_opt(year, month, day)
            .unwrap()
            .and_hms_milli_opt(23, 59, 59, 999)
            .unwrap()
            .and_utc()
            .timestamp_millis() as f64
    }

    /// Extract start/end f64 values from a ConditionFilter with a single `between` condition.
    fn extract_range(cf: &ConditionFilter) -> (f64, f64) {
        assert_eq!(cf.conditions.len(), 1);
        let start = match &cf.conditions[0].value {
            CellValue::Number(v) => v.get(),
            _ => panic!("Expected Number"),
        };
        let end = match cf.conditions[0].value2.as_ref().unwrap() {
            CellValue::Number(v) => v.get(),
            _ => panic!("Expected Number"),
        };
        (start, end)
    }

    // =========================================================================
    // evaluateTopBottomDirect
    // =========================================================================

    #[test]
    fn test_top_2_items() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 2.0,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(10.0), cv_num(30.0), cv_num(20.0), cv_num(40.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // Top 2: 40, 30
        assert_eq!(bitmap, vec![0, 1, 0, 1]);
    }

    #[test]
    fn test_bottom_1_item() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Bottom,
            count: 1.0,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(10.0), cv_num(30.0), cv_num(20.0), cv_num(40.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // Bottom 1: 10
        assert_eq!(bitmap, vec![1, 0, 0, 0]);
    }

    #[test]
    fn test_top_50_percent() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 50.0,
            by: TopBottomBy::Percent,
        };
        let data = vec![cv_num(10.0), cv_num(30.0), cv_num(20.0), cv_num(40.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // 50% of 4 = 2 -> top 2: 40, 30
        assert_eq!(bitmap, vec![0, 1, 0, 1]);
    }

    #[test]
    fn test_bottom_5_percent_rounds_up() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Bottom,
            count: 5.0,
            by: TopBottomBy::Percent,
        };
        let data = vec![
            cv_num(10.0),
            cv_num(50.0),
            cv_num(30.0),
            cv_num(20.0),
            cv_num(40.0),
        ];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // 5% of 5 = 0.25, rounds up to 1 -> bottom 1: 10
        assert_eq!(bitmap, vec![1, 0, 0, 0, 0]);
    }

    #[test]
    fn test_top_by_sum() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 50.0,
            by: TopBottomBy::Sum,
        };
        let data = vec![
            cv_num(10.0),
            cv_num(50.0),
            cv_num(30.0),
            cv_num(20.0),
            cv_num(40.0),
        ];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // Total = 150, 50% = 75. Desc: 50,40,30,20,10. Running: 50, 90(>=75, stop).
        assert_eq!(bitmap, vec![0, 1, 0, 0, 1]);
    }

    #[test]
    fn test_all_non_numeric_hidden() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 5.0,
            by: TopBottomBy::Items,
        };
        let data = vec![
            cv_text("a"),
            cv_null(),
            CellValue::Boolean(true),
            cv_text("hello"),
        ];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        assert_eq!(bitmap, vec![0, 0, 0, 0]);
    }

    #[test]
    fn test_duplicate_boundary_selects_exactly_n() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 2.0,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(10.0), cv_num(10.0), cv_num(10.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        let visible_count: u8 = bitmap.iter().sum();
        assert_eq!(visible_count, 2);
    }

    #[test]
    fn test_non_numeric_excluded() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 2.0,
            by: TopBottomBy::Items,
        };
        let data = vec![
            cv_num(10.0),
            cv_text("text"),
            cv_null(),
            cv_num(50.0),
            cv_num(30.0),
        ];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        assert_eq!(bitmap, vec![0, 0, 0, 1, 1]);
    }

    #[test]
    fn test_count_exceeds_available() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 100.0,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        assert_eq!(bitmap, vec![1, 1, 1]);
    }

    #[test]
    fn test_infinity_excluded() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 2.0,
            by: TopBottomBy::Items,
        };
        let data = vec![
            CellValue::number(f64::INFINITY),
            cv_num(10.0),
            cv_num(50.0),
            CellValue::number(f64::NEG_INFINITY),
            cv_num(30.0),
        ];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        assert_eq!(bitmap, vec![0, 0, 1, 0, 1]);
    }

    // =========================================================================
    // resolve_average_filter — BUG FIX TESTS
    // =========================================================================

    #[test]
    fn test_above_average_bug_fix_includes_equal() {
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let result = resolve_average_filter(&data, FilterOperator::GreaterThanOrEqual);
        assert_eq!(result.conditions.len(), 1);
        assert_eq!(
            result.conditions[0].operator,
            FilterOperator::GreaterThanOrEqual
        );
        if let CellValue::Number(v) = &result.conditions[0].value {
            assert!((v.get() - 20.0).abs() < 1e-10);
        } else {
            panic!("Expected Number");
        }
    }

    #[test]
    fn test_below_average_bug_fix_includes_equal() {
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let result = resolve_average_filter(&data, FilterOperator::LessThanOrEqual);
        assert_eq!(result.conditions.len(), 1);
        assert_eq!(
            result.conditions[0].operator,
            FilterOperator::LessThanOrEqual
        );
        if let CellValue::Number(v) = &result.conditions[0].value {
            assert!((v.get() - 20.0).abs() < 1e-10);
        } else {
            panic!("Expected Number");
        }
    }

    #[test]
    fn test_above_average_bug_fix_via_resolve() {
        let filter = DynamicFilter {
            rule: DynamicFilterRule::AboveAverage,
        };
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let resolved = resolve_dynamic_filter(
            &filter,
            &data,
            Some(NaiveDate::from_ymd_opt(2024, 6, 15).unwrap()),
            Weekday::Sun,
        );
        let cf = as_condition(&resolved);
        assert_eq!(
            cf.conditions[0].operator,
            FilterOperator::GreaterThanOrEqual
        );
        if let CellValue::Number(v) = &cf.conditions[0].value {
            assert!((v.get() - 20.0).abs() < 1e-10);
        }
    }

    #[test]
    fn test_below_average_bug_fix_via_resolve() {
        let filter = DynamicFilter {
            rule: DynamicFilterRule::BelowAverage,
        };
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let resolved = resolve_dynamic_filter(
            &filter,
            &data,
            Some(NaiveDate::from_ymd_opt(2024, 6, 15).unwrap()),
            Weekday::Sun,
        );
        let cf = as_condition(&resolved);
        assert_eq!(cf.conditions[0].operator, FilterOperator::LessThanOrEqual);
        if let CellValue::Number(v) = &cf.conditions[0].value {
            assert!((v.get() - 20.0).abs() < 1e-10);
        }
    }

    #[test]
    fn test_above_average_mixed_types() {
        let data = vec![cv_num(10.0), cv_text("text"), cv_num(30.0), cv_null()];
        let result = resolve_average_filter(&data, FilterOperator::GreaterThanOrEqual);
        if let CellValue::Number(v) = &result.conditions[0].value {
            assert!((v.get() - 20.0).abs() < 1e-10);
        }
    }

    #[test]
    fn test_above_average_no_numeric_data() {
        let data = vec![cv_text("a"), cv_null(), cv_text("b")];
        let result = resolve_average_filter(&data, FilterOperator::GreaterThanOrEqual);
        assert_eq!(
            result.conditions[0].operator,
            FilterOperator::GreaterThanOrEqual
        );
        // CellValue::number(f64::INFINITY) → Error(Num), so condition value is #NUM!
        assert!(matches!(
            &result.conditions[0].value,
            CellValue::Error(value_types::CellError::Num, None)
        ));
    }

    #[test]
    fn test_below_average_no_numeric_data() {
        let data = vec![cv_text("a"), cv_null(), cv_text("b")];
        let result = resolve_average_filter(&data, FilterOperator::LessThanOrEqual);
        assert_eq!(
            result.conditions[0].operator,
            FilterOperator::LessThanOrEqual
        );
        // CellValue::number(f64::NEG_INFINITY) → Error(Num), so condition value is #NUM!
        assert!(matches!(
            &result.conditions[0].value,
            CellValue::Error(value_types::CellError::Num, None)
        ));
    }

    #[test]
    fn test_above_average_ignores_infinity() {
        let data = vec![
            cv_num(10.0),
            CellValue::number(f64::INFINITY),
            cv_num(20.0),
            CellValue::number(f64::NEG_INFINITY),
            cv_num(30.0),
        ];
        let result = resolve_average_filter(&data, FilterOperator::GreaterThanOrEqual);
        if let CellValue::Number(v) = &result.conditions[0].value {
            assert!((v.get() - 20.0).abs() < 1e-10);
        }
    }

    // =========================================================================
    // Date range resolution
    // =========================================================================

    // June 15, 2024 is a Saturday
    fn now_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2024, 6, 15).unwrap()
    }

    #[test]
    fn test_today() {
        let result =
            resolve_date_range_filter_for_rule(&DynamicFilterRule::Today, now_date(), Weekday::Sun);
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 6, 15));
        assert_eq!(end, end_of_day_ms(2024, 6, 15));
    }

    #[test]
    fn test_yesterday() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::Yesterday,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 6, 14));
        assert_eq!(end, end_of_day_ms(2024, 6, 14));
    }

    #[test]
    fn test_tomorrow() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::Tomorrow,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 6, 16));
        assert_eq!(end, end_of_day_ms(2024, 6, 16));
    }

    #[test]
    fn test_this_month() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::ThisMonth,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 6, 1));
        assert_eq!(end, end_of_day_ms(2024, 6, 30));
    }

    #[test]
    fn test_last_month() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::LastMonth,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 5, 1));
        assert_eq!(end, end_of_day_ms(2024, 5, 31));
    }

    #[test]
    fn test_next_month() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::NextMonth,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 7, 1));
        assert_eq!(end, end_of_day_ms(2024, 7, 31));
    }

    #[test]
    fn test_this_year() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::ThisYear,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 1, 1));
        assert_eq!(end, end_of_day_ms(2024, 12, 31));
    }

    #[test]
    fn test_last_year() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::LastYear,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2023, 1, 1));
        assert_eq!(end, end_of_day_ms(2023, 12, 31));
    }

    #[test]
    fn test_next_year() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::NextYear,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2025, 1, 1));
        assert_eq!(end, end_of_day_ms(2025, 12, 31));
    }

    #[test]
    fn test_this_quarter_q2() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::ThisQuarter,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 4, 1));
        assert_eq!(end, end_of_day_ms(2024, 6, 30));
    }

    #[test]
    fn test_last_quarter_q1() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::LastQuarter,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 1, 1));
        assert_eq!(end, end_of_day_ms(2024, 3, 31));
    }

    #[test]
    fn test_next_quarter_q3() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::NextQuarter,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 7, 1));
        assert_eq!(end, end_of_day_ms(2024, 9, 30));
    }

    #[test]
    fn test_this_week_sunday_start() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::ThisWeek,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        // June 15 2024 is Saturday. Week: Sun June 9 to Sat June 15.
        assert_eq!(start, start_of_day_ms(2024, 6, 9));
        assert_eq!(end, end_of_day_ms(2024, 6, 15));
    }

    #[test]
    fn test_last_week() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::LastWeek,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        // Last week: Sun June 2 to Sat June 8.
        assert_eq!(start, start_of_day_ms(2024, 6, 2));
        assert_eq!(end, end_of_day_ms(2024, 6, 8));
    }

    #[test]
    fn test_next_week() {
        let result = resolve_date_range_filter_for_rule(
            &DynamicFilterRule::NextWeek,
            now_date(),
            Weekday::Sun,
        );
        let (start, end) = extract_range(&result.unwrap());
        // Next week: Sun June 16 to Sat June 22.
        assert_eq!(start, start_of_day_ms(2024, 6, 16));
        assert_eq!(end, end_of_day_ms(2024, 6, 22));
    }

    // =========================================================================
    // Date boundary crossing tests
    // =========================================================================

    #[test]
    fn test_last_month_january_wraps_to_december() {
        let now = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let result =
            resolve_date_range_filter_for_rule(&DynamicFilterRule::LastMonth, now, Weekday::Sun);
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 12, 1));
        assert_eq!(end, end_of_day_ms(2024, 12, 31));
    }

    #[test]
    fn test_last_quarter_q1_wraps_to_q4() {
        let now = NaiveDate::from_ymd_opt(2025, 2, 10).unwrap();
        let result =
            resolve_date_range_filter_for_rule(&DynamicFilterRule::LastQuarter, now, Weekday::Sun);
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 10, 1));
        assert_eq!(end, end_of_day_ms(2024, 12, 31));
    }

    #[test]
    fn test_next_month_december_wraps_to_january() {
        let now = NaiveDate::from_ymd_opt(2024, 12, 15).unwrap();
        let result =
            resolve_date_range_filter_for_rule(&DynamicFilterRule::NextMonth, now, Weekday::Sun);
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2025, 1, 1));
        assert_eq!(end, end_of_day_ms(2025, 1, 31));
    }

    #[test]
    fn test_this_week_spans_month_boundary() {
        // March 31, 2025 is a Monday. With Sunday start, week is Sun Mar 30 to Sat Apr 5.
        let now = NaiveDate::from_ymd_opt(2025, 3, 31).unwrap();
        let result =
            resolve_date_range_filter_for_rule(&DynamicFilterRule::ThisWeek, now, Weekday::Sun);
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2025, 3, 30));
        assert_eq!(end, end_of_day_ms(2025, 4, 5));
    }

    #[test]
    fn test_last_week_year_boundary() {
        // January 3, 2025 is Friday. thisWeek: Sun Dec 29 to Sat Jan 4.
        // lastWeek: Sun Dec 22 to Sat Dec 28.
        let now = NaiveDate::from_ymd_opt(2025, 1, 3).unwrap();
        let result =
            resolve_date_range_filter_for_rule(&DynamicFilterRule::LastWeek, now, Weekday::Sun);
        let (start, end) = extract_range(&result.unwrap());
        assert_eq!(start, start_of_day_ms(2024, 12, 22));
        assert_eq!(end, end_of_day_ms(2024, 12, 28));
    }

    // =========================================================================
    // Date helper unit tests
    // =========================================================================

    #[test]
    fn test_quarter_function() {
        assert_eq!(quarter(1), 1);
        assert_eq!(quarter(3), 1);
        assert_eq!(quarter(4), 2);
        assert_eq!(quarter(6), 2);
        assert_eq!(quarter(7), 3);
        assert_eq!(quarter(9), 3);
        assert_eq!(quarter(10), 4);
        assert_eq!(quarter(12), 4);
    }

    #[test]
    fn test_end_of_month_various() {
        assert_eq!(
            end_of_month(2024, 2).unwrap(),
            NaiveDate::from_ymd_opt(2024, 2, 29).unwrap()
        ); // leap year
        assert_eq!(
            end_of_month(2023, 2).unwrap(),
            NaiveDate::from_ymd_opt(2023, 2, 28).unwrap()
        ); // non-leap
        assert_eq!(
            end_of_month(2024, 6).unwrap(),
            NaiveDate::from_ymd_opt(2024, 6, 30).unwrap()
        );
        assert_eq!(
            end_of_month(2024, 12).unwrap(),
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap()
        );
    }

    #[test]
    fn test_start_of_week_sunday_start() {
        let d = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap(); // Saturday
        let start = start_of_week(d, Weekday::Sun);
        assert_eq!(start, NaiveDate::from_ymd_opt(2024, 6, 9).unwrap()); // Sunday
    }

    #[test]
    fn test_start_of_week_monday_start() {
        let d = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap(); // Saturday
        let start = start_of_week(d, Weekday::Mon);
        assert_eq!(start, NaiveDate::from_ymd_opt(2024, 6, 10).unwrap()); // Monday
    }

    #[test]
    fn test_subtract_months_wraps_year() {
        assert_eq!(subtract_months(2025, 1, 1), (2024, 12));
        assert_eq!(subtract_months(2025, 1, 3), (2024, 10));
        assert_eq!(subtract_months(2024, 3, 3), (2023, 12));
    }

    #[test]
    fn test_add_months_wraps_year() {
        assert_eq!(add_months(2024, 12, 1), (2025, 1));
        assert_eq!(add_months(2024, 10, 3), (2025, 1));
        assert_eq!(add_months(2024, 6, 3), (2024, 9));
    }

    // =========================================================================
    // computeTopBottomCutoff
    // =========================================================================

    #[test]
    fn test_cutoff_items() {
        assert_eq!(
            compute_top_bottom_cutoff(&[1.0, 2.0, 3.0], 2, TopBottomBy::Items),
            2
        );
        assert_eq!(
            compute_top_bottom_cutoff(&[1.0, 2.0, 3.0], 10, TopBottomBy::Items),
            3
        );
    }

    #[test]
    fn test_cutoff_percent() {
        assert_eq!(
            compute_top_bottom_cutoff(&[1.0, 2.0, 3.0, 4.0, 5.0], 40, TopBottomBy::Percent),
            2
        );
        assert_eq!(
            compute_top_bottom_cutoff(&[1.0, 2.0, 3.0, 4.0, 5.0], 5, TopBottomBy::Percent),
            1
        );
    }

    #[test]
    fn test_cutoff_sum() {
        // Total = 15, 60% = 9. Values: 5,4,3,2,1. Running: 5, 9. Stop at 2.
        assert_eq!(
            compute_top_bottom_cutoff(&[5.0, 4.0, 3.0, 2.0, 1.0], 60, TopBottomBy::Sum),
            2
        );
    }

    #[test]
    fn test_cutoff_empty() {
        assert_eq!(compute_top_bottom_cutoff(&[], 5, TopBottomBy::Items), 0);
    }

    // =========================================================================
    // Filter Integration Tests
    // =========================================================================

    #[test]
    fn test_dynamic_date_filter_today() {
        use crate::filter::evaluate_column_filter;

        // Dynamic date filters use millisecond timestamps in the resolved condition
        // Create dates as ms timestamps: Jan 1-5, 2024
        let jan_1_2024 = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let jan_2_2024 = NaiveDate::from_ymd_opt(2024, 1, 2).unwrap();
        let jan_3_2024 = NaiveDate::from_ymd_opt(2024, 1, 3).unwrap();
        let jan_4_2024 = NaiveDate::from_ymd_opt(2024, 1, 4).unwrap();
        let jan_5_2024 = NaiveDate::from_ymd_opt(2024, 1, 5).unwrap();

        // Convert to ms timestamps (start of day in UTC)
        fn to_ms(d: NaiveDate) -> f64 {
            d.and_hms_milli_opt(0, 0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp_millis() as f64
        }

        let data = vec![
            cv_num(to_ms(jan_1_2024)),
            cv_num(to_ms(jan_2_2024)),
            cv_num(to_ms(jan_3_2024)),
            cv_num(to_ms(jan_4_2024)),
            cv_num(to_ms(jan_5_2024)),
        ];

        // Create a DynamicFilter for "Today" (Jan 3, 2024)
        let filter = DynamicFilter {
            rule: DynamicFilterRule::Today,
        };
        let criteria = FilterCriteria::Dynamic(filter);

        // Evaluate with "now" = Jan 3, 2024
        let now = jan_3_2024;
        let bitmap = evaluate_column_filter(&criteria, &data, None, Some(now), Some(Weekday::Sun));

        // Only the third item (Jan 3) should match
        assert_eq!(bitmap, vec![0, 0, 1, 0, 0]);
    }

    #[test]
    fn test_dynamic_date_filter_this_week() {
        use crate::filter::evaluate_column_filter;

        // Convert to ms timestamps helper
        fn to_ms(d: NaiveDate) -> f64 {
            d.and_hms_milli_opt(0, 0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp_millis() as f64
        }

        // Jan 1, 2024 is a Monday
        let jan_1_2024 = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let jan_2_2024 = NaiveDate::from_ymd_opt(2024, 1, 2).unwrap();
        let jan_6_2024 = NaiveDate::from_ymd_opt(2024, 1, 6).unwrap();
        let jan_7_2024 = NaiveDate::from_ymd_opt(2024, 1, 7).unwrap();
        let jan_8_2024 = NaiveDate::from_ymd_opt(2024, 1, 8).unwrap();

        let data = vec![
            cv_num(to_ms(jan_1_2024)), // Jan 1, 2024 (Mon)
            cv_num(to_ms(jan_2_2024)), // Jan 2, 2024 (Tue)
            cv_num(to_ms(jan_6_2024)), // Jan 6, 2024 (Sat)
            cv_num(to_ms(jan_7_2024)), // Jan 7, 2024 (Sun)
            cv_num(to_ms(jan_8_2024)), // Jan 8, 2024 (Mon)
        ];

        // Create a DynamicFilter for "ThisWeek" (week starting Sunday)
        let filter = DynamicFilter {
            rule: DynamicFilterRule::ThisWeek,
        };
        let criteria = FilterCriteria::Dynamic(filter);

        // Evaluate with "now" = Jan 3, 2024 (Wednesday)
        // This week (Sun start) = Dec 31, 2023 to Jan 6, 2024
        let now = NaiveDate::from_ymd_opt(2024, 1, 3).unwrap();
        let bitmap = evaluate_column_filter(&criteria, &data, None, Some(now), Some(Weekday::Sun));

        // Jan 1, 2, 6 should match; Jan 7 and 8 are next week
        assert_eq!(bitmap, vec![1, 1, 1, 0, 0]);
    }

    #[test]
    fn test_multi_column_filter_composition() {
        use crate::filter::evaluate_column_filter;
        use crate::visibility::compose_bitmaps;

        // Create two columns of data
        let col_a_data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0), cv_num(40.0)];
        let col_b_data = vec![
            cv_text("apple"),
            cv_text("banana"),
            cv_text("cherry"),
            cv_text("date"),
        ];

        // Filter column A: values > 15
        let filter_a = ConditionFilter {
            conditions: vec![TableFilterCondition {
                operator: FilterOperator::GreaterThan,
                value: cv_num(15.0),
                value2: None,
            }],
            logic: FilterLogic::And,
        };

        // Filter column B: values containing "a"
        let filter_b = ConditionFilter {
            conditions: vec![TableFilterCondition {
                operator: FilterOperator::Contains,
                value: cv_text("a"),
                value2: None,
            }],
            logic: FilterLogic::And,
        };

        // Evaluate each filter
        let bitmap_a = evaluate_column_filter(
            &FilterCriteria::Condition(filter_a),
            &col_a_data,
            None,
            None,
            None,
        );
        let bitmap_b = evaluate_column_filter(
            &FilterCriteria::Condition(filter_b),
            &col_b_data,
            None,
            None,
            None,
        );

        // bitmap_a: [0, 1, 1, 1] (20, 30, 40 > 15)
        // bitmap_b: [1, 1, 0, 1] (apple, banana, date contain "a")
        assert_eq!(bitmap_a, vec![0, 1, 1, 1]);
        assert_eq!(bitmap_b, vec![1, 1, 0, 1]);

        // Compose via AND
        let composed = compose_bitmaps(&[&bitmap_a, &bitmap_b]);

        // Only rows 1 and 3 should pass both filters (20/banana and 40/date)
        assert_eq!(composed, vec![0, 1, 0, 1]);
    }

    #[test]
    fn test_top_bottom_count_zero() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 0.0,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);

        // count=0 should produce empty (all-false) bitmap
        assert_eq!(bitmap, vec![0, 0, 0]);
    }

    #[test]
    fn test_top_bottom_count_negative() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: -1.0,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // Negative count should be treated as 0 → all hidden
        assert_eq!(bitmap, vec![0, 0, 0]);
    }

    #[test]
    fn test_top_bottom_count_nan() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: f64::NAN,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // NaN count should be treated as 0 → all hidden
        assert_eq!(bitmap, vec![0, 0, 0]);
    }

    #[test]
    fn test_top_bottom_count_infinity() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: f64::INFINITY,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // Infinity count should be treated as 0 → all hidden
        assert_eq!(bitmap, vec![0, 0, 0]);
    }

    #[test]
    fn test_top_bottom_count_neg_infinity() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Bottom,
            count: f64::NEG_INFINITY,
            by: TopBottomBy::Items,
        };
        let data = vec![cv_num(10.0), cv_num(20.0), cv_num(30.0)];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // Negative infinity count should be treated as 0 → all hidden
        assert_eq!(bitmap, vec![0, 0, 0]);
    }

    #[test]
    fn test_top_bottom_fractional_percent() {
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Top,
            count: 50.0,
            by: TopBottomBy::Percent,
        };
        let data = vec![
            cv_num(10.0),
            cv_num(20.0),
            cv_num(30.0),
            cv_num(40.0),
            cv_num(50.0),
            cv_num(60.0),
            cv_num(70.0),
            cv_num(80.0),
            cv_num(90.0),
            cv_num(100.0),
        ];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);

        // 50% of 10 items = 5 items
        // Top 5: 100, 90, 80, 70, 60
        let visible_count: u8 = bitmap.iter().sum();
        assert_eq!(visible_count, 5);

        // Verify the right items are visible
        assert_eq!(bitmap[9], 1); // 100
        assert_eq!(bitmap[8], 1); // 90
        assert_eq!(bitmap[7], 1); // 80
        assert_eq!(bitmap[6], 1); // 70
        assert_eq!(bitmap[5], 1); // 60
    }

    // =========================================================================
    // Additional quality tests: Bottom + Sum, Bottom + Percent
    // =========================================================================

    #[test]
    fn test_bottom_by_sum() {
        // Bottom direction with Sum mode: select the smallest values whose
        // absolute values sum to at least count% of total absolute sum.
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Bottom,
            count: 50.0,
            by: TopBottomBy::Sum,
        };
        let data = vec![
            cv_num(10.0),
            cv_num(50.0),
            cv_num(30.0),
            cv_num(20.0),
            cv_num(40.0),
        ];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // Total = 150, 50% = 75.
        // Bottom (ascending): 10, 20, 30, 40, 50.
        // Running abs sum: 10, 30, 60, 100 (>= 75, stop at 4th element).
        // Selected indices: 10(idx=0), 20(idx=3), 30(idx=2), 40(idx=4)
        assert_eq!(bitmap, vec![1, 0, 1, 1, 1]);
    }

    #[test]
    fn test_bottom_50_percent() {
        // Bottom direction with Percent mode at 50%.
        let spec = TableTopBottomFilter {
            direction: TopBottomDirection::Bottom,
            count: 50.0,
            by: TopBottomBy::Percent,
        };
        let data = vec![
            cv_num(10.0),
            cv_num(50.0),
            cv_num(30.0),
            cv_num(20.0),
            cv_num(40.0),
            cv_num(60.0),
        ];
        let bitmap = evaluate_top_bottom_direct(&spec, &data);
        // 50% of 6 = 3 items.
        // Bottom 3 (ascending): 10, 20, 30.
        // Indices: 10(idx=0), 20(idx=3), 30(idx=2)
        assert_eq!(bitmap, vec![1, 0, 1, 1, 0, 0]);
    }

    // =========================================================================
    // compute_date_range — public API
    // =========================================================================
    //
    // The wider conversion-to-ms bracketing is already covered by the
    // resolve_date_range_filter_for_rule tests above; these tests pin the
    // raw NaiveDate output of `compute_date_range` directly so callers
    // (e.g. the kernel bridge) have a stable contract.

    #[test]
    fn test_compute_date_range_today() {
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range(&DynamicFilterRule::Today, now, Weekday::Sun).unwrap();
        assert_eq!(start, now);
        assert_eq!(end, now);
    }

    #[test]
    fn test_compute_date_range_this_week_sunday_start() {
        // June 15 2024 is Saturday; week Sun→Sat is Jun 9 .. Jun 15.
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range(&DynamicFilterRule::ThisWeek, now, Weekday::Sun).unwrap();
        assert_eq!(start, NaiveDate::from_ymd_opt(2024, 6, 9).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2024, 6, 15).unwrap());
    }

    #[test]
    fn test_compute_date_range_last_month() {
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range(&DynamicFilterRule::LastMonth, now, Weekday::Sun).unwrap();
        assert_eq!(start, NaiveDate::from_ymd_opt(2024, 5, 1).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2024, 5, 31).unwrap());
    }

    #[test]
    fn test_compute_date_range_this_year() {
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range(&DynamicFilterRule::ThisYear, now, Weekday::Sun).unwrap();
        assert_eq!(start, NaiveDate::from_ymd_opt(2024, 1, 1).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2024, 12, 31).unwrap());
    }

    #[test]
    fn test_compute_date_range_year_boundary_last_quarter() {
        // Feb 2025 -> last quarter is Q4 2024 (Oct 1 .. Dec 31).
        let now = NaiveDate::from_ymd_opt(2025, 2, 10).unwrap();
        let (start, end) =
            compute_date_range(&DynamicFilterRule::LastQuarter, now, Weekday::Sun).unwrap();
        assert_eq!(start, NaiveDate::from_ymd_opt(2024, 10, 1).unwrap());
        assert_eq!(end, NaiveDate::from_ymd_opt(2024, 12, 31).unwrap());
    }

    // =========================================================================
    // compute_date_range_serial — Excel-serial output (kernel bridge contract)
    // =========================================================================
    //
    // The kernel calls this through the bridge to build a `between` condition
    // filter that compares against cell values, which are themselves Excel
    // serials. Drift between the TS hand-port and the Rust source of truth
    // produced FIX-001's "all rows hidden" bug; these tests pin the
    // start/end serial outputs so the bridge contract can't silently drift.

    fn ymd_to_serial_date(y: i32, m: u32, d: u32) -> f64 {
        date_to_serial(&NaiveDate::from_ymd_opt(y, m, d).unwrap())
    }

    #[test]
    fn test_compute_date_range_serial_today() {
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range_serial(&DynamicFilterRule::Today, now, Weekday::Sun).unwrap();
        let s = ymd_to_serial_date(2024, 6, 15);
        assert_eq!(start, s);
        assert_eq!(end, s);
    }

    #[test]
    fn test_compute_date_range_serial_this_week() {
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range_serial(&DynamicFilterRule::ThisWeek, now, Weekday::Sun).unwrap();
        assert_eq!(start, ymd_to_serial_date(2024, 6, 9));
        assert_eq!(end, ymd_to_serial_date(2024, 6, 15));
    }

    #[test]
    fn test_compute_date_range_serial_last_month() {
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range_serial(&DynamicFilterRule::LastMonth, now, Weekday::Sun).unwrap();
        assert_eq!(start, ymd_to_serial_date(2024, 5, 1));
        assert_eq!(end, ymd_to_serial_date(2024, 5, 31));
    }

    #[test]
    fn test_compute_date_range_serial_year_to_date_alias_this_year() {
        // We do not currently have a dedicated YearToDate variant; ThisYear
        // is the closest (Excel's "year to date" is implemented as a
        // condition filter `>= Jan 1`, not a dynamic rule). Pin the
        // boundary serials so any future YTD addition has an anchor.
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range_serial(&DynamicFilterRule::ThisYear, now, Weekday::Sun).unwrap();
        assert_eq!(start, ymd_to_serial_date(2024, 1, 1));
        assert_eq!(end, ymd_to_serial_date(2024, 12, 31));
    }

    #[test]
    fn test_compute_date_range_serial_yesterday_and_tomorrow() {
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (ystart, yend) =
            compute_date_range_serial(&DynamicFilterRule::Yesterday, now, Weekday::Sun).unwrap();
        assert_eq!(ystart, ymd_to_serial_date(2024, 6, 14));
        assert_eq!(yend, ymd_to_serial_date(2024, 6, 14));
        let (tstart, tend) =
            compute_date_range_serial(&DynamicFilterRule::Tomorrow, now, Weekday::Sun).unwrap();
        assert_eq!(tstart, ymd_to_serial_date(2024, 6, 16));
        assert_eq!(tend, ymd_to_serial_date(2024, 6, 16));
    }

    #[test]
    fn test_compute_date_range_serial_returns_none_for_above_below_average() {
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        assert!(
            compute_date_range_serial(&DynamicFilterRule::AboveAverage, now, Weekday::Sun)
                .is_none()
        );
        assert!(
            compute_date_range_serial(&DynamicFilterRule::BelowAverage, now, Weekday::Sun)
                .is_none()
        );
    }

    #[test]
    fn test_compute_date_range_serial_monday_week_start() {
        // With Mon-start, June 15 2024 (Sat) is in the week Mon Jun 10 .. Sun Jun 16.
        let now = NaiveDate::from_ymd_opt(2024, 6, 15).unwrap();
        let (start, end) =
            compute_date_range_serial(&DynamicFilterRule::ThisWeek, now, Weekday::Mon).unwrap();
        assert_eq!(start, ymd_to_serial_date(2024, 6, 10));
        assert_eq!(end, ymd_to_serial_date(2024, 6, 16));
    }
}
