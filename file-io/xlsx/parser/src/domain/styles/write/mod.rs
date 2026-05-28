//! Styles writer for XLSX generation.
//!
//! This module generates `xl/styles.xml` for XLSX files, including:
//! - Number formats (custom and built-in)
//! - Fonts
//! - Fills (solid, pattern, gradient)
//! - Borders
//! - Cell XFs (style combinations)
//!
//! # Module Structure
//!
//! - `types` - Type definitions for all style components
//! - `writer` - Main StylesWriter implementation
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::styles::{StylesWriter, FontDef, FillDef, ColorDef};
//!
//! let mut writer = StylesWriter::with_defaults();
//!
//! // Add a bold red font
//! let font_id = writer.add_font(FontDef {
//!     name: "Calibri".to_string(),
//!     size: 11.0,
//!     bold: true,
//!     color: Some(ColorDef::rgb("FFFF0000")),
//!     ..Default::default()
//! });
//!
//! // Create a style using that font
//! let style_id = writer.create_style(
//!     Some(FontDef { bold: true, ..Default::default() }),
//!     None,
//!     None,
//!     Some("#,##0.00"),
//!     None,
//! );
//!
//! let xml = writer.to_xml();
//! ```

pub mod types;
pub mod writer;

mod borders;
mod cell_styles;
mod colors;
mod dxfs;
mod fills;
mod fonts;
mod number_formats;
mod root;
mod table_styles;
mod xfs;

#[cfg(test)]
mod tests;

// Re-export all public types
pub use super::types::{
    AlignmentDef, BorderDef, BorderSideDef, BorderStyle, CellStyleDef, CellXfDef, ColorDef,
    ColorsDef, DxfDef, FillDef, FontDef, FontScheme, GradientStop, GradientType, HorizontalAlign,
    NumberFormatDef, PatternType, ProtectionDef, Stylesheet, TableStyleDef, TableStyleElementDef,
    TableStyleType, UnderlineStyle, VerticalAlign, VerticalAlignRun,
};

pub use writer::{StyleRootNamespaces, StylesWriter};
