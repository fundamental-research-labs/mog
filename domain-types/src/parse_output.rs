use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::domain::floating_object::FloatingObject;
use crate::domain::pivot::ParsedPivotTable;
use crate::domain::*;
use crate::format::DocumentFormat;
use crate::properties::DocumentProperties;
use ooxml_types::slicers::{
    SlicerAnchor as OoxmlSlicerAnchor, SlicerCacheDef as OoxmlSlicerCacheDef,
    SlicerDef as OoxmlSlicerDef,
};
use ooxml_types::workbook::SheetState;
use value_types::CellValue;

/// Position-keyed parse output — the shared container for parser → writer data flow.
/// No UUIDs, no identity formulas — those are allocated by the hydration layer.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseOutput {
    pub sheets: Vec<SheetData>,
    pub style_palette: Vec<DocumentFormat>,
    pub named_ranges: Vec<NamedRange>,
    pub pivot_tables: Vec<ParsedPivotTable>,
    /// Pivot cache record data for eval-only use (cache_id → rows of cell values).
    /// Not consumed by the snapshot/hydration path. Populated from the OOXML
    /// pivot cache records so formula-eval can feed compute-pivot with the same
    /// source data Excel used to produce the cached pivot output.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub pivot_cache_records: std::collections::HashMap<u32, Vec<Vec<CellValue>>>,
    pub data_table_regions: Vec<DataTableRegion>,
    pub slicer_caches: Vec<OoxmlSlicerCacheDef>,
    pub theme: Option<ThemeData>,
    pub properties: Option<DocumentProperties>,
    pub protection: Option<WorkbookProtection>,
    pub calculation: CalculationProperties,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_views: Vec<WorkbookView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_properties: Option<WorkbookProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_version: Option<FileVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_sharing: Option<FileSharing>,
    /// Person identity list for threaded comments.
    /// Referenced by `Comment.person_id` across all sheets.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub persons: Vec<PersonInfo>,
}

/// A named range definition (position-keyed, no CellIds).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedRange {
    pub name: String,
    /// The formula this name refers to (A1 notation).
    pub refers_to: String,
    /// Sheet index for sheet-scoped names (None = workbook scope).
    pub local_sheet_id: Option<u32>,
    pub hidden: bool,
    pub comment: Option<String>,
    /// Custom menu text (customMenu) for macro-oriented defined names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_menu: Option<String>,
    /// Description text (description) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Help topic text (help) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    /// Status bar text (statusBar) for the defined name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_bar: Option<String>,
    /// Whether this is an XLM macro name (xlm="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub xlm: bool,
    /// Whether this name is a function (function="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub function: bool,
    /// Whether this is a VBA procedure name (vbProcedure="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub vb_procedure: bool,
    /// Whether this name should be published to the server (publishToServer="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub publish_to_server: bool,
    /// Whether this name is a workbook parameter (workbookParameter="1").
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub workbook_parameter: bool,
    /// Whether xml:space="preserve" should be emitted on the value.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub xml_space_preserve: bool,
}

/// A data table region (position-keyed).
///
/// `row_input_ref` / `col_input_ref` are typed `Option<CellRef>` to keep the
/// parser -> lowering -> snapshot edge stateless, with no typed-to-string-to-
/// typed hop.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableOoxmlFlags {
    /// Authored `<f t="dataTable" r1="...">` attribute spelling, preserved for
    /// file round-trip. The typed `col_input_ref` remains the behavioral source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r1: Option<String>,
    /// Authored `<f t="dataTable" r2="...">` attribute spelling, preserved for
    /// file round-trip. The typed `row_input_ref` remains the behavioral source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r2: Option<String>,
    /// `<f t="dataTable" aca="1">`: always calculate array/data-table formula.
    #[serde(default)]
    pub aca: bool,
    /// `<f t="dataTable" ca="1">`: calculate this formula.
    #[serde(default)]
    pub ca: bool,
    /// `<f t="dataTable" bx="1">`: OOXML data-table input mode flag.
    #[serde(default)]
    pub bx: bool,
    /// `<f t="dataTable" dt2D="1">`: two-variable data table flag.
    #[serde(default)]
    pub dt2d: bool,
    /// `<f t="dataTable" dtr="1">`: data table uses row/column references.
    #[serde(default)]
    pub dtr: bool,
    /// `<f t="dataTable" del1="1">`: delete first input row flag.
    #[serde(default)]
    pub del1: bool,
    /// `<f t="dataTable" del2="1">`: delete second input row flag.
    #[serde(default)]
    pub del2: bool,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableRegion {
    pub sheet_index: u32,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    /// Input cell that receives left-column header values (one per body row).
    /// Normalized from Excel's r2 attribute ("column input cell").
    pub row_input_ref: Option<formula_types::CellRef>,
    /// Input cell that receives top-row header values (one per body column).
    /// Normalized from Excel's r1 attribute ("row input cell").
    pub col_input_ref: Option<formula_types::CellRef>,
    /// OOXML `<f t="dataTable">` flags that Mog does not yet implement
    /// behaviorally but must preserve or normalize explicitly for round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_flags: Option<DataTableOoxmlFlags>,
}

/// All data for a single sheet, position-keyed.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetData {
    pub name: String,
    pub rows: u32,
    pub cols: u32,
    /// Original sheetId from workbook.xml (1-based). Preserved for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<u32>,
    /// Sheet visibility state from workbook.xml.
    #[serde(default)]
    pub visibility: SheetState,
    /// Stable sheet identity for co-authoring (xr:uid on `<worksheet>` root).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    pub cells: Vec<CellData>,
    /// Authored blank `<c>` cells with an explicit `s` attribute.
    ///
    /// These are runtime-visible cell-level style overlays, but they do not
    /// carry values/formulas and must not force dense `cells` entries.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authored_style_runs: Vec<AuthoredStyleRun>,
    pub dimensions: SheetDimensions,
    pub merges: Vec<MergeRegion>,
    pub frozen_pane: Option<FrozenPane>,
    pub view: SheetView,
    /// Additional `<sheetView>` elements beyond the primary one (index 1+).
    /// Stored as `ooxml_types::worksheet::SheetView` for lossless round-trip fidelity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_sheet_views: Vec<ooxml_types::worksheet::SheetView>,
    pub row_styles: Vec<RowStyleEntry>,
    pub col_styles: Vec<ColStyleEntry>,
    // Domain objects
    pub charts: Vec<ChartSpec>,
    pub conditional_formats: Vec<ConditionalFormat>,
    pub comments: Vec<Comment>,
    pub hyperlinks: Vec<Hyperlink>,
    pub data_validations: Vec<ValidationSpec>,
    /// Source count attribute on `<dataValidations>`, when imported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_declared_count: Option<u32>,
    /// Container-level disablePrompts attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub data_validations_disable_prompts: bool,
    /// Container-level xWindow attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_x_window: Option<u32>,
    /// Container-level yWindow attribute on `<dataValidations>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_validations_y_window: Option<u32>,
    pub sparklines: Vec<Sparkline>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sparkline_groups: Vec<SparklineGroup>,
    pub tables: Vec<TableSpec>,
    pub slicers: Vec<OoxmlSlicerDef>,
    pub slicer_anchors: Vec<OoxmlSlicerAnchor>,
    pub floating_objects: Vec<FloatingObject>,
    // Print & Protection
    pub print_settings: Option<PrintSettings>,
    pub page_breaks: Option<PageBreaks>,
    /// Header/footer images parsed from VML drawings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hf_images: Vec<crate::domain::print::HeaderFooterImageInfo>,
    pub protection: Option<SheetProtection>,
    // Structure
    pub auto_filter: Option<AutoFilter>,
    /// Worksheet-level `<sortState>` element (not nested inside `<autoFilter>`).
    ///
    /// Previously stored as raw XML on `SheetRoundTripContext.sort_state_xml`
    /// and silently dropped when the blob was absent. Now typed directly so
    /// parse -> domain -> write reconstructs losslessly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<SortState>,
    pub outline_groups: Vec<OutlineGroup>,
    /// Outline (grouping) properties from `<sheetPr><outlinePr>`.
    /// Controls summary row/column placement and outline symbol visibility.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_properties: Option<ooxml_types::worksheet::OutlineProperties>,
}

/// Parser-owned classification for imported cells whose OOXML metadata affects
/// projection or spill behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportedCellProjectionRole {
    #[default]
    Normal,
    DynamicArraySource,
    DynamicArraySpillTarget,
    UnknownCellMetadata,
}

impl ImportedCellProjectionRole {
    pub fn is_normal(&self) -> bool {
        *self == Self::Normal
    }
}

/// A single cell's data, position-keyed (no UUID).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellData {
    pub row: u32,
    pub col: u32,
    pub value: CellValue,
    /// Formula in A1 notation (expanded text for all formula types).
    pub formula: Option<String>,
    /// Array formula master cell range.
    pub array_ref: Option<String>,
    /// Index into `ParseOutput.style_palette`.
    pub style_id: Option<u32>,
    /// Original OOXML formula metadata for round-trip preservation.
    /// When present, carries shared/array/dataTable formula attributes
    /// so the writer can emit the correct `<f>` element structure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_formula: Option<ooxml_types::worksheet::CellFormula>,
    /// Whether the `<c>` element has a `cm` attribute (cell metadata / dynamic arrays).
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub cm: bool,
    /// For formula cells with a string result, the OOXML `t` attribute value
    /// (e.g., `6` = "str", `4` = "e", `3` = "b"). Used for round-trip fidelity
    /// to emit the correct `t="str"` on cells whose formula evaluates to a string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula_result_type: Option<u8>,
    /// Whether the formula cell had an explicit empty `<v/>` element in the original XML.
    /// When true, the writer emits `<v/>` even though the cached value is null/empty.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub has_empty_cached_value: bool,
    /// Value metadata index from the `vm` attribute on the `<c>` element.
    /// Used for rich value types (linked data types, images-in-cells).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    /// Original shared string table index for `t="s"` cells.
    /// Used for round-trip fidelity when the SST contains both plain and rich text
    /// entries for the same text content (they have different indices).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_sst_index: Option<u32>,
    /// Original raw value string from the `<v>` element for round-trip fidelity.
    /// Preserves the exact numeric representation (e.g., scientific notation)
    /// that Excel wrote, so the writer can emit it back unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_value: Option<String>,
    /// Parser-owned projection/spill role. Consumers must not infer deletion or
    /// storage omission from `cm` alone.
    #[serde(default, skip_serializing_if = "ImportedCellProjectionRole::is_normal")]
    pub projection_role: ImportedCellProjectionRole,
}

/// Compact coverage for authored style-only worksheet cells.
///
/// Bounds are zero-based and inclusive. `style_id` follows the same boundary
/// contract as [`CellData::style_id`]: raw `cellXfs` index on the lossless
/// stylesheet path, palette index on lossy/generated style paths. A value of
/// `0` is meaningful and represents an explicit source `s="0"`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoredStyleRun {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    pub style_id: u32,
}

/// Row and column dimension information for a sheet.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetDimensions {
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    /// Default row descent (x14ac:dyDescent on sheetFormatPr) — text baseline offset in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_row_descent: Option<f64>,
    /// Base column width (baseColWidth on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_col_width: Option<u32>,
    /// Whether the default row height is custom (customHeight="1" on sheetFormatPr).
    #[serde(default)]
    pub custom_height: bool,
    /// Outline level for rows (outlineLevelRow on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level_row: Option<u8>,
    /// Outline level for columns (outlineLevelCol on sheetFormatPr) — roundtrip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline_level_col: Option<u8>,
    pub row_heights: Vec<RowDimension>,
    pub col_widths: Vec<ColDimension>,
    /// Column ranges that extend beyond the data region (typically `max=16384`).
    /// Preserved as-is for round-trip fidelity — these are not expanded into
    /// individual ColDimension entries because no ColIds are allocated for them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trailing_col_ranges: Vec<TrailingColRange>,
}

/// Dimension data for a single row.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowDimension {
    pub row: u32,
    pub height: f64,
    pub custom_height: bool,
    pub hidden: bool,
    /// Whether the row has customFormat="1" without an explicit style (s attribute).
    /// This preserves the flag for round-trip fidelity.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub custom_format: bool,
    /// Per-row text baseline descent (x14ac:dyDescent attribute).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descent: Option<f64>,
}

/// Dimension data for a single column.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColDimension {
    pub col: u32,
    pub width: f64,
    pub custom_width: bool,
    pub hidden: bool,
    pub best_fit: bool,
    /// Whether the outline group is collapsed at this column.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
}

/// A column range that extends beyond the data region, preserved for round-trip fidelity.
///
/// In OOXML, `<col max="16384">` means "apply this style/width to all columns
/// from `min` through XFD (the last column)". These ranges cannot be stored as
/// individual ColDimension entries because no ColIds are allocated beyond the
/// data region. Instead they are stored as opaque metadata through Yrs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrailingColRange {
    /// Start column (1-indexed, as in OOXML `<col min>`).
    pub min: u32,
    /// End column (1-indexed, as in OOXML `<col max>`). 16384 = XFD = last column.
    pub max: u32,
    pub width: f64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub custom_width: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub best_fit: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
    /// Column style index from the original XLSX (cellXfs index).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<u32>,
}

/// Frozen pane configuration.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenPane {
    pub rows: u32,
    pub cols: u32,
    pub top_left_cell: Option<String>,
}

/// Sheet view settings (zoom, visibility toggles, scroll position).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetView {
    pub show_gridlines: bool,
    pub show_row_col_headers: bool,
    pub show_zeros: bool,
    pub show_outline_symbols: bool,
    pub show_formulas: bool,
    pub right_to_left: bool,
    /// Whether to show ruler in page layout view (default: true).
    #[serde(default = "crate::default_true")]
    pub show_ruler: bool,
    /// Whether to show white space in page layout view (default: true).
    #[serde(default = "crate::default_true")]
    pub show_white_space: bool,
    /// Whether the default grid color is used (default: true).
    #[serde(default = "crate::default_true")]
    pub default_grid_color: bool,
    /// Whether the window is protected from resizing.
    #[serde(default)]
    pub window_protection: bool,
    /// Indexed color value for grid lines (legacy). None means default (64).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_id: Option<u32>,
    pub zoom_scale: Option<u32>,
    pub zoom_scale_normal: Option<u32>,
    /// View type: "normal" (default, omitted), "pageBreakPreview", or "pageLayout".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    /// Zoom scale for page layout view (zoomScalePageLayoutView).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom_scale_page_layout_view: Option<u32>,
    /// Zoom scale for page break preview (zoomScaleSheetLayoutView).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom_scale_sheet_layout_view: Option<u32>,
    pub scroll_row: u32,
    pub scroll_col: u32,
    /// Whether the original file had an explicit `topLeftCell` attribute on `<sheetView>`.
    /// When true, `topLeftCell` is emitted even if scroll_row/scroll_col are both 0
    /// (i.e., the attribute value is the default "A1").
    #[serde(default)]
    pub has_explicit_top_left_cell: bool,
    pub tab_selected: bool,
    /// Active cell reference from `<selection activeCell="...">` (e.g. "E16").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_cell: Option<String>,
    /// Selection range from `<selection sqref="...">` (e.g. "E16" or "A1:B5").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sqref: Option<String>,
    /// All selection elements for round-trip fidelity.
    /// When present, these are used instead of active_cell/sqref to preserve
    /// multi-pane selections (frozen pane sheets have up to 4 selection elements).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selections: Vec<ooxml_types::worksheet::Selection>,
}

impl Default for SheetView {
    fn default() -> Self {
        Self {
            show_gridlines: true,
            show_row_col_headers: true,
            show_zeros: true,
            show_outline_symbols: true,
            show_formulas: false,
            right_to_left: false,
            show_ruler: true,
            show_white_space: true,
            default_grid_color: true,
            window_protection: false,
            color_id: None,
            zoom_scale: None,
            zoom_scale_normal: None,
            view: None,
            zoom_scale_page_layout_view: None,
            zoom_scale_sheet_layout_view: None,
            scroll_row: 0,
            scroll_col: 0,
            has_explicit_top_left_cell: false,
            tab_selected: false,
            active_cell: None,
            sqref: None,
            selections: Vec::new(),
        }
    }
}

// MergeRegion is defined in domain::merge and re-exported via `use crate::domain::*` above.

/// Style override for an entire row.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowStyleEntry {
    pub row: u32,
    pub style_id: u32,
}

/// Style override for an entire column.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColStyleEntry {
    pub col: u32,
    pub style_id: u32,
}
