//! Group-shape domain types for drawing-object round-trip.
//!
//! These types mirror the OOXML `CT_GroupShape` structure
//! (`dml-spreadsheetDrawing.xsd:93-105`). They live in `domain-types` — rather
//! than in `xlsx-parser`, where the parser's legacy `GroupShape`/`DrawingContent`
//! used to live — so that `ShapeOoxmlProps.group_shape` can be a typed field
//! instead of a `serde_json::Value` blob (typed OOXML preservation).
//!
//! `SmartArtGraphicFrame` moves along with `DrawingContent` because the
//! `DrawingContent::SmartArt` variant references it directly.

use serde::{Deserialize, Serialize};

use ooxml_types::drawings::{
    ContentPartRef, GroupShapeNonVisual, GroupShapeProperties, SpreadsheetConnector,
    SpreadsheetGraphicFrame, SpreadsheetPicture, SpreadsheetShape,
};

/// Internal opaque payload for unsupported spreadsheet drawing object choices.
///
/// The raw XML is the direct object-choice element, not the surrounding anchor.
/// Anchor geometry and client data remain owned by the parsed anchor. This is
/// writer-only preservation state: public bridge/API shapes should continue to
/// treat it as unsupported unless an explicit opaque-handle contract exists.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OpaqueDrawingContent {
    /// Complete raw XML for the unsupported direct object element.
    pub raw_xml: String,
    /// Relationship ids discovered in the raw object XML.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationship_ids: Vec<String>,
    /// Stable hint derived from the local element name or prefix-qualified name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind_hint: Option<String>,
}

/// Group of shapes (CT_GroupShape, `dml-spreadsheetDrawing.xsd:93-105`).
///
/// **Intentional divergence from `ooxml-types`**: children are
/// `Vec<DrawingContent>` (which includes SmartArt/Unknown variants) rather
/// than `Vec<ObjectChoices>`. Field names match the canonical
/// `SpreadsheetGroupShape` for consistency.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GroupShapeData {
    /// Child drawing objects in the group.
    pub children: Vec<DrawingContent>,
    /// Group shape properties (grpSpPr: group transform, fill, effects).
    pub grp_sp_pr: GroupShapeProperties,
    /// Non-visual properties (nvGrpSpPr).
    pub nv_grp_sp_pr: GroupShapeNonVisual,
}

/// Parsed SmartArt graphicFrame — holds the four relationship IDs from
/// `<dgm:relIds>`.
///
/// These IDs reference the SmartArt diagram parts via the drawing's `.rels`
/// file. The actual XML parts are resolved separately (by the parser) into
/// `SmartArtParts`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SmartArtGraphicFrame {
    /// `r:dm` attribute from `<dgm:relIds>` — relationship to data part.
    pub dm_rel_id: String,
    /// `r:lo` attribute — relationship to layout part.
    pub lo_rel_id: String,
    /// `r:qs` attribute — relationship to quick style part.
    pub qs_rel_id: String,
    /// `r:cs` attribute — relationship to colors part.
    pub cs_rel_id: String,
}

/// Content within a drawing anchor.
///
/// Mirrors the `EG_ObjectChoices` child group of the spreadsheet-drawing XSD;
/// used as the element type of `GroupShapeData.children` and (on the
/// parser side) the inline payload of `Anchor::{TwoCell,OneCell,Absolute}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
// Spreadsheet drawing choices intentionally carry the direct typed object so
// callers can work with the OOXML vocabulary without allocation wrappers.
#[allow(clippy::large_enum_variant)]
pub enum DrawingContent {
    /// Picture/image.
    Picture(SpreadsheetPicture),
    /// Shape (rectangle, oval, line, etc.).
    Shape(SpreadsheetShape),
    /// Group of shapes.
    GroupShape(GroupShapeData),
    /// Connector line between shapes.
    Connector(SpreadsheetConnector),
    /// Graphic frame (chart, table, diagram — opaque XML passthrough).
    GraphicFrame(SpreadsheetGraphicFrame),
    /// SmartArt diagram (parsed graphicFrame with relationship IDs).
    SmartArt(SmartArtGraphicFrame),
    /// Content part reference (`xdr:contentPart`).
    ContentPart(ContentPartRef),
    /// Unsupported content with raw writer-only preservation state.
    OpaqueUnknown(OpaqueDrawingContent),
    /// Unknown or unsupported content without a safe preservation payload.
    #[default]
    Unknown,
}
