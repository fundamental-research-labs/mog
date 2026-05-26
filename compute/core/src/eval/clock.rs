//! System clock abstraction for NOW()/TODAY() functions.
//!
//! Provides an injectable timestamp mechanism:
//! - On WASM, JavaScript sets the time before each recalc via `set_current_time()`
//! - On native, falls back to the shared runtime clock primitive
//! - For testing, `set_current_time()` enables deterministic evaluation

use chrono::{NaiveDate, NaiveDateTime, Timelike};
use std::cell::Cell;

use crate::functions::helpers::date_serial::{date_to_serial, serial_to_date};

thread_local! {
    static INJECTED_TIMESTAMP: Cell<f64> = const { Cell::new(0.0) };
}

/// Set the current time for NOW()/TODAY() as an Excel serial date number.
///
/// On WASM, this should be called from JavaScript before each recalc
/// with the value from `Date.now()` converted to an Excel serial number.
///
/// Pass `0.0` to clear the override (native will fall back to system clock).
pub fn set_current_time(serial_timestamp: f64) {
    INJECTED_TIMESTAMP.with(|t| t.set(serial_timestamp));
}

/// Get the current timestamp as an Excel serial date number.
///
/// Returns the injected timestamp if set, otherwise falls back to the system clock
/// on native targets or a placeholder on WASM.
pub fn get_current_serial_timestamp() -> f64 {
    let injected = INJECTED_TIMESTAMP.with(|t| t.get());
    if injected != 0.0 {
        return injected;
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        chrono::DateTime::from_timestamp_millis(millis)
            .map(|dt| datetime_to_serial(&dt.naive_utc()))
            .unwrap_or(45000.5)
    }

    #[cfg(target_arch = "wasm32")]
    {
        45000.5
    }
}

fn datetime_to_serial(dt: &NaiveDateTime) -> f64 {
    let date_part = date_to_serial(&dt.date());
    let time_part =
        (dt.hour() as f64 * 3600.0 + dt.minute() as f64 * 60.0 + dt.second() as f64) / 86400.0;
    date_part + time_part
}

/// Get the current calendar date as a `NaiveDate` in the same frame as
/// NOW()/TODAY() — i.e. the JS-injected serial when present, otherwise UTC
/// system time on native targets.
///
/// Used by date-range filter operators (Last Month, This Year, Today, …)
/// so they share the session-aware "now" reference instead of falling back
/// to host UTC.
///
/// Returns Excel's epoch date (1899-12-31) on impossible inputs; callers
/// can treat that as a noop reference.
pub fn current_calendar_date() -> NaiveDate {
    serial_to_date(get_current_serial_timestamp())
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(1899, 12, 31).unwrap())
}
