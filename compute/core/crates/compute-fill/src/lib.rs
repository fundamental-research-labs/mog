//! Autofill engine — pattern detection, series generation, formula reference adjustment.

mod error;
pub use error::*;

pub mod engine;
mod engine_emitter;
mod engine_lanes;
mod engine_policy;
#[cfg(test)]
mod engine_tests;
mod engine_targets;
pub mod flash_fill;
pub mod formula_adjust;
pub mod helpers;
pub mod patterns;
pub mod series;
pub mod types;
