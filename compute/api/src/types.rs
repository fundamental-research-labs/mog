//! Re-exports from compute-core type crates.
//!
//! `compute-api` does NOT define parallel type hierarchies. All domain types
//! come from the engine's type crates.

// Cell identity and grid addressing
pub use cell_types::{CellId, CellPos, RangePos, SheetId, SheetPos};

// Cell values
pub use value_types::{CellError, CellValue, ComputeError};

// Snapshot and mutation types
pub use snapshot_types::{MutationResult, RecalcResult, SheetSnapshot, WorkbookSnapshot};
