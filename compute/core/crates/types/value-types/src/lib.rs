//! Universal data-value primitives for the Mog compute engine.
//!
//! This crate provides the foundational value types shared across all compute
//! crates: [`CellValue`], [`CellError`], [`FiniteF64`], [`Color`], and
//! date-serial utilities.
//!
//! # Key design decisions
//!
//! * **NaN-free by construction** — [`FiniteF64`] is a newtype over `f64` that
//!   statically guarantees the value is neither NaN nor ±∞. All numeric
//!   [`CellValue`] variants store `FiniteF64`.
//! * **O(1) clone** — Text values use `Arc<str>` and arrays use
//!   `Arc<CellArray>`, making [`CellValue::clone`] allocation-free.
//! * **Excel-compatible semantics** — Equality is case-insensitive for text,
//!   error messages are excluded from comparison, and date serials handle the
//!   Lotus 1-2-3 leap-year bug.
//!
//! # Feature flags
//!
//! * **`dd-precision`** — Adds a `lo` error-term field to [`FiniteF64`],
//!   enabling double-double (~31 digit) precision for compensated summation.

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(clippy::all, clippy::pedantic)]

mod cell_array;
mod cell_image;
mod cell_value;
mod color;
mod errors;
mod finite_f64;
mod kahan;
mod lambda;

/// Double-double arithmetic for extended-precision computation.
///
/// This module is unconditionally public (even without the `dd-precision`
/// feature) because `F64x2` and `DdSum` are useful for standalone
/// extended-precision arithmetic and testing, independent of whether
/// `FiniteF64` carries an error term.
pub mod f64x2;

/// Dense columnar value types for fast aggregation.
pub mod dense;

/// Excel serial date conversion primitives.
pub mod date_serial;

/// Excel-compatible 15-significant-digit precision model.
pub mod precision;

// --- Flat re-exports: the public API surface of this crate. ---
// All frequently-used types and functions are re-exported at the crate root
// so consumers can write `use value_types::X` without knowing module paths.
// Submodules (`date_serial`, `precision`, `dense`, `f64x2`) are also public
// for consumers who need the full module namespace.

pub use cell_array::{CellArray, CellArrayError};
pub use cell_image::{CellImage, CellImageSizing};
pub use cell_value::{CellControl, CellControlType, CellValue, format_number};
pub use color::{Color, HexColorError};
pub use date_serial::{
    DateParseError, actual_days_between, add_months_to_serial, date_to_serial, days_in_month,
    days_in_year_by_basis, days360_between, is_leap_year, serial_to_date, serial_to_ymd,
    try_parse_date, try_parse_datetime, try_parse_time, year_frac, ymd_to_serial,
};
pub use dense::{DENSE_THRESHOLD, DenseBoolMask, DenseColumn};
pub use errors::{CellError, ComputeError, ParseCellErrorError};
pub use f64x2::{DdSum, F64x2, two_diff, two_prod, two_sum};
pub use finite_f64::{FiniteF64, NonFiniteError};
pub use kahan::{KahanSum, kahan_sum};
pub use lambda::{LambdaNode, LambdaNodeClone};
pub use precision::{
    cmp_15_significant_digits, excel_round, excel_round_to_decimal_places,
    snap_to_15_significant_digits, subtraction_cancels_at_15_digits,
};

// Compile-time assertion: ensures CellValue types are Send+Sync for parallel eval
#[allow(dead_code)]
const _: () = {
    fn assert_send_sync<T: Send + Sync>() {}
    fn check() {
        assert_send_sync::<CellValue>();
        assert_send_sync::<CellArray>();
        assert_send_sync::<CellError>();
        assert_send_sync::<FiniteF64>();
        assert_send_sync::<Color>();
        assert_send_sync::<f64x2::F64x2>();
        assert_send_sync::<f64x2::DdSum>();
        assert_send_sync::<KahanSum>();
    }
};
