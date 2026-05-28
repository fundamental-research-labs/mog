//! Sheet view types (ECMA-376 ST_SheetViewType, CT_SheetView, CT_Selection).

use super::pane::{Pane, SheetPane};

// ---------------------------------------------------------------------------
// Serde helpers for SheetView numeric defaults
// ---------------------------------------------------------------------------

fn default_color_id() -> u32 {
    64
}
fn is_default_color_id(v: &u32) -> bool {
    *v == 64
}

fn default_zoom_scale() -> u32 {
    100
}
fn is_default_zoom_scale(v: &u32) -> bool {
    *v == 100
}

fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

/// Sheet view type (ECMA-376 ST_SheetViewType, 18.18.69).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum SheetViewType {
    /// Normal editing view.
    #[default]
    Normal,
    /// Page break preview mode.
    PageBreakPreview,
    /// Page layout view (print preview).
    PageLayout,
}

impl SheetViewType {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "normal" => Self::Normal,
            "pageBreakPreview" => Self::PageBreakPreview,
            "pageLayout" => Self::PageLayout,
            _ => Self::Normal,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::PageBreakPreview => "pageBreakPreview",
            Self::PageLayout => "pageLayout",
        }
    }

    /// Returns true if this is the default variant (Normal).
    pub fn is_default(&self) -> bool {
        matches!(self, Self::Normal)
    }
}

// ---------------------------------------------------------------------------
// SheetView (CT_SheetView)
// ---------------------------------------------------------------------------

/// Sheet view settings (ECMA-376 CT_SheetView, 18.3.1.87).
///
/// Represents a single `<sheetView>` element within `<sheetViews>`.
/// A worksheet can have multiple views (one per workbook view).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SheetView {
    /// Whether the window is protected from resizing.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub window_protection: bool,
    /// Whether to show formulas instead of computed values.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub show_formulas: bool,
    /// Whether to show grid lines (default: true).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub show_grid_lines: bool,
    /// Whether to show row and column headers (default: true).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub show_row_col_headers: bool,
    /// Whether to show zero values (default: true).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub show_zeros: bool,
    /// Whether this sheet tab is selected.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub tab_selected: bool,
    /// Whether to show ruler in page layout view (default: true).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub show_ruler: bool,
    /// Whether to show outline symbols (default: true).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub show_outline_symbols: bool,
    /// Whether to show white space in page layout view (default: true).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub show_white_space: bool,
    /// View type.
    #[serde(default, skip_serializing_if = "SheetViewType::is_default")]
    pub view: SheetViewType,
    /// Top-left visible cell reference (e.g., "A1").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_left_cell: Option<String>,
    /// Whether the default grid color is used (true = default color, default: true).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub default_grid_color: bool,
    /// Indexed color value for grid lines (legacy, default: 64).
    #[serde(
        default = "default_color_id",
        skip_serializing_if = "is_default_color_id"
    )]
    pub color_id: u32,
    /// Zoom scale percentage (10-400, default: 100).
    #[serde(
        default = "default_zoom_scale",
        skip_serializing_if = "is_default_zoom_scale"
    )]
    pub zoom_scale: u32,
    /// Zoom scale for normal view (default: 0).
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub zoom_scale_normal: u32,
    /// Zoom scale for page break preview.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_scale_sheet_layout_view: Option<u32>,
    /// Zoom scale for page layout view.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_scale_page_layout_view: Option<u32>,
    /// Workbook view index this sheet view belongs to.
    #[serde(default)]
    pub workbook_view_id: u32,
    /// Whether the sheet is displayed right-to-left.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub right_to_left: bool,
    /// Pane configuration (frozen or split).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane: Option<SheetPane>,
    /// Pivot table selection(s) in this view (0..4 per spec).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_selection: Vec<PivotSelection>,
    /// Selection(s) in this view.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selections: Vec<Selection>,
    /// Direct-child `<extLst>` XML owned by this view scope.
    ///
    /// This is unsupported extension metadata for passive round-trip only; it
    /// must not be promoted to root worksheet extensions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

impl Default for SheetView {
    fn default() -> Self {
        Self {
            window_protection: false,
            show_formulas: false,
            show_grid_lines: true,
            show_row_col_headers: true,
            show_zeros: true,
            tab_selected: false,
            show_ruler: true,
            show_outline_symbols: true,
            show_white_space: true,
            view: SheetViewType::default(),
            top_left_cell: None,
            default_grid_color: true,
            color_id: 64,
            zoom_scale: 100,
            zoom_scale_normal: 0,
            zoom_scale_sheet_layout_view: None,
            zoom_scale_page_layout_view: None,
            workbook_view_id: 0,
            right_to_left: false,
            pane: None,
            pivot_selection: Vec::new(),
            selections: Vec::new(),
            ext_lst_xml: None,
        }
    }
}

// ---------------------------------------------------------------------------
// PivotAxis (ST_Axis)
// ---------------------------------------------------------------------------

/// Pivot table axis (ECMA-376 ST_Axis, 18.18.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PivotAxis {
    /// Row axis.
    AxisRow,
    /// Column axis.
    AxisCol,
    /// Page (report filter) axis.
    AxisPage,
    /// Values axis.
    AxisValues,
}

impl PivotAxis {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "axisRow" => Some(Self::AxisRow),
            "axisCol" => Some(Self::AxisCol),
            "axisPage" => Some(Self::AxisPage),
            "axisValues" => Some(Self::AxisValues),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::AxisRow => "axisRow",
            Self::AxisCol => "axisCol",
            Self::AxisPage => "axisPage",
            Self::AxisValues => "axisValues",
        }
    }
}

// ---------------------------------------------------------------------------
// PivotSelection (CT_PivotSelection)
// ---------------------------------------------------------------------------

/// Pivot table selection in a sheet view (ECMA-376 CT_PivotSelection, 18.3.1.74).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotSelection {
    /// Pane this pivot selection belongs to (XSD optional, default: topLeft).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<Pane>,
    /// Whether to show the pivot table header.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub show_header: bool,
    /// Whether this is a label selection.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub label: bool,
    /// Whether this is a data selection.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub data: bool,
    /// Whether the selection is extendable.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub extendable: bool,
    /// Number of items selected.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub count: u32,
    /// Pivot axis (optional, no default).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis: Option<PivotAxis>,
    /// Dimension index.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub dimension: u32,
    /// Start index.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub start: u32,
    /// Minimum index.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub min: u32,
    /// Maximum index.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub max: u32,
    /// Active row index.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub active_row: u32,
    /// Active column index.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub active_col: u32,
    /// Previous row index.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub previous_row: u32,
    /// Previous column index.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub previous_col: u32,
    /// Click count.
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub click: u32,
    /// Relationship ID (XSD optional).
    pub id: Option<String>,
    /// Pivot area (raw XML string; CT_PivotArea is not fully modeled yet).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pivot_area: Option<String>,
}

impl PivotSelection {
    /// Effective pane (defaults to `TopLeft` when absent per XSD).
    #[must_use]
    pub fn effective_pane(&self) -> Pane {
        self.pane.unwrap_or(Pane::TopLeft)
    }

    /// Effective relationship ID (returns empty string when absent).
    #[must_use]
    pub fn effective_id(&self) -> &str {
        self.id.as_deref().unwrap_or("")
    }
}

// ---------------------------------------------------------------------------
// Selection (CT_Selection)
// ---------------------------------------------------------------------------

/// Selection state in a sheet view (ECMA-376 CT_Selection, 18.3.1.78).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Selection {
    /// Pane this selection belongs to (XSD optional, default "topLeft").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<Pane>,
    /// Active cell reference (e.g., "A1").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_cell: Option<String>,
    /// 0-based index of the active cell within sqref ranges.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_cell_id: Option<u32>,
    /// Selected range(s) as space-delimited references (e.g., "A1:B3 D5:F10").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sqref: Option<String>,
}

impl Selection {
    /// Effective pane (defaults to `TopLeft` when absent per XSD).
    #[must_use]
    pub fn effective_pane(&self) -> Pane {
        self.pane.unwrap_or(Pane::TopLeft)
    }
}
