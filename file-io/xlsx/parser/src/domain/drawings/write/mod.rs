//! Drawing writer for XLSX files
//!
//! This module generates `xl/drawings/drawingN.xml` files containing DrawingML
//! for images, shapes, text boxes, chart anchors, and connectors.
//!
//! # XLSX Drawing Structure
//!
//! Drawing files contain various anchor types:
//! - `<xdr:twoCellAnchor>` - Objects anchored between two cells (resize with cells)
//! - `<xdr:oneCellAnchor>` - Objects anchored to one cell with fixed size
//! - `<xdr:absoluteAnchor>` - Objects with absolute positioning
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::drawings::{DrawingWriter, CellAnchor, ImageProps, DrawingLocking};
//!
//! let xml = DrawingWriter::new()
//!     .add_picture(
//!         CellAnchor { col: 1, col_off: 0, row: 1, row_off: 0 },
//!         CellAnchor { col: 5, col_off: 0, row: 10, row_off: 0 },
//!         ImageProps {
//!             name: "Image 1".to_string(),
//!             r_id: "rId1".to_string(),
//!             locks: DrawingLocking { no_change_aspect: true, ..Default::default() },
//!             ..Default::default()
//!         },
//!     )
//!     .to_xml();
//! ```

pub(crate) mod convert;
mod helpers;
pub(crate) mod types;
mod writer;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod roundtrip_tests;

#[cfg(test)]
mod picture_roundtrip_tests;

// Re-export conversion functions
pub use convert::connector_to_props;
pub use convert::convert_drawing_content;
pub use convert::group_shape_to_props;
pub use convert::picture_to_image_props;
pub use convert::populate_smartart_parts;
pub use convert::{convert_absolute_anchor, convert_one_cell_anchor, convert_two_cell_anchor};

// Re-export all public types
pub use helpers::{
    cm_to_emu, emu_to_cm, emu_to_inches, inches_to_emu, pixels_to_emu, points_to_emu,
};
pub use types::{
    AbsoluteAnchor, Bevel, BevelPresetType, BlackWhiteMode, BlipEffect, BulletColor,
    BulletProperties, BulletSize, BulletType, CellAnchor, ChartExRef, ChartRef, ClientData,
    CompoundLine, CompressionState, Connection, ConnectorProps, DIAGRAM_GRAPHIC_DATA_URI,
    DashStyle, DrawingAnchor, DrawingColor, DrawingFill, DrawingLocking, DrawingObject,
    EMUS_PER_CM, EMUS_PER_INCH, EMUS_PER_POINT, EditAs, EffectList, EffectProperties, Emu,
    ExtensionList, Extent, FillMode, GeomGuide, GradientFill, GradientStop, GroupLocking,
    GroupShapeProps, GroupTransform2D, Hyperlink, ImageProps, LineCap, LineEndProperties,
    LineEndSize, LineEndType, LineJoin, NS_A, NS_A14, NS_C, NS_CX, NS_CX1, NS_DGM, NS_MC, NS_R,
    NS_SLE, NS_XDR, OneCellAnchor, OpaqueDrawingObject, OpaqueGraphicFrame, Outline, Paragraph,
    ParagraphProperties, PatternFill, PenAlignment, Position, PresetGeometry, PresetMaterialType,
    RunProperties, SLICER_GRAPHIC_DATA_URI, Scene3D, SchemeColor, Shape3D, ShapePreset, ShapeProps,
    ShapeStyle, SmartArtWriteData, SolidFill, SourceRect, StyleRef, TextAlign, TextAnchor,
    TextAutofit, TextAutonumberType, TextBody, TextBodyProperties, TextBox, TextCapsType, TextFont,
    TextFontAlignType, TextHorzOverflow, TextListStyle, TextRun, TextRunContent, TextSpacing,
    TextStrikeType, TextTabAlignType, TextTabStop, TextUnderlineType, TextVertOverflow,
    TextVerticalType, TextWrap, Transform2D, TwoCellAnchor, UnderlineFill, UnderlineLine,
};
pub use writer::DrawingWriter;
#[cfg(test)]
pub(crate) use writer::{write_scene3d, write_shape3d};
