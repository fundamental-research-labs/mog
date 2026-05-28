//! Pivot table and pivot cache types (ECMA-376 Part 1, Section 18.10 — SpreadsheetML Pivot Tables).
//!
//! Types modelling pivot table definitions (`xl/pivotTables/pivotTable{N}.xml`)
//! and pivot cache definitions (`xl/pivotCache/pivotCacheDefinition{N}.xml`).
//!
//! This module is split into focused submodules:
//! - [`cache`] — cache definition types (fields, sources, shared items, grouping)
//! - [`field`] — pivot field and item types (data fields, row/col/page references)
//! - [`layout`] — layout, format, and area types (formats, conditional formats, chart formats)
//!
//! All public types are re-exported from this module so that existing consumers
//! using `ooxml_types::pivot::XYZ` continue to work without changes.
//! The types are not a cache-correctness guarantee; parser/writer code owns
//! source validity, relationship closure, and edit invalidation.

pub mod cache;
pub mod field;
pub mod layout;

mod enums;
mod grouping;
mod items;
mod primitives;
mod shared_items;
mod table;

pub use cache::*;
pub use enums::*;
pub use field::*;
pub use grouping::*;
pub use items::*;
pub use layout::*;
pub use primitives::*;
pub use shared_items::*;
pub use table::*;
