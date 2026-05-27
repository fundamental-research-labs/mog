use serde::{Deserialize, Serialize};

use crate::CellFormat;
use crate::domain::text_effects::LineDash;

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
    pub text_body: Option<crate::domain::drawings::TextBody>,
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
