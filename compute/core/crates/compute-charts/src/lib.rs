//! Chart data transforms for the Shortcut compute engine.
//!
//! This crate handles chart-specific data transforms: stacking, grouping,
//! and the full transform pipeline. General-purpose statistics, regression,
//! and KDE are provided by `compute-stats` and re-exported here for
//! backwards compatibility.
//!
//! The TS `@mog/charts` package remains a standalone library with
//! its own transforms for testing/independent use. This crate provides
//! a high-performance WASM-backed alternative invoked via the chart bridge.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────┐
//! │  chart-bridge.ts (kernel)                   │
//! │  Intercepts transforms at getMarks()        │
//! ├─────────────────────────────────────────────┤
//! │  compute-core-wasm                          │
//! │  chart_apply_transforms() WASM export       │
//! ├─────────────────────────────────────────────┤
//! │  compute-charts (this crate)                │
//! │  stacking   │ grouping   │ transforms       │
//! ├─────────────────────────────────────────────┤
//! │  compute-stats (reused)                     │
//! │  statistics │ regression │ describe │ kde   │
//! │  aggregate  │ percentile │ values           │
//! └─────────────────────────────────────────────┘
//! ```

mod error;
pub use error::*;

pub mod types;
mod utils;
pub use compute_stats::regression;
pub use compute_stats::statistics;
pub mod grouping;
pub mod stacking;
pub mod transforms;

#[cfg(test)]
mod types_tests;
