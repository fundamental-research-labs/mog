mod axis;
mod data_table;
mod formatting;
mod labels;
mod legend;
mod position;
mod ooxml_mirror_types;
mod series;
mod spec;
mod view_3d;

#[cfg(test)]
mod tests;

pub use axis::*;
pub use data_table::*;
pub use formatting::*;
pub use labels::*;
pub use legend::*;
pub use position::*;
pub use ooxml_mirror_types::*;
pub use series::*;
pub use spec::*;
pub use view_3d::*;

use serde::{Deserialize, Serialize};

use super::floating_object;

/// Typed chart definition for lossless round-trip — wraps the OOXML chart model directly
/// instead of going through JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "_kind")]
// The chart domain contract deliberately preserves the direct OOXML payloads.
// Boxing here would make allocation policy part of the shared API shape.
#[allow(clippy::large_enum_variant)]
pub enum ChartDefinition {
    /// Standard chart (c:chartSpace).
    #[serde(rename = "chart")]
    Chart(ooxml_types::charts::ChartSpace),
    /// Extended chart (cx:chartSpace).
    #[serde(rename = "chartEx")]
    ChartEx(ooxml_types::chart_ex::ChartExSpace),
}

/// Chart type discriminator.
///
/// Serializes as a plain JSON string. Known variants map to fixed strings;
/// `Unknown(String)` preserves the original value for lossless round-trip
/// (e.g. `"histogram"` round-trips as `"histogram"`, not discarded).
///
/// This enum is a strict superset of `ooxml_types::charts::ChartType`:
/// every OOXML read-side chart-type variant (including 3-D variants
/// and `ofPie`) has a direct mapping here. It also covers the ChartEx
/// (cx:chartSpace) chart types not yet handled by the parser's OOXML
/// enum (waterfall, treemap, sunburst, funnel, regionMap).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ChartType {
    #[default]
    Bar,
    Bar3D,
    Column,
    Line,
    Line3D,
    Pie,
    Pie3D,
    Doughnut,
    Scatter,
    Area,
    Area3D,
    Radar,
    Waterfall,
    Treemap,
    Sunburst,
    Funnel,
    Combo,
    Bubble,
    Stock,
    Surface,
    Surface3D,
    /// Of-pie chart (pie of pie / bar of pie).
    OfPie,
    RegionMap,
    /// Fallback — preserves the original string for round-trip fidelity.
    ///
    /// Holds the OOXML element name token (e.g. `"histogramChart"`,
    /// `"paretoChart"`) so it can be re-emitted verbatim on write. This
    /// variant is also how non-standard `@chartType` attribute values
    /// (Google Sheets' `raw_chart_type_attr` pattern) round-trip — the
    /// value is stored here on parse and emitted back on write.
    Unknown(String),
}

impl Serialize for ChartType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ChartType {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Ok(ChartType::from_str(&s))
    }
}

impl ChartType {
    /// Return the string representation (for Yrs storage and other non-serde contexts).
    pub fn as_str(&self) -> &str {
        match self {
            ChartType::Bar => "bar",
            ChartType::Bar3D => "bar3D",
            ChartType::Column => "column",
            ChartType::Line => "line",
            ChartType::Line3D => "line3D",
            ChartType::Pie => "pie",
            ChartType::Pie3D => "pie3D",
            ChartType::Doughnut => "doughnut",
            ChartType::Scatter => "scatter",
            ChartType::Area => "area",
            ChartType::Area3D => "area3D",
            ChartType::Radar => "radar",
            ChartType::Waterfall => "waterfall",
            ChartType::Treemap => "treemap",
            ChartType::Sunburst => "sunburst",
            ChartType::Funnel => "funnel",
            ChartType::Combo => "combo",
            ChartType::Bubble => "bubble",
            ChartType::Stock => "stock",
            ChartType::Surface => "surface",
            ChartType::Surface3D => "surface3D",
            ChartType::OfPie => "ofPie",
            ChartType::RegionMap => "regionMap",
            ChartType::Unknown(s) => s.as_str(),
        }
    }

    /// Parse from string, returning the known variant or `Unknown`.
    ///
    /// Accepts both the canonical camelCase form (`"bar3D"`) and the
    /// legacy lowercase-d form (`"bar3d"`) that the TS bridge historically
    /// emitted; both round-trip to the same variant.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "bar" => ChartType::Bar,
            "bar3D" | "bar3d" => ChartType::Bar3D,
            "column" => ChartType::Column,
            // Legacy 3-D column string from the TS bridge maps to Bar3D
            // (OOXML has no "column" chart type — it's `Bar` with `bar_dir=col`).
            "column3d" | "column3D" => ChartType::Bar3D,
            "line" => ChartType::Line,
            "line3D" | "line3d" => ChartType::Line3D,
            "pie" => ChartType::Pie,
            "pie3D" | "pie3d" => ChartType::Pie3D,
            "doughnut" => ChartType::Doughnut,
            "scatter" => ChartType::Scatter,
            "area" => ChartType::Area,
            "area3D" | "area3d" => ChartType::Area3D,
            "radar" => ChartType::Radar,
            "waterfall" => ChartType::Waterfall,
            "treemap" => ChartType::Treemap,
            "sunburst" => ChartType::Sunburst,
            "funnel" => ChartType::Funnel,
            "combo" => ChartType::Combo,
            "bubble" => ChartType::Bubble,
            "stock" => ChartType::Stock,
            "surface" => ChartType::Surface,
            "surface3D" | "surface3d" => ChartType::Surface3D,
            "ofPie" => ChartType::OfPie,
            "regionMap" => ChartType::RegionMap,
            other => ChartType::Unknown(other.to_string()),
        }
    }

    /// Convert from the OOXML chart-type enum. `OoxmlChartType::Unknown`
    /// becomes `ChartType::Unknown(String::new())` — callers that carry a
    /// raw attribute value (e.g. Google Sheets' `@chartType="comboChart"`)
    /// should use [`ChartType::from_str`] with the raw attribute instead.
    pub fn from_ooxml(ct: ooxml_types::charts::ChartType) -> Self {
        use ooxml_types::charts::ChartType as Oct;
        match ct {
            Oct::Unknown => ChartType::Unknown(String::new()),
            Oct::Bar => ChartType::Bar,
            Oct::Bar3D => ChartType::Bar3D,
            Oct::Line => ChartType::Line,
            Oct::Line3D => ChartType::Line3D,
            Oct::Pie => ChartType::Pie,
            Oct::Pie3D => ChartType::Pie3D,
            Oct::Doughnut => ChartType::Doughnut,
            Oct::Area => ChartType::Area,
            Oct::Area3D => ChartType::Area3D,
            Oct::Scatter => ChartType::Scatter,
            Oct::Bubble => ChartType::Bubble,
            Oct::Radar => ChartType::Radar,
            Oct::Surface => ChartType::Surface,
            Oct::Surface3D => ChartType::Surface3D,
            Oct::Stock => ChartType::Stock,
            Oct::OfPie => ChartType::OfPie,
            Oct::Combo => ChartType::Combo,
        }
    }

    /// Convert to the OOXML chart-type enum. Variants that don't have a
    /// direct OOXML mapping (ChartEx-only types — waterfall/treemap/
    /// sunburst/funnel/regionMap, plus `Column` which OOXML expresses via
    /// `Bar` + `BarDirection`, and `Unknown` which carries its own token)
    /// map to `OoxmlChartType::Unknown`.
    pub fn to_ooxml(&self) -> ooxml_types::charts::ChartType {
        use ooxml_types::charts::ChartType as Oct;
        match self {
            ChartType::Bar | ChartType::Column => Oct::Bar,
            ChartType::Bar3D => Oct::Bar3D,
            ChartType::Line => Oct::Line,
            ChartType::Line3D => Oct::Line3D,
            ChartType::Pie => Oct::Pie,
            ChartType::Pie3D => Oct::Pie3D,
            ChartType::Doughnut => Oct::Doughnut,
            ChartType::Area => Oct::Area,
            ChartType::Area3D => Oct::Area3D,
            ChartType::Scatter => Oct::Scatter,
            ChartType::Bubble => Oct::Bubble,
            ChartType::Radar => Oct::Radar,
            ChartType::Surface => Oct::Surface,
            ChartType::Surface3D => Oct::Surface3D,
            ChartType::Stock => Oct::Stock,
            ChartType::OfPie => Oct::OfPie,
            ChartType::Combo => Oct::Combo,
            ChartType::Waterfall
            | ChartType::Treemap
            | ChartType::Sunburst
            | ChartType::Funnel
            | ChartType::RegionMap
            | ChartType::Unknown(_) => Oct::Unknown,
        }
    }
}

/// Chart sub-type (stacking/grouping variant).
/// Same `Unknown(String)` pattern as `ChartType` for round-trip safety.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChartSubType {
    Clustered,
    Stacked,
    PercentStacked,
    Smooth,
    SmoothMarkers,
    Markers,
    MarkersStacked,
    MarkersPercentStacked,
    /// Fallback — preserves the original string for round-trip fidelity.
    Unknown(String),
}

impl Serialize for ChartSubType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ChartSubType {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Ok(ChartSubType::from_str(&s))
    }
}

impl ChartSubType {
    /// Return the string representation (for Yrs storage and other non-serde contexts).
    pub fn as_str(&self) -> &str {
        match self {
            ChartSubType::Clustered => "clustered",
            ChartSubType::Stacked => "stacked",
            ChartSubType::PercentStacked => "percentStacked",
            ChartSubType::Smooth => "smooth",
            ChartSubType::SmoothMarkers => "smoothMarkers",
            ChartSubType::Markers => "markers",
            ChartSubType::MarkersStacked => "markersStacked",
            ChartSubType::MarkersPercentStacked => "markersPercentStacked",
            ChartSubType::Unknown(s) => s.as_str(),
        }
    }

    /// Parse from string, returning the known variant or `Unknown`.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "clustered" => ChartSubType::Clustered,
            "stacked" => ChartSubType::Stacked,
            "percentStacked" => ChartSubType::PercentStacked,
            "smooth" => ChartSubType::Smooth,
            "smoothMarkers" => ChartSubType::SmoothMarkers,
            "markers" => ChartSubType::Markers,
            "markersStacked" => ChartSubType::MarkersStacked,
            "markersPercentStacked" => ChartSubType::MarkersPercentStacked,
            other => ChartSubType::Unknown(other.to_string()),
        }
    }
}

/// Data series orientation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SeriesOrientation {
    Rows,
    Columns,
}

impl SeriesOrientation {
    /// Return the string representation (for Yrs storage and other non-serde contexts).
    pub fn as_str(&self) -> &str {
        match self {
            SeriesOrientation::Rows => "rows",
            SeriesOrientation::Columns => "columns",
        }
    }
}

/// Chart-owned relationship metadata.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartRelationshipData {
    pub r_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relationship_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
}

/// Metadata for reconstructing a ChartGroup during export.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartGroupMeta {
    /// Chart type discriminant. Non-standard `@chartType` attribute values
    /// (e.g. Google Sheets' `"comboChart"`) land as `ChartType::Unknown(s)`
    /// so they re-emit verbatim on write — no separate `raw_chart_type_attr`
    /// sidecar is needed (inventory rows 2.13 + 2.21).
    pub chart_type: ChartType,
    /// Chart-type-specific configuration template (CT_*Chart). Lifted off
    /// `ooxml_types::charts::ChartTypeConfig` in favour of the domain-owned
    /// `ChartTypeConfig`; the outer discriminant is
    /// typed; inner per-variant deep config is carried opaquely pending the
    /// broader chart elevation.
    pub config_template: ChartTypeConfig,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ax_ids: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub series_indices: Vec<u32>,
}

/// Legend entry override (show/hide individual entries).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegendEntryData {
    pub idx: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<ChartFormatData>,
    /// Whether this legend entry is visible (API-level toggle).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub visible: Option<bool>,
}

/// Trendline label data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendlineLabelData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<super::drawings::ManualLayout>,
}
