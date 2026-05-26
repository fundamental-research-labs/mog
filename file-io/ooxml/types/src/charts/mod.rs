//! Chart types (ECMA-376 Part 1, Section 21.2 -- DrawingML Charts).
//!
//! Unified superset of `xlsx-parser` read-side (`charts/types.rs`, `charts/axes.rs`,
//! `charts/series.rs`, `charts/mod.rs`) and write-side (`write/charts/types.rs`) types.
//!
//! The read side models OOXML element names directly (`barChart`, `lineChart`, etc.);
//! the write side uses composite presets (`BarStacked`, `ColumnStacked100`, etc.).
//! This module provides the canonical enum types with `from_ooxml` / `to_ooxml`
//! converters so both sides share one vocabulary.
//!
mod axis;
mod config;
mod data;
mod document;
mod enums;
mod properties;
mod series;
mod style;

#[cfg(test)]
mod tests;

// Re-export all public items to preserve the `ooxml_types::charts::*` API.

pub use axis::*;
pub use config::*;
pub use data::*;
pub use document::*;
pub use enums::*;
pub use properties::*;
pub use series::*;
pub use style::*;
