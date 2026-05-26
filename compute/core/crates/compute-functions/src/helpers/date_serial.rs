//! Date serial conversion and arithmetic helpers for Excel functions.
//!
//! Core primitives (serial_to_date, date_to_serial, etc.) are re-exported
//! from value-types. Date arithmetic helpers (add_months_to_serial, etc.)
//! are also re-exported from value-types where they now canonically live.

// Re-export core primitives from value-types (the canonical source)
pub use value_types::date_serial::{
    date_to_serial, days_in_month, is_leap_year, serial_to_date, serial_to_ymd, ymd_to_serial,
};

// Re-export date arithmetic helpers from value-types (moved there for broader reuse)
pub use value_types::date_serial::{
    actual_days_between, add_months_to_serial, days_in_year_by_basis, days360_between, year_frac,
};
