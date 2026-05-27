//! # Compute Table
//!
//! Table engine — filters, sort, slicers, structured refs, styles.
//!
//! Pure, stateless computation. No DOM, no Yjs, no React.

// -- Error types --
mod error;
pub use error::*;

// -- Foundation --
pub mod types; // All type definitions (wire format)

// -- Table CRUD --
pub mod operations;
pub mod queries; // Collection-level queries (find, overlap, validate)
pub mod table; // Pure single-table operations (create, resize, rename, etc.) // Validated operations combining table + queries

// -- Filter subsystem --
pub mod advanced_filter; // Advanced Filter DNF criteria evaluation
pub mod filter; // Filter evaluation (bitmap per column)
pub mod filter_dropdown;
pub mod filter_resolve; // Dynamic/top-bottom → concrete filter resolution; date range helpers

// Re-export filter_resolve functions needed by WASM bindings
pub use filter_resolve::{
    compute_date_range, compute_date_range_serial, evaluate_top_bottom_direct,
    resolve_dynamic_filter,
};

// -- Sort --
pub mod sort; // Sort permutation computation

// -- Visibility --
pub mod visibility; // Bitmap composition (AND across filter columns)

// -- Slicer subsystem --
pub mod slicer; // Slicer CRUD
pub mod slicer_cache; // Slicer cache builder
pub mod timeline; // Timeline slicer date utilities

// -- Structured References --
pub mod structured_refs; // Resolution, adjustment, formatting

// -- Styles --
pub mod custom_styles;
pub mod styles; // Built-in Excel table styles
#[cfg(test)]
mod styles_tests;

// -- Table features --
pub mod auto_expansion; // Auto-expand on adjacent cell edit
pub mod calculated_columns; // Calculated column formula helpers
pub mod events;
pub mod range_resolution; // CellId-based range resolution
pub mod selection; // Selection range helpers (Ctrl+Space, header click) // Table lifecycle event types + diff

// -- Internal --
pub mod compare; // Shared comparison utilities (exposed for WASM bridge)
