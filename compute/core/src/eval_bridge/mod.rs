//! Concrete trait implementations wiring eval traits to CellStore.
//!
//! These adapters implement compute-eval's abstract traits for compute-core's
//! concrete CellStore data store. They live in compute-core (not compute-eval)
//! because they depend on CellStore — standard dependency inversion.

pub mod eval_context;
pub mod override_context;
pub mod store_access;
mod store_cell_ref_resolver;

pub use eval_context::EvalContext;
pub use override_context::OverrideContext;
pub use store_access::StoreAccess;
pub(crate) use store_cell_ref_resolver::StoreCellRefResolver;
