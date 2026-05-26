//! Cell identity and grid addressing types for the compute engine.
//!
//! This crate contains the "WHERE does data live?" types:
//! [`CellId`], [`SheetId`], [`RowId`], [`ColId`] (stable identity),
//! [`RangeId`], [`RangeKind`], [`RangeAnchor`] (range identity and metadata),
//! [`CellPos`], [`RangePos`], [`SheetPos`] (ephemeral positions),
//! and column letter conversion utilities.
//! It has zero internal compute-crate dependencies.

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![warn(clippy::all, clippy::pedantic)]

mod id_alloc;
mod identity;
/// Augmented interval tree for efficient 2D rectangle containment/overlap queries.
pub mod interval_tree;
mod position;
mod range_id;

pub use id_alloc::{IdAllocator, VIRTUAL_CELL_SENTINEL};
pub use identity::{
    AxisIdentityId, AxisIdentityIter, AxisIdentityRun, AxisIdentityRunRef, AxisIdentitySeed,
    AxisIdentitySegment, AxisIdentityStore, AxisKind, AxisRunId, CellId, ColId,
    CompactAxisIdentity, CompactAxisIdentityStore, NameId, RowId, SheetId, TableId,
};
pub use interval_tree::RectLike;
pub use position::{
    CellPos, MAX_COLS, MAX_ROWS, ParsePosError, RangePos, SheetPos, SheetRange, col_to_letter,
    col_to_letter_buf, letter_to_col,
};
pub use range_id::{AxisIdentityRef, PayloadEncoding, RangeAnchor, RangeId, RangeKind};
