//! Drawing types (ECMA-376 DrawingML).
//!
//! Unified from xlsx-parser read (`drawings/types.rs`) and write (`write/drawings/types.rs`)
//! sides. This module defines the canonical enum types with `from_ooxml` / `to_ooxml`
//! converters so both sides share one vocabulary.
//!
//! # OOXML Drawing Structure
//!
//! Drawing files are located at `xl/drawings/drawingN.xml` and contain:
//! - `<xdr:twoCellAnchor>` - Objects anchored between two cells
//! - `<xdr:oneCellAnchor>` - Objects anchored to one cell with extent
//! - `<xdr:absoluteAnchor>` - Objects with absolute positioning

mod color;
mod effects;
mod fill;
mod geometry;
mod line;
mod preset;
mod primitives;
mod properties;
mod spreadsheet;
mod style;
mod table;
mod text;
mod three_d;
mod transform;

pub use color::*;
pub use effects::*;
pub use fill::*;
pub use geometry::*;
pub use line::*;
pub use preset::*;
pub use primitives::*;
pub use properties::*;
pub use spreadsheet::*;
pub use style::*;
pub use table::*;
pub use text::*;
pub use three_d::*;
pub use transform::*;

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests;
