//! Number/date formatting and parsing utilities — stateless, no engine instance needed.

// Re-export the types consumers need
pub use compute_core::formats::DateValueResult;

use compute_core::bridge_pure::FormatBridge;

/// Prepare a date value (serial number + format code) from year/month/day.
pub fn prepare_date_value(
    year: i32,
    month: u32,
    day: u32,
    existing_format: Option<String>,
) -> DateValueResult {
    FormatBridge::prepare_date_value(year, month, day, existing_format)
}

/// Prepare a time value (serial number + format code) from hours/minutes/seconds.
pub fn prepare_time_value(
    hours: u32,
    minutes: u32,
    seconds: u32,
    existing_format: Option<String>,
) -> DateValueResult {
    FormatBridge::prepare_time_value(hours, minutes, seconds, existing_format)
}
