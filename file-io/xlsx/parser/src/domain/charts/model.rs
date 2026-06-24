//! Parser compatibility model types for XLSX charts.
//!
//! These structs preserve the stable `crate::domain::charts::*` surface used by
//! existing callers while carrying both parsed domain fields and imported
//! roundtrip payloads.

use super::*;

/// Complete chart definition from chart XML part.
/// Corresponds to CT_ChartSpace in ECMA-376.
#[derive(Debug, Clone, Default)]
pub struct Chart {
    /// Primary chart type
    pub chart_type: ChartType,
    /// Chart-type-specific configuration (grouping, direction, style, etc.)
    pub chart_type_config: Option<ChartTypeConfig>,
    /// Axis IDs as they appeared in the chart type element (e.g., <c:barChart><c:axId>...).
    /// Preserves original ordering for round-trip fidelity.
    pub chart_type_ax_ids: Vec<u32>,
    /// Chart title
    pub title: Option<Title>,
    /// Legend configuration
    pub legend: Option<Legend>,
    /// Plot area containing chart data
    pub plot_area: PlotArea,
    /// Data series
    pub series: Vec<ChartSeries>,
    /// Pre-built chart groups for combo charts (multiple chart type elements).
    /// Empty for single-type charts (built from flat fields in build_chart_space).
    pub chart_groups: Vec<ooxml_types::charts::ChartGroup>,
    /// Whether this is a 3D chart
    pub is_3d: bool,
    /// Display options
    pub display_options: DisplayOptions,
    /// Chart-level data labels
    pub data_labels: Option<DataLabelOptions>,
    /// 3D view configuration
    pub view_3d: Option<View3D>,
    /// Floor surface (3D charts)
    pub floor: Option<ChartSurface>,
    /// Side wall surface (3D charts)
    pub side_wall: Option<ChartSurface>,
    /// Back wall surface (3D charts)
    pub back_wall: Option<ChartSurface>,
    /// Whether auto title is deleted.
    /// `None` means the element was absent in the original XML.
    pub auto_title_deleted: Option<bool>,
    /// Pivot chart field button visibility flags.
    pub show_all_field_buttons: Option<bool>,
    pub show_axis_field_buttons: Option<bool>,
    pub show_legend_field_buttons: Option<bool>,
    pub show_value_field_buttons: Option<bool>,
    pub show_report_filter_field_buttons: Option<bool>,
    /// Pivot chart formatting entries (c:pivotFmts).
    pub pivot_fmts: Vec<ooxml_types::charts::PivotFmt>,

    // --- ChartSpace-level properties ---
    /// Whether the file uses the 1904 date system.
    /// `None` means the element was absent in the original XML.
    pub date1904: Option<bool>,
    /// Language code (e.g. "en-US")
    pub lang: Option<String>,
    /// Whether chart has rounded corners.
    /// `None` means the element was absent in the original XML.
    pub rounded_corners: Option<bool>,
    /// Chart style index
    pub style: Option<u32>,
    /// Raw mc:AlternateContent XML for the style element (round-trip fidelity).
    /// When present, written verbatim instead of flat `<c:style>`.
    pub style_alternate_content: Option<String>,
    /// Whether the `style_alternate_content` appeared after `</c:chart>` (non-standard).
    pub style_after_chart: bool,
    /// Chart-local theme color mapping override (`c:clrMapOvr`).
    pub clr_map_ovr: Option<ooxml_types::themes::ColorMappingOverride>,
    /// Non-standard `chartType` attribute on the chart type element (Google Sheets).
    pub raw_chart_type_attr: Option<String>,
    /// Chart protection settings
    pub protection: Option<ChartProtection>,
    /// ChartSpace-level shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// ChartSpace-level text body properties
    pub tx_pr: Option<TextBody>,
    /// External data reference
    pub external_data: Option<ExternalData>,
    /// Print settings
    pub print_settings: Option<PrintSettings>,
    /// Chart-level extLst entries (inside `<c:chart>`, after legend/display opts)
    pub chart_extensions: Vec<ooxml_types::charts::ExtensionEntry>,
    /// Whether the original XML had an empty self-closing chart-level `<c:extLst/>`
    pub has_empty_chart_ext_lst: bool,
    /// ChartSpace-level extLst entries (inside `<c:chartSpace>`, after printSettings)
    pub chart_space_extensions: Vec<ooxml_types::charts::ExtensionEntry>,
    /// Pivot source metadata (CT_PivotSource) — links chart to a PivotTable
    pub pivot_source: Option<ooxml_types::charts::PivotSource>,
    /// User shapes relationship ID (c:userShapes r:id="...") — drawing overlay
    pub user_shapes: Option<String>,

    /// Canonical ChartSpace for lossless round-trip serialization.
    /// Built during parse from the same XML data that populates the flat fields above.
    /// When present, the write path uses this for serialization instead of going
    /// through the lossy ChartWriter conversion.
    pub chart_space: Option<ooxml_types::charts::ChartSpace>,

    /// Original chart XML part bytes. L2 stores charts as floating objects, and
    /// deeply deserializing ChartSpace JSON during export can overflow worker
    /// stacks. Preserve the imported XML as the passthrough source of truth
    /// unless the chart is later reconstructed from typed runtime fields.
    pub raw_chart_xml: Option<Vec<u8>>,

    /// Raw bytes of chart auxiliary files for round-trip passthrough.
    /// Key is the ZIP entry path (e.g., "xl/charts/colors1.xml"), value is the raw bytes.
    pub auxiliary_files: Vec<(String, Vec<u8>)>,
    /// Raw bytes of the chart's .rels file (e.g., "xl/charts/_rels/chart1.xml.rels")
    pub chart_rels_bytes: Option<(String, Vec<u8>)>,
    /// Original ZIP path of this chart file for round-trip fidelity.
    /// E.g., "xl/charts/chart2.xml". Used to preserve original numbering.
    pub original_path: Option<String>,
}

/// Plot area containing chart data and axes.
/// Corresponds to CT_PlotArea in ECMA-376.
///
/// Axes are boxed to reduce stack size: each `ChartAxis` is large due to
/// nested `TextBody`/`ShapeProperties` trees, and six inline axes can overflow
/// test-thread stacks.
#[derive(Debug, Clone, Default)]
pub struct PlotArea {
    /// Layout information
    pub layout: Option<ManualLayout>,
    /// Category axis (X-axis for most charts)
    pub cat_ax: Option<Box<ChartAxis>>,
    /// Value axis (Y-axis for most charts)
    pub val_ax: Option<Box<ChartAxis>>,
    /// Date axis (alternative to category axis)
    pub date_ax: Option<Box<ChartAxis>>,
    /// Series axis (for 3D charts)
    pub ser_ax: Option<Box<ChartAxis>>,
    /// Secondary category axis
    pub cat_ax_secondary: Option<Box<ChartAxis>>,
    /// Secondary value axis
    pub val_ax_secondary: Option<Box<ChartAxis>>,
    /// All axes in original XML encounter order (for lossless round-trip).
    pub axes_ordered: Vec<ChartAxis>,
    /// Data table (if shown)
    pub data_table: Option<DataTableConfig>,
    /// Plot area shape properties (background/border)
    pub sp_pr: Option<ShapeProperties>,
    /// Plot-area-level extLst entries.
    pub extensions: Vec<ooxml_types::charts::ExtensionEntry>,
}

/// Display options for chart.
#[derive(Debug, Clone, Default)]
pub struct DisplayOptions {
    /// Plot visible cells only
    pub plot_vis_only: Option<bool>,
    /// How to display blank cells
    pub disp_blanks_as: Option<DisplayBlanksAs>,
    /// Show data labels over maximum
    pub show_data_lbls_over_max: Option<bool>,
}

// =============================================================================
// Chart Relationships
// =============================================================================

/// Reference to a chart from a drawing.
#[derive(Debug, Clone, Default)]
pub struct ChartRef {
    /// Relationship ID
    pub r_id: String,
    /// Chart type (parsed from chart XML)
    pub chart_type: ChartType,
    /// Anchor information
    pub anchor: ChartAnchor,
}

/// Chart anchor position in a drawing.
#[derive(Debug, Clone, Default)]
pub struct ChartAnchor {
    /// Anchor type
    pub anchor_type: AnchorType,
    /// From cell (for twoCellAnchor)
    pub from_col: u32,
    pub from_col_off: i64,
    pub from_row: u32,
    pub from_row_off: i64,
    /// To cell (for twoCellAnchor)
    pub to_col: Option<u32>,
    pub to_col_off: Option<i64>,
    pub to_row: Option<u32>,
    pub to_row_off: Option<i64>,
    /// Extent for oneCell/absolute anchors (in EMUs)
    pub cx: Option<i64>,
    pub cy: Option<i64>,
}
