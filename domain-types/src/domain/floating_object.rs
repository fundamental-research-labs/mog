//! Unified floating object type hierarchy.
//!
//! One type system for all floating objects: shapes, pictures, textboxes,
//! connectors, charts, equations, diagrams, OLE objects, slicers, form controls.

use serde::de;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

use super::chart::{
    AxisData, ChartDataTableData, ChartDefinition, ChartFormatData, ChartFormatStringData,
    ChartRoundTripData, ChartSeriesData, ChartSubType, ChartType, ChartView3DData, DataLabelData,
    LegendData, PieSliceData, PivotChartOptionsData, SeriesOrientation, TrendlineData,
    WaterfallOptions,
};
use super::conditional_format::CellIdRange;
use super::text_effects::{LineDash, TextEffectConfig};
use crate::{CellFormat, ImportObjectStatus};

// ===========================================================================
// OOXML Prop Wrappers — typed replacements for serde_json::Value blobs
// ===========================================================================

/// OOXML round-trip properties for a picture floating object.
///
/// Wraps the parsed `SpreadsheetPicture` plus parse-time bookkeeping fields
/// that are resolved from OPC relationships (not present on the OOXML struct).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct PictureOoxmlProps {
    /// The full parsed OOXML picture struct (CT_Picture).
    pub picture: ooxml_types::drawings::SpreadsheetPicture,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original EMU extent width (for lossless round-trip).
    pub extent_emu_cx: Option<i64>,
    /// Original EMU extent height (for lossless round-trip).
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from the anchor element.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Raw XML for mc:AlternateContent (form control shapes).
    pub mc_alternate_content_raw_xml: Option<String>,
    /// Image path resolved from OPC relationships (e.g., "../media/image1.png").
    pub image_path: Option<String>,
}

/// OOXML round-trip properties for a shape floating object.
///
/// Wraps the parsed `SpreadsheetShape` plus parse-time bookkeeping fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ShapeOoxmlProps {
    /// The full parsed OOXML shape struct (CT_Shape).
    pub shape: ooxml_types::drawings::SpreadsheetShape,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original EMU extent width (for lossless round-trip).
    pub extent_emu_cx: Option<i64>,
    /// Original EMU extent height (for lossless round-trip).
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from the anchor element.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Raw XML for mc:AlternateContent (form control shapes).
    pub mc_alternate_content_raw_xml: Option<String>,
    /// Full CT_GroupShape payload (only for shape_type="group").
    ///
    /// Typed-domain replacement for the former `group_json:
    /// Option<serde_json::Value>` blob (typed OOXML preservation); the
    /// `GroupShape` type used to live in `xlsx-parser`, forcing the field
    /// to carry free-form JSON. It now lives in `domain-types` as
    /// [`GroupShapeData`](super::drawings::GroupShapeData).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_shape: Option<super::drawings::GroupShapeData>,
}

/// OOXML round-trip properties for a connector floating object.
///
/// Wraps the parsed `SpreadsheetConnector` directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ConnectorOoxmlProps {
    /// The full parsed OOXML connector struct (CT_Connector).
    pub connector: ooxml_types::drawings::SpreadsheetConnector,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original EMU extent width (for lossless round-trip).
    pub extent_emu_cx: Option<i64>,
    /// Original EMU extent height (for lossless round-trip).
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from the anchor element.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Raw XML for mc:AlternateContent.
    pub mc_alternate_content_raw_xml: Option<String>,
}

/// OOXML round-trip properties for a chart's drawing frame.
///
/// The chart part itself is owned by [`ChartDefinition`]. This sidecar owns the
/// spreadsheet drawing frame and parse-time anchor/relationship bookkeeping that
/// is not part of `SpreadsheetGraphicFrame`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ChartDrawingFrameOoxmlProps {
    /// The full parsed OOXML graphic frame (`xdr:graphicFrame`).
    pub graphic_frame: ooxml_types::drawings::SpreadsheetGraphicFrame,
    /// Index of the anchor in the original drawing XML (for ordering).
    pub anchor_index: Option<i32>,
    /// Original one-cell anchor extent width in EMUs.
    pub extent_emu_cx: Option<i64>,
    /// Original one-cell anchor extent height in EMUs.
    pub extent_emu_cy: Option<i64>,
    /// editAs attribute from a two-cell anchor.
    pub edit_as: Option<String>,
    /// Client data: locks with sheet (OOXML default is true).
    pub client_data_locks_with_sheet: Option<bool>,
    /// Client data: prints with sheet (OOXML default is true).
    pub client_data_prints_with_sheet: Option<bool>,
    /// Original drawing relationship ID used by the chart reference.
    pub relationship_id: Option<String>,
    /// Original drawing relationship target for the chart part.
    pub relationship_target: Option<String>,
}

/// Typed OOXML preservation contract for chart floating objects.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ChartOoxmlProps {
    /// Typed chart or ChartEx part definition used by XLSX export.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<ChartDefinition>,
    /// Typed drawing-frame metadata and anchor/relationship bookkeeping.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drawing_frame: Option<ChartDrawingFrameOoxmlProps>,
    /// Whether this chart uses ChartEx format.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_chart_ex: bool,
}

// ===========================================================================
// SECTION A: Shared Sub-Object Types (from snapshot-types — exact field match)
// ===========================================================================

/// Fill type for a floating object.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FillType {
    Solid,
    Gradient,
    Pattern,
    PictureAndTexture,
    None,
}

/// Fill properties for a floating object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ObjectFill {
    /// Fill type (serialized as "type").
    #[serde(rename = "type")]
    pub fill_type: FillType,
    /// Fill color (e.g. "#4285f4").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Gradient definition (when `fill_type` is `Gradient`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient: Option<GradientFill>,
    /// Fill transparency (0.0 = opaque, 1.0 = fully transparent).
    /// Maps to OfficeJS Shape.fill.transparency.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparency: Option<f64>,
    /// Pattern fill (when fill_type is Pattern).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<PatternFill>,
    /// Picture/texture fill (when fill_type is PictureAndTexture).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blip: Option<BlipFill>,
}

impl Default for ObjectFill {
    fn default() -> Self {
        Self {
            fill_type: FillType::None,
            color: None,
            gradient: None,
            transparency: None,
            pattern: None,
            blip: None,
        }
    }
}

/// Gradient type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GradientType {
    Linear,
    Radial,
}

/// Gradient fill definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct GradientFill {
    /// Gradient type (serialized as "type").
    #[serde(rename = "type")]
    pub gradient_type: GradientType,
    /// Color stops.
    pub stops: Vec<GradientStop>,
    /// Angle in degrees (for linear gradients).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
}

impl Default for GradientFill {
    fn default() -> Self {
        Self {
            gradient_type: GradientType::Linear,
            stops: Vec::new(),
            angle: None,
        }
    }
}

/// A single color stop in a gradient.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    /// Position in the gradient (0.0 to 1.0).
    pub offset: f64,
    /// Color at this stop.
    pub color: String,
}

/// Pattern fill definition.
/// Maps to CT_PatternFillProperties (ECMA-376).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternFill {
    /// OOXML ST_PresetPatternVal (48 patterns: pct5, pct10, ..., ltDnDiag, etc.)
    pub preset: String,
    /// Foreground color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground_color: Option<String>,
    /// Background color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
}

/// Picture/texture fill definition.
/// Maps to CT_BlipFillProperties (ECMA-376).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlipFill {
    /// Image source reference.
    pub src: String,
    /// Whether the image is stretched to fill.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stretch: Option<bool>,
    /// Tile settings (when not stretched).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tile: Option<TileSettings>,
}

/// Tile settings for a picture/texture fill.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileSettings {
    /// Horizontal offset in EMU.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx: Option<i64>,
    /// Vertical offset in EMU.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ty: Option<i64>,
    /// Horizontal scale percentage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sx: Option<i64>,
    /// Vertical scale percentage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sy: Option<i64>,
    /// Tile flip mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flip: Option<String>,
    /// Tile alignment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub algn: Option<String>,
}

/// Line end marker type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LineEndType {
    None,
    Triangle,
    Stealth,
    Diamond,
    Oval,
    Arrow,
}

/// Arrowhead/line-end size.
/// Maps to ST_LineEndLength/ST_LineEndWidth (ECMA-376, dml-main.xsd).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LineEndSize {
    Sm,
    Med,
    Lg,
}

/// Line end (arrow) definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct LineEnd {
    /// End marker type (serialized as "type").
    #[serde(rename = "type")]
    pub end_type: LineEndType,
    /// Arrowhead width.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<LineEndSize>,
    /// Arrowhead length.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length: Option<LineEndSize>,
}

impl Default for LineEnd {
    fn default() -> Self {
        Self {
            end_type: LineEndType::None,
            width: None,
            length: None,
        }
    }
}

/// Outline style for a shape or connector.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OutlineStyle {
    None,
    Solid,
    Dashed,
    Dotted,
}

/// Compound line style for shape outlines.
/// Maps to ST_CompoundLine (ECMA-376).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompoundLineStyle {
    Single,
    Double,
    ThickThin,
    ThinThick,
    Triple,
}

/// Outline (stroke) properties for a floating object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ShapeOutline {
    /// Line style.
    pub style: OutlineStyle,
    /// Line color.
    pub color: String,
    /// Line width in points.
    pub width: f64,
    /// Arrow/marker at the start of a connector.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_end: Option<LineEnd>,
    /// Arrow/marker at the end of a connector.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tail_end: Option<LineEnd>,
    /// Detailed dash pattern (matches OfficeJS 12 dash styles).
    /// When set, overrides the coarse `style` field for rendering.
    /// Uses the same `LineDash` enum as text-effect outlines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dash: Option<LineDash>,
    /// Outline transparency (0.0 = opaque, 1.0 = fully transparent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparency: Option<f64>,
    /// Compound line style (single, double, thick-thin, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compound: Option<CompoundLineStyle>,
    /// Whether the outline is visible. Dedicated boolean for P13.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
}

impl Default for ShapeOutline {
    fn default() -> Self {
        Self {
            style: OutlineStyle::None,
            color: String::new(),
            width: 0.0,
            head_end: None,
            tail_end: None,
            dash: None,
            transparency: None,
            compound: None,
            visible: None,
        }
    }
}

/// Vertical text alignment within a shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum VerticalAlign {
    Top,
    Middle,
    Bottom,
    Justified,
    Distributed,
}

impl VerticalAlign {
    /// Return the camelCase string representation (for Yrs storage).
    pub fn as_str(&self) -> &'static str {
        match self {
            VerticalAlign::Top => "top",
            VerticalAlign::Middle => "middle",
            VerticalAlign::Bottom => "bottom",
            VerticalAlign::Justified => "justified",
            VerticalAlign::Distributed => "distributed",
        }
    }

    /// Parse from camelCase string.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "top" => Some(VerticalAlign::Top),
            "middle" => Some(VerticalAlign::Middle),
            "bottom" => Some(VerticalAlign::Bottom),
            "justified" => Some(VerticalAlign::Justified),
            "distributed" => Some(VerticalAlign::Distributed),
            _ => None,
        }
    }
}

/// Horizontal text alignment within a shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum HorizontalAlign {
    Left,
    Center,
    Right,
    Justify,
    Distributed,
}

/// How text auto-sizes within its container.
/// Maps to OOXML CT_TextAutofit choice group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TextAutoSize {
    /// No auto-sizing (OOXML: <a:noAutofit/>).
    None,
    /// Shrink text to fit shape (OOXML: <a:normAutofit/>).
    TextToFitShape {
        #[serde(skip_serializing_if = "Option::is_none")]
        font_scale: Option<i32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        line_spacing_reduction: Option<i32>,
    },
    /// Grow shape to fit text (OOXML: <a:spAutoFit/>).
    ShapeToFitText,
}

/// Text orientation within a shape.
/// Maps to ST_TextVerticalType (ECMA-376).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextOrientation {
    Horizontal,
    Vertical,
    Vertical270,
    TextEffectsVertical,
    EastAsianVertical,
    MongolianVertical,
}

/// Text reading order / directionality.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextReadingOrder {
    LeftToRight,
    RightToLeft,
}

/// Text overflow behavior.
/// Maps to ST_TextHorzOverflowType / ST_TextVertOverflowType.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextOverflow {
    Overflow,
    Clip,
    Ellipsis,
}

/// Rich text content within a shape or textbox.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ShapeText {
    /// Plain text content.
    pub content: String,
    /// Cell formatting applied to shape text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CellFormat>,
    /// Rich text runs. When present, this is the source of truth for
    /// per-run formatting. When None, fall back to `content` + `format`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runs: Option<Vec<TextRun>>,
    /// Vertical alignment of text within shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<VerticalAlign>,
    /// Horizontal alignment of text within shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_align: Option<HorizontalAlign>,
    /// Text frame margins (insets).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margins: Option<TextMargins>,
    /// Auto-sizing behavior.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_size: Option<TextAutoSize>,
    /// Text orientation / rotation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<TextOrientation>,
    /// Reading order (LTR / RTL).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reading_order: Option<TextReadingOrder>,
    /// Horizontal overflow behavior.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_overflow: Option<TextOverflow>,
    /// Vertical overflow behavior.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_overflow: Option<TextOverflow>,
    /// Lossless CT_TextBody mirror.
    ///
    /// When present, this is the authoritative round-trip form for writers
    /// that want byte-identical OOXML output — populated by the parser
    /// whenever the source shape had an `<a:txBody>` element. The simplified
    /// fields above remain the UI-editable view until this field becomes the
    /// source of truth for writers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_body: Option<super::drawings::TextBody>,
}

/// A run of text with optional per-run formatting.
/// Format uses CellFormat (only font fields apply: font_family, font_size,
/// font_color, bold, italic, underline_type, strikethrough, superscript,
/// subscript). Non-font fields are ignored and should stay None.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CellFormat>,
}

/// Shadow alignment options.
/// Specifies the alignment of the shadow relative to the object.
/// Maps to ST_RectAlignment (ECMA-376).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ShadowAlignment {
    /// Top-left
    #[serde(rename = "tl")]
    TopLeft,
    /// Top-center
    #[serde(rename = "t")]
    Top,
    /// Top-right
    #[serde(rename = "tr")]
    TopRight,
    /// Middle-left
    #[serde(rename = "l")]
    Left,
    /// Center
    #[serde(rename = "ctr")]
    Center,
    /// Middle-right
    #[serde(rename = "r")]
    Right,
    /// Bottom-left
    #[serde(rename = "bl")]
    BottomLeft,
    /// Bottom-center
    #[serde(rename = "b")]
    Bottom,
    /// Bottom-right
    #[serde(rename = "br")]
    BottomRight,
}

/// Outer shadow effect on a floating object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct OuterShadowEffect {
    /// Blur radius in EMUs.
    pub blur_radius: f64,
    /// Shadow distance in EMUs.
    pub distance: f64,
    /// Shadow direction in degrees (0-360).
    pub direction: f64,
    /// Shadow color.
    pub color: String,
    /// Shadow opacity (0.0-1.0).
    pub opacity: f64,
    /// Horizontal scale factor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f64>,
    /// Vertical scale factor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
    /// Horizontal skew angle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_x: Option<f64>,
    /// Vertical skew angle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_y: Option<f64>,
    /// Shadow alignment relative to the object bounding box.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<ShadowAlignment>,
    /// Whether the shadow rotates with the shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate_with_shape: Option<bool>,
}

impl Default for OuterShadowEffect {
    fn default() -> Self {
        Self {
            blur_radius: 0.0,
            distance: 0.0,
            direction: 0.0,
            color: String::new(),
            opacity: 0.0,
            scale_x: None,
            scale_y: None,
            skew_x: None,
            skew_y: None,
            alignment: None,
            rotate_with_shape: None,
        }
    }
}

/// Connector binding to another shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ConnectorBinding {
    /// ID of the shape this connector attaches to.
    pub shape_id: String,
    /// Connection site index on the target shape.
    pub site_index: i32,
}

// ===========================================================================
// SECTION B: New Supporting Types
// ===========================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureCrop {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureAdjustments {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brightness: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contrast: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transparency: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMargins {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

// ===========================================================================
// SECTION C: Anchor Types
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AnchorMode {
    #[serde(rename = "oneCell")]
    OneCell,
    #[serde(rename = "twoCell")]
    TwoCell,
    #[serde(rename = "absolute")]
    Absolute,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FloatingObjectAnchor {
    pub anchor_row: u32,
    pub anchor_col: u32,
    /// EMU offset from anchor cell.
    #[serde(rename = "anchorRowOffsetEmu", alias = "anchorRowOffset")]
    pub anchor_row_offset: i64,
    /// EMU offset from anchor cell.
    #[serde(rename = "anchorColOffsetEmu", alias = "anchorColOffset")]
    pub anchor_col_offset: i64,
    pub anchor_mode: AnchorMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_row: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_col: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "endRowOffsetEmu", alias = "endRowOffset")]
    pub end_row_offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "endColOffsetEmu", alias = "endColOffset")]
    pub end_col_offset: Option<i64>,
    /// Extent cx in EMU (oneCell anchor).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "extentCxEmu", alias = "extentCx")]
    pub extent_cx: Option<i64>,
    /// Extent cy in EMU (oneCell anchor).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "extentCyEmu", alias = "extentCy")]
    pub extent_cy: Option<i64>,
}

impl Default for FloatingObjectAnchor {
    fn default() -> Self {
        Self {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            anchor_mode: AnchorMode::OneCell,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: None,
            extent_cy: None,
        }
    }
}

// ===========================================================================
// SECTION D: FloatingObjectCommon
// ===========================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FloatingObjectCommon {
    pub id: String,
    pub sheet_id: String,
    pub anchor: FloatingObjectAnchor,
    pub width: f64,
    pub height: f64,
    pub z_index: i32,
    pub rotation: f64,
    pub flip_h: bool,
    pub flip_v: bool,
    pub locked: bool,
    pub visible: bool,
    pub printable: bool,
    pub opacity: f64,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_cell_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_anchor_cell_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_aspect_ratio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_text_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_status: Option<ImportObjectStatus>,
}

impl Default for FloatingObjectCommon {
    fn default() -> Self {
        Self {
            id: String::new(),
            sheet_id: String::new(),
            anchor: FloatingObjectAnchor::default(),
            width: 0.0,
            height: 0.0,
            z_index: 0,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            locked: false,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: String::new(),
            created_at: 0,
            updated_at: 0,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            lock_aspect_ratio: None,
            alt_text_title: None,
            display_name: None,
            import_status: None,
        }
    }
}

// ===========================================================================
// SECTION E: Per-Type Data Structs
// ===========================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct ShapeData {
    pub shape_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<ObjectFill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<ShapeOutline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<ShapeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<OuterShadowEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adjustments: Option<HashMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene_3d: Option<super::drawings::SceneSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sp_3d: Option<super::drawings::Shape3DSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<ShapeOoxmlProps>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorData {
    pub shape_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<ObjectFill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<ShapeOutline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_connection: Option<ConnectorBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_connection: Option<ConnectorBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adjustments: Option<HashMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<ConnectorOoxmlProps>,
}

/// Image color transform type.
/// Maps to OfficeJS Image.colorType.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageColorType {
    Automatic,
    GrayScale,
    BlackAndWhite,
    Watermark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureData {
    pub src: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crop: Option<PictureCrop>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adjustments: Option<PictureAdjustments>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<ShapeOutline>,
    /// Image color transform type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_type: Option<ImageColorType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<PictureOoxmlProps>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextboxData {
    /// Text content and formatting — shared model with ShapeData.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<ShapeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<ObjectFill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<ShapeOutline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_effects: Option<TextEffectConfig>,
    /// Textboxes use SpreadsheetShape (same as shapes — txBox is a flag on the shape).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<ShapeOoxmlProps>,
}

/// Chart-specific data for the `FloatingObjectData::Chart` variant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartData {
    // -- Type --
    pub chart_type: ChartType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<ChartSubType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_orientation: Option<SeriesOrientation>,

    // -- Data ranges (A1-style for display, CellId-based for identity) --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_range_identity: Option<CellIdRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_range_identity: Option<CellIdRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_range_identity: Option<CellIdRange>,

    // -- Display config --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legend: Option<LegendData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis: Option<AxisData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series: Option<Vec<ChartSeriesData>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_labels: Option<DataLabelData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pie_slice: Option<PieSliceData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trendline: Option<Vec<TrendlineData>>,

    // -- Type-specific display flags --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smooth_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radar_filled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radar_markers: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waterfall: Option<WaterfallOptions>,

    // -- Chart-level display properties (OOXML threading) --
    /// How blank cells are plotted: "gap", "zero", or "span"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_blanks_as: Option<String>,
    /// Whether to plot only visible cells
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot_visible_only: Option<bool>,
    /// Gap width between bars/columns (0-500%)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap_width: Option<u32>,
    /// Overlap between bars/columns (-100 to 100)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlap: Option<i32>,
    /// Doughnut hole size (10-90%)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doughnut_hole_size: Option<u32>,
    /// First slice angle for pie/doughnut (0-360 degrees)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_slice_angle: Option<u32>,
    /// Bubble scale percentage (0-300%)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bubble_scale: Option<u32>,
    /// Split type for of-pie charts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_type: Option<String>,
    /// Split value threshold for of-pie charts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_value: Option<f64>,

    // ── Simple config properties ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_label_level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub series_name_level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_all_field_buttons: Option<bool>,

    // ── Chart-level series properties ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub second_plot_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub vary_by_categories: Option<bool>,

    // ── Title alignment/shadow ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_h_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_v_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_show_shadow: Option<bool>,

    // ── Pivot chart options ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pivot_options: Option<PivotChartOptionsData>,

    // ── Bubble / Surface / Theming ──
    /// Whether 3D effect is applied to bubble charts.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bubble_3d_effect: Option<bool>,
    /// Whether surface chart uses wireframe rendering.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wireframe: Option<bool>,
    /// Whether surface chart shows top view only.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub surface_top_view: Option<bool>,
    /// Chart color scheme index (1-based).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub color_scheme: Option<u8>,

    // ── Position in points ──
    /// Height in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub height_pt: Option<f64>,
    /// Width in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub width_pt: Option<f64>,
    /// Left offset in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub left_pt: Option<f64>,
    /// Top offset in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub top_pt: Option<f64>,

    // ── API-exposed fields ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub style: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub rounded_corners: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub auto_title_deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_data_labels_over_max: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub chart_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub plot_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_rich_text: Option<Vec<ChartFormatStringData>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub data_table: Option<ChartDataTableData>,

    // ── Bar shape (3D decorative charts) ──
    /// Mark shape for 3D bar/column charts: "box", "cylinder", "cone", "pyramid".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bar_shape: Option<String>,

    // ── 3D ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub view_3d: Option<ChartView3DData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub floor_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub side_wall_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub back_wall_format: Option<ChartFormatData>,

    // ── Round-trip preservation ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub rt: Option<ChartRoundTripData>,

    // -- Table linking --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_table_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_data_columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_category_column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_table_column_names_as_labels: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_column_names: Option<Vec<String>>,

    // -- Sizing in cell units (for oneCell anchor charts) --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_cells: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_cells: Option<f64>,

    // -- OOXML round-trip --
    /// Original imported chart XML part. Used by XLSX export to avoid
    /// rehydrating deeply nested ChartSpace JSON for unedited charts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preserved_chart_xml: Option<String>,
    /// Typed OOXML preservation data for chart parts and drawing frames.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<ChartOoxmlProps>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraData {
    pub source_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquationData {
    pub equation: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramData {
    #[serde(default)]
    pub definition: super::smartart::SmartArtDefinition,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<super::smartart::SmartArtCategory>,
}

// ── Ink / Drawing Types ─────────────────────────────────────────────

/// Tool type for ink drawing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum InkTool {
    #[default]
    Pen,
    Pencil,
    Highlighter,
    Marker,
    Brush,
    Eraser,
}

/// A single point in a stroke with optional pressure/tilt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkPoint {
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressure: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tilt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<f64>,
}

/// A complete ink stroke.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkStroke {
    pub id: String,
    pub points: Vec<InkPoint>,
    pub tool: InkTool,
    pub color: String,
    pub width: f64,
    pub opacity: f64,
    pub created_by: String,
    pub created_at: f64,
}

/// Per-tool settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkToolSettings {
    pub width: f64,
    pub opacity: f64,
    pub color: String,
    pub supports_pressure: bool,
}

/// Current tool state for a drawing session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkToolState {
    pub active_tool: InkTool,
    pub tool_settings: BTreeMap<String, InkToolSettings>,
}

impl Default for InkToolState {
    fn default() -> Self {
        let mut tool_settings = BTreeMap::new();
        tool_settings.insert(
            "pen".to_string(),
            InkToolSettings {
                width: 2.0,
                opacity: 1.0,
                color: "#000000".to_string(),
                supports_pressure: true,
            },
        );
        InkToolState {
            active_tool: InkTool::Pen,
            tool_settings,
        }
    }
}

/// Parameters for recognized geometric shapes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ShapeRecognitionParams {
    #[serde(rename = "line")]
    Line {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        rotation: f64,
    },
    #[serde(rename = "rectangle")]
    Rectangle {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        rotation: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        corner_radius: Option<f64>,
    },
    #[serde(rename = "ellipse")]
    Ellipse {
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        rotation: f64,
    },
    #[serde(rename = "triangle")]
    Triangle {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        x3: f64,
        y3: f64,
        rotation: f64,
    },
    #[serde(rename = "arrow")]
    Arrow {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        head_size: f64,
        rotation: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        has_start_head: Option<bool>,
    },
    #[serde(rename = "star")]
    Star {
        cx: f64,
        cy: f64,
        outer_radius: f64,
        inner_radius: f64,
        points: u32,
        rotation: f64,
    },
}

/// A text recognition alternative.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAlternative {
    pub text: String,
    pub confidence: f64,
}

/// Bounding box for a recognition result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognitionBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Recognition result — either a shape or text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RecognitionResult {
    #[serde(rename = "shape")]
    Shape {
        shape_type: String,
        params: ShapeRecognitionParams,
        source_stroke_ids: Vec<String>,
        confidence: f64,
        recognized_at: f64,
    },
    #[serde(rename = "text")]
    Text {
        text: String,
        alternatives: Vec<TextAlternative>,
        source_stroke_ids: Vec<String>,
        bounds: RecognitionBounds,
        recognized_at: f64,
    },
}

/// Ink/freehand drawing data — typed replacement for the old `data: Value` blob.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct DrawingData {
    /// Strokes keyed by stroke ID. Uses BTreeMap for deterministic serialization.
    #[serde(default)]
    pub strokes: BTreeMap<String, InkStroke>,

    /// Current tool state.
    #[serde(default)]
    pub tool_state: InkToolState,

    /// Recognition results keyed by recognition ID.
    #[serde(default)]
    pub recognitions: BTreeMap<String, RecognitionResult>,

    /// Background color (CSS color string), None = transparent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
}

/// OOXML round-trip properties for an OLE object.
///
/// Mirrors parser `OleObjectOutput` fields for lossless round-trip.
/// The domain-level `OleObjectData` carries prog_id/dv_aspect/flags;
/// this struct carries the remaining OOXML-specific data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[derive(Default)]
pub struct OleObjectOoxmlProps {
    /// VML shape identifier.
    pub shape_id: u32,
    /// Relationship ID for the embedded binary part.
    pub r_id: Option<String>,
    /// Resolved path to the embedded binary blob.
    pub data_path: Option<String>,
    /// Object name.
    pub name: Option<String>,
    /// Path to linked data (external file).
    pub link: Option<String>,
    /// Display aspect (duplicated from OleObjectData for JSON compat).
    pub dv_aspect: String,
    /// Program ID (duplicated from OleObjectData for JSON compat).
    pub prog_id: String,
    /// Update mode: "OLEUPDATE_ALWAYS" or "OLEUPDATE_ONCALL".
    pub ole_update: String,
    /// Whether to auto-load on workbook open.
    pub auto_load: bool,
    /// VML relationship ID for the preview image.
    pub preview_image_rel_id: Option<String>,
    /// Resolved path to the preview image.
    pub preview_image_path: Option<String>,
    /// Object properties from `<objectPr>` child element.
    ///
    /// Typed-domain replacement for the former `Option<serde_json::Value>` blob
    /// (typed OOXML preservation); the `OleObjectPropertiesOutput` type used
    /// to live in `xlsx-parser`, forcing the field to carry free-form JSON. It
    /// now lives in `domain-types` as
    /// [`OleObjectProperties`](super::drawings::OleObjectProperties).
    pub object_pr: Option<super::drawings::OleObjectProperties>,
}

/// OOXML round-trip properties for a form control.
///
/// Form controls use VML (not DrawingML), so there is no OOXML typed struct.
/// This struct captures all VML/CT_ClientData fields for lossless round-trip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FormControlOoxmlProps {
    pub shape_id: u32,
    pub alt_text: Option<String>,
    pub fmla_group: Option<String>,
    pub fmla_txbx: Option<String>,
    pub checked: Option<String>,
    pub val: Option<u32>,
    pub sel: Option<u32>,
    pub min: Option<i32>,
    pub max: Option<i32>,
    pub inc: Option<i32>,
    pub page: Option<i32>,
    pub drop_lines: Option<u32>,
    pub drop_style: Option<String>,
    pub dx: Option<u32>,
    pub horiz: bool,
    pub colored: bool,
    pub no_three_d: bool,
    pub no_three_d2: bool,
    pub first_button: bool,
    pub lock_text: bool,
    pub sel_type: Option<String>,
    pub multi_sel: Option<String>,
    pub text_h_align: Option<String>,
    pub text_v_align: Option<String>,
    pub edit_val: Option<String>,
    pub multi_line: bool,
    pub vertical_bar: bool,
    pub password_edit: bool,
    pub just_last_x: bool,
    pub width_min: Option<u32>,
    pub items: Vec<String>,
    pub macro_name: Option<String>,
    pub anchor_source: String,
    /// Whether the control moves with the cells it is anchored to.
    pub move_with_cells: bool,
    /// Whether the control resizes with the cells it is anchored to.
    pub size_with_cells: bool,
    /// VML-only CT_ClientData children (tag-name -> text-content).
    pub vml_extras: std::collections::HashMap<String, String>,
    /// Raw attributes from worksheet `<controlPr>` element.
    pub control_pr_attrs: std::collections::HashMap<String, String>,
    /// VML shape visual properties.
    ///
    /// Typed-domain replacement for the former `Option<serde_json::Value>`
    /// blob (typed OOXML preservation); the `VmlShapeProps` type used to
    /// live in `xlsx-parser`, forcing the field to carry free-form JSON. It
    /// now lives in `domain-types` as
    /// [`VmlShapeProps`](super::drawings::VmlShapeProps).
    pub vml_shape: Option<super::drawings::VmlShapeProps>,
}

impl Default for FormControlOoxmlProps {
    fn default() -> Self {
        Self {
            shape_id: 0,
            alt_text: None,
            fmla_group: None,
            fmla_txbx: None,
            checked: None,
            val: None,
            sel: None,
            min: None,
            max: None,
            inc: None,
            page: None,
            drop_lines: None,
            drop_style: None,
            dx: None,
            horiz: false,
            colored: false,
            no_three_d: false,
            no_three_d2: false,
            first_button: false,
            lock_text: false,
            sel_type: None,
            multi_sel: None,
            text_h_align: None,
            text_v_align: None,
            edit_val: None,
            multi_line: false,
            vertical_bar: false,
            password_edit: false,
            just_last_x: false,
            width_min: None,
            items: Vec::new(),
            macro_name: None,
            anchor_source: String::new(),
            // Before these flags were modeled explicitly, authored form controls
            // were emitted with both anchor policy attributes set to true.
            move_with_cells: true,
            size_with_cells: true,
            vml_extras: std::collections::HashMap::new(),
            control_pr_attrs: std::collections::HashMap::new(),
            vml_shape: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OleObjectData {
    pub prog_id: String,
    pub dv_aspect: String,
    pub is_linked: bool,
    pub is_embedded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_image_src: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<OleObjectOoxmlProps>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormControlData {
    pub control_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<FormControlOoxmlProps>,
}

/// Slicer marker payload on a floating object.
///
/// Slicers are persisted as canonical `StoredSlicer` entries in the
/// workbook-level slicers Y.Map. The `FloatingObjectData::Slicer` variant
/// only exists as the tag/discriminant for slicer-kind floating objects;
/// it carries no per-slicer state and (historically) held a
/// `serde_json::Value` bag with no writer — that bag is now removed per
/// typed OOXML preservation elimination of untyped boundaries.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerData {}

// ===========================================================================
// SECTION F: FloatingObjectData Enum
// ===========================================================================

/// The kind/type of a floating object, without any associated data.
///
/// Serializes to the same tag values as [`FloatingObjectData`] (e.g. `"shape"`,
/// `"diagram"`, `"oleObject"`). Used in change notifications where the full
/// data payload is not needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FloatingObjectKind {
    #[serde(rename = "shape")]
    Shape,
    #[serde(rename = "connector")]
    Connector,
    #[serde(rename = "picture")]
    Picture,
    #[serde(rename = "textbox")]
    Textbox,
    #[serde(rename = "chart")]
    Chart,
    #[serde(rename = "camera")]
    Camera,
    #[serde(rename = "equation")]
    Equation,
    #[serde(rename = "diagram")]
    Diagram,
    #[serde(rename = "drawing")]
    Drawing,
    #[serde(rename = "oleObject")]
    OleObject,
    #[serde(rename = "formControl")]
    FormControl,
    #[serde(rename = "slicer")]
    Slicer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)]
pub enum FloatingObjectData {
    #[serde(rename = "shape")]
    Shape(ShapeData),
    #[serde(rename = "connector")]
    Connector(ConnectorData),
    #[serde(rename = "picture")]
    Picture(PictureData),
    #[serde(rename = "textbox")]
    Textbox(TextboxData),
    #[serde(rename = "chart")]
    Chart(ChartData),
    #[serde(rename = "camera")]
    Camera(CameraData),
    #[serde(rename = "equation")]
    Equation(EquationData),
    #[serde(rename = "diagram")]
    Diagram(DiagramData),
    #[serde(rename = "drawing")]
    Drawing(DrawingData),
    #[serde(rename = "oleObject")]
    OleObject(OleObjectData),
    #[serde(rename = "formControl")]
    FormControl(FormControlData),
    #[serde(rename = "slicer")]
    Slicer(SlicerData),
}

// ===========================================================================
// SECTION G: FloatingObject Composite (Manual Serde)
// ===========================================================================

/// A floating object: common metadata + type-specific data, serialized flat.
#[derive(Debug, Clone, PartialEq)]
pub struct FloatingObject {
    pub common: FloatingObjectCommon,
    pub data: FloatingObjectData,
}

impl FloatingObject {
    pub fn object_type(&self) -> &str {
        self.kind().as_str()
    }

    /// Returns the [`FloatingObjectKind`] for this object.
    pub fn kind(&self) -> FloatingObjectKind {
        FloatingObjectKind::from(&self.data)
    }
}

impl FloatingObjectKind {
    /// Returns the serialized string representation (matches the serde tag values).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shape => "shape",
            Self::Connector => "connector",
            Self::Picture => "picture",
            Self::Textbox => "textbox",
            Self::Chart => "chart",
            Self::Camera => "camera",
            Self::Equation => "equation",
            Self::Diagram => "diagram",
            Self::Drawing => "drawing",
            Self::OleObject => "oleObject",
            Self::FormControl => "formControl",
            Self::Slicer => "slicer",
        }
    }
}

impl From<&FloatingObjectData> for FloatingObjectKind {
    fn from(data: &FloatingObjectData) -> Self {
        match data {
            FloatingObjectData::Shape(_) => Self::Shape,
            FloatingObjectData::Connector(_) => Self::Connector,
            FloatingObjectData::Picture(_) => Self::Picture,
            FloatingObjectData::Textbox(_) => Self::Textbox,
            FloatingObjectData::Chart(_) => Self::Chart,
            FloatingObjectData::Camera(_) => Self::Camera,
            FloatingObjectData::Equation(_) => Self::Equation,
            FloatingObjectData::Diagram(_) => Self::Diagram,
            FloatingObjectData::Drawing(_) => Self::Drawing,
            FloatingObjectData::OleObject(_) => Self::OleObject,
            FloatingObjectData::FormControl(_) => Self::FormControl,
            FloatingObjectData::Slicer(_) => Self::Slicer,
        }
    }
}

impl Serialize for FloatingObject {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let common_val = serde_json::to_value(&self.common).map_err(serde::ser::Error::custom)?;
        let data_val = serde_json::to_value(&self.data).map_err(serde::ser::Error::custom)?;

        let mut map = match data_val {
            Value::Object(m) => m,
            _ => serde_json::Map::new(),
        };
        if let Value::Object(common_map) = common_val {
            map.extend(common_map);
        }

        Value::Object(map).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for FloatingObject {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        let common: FloatingObjectCommon =
            serde_json::from_value(value.clone()).map_err(de::Error::custom)?;
        let data: FloatingObjectData = serde_json::from_value(value).map_err(de::Error::custom)?;
        Ok(FloatingObject { common, data })
    }
}

// ===========================================================================
// SECTION H: Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_common(id: &str, sheet_id: &str) -> FloatingObjectCommon {
        FloatingObjectCommon {
            id: id.to_string(),
            sheet_id: sheet_id.to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row: 0,
                anchor_col: 0,
                anchor_row_offset: 0,
                anchor_col_offset: 0,
                anchor_mode: AnchorMode::OneCell,
                end_row: None,
                end_col: None,
                end_row_offset: None,
                end_col_offset: None,
                extent_cx: Some(5000000),
                extent_cy: Some(3000000),
            },
            width: 100.0,
            height: 50.0,
            z_index: 1,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            locked: false,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: "Test Object".to_string(),
            created_at: 1700000000000,
            updated_at: 1700000001000,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            lock_aspect_ratio: None,
            alt_text_title: None,
            display_name: None,
            import_status: None,
        }
    }

    #[test]
    fn test_shape_round_trip() {
        let obj = FloatingObject {
            common: make_common("shape-1", "sheet-1"),
            data: FloatingObjectData::Shape(ShapeData {
                shape_type: "roundRect".to_string(),
                fill: Some(ObjectFill {
                    fill_type: FillType::Solid,
                    color: Some("#ff0000".to_string()),
                    gradient: None,
                    transparency: None,
                    pattern: None,
                    blip: None,
                }),
                outline: Some(ShapeOutline {
                    style: OutlineStyle::Solid,
                    color: "#000000".to_string(),
                    width: 1.5,
                    head_end: None,
                    tail_end: None,
                    dash: None,
                    transparency: None,
                    compound: None,
                    visible: None,
                }),
                text: Some(ShapeText {
                    content: "Hello".to_string(),
                    format: None,
                    runs: None,
                    vertical_align: Some(VerticalAlign::Middle),
                    horizontal_align: None,
                    margins: None,
                    auto_size: None,
                    orientation: None,
                    reading_order: None,
                    horizontal_overflow: None,
                    vertical_overflow: None,
                    text_body: None,
                }),
                shadow: None,
                adjustments: None,
                scene_3d: None,
                sp_3d: None,
                ooxml: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(restored.common.id, "shape-1");
        assert_eq!(restored.object_type(), "shape");
        if let FloatingObjectData::Shape(ref s) = restored.data {
            assert_eq!(s.shape_type, "roundRect");
            assert_eq!(s.fill.as_ref().unwrap().fill_type, FillType::Solid);
        } else {
            panic!("Expected Shape variant");
        }
    }

    #[test]
    fn test_picture_round_trip() {
        let obj = FloatingObject {
            common: make_common("pic-1", "sheet-1"),
            data: FloatingObjectData::Picture(PictureData {
                src: "https://example.com/img.png".to_string(),
                original_width: Some(800.0),
                original_height: Some(600.0),
                crop: Some(PictureCrop {
                    top: 0.1,
                    right: 0.0,
                    bottom: 0.1,
                    left: 0.0,
                }),
                adjustments: None,
                border: None,
                color_type: None,
                ooxml: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "picture");
        if let FloatingObjectData::Picture(ref p) = restored.data {
            assert_eq!(p.src, "https://example.com/img.png");
            assert_eq!(p.original_width, Some(800.0));
        } else {
            panic!("Expected Picture variant");
        }
    }

    #[test]
    fn test_chart_round_trip() {
        let obj = FloatingObject {
            common: make_common("chart-1", "sheet-1"),
            data: FloatingObjectData::Chart(ChartData {
                chart_type: ChartType::Bar,
                sub_type: None,
                series_orientation: None,
                data_range: None,
                data_range_identity: None,
                series_range: None,
                series_range_identity: None,
                category_range: None,
                category_range_identity: None,
                title: None,
                subtitle: None,
                legend: None,
                axis: None,
                colors: None,
                series: Some(vec![]),
                data_labels: None,
                pie_slice: None,
                trendline: None,
                show_lines: None,
                smooth_lines: None,
                radar_filled: None,
                radar_markers: None,
                waterfall: None,
                display_blanks_as: None,
                plot_visible_only: None,
                gap_width: None,
                overlap: None,
                doughnut_hole_size: None,
                first_slice_angle: None,
                bubble_scale: None,
                split_type: None,
                split_value: None,
                category_label_level: None,
                series_name_level: None,
                show_all_field_buttons: None,
                second_plot_size: None,
                vary_by_categories: None,
                title_h_align: None,
                title_v_align: None,
                title_show_shadow: None,
                pivot_options: None,
                bar_shape: None,
                bubble_3d_effect: None,
                wireframe: None,
                surface_top_view: None,
                color_scheme: None,
                height_pt: None,
                width_pt: None,
                left_pt: None,
                top_pt: None,
                style: None,
                rounded_corners: None,
                auto_title_deleted: None,
                show_data_labels_over_max: None,
                chart_format: None,
                plot_format: None,
                title_format: None,
                title_rich_text: None,
                title_formula: None,
                data_table: None,
                view_3d: None,
                floor_format: None,
                side_wall_format: None,
                back_wall_format: None,
                rt: None,
                source_table_id: Some("table-1".to_string()),
                table_data_columns: None,
                table_category_column: None,
                use_table_column_names_as_labels: None,
                table_column_names: None,
                width_cells: Some(8.0),
                height_cells: Some(15.0),
                preserved_chart_xml: None,
                ooxml: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "chart");
        if let FloatingObjectData::Chart(ref c) = restored.data {
            assert_eq!(c.chart_type, ChartType::Bar);
            assert_eq!(c.source_table_id.as_deref(), Some("table-1"));
        } else {
            panic!("Expected Chart variant");
        }
    }

    #[test]
    fn test_connector_round_trip() {
        let obj = FloatingObject {
            common: make_common("conn-1", "sheet-1"),
            data: FloatingObjectData::Connector(ConnectorData {
                shape_type: "straightConnector1".to_string(),
                fill: None,
                outline: Some(ShapeOutline {
                    style: OutlineStyle::Solid,
                    color: "#000".to_string(),
                    width: 1.0,
                    head_end: None,
                    tail_end: Some(LineEnd {
                        end_type: LineEndType::Triangle,
                        width: Some(LineEndSize::Med),
                        length: Some(LineEndSize::Med),
                    }),
                    dash: None,
                    transparency: None,
                    compound: None,
                    visible: None,
                }),
                start_connection: Some(ConnectorBinding {
                    shape_id: "shape-1".to_string(),
                    site_index: 2,
                }),
                end_connection: Some(ConnectorBinding {
                    shape_id: "shape-2".to_string(),
                    site_index: 0,
                }),
                adjustments: None,
                ooxml: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "connector");
        if let FloatingObjectData::Connector(ref c) = restored.data {
            assert_eq!(c.shape_type, "straightConnector1");
            assert_eq!(c.start_connection.as_ref().unwrap().shape_id, "shape-1");
        } else {
            panic!("Expected Connector variant");
        }
    }

    #[test]
    fn test_textbox_round_trip() {
        let obj = FloatingObject {
            common: make_common("tb-1", "sheet-1"),
            data: FloatingObjectData::Textbox(TextboxData {
                text: Some(ShapeText {
                    content: "Hello world".to_string(),
                    format: None,
                    runs: None,
                    vertical_align: Some(VerticalAlign::Top),
                    horizontal_align: None,
                    margins: Some(TextMargins {
                        top: 5.0,
                        right: 5.0,
                        bottom: 5.0,
                        left: 5.0,
                    }),
                    auto_size: None,
                    orientation: None,
                    reading_order: None,
                    horizontal_overflow: None,
                    vertical_overflow: None,
                    text_body: None,
                }),
                fill: None,
                border: None,
                text_effects: None,
                ooxml: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "textbox");
        if let FloatingObjectData::Textbox(ref t) = restored.data {
            assert_eq!(
                t.text.as_ref().map(|t| t.content.as_str()),
                Some("Hello world")
            );
        } else {
            panic!("Expected Textbox variant");
        }
    }

    #[test]
    fn test_equation_round_trip() {
        let obj = FloatingObject {
            common: make_common("eq-1", "sheet-1"),
            data: FloatingObjectData::Equation(EquationData {
                equation: "x^2 + y^2 = r^2".to_string(),
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "equation");
    }

    #[test]
    fn test_diagram_round_trip() {
        let obj = FloatingObject {
            common: make_common("diagram-1", "sheet-1"),
            data: FloatingObjectData::Diagram(DiagramData {
                definition: crate::domain::smartart::SmartArtDefinition {
                    dm_rel_id: Some("rId1".to_string()),
                    ..Default::default()
                },
                category: Some(crate::domain::smartart::SmartArtCategory::Hierarchy),
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "diagram");
    }

    #[test]
    fn test_ole_object_round_trip() {
        let obj = FloatingObject {
            common: make_common("ole-1", "sheet-1"),
            data: FloatingObjectData::OleObject(OleObjectData {
                prog_id: "Word.Document.12".to_string(),
                dv_aspect: "DVASPECT_CONTENT".to_string(),
                is_linked: false,
                is_embedded: true,
                preview_image_src: Some("preview.png".to_string()),
                alt_text: None,
                ooxml: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "oleObject");
    }

    #[test]
    fn test_form_control_round_trip() {
        let obj = FloatingObject {
            common: make_common("fc-1", "sheet-1"),
            data: FloatingObjectData::FormControl(FormControlData {
                control_type: "CheckBox".to_string(),
                cell_link: Some("$A$1".to_string()),
                input_range: None,
                ooxml: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "formControl");
    }

    #[test]
    fn test_camera_round_trip() {
        let obj = FloatingObject {
            common: make_common("cam-1", "sheet-1"),
            data: FloatingObjectData::Camera(CameraData {
                source_ref: "Sheet2!A1:D10".to_string(),
                error: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "camera");
    }

    #[test]
    fn test_drawing_round_trip() {
        let mut strokes = BTreeMap::new();
        strokes.insert(
            "stroke-1".to_string(),
            InkStroke {
                id: "stroke-1".to_string(),
                points: vec![
                    InkPoint {
                        x: 10.0,
                        y: 20.0,
                        pressure: Some(0.5),
                        tilt: None,
                        timestamp: Some(1000.0),
                    },
                    InkPoint {
                        x: 30.0,
                        y: 40.0,
                        pressure: Some(0.7),
                        tilt: None,
                        timestamp: Some(1001.0),
                    },
                ],
                tool: InkTool::Pen,
                color: "#000000".to_string(),
                width: 2.0,
                opacity: 1.0,
                created_by: "user-1".to_string(),
                created_at: 1234567890.0,
            },
        );

        let mut recognitions = BTreeMap::new();
        recognitions.insert(
            "rec-1".to_string(),
            RecognitionResult::Shape {
                shape_type: "rectangle".to_string(),
                params: ShapeRecognitionParams::Rectangle {
                    x: 10.0,
                    y: 20.0,
                    width: 100.0,
                    height: 50.0,
                    rotation: 0.0,
                    corner_radius: None,
                },
                source_stroke_ids: vec!["stroke-1".to_string()],
                confidence: 0.95,
                recognized_at: 1234567891.0,
            },
        );

        let obj = FloatingObject {
            common: make_common("dr-1", "sheet-1"),
            data: FloatingObjectData::Drawing(DrawingData {
                strokes,
                tool_state: InkToolState::default(),
                recognitions,
                background_color: Some("#ffffff".to_string()),
            }),
        };
        let json = serde_json::to_string(&obj).unwrap();
        let restored: FloatingObject = serde_json::from_str(&json).unwrap();
        assert_eq!(obj, restored);
    }

    #[test]
    fn test_flat_json_structure() {
        let obj = FloatingObject {
            common: make_common("shape-flat", "sheet-1"),
            data: FloatingObjectData::Shape(ShapeData {
                shape_type: "rect".to_string(),
                fill: None,
                outline: None,
                text: None,
                shadow: None,
                adjustments: None,
                scene_3d: None,
                sp_3d: None,
                ooxml: None,
            }),
        };
        let json = serde_json::to_value(&obj).unwrap();
        let map = json.as_object().unwrap();

        // Common fields at top level
        assert!(map.contains_key("id"));
        assert!(map.contains_key("sheetId"));
        assert!(map.contains_key("anchor"));
        assert!(map.contains_key("width"));
        assert!(map.contains_key("height"));
        assert!(map.contains_key("zIndex"));

        // Type tag at top level
        assert_eq!(map.get("type").unwrap(), "shape");

        // Data fields at top level
        assert!(map.contains_key("shapeType"));

        // No "common" or "data" wrapper keys
        assert!(!map.contains_key("common"));
        assert!(!map.contains_key("data"));
    }

    #[test]
    fn test_anchor_mode_serialization() {
        assert_eq!(
            serde_json::to_string(&AnchorMode::OneCell).unwrap(),
            r#""oneCell""#
        );
        assert_eq!(
            serde_json::to_string(&AnchorMode::TwoCell).unwrap(),
            r#""twoCell""#
        );
        assert_eq!(
            serde_json::to_string(&AnchorMode::Absolute).unwrap(),
            r#""absolute""#
        );

        let am: AnchorMode = serde_json::from_str(r#""twoCell""#).unwrap();
        assert_eq!(am, AnchorMode::TwoCell);
    }

    #[test]
    fn test_field_name_uniqueness() {
        // Serialize FloatingObjectCommon to get its keys
        let common = make_common("test", "sheet");
        let common_val = serde_json::to_value(&common).unwrap();
        let common_keys: std::collections::HashSet<String> =
            common_val.as_object().unwrap().keys().cloned().collect();

        // Check ShapeData keys don't overlap with common keys (except "type" is only in data)
        let shape = ShapeData {
            shape_type: "rect".to_string(),
            fill: None,
            outline: None,
            text: None,
            shadow: None,
            adjustments: None,
            scene_3d: None,
            sp_3d: None,
            ooxml: None,
        };
        let shape_val = serde_json::to_value(&FloatingObjectData::Shape(shape)).unwrap();
        let shape_keys: std::collections::HashSet<String> = shape_val
            .as_object()
            .unwrap()
            .keys()
            .filter(|k| *k != "type")
            .cloned()
            .collect();
        let overlap: Vec<_> = common_keys.intersection(&shape_keys).collect();
        assert!(
            overlap.is_empty(),
            "Overlapping keys between common and shape: {:?}",
            overlap
        );

        // Check PictureData keys
        let pic = PictureData {
            src: "x".to_string(),
            original_width: None,
            original_height: None,
            crop: None,
            adjustments: None,
            border: None,
            color_type: None,
            ooxml: None,
        };
        let pic_val = serde_json::to_value(&FloatingObjectData::Picture(pic)).unwrap();
        let pic_keys: std::collections::HashSet<String> = pic_val
            .as_object()
            .unwrap()
            .keys()
            .filter(|k| *k != "type")
            .cloned()
            .collect();
        let overlap: Vec<_> = common_keys.intersection(&pic_keys).collect();
        assert!(
            overlap.is_empty(),
            "Overlapping keys between common and picture: {:?}",
            overlap
        );

        // Check ChartData keys
        let chart = ChartData {
            chart_type: ChartType::Bar,
            sub_type: None,
            series_orientation: None,
            data_range: None,
            data_range_identity: None,
            series_range: None,
            series_range_identity: None,
            category_range: None,
            category_range_identity: None,
            title: None,
            subtitle: None,
            legend: None,
            axis: None,
            colors: None,
            series: None,
            data_labels: None,
            pie_slice: None,
            trendline: None,
            show_lines: None,
            smooth_lines: None,
            radar_filled: None,
            radar_markers: None,
            waterfall: None,
            display_blanks_as: None,
            plot_visible_only: None,
            gap_width: None,
            overlap: None,
            doughnut_hole_size: None,
            first_slice_angle: None,
            bubble_scale: None,
            split_type: None,
            split_value: None,
            category_label_level: None,
            series_name_level: None,
            show_all_field_buttons: None,
            second_plot_size: None,
            vary_by_categories: None,
            title_h_align: None,
            title_v_align: None,
            title_show_shadow: None,
            pivot_options: None,
            bar_shape: None,
            bubble_3d_effect: None,
            wireframe: None,
            surface_top_view: None,
            color_scheme: None,
            height_pt: None,
            width_pt: None,
            left_pt: None,
            top_pt: None,
            style: None,
            rounded_corners: None,
            auto_title_deleted: None,
            show_data_labels_over_max: None,
            chart_format: None,
            plot_format: None,
            title_format: None,
            title_rich_text: None,
            title_formula: None,
            data_table: None,
            view_3d: None,
            floor_format: None,
            side_wall_format: None,
            back_wall_format: None,
            rt: None,
            source_table_id: None,
            table_data_columns: None,
            table_category_column: None,
            use_table_column_names_as_labels: None,
            table_column_names: None,
            width_cells: None,
            height_cells: None,
            preserved_chart_xml: None,
            ooxml: None,
        };
        let chart_val = serde_json::to_value(&FloatingObjectData::Chart(chart)).unwrap();
        let chart_keys: std::collections::HashSet<String> = chart_val
            .as_object()
            .unwrap()
            .keys()
            .filter(|k| *k != "type")
            .cloned()
            .collect();
        let overlap: Vec<_> = common_keys.intersection(&chart_keys).collect();
        assert!(
            overlap.is_empty(),
            "Overlapping keys between common and chart: {:?}",
            overlap
        );

        // Check ConnectorData keys
        let conn = ConnectorData {
            shape_type: "x".to_string(),
            fill: None,
            outline: None,
            start_connection: None,
            end_connection: None,
            adjustments: None,
            ooxml: None,
        };
        let conn_val = serde_json::to_value(&FloatingObjectData::Connector(conn)).unwrap();
        let conn_keys: std::collections::HashSet<String> = conn_val
            .as_object()
            .unwrap()
            .keys()
            .filter(|k| *k != "type")
            .cloned()
            .collect();
        let overlap: Vec<_> = common_keys.intersection(&conn_keys).collect();
        assert!(
            overlap.is_empty(),
            "Overlapping keys between common and connector: {:?}",
            overlap
        );
    }

    #[test]
    fn test_sub_types_match_snapshot_types() {
        // ObjectFill round-trip
        let json = r##"{"type":"solid","color":"#4285f4"}"##;
        let fill: ObjectFill = serde_json::from_str(json).unwrap();
        assert_eq!(fill.fill_type, FillType::Solid);
        assert_eq!(fill.color.as_deref(), Some("#4285f4"));
        let back = serde_json::to_string(&fill).unwrap();
        assert_eq!(back, json);

        // GradientFill round-trip
        let json = r##"{"type":"linear","stops":[{"offset":0.0,"color":"#ff0000"},{"offset":1.0,"color":"#0000ff"}],"angle":90.0}"##;
        let gf: GradientFill = serde_json::from_str(json).unwrap();
        assert_eq!(gf.gradient_type, GradientType::Linear);
        assert_eq!(gf.stops.len(), 2);
        let back = serde_json::to_string(&gf).unwrap();
        assert_eq!(back, json);

        // ShapeOutline round-trip
        let json = r##"{"style":"solid","color":"#000000","width":1.5}"##;
        let outline: ShapeOutline = serde_json::from_str(json).unwrap();
        assert_eq!(outline.style, OutlineStyle::Solid);
        let back = serde_json::to_string(&outline).unwrap();
        assert_eq!(back, json);

        // LineEnd round-trip
        let json = r#"{"type":"triangle","width":"sm","length":"lg"}"#;
        let le: LineEnd = serde_json::from_str(json).unwrap();
        assert_eq!(le.end_type, LineEndType::Triangle);
        let back = serde_json::to_string(&le).unwrap();
        assert_eq!(back, json);

        // ShapeText round-trip
        let json = r#"{"content":"Hello","verticalAlign":"middle"}"#;
        let text: ShapeText = serde_json::from_str(json).unwrap();
        assert_eq!(text.content, "Hello");
        let back = serde_json::to_string(&text).unwrap();
        assert_eq!(back, json);

        // OuterShadowEffect round-trip
        let json = r##"{"blurRadius":40000.0,"distance":20000.0,"direction":315.0,"color":"#000000","opacity":0.4}"##;
        let shadow: OuterShadowEffect = serde_json::from_str(json).unwrap();
        assert!((shadow.blur_radius - 40000.0).abs() < f64::EPSILON);
        let back = serde_json::to_string(&shadow).unwrap();
        assert_eq!(back, json);

        // ConnectorBinding round-trip
        let json = r#"{"shapeId":"shape-1","siteIndex":2}"#;
        let cb: ConnectorBinding = serde_json::from_str(json).unwrap();
        assert_eq!(cb.shape_id, "shape-1");
        let back = serde_json::to_string(&cb).unwrap();
        assert_eq!(back, json);

        // ShadowAlignment round-trip
        let sa: ShadowAlignment = serde_json::from_str(r#""ctr""#).unwrap();
        assert_eq!(sa, ShadowAlignment::Center);
        assert_eq!(
            serde_json::to_string(&ShadowAlignment::BottomRight).unwrap(),
            r#""br""#
        );
    }

    #[test]
    fn test_slicer_round_trip() {
        let obj = FloatingObject {
            common: make_common("slicer-1", "sheet-1"),
            data: FloatingObjectData::Slicer(SlicerData::default()),
        };
        let json = serde_json::to_value(&obj).unwrap();
        // Verify the type tag is "slicer"
        assert_eq!(json.get("type").unwrap(), "slicer");
        let restored: FloatingObject = serde_json::from_value(json).unwrap();
        assert_eq!(restored.object_type(), "slicer");
        assert_eq!(restored.common.id, "slicer-1");
        assert!(matches!(restored.data, FloatingObjectData::Slicer(_)));
        // Verify round-trip stability
        let restored2: FloatingObject =
            serde_json::from_value(serde_json::to_value(&restored).unwrap()).unwrap();
        assert_eq!(restored, restored2);
    }

    #[test]
    fn test_drawing_data_serde_round_trip() {
        let mut strokes = BTreeMap::new();
        strokes.insert(
            "s1".to_string(),
            InkStroke {
                id: "s1".to_string(),
                points: vec![
                    InkPoint {
                        x: 0.0,
                        y: 0.0,
                        pressure: None,
                        tilt: None,
                        timestamp: None,
                    },
                    InkPoint {
                        x: 10.0,
                        y: 10.0,
                        pressure: Some(0.5),
                        tilt: Some(45.0),
                        timestamp: Some(100.0),
                    },
                ],
                tool: InkTool::Highlighter,
                color: "#ff0000".to_string(),
                width: 5.0,
                opacity: 0.5,
                created_by: "user-a".to_string(),
                created_at: 999.0,
            },
        );

        let mut recognitions = BTreeMap::new();
        recognitions.insert(
            "r1".to_string(),
            RecognitionResult::Text {
                text: "Hello".to_string(),
                alternatives: vec![TextAlternative {
                    text: "Hello".to_string(),
                    confidence: 0.99,
                }],
                source_stroke_ids: vec!["s1".to_string()],
                bounds: RecognitionBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 50.0,
                    height: 20.0,
                },
                recognized_at: 1000.0,
            },
        );

        let data = DrawingData {
            strokes,
            tool_state: InkToolState {
                active_tool: InkTool::Highlighter,
                tool_settings: {
                    let mut m = BTreeMap::new();
                    m.insert(
                        "highlighter".to_string(),
                        InkToolSettings {
                            width: 5.0,
                            opacity: 0.5,
                            color: "#ff0000".to_string(),
                            supports_pressure: false,
                        },
                    );
                    m
                },
            },
            recognitions,
            background_color: Some("#eee".to_string()),
        };

        let json = serde_json::to_string_pretty(&data).unwrap();
        let restored: DrawingData = serde_json::from_str(&json).unwrap();
        assert_eq!(data, restored);
    }

    #[test]
    fn test_drawing_data_default() {
        let data = DrawingData::default();
        assert!(data.strokes.is_empty());
        assert!(data.recognitions.is_empty());
        assert_eq!(data.tool_state.active_tool, InkTool::Pen);
        assert!(data.background_color.is_none());

        // Default should round-trip through JSON
        let json = serde_json::to_string(&data).unwrap();
        let restored: DrawingData = serde_json::from_str(&json).unwrap();
        assert_eq!(data, restored);
    }

    // ── Typed-struct serde round-trip tests ─────────────────────

    #[test]
    fn test_shape_text_cellformat_roundtrip() {
        use crate::CellFormat;

        let st = ShapeText {
            content: "Bold text".to_string(),
            format: Some(CellFormat {
                bold: Some(true),
                italic: Some(false),
                font_family: Some("Calibri".to_string()),
                ..Default::default()
            }),
            runs: None,
            vertical_align: Some(VerticalAlign::Middle),
            horizontal_align: None,
            margins: None,
            auto_size: None,
            orientation: None,
            reading_order: None,
            horizontal_overflow: None,
            vertical_overflow: None,
            text_body: None,
        };
        let json = serde_json::to_string(&st).unwrap();
        let restored: ShapeText = serde_json::from_str(&json).unwrap();
        assert_eq!(st, restored);
        assert_eq!(restored.format.as_ref().unwrap().bold, Some(true));
        assert_eq!(
            restored.format.as_ref().unwrap().font_family.as_deref(),
            Some("Calibri"),
        );
    }

    #[test]
    fn test_textbox_text_effects_config_roundtrip() {
        use crate::domain::text_effects::{
            LineDash, TextEffectConfig, TextEffectFill, TextEffectOutline, TextWarpPreset,
        };

        let tb = TextboxData {
            text: Some(ShapeText {
                content: "Art".to_string(),
                format: None,
                runs: None,
                vertical_align: None,
                horizontal_align: None,
                margins: None,
                auto_size: None,
                orientation: None,
                reading_order: None,
                horizontal_overflow: None,
                vertical_overflow: None,
                text_body: None,
            }),
            fill: None,
            border: None,
            text_effects: Some(TextEffectConfig {
                warp_preset: TextWarpPreset::TextArchUp,
                warp_adjustments: None,
                fill: TextEffectFill::Solid {
                    color: "#ff0000".to_string(),
                    opacity: Some(0.9),
                },
                outline: Some(TextEffectOutline {
                    width: 2.0,
                    color: "#000000".to_string(),
                    opacity: None,
                    dash: Some(LineDash::Solid),
                    cap: None,
                    join: None,
                    miter_limit: None,
                    compound: None,
                }),
                effects: None,
                follow_path: Some(true),
                anchor: None,
                text_direction: None,
                normalize_heights: None,
            }),
            ooxml: None,
        };
        let json = serde_json::to_string(&tb).unwrap();
        let restored: TextboxData = serde_json::from_str(&json).unwrap();
        assert_eq!(tb, restored);

        // Verify nested discriminated-union tag survives round-trip
        let val: serde_json::Value = serde_json::from_str(&json).unwrap();
        let text_effects = val.get("textEffects").unwrap();
        assert_eq!(text_effects["fill"]["type"], "solid");
        assert_eq!(text_effects["warpPreset"], "textArchUp");
    }

    #[test]
    fn test_diagram_definition_roundtrip() {
        use crate::domain::smartart::{SmartArtCategory, SmartArtDefinition};

        let diagram = DiagramData {
            definition: SmartArtDefinition {
                original_id: Some(42),
                dm_rel_id: Some("rId1".to_string()),
                lo_rel_id: Some("rId2".to_string()),
                qs_rel_id: None,
                cs_rel_id: None,
                data_xml: Some("<dgm:dataModel/>".to_string()),
                layout_xml: None,
                colors_xml: None,
                style_xml: None,
                drawing_xml: None,
            },
            category: Some(SmartArtCategory::Hierarchy),
        };
        let json = serde_json::to_string(&diagram).unwrap();
        let restored: DiagramData = serde_json::from_str(&json).unwrap();
        assert_eq!(diagram, restored);
        assert_eq!(restored.definition.dm_rel_id.as_deref(), Some("rId1"));
        assert_eq!(restored.definition.original_id, Some(42));
        assert_eq!(restored.category, Some(SmartArtCategory::Hierarchy));
    }

    #[test]
    fn test_diagram_data_roundtrip_with_category() {
        let json = r#"{"definition": {"dmRelId": "rId1", "loRelId": "rId2", "dataXml": "<dgm:dataModel/>"}, "category": "hierarchy"}"#;
        let diagram: DiagramData = serde_json::from_str(json).unwrap();

        assert_eq!(
            diagram.category,
            Some(crate::domain::smartart::SmartArtCategory::Hierarchy),
        );
        assert_eq!(diagram.definition.dm_rel_id.as_deref(), Some("rId1"));
        assert_eq!(diagram.definition.lo_rel_id.as_deref(), Some("rId2"));
        assert_eq!(
            diagram.definition.data_xml.as_deref(),
            Some("<dgm:dataModel/>"),
        );
        assert_eq!(diagram.definition.qs_rel_id, None);
        assert_eq!(diagram.definition.original_id, None);
    }

    #[test]
    fn test_smartart_definition_default_serializes_empty() {
        let def = crate::domain::smartart::SmartArtDefinition::default();
        let json = serde_json::to_string(&def).unwrap();
        assert_eq!(json, "{}");
    }
}

// ===========================================================================
// SECTION: Shape Type Enum (OOXML preset geometries)
// ===========================================================================

/// All supported shape presets.
///
/// Variants serialize to camelCase strings matching the OOXML preset geometry
/// names used by the TypeScript layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ShapeType {
    // ── Basic shapes ────────────────────────────────────────────────────
    Rect,
    RoundRect,
    Ellipse,
    Triangle,
    RtTriangle,
    Diamond,
    Pentagon,
    Hexagon,
    Octagon,
    Parallelogram,
    Trapezoid,
    NonIsoscelesTrapezoid,
    Heptagon,
    Decagon,
    Dodecagon,
    Teardrop,
    Pie,
    PieWedge,
    BlockArc,
    Donut,
    NoSmoking,
    Plaque,

    // ── Rectangle variants ──────────────────────────────────────────────
    Round1Rect,
    Round2SameRect,
    Round2DiagRect,
    Snip1Rect,
    Snip2SameRect,
    Snip2DiagRect,
    SnipRoundRect,

    // ── Arrows ──────────────────────────────────────────────────────────
    RightArrow,
    LeftArrow,
    UpArrow,
    DownArrow,
    LeftRightArrow,
    UpDownArrow,
    QuadArrow,
    Chevron,

    // ── Arrow Callouts ──────────────────────────────────────────────────
    LeftArrowCallout,
    RightArrowCallout,
    UpArrowCallout,
    DownArrowCallout,
    LeftRightArrowCallout,
    UpDownArrowCallout,
    QuadArrowCallout,

    // ── Curved / Special Arrows ─────────────────────────────────────────
    BentArrow,
    UturnArrow,
    CircularArrow,
    LeftCircularArrow,
    LeftRightCircularArrow,
    CurvedRightArrow,
    CurvedLeftArrow,
    CurvedUpArrow,
    CurvedDownArrow,
    SwooshArrow,

    // ── Stars and banners ───────────────────────────────────────────────
    Star4,
    Star5,
    Star6,
    Star7,
    Star8,
    Star10,
    Star12,
    Star16,
    Star24,
    Star32,
    Ribbon,
    Ribbon2,
    EllipseRibbon,
    EllipseRibbon2,
    LeftRightRibbon,
    Banner,

    // ── Callouts ────────────────────────────────────────────────────────
    WedgeRectCallout,
    WedgeRoundRectCallout,
    WedgeEllipseCallout,
    Cloud,
    Callout1,
    Callout2,
    Callout3,
    BorderCallout1,
    BorderCallout2,
    BorderCallout3,
    AccentCallout1,
    AccentCallout2,
    AccentCallout3,
    AccentBorderCallout1,
    AccentBorderCallout2,
    AccentBorderCallout3,

    // ── Lines and connectors ────────────────────────────────────────────
    Line,
    LineArrow,
    LineDoubleArrow,
    Curve,
    Arc,
    Connector,
    BentConnector2,
    BentConnector3,
    BentConnector4,
    BentConnector5,
    CurvedConnector2,
    CurvedConnector3,
    CurvedConnector4,
    CurvedConnector5,

    // ── Flowchart ───────────────────────────────────────────────────────
    FlowChartProcess,
    FlowChartDecision,
    FlowChartInputOutput,
    FlowChartPredefinedProcess,
    FlowChartInternalStorage,
    FlowChartDocument,
    FlowChartMultidocument,
    FlowChartTerminator,
    FlowChartPreparation,
    FlowChartManualInput,
    FlowChartManualOperation,
    FlowChartConnector,
    FlowChartPunchedCard,
    FlowChartPunchedTape,
    FlowChartSummingJunction,
    FlowChartOr,
    FlowChartCollate,
    FlowChartSort,
    FlowChartExtract,
    FlowChartMerge,
    FlowChartOfflineStorage,
    FlowChartOnlineStorage,
    FlowChartMagneticTape,
    FlowChartMagneticDisk,
    FlowChartMagneticDrum,
    FlowChartDisplay,
    FlowChartDelay,
    FlowChartAlternateProcess,
    FlowChartOffpageConnector,

    // ── Decorative symbols ──────────────────────────────────────────────
    Heart,
    LightningBolt,
    Sun,
    Moon,
    SmileyFace,
    FoldedCorner,
    Bevel,
    Frame,
    HalfFrame,
    Corner,
    DiagStripe,
    Chord,
    Can,
    Cube,
    Plus,
    Cross,
    IrregularSeal1,
    IrregularSeal2,
    HomePlate,
    Funnel,
    VerticalScroll,
    HorizontalScroll,

    // ── Action Buttons ──────────────────────────────────────────────────
    ActionButtonBlank,
    ActionButtonHome,
    ActionButtonHelp,
    ActionButtonInformation,
    ActionButtonForwardNext,
    ActionButtonBackPrevious,
    ActionButtonEnd,
    ActionButtonBeginning,
    ActionButtonReturn,
    ActionButtonDocument,
    ActionButtonSound,
    ActionButtonMovie,

    // ── Brackets and Braces ─────────────────────────────────────────────
    LeftBracket,
    RightBracket,
    LeftBrace,
    RightBrace,
    BracketPair,
    BracePair,

    // ── Math shapes ─────────────────────────────────────────────────────
    MathPlus,
    MathMinus,
    MathMultiply,
    MathDivide,
    MathEqual,
    MathNotEqual,

    // ── Miscellaneous ───────────────────────────────────────────────────
    Gear6,
    Gear9,
    CornerTabs,
    SquareTabs,
    PlaqueTabs,
    ChartX,
    ChartStar,
    ChartPlus,
}
