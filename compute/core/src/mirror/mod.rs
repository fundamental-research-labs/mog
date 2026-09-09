//! Cell Mirror — identity-indexed, in-process cell store.
//!
//! Native value authority, keyed by CellId, with compact identity-addressed import ranges.
//! Maintains a bidirectional position<->identity index so A1-notation references resolve to CellIds.
//!
//! # Design
//!
//! The mirror provides two lookup paths:
//! - **Identity path** (hot): `CellId -> CellEntry` via `FxHashMap` (~3-5ns).
//! - **Positional path** (warm): `(row, col) -> CellId` via `pos_to_id`, then identity lookup.
//!
//! Sheet names are normalized and stored lowercase for case-insensitive lookup
//! (Excel behavior).
//!
//! # Module layout
//!
//! - [`types`] — `CellEntry`, `SheetMirror`, `CellEdit` type definitions.
//! - [`cell_mirror`] — `CellMirror` struct definition and constructor.
//! - [`read`] — Read-only accessors (get values, resolve positions, sheet lookups).
//! - [`write`] — Mutable cell operations (set, insert, remove, apply edits).
//! - [`snapshot`] — Bulk-loading from `WorkbookSnapshot`.
//! - [`sheet`] — Sheet-level CRUD (remove, rename).
//! - [`sheet_key`] — Sheet-name normalization and cache diagnostics.
//! - [`structure`] — Structural changes (insert/delete rows/cols, remap positions).
//! - [`metadata`] — Named ranges, tables, dense cache accessors.
//! - [`dense`] — Dense columnar cache for SIMD-accelerated aggregation.

pub mod dense;
pub mod range_view;
pub mod variable_store;

pub(crate) mod cell_metadata;
mod cell_mirror;
mod history;
mod metadata;
mod read;
mod sheet;
mod sheet_key;
mod snapshot;
mod structure;
mod types;
mod write;

#[cfg(test)]
mod materialize_pivot_tests;
#[cfg(test)]
mod test_helpers;
#[cfg(test)]
mod tests;

// Re-export the public API.
pub use cell_mirror::CellMirror;
#[cfg(test)]
pub(crate) use cell_types::RangeId;
pub use read::MirrorPositionLookup;
pub use sheet_key::{clear_caches, sheet_name_cache_entry_count};
pub use types::{CellEdit, CellEntry, MergeRegion, SheetMirror};
pub(crate) use types::{ColumnFormatRange, FormatRange, FormatRangeLayer};
