//! Drawing types and data structures for XLSX drawing generation.
//!
//! This module contains all the type definitions used for drawing writing,
//! including anchor types, position/extent definitions, and drawing object types.

// Re-export shared types from ooxml-types.
pub use ooxml_types::drawings::{
    Bevel, BevelPresetType, BlackWhiteMode, BlipEffect, ClientData, CompoundLine, CompressionState,
    DashStyle, DrawingColor, DrawingFill, DrawingLocking, EMUS_PER_CM, EMUS_PER_INCH,
    EMUS_PER_POINT, EditAs, EffectList, EffectProperties, Emu, FillMode, GeomGuide, GradientFill,
    GradientStop, GroupLocking, GroupTransform2D, Hyperlink, LineCap, LineEndProperties,
    LineEndSize, LineEndType, LineJoin, Outline, PatternFill, PenAlignment, PresetGeometry,
    PresetMaterialType, Scene3D, SchemeColor, Shape3D, ShapePreset, ShapeStyle, SolidFill,
    SourceRect, StyleRef,
};
// Re-export geometry/anchor types from ooxml-types.
pub use ooxml_types::drawings::ContentPartRef;
pub use ooxml_types::drawings::{CellAnchor, Connection, Extent, Position, Transform2D};

// Re-export shared text types from ooxml-types.
pub use ooxml_types::drawings::{
    BulletColor, BulletProperties, BulletSize, BulletType, ExtensionList, Paragraph,
    ParagraphProperties, RunProperties, TextAlign, TextAnchor, TextAutofit, TextAutonumberType,
    TextBody, TextBodyProperties, TextCapsType, TextFont, TextFontAlignType, TextHorzOverflow,
    TextListStyle, TextRun, TextRunContent, TextSpacing, TextStrikeType, TextTabAlignType,
    TextTabStop, TextUnderlineType, TextVertOverflow, TextVerticalType, TextWrap, UnderlineFill,
    UnderlineLine,
};

// ============================================================================
// Constants
// ============================================================================

/// Namespace for spreadsheet drawing
pub const NS_XDR: &str = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
/// Namespace for DrawingML main
pub const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
/// Namespace for relationships
pub const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/// Namespace for charts
pub const NS_C: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
/// Namespace for DrawingML diagrams (SmartArt)
pub const NS_DGM: &str = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
/// URI for SmartArt diagram graphicData (used in `<a:graphicData uri="...">`)
pub const DIAGRAM_GRAPHIC_DATA_URI: &str =
    "http://schemas.openxmlformats.org/drawingml/2006/diagram";
/// Namespace for markup compatibility
pub const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
/// Namespace for DrawingML 2010 extensions (a14)
pub const NS_A14: &str = "http://schemas.microsoft.com/office/drawing/2010/main";
/// Namespace for slicer drawing extension (sle)
pub const NS_SLE: &str = "http://schemas.microsoft.com/office/drawing/2010/slicer";
/// URI for slicer graphicData
pub const SLICER_GRAPHIC_DATA_URI: &str = "http://schemas.microsoft.com/office/drawing/2010/slicer";
/// Namespace for timeline drawing extension (tsle)
pub const NS_TSLE: &str = "http://schemas.microsoft.com/office/drawing/2012/timeslicer";
/// URI for timeline graphicData
pub const TIMELINE_GRAPHIC_DATA_URI: &str =
    "http://schemas.microsoft.com/office/drawing/2012/timeslicer";
/// Namespace for ChartEx (cx)
pub const NS_CX: &str = "http://schemas.microsoft.com/office/drawing/2014/chartex";
/// Namespace for ChartEx 2015 extension (cx1) — used in mc:Choice Requires
pub const NS_CX1: &str = "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex";

// ============================================================================
// Core Types
// ============================================================================

/// Two-cell anchor for write path (ECMA-376 `CT_TwoCellAnchor`,
/// `dml-spreadsheetDrawing.xsd:146`).
///
/// **Intentional divergence from read-side**: The write-side separates drawing
/// content into `DrawingObject`, paired with the anchor via the `DrawingAnchor`
/// enum. The read-side `TwoCellAnchor` embeds `DrawingContent` inline (matching
/// the spec's `EG_ObjectChoices` child group). This structural difference is
/// intentional and cannot be trivially unified.
#[derive(Debug, Clone, Default)]
pub struct TwoCellAnchor {
    /// Starting cell position
    pub from: CellAnchor,
    /// Ending cell position
    pub to: CellAnchor,
    /// Edit behavior when cells resize.
    /// `None` means the attribute was absent in the original file and should not be emitted
    /// (the OOXML default is `twoCell`).
    pub edit_as: Option<EditAs>,
    /// Client data (lock/print flags for the anchor)
    pub client_data: ClientData,
    /// When set, this anchor should be wrapped in `mc:AlternateContent > mc:Choice`
    /// during export.
    pub mc_alternate_content: Option<crate::domain::drawings::McAlternateContent>,
}

/// One-cell anchor for write path (ECMA-376 `CT_OneCellAnchor`,
/// `dml-spreadsheetDrawing.xsd:155`).
///
/// **Intentional divergence from read-side**: see [`TwoCellAnchor`] doc comment.
#[derive(Debug, Clone)]
pub struct OneCellAnchor {
    /// Cell position
    pub from: CellAnchor,
    /// Object extent (size)
    pub extent: Extent,
    /// Client data (lock/print flags for the anchor)
    pub client_data: ClientData,
    /// When set, this anchor should be emitted as raw XML verbatim
    /// (e.g., slicer/timeslicer graphicFrame inside mc:AlternateContent).
    pub mc_alternate_content: Option<crate::domain::drawings::McAlternateContent>,
}

/// Absolute anchor for write path (ECMA-376 `CT_AbsoluteAnchor`,
/// `dml-spreadsheetDrawing.xsd:163`).
///
/// **Intentional divergence from read-side**: see [`TwoCellAnchor`] doc comment.
#[derive(Debug, Clone)]
pub struct AbsoluteAnchor {
    /// Absolute position
    pub pos: Position,
    /// Object extent (size)
    pub extent: Extent,
    /// Client data (lock/print flags for the anchor)
    pub client_data: ClientData,
}

// ============================================================================
// Drawing Object Types
// ============================================================================

/// Full-fidelity picture properties for OOXML write (ECMA-376 CT_Picture).
#[derive(Debug, Clone, Default)]
pub struct ImageProps {
    // -- Identity ---------------------------------------------------------------
    /// Original cNvPr `id` attribute from the parsed file.
    /// When `Some`, the writer uses this value instead of generating a sequential ID.
    pub original_id: Option<u32>,
    /// Name/title for the image
    pub name: String,
    /// Optional description/alt text
    pub description: Option<String>,
    /// Relationship ID to image file (e.g., "rId1")
    pub r_id: String,

    // -- Transform --------------------------------------------------------------
    /// Rotation in 60000ths of a degree (e.g., 5400000 = 90 degrees)
    pub rotation: Option<i32>,
    /// X offset in EMUs
    pub offset_x: i64,
    /// Y offset in EMUs
    pub offset_y: i64,
    /// Width in EMUs
    pub extent_cx: i64,
    /// Height in EMUs
    pub extent_cy: i64,
    /// Horizontal flip
    pub flip_h: bool,
    /// Vertical flip
    pub flip_v: bool,

    // -- BlipFill ---------------------------------------------------------------
    /// Source rectangle for image cropping
    pub source_rect: Option<SourceRect>,
    /// Bitmask of explicitly present srcRect attributes (bit 0=l, 1=t, 2=r, 3=b).
    pub src_rect_explicit: u8,
    /// Blip-level image effects (e.g., alpha, luminance, grayscale)
    pub blip_effects: Vec<BlipEffect>,
    /// Fill mode (stretch or tile)
    pub fill_mode: Option<FillMode>,
    /// Image compression state
    pub compression: Option<CompressionState>,
    /// Relationship ID for linked (not embedded) image
    pub link_id: Option<String>,
    /// Image DPI hint
    pub dpi: Option<u32>,
    /// Whether blip fill rotates with the shape
    pub rot_with_shape: Option<bool>,
    /// Extension list inside `<a:blip>` — opaque XML for round-trip preservation
    pub blip_ext_lst: Option<String>,

    // -- Locking ----------------------------------------------------------------
    /// Picture locking flags (includes `no_change_aspect` which replaces the old `preserve_aspect`)
    pub locks: DrawingLocking,
    /// Whether `<a:picLocks>` was present in the original XML (even with no attributes).
    pub has_pic_locks: bool,
    /// Prefer relative resize
    pub prefer_relative_resize: Option<bool>,

    // -- NonVisual extras -------------------------------------------------------
    /// Title (distinct from name)
    pub title: Option<String>,
    /// Whether the picture is hidden
    pub hidden: bool,
    /// Click hyperlink
    pub hlink_click: Option<Hyperlink>,
    /// Hover hyperlink
    pub hlink_hover: Option<Hyperlink>,
    /// Extension list on cNvPr — opaque XML passthrough (CT_NonVisualDrawingProps extLst)
    pub nv_ext_lst: Option<String>,

    // -- Shape properties -------------------------------------------------------
    /// Preset geometry with adjustment values (defaults to rect for pictures)
    pub preset_geometry: Option<PresetGeometry>,
    /// Shape fill
    pub fill: Option<DrawingFill>,
    /// Shape outline / border
    pub outline: Option<Outline>,
    /// Shape-level effect properties (effectLst or effectDag).
    pub effects: Option<EffectProperties>,
    /// Black and white rendering mode
    pub bw_mode: Option<BlackWhiteMode>,
    /// 3D scene properties (from `<a:scene3d>` child of spPr)
    pub scene3d: Option<Scene3D>,
    /// 3D shape properties (from `<a:sp3d>` child of spPr)
    pub sp3d: Option<Shape3D>,
    /// Extension list on spPr — opaque XML passthrough (CT_ShapeProperties extLst)
    pub sp_pr_ext_lst: Option<String>,

    // -- Style & metadata -------------------------------------------------------
    /// Shape style references (into theme)
    pub style: Option<ShapeStyle>,
    /// Macro name
    pub macro_name: Option<String>,
}

/// Shape properties
#[derive(Debug, Clone, Default)]
pub struct ShapeProps {
    /// Original cNvPr `id` from the parsed file (round-trip preservation).
    pub original_id: Option<u32>,
    /// Name for the shape
    pub name: String,
    /// Preset shape type
    pub preset: ShapePreset,
    /// Fill style
    pub fill: Option<DrawingFill>,
    /// Outline/border style
    pub outline: Option<Outline>,
    /// Text content (for shapes with text)
    pub text: Option<String>,
    /// Macro name (@macro attribute, often empty string in OOXML files).
    /// `Some("")` preserves `macro=""` for round-trip fidelity.
    pub macro_name: Option<String>,
    /// Cell link for text content (@textlink attribute).
    /// `Some("")` preserves `textlink=""` for round-trip fidelity.
    pub textlink: Option<String>,
    /// Extension list on cNvPr — opaque XML passthrough (CT_NonVisualDrawingProps extLst)
    pub nv_ext_lst: Option<String>,
    /// Whether this shape is a text box (cNvSpPr/@txBox)
    pub tx_box: bool,
    /// Shape transform (a:xfrm) — offset, extent, rotation, flips
    pub xfrm: Option<ooxml_types::drawings::Transform2D>,
    /// Shape style reference (xdr:style)
    pub style: Option<ShapeStyle>,
}

/// Reference to a ChartEx part for drawing anchors.
/// ChartEx uses mc:AlternateContent wrapping with cx:chart graphicFrame.
#[derive(Debug, Clone)]
pub struct ChartExRef {
    /// Relationship ID to the chartEx part in drawing .rels
    pub r_id: String,
    /// Chart name (for cNvPr)
    pub name: String,
    /// Unique ID for the cNvPr
    pub id: u32,
    /// Graphic frame transform offset x.
    pub xfrm_off_x: i64,
    /// xfrm offset y
    pub xfrm_off_y: i64,
    /// xfrm extent cx
    pub xfrm_ext_cx: i64,
    /// xfrm extent cy
    pub xfrm_ext_cy: i64,
    /// Macro name (@macro attribute on graphicFrame).
    /// `Some("")` preserves `macro=""` for round-trip fidelity.
    /// `None` means the attribute was absent and should not be emitted.
    pub macro_name: Option<String>,
    /// Extension list on cNvPr — opaque XML passthrough (CT_NonVisualDrawingProps extLst).
    pub nv_ext_lst: Option<String>,
    /// Graphic frame locking properties (CT_GraphicalObjectFrameLocking).
    pub graphic_frame_locks: DrawingLocking,
    /// Whether `<a:graphicFrameLocks>` was present in the original XML.
    pub has_graphic_frame_locks: bool,
    /// Explicit `noChangeAspect` from original XML. `Some(false)` preserves `noChangeAspect="0"`.
    pub no_change_aspect_explicit: Option<bool>,
    /// Disallow drilldown — unique to CT_GraphicalObjectFrameLocking.
    pub no_drilldown: bool,
    /// Extension list from cNvGraphicFramePr.
    pub c_nv_graphic_frame_pr_ext_lst: Option<String>,
}

/// Chart reference in drawing
#[derive(Debug, Clone, Default)]
pub struct ChartRef {
    /// Original cNvPr `id` from the parsed file (round-trip preservation).
    pub original_id: Option<u32>,
    /// Name for the chart
    pub name: String,
    /// Optional description/alt text (cNvPr/@descr)
    pub descr: Option<String>,
    /// Optional title (cNvPr/@title)
    pub title: Option<String>,
    /// Whether hidden (cNvPr/@hidden)
    pub hidden: bool,
    /// Click hyperlink (cNvPr child element)
    pub hlink_click: Option<Hyperlink>,
    /// Hover hyperlink (cNvPr child element)
    pub hlink_hover: Option<Hyperlink>,
    /// Relationship ID to chart XML (e.g., "rId2")
    pub r_id: String,
    /// Macro name (@macro attribute, often empty string in OOXML files)
    pub macro_name: Option<String>,
    /// Extension list on cNvPr — opaque XML passthrough (CT_NonVisualDrawingProps extLst)
    pub nv_ext_lst: Option<String>,
    /// Graphic frame locking properties (CT_GraphicalObjectFrameLocking).
    /// Uses `DrawingLocking` as a superset; only the 6 attributes valid on
    /// `graphicFrameLocks` are emitted: noGrp, noSelect, noChangeAspect, noMove, noResize.
    pub graphic_frame_locks: DrawingLocking,
    /// Whether `<a:graphicFrameLocks>` was present in the original XML (even with no attributes).
    pub has_graphic_frame_locks: bool,
    /// Explicit `noChangeAspect` from original XML. `Some(false)` preserves `noChangeAspect="0"`.
    pub no_change_aspect_explicit: Option<bool>,
    /// Disallow drilldown — unique to CT_GraphicalObjectFrameLocking.
    pub no_drilldown: bool,
    /// Extension list from cNvGraphicFramePr — opaque XML passthrough
    /// (CT_NonVisualGraphicFrameProperties extLst).
    pub c_nv_graphic_frame_pr_ext_lst: Option<String>,
    /// Transform: offset x
    pub xfrm_off_x: i64,
    /// Transform: offset y
    pub xfrm_off_y: i64,
    /// Transform: extent cx
    pub xfrm_ext_cx: i64,
    /// Transform: extent cy
    pub xfrm_ext_cy: i64,
}

/// Text box / shape with full-fidelity round-trip support.
///
/// Represents `<xdr:sp>` elements in drawing XML. Used for both text boxes
/// (cNvSpPr/@txBox=true) and general shapes with text content.
#[derive(Debug, Clone, Default)]
pub struct TextBox {
    // -- Non-visual identity (cNvPr) ----------------------------------------
    /// Original cNvPr `id` from the parsed file (round-trip preservation).
    pub original_id: Option<u32>,
    /// Name for the text box
    pub name: String,
    /// Optional description/alt text (cNvPr/@descr)
    pub description: Option<String>,
    /// Optional title (cNvPr/@title)
    pub title: Option<String>,
    /// Whether hidden (cNvPr/@hidden)
    pub hidden: bool,
    /// Click hyperlink (cNvPr child element)
    pub hlink_click: Option<Hyperlink>,
    /// Hover hyperlink (cNvPr child element)
    pub hlink_hover: Option<Hyperlink>,
    /// Extension list on cNvPr — opaque XML passthrough (CT_NonVisualDrawingProps extLst)
    pub nv_ext_lst: Option<String>,

    // -- Shape-specific NV props (cNvSpPr) -----------------------------------
    /// Whether this is a text box (cNvSpPr/@txBox)
    pub tx_box: bool,
    /// Shape-specific locking properties (cNvSpPr shape locks)
    pub c_nv_sp_pr: DrawingLocking,
    /// Whether `<a:spLocks>` was present in the original XML (even with all-default attributes).
    pub has_sp_locks: bool,
    /// Explicit `noChangeAspect` from original XML. `Some(false)` preserves `noChangeAspect="0"`.
    pub no_change_aspect_explicit: Option<bool>,
    /// Extension list from cNvSpPr — opaque XML passthrough
    pub c_nv_sp_pr_ext_lst: Option<String>,

    // -- Shape properties (spPr) ---------------------------------------------
    /// 2D transform (position, size, rotation, flip)
    pub xfrm: Option<Transform2D>,
    /// Preset geometry with adjustment values (e.g., rect for text boxes)
    pub preset_geometry: Option<PresetGeometry>,
    /// Fill style
    pub fill: Option<DrawingFill>,
    /// Outline/border style
    pub outline: Option<Outline>,
    /// Effect properties (effectLst or effectDag)
    pub effects: Option<EffectProperties>,
    /// Black and white mode
    pub bw_mode: Option<BlackWhiteMode>,
    /// 3D scene properties
    pub scene3d: Option<Scene3D>,
    /// 3D shape properties
    pub sp3d: Option<Shape3D>,
    /// Extension list on spPr — opaque XML passthrough
    pub sp_pr_ext_lst: Option<String>,

    // -- Style & content ----------------------------------------------------
    /// Shape style references (into theme)
    pub style: Option<ShapeStyle>,
    /// Rich text body (replaces plain `text` + `wrap` fields)
    pub text_body: Option<TextBody>,
    /// Macro name (@macro attribute, often empty string in OOXML files).
    pub macro_name: Option<String>,
    /// Cell link for text content (@textlink attribute).
    pub textlink: Option<String>,
    /// Whether text is locked from editing (@fLocksText)
    pub f_locks_text: Option<bool>,
    /// Whether shape is published (@fPublished)
    pub f_published: Option<bool>,
}

impl TextBox {
    /// Create a text box from a plain text string (backward compatibility helper).
    pub fn from_plain(name: &str, text: &str) -> Self {
        let text_body = TextBody {
            body_props: TextBodyProperties {
                wrap: Some(TextWrap::Square),
                ..Default::default()
            },
            list_style: Some(TextListStyle::default()),
            paragraphs: vec![Paragraph {
                runs: vec![TextRunContent::Run(TextRun {
                    text: text.to_string(),
                    props: RunProperties {
                        lang: Some("en-US".to_string()),
                        ..Default::default()
                    },
                })],
                ..Default::default()
            }],
        };
        Self {
            original_id: None,
            name: name.to_string(),
            description: None,
            title: None,
            hidden: false,
            hlink_click: None,
            hlink_hover: None,
            nv_ext_lst: None,
            tx_box: true,
            c_nv_sp_pr: DrawingLocking::default(),
            has_sp_locks: false,
            no_change_aspect_explicit: None,
            c_nv_sp_pr_ext_lst: None,
            xfrm: None,
            preset_geometry: None,
            fill: None,
            outline: None,
            effects: None,
            bw_mode: None,
            scene3d: None,
            sp3d: None,
            sp_pr_ext_lst: None,
            style: None,
            text_body: Some(text_body),
            macro_name: None,
            textlink: None,
            f_locks_text: None,
            f_published: None,
        }
    }
}

// ============================================================================
// Connector Types
// ============================================================================

/// Connector properties for writing `<xdr:cxnSp>` elements
#[derive(Debug, Clone)]
pub struct ConnectorProps {
    // Non-visual properties
    /// Original cNvPr `id` from the parsed file (round-trip preservation).
    pub original_id: Option<u32>,
    /// Name for the connector
    pub name: String,
    /// Optional description/alt text
    pub description: Option<String>,
    /// Optional title
    pub title: Option<String>,
    /// Whether the connector is hidden
    pub hidden: bool,
    /// Click hyperlink
    pub hlink_click: Option<Hyperlink>,
    /// Hover hyperlink
    pub hlink_hover: Option<Hyperlink>,
    /// Extension list on cNvPr — opaque XML passthrough (CT_NonVisualDrawingProps extLst)
    pub nv_ext_lst: Option<String>,

    // Connection endpoints
    /// Start connection (shape ID and connection site)
    pub start_connection: Option<Connection>,
    /// End connection (shape ID and connection site)
    pub end_connection: Option<Connection>,

    // Locking
    /// Connector locking properties
    pub locks: DrawingLocking,

    // Shape properties
    /// 2D transform (position, size, rotation, flip)
    pub transform: Transform2D,
    /// Preset geometry with adjustment values (e.g., straightConnector1, bentConnector3)
    pub preset_geometry: Option<PresetGeometry>,
    /// Fill style (full OOXML fidelity — supports all 5 fill variants)
    pub fill: Option<DrawingFill>,
    /// Outline/line style (full OOXML CT_LineProperties)
    pub outline: Option<Outline>,

    // Style & metadata
    /// Shape style references (full OOXML CT_ShapeStyle)
    pub style: Option<ShapeStyle>,
    /// Macro name
    pub macro_name: Option<String>,
}

// ============================================================================
// Group Shape Types
// ============================================================================

/// Opaque graphic frame — stores the complete `<xdr:graphicFrame>...</xdr:graphicFrame>` XML
/// for roundtrip fidelity. Writer emits raw_xml verbatim.
#[derive(Debug, Clone, Default)]
pub struct OpaqueGraphicFrame {
    pub raw_xml: String,
}

/// Opaque unsupported spreadsheet drawing object.
///
/// Stores the complete direct object-choice XML. It is emitted only through the
/// drawing relationship safety policy, so stale relationship attributes are
/// suppressed unless their ids remain registered for the drawing part.
#[derive(Debug, Clone, Default)]
pub struct OpaqueDrawingObject {
    pub raw_xml: String,
}

/// Group shape properties for writing `<xdr:grpSp>` elements (CT_GroupShape).
#[derive(Debug, Clone)]
pub struct GroupShapeProps {
    // Non-visual identity
    /// Original cNvPr `id` from the parsed file (round-trip preservation).
    pub original_id: Option<u32>,
    /// Name for the group (cNvPr/@name, required per spec)
    pub name: String,
    /// Optional description/alt text
    pub description: Option<String>,
    /// Optional title
    pub title: Option<String>,
    /// Whether the group is hidden
    pub hidden: bool,
    /// Click hyperlink
    pub hlink_click: Option<Hyperlink>,
    /// Hover hyperlink
    pub hlink_hover: Option<Hyperlink>,

    // Group-specific NV props
    /// Group locking properties (cNvGrpSpPr/grpSpLocks)
    pub group_locking: Option<GroupLocking>,
    /// Extension list on cNvGrpSpPr — opaque XML passthrough
    pub nv_ext_lst: Option<String>,

    // Group shape properties (grpSpPr)
    /// Group transform including child coordinate space
    pub transform: Option<GroupTransform2D>,
    /// Fill (typed DrawingFill — supports solid, gradient, pattern, blip, noFill)
    pub fill: Option<DrawingFill>,
    /// Effect properties (effectLst or effectDag).
    pub effects: Option<EffectProperties>,
    /// Black and white mode
    pub bw_mode: Option<BlackWhiteMode>,
    /// Scene 3D properties (typed `Scene3D` from ooxml-types)
    pub scene3d: Option<Scene3D>,
    /// Extension list on grpSpPr — opaque XML passthrough
    pub ext_lst: Option<String>,

    // Children (recursive)
    /// Child drawing objects
    pub children: Vec<DrawingObject>,
}

// ============================================================================
// SmartArt Types
// ============================================================================

/// SmartArt write data for opaque roundtrip.
///
/// Holds the raw XML strings for each diagram part so they can be written
/// back to the zip verbatim, plus the relationship IDs that will be
/// referenced in the `<dgm:relIds>` element inside the graphicFrame.
#[derive(Debug, Clone)]
pub struct SmartArtWriteData {
    // -- Identity ---------------------------------------------------------------
    /// Original cNvPr `id` from the parsed file (round-trip preservation).
    pub original_id: Option<u32>,
    /// Name for the graphicFrame (cNvPr/@name)
    pub name: String,

    // -- Relationship IDs (assigned during write, referenced in dgm:relIds) -----
    /// Relationship ID for the data part (`r:dm`)
    pub dm_rel_id: String,
    /// Relationship ID for the layout part (`r:lo`)
    pub lo_rel_id: String,
    /// Relationship ID for the quick style part (`r:qs`)
    pub qs_rel_id: String,
    /// Relationship ID for the colors part (`r:cs`)
    pub cs_rel_id: String,

    // -- Raw XML parts (opaque roundtrip) ---------------------------------------
    /// `xl/diagrams/data{N}.xml` content
    pub data_xml: Option<String>,
    /// `xl/diagrams/layout{N}.xml` content
    pub layout_xml: Option<String>,
    /// `xl/diagrams/colors{N}.xml` content
    pub colors_xml: Option<String>,
    /// `xl/diagrams/quickStyles{N}.xml` content
    pub style_xml: Option<String>,
    /// `xl/diagrams/drawing{N}.xml` content (MS extension, optional)
    pub drawing_xml: Option<String>,
}

// ============================================================================
// Drawing Object & Anchor Enums
// ============================================================================

/// Drawing object types
#[derive(Debug, Clone)]
pub enum DrawingObject {
    /// Picture/image
    Picture(ImageProps),
    /// Shape (rectangle, oval, etc.)
    Shape(ShapeProps),
    /// Chart reference
    Chart(ChartRef),
    /// ChartEx reference (modern chart types: waterfall, treemap, etc.)
    /// Emitted as mc:AlternateContent with cx:chart graphicFrame
    ChartEx(ChartExRef),
    /// Text box
    TextBox(TextBox),
    /// Connector line between shapes
    Connector(ConnectorProps),
    /// Group shape (recursive container)
    GroupShape(GroupShapeProps),
    /// Opaque graphic frame (roundtrip passthrough)
    GraphicFrame(OpaqueGraphicFrame),
    /// Opaque unsupported direct drawing object (roundtrip passthrough).
    OpaqueRaw(OpaqueDrawingObject),
    /// Content part reference.
    ContentPart(ContentPartRef),
    /// SmartArt diagram (opaque roundtrip with separate XML parts)
    SmartArt(SmartArtWriteData),
    /// Slicer (mc:AlternateContent with sle:slicer in graphicFrame)
    Slicer {
        /// Original cNvPr `id` from the parsed file (round-trip preservation).
        original_id: Option<u32>,
        /// Slicer name (matches SlicerDef.name)
        name: String,
        /// Relationship ID to slicer part (for the containing drawing's .rels)
        r_id: String,
        /// Optional graphicFrame macro attribute.
        macro_name: Option<String>,
        /// Optional cNvPr extension list.
        nv_ext_lst: Option<String>,
    },
    /// Timeline (mc:AlternateContent with tsle:timeslicer in graphicFrame).
    Timeline {
        /// Original cNvPr `id` from the parsed file (round-trip preservation).
        original_id: Option<u32>,
        /// Timeline name (matches TimelineDef.name).
        name: String,
        /// Optional graphicFrame macro attribute.
        macro_name: Option<String>,
        /// Optional cNvPr extension list.
        nv_ext_lst: Option<String>,
    },
}

/// Drawing anchor (wrapper around object + anchor type)
#[derive(Debug, Clone)]
pub enum DrawingAnchor {
    /// Two-cell anchor with drawing object
    TwoCell(TwoCellAnchor, DrawingObject),
    /// One-cell anchor with drawing object
    OneCell(OneCellAnchor, DrawingObject),
    /// Absolute anchor with drawing object
    Absolute(AbsoluteAnchor, DrawingObject),
}
