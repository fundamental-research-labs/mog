//! Identity types stable across structural changes.
//!
//! The public crate re-exports these items from `cell_types::*`; the child
//! modules here are private implementation details.

mod axis_run;
mod axis_store;
mod base_ids;
mod compact_encoding;
mod doctests;
mod virtual_cell;

pub use axis_run::{AxisIdentityRun, AxisIdentityRunRef, AxisIdentitySegment};
pub use axis_store::{AxisIdentityIter, AxisIdentityStore, CompactAxisIdentityStore};
pub use base_ids::{CellId, ColId, NameId, RowId, SheetId, TableId};
pub use compact_encoding::{
    AxisIdentityId, AxisIdentitySeed, AxisKind, AxisRunId, CompactAxisIdentity,
};
