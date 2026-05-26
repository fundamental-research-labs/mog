//! Chart style and color auxiliary file types (Office 2013+ chart formatting).
//!
//! These represent the chart-level style and color definitions stored in
//! separate XML files (chartStyleN.xml, chartColorsN.xml) linked via
//! chart relationship parts.

use crate::drawings::{DrawingColor, RunProperties, ShapeProperties, TextBody};

/// Chart color style definition (chartColorsN.xml root element).
///
/// Defines the color palette used for auto-coloring chart series.
/// When a series doesn't have explicit spPr, colors cycle from this palette.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartColorStyle {
    /// Color style method: "cycle", "withinLinear", "withinLinearReversed", "acrossLinear", "acrossLinearReversed"
    pub meth: String,
    /// Color style ID
    pub id: u32,
    /// Color variations in the palette
    pub variations: Vec<ColorVariation>,
}

/// A single color variation entry in the chart color palette.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorVariation {
    /// Base color
    pub color: Option<DrawingColor>,
    /// Tint/shade/saturation modifiers applied to the base
    pub transforms: Vec<ColorTransform>,
}

/// Color transform applied to a variation.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ColorTransform {
    Tint(u32), // percentage (0-100000)
    Shade(u32),
    SatMod(u32),
    LumMod(u32),
    LumOff(u32),
    Alpha(u32),
}

/// Chart style sheet definition (chartStyleN.xml root element).
///
/// Defines per-element-type formatting for chart elements.
/// Each entry maps to a chart element kind (title, legend, series, axis, etc.)
/// and provides default ShapeProperties, TextBody, and line formatting.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartStyleSheet {
    /// Style sheet ID
    pub id: u32,
    /// Style entries for different chart element types
    pub entries: Vec<ChartStyleEntry>,
}

/// Individual style entry for a chart element type.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartStyleEntry {
    /// Element type this entry applies to (e.g., "dataPoint", "dataPointLine",
    /// "dataPointMarker", "dataPointWireframe", "dataPointFill", "dataPoint3D",
    /// "bandedRange", "dataPointMarkerLayout", "axisTitle", "categoryAxis",
    /// "chartArea", "dataLabel", "dataLabelCallout", "dataTable", "downBar",
    /// "dropLine", "errorBar", "floor", "gridlineMajor", "gridlineMinor",
    /// "hiLoLine", "leaderLine", "legend", "plotArea", "plotArea3D",
    /// "seriesAxis", "seriesLine", "title", "trendline", "trendlineLabel",
    /// "upBar", "valueAxis", "wall")
    pub mso_element_type: String,
    /// Shape properties (fill, outline, effects)
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties
    pub body_pr: Option<TextBody>,
    /// Default text run properties
    pub def_rpr: Option<RunProperties>,
    /// Line reference (style matrix index)
    pub ln_ref: Option<StyleReference>,
    /// Fill reference (style matrix index)
    pub fill_ref: Option<StyleReference>,
    /// Effect reference (style matrix index)
    pub effect_ref: Option<StyleReference>,
    /// Font reference
    pub font_ref: Option<FontStyleReference>,
}

/// Style matrix reference (idx + optional color override).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StyleReference {
    /// Style matrix index
    pub idx: u32,
    /// Optional color override
    pub color: Option<DrawingColor>,
}

/// Font style reference.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FontStyleReference {
    /// Font index ("minor" or "major")
    pub idx: String,
    /// Optional color override
    pub color: Option<DrawingColor>,
}

/// Raw extension entry for forward-compatible round-tripping.
///
/// Stores the inner XML of `<c:ext>` elements within `<c:extLst>` blocks.
/// Structured enough to re-emit during serialization, but the content
/// is opaque (not further parsed) until specific extensions are needed.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ExtensionEntry {
    /// Extension URI (e.g., "{C3380CC4-5D6E-409C-BE32-E72D297353CC}")
    pub uri: String,
    /// Raw inner XML content of the <c:ext> element
    pub xml: String,
}
