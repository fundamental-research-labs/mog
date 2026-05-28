//! Positional address types — used for range iteration and display, NOT for identity.
//!
//! [`CellPos`] and [`RangePos`] use zero-based `(row, col)` indices within a sheet.
//! These are ephemeral coordinates derived from the position index; they change when
//! rows/columns are inserted or deleted. For stable identity, use [`super::CellId`].

mod a1;
mod point;
mod range_pos;
mod sheet_range;

pub use a1::{MAX_COLS, MAX_ROWS, ParsePosError, col_to_letter, col_to_letter_buf, letter_to_col};
pub use point::{CellPos, SheetPos};
pub use range_pos::RangePos;
pub use sheet_range::SheetRange;
