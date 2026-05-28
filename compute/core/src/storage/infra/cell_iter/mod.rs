//! Cell iteration, range clearing, cell relocation, and identity operations.
//!
//! GridIndex-backed port (GridIndex migration). All `(sheet, row, col) ↔ CellId`
//! resolution goes through `&GridIndex` / `&mut GridIndex`. Legacy
//! position sub-maps in the yrs doc are no longer consulted here.
//!
//! ## Responsibilities
//! - Iterate cells (all cells, cells in range) — via `grid.cells()` /
//!   `grid.cells_in_range(...)`.
//! - Clear cell ranges (with format preservation, returning cleared IDs).
//! - Relocate cells (cut-paste, drag-move with stable CellId preservation).
//! - Current region detection (Ctrl+Shift+* functionality).
//! - Cell identity operations (get/create CellId, get cells in range).
//!
//! ## Architecture
//! - `clear_cells_by_hex` is the position-agnostic value clear: preserves
//!   CellId (formulas referencing cleared cells get 0/empty, not #REF!).
//! - `clear_range_and_return_ids` fully deletes (for structural operations
//!   where #REF! is correct).
//! - `relocate_cells` is for cut-paste: CellIds are preserved, only
//!   positions change in the GridIndex.
//! - `get_current_region` expands outward from a cell until hitting empty
//!   rows/columns (via GridIndex `cell_id_at` probes).
//! - `get_data_bounds_for_range` constrains full-column selections to
//!   actual data.

mod clear;
mod identity;
mod iteration;
mod navigation;
mod read;
mod region;
mod relocation;
mod types;

#[cfg(test)]
mod tests;

pub(crate) use clear::{clear_cells_by_hex, clear_range_and_return_ids};
pub(crate) use identity::{get_or_create_cell_id, update_cell_position};
pub(crate) use iteration::{for_each_cell, for_each_cell_in_range};
pub(crate) use navigation::find_data_edge;
pub(crate) use region::{get_current_region, get_data_bounds_for_range};
pub(crate) use relocation::relocate_cells;
pub(crate) use types::{IterCellData, RangeSpan, RelocationResult};
