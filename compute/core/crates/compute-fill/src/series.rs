//! Series generation — produce fill values from detected patterns.
//!
//! Given a [`FillPattern`] and source values, generates the next `count` values
//! in the series. Each pattern type has its own generation strategy.

mod common;
mod cyclic;
mod date;
mod numeric;
mod textual;

use value_types::CellValue;

use crate::types::{CustomList, DateUnit, FillPattern, FillPatternType, LocaleNames, TimeUnit};

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
        FillPatternType::Copy => common::generate_copy(source_values, count),
        FillPatternType::Linear => {
            let step = pattern.step.unwrap_or(1.0);
            numeric::generate_linear(source_values, count, step, direction_mult)
        }
        FillPatternType::Growth => {
            let multiplier = pattern.multiplier.unwrap_or(2.0);
            numeric::generate_growth(source_values, count, multiplier, direction_mult)
        }
        FillPatternType::Date => {
            let unit = pattern.date_unit.unwrap_or(DateUnit::Day);
            let step = pattern.step.unwrap_or(1.0) as i32;
            date::generate_date(source_values, count, unit, step, direction_mult)
        }
        FillPatternType::Time => {
            let unit = pattern.time_unit.unwrap_or(TimeUnit::Hour);
            let step = pattern.step.unwrap_or(1.0);
            numeric::generate_time(source_values, count, unit, step, direction_mult)
        }
        FillPatternType::Weekday => {
            cyclic::generate_weekday(source_values, count, direction_mult, locale)
        }
        FillPatternType::WeekdayShort => {
            cyclic::generate_weekday_short(source_values, count, direction_mult, locale)
        }
        FillPatternType::Month => {
            cyclic::generate_month(source_values, count, direction_mult, locale)
        }
        FillPatternType::MonthShort => {
            cyclic::generate_month_short(source_values, count, direction_mult, locale)
        }
        FillPatternType::Quarter => cyclic::generate_quarter(pattern, count, direction_mult),
        FillPatternType::TextWithNumber => {
            let prefix = pattern.prefix.as_deref().unwrap_or("");
            let step = pattern.step.unwrap_or(1.0) as i64;
            let num_digits = pattern.num_digits.unwrap_or(0);
            textual::generate_text_with_number(
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
            textual::generate_ordinal(source_values, count, step, direction_mult)
        }
        FillPatternType::CustomList => cyclic::generate_custom_list(
            source_values,
            count,
            direction_mult,
            pattern,
            custom_lists,
        ),
    }
}

#[cfg(test)]
mod tests;
