//! Concrete trait implementations wiring eval traits to CellMirror.
//!
//! These adapters implement compute-eval's abstract traits for compute-core's
//! concrete CellMirror data store. They live in compute-core (not compute-eval)
//! because they depend on CellMirror — standard dependency inversion.

pub mod mirror_access;
mod mirror_cell_ref_resolver;
pub mod mirror_context;
pub mod override_context;

pub use mirror_access::MirrorAccess;
pub(crate) use mirror_cell_ref_resolver::MirrorCellRefResolver;
pub use mirror_context::MirrorContext;
pub use override_context::OverrideContext;
