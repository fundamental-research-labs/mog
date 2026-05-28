//! Lookup indexes for column-oriented and row-oriented lookup fast paths.
//!
//! `LookupIndex` indexes a column by row for VLOOKUP/MATCH/XLOOKUP paths.
//! `HorizontalLookupIndex` indexes a row by column for HLOOKUP paths.

mod horizontal;
mod vertical;

pub use horizontal::HorizontalLookupIndex;
pub use vertical::LookupIndex;
