//! Excel-compatible function library — 512+ pure functions.
//!
//! Every function is a `PureFunction`: `(&[CellValue]) -> CellValue`.
//! No evaluation context, no cell references, no side effects.
//!
//! Functions that need per-argument error propagation semantics (e.g.,
//! COUNTIF, SUMIFS) implement `ExcelFunction` instead, which declares
//! a `FunctionSignature` with `ArgRole` metadata.

// Public API
mod error;
pub use error::*;

mod array_lift;
mod excel_function;
mod registered_function;
mod registry;
pub mod signature;
mod trait_def;

pub use excel_function::ExcelFunction;
pub use registered_function::RegisteredFunction;
pub use registry::FunctionRegistry;
pub use signature::{ArgRole, ArgSpec, FunctionSignature, VariadicSpec};
pub use trait_def::PureFunction;

// Shared infrastructure (renamed from `core` to avoid shadowing Rust's core crate)
// SPI for compute-core scheduler/evaluator — gated behind `__internal` feature.
#[cfg(feature = "__internal")]
pub mod helpers;
// Without `__internal`, these helpers are crate-private implementation details.
// The production consumer (`compute-core`) enables `__internal`, where they are
// part of the scheduler/evaluator SPI.
#[cfg(not(feature = "__internal"))]
#[allow(dead_code, unused_imports)]
pub(crate) mod helpers;

#[cfg(feature = "__internal")]
pub mod math_primitives;
// See `helpers` above: these primitives are SPI when `__internal` is enabled.
#[cfg(not(feature = "__internal"))]
#[allow(dead_code)]
pub(crate) mod math_primitives;

// Re-exported helpers used by compute-core's AGGREGATE dispatch (func_nums 14-19).
// These are intentionally public regardless of `__internal` — they are part of the
// stable function library API, not scheduler SPI.
pub use statistical::helpers::{percentile_exc, percentile_inc};

// Domain modules
pub(crate) mod database;
pub(crate) mod datetime;
pub(crate) mod engineering;
pub(crate) mod financial;
pub(crate) mod information;
pub(crate) mod logical;
#[cfg(feature = "__internal")]
pub mod lookup;
#[cfg(not(feature = "__internal"))]
pub(crate) mod lookup;
pub(crate) mod math;
pub(crate) mod statistical;
pub(crate) mod text;
pub(crate) mod web;
