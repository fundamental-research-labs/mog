//! Chart document model types (ECMA-376 dml-chart.xsd).

use super::*;

/// Root chart element (CT_ChartSpace).
///
/// Represents the complete chart XML part (xl/charts/chartN.xml).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartSpace {
    /// Whether the file uses 1904 date system
    pub date1904: Option<bool>,
    /// Language code (e.g. "en-US")
    pub lang: Option<String>,
    /// Whether chart has rounded corners
    pub rounded_corners: Option<bool>,
    /// Chart style index
    pub style: Option<u8>,
    /// Raw mc:AlternateContent XML for the style element (for round-trip fidelity).
    ///
    /// In many Excel files the style is wrapped in `mc:AlternateContent` with a
    /// `c14:style` Choice and a `c:style` Fallback.  When present this raw blob
    /// is emitted verbatim instead of the flat `<c:style>` element.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_alternate_content: Option<String>,
    /// Whether the `style_alternate_content` appeared after `</c:chart>` in the
    /// original XML (non-standard, seen in Google Sheets exports).  When `true`,
    /// the writer emits the style blob after the chart element for round-trip
    /// fidelity; when `false` (default / standard OOXML) it is emitted before.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub style_after_chart: bool,
    /// Color mapping override (CT_ColorMappingOverride from dml-main).
    ///
    /// Overrides the theme's color mapping for this chart.
    /// `None` = absent (inherit from theme), `Some(MasterClrMapping)` = explicit inherit,
    /// `Some(OverrideClrMapping(...))` = full override.
    pub clr_map_ovr: Option<crate::themes::ColorMappingOverride>,
    /// Chart protection
    pub protection: Option<ChartProtection>,
    /// The chart element
    pub chart: Chart,
    /// ChartSpace-level shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// ChartSpace-level text body properties
    pub tx_pr: Option<TextBody>,
    /// External data reference
    pub external_data: Option<ExternalData>,
    /// Pivot source metadata (CT_PivotSource)
    pub pivot_source: Option<PivotSource>,
    /// User shapes drawing reference (relationship ID)
    pub user_shapes: Option<String>,
    /// Print settings
    pub print_settings: Option<PrintSettings>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Chart element (CT_Chart).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Chart {
    /// Chart title
    pub title: Option<Title>,
    /// Whether auto-title is deleted
    pub auto_title_deleted: Option<bool>,
    /// 3-D view configuration
    pub view_3d: Option<View3D>,
    /// Floor surface (3D charts)
    pub floor: Option<ChartSurface>,
    /// Side wall surface (3D charts)
    pub side_wall: Option<ChartSurface>,
    /// Back wall surface (3D charts)
    pub back_wall: Option<ChartSurface>,
    /// Plot area
    pub plot_area: PlotArea,
    /// Legend
    pub legend: Option<Legend>,
    /// Plot visible cells only
    pub plot_vis_only: Option<bool>,
    /// How to display blank cells
    pub disp_blanks_as: Option<DisplayBlanksAs>,
    /// Show data labels over maximum
    pub show_d_lbls_over_max: Option<bool>,
    /// Pivot format definitions (CT_PivotFmts) — formatting for pivot chart elements
    pub pivot_fmts: Vec<PivotFmt>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
    /// Whether the original XML had an empty self-closing `<c:extLst/>`
    #[serde(default)]
    pub has_empty_ext_lst: bool,
}

/// Plot area (CT_PlotArea).
///
/// Contains one or more chart type groups, axes, and formatting.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PlotArea {
    /// Manual layout
    pub layout: Option<ManualLayout>,
    /// Chart type groups (each contains chart-type config + series + data labels)
    /// Most charts have 1 group; combo charts have 2+.
    pub chart_groups: Vec<ChartGroup>,
    /// All axes in the plot area
    pub axes: Vec<ChartAxis>,
    /// Data table (if shown below chart)
    pub d_table: Option<DataTableConfig>,
    /// Shape properties (plot area background/border)
    pub sp_pr: Option<ShapeProperties>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// A chart type group within a plot area.
///
/// In OOXML, a plotArea can contain multiple chart type elements
/// (e.g., barChart + lineChart for combo charts). Each chart type
/// element contains its config, series, data labels, and axis IDs.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartGroup {
    /// Chart type
    pub chart_type: ChartType,
    /// Chart-type-specific configuration
    pub config: ChartTypeConfig,
    /// Data series in this group
    pub series: Vec<ChartSeries>,
    /// Group-level data labels
    pub d_lbls: Option<DataLabelOptions>,
    /// Axis IDs this group uses (typically [catAxId, valAxId])
    pub ax_id: Vec<u32>,
    /// Non-standard `chartType` attribute (Google Sheets) — preserved for round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_chart_type_attr: Option<String>,
    /// Raw OOXML chart group element name when the parser does not recognize the
    /// standard chart family, e.g. `fooChart`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_chart_element_name: Option<String>,
    /// Raw XML for an unsupported chart group. Used only as preserve-only
    /// authority; known chart groups remain modeled through `config` + `series`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_chart_group_xml: Option<String>,
}

/// Chart title (CT_Title).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Title {
    /// Title text source — rich text body or string reference
    pub tx: Option<TitleText>,
    /// Manual layout
    pub layout: Option<ManualLayout>,
    /// Whether title overlays the chart
    pub overlay: Option<bool>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties (axis labels style, not the content)
    pub tx_pr: Option<TextBody>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Title text content — type alias for [`ChartText`] (CT_Tx).
///
/// `TitleText` and `ChartText` are the same XSD type (CT_Tx). The alias
/// preserves the downstream API while sharing the canonical definition.
pub type TitleText = ChartText;

/// Chart legend (CT_Legend).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Legend {
    /// Legend position
    pub legend_pos: Option<LegendPosition>,
    /// Legend entries (for show/hide)
    pub legend_entry: Vec<LegendEntry>,
    /// Manual layout
    pub layout: Option<ManualLayout>,
    /// Whether legend overlays the chart
    pub overlay: Option<bool>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties
    pub tx_pr: Option<TextBody>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Individual legend entry (CT_LegendEntry).
///
/// **XSD choice constraint**: `delete` and `tx_pr` are mutually exclusive.
/// If `delete` is `Some(true)`, `tx_pr` should be `None` (the entry is hidden).
/// If `tx_pr` is `Some(...)`, `delete` should be `None` (the entry has custom formatting).
/// Setting both simultaneously is invalid per ECMA-376.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LegendEntry {
    /// Index of the entry
    pub idx: u32,
    /// Delete (hide) this entry — mutually exclusive with `tx_pr`
    pub delete: Option<bool>,
    /// Text body properties override — mutually exclusive with `delete`
    pub tx_pr: Option<TextBody>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

impl LegendEntry {
    /// Validates the XSD choice constraint: `delete` and `tx_pr` must not both be set.
    #[cfg(debug_assertions)]
    #[must_use]
    pub fn is_valid(&self) -> bool {
        !(self.delete == Some(true) && self.tx_pr.is_some())
    }
}

/// Pivot source metadata (CT_PivotSource).
///
/// Links a chart to its source PivotTable.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotSource {
    /// Name of the PivotTable
    pub name: String,
    /// Format ID
    pub fmt_id: u32,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Pivot format (CT_PivotFmt).
///
/// Per-element formatting override for pivot charts.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotFmt {
    /// Index
    pub idx: u32,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties
    pub tx_pr: Option<TextBody>,
    /// Marker
    pub marker: Option<Marker>,
    /// Individual data label
    pub d_lbl: Option<DataLabel>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}
