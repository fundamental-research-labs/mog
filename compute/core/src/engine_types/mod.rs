//! Compute-core-specific engine types.
//!
//! These are pure serializable data contracts — no Yrs, no CellMirror,
//! no compute-core internals. Types shared with other crates live in
//! the `domain_types` crate — import from there directly.

// Re-export shared types needed by binding crates via `use compute_core::engine_types::*`.
pub use domain_types::CellFormat;
pub use domain_types::ResolvedCellFormat;

// --- Compute-core-specific domain modules ---
pub mod annotations;
pub mod bindings;
pub mod cell_ops;
/// Conditional formatting presets and icon set registry.
pub mod cf;
/// Autofill bridge types.
pub mod fill;
pub mod floating_objects;
pub mod formatting;
pub mod grouping_render;
pub mod pivots;
/// Query-specific return types for engine IPC methods.
pub mod queries;
pub mod ranges;
pub mod sparklines;

pub use annotations::*;
pub use bindings::*;
pub use cell_ops::*;
pub use cf::*;
pub use fill::*;
pub use floating_objects::*;
pub use formatting::*;
pub use grouping_render::*;
pub use pivots::*;
pub use queries::*;
pub use ranges::*;
pub use sparklines::*;
