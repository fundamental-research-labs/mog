//! # Compute Document
//!
//! CRDT document layer for spreadsheet storage. Provides the Yrs document
//! schema, cell serialization, hex encoding helpers, undo/redo management,
//! change observation, and grid identity tracking.
//!
//! This crate owns the "what does a CRDT spreadsheet document look like?"
//! concern, separate from the compute engine (formula eval, dep graph, recalc)
//! and the sync protocol (compute-collab).

pub mod error;
pub use error::*;

pub mod cell_serde;
pub mod hex;
pub mod identity;
pub mod observe;
pub mod range;
pub mod schema;
pub mod security_store;
pub mod undo;
pub mod workbook_metadata;

pub use security_store::{SecurityStore, SecurityStoreOwned};
