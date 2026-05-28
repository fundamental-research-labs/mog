//! Validation domain types and conversion helpers.
//!
//! The child modules keep OOXML validation specs, runtime schema DTOs, result
//! DTOs, range-reference helpers, and lossy runtime/spec conversion logic in
//! focused files while this facade preserves the existing public API.

mod conversion;
mod range_ref;
mod result;
mod schema_types;
mod spec;

pub use result::*;
pub use schema_types::*;
pub use spec::*;
