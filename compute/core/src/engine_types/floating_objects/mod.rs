//! Compute-core-specific floating object types (position, size, groups, z-order).
//!
//! Core floating object types live in `domain_types::domain::floating_object` —
//! import from there directly.

pub mod operations;
pub mod shape_types;

pub use operations::*;
pub use shape_types::*;

// SerializedFloatingObjectGroup and ZOrderEntry are now in snapshot-types.
pub use snapshot_types::object_ops::{SerializedFloatingObjectGroup, ZOrderEntry};
