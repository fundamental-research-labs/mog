//! Autofill engine — pattern detection, series generation, formula reference adjustment.

mod error;
pub use error::*;

pub mod engine;
mod engine_emitter;
mod engine_lanes;
mod engine_policy;
mod engine_targets;
#[cfg(test)]
mod engine_tests;
pub mod flash_fill;
pub mod formula_adjust;
pub mod helpers;
pub mod patterns;
pub mod series;
pub mod types;
