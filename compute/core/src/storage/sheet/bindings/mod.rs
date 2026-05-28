//! Sheet-level Data Binding CRUD operations.
//!
//! Port of `spreadsheet-model/src/bindings.ts` (spreadsheet-model elimination).
//!
//! Sheet-level bindings are position-based, NOT CellId-based.
//! They define a region where data will be written, creating new cells on refresh.
//!
//! ## Yrs Storage Layout
//!
//! Each sheet has a `bindings` map storing bindings as structured Y.Maps keyed by binding ID:
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- bindings: Y.Map
//!           +-- {bindingId}: Y.Map (structured SheetDataBinding)
//! ```

// Keep this file as the compatibility facade for `storage::sheet::bindings`.
// Implementation logic belongs in the focused submodules below.
mod codec;
mod connections;
mod crud;
mod ids;
mod yrs_io;

#[cfg(test)]
mod tests;

pub use crate::engine_types::bindings::*;

pub use connections::{get_bindings_for_connection, remove_bindings_for_connection};
pub use crud::{
    create_binding, get_all_bindings, get_binding, remove_binding, update_binding,
    update_refresh_metadata,
};
