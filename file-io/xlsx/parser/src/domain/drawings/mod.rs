//! Drawing object parser for XLSX files
//!
//! This module parses drawingN.xml files to extract images, shapes, text boxes,
//! connectors, and group shapes with their anchor positions.
//!
//! # XLSX Drawing Structure
//!
//! Drawing files are located at `xl/drawings/drawingN.xml` and contain:
//! - `<xdr:twoCellAnchor>` - Objects anchored between two cells
//! - `<xdr:oneCellAnchor>` - Objects anchored to one cell with extent
//! - `<xdr:absoluteAnchor>` - Objects with absolute positioning
//!
//! Each anchor contains drawing content like pictures, shapes, or groups.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices XML
//! tag / attribute content at byte offsets produced by ASCII-only XML
//! syntax (`<`, `>`, `/`, `"`, `=`). Char-boundary by construction.
//! File-scope allow documented here.

#![allow(clippy::string_slice)]

pub mod convert;
pub mod facts;
mod helpers;
mod hyperlinks;
mod images;
mod parse;
mod reader;
mod shapes;
mod text;
pub(crate) mod types;
pub mod write;

#[cfg(test)]
mod tests;

// Re-export all public types
pub use types::*;

// Re-export parsing functions that may be needed externally
pub use helpers::{decode_xml_entities, decode_xml_entities_string};
pub(crate) use hyperlinks::resolve_drawing_hyperlink_targets;
pub use parse::drawing::parse_drawing;
pub use parse::non_visual::parse_nv_props;
pub use parse::pictures::parse_blip_fill;
pub use parse::shapes::{parse_shape, parse_shape_preset};
pub use parse::styling::{
    parse_color, parse_dash_style, parse_effect_list, parse_fill, parse_outline,
    parse_shape_properties, parse_shape_style, parse_transform_2d, scheme_name_to_index,
};
pub(crate) use reader::raw::relationship_ids_in_raw;
pub use text::parse_text_body;
