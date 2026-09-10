//! System clock abstraction for NOW()/TODAY() functions.
//!
//! Provides an injectable timestamp mechanism:
//! - On WASM, JavaScript sets the time before each recalc via `set_current_time()`
//! - On native, falls back to the shared runtime clock primitive
//! - For testing, `set_current_time()` enables deterministic evaluation
//!
//! The thread-local hook remains the compatibility/session input. A
//! [`RecalcClock`] captures that hook at a recalc boundary and is copied into
//! every evaluator context, including Rayon workers. When neither an explicit
//! recalc timestamp nor a session hook is present, the context delegates to
//! [`get_current_serial_timestamp`] so the existing live-clock behavior is
//! unchanged.

use chrono::{NaiveDate, NaiveDateTime, Timelike};
use std::cell::Cell;

use crate::functions::helpers::date_serial::{date_to_serial, serial_to_date};

/// Number of serial days between the canonical 1900 system and the 1904
/// workbook system. Clock inputs are always canonical 1900 serial instants;
/// evaluator metadata applies this offset for a 1904 workbook.
pub(crate) const DATE_SYSTEM_1904_OFFSET: f64 = 1462.0;

thread_local! {
    static INJECTED_TIMESTAMP: Cell<f64> = const { Cell::new(0.0) };
}

/// Immutable clock input for one recalc/evaluation scope.
///
/// The stored timestamp, when present, is a canonical 1900-system serial
/// instant. `None` means live clock lookup. It deliberately does not snapshot
/// the live system clock: callers that do not opt into deterministic time
/// retain the previous behavior. An injected session timestamp, however, is
/// captured at the recalc boundary so a value set on the caller thread reaches
/// Rayon workers too.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct RecalcClock {
    fixed_timestamp: Option<f64>,
}

impl RecalcClock {
    /// Use the existing live clock behavior for this evaluation context.
    pub(crate) const fn live() -> Self {
        Self {
            fixed_timestamp: None,
        }
    }

    /// Capture an optional explicit timestamp, falling back to the current
    /// thread's session hook when no per-recalc timestamp was supplied.
    pub(crate) fn for_recalc(explicit_timestamp: Option<f64>) -> Self {
        Self {
            fixed_timestamp: explicit_timestamp.or_else(injected_serial_timestamp),
        }
    }

    /// Return the canonical 1900-system timestamp for this context.
    #[inline]
    pub(crate) fn current_timestamp(self) -> f64 {
        self.fixed_timestamp
            .unwrap_or_else(get_current_serial_timestamp)
    }

    /// Return this context's timestamp in the workbook's serial system.
    ///
    /// The caller supplies `true` for a 1904 workbook. The real calendar date
    /// represented by the clock does not change; only the workbook-relative
    /// serial returned to NOW()/TODAY() changes.
    #[inline]
    pub(crate) fn current_timestamp_for_workbook(self, date1904: bool) -> f64 {
        let timestamp = self.current_timestamp();
        if date1904 {
            timestamp - DATE_SYSTEM_1904_OFFSET
        } else {
            timestamp
        }
    }

    /// Return the calendar date for this context's timestamp.
    pub(crate) fn current_calendar_date(self) -> NaiveDate {
        serial_to_date(self.current_timestamp())
            .unwrap_or_else(|| NaiveDate::from_ymd_opt(1899, 12, 31).unwrap())
    }

    pub(crate) const fn is_fixed(self) -> bool {
        self.fixed_timestamp.is_some()
    }
}

/// Return the caller-thread session timestamp, if one is currently injected.
///
/// This is intentionally separate from `get_current_serial_timestamp()`: a
/// recalc context must distinguish "no session override" from a live clock so
/// it can preserve live behavior while still propagating a session override
/// to worker threads.
pub(crate) fn injected_serial_timestamp() -> Option<f64> {
    INJECTED_TIMESTAMP.with(|t| {
        let injected = t.get();
        (injected.is_finite() && injected != 0.0).then_some(injected)
    })
}

/// Set the current time for NOW()/TODAY() as a canonical 1900-system serial
/// date number. Workbook date-system conversion happens in evaluator metadata.
///
/// On WASM, this should be called from JavaScript before each recalc
/// with the value from `Date.now()` converted to an Excel serial number.
///
/// Pass `0.0` to clear the override (native will fall back to system clock).
pub fn set_current_time(serial_timestamp: f64) {
    // Keep the legacy `0.0` clear operation intact, but never let an invalid
    // bridge value poison the session hook. Ignoring NaN/∞ preserves the
    // previous valid override (or the live-clock fallback when none exists).
    if serial_timestamp.is_finite() {
        INJECTED_TIMESTAMP.with(|t| t.set(serial_timestamp));
    }
}

/// Get the current timestamp as a canonical 1900-system serial date number.
///
/// Returns the injected timestamp if set, otherwise falls back to the system clock
/// on native targets or a placeholder on WASM.
pub fn get_current_serial_timestamp() -> f64 {
    if let Some(injected) = injected_serial_timestamp() {
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

/// Get the current real calendar date represented by NOW()/TODAY() — i.e. the
/// canonical JS-injected serial when present, otherwise UTC system time on
/// native targets. The workbook's 1900/1904 serial offset is intentionally
/// not applied because a calendar date has no serial-system adjustment.
///
/// Used by date-range filter operators (Last Month, This Year, Today, …)
/// so they share the session-aware "now" reference instead of falling back
/// to host UTC.
///
/// Returns Excel's epoch date (1899-12-31) on impossible inputs; callers
/// can treat that as a noop reference.
pub fn current_calendar_date() -> NaiveDate {
    RecalcClock::live().current_calendar_date()
}
