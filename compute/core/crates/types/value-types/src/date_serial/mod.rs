//! Excel-compatible serial date primitives.
//!
//! Excel serial date numbers count days since 1899-12-31, with the Lotus
//! 1-2-3 compatibility bug that treats serial 60 as the fictional
//! February 29, 1900.
//!
//! `value-types` owns reusable serial conversion, text parsing, and generic
//! day-count helpers. Higher-level compute-function code owns function
//! dispatch, argument validation, error mapping, and function-specific rules.

mod arithmetic;
mod calendar;
mod parsing;

pub use arithmetic::{
    actual_days_between, add_months_to_serial, days_in_year_by_basis, days360_between, year_frac,
};
pub use calendar::{
    date_to_serial, days_in_month, is_leap_year, serial_to_date, serial_to_ymd, ymd_to_serial,
};
pub use parsing::{DateParseError, try_parse_date, try_parse_datetime, try_parse_time};
