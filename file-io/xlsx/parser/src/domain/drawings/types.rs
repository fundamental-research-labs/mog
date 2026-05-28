//! Core type definitions for drawings.
//!
//! This module contains all the struct and enum definitions for representing
//! drawing objects in XLSX files.
//!
//! Shared enum types are re-exported from `ooxml_types::drawings`.

// Re-export shared enum types from ooxml-types.
pub use ooxml_types::drawings::{
    BlackWhiteMode, BlurEffect as ShapeBlurEffect, ClientData, EffectList, EffectProperties,
    FillOverlayEffect, Glow, GroupLocking, GroupShapeProperties, GroupTransform2D, InnerShadow,
    OuterShadow, PresetShadow, Reflection, Scene3D, Shape3D, SoftEdge,
};
pub use ooxml_types::drawings::{
    BlipEffect, FillMode, RectAlignment, SourceRect, TileFill, TileFlipMode,
};
pub use ooxml_types::drawings::{
    CompoundLine, CompressionState, DashStyle, DrawingLocking, EditAs, Hyperlink, LineCap,
    LineEndProperties, LineEndSize, LineEndType, LineJoin, PenAlignment, ShapePreset, TextAlign,
    TextAnchor, TextWrap,
};
// Re-export text types from ooxml-types.
pub use ooxml_types::drawings::{
    DrawingColor, Paragraph, ParagraphProperties, RunProperties, TextBody, TextBodyProperties,
    TextFont, TextRun, TextRunContent, TextStrikeType, TextUnderlineType,
};
// Re-export additional text types from ooxml-types.
pub use ooxml_types::drawings::{
    BulletColor, BulletProperties, BulletSize, BulletType, ExtensionList, TextAutofit,
    TextCapsType, TextFontAlignType, TextHorzOverflow, TextListStyle, TextSpacing,
    TextTabAlignType, TextTabStop, TextVertOverflow, TextVerticalType, UnderlineFill,
    UnderlineLine,
};
// Re-export fill/outline/style/color types from ooxml-types.
// These replace local struct definitions that were field-identical to the ooxml-types versions.
pub use ooxml_types::drawings::{
    BlipFill, DrawingFill as Fill, GradientFill, GradientStop, NonVisualProps, Outline,
    PatternFill, ShapeStyle, SolidFill, StyleRef,
};
// Re-export geometry/anchor types from ooxml-types.
// Local definitions were field-identical; read-side used bare `i64` where ooxml-types uses
// `Emu` (which is `pub type Emu = i64;`), so all existing code is binary-compatible.
pub use ooxml_types::drawings::{CellAnchor, Connection, Extent, Position, Transform2D};
// Re-export ShapeProperties and geometry types from ooxml-types.
// The local ShapeProperties was removed in favour of the canonical ooxml-types version.
// Field mapping: transform->xfrm, fill->fill, outline->ln, preset_geometry->geometry, rest same.
pub use ooxml_types::drawings::{PresetGeometry, ShapeGeometry, ShapeProperties};
// Re-export spreadsheet drawing composite types from ooxml-types.
// Local `Shape`, `Picture`, `Connector`, `OpaqueGraphicFrame` structs are replaced by these
// canonical types. `GroupShape` / `DrawingContent` / `SmartArtGraphicFrame` have migrated
// to `domain-types` (typed OOXML preservation) — alias them back to their historical
// names here so the rest of the parser compiles unchanged.
pub use domain_types::domain::drawings::{
    DrawingContent, GroupShapeData as GroupShape, OpaqueDrawingContent, SmartArtGraphicFrame,
};
pub use ooxml_types::drawings::{
    ConnectorNonVisual, GraphicFrameNonVisual, GroupShapeNonVisual, PictureNonVisual,
    ShapeNonVisual, SpreadsheetConnector, SpreadsheetGraphicFrame, SpreadsheetPicture,
    SpreadsheetShape,
};
// ============================================================================
// Core Drawing Types
// ============================================================================

/// A complete drawing containing all anchored objects
#[derive(Debug, Clone, Default)]
pub struct Drawing {
    /// All anchored drawing objects
    pub anchors: Vec<Anchor>,
    /// SmartArt diagrams detected in this drawing (populated after relationship resolution)
    pub smartart_diagrams: Vec<SmartArtParts>,
    /// Original drawing OPC relationships (for round-trip of image/media references)
    pub opc_rels: Vec<ooxml_types::shared::OpcRelationship>,
    /// Original root element namespace declarations for round-trip fidelity.
    /// Each entry is (attr_name, attr_value), e.g. ("xmlns:xdr", "http://...").
    /// Preserves original prefixes and declaration order.
    pub root_namespace_attrs: Vec<(String, String)>,
    /// Raw drawing XML bytes for verbatim round-trip passthrough.
    /// Used as fallback when the structured write path can't represent all content
    /// (e.g., drawings with only shapes, which aren't yet supported in the writer).
    pub raw_drawing_xml: Option<Vec<u8>>,
    /// Raw drawing `.rels` bytes for verbatim clean-imported package replay.
    pub raw_drawing_rels_xml: Option<Vec<u8>>,
    /// Whether a drawing .rels file existed in the original archive (even if empty).
    /// Some XLSX files contain empty `<Relationships/>` rels files that must be preserved.
    pub has_rels_file: bool,
}

/// Anchor types for positioning drawing objects
#[derive(Debug, Clone)]
pub enum Anchor {
    /// Object anchored between two cells
    TwoCell(TwoCellAnchor),
    /// Object anchored to one cell with explicit size
    OneCell(OneCellAnchor),
    /// Object with absolute positioning
    Absolute(AbsoluteAnchor),
}

/// Metadata for an `mc:AlternateContent` wrapper around an anchor.
///
/// Some drawing anchors (e.g., form control shapes using `a14` extensions) are wrapped
/// in `mc:AlternateContent > mc:Choice`. This struct preserves the entire block as
/// raw XML for verbatim round-trip passthrough.
#[derive(Debug, Clone)]
pub struct McAlternateContent {
    /// The raw XML of the entire `mc:AlternateContent` element (from `<mc:AlternateContent`
    /// through `</mc:AlternateContent>`), for verbatim round-trip.
    pub raw_xml: String,
}

/// Two-cell anchor: object spans from one cell to another (ECMA-376 `CT_TwoCellAnchor`,
/// `dml-spreadsheetDrawing.xsd:146`).
///
/// **Intentional divergence from ooxml-types**: This read-side struct embeds parsed
/// `DrawingContent` inline (matching the spec's `EG_ObjectChoices` child group).
/// The write-side `TwoCellAnchor` separates content into a separate `DrawingObject`
/// enum paired with the anchor via `DrawingAnchor`. This structural difference means
/// these cannot be trivially unified into a single shared type.
#[derive(Debug, Clone)]
pub struct TwoCellAnchor {
    /// Starting cell position
    pub from: CellAnchor,
    /// Ending cell position
    pub to: CellAnchor,
    /// The drawing content
    pub content: DrawingContent,
    /// How the object behaves when cells resize
    pub edit_as: Option<EditAs>,
    /// Client data (locks/prints with sheet)
    pub client_data: ClientData,
    /// When set, this anchor was wrapped in `mc:AlternateContent > mc:Choice`
    /// in the original XML and should be re-wrapped during export.
    pub mc_alternate_content: Option<McAlternateContent>,
}

/// One-cell anchor: object anchored to a cell with explicit size (ECMA-376
/// `CT_OneCellAnchor`, `dml-spreadsheetDrawing.xsd:155`).
///
/// **Intentional divergence from ooxml-types**: see [`TwoCellAnchor`] doc comment.
#[derive(Debug, Clone)]
pub struct OneCellAnchor {
    /// Cell position
    pub from: CellAnchor,
    /// Object extent (size)
    pub extent: Extent,
    /// The drawing content
    pub content: DrawingContent,
    /// Client data (locks/prints with sheet)
    pub client_data: ClientData,
    /// When set, this anchor was wrapped in `mc:AlternateContent > mc:Choice`
    /// or contains content-level `mc:AlternateContent` (e.g., slicers/timeslicers)
    /// and should be re-emitted verbatim during export.
    pub mc_alternate_content: Option<McAlternateContent>,
}

/// Absolute anchor: object with absolute positioning (ECMA-376
/// `CT_AbsoluteAnchor`, `dml-spreadsheetDrawing.xsd:163`).
///
/// **Intentional divergence from ooxml-types**: see [`TwoCellAnchor`] doc comment.
#[derive(Debug, Clone)]
pub struct AbsoluteAnchor {
    /// Absolute position
    pub pos: Position,
    /// Object extent (size)
    pub extent: Extent,
    /// The drawing content
    pub content: DrawingContent,
    /// Client data (locks/prints with sheet)
    pub client_data: ClientData,
}

// ============================================================================
// Drawing Content Types
// ============================================================================

// OpaqueGraphicFrame has been replaced by `SpreadsheetGraphicFrame` from ooxml-types.
// Field mapping: `raw_xml` → `graphic_xml: Option<String>`.
// The canonical type also carries `nv_graphic_frame_pr`, `xfrm`, `macro_name`, `f_published`.

// `SmartArtGraphicFrame` has moved to `domain-types` (typed OOXML preservation)
// alongside `GroupShape`/`DrawingContent`; it is re-exported from this module's
// prelude above so internal call sites keep compiling unchanged.

/// Raw XML parts for a single SmartArt diagram.
///
/// Parts 1-4 are linked via `<dgm:relIds>` attributes (`CT_RelIds`, `dml-diagram.xsd` L387).
/// Part 5 (drawing cache) is a Microsoft extension linked via a separate `.rels` entry.
#[derive(Debug, Clone, Default)]
pub struct SmartArtParts {
    /// Index of the graphicFrame anchor in the drawing (for position correlation)
    pub anchor_index: usize,
    /// `xl/diagrams/data{N}.xml` — root: `<dgm:dataModel>` (`CT_DataModel`, L147)
    pub data_xml: Option<String>,
    /// `xl/diagrams/layout{N}.xml` — root: `<dgm:layoutDef>` (`CT_DiagramDefinition`, L351)
    pub layout_xml: Option<String>,
    /// `xl/diagrams/colors{N}.xml` — root: `<dgm:colorsDef>` (`CT_ColorTransform`, L63)
    pub colors_xml: Option<String>,
    /// `xl/diagrams/quickStyles{N}.xml` — root: `<dgm:styleDef>` (`CT_StyleDefinition`, L552)
    pub style_xml: Option<String>,
    /// `xl/diagrams/drawing{N}.xml` — root: `<dsp:drawing>` (MS extension, optional)
    pub drawing_xml: Option<String>,
}

// `DrawingContent` has moved to `domain-types::domain::drawings` (typed OOXML preservation
// inventory row 1.6) and is re-exported from this module's prelude above.

// Picture has been replaced by `SpreadsheetPicture` from ooxml-types.
// Field mapping:
//   name, description       → REMOVED (duplicated from nv_props; access via nv_pic_pr.c_nv_pr)
//   blip_fill               → blip_fill (same)
//   shape_properties        → sp_pr
//   nv_props                → nv_pic_pr.c_nv_pr
//   locks                   → nv_pic_pr.locks
//   prefer_relative_resize  → nv_pic_pr.prefer_relative_resize
//   style                   → style (same)
//   macro_name              → macro_name (same)
//   (new) f_published       → parsed from @fPublished attribute

// Shape has been replaced by `SpreadsheetShape` from ooxml-types.
// Field mapping:
//   name                → REMOVED (duplicated from nv_props; access via nv_sp_pr.c_nv_pr)
//   preset              → REMOVED (duplicated from shape_properties.geometry)
//   text_body           → tx_body
//   shape_properties    → sp_pr
//   style               → style (same)
//   nv_props            → nv_sp_pr.c_nv_pr
//   (new) nv_sp_pr.c_nv_sp_pr → DrawingLocking (shape locks)
//   (new) macro_name    → parsed from @macro attribute
//   (new) textlink      → parsed from @textlink attribute
//   (new) f_locks_text  → parsed from @fLocksText attribute
//   (new) f_published   → parsed from @fPublished attribute

// `GroupShape` (as `GroupShapeData`) has moved to `domain-types::domain::drawings`
// (typed OOXML preservation). It is re-exported from this module under the
// historical `GroupShape` name via the prelude above.
//
// GroupShapeProperties is re-exported from ooxml_types::drawings (see above).
// Field mapping vs. the old local struct:
//   transform -> xfrm
//   fill: Option<String> -> fill: Option<DrawingFill>  (typed parse)
//   effects: Option<String> -> effect_list: Option<EffectList>  (typed parse)
//   bw_mode -> bw_mode  (same)
//   scene3d -> scene3d  (same)
//   ext_lst -> ext_lst  (same)

// Connector has been replaced by `SpreadsheetConnector` from ooxml-types.
// Field mapping:
//   name                → REMOVED (duplicated from nv_props; access via nv_cxn_sp_pr.c_nv_pr)
//   shape_properties    → sp_pr
//   nv_props            → nv_cxn_sp_pr.c_nv_pr
//   start_connection    → nv_cxn_sp_pr.st_cxn
//   end_connection      → nv_cxn_sp_pr.end_cxn
//   locks               → nv_cxn_sp_pr.c_nv_cxn_sp_pr
//   style               → style (same)
//   macro_name          → macro_name (same)
//   (new) f_published   → parsed from @fPublished attribute

// ============================================================================
// Shape Properties — re-exported from ooxml_types::drawings::ShapeProperties
// ============================================================================
// The canonical `ShapeProperties` struct lives in ooxml-types and is
// re-exported at the top of this file.  Field mapping vs. the old local struct:
//   transform       -> xfrm
//   fill            -> fill  (DrawingFill, aliased as Fill above)
//   outline         -> ln
//   preset_geometry  -> geometry (ShapeGeometry::Preset(PresetGeometry { prst, av_list }))
//   effect_list     -> effect_list  (same)
//   bw_mode         -> bw_mode      (same)
//   scene3d         -> scene3d      (same)
//   sp3d            -> sp3d         (same)
