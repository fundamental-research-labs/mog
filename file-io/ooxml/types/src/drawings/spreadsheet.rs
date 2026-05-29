//! Spreadsheet drawing composite types (ECMA-376 dml-spreadsheetDrawing.xsd).
//!
//! These types model the `xdr:wsDr` element tree for drawing objects embedded in
//! spreadsheet worksheets. Extension lists (`extLst`) are intentionally omitted;
//! parser/writer code owns any raw preservation and relationship validation.
//! Unsupported object choices may be preserved opaquely only when the owning
//! anchor/group and drawing relationships remain valid.

use super::{
    BlipFill, CellAnchor, ClientData, Connection, DrawingLocking, EditAs, Extent, GroupLocking,
    GroupShapeProperties, NonVisualProps, Position, ShapeProperties, ShapeStyle, TextBody,
    Transform2D,
};

// =============================================================================
// Root Drawing Element
// =============================================================================

/// Root spreadsheet drawing element (CT_Drawing, dml-spreadsheetDrawing.xsd:178).
///
/// Contains zero or more anchored drawing objects (EG_Anchor group).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SpreadsheetDrawing {
    /// All anchored drawing objects.
    pub anchors: Vec<DrawingAnchor>,
}

/// Anchor types for positioning drawing objects (EG_Anchor group,
/// dml-spreadsheetDrawing.xsd:171-177).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum DrawingAnchor {
    /// Object anchored between two cells (CT_TwoCellAnchor).
    TwoCell(TwoCellAnchor),
    /// Object anchored to one cell with explicit size (CT_OneCellAnchor).
    OneCell(OneCellAnchor),
    /// Object with absolute positioning (CT_AbsoluteAnchor).
    Absolute(AbsoluteAnchor),
}

/// Parse/export metadata owned by the sheet drawing anchor sequence.
///
/// `anchor_index` is the ordinal of an `xdr:*Anchor` inside `xdr:wsDr`. It is
/// not an OOXML attribute; it is bridge metadata used to map the ordered XML
/// sequence to domain floating-object layer state.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingAnchorMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor_index: Option<usize>,
}

impl DrawingAnchorMetadata {
    pub fn is_empty(&self) -> bool {
        self.anchor_index.is_none()
    }
}

// =============================================================================
// Anchor Types
// =============================================================================

/// Two-cell anchor (CT_TwoCellAnchor, dml-spreadsheetDrawing.xsd:146).
///
/// Object spans from one cell marker to another.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TwoCellAnchor {
    /// Starting cell position (CT_Marker).
    pub from: CellAnchor,
    /// Ending cell position (CT_Marker).
    pub to: CellAnchor,
    /// Drawing content (EG_ObjectChoices).
    pub content: ObjectChoices,
    /// How the object behaves when cells resize (default "twoCell").
    pub edit_as: Option<EditAs>,
    /// Client data (locks/prints with sheet).
    pub client_data: ClientData,
}

/// One-cell anchor (CT_OneCellAnchor, dml-spreadsheetDrawing.xsd:155).
///
/// Object anchored to a single cell with explicit extent.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OneCellAnchor {
    /// Cell position (CT_Marker).
    pub from: CellAnchor,
    /// Object extent / size (CT_PositiveSize2D).
    pub ext: Extent,
    /// Drawing content (EG_ObjectChoices).
    pub content: ObjectChoices,
    /// Client data (locks/prints with sheet).
    pub client_data: ClientData,
}

/// Absolute anchor (CT_AbsoluteAnchor, dml-spreadsheetDrawing.xsd:163).
///
/// Object with absolute positioning (not cell-relative).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AbsoluteAnchor {
    /// Absolute position (CT_Point2D).
    pub pos: Position,
    /// Object extent / size (CT_PositiveSize2D).
    pub ext: Extent,
    /// Drawing content (EG_ObjectChoices).
    pub content: ObjectChoices,
    /// Client data (locks/prints with sheet).
    pub client_data: ClientData,
}

// =============================================================================
// Object Choices (EG_ObjectChoices)
// =============================================================================

/// Drawing object content (EG_ObjectChoices, dml-spreadsheetDrawing.xsd:106-117).
///
/// Each anchor contains exactly one of these object types. This enum does **not**
/// implement `Default` because there is no natural default for a choice group —
/// callers must explicitly choose a variant.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ObjectChoices {
    /// Shape — rectangle, oval, text box, etc. (CT_Shape).
    Shape(SpreadsheetShape),
    /// Group of shapes (CT_GroupShape).
    GroupShape(SpreadsheetGroupShape),
    /// Graphic frame — chart, table, diagram (CT_GraphicalObjectFrame).
    GraphicFrame(SpreadsheetGraphicFrame),
    /// Connector line between shapes (CT_Connector).
    Connector(SpreadsheetConnector),
    /// Picture / embedded image (CT_Picture).
    Picture(SpreadsheetPicture),
    /// Content part — external content via relationship (CT_Rel).
    ContentPart(ContentPartRef),
}

/// Content part reference (CT_Rel, dml-spreadsheetDrawing.xsd:118-120).
///
/// References external content via a relationship ID.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ContentPartRef {
    /// Relationship ID (r:id, required).
    pub r_id: String,
}

// =============================================================================
// Shape (CT_Shape)
// =============================================================================

/// Non-visual properties for a shape (CT_ShapeNonVisual, dml-spreadsheetDrawing.xsd:17-23).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ShapeNonVisual {
    /// Common non-visual drawing properties (cNvPr: id, name, descr, title, hidden, hlinkClick, hlinkHover).
    pub c_nv_pr: NonVisualProps,
    /// Shape-specific non-visual properties (cNvSpPr: shape locks, text lock).
    pub c_nv_sp_pr: DrawingLocking,
    /// Whether `<a:spLocks>` was present in the original XML (even with all-default attributes).
    /// Needed for round-trip fidelity: `<a:spLocks noChangeAspect="0"/>` should be preserved.
    pub has_sp_locks: bool,
    /// Explicit `noChangeAspect` from original XML. `Some(false)` preserves `noChangeAspect="0"`.
    pub no_change_aspect_explicit: Option<bool>,
    /// Whether this shape is a text box (cNvSpPr/@txBox, default false).
    pub tx_box: bool,
    /// Extension list from cNvSpPr — opaque XML passthrough (CT_NonVisualDrawingShapeProps extLst).
    pub c_nv_sp_pr_ext_lst: Option<String>,
}

/// Spreadsheet shape (CT_Shape, dml-spreadsheetDrawing.xsd:24-35).
///
/// Represents shapes including rectangles, ovals, lines, arrows, text boxes,
/// and all preset geometry shapes within a spreadsheet drawing.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SpreadsheetShape {
    /// Non-visual properties (nvSpPr).
    pub nv_sp_pr: ShapeNonVisual,
    /// Shape properties (spPr: transform, geometry, fill, outline, effects, 3D).
    pub sp_pr: ShapeProperties,
    /// Shape style from theme (style).
    pub style: Option<ShapeStyle>,
    /// Text body content (txBody).
    pub tx_body: Option<TextBody>,
    /// Macro name (@macro).
    pub macro_name: Option<String>,
    /// Cell link for text content (@textlink).
    pub textlink: Option<String>,
    /// Whether text is locked from editing (@fLocksText, default true).
    pub f_locks_text: Option<bool>,
    /// Whether shape is published (@fPublished, default false).
    pub f_published: Option<bool>,
}

// =============================================================================
// Connector (CT_Connector)
// =============================================================================

/// Non-visual properties for a connector (CT_ConnectorNonVisual, dml-spreadsheetDrawing.xsd:36-42).
///
/// **Intentional simplification**: `st_cxn` and `end_cxn` are children of `CT_NonVisualConnectorProperties`
/// (`cNvCxnSpPr`) in the XSD, not direct children of `CT_ConnectorNonVisual`. We flatten them here
/// for ergonomics since the intermediate type adds no semantic value.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ConnectorNonVisual {
    /// Common non-visual drawing properties (cNvPr).
    pub c_nv_pr: NonVisualProps,
    /// Connector-specific non-visual properties (cNvCxnSpPr: connection locks).
    pub c_nv_cxn_sp_pr: DrawingLocking,
    /// Start connection (shape ID + connection site index, from cNvCxnSpPr/stCxn).
    pub st_cxn: Option<Connection>,
    /// End connection (shape ID + connection site index, from cNvCxnSpPr/endCxn).
    pub end_cxn: Option<Connection>,
    /// Extension list from cNvCxnSpPr — opaque XML passthrough (CT_NonVisualConnectorProperties extLst).
    pub c_nv_cxn_sp_pr_ext_lst: Option<String>,
}

/// Spreadsheet connector (CT_Connector, dml-spreadsheetDrawing.xsd:43-51).
///
/// A connector line between two shapes or anchor points.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SpreadsheetConnector {
    /// Non-visual properties (nvCxnSpPr).
    pub nv_cxn_sp_pr: ConnectorNonVisual,
    /// Shape properties (spPr).
    pub sp_pr: ShapeProperties,
    /// Shape style from theme (style).
    pub style: Option<ShapeStyle>,
    /// Macro name (@macro).
    pub macro_name: Option<String>,
    /// Whether connector is published (@fPublished, default false).
    pub f_published: Option<bool>,
}

// =============================================================================
// Picture (CT_Picture)
// =============================================================================

/// Non-visual properties for a picture (CT_PictureNonVisual, dml-spreadsheetDrawing.xsd:52-58).
///
/// **Intentional flattening**: The XSD child `cNvPicPr` (CT_NonVisualPictureProperties) is
/// flattened — its `picLocks` child becomes `locks` and its `@preferRelativeResize` attribute
/// becomes `prefer_relative_resize` directly on this struct.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PictureNonVisual {
    /// Common non-visual drawing properties (cNvPr).
    pub c_nv_pr: NonVisualProps,
    /// Picture-specific non-visual properties — picture locks (from cNvPicPr/picLocks).
    pub locks: DrawingLocking,
    /// Whether a `<a:picLocks>` element was present in the original XML,
    /// even if all lock attributes were false/absent. Needed for round-trip fidelity.
    pub has_pic_locks: bool,
    /// Whether to prefer relative resize (from cNvPicPr/@preferRelativeResize).
    pub prefer_relative_resize: Option<bool>,
    /// Extension list from cNvPicPr — opaque XML passthrough (CT_NonVisualPictureProperties extLst).
    pub c_nv_pic_pr_ext_lst: Option<String>,
}

/// Spreadsheet picture (CT_Picture, dml-spreadsheetDrawing.xsd:59-68).
///
/// An embedded or linked image within a spreadsheet drawing.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SpreadsheetPicture {
    /// Non-visual properties (nvPicPr).
    pub nv_pic_pr: PictureNonVisual,
    /// Image fill (blipFill: blip reference, source rect, stretch/tile).
    pub blip_fill: BlipFill,
    /// Shape properties (spPr).
    pub sp_pr: ShapeProperties,
    /// Shape style from theme (style).
    pub style: Option<ShapeStyle>,
    /// Macro name (@macro, default "").
    pub macro_name: Option<String>,
    /// Whether picture is published (@fPublished, default false).
    pub f_published: Option<bool>,
}

// =============================================================================
// Graphic Frame (CT_GraphicalObjectFrame)
// =============================================================================

/// Non-visual properties for a graphic frame (CT_GraphicalObjectFrameNonVisual,
/// dml-spreadsheetDrawing.xsd:69-75).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GraphicFrameNonVisual {
    /// Common non-visual drawing properties (cNvPr).
    pub c_nv_pr: NonVisualProps,
    /// Graphic-frame-specific non-visual properties (cNvGraphicFramePr: graphic frame locks).
    pub c_nv_graphic_frame_pr: DrawingLocking,
    /// Whether a `<a:graphicFrameLocks>` element was present in the original XML,
    /// even if all lock attributes were false/absent. Needed for round-trip fidelity.
    pub has_graphic_frame_locks: bool,
    /// Explicit `noChangeAspect` attribute on `graphicFrameLocks`. `Some(false)` means
    /// `noChangeAspect="0"` was present (redundant but must be preserved for roundtrip).
    /// `None` means the attribute was absent. Complements `c_nv_graphic_frame_pr.no_change_aspect`.
    pub no_change_aspect_explicit: Option<bool>,
    /// Disallow drilldown (CT_GraphicalObjectFrameLocking `@noDrilldown`, not in AG_Locking).
    pub no_drilldown: bool,
    /// Extension list from cNvGraphicFramePr — opaque XML passthrough (CT_NonVisualGraphicFrameProperties extLst).
    pub c_nv_graphic_frame_pr_ext_lst: Option<String>,
}

/// Spreadsheet graphic frame (CT_GraphicalObjectFrame, dml-spreadsheetDrawing.xsd:76-85).
///
/// Contains charts, tables, SmartArt diagrams, or other graphic objects.
/// The inner `<a:graphic>` element is stored as opaque XML since its contents
/// vary by embedded object type and are resolved via relationships.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SpreadsheetGraphicFrame {
    /// Non-visual properties (nvGraphicFramePr).
    pub nv_graphic_frame_pr: GraphicFrameNonVisual,
    /// 2D transform (xfrm: position, size, rotation).
    pub xfrm: Transform2D,
    /// Inner graphic content — opaque XML for the `<a:graphic>` element.
    /// Actual content (chart, table, diagram) is resolved via relationships.
    pub graphic_xml: Option<String>,
    /// Macro name (@macro).
    pub macro_name: Option<String>,
    /// Whether graphic frame is published (@fPublished, default false).
    pub f_published: Option<bool>,
}

// =============================================================================
// Group Shape (CT_GroupShape)
// =============================================================================

/// Non-visual properties for a group shape (CT_GroupShapeNonVisual,
/// dml-spreadsheetDrawing.xsd:86-92).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GroupShapeNonVisual {
    /// Common non-visual drawing properties (cNvPr).
    pub c_nv_pr: NonVisualProps,
    /// Group-specific non-visual properties (cNvGrpSpPr: group locks).
    pub c_nv_grp_sp_pr: Option<GroupLocking>,
    /// Extension list from cNvGrpSpPr — opaque XML passthrough
    /// (CT_NonVisualGroupDrawingShapeProps extLst).
    pub c_nv_grp_sp_pr_ext_lst: Option<String>,
}

/// Spreadsheet group shape (CT_GroupShape, dml-spreadsheetDrawing.xsd:93-105).
///
/// A group containing child shapes, connectors, pictures, graphic frames,
/// or nested groups.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SpreadsheetGroupShape {
    /// Non-visual properties (nvGrpSpPr).
    pub nv_grp_sp_pr: GroupShapeNonVisual,
    /// Group shape properties (grpSpPr: group transform, fill, effects).
    pub grp_sp_pr: GroupShapeProperties,
    /// Child objects (sp | grpSp | graphicFrame | cxnSp | pic).
    pub children: Vec<ObjectChoices>,
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spreadsheet_drawing_default() {
        let d = SpreadsheetDrawing::default();
        assert!(d.anchors.is_empty());
    }

    #[test]
    fn two_cell_anchor_fields() {
        let anchor = TwoCellAnchor {
            from: CellAnchor {
                col: 0,
                col_off: 0,
                row: 0,
                row_off: 0,
            },
            to: CellAnchor {
                col: 5,
                col_off: 100,
                row: 10,
                row_off: 200,
            },
            content: ObjectChoices::Shape(SpreadsheetShape::default()),
            edit_as: Some(EditAs::OneCell),
            client_data: ClientData::default(),
        };
        assert_eq!(anchor.to.col, 5);
        assert_eq!(anchor.to.row, 10);
        assert_eq!(anchor.edit_as, Some(EditAs::OneCell));
    }

    #[test]
    fn object_choices_all_variants() {
        // Verify all 6 variants can be constructed
        let _shape = ObjectChoices::Shape(SpreadsheetShape::default());
        let _group = ObjectChoices::GroupShape(SpreadsheetGroupShape::default());
        let _frame = ObjectChoices::GraphicFrame(SpreadsheetGraphicFrame::default());
        let _conn = ObjectChoices::Connector(SpreadsheetConnector::default());
        let _pic = ObjectChoices::Picture(SpreadsheetPicture::default());
        let _part = ObjectChoices::ContentPart(ContentPartRef {
            r_id: "rId1".into(),
        });
    }

    #[test]
    fn spreadsheet_shape_spec_attributes() {
        let shape = SpreadsheetShape {
            macro_name: Some("MyMacro".into()),
            textlink: Some("$A$1".into()),
            f_locks_text: Some(true),
            f_published: Some(false),
            ..Default::default()
        };
        assert_eq!(shape.macro_name.as_deref(), Some("MyMacro"));
        assert_eq!(shape.textlink.as_deref(), Some("$A$1"));
        assert_eq!(shape.f_locks_text, Some(true));
        assert_eq!(shape.f_published, Some(false));
    }

    #[test]
    fn spreadsheet_connector_default() {
        let c = SpreadsheetConnector::default();
        assert!(c.nv_cxn_sp_pr.st_cxn.is_none());
        assert!(c.nv_cxn_sp_pr.end_cxn.is_none());
        assert!(c.macro_name.is_none());
        assert!(c.f_published.is_none());
    }

    #[test]
    fn group_shape_children() {
        let group = SpreadsheetGroupShape {
            children: vec![
                ObjectChoices::Shape(SpreadsheetShape::default()),
                ObjectChoices::Picture(SpreadsheetPicture::default()),
                ObjectChoices::Connector(SpreadsheetConnector::default()),
            ],
            ..Default::default()
        };
        assert_eq!(group.children.len(), 3);
    }
}
