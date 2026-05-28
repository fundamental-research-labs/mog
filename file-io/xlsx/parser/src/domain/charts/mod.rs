//! Charts parser for XLSX chart definitions
//!
//! This module parses chart XML parts (xl/charts/chartN.xml) using the
//! DrawingML chart schema (dml-chart.xsd, ECMA-376 Part 1, Section 21).
//!
//! # OOXML Chart Structure
//!
//! Charts are stored in separate XML files within the XLSX archive:
//! - `/xl/charts/chartN.xml` - Chart definition
//! - `/xl/drawings/drawingN.xml` - Drawing anchor (position)
//!
//! The chart XML uses the `c:` namespace prefix for chart elements.
//!
//! # Supported Chart Types
//!
//! - Bar and Column charts (clustered, stacked, 100% stacked)
//! - Line charts (straight, smooth)
//! - Pie and Doughnut charts
//! - Area charts (stacked, 100% stacked)
//! - Scatter and Bubble charts
//! - Radar charts
//! - Surface charts (3D)
//! - Stock charts (HLC, OHLC)
//! - Combo charts (multiple types combined)

pub mod axes;
pub mod chart_ex;
pub mod model;
pub mod parse;
pub mod read;
pub mod reconstruct;
pub mod series;
pub mod types;
pub mod write_canonical;
mod xml_helpers;

pub use axes::*;
pub use model::*;
pub use series::*;
pub use types::*;

// Re-export chart-level types from ooxml-types.
// Note: types also re-exported by submodules (axes, series, types) are NOT duplicated here —
// they reach `charts::` via `pub use axes::*` / `pub use series::*` / `pub use types::*`.
pub use ooxml_types::charts::{
    AnchorType, Area3DChartConfig, AreaChartConfig, Bar3DChartConfig, BarChartConfig,
    BubbleChartConfig, ChartProtection, ChartSurface, ChartTypeConfig, DataTableConfig,
    DisplayBlanksAs, DoughnutChartConfig, ExternalData, LegendPosition, Line3DChartConfig,
    LineChartConfig, OfPieChartConfig, OfPieType, PageMargins, PageSetup, PrintSettings,
    RadarChartConfig, ScatterChartConfig, ShapeProperties, SizeRepresents, SplitType,
    StockChartConfig, SurfaceChartConfig, TextBody, UpDownBars, View3D,
};

// Re-export chart document model types from ooxml-types.
pub use ooxml_types::charts::{Legend, LegendEntry, Title, TitleText};

// ChartTitle, Legend, LegendEntry — now imported from ooxml_types::charts

// =============================================================================
// Title text extraction helper
// =============================================================================

/// Extract plain text from a chart `Title`.
///
/// This is the chart-level equivalent of `axes::extract_title_text`. It delegates
/// to the same logic: for `TitleText::Rich`, concatenate all text runs; for
/// `TitleText::StrRef`, return the first cached value.
pub fn extract_chart_title_text(title: &Title) -> Option<String> {
    axes::extract_title_text(title)
}

// =============================================================================
// Shape Properties & Text Body Parsing (module-level helpers)
// =============================================================================

/// Parse `<c:spPr>` (or `<a:spPr>`) shape properties from XML bytes.
/// Delegates to the complete drawings module parser which handles:
/// - All fill types (solid, gradient, pattern, blip) with full color transforms
/// - Complete outline parsing (width, cap, compound, join, head/tail ends)
/// - Transform 2D, preset geometry, effect lists, 3D properties, extLst
pub fn parse_shape_properties(xml: &[u8]) -> ShapeProperties {
    crate::domain::drawings::parse_shape_properties(xml)
}

/// Parse `<c:txPr>` or `<c:rich>` text body from XML bytes.
/// Delegates to the complete drawings module parser which handles:
/// - Full body properties (insets, overflow, autofit, text warp, etc.)
/// - Complete paragraph properties (alignment, spacing, bullets, tabs, etc.)
/// - Full run properties (underline, strikethrough, kerning, spacing, baseline,
///   caps, highlight, hyperlinks, text outline, text fill, etc.)
/// - Line breaks, text fields, and list styles
pub fn parse_text_body(xml: &[u8]) -> TextBody {
    crate::domain::drawings::parse_text_body(xml).unwrap_or_default()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests;
