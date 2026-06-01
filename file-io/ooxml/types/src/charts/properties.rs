//! Chart property and formatting types (ECMA-376 Part 1, Section 21.2).

use super::*;

// ST_TileFlipMode — canonical definition is in drawings.rs.
pub use crate::drawings::TileFlipMode;

// =============================================================================
// ShapeProperties re-export & TextBody alias
// =============================================================================

/// Shape properties for chart elements -- canonical definition from drawings.
pub use crate::drawings::ShapeProperties;

/// Text body for chart text elements -- re-exported from drawings.
pub type TextBody = crate::drawings::TextBody;

// =============================================================================
// NumFmt
// =============================================================================

/// Number format (CT_NumFmt).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct NumFmt {
    /// Number format code (e.g. `"0.00%"`, `"#,##0"`)
    pub format_code: String,
    /// Whether the format is linked to the source data.
    ///
    /// Per XSD: optional attribute with no default. `None` means absent.
    pub source_linked: Option<bool>,
}

// =============================================================================
// Supporting structs
// =============================================================================

/// Chart lines formatting (used for dropLines, hiLowLines, serLines, leaderLines, gridlines).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartLines {
    /// Shape properties for the lines
    pub sp_pr: Option<ShapeProperties>,
}

/// Up/down bars for line and stock charts (CT_UpDownBars).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct UpDownBars {
    /// Gap width between bars (0-500)
    pub gap_width: Option<u32>,
    /// Shape properties for up bars
    pub up_bars: Option<ShapeProperties>,
    /// Shape properties for down bars
    pub down_bars: Option<ShapeProperties>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Manual layout for chart elements (CT_ManualLayout).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ManualLayout {
    /// Layout target (inner plot area or outer chart area)
    pub layout_target: Option<LayoutTarget>,
    /// X layout mode
    pub x_mode: Option<LayoutMode>,
    /// Y layout mode
    pub y_mode: Option<LayoutMode>,
    /// Width layout mode
    pub w_mode: Option<LayoutMode>,
    /// Height layout mode
    pub h_mode: Option<LayoutMode>,
    /// X position (fraction of chart width)
    pub x: Option<f64>,
    /// Y position (fraction of chart height)
    pub y: Option<f64>,
    /// Width (fraction of chart width)
    pub w: Option<f64>,
    /// Height (fraction of chart height)
    pub h: Option<f64>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Data label display options (CT_DLbls subset).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DataLabelOptions {
    /// Delete all data labels (when true, other show flags are irrelevant).
    /// Mutually exclusive with the Group_DLbls content per the XSD choice.
    pub delete: Option<bool>,
    /// Show the value
    pub show_value: bool,
    /// Show the category name
    pub show_category: bool,
    /// Show the series name
    pub show_series_name: bool,
    /// Show percentage (pie/doughnut charts)
    pub show_percent: bool,
    /// Show legend key
    pub show_legend_key: bool,
    /// Show bubble size (bubble charts)
    pub show_bubble_size: bool,
    /// Label position
    pub position: DataLabelPosition,
    /// Separator between label parts
    pub separator: Option<String>,
    /// Number format code (legacy simple field, prefer `num_fmt_obj` for full fidelity)
    pub num_fmt: Option<String>,
    /// Shape properties for the label frame
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties
    pub tx_pr: Option<TextBody>,
    /// Show leader lines (pie charts)
    pub show_leader_lines: Option<bool>,
    /// Leader lines formatting
    pub leader_lines: Option<ChartLines>,
    /// Structured number format
    pub num_fmt_obj: Option<NumFmt>,
    /// Manual layout for the data labels group.
    pub layout: Option<ManualLayout>,
    /// Individual data label overrides (CT_DLbl children within CT_DLbls)
    pub d_lbl: Vec<DataLabel>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Display units label (CT_DispUnitsLbl).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DisplayUnitsLabel {
    /// Manual layout
    pub layout: Option<ManualLayout>,
    /// Text content — rich text or string reference (CT_Tx)
    pub tx: Option<ChartText>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties
    pub tx_pr: Option<TextBody>,
}

/// Display unit value kind — built-in or custom (CT_DispUnits choice).
///
/// Mutually exclusive: a display unit is either a predefined built-in scale
/// or a custom numeric value, never both.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum DisplayUnitKind {
    /// Predefined scale (e.g. thousands, millions)
    BuiltIn(BuiltInUnit),
    /// Custom scale value
    Custom(f64),
}

/// Display units for a value axis (CT_DispUnits).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DisplayUnits {
    /// Unit kind — built-in scale or custom value (choice, optional)
    pub kind: Option<DisplayUnitKind>,
    /// Display units label
    pub disp_units_lbl: Option<DisplayUnitsLabel>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Chart surface for floor/sideWall/backWall (CT_Surface).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartSurface {
    /// Thickness of the surface (ST_Thickness — percentage string, e.g. "25%")
    pub thickness: Option<String>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Picture options
    pub picture_options: Option<PictureOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Picture options for chart surfaces (CT_PictureOptions).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PictureOptions {
    /// Apply to front face
    pub apply_to_front: Option<bool>,
    /// Apply to side faces
    pub apply_to_sides: Option<bool>,
    /// Apply to end face
    pub apply_to_end: Option<bool>,
    /// Picture format
    pub picture_format: Option<PictureFormat>,
    /// Picture stack unit
    pub picture_stack_unit: Option<f64>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Chart protection settings (CT_Protection).
///
/// Per ECMA-376 §21.2.2.152, all five elements are optional (minOccurs=0).
/// `None` means the element is absent; `Some(true/false)` means it was explicitly set.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChartProtection {
    /// Protect chart object from being moved/resized
    pub chart_object: Option<bool>,
    /// Protect data from being changed
    pub data: Option<bool>,
    /// Protect formatting from being changed
    pub formatting: Option<bool>,
    /// Protect selection
    pub selection: Option<bool>,
    /// Protect user interface
    pub user_interface: Option<bool>,
}

impl ChartProtection {
    /// Effective value for `chart_object` (defaults to `false` when absent).
    #[must_use]
    pub fn effective_chart_object(&self) -> bool {
        self.chart_object.unwrap_or(false)
    }

    /// Effective value for `data` (defaults to `false` when absent).
    #[must_use]
    pub fn effective_data(&self) -> bool {
        self.data.unwrap_or(false)
    }

    /// Effective value for `formatting` (defaults to `false` when absent).
    #[must_use]
    pub fn effective_formatting(&self) -> bool {
        self.formatting.unwrap_or(false)
    }

    /// Effective value for `selection` (defaults to `false` when absent).
    #[must_use]
    pub fn effective_selection(&self) -> bool {
        self.selection.unwrap_or(false)
    }

    /// Effective value for `user_interface` (defaults to `false` when absent).
    #[must_use]
    pub fn effective_user_interface(&self) -> bool {
        self.user_interface.unwrap_or(false)
    }
}

/// Data table configuration (CT_DTable).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DataTableConfig {
    /// Show horizontal border
    pub show_horz_border: Option<bool>,
    /// Show vertical border
    pub show_vert_border: Option<bool>,
    /// Show outline border
    pub show_outline: Option<bool>,
    /// Show legend keys
    pub show_keys: Option<bool>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties
    pub tx_pr: Option<TextBody>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Page margins for print settings.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PageMargins {
    /// Left margin (inches)
    pub left: f64,
    /// Right margin (inches)
    pub right: f64,
    /// Top margin (inches)
    pub top: f64,
    /// Bottom margin (inches)
    pub bottom: f64,
    /// Header margin (inches)
    pub header: f64,
    /// Footer margin (inches)
    pub footer: f64,
}

impl Default for PageMargins {
    fn default() -> Self {
        Self {
            left: 0.7,
            right: 0.7,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
        }
    }
}

/// Page setup for chart print settings (CT_PageSetup, §21.2.2.135).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PageSetup {
    /// Paper size index
    pub paper_size: Option<u32>,
    /// Paper height (ST_PositiveUniversalMeasure, e.g. "297mm")
    pub paper_height: Option<String>,
    /// Paper width (ST_PositiveUniversalMeasure, e.g. "210mm")
    pub paper_width: Option<String>,
    /// First page number
    pub first_page_number: Option<u32>,
    /// Page orientation
    pub orientation: Option<PageOrientation>,
    /// Print in black and white
    pub black_and_white: Option<bool>,
    /// Print in draft quality
    pub draft: Option<bool>,
    /// Use first page number (instead of auto)
    pub use_first_page_number: Option<bool>,
    /// Horizontal DPI (XSD type: xs:int → signed)
    pub horizontal_dpi: Option<i32>,
    /// Vertical DPI (XSD type: xs:int → signed)
    pub vertical_dpi: Option<i32>,
    /// Number of copies
    pub copies: Option<u32>,
}

/// Print settings for the chart (CT_PrintSettings).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PrintSettings {
    /// Header/footer (CT_HeaderFooter) — 6 string elements + boolean attributes
    pub header_footer: Option<crate::print::HeaderFooter>,
    /// Page margins
    pub page_margins: Option<PageMargins>,
    /// Page setup
    pub page_setup: Option<PageSetup>,
    /// Legacy drawing for header/footer (CT_RelId) — relationship ID pointing
    /// to a VML drawing part used for header/footer images.
    pub legacy_drawing_hf: Option<String>,
}

/// External data reference (CT_ExternalData).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ExternalData {
    /// Relationship ID
    pub r_id: String,
    /// Auto-update on open
    pub auto_update: Option<bool>,
}

/// Band format for surface charts (CT_BandFmt).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BandFmt {
    /// Band index
    pub idx: u32,
    /// Shape properties for this band
    pub sp_pr: Option<ShapeProperties>,
}

/// Individual data label override (CT_DLbl).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DataLabel {
    /// Index of the data point this label applies to
    pub idx: u32,
    /// Manual layout
    pub layout: Option<ManualLayout>,
    /// Custom text (CT_Tx — rich text or string reference)
    pub text: Option<ChartText>,
    /// Shape properties for the label frame
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties
    pub tx_pr: Option<TextBody>,
    /// Number format override (CT_NumFmt)
    pub num_fmt: Option<NumFmt>,
    /// Delete this label
    pub delete: Option<bool>,
    /// Show the value
    pub show_value: Option<bool>,
    /// Show the category name
    pub show_category: Option<bool>,
    /// Show the series name
    pub show_series_name: Option<bool>,
    /// Show percentage (pie/doughnut charts)
    pub show_percent: Option<bool>,
    /// Show legend key
    pub show_legend_key: Option<bool>,
    /// Show bubble size (bubble charts)
    pub show_bubble_size: Option<bool>,
    /// Label position
    pub position: Option<DataLabelPosition>,
    /// Separator between label parts
    pub separator: Option<String>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Trendline label (CT_TrendlineLbl).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TrendlineLabel {
    /// Manual layout
    pub layout: Option<ManualLayout>,
    /// Text content — rich text or string reference (CT_Tx)
    pub tx: Option<ChartText>,
    /// Number format
    pub num_fmt: Option<NumFmt>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties
    pub tx_pr: Option<TextBody>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}
