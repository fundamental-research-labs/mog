//! Cell Identity Model — per-sheet identity-position tracker.
//!
//! The `GridIndex` generates and tracks CellId/RowId/ColId identifiers,
//! maintaining bidirectional position-identity mappings. CellIds are created
//! lazily (only when a cell is first written to), while RowIds and ColIds are
//! dense (every row/column has one from creation).
//!
//! This is the Rust port of the TypeScript `GridIndex` from the spreadsheet engine.

mod grid_index;

#[cfg(test)]
mod tests;

pub use grid_index::GridIndex;
