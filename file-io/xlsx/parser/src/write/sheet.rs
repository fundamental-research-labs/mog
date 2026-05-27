//! XLSX Worksheet XML writer.
//!
//! This module generates `xl/worksheets/sheet{n}.xml` files containing:
//! - Sheet dimensions
//! - Column widths
//! - Row heights
//! - Cell data (values, formulas, types)
//! - Merge cells
//! - Frozen panes
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::SheetWriter;
//!
//! let xml = SheetWriter::new()
//!     .set_col_width(0, 15.0)
//!     .set_number(0, 0, 42.0)
//!     .set_string(0, 1, 0)
//!     .set_formula(1, 0, "A1*2")
//!     .set_frozen(1, 1)
//!     .add_merge(0, 2, 0, 4)
//!     .to_xml();
//! ```

use super::xml_writer::XmlWriter;
pub use crate::common::range::{ColWidth, MergeRange, SheetPane};
use crate::domain::print::write::{PrintWriter, format_f64};
use crate::domain::worksheet::write::{
    write_cols, write_dimensions, write_merge_cells, write_sheet_format_pr, write_sheet_views,
};
use domain_types::AuthoredStyleRun;
pub use ooxml_types::worksheet::{Selection, SheetView, SheetViewType};
use std::collections::BTreeMap;

/// XML namespace for SpreadsheetML
const SPREADSHEET_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
/// XML namespace for relationships
const RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ============================================================================
// Sheet Format Properties
// ============================================================================

/// Sheet format properties (`<sheetFormatPr>`).
///
/// Controls default row height, column width, and outline settings.
#[derive(Debug, Clone)]
pub struct SheetFormatPr {
    /// Default row height in points.
    pub default_row_height: f64,
    /// Default column width in character units.
    pub default_col_width: Option<f64>,
    /// Base column width in character units (baseColWidth attribute).
    pub base_col_width: Option<u32>,
    /// Whether the default row height is a custom value (customHeight="1").
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight="1").
    pub zero_height: bool,
    /// Outline level for rows.
    pub outline_level_row: Option<u8>,
    /// Outline level for columns.
    pub outline_level_col: Option<u8>,
    /// x14ac:dyDescent — default text baseline descent in points.
    pub default_row_descent: Option<f64>,
}

impl Default for SheetFormatPr {
    fn default() -> Self {
        Self {
            default_row_height: 15.0,
            default_col_width: None,
            base_col_width: None,
            custom_height: false,
            zero_height: false,
            outline_level_row: None,
            outline_level_col: None,
            default_row_descent: None,
        }
    }
}

// ============================================================================
// Cell Value Types
// ============================================================================

/// Cell value types for writing.
#[derive(Debug, Clone)]
pub enum CellValue {
    /// Empty cell (no value)
    Empty,
    /// Numeric value
    Number(f64),
    /// Shared string index
    String(usize),
    /// Inline string (not in shared strings table) — writes t="inlineStr" with <is><t>
    InlineString(String),
    /// Formula-result string — writes t="str" with plain <v>
    FormulaString(String),
    /// Boolean value
    Boolean(bool),
    /// Error value (e.g., #VALUE!, #REF!, #DIV/0!)
    Error(String),
    /// Formula with optional cached value
    Formula {
        formula: String,
        cached_value: Option<Box<CellValue>>,
        /// OOXML formula metadata for round-trip. When present, controls how
        /// the `<f>` element is emitted (shared, array, etc.).
        cell_formula: Option<ooxml_types::worksheet::CellFormula>,
    },
}

impl Default for CellValue {
    fn default() -> Self {
        CellValue::Empty
    }
}

// ============================================================================
// Cell Data
// ============================================================================

/// Cell data for writing.
#[derive(Debug, Clone)]
pub struct CellData {
    /// Row index (0-indexed)
    pub row: u32,
    /// Column index (0-indexed)
    pub col: u32,
    /// Cell value
    pub value: CellValue,
    /// Style index (references styles.xml cellXfs)
    pub style_index: Option<u32>,
    /// Original string representation of a numeric value from the source file.
    /// When present, the writer uses this verbatim instead of re-formatting the
    /// f64, avoiding precision loss during round-trip (e.g. `4.9400000000000004`
    /// staying as-is rather than being shortened to `4.94`).
    pub original_value: Option<String>,
    /// Whether the formula has `ca="1"` (calculate always / volatile).
    /// When true, the writer emits `ca="1"` on the `<f>` element.
    pub force_recalc: bool,
    /// Whether the `<c>` element has a `cm` attribute (cell metadata index).
    /// When true, the writer emits `cm="1"` on the `<c>` element.
    pub cm: bool,
    /// Value metadata index from the `vm` attribute on the `<c>` element.
    /// When present, the writer emits `vm="N"` on the `<c>` element.
    pub vm: Option<u32>,
    /// Whether the `<f>` element had `xml:space="preserve"` in the original XML.
    /// When true, the writer emits `xml:space="preserve"` on the `<f>` element.
    pub preserve_space_formula: bool,
    /// Whether the `<v>` element had `xml:space="preserve"` in the original XML.
    /// When true, the writer emits `xml:space="preserve"` on the `<v>` element.
    pub preserve_space_value: bool,
    /// Explicit type attribute for empty cells that had a type in the original XML
    /// (e.g., `t="s"` on an empty cell). When set, the writer emits this type even
    /// though the value is `CellValue::Empty`.
    pub explicit_type: Option<String>,
    /// Explicit type override for formula cells with no cached value.
    /// When the original XML had `t="str"` (or `t="e"`, `t="b"`) on a formula cell
    /// but no `<v>` element, this field preserves that type hint.
    pub formula_type_hint: Option<String>,
}

impl CellData {
    /// Create a new cell with a value.
    pub fn new(row: u32, col: u32, value: CellValue) -> Self {
        Self {
            row,
            col,
            value,
            style_index: None,
            original_value: None,
            force_recalc: false,
            cm: false,
            vm: None,
            preserve_space_formula: false,
            preserve_space_value: false,
            explicit_type: None,
            formula_type_hint: None,
        }
    }

    /// Create a new cell with a value and style.
    pub fn with_style(row: u32, col: u32, value: CellValue, style: u32) -> Self {
        Self {
            row,
            col,
            value,
            style_index: Some(style),
            original_value: None,
            force_recalc: false,
            cm: false,
            vm: None,
            preserve_space_formula: false,
            preserve_space_value: false,
            explicit_type: None,
            formula_type_hint: None,
        }
    }
}

// ============================================================================
// Row Definition
// ============================================================================

/// Row definition with optional height and styling.
#[derive(Debug, Clone, Default)]
pub struct RowDef {
    /// Row height in points
    pub height: Option<f64>,
    /// Original string representation of the height attribute for round-trip fidelity.
    pub height_str: Option<String>,
    /// Whether this is a custom height
    pub custom_height: bool,
    /// Whether the row is hidden.
    /// `None` = not present, `Some(false)` = explicitly "0", `Some(true)` = "1".
    pub hidden: Option<bool>,
    /// Style index for the row
    pub style: Option<u32>,
    /// Whether the row has a custom format applied (customFormat="1").
    /// Can be true even when style is None (implies s="0").
    pub custom_format: bool,
    /// Outline level for grouping
    pub outline_level: Option<u8>,
    /// Whether the outline is collapsed.
    /// `None` = not present, `Some(false)` = explicitly "0", `Some(true)` = "1".
    pub collapsed: Option<bool>,
    /// Whether a thick top border should be drawn
    pub thick_top: bool,
    /// Whether a thick bottom border should be drawn
    pub thick_bot: bool,
    /// x14ac:dyDescent — text baseline descent in points
    pub descent: Option<f64>,
    /// Original spans attribute value for roundtrip fidelity (e.g. "1:55")
    pub spans: Option<String>,
    /// Whether this is a bare empty row (`<row r="N"/>`) that must survive round-trip
    pub bare_empty: bool,
}

impl RowDef {
    /// Create a new row definition with height.
    pub fn with_height(height: f64) -> Self {
        Self {
            height: Some(height),
            custom_height: true,
            ..Default::default()
        }
    }

    /// Set the hidden flag.
    pub fn hidden(mut self, hidden: bool) -> Self {
        self.hidden = Some(hidden);
        self
    }

    /// Set the style index.
    pub fn style(mut self, style: u32) -> Self {
        self.style = Some(style);
        self
    }

    /// Set the outline level.
    pub fn outline_level(mut self, level: u8) -> Self {
        self.outline_level = Some(level);
        self
    }

    /// Set the collapsed flag.
    pub fn collapsed(mut self, collapsed: bool) -> Self {
        self.collapsed = Some(collapsed);
        self
    }
}

fn authored_style_cells_for_row(
    row_idx: u32,
    cells: &[CellData],
    authored_style_runs: &[&AuthoredStyleRun],
) -> Vec<CellData> {
    if authored_style_runs.is_empty() {
        return Vec::new();
    }

    let occupied: std::collections::HashSet<u32> = cells.iter().map(|cell| cell.col).collect();
    let mut by_col: BTreeMap<u32, u32> = BTreeMap::new();
    for run in authored_style_runs {
        if row_idx < run.start_row || row_idx > run.end_row {
            continue;
        }
        for col in run.start_col..=run.end_col {
            if !occupied.contains(&col) {
                by_col.insert(col, run.style_id);
            }
        }
    }

    by_col
        .into_iter()
        .map(|(col, style_id)| CellData::with_style(row_idx, col, CellValue::Empty, style_id))
        .collect()
}

// ============================================================================
// Sheet Writer
// ============================================================================

/// The main sheet writer.
///
/// Generates worksheet XML for XLSX files.
#[derive(Debug, Clone)]
pub struct SheetWriter {
    /// Sheet dimension (startRow, startCol, endRow, endCol), all 0-indexed
    dimension: Option<(u32, u32, u32, u32)>,
    /// Raw dimension ref string for round-trip fidelity (e.g. "A1" instead of "A1:A1")
    dimension_ref: Option<String>,
    /// Column definitions
    cols: Vec<ColWidth>,
    /// Row data: row index -> (RowDef, cells)
    rows: BTreeMap<u32, (RowDef, Vec<CellData>)>,
    /// Authored style-only blank cell coverage.
    authored_style_runs: Vec<AuthoredStyleRun>,
    /// Merge ranges
    merges: Vec<MergeRange>,
    /// Whether to emit the `count` attribute on `<mergeCells>` (round-trip fidelity).
    merge_cells_emit_count: bool,
    /// Sheet view settings (one or more `<sheetView>` elements)
    sheet_views: Vec<SheetView>,
    /// Print settings (margins, page setup, header/footer, print options, breaks)
    print_writer: Option<PrintWriter>,
    /// Sheet format properties (default row height, column width)
    sheet_format_pr: SheetFormatPr,
    /// Stable sheet identity for co-authoring (xr:uid on <worksheet> root)
    uid: Option<String>,
    /// Tier 2: Captured namespace declarations for round-trip fidelity
    preserved_namespaces: Option<crate::roundtrip::namespaces::NamespaceMap>,
    /// Tier 2: Captured unknown child elements for round-trip fidelity
    preserved_elements: Option<crate::roundtrip::unknown_elements::PreservedElements>,
    /// Raw autoFilter XML for verbatim round-trip passthrough.
    auto_filter_xml: Option<String>,
    /// Raw sortState XML for verbatim round-trip passthrough.
    sort_state_xml: Option<String>,
    /// Raw conditionalFormatting XML for verbatim round-trip passthrough.
    conditional_formatting_xml: Option<String>,
    /// Raw dataValidations XML for verbatim round-trip passthrough.
    data_validations_xml: Option<String>,
    /// Raw customProperties XML for verbatim round-trip passthrough.
    custom_properties_xml: Option<String>,
    /// Relationship ID for `<legacyDrawing r:id="..."/>` element.
    /// Links to the VML drawing part for comments, form controls, etc.
    legacy_drawing_r_id: Option<String>,
    /// Relationship ID for `<legacyDrawingHF r:id="..."/>` element.
    /// Links to the VML drawing part for header/footer images.
    legacy_drawing_hf_r_id: Option<String>,
    /// Relationship ID for `<drawing r:id="..."/>` element.
    /// Links to the DrawingML drawing part.
    drawing_r_id: Option<String>,
    /// Hyperlinks for round-trip fidelity.
    hyperlinks: Vec<crate::output::results::HyperlinkOutput>,
    /// Raw sheetProtection XML for verbatim passthrough.
    sheet_protection_xml: Option<String>,
    /// Raw mc:AlternateContent controls XML for form controls.
    controls_xml: Option<String>,
    /// Raw tableParts XML for verbatim passthrough.
    table_parts_xml: Option<String>,
    /// Relationship IDs for generated worksheet pivot table references.
    pivot_table_r_ids: Vec<String>,
    /// Relationship IDs for clean imported pivot table references whose
    /// worksheet markers should be replayed from preserved raw XML, if present.
    preserved_pivot_table_r_ids: Vec<String>,
    /// Raw extLst XML for sparklines and other extensions.
    ext_lst_xml: Option<String>,
}

impl Default for SheetWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl SheetWriter {
    /// Create a new sheet writer.
    pub fn new() -> Self {
        Self {
            dimension: None,
            dimension_ref: None,
            cols: Vec::new(),
            rows: BTreeMap::new(),
            authored_style_runs: Vec::new(),
            merges: Vec::new(),
            merge_cells_emit_count: true,
            sheet_views: vec![SheetView::default()],
            print_writer: None,
            sheet_format_pr: SheetFormatPr::default(),
            uid: None,
            preserved_namespaces: None,
            preserved_elements: None,
            auto_filter_xml: None,
            sort_state_xml: None,
            conditional_formatting_xml: None,
            data_validations_xml: None,
            custom_properties_xml: None,
            legacy_drawing_r_id: None,
            legacy_drawing_hf_r_id: None,
            drawing_r_id: None,
            hyperlinks: Vec::new(),
            sheet_protection_xml: None,
            controls_xml: None,
            table_parts_xml: None,
            pivot_table_r_ids: Vec::new(),
            preserved_pivot_table_r_ids: Vec::new(),
            ext_lst_xml: None,
        }
    }

    /// Set sheet dimension explicitly.
    ///
    /// # Arguments
    /// * `start_row` - Start row (0-indexed)
    /// * `start_col` - Start column (0-indexed)
    /// * `end_row` - End row (0-indexed)
    /// * `end_col` - End column (0-indexed)
    pub fn set_dimension(
        &mut self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> &mut Self {
        self.dimension = Some((start_row, start_col, end_row, end_col));
        self
    }

    /// Set the raw dimension ref string for round-trip fidelity.
    ///
    /// When set, the writer uses this verbatim instead of computing
    /// "start:end" from the numeric coordinates. Useful for preserving
    /// single-cell refs like "A1" that would otherwise become "A1:A1".
    pub fn set_dimension_ref(&mut self, dim_ref: String) -> &mut Self {
        self.dimension_ref = Some(dim_ref);
        self
    }

    /// Add a column width definition.
    ///
    /// If the new col is adjacent to (and has identical properties as) the last
    /// added col, the two are merged into a single range. This ensures trailing
    /// column ranges (e.g., `<col max="16384">`) rejoin cleanly with the
    /// preceding data-region range after a Yrs round-trip.
    pub fn add_col(&mut self, col: ColWidth) -> &mut Self {
        if let Some(last) = self.cols.last_mut() {
            if last.max + 1 == col.min
                && last.width == col.width
                && last.custom_width == col.custom_width
                && last.hidden == col.hidden
                && last.best_fit == col.best_fit
                && last.style == col.style
                && last.outline_level == col.outline_level
                && last.collapsed == col.collapsed
            {
                last.max = col.max;
                return self;
            }
        }
        self.cols.push(col);
        self
    }

    /// Set column width (convenience method).
    ///
    /// # Arguments
    /// * `col` - Column index (0-indexed)
    /// * `width` - Column width in character units
    pub fn set_col_width(&mut self, col: u32, width: f64) -> &mut Self {
        let col_1indexed = col + 1;
        let mut col_width = ColWidth::range(col_1indexed, col_1indexed, width);
        col_width.custom_width = true;
        self.cols.push(col_width);
        self
    }

    /// Set outline level and hidden flag on a column.
    ///
    /// If the column already has a `ColWidth` entry, updates it in place.
    /// Otherwise creates a minimal entry with no custom width.
    ///
    /// # Arguments
    /// * `col` - Column index (0-indexed)
    /// * `level` - Outline level (1-7)
    /// * `hidden` - Whether the column is hidden
    pub fn set_col_outline(&mut self, col: u32, level: u8, hidden: bool) -> &mut Self {
        let col_1indexed = col + 1;
        // Try to find existing ColWidth entry for this column
        if let Some(cw) = self
            .cols
            .iter_mut()
            .find(|c| c.min == col_1indexed && c.max == col_1indexed)
        {
            cw.outline_level = Some(level);
            if hidden {
                cw.hidden = true;
            }
        } else {
            // Create a minimal col entry with no custom width
            let mut cw = ColWidth::range(col_1indexed, col_1indexed, 0.0);
            cw.width = None;
            cw.outline_level = Some(level);
            cw.hidden = hidden;
            self.cols.push(cw);
        }
        self
    }

    /// Set collapsed flag on a column.
    ///
    /// If the column already has a `ColWidth` entry, updates it in place.
    /// Otherwise creates a minimal entry.
    ///
    /// # Arguments
    /// * `col` - Column index (0-indexed)
    /// * `collapsed` - Whether the outline group is collapsed
    pub fn set_col_collapsed(&mut self, col: u32, collapsed: bool) -> &mut Self {
        let col_1indexed = col + 1;
        if let Some(cw) = self
            .cols
            .iter_mut()
            .find(|c| c.min == col_1indexed && c.max == col_1indexed)
        {
            cw.collapsed = collapsed;
        } else {
            let mut cw = ColWidth::range(col_1indexed, col_1indexed, 0.0);
            cw.width = None;
            cw.collapsed = collapsed;
            self.cols.push(cw);
        }
        self
    }

    /// Set the max row outline level on `<sheetFormatPr>`.
    pub fn set_sheet_format_outline_level_row(&mut self, level: u8) -> &mut Self {
        self.sheet_format_pr.outline_level_row = Some(level);
        self
    }

    /// Set the max column outline level on `<sheetFormatPr>`.
    pub fn set_sheet_format_outline_level_col(&mut self, level: u8) -> &mut Self {
        self.sheet_format_pr.outline_level_col = Some(level);
        self
    }

    /// Set row height (marks as custom height).
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `height` - Row height in points
    pub fn set_row_height(&mut self, row: u32, height: f64) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.height = Some(height);
        entry.0.custom_height = true;
        self
    }

    /// Set row height without marking as custom height.
    ///
    /// Use this for round-trip fidelity when the original XML did not have
    /// `customHeight="1"` on the row element.
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `height` - Row height in points
    pub fn set_row_height_no_custom(&mut self, row: u32, height: f64) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.height = Some(height);
        self
    }

    /// Set the original height string for round-trip fidelity.
    ///
    /// When the original XML uses a float representation that differs from
    /// the canonical f64 formatting (e.g., "17.399999999999999" vs "17.4"),
    /// this preserves the exact original text.
    pub fn set_row_height_str(&mut self, row: u32, height_str: String) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.height_str = Some(height_str);
        self
    }

    /// Set row as hidden.
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `hidden` - Whether the row is hidden
    pub fn set_row_hidden(&mut self, row: u32, hidden: bool) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.hidden = Some(hidden);
        self
    }

    /// Set row outline level for grouping.
    pub fn set_row_outline_level(&mut self, row: u32, level: u8) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.outline_level = Some(level);
        self
    }

    /// Set row collapsed flag.
    pub fn set_row_collapsed(&mut self, row: u32, collapsed: bool) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.collapsed = Some(collapsed);
        self
    }

    /// Set row thick top border flag.
    pub fn set_row_thick_top(&mut self, row: u32, thick_top: bool) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.thick_top = thick_top;
        self
    }

    /// Set row thick bottom border flag.
    pub fn set_row_thick_bot(&mut self, row: u32, thick_bot: bool) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.thick_bot = thick_bot;
        self
    }

    /// Set row style index (also sets `custom_format = true`).
    pub fn set_row_style(&mut self, row: u32, style: u32) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.style = Some(style);
        entry.0.custom_format = true;
        self
    }

    /// Set the customFormat flag on a row (for rows with customFormat="1" but no s attribute).
    pub fn set_row_custom_format(&mut self, row: u32, custom_format: bool) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.custom_format = custom_format;
        self
    }

    /// Set row descent (x14ac:dyDescent).
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `descent` - Text baseline descent in points
    pub fn set_row_descent(&mut self, row: u32, descent: f64) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.descent = Some(descent);
        self
    }

    /// Set original row spans attribute for roundtrip fidelity.
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `spans` - Original spans string (e.g. "1:55")
    pub fn set_row_spans(&mut self, row: u32, spans: String) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.spans = Some(spans);
        self
    }

    /// Mark a row as a bare empty row (exists in original XML but has no attributes or cells).
    /// This ensures the row survives the round-trip even though it has no data.
    pub fn mark_bare_empty_row(&mut self, row: u32) -> &mut Self {
        // Just ensure the row entry exists; the default RowDef with no properties
        // will be enough since we'll check `is_bare_empty` in write_row.
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.bare_empty = true;
        self
    }

    /// Add a cell.
    pub fn add_cell(&mut self, cell: CellData) -> &mut Self {
        let entry = self
            .rows
            .entry(cell.row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.1.push(cell);
        self
    }

    /// Add compact authored style-only blank coverage.
    pub fn add_authored_style_run(&mut self, run: AuthoredStyleRun) -> &mut Self {
        if run.start_row <= run.end_row && run.start_col <= run.end_col {
            self.authored_style_runs.push(run);
        }
        self
    }

    /// Add cell with number value (convenience method).
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `col` - Column index (0-indexed)
    /// * `value` - Numeric value
    pub fn set_number(&mut self, row: u32, col: u32, value: f64) -> &mut Self {
        self.add_cell(CellData::new(row, col, CellValue::Number(value)))
    }

    /// Add cell with shared string index (convenience method).
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `col` - Column index (0-indexed)
    /// * `string_index` - Index into shared strings table
    pub fn set_string(&mut self, row: u32, col: u32, string_index: usize) -> &mut Self {
        self.add_cell(CellData::new(row, col, CellValue::String(string_index)))
    }

    /// Add cell with inline string (convenience method).
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `col` - Column index (0-indexed)
    /// * `value` - String value
    pub fn set_inline_string(&mut self, row: u32, col: u32, value: &str) -> &mut Self {
        self.add_cell(CellData::new(
            row,
            col,
            CellValue::InlineString(value.to_string()),
        ))
    }

    /// Add cell with formula (convenience method).
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `col` - Column index (0-indexed)
    /// * `formula` - Formula string (without leading =)
    pub fn set_formula(&mut self, row: u32, col: u32, formula: &str) -> &mut Self {
        self.add_cell(CellData::new(
            row,
            col,
            CellValue::Formula {
                formula: formula.to_string(),
                cached_value: None,
                cell_formula: None,
            },
        ))
    }

    /// Add cell with formula and cached value.
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `col` - Column index (0-indexed)
    /// * `formula` - Formula string (without leading =)
    /// * `cached` - Cached value from last calculation
    pub fn set_formula_with_value(
        &mut self,
        row: u32,
        col: u32,
        formula: &str,
        cached: CellValue,
    ) -> &mut Self {
        self.add_cell(CellData::new(
            row,
            col,
            CellValue::Formula {
                formula: formula.to_string(),
                cached_value: Some(Box::new(cached)),
                cell_formula: None,
            },
        ))
    }

    /// Add cell with boolean value (convenience method).
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `col` - Column index (0-indexed)
    /// * `value` - Boolean value
    pub fn set_boolean(&mut self, row: u32, col: u32, value: bool) -> &mut Self {
        self.add_cell(CellData::new(row, col, CellValue::Boolean(value)))
    }

    /// Add cell with error value (convenience method).
    ///
    /// # Arguments
    /// * `row` - Row index (0-indexed)
    /// * `col` - Column index (0-indexed)
    /// * `error` - Error string (e.g., "#VALUE!", "#REF!")
    pub fn set_error(&mut self, row: u32, col: u32, error: &str) -> &mut Self {
        self.add_cell(CellData::new(row, col, CellValue::Error(error.to_string())))
    }

    /// Add a merge range.
    ///
    /// # Arguments
    /// * `start_row` - Start row (0-indexed)
    /// * `start_col` - Start column (0-indexed)
    /// * `end_row` - End row (0-indexed)
    /// * `end_col` - End column (0-indexed)
    pub fn add_merge(
        &mut self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> &mut Self {
        self.merges.push(MergeRange::from_coords(
            start_row, start_col, end_row, end_col,
        ));
        self
    }

    /// Set whether to emit the `count` attribute on `<mergeCells>`.
    /// Default is `true`; set to `false` for round-trip fidelity when the
    /// original file omitted the optional attribute.
    pub fn set_merge_cells_emit_count(&mut self, emit: bool) -> &mut Self {
        self.merge_cells_emit_count = emit;
        self
    }

    /// Set frozen panes.
    ///
    /// # Arguments
    /// * `rows` - Number of rows to freeze
    /// * `cols` - Number of columns to freeze
    pub fn set_frozen(&mut self, rows: u32, cols: u32) -> &mut Self {
        // Apply frozen pane to the first sheet view (create one if empty)
        if self.sheet_views.is_empty() {
            self.sheet_views.push(SheetView::default());
        }
        let sv = &mut self.sheet_views[0];
        if rows > 0 || cols > 0 {
            let pane = SheetPane::frozen(rows, cols);
            // Add a default selection for the active pane — Excel expects this
            // when creating frozen panes programmatically.
            let active_pane = pane.effective_active_pane();
            sv.selections = vec![Selection {
                pane: Some(active_pane),
                active_cell: pane.top_left_cell.clone(),
                active_cell_id: None,
                sqref: pane.top_left_cell.clone(),
            }];
            sv.pane = Some(pane);
        } else {
            sv.pane = None;
            sv.selections.clear();
        }
        self
    }

    /// Configure sheet view settings (replaces the first/only view).
    pub fn set_view(&mut self, view: SheetView) -> &mut Self {
        self.sheet_views = vec![view];
        self
    }

    /// Set all sheet views for round-trip fidelity of multiple `<sheetView>` elements.
    pub fn set_views(&mut self, views: Vec<SheetView>) -> &mut Self {
        self.sheet_views = views;
        self
    }

    /// Set print settings for this sheet.
    pub fn set_print_writer(&mut self, pw: PrintWriter) -> &mut Self {
        self.print_writer = Some(pw);
        self
    }

    /// Get or create the print writer for this sheet.
    ///
    /// Returns a mutable reference to the existing `PrintWriter` or creates a
    /// new one if none exists. Useful for adding page breaks to a sheet that
    /// may or may not already have print settings.
    pub fn ensure_print_writer(&mut self) -> &mut PrintWriter {
        self.print_writer.get_or_insert_with(PrintWriter::new)
    }

    /// Set sheet format properties (default row height, column width, etc.).
    pub fn set_sheet_format_pr(&mut self, fmt: SheetFormatPr) -> &mut Self {
        self.sheet_format_pr = fmt;
        self
    }

    /// Set the stable sheet identity UID (xr:uid on `<worksheet>` root).
    pub fn set_uid(&mut self, uid: String) -> &mut Self {
        self.uid = Some(uid);
        self
    }

    /// Set preserved namespace declarations for round-trip fidelity.
    pub fn set_preserved_namespaces(
        &mut self,
        ns: crate::roundtrip::namespaces::NamespaceMap,
    ) -> &mut Self {
        self.preserved_namespaces = Some(ns);
        self
    }

    /// Set preserved unknown elements for round-trip fidelity.
    pub fn set_preserved_elements(
        &mut self,
        elements: crate::roundtrip::unknown_elements::PreservedElements,
    ) -> &mut Self {
        self.preserved_elements = Some(elements);
        self
    }

    /// Set raw autoFilter XML for verbatim round-trip passthrough.
    pub fn set_auto_filter_xml(&mut self, xml: String) -> &mut Self {
        self.auto_filter_xml = Some(xml);
        self
    }

    /// Set raw sortState XML for verbatim round-trip passthrough.
    pub fn set_sort_state_xml(&mut self, xml: String) -> &mut Self {
        self.sort_state_xml = Some(xml);
        self
    }

    /// Set raw conditionalFormatting XML for verbatim round-trip passthrough.
    pub fn set_conditional_formatting_xml(&mut self, xml: String) -> &mut Self {
        self.conditional_formatting_xml = Some(xml);
        self
    }

    /// Set raw dataValidations XML for verbatim round-trip passthrough.
    pub fn set_data_validations_xml(&mut self, xml: String) -> &mut Self {
        self.data_validations_xml = Some(xml);
        self
    }

    /// Set raw customProperties XML for verbatim round-trip passthrough.
    pub fn set_custom_properties_xml(&mut self, xml: String) -> &mut Self {
        self.custom_properties_xml = Some(xml);
        self
    }

    /// Set raw sheetProtection XML for verbatim passthrough.
    pub fn set_sheet_protection_xml(&mut self, xml: String) -> &mut Self {
        self.sheet_protection_xml = Some(xml);
        self
    }

    /// Set raw tableParts XML for verbatim passthrough.
    pub fn set_table_parts_xml(&mut self, xml: String) -> &mut Self {
        self.table_parts_xml = Some(xml);
        self
    }

    /// Set generated worksheet pivot table relationship references.
    pub fn set_pivot_table_r_ids(&mut self, r_ids: Vec<String>) -> &mut Self {
        self.pivot_table_r_ids = r_ids;
        self
    }

    /// Set clean imported worksheet pivot table relationship references.
    pub fn set_preserved_pivot_table_r_ids(&mut self, r_ids: Vec<String>) -> &mut Self {
        self.preserved_pivot_table_r_ids = r_ids;
        self
    }

    /// Set raw extLst XML for sparklines and other extensions.
    pub fn set_ext_lst_xml(&mut self, xml: String) -> &mut Self {
        self.ext_lst_xml = Some(xml);
        self
    }

    /// Set raw mc:AlternateContent controls XML for form controls.
    pub fn set_controls_xml(&mut self, xml: String) -> &mut Self {
        self.controls_xml = Some(xml);
        self
    }

    /// Check if legacy_drawing_r_id has been set.
    pub fn has_legacy_drawing_r_id(&self) -> bool {
        self.legacy_drawing_r_id.is_some()
    }

    fn should_skip_preserved_pivot_table_definition(
        &self,
        raw_xml: &str,
        skip_generated_pivot_markers: bool,
    ) -> bool {
        if !skip_generated_pivot_markers || !raw_xml.contains("pivotTableDefinition") {
            return false;
        }

        !self.preserved_pivot_table_r_ids.iter().any(|r_id| {
            raw_xml.contains(&format!("r:id=\"{}\"", r_id))
                || raw_xml.contains(&format!("id=\"{}\"", r_id))
        })
    }

    /// Set the relationship ID for `<legacyDrawing r:id="..."/>`.
    pub fn set_legacy_drawing_r_id(&mut self, r_id: String) -> &mut Self {
        self.legacy_drawing_r_id = Some(r_id);
        self
    }

    /// Set the relationship ID for `<legacyDrawingHF r:id="..."/>`.
    pub fn set_legacy_drawing_hf_r_id(&mut self, r_id: String) -> &mut Self {
        self.legacy_drawing_hf_r_id = Some(r_id);
        self
    }

    /// Set the relationship ID for `<drawing r:id="..."/>`.
    pub fn set_drawing_r_id(&mut self, r_id: String) -> &mut Self {
        self.drawing_r_id = Some(r_id);
        self
    }

    /// Set hyperlinks for round-trip fidelity.
    pub fn set_hyperlinks(
        &mut self,
        hyperlinks: Vec<crate::output::results::HyperlinkOutput>,
    ) -> &mut Self {
        self.hyperlinks = hyperlinks;
        self
    }

    /// Generate worksheet XML.
    pub fn to_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        // XML declaration
        w.write_declaration();

        // Check which Tier 1 extension namespaces are needed
        let has_descent = self.sheet_format_pr.default_row_descent.is_some()
            || self.rows.values().any(|(rd, _)| rd.descent.is_some());
        let has_uid = self.uid.is_some()
            || self
                .data_validations_xml
                .as_ref()
                .map_or(false, |xml| xml.contains("xr:uid"));

        // Build mc:Ignorable from Tier 1 + Tier 2 prefixes.
        // When preserved namespaces exist, let add_from_namespace_map control the order
        // so that the mc:Ignorable value matches the original document order.
        // Only add Tier 1 prefixes first in fresh-write mode (no preserved namespaces).
        use crate::write::mc_builder::McIgnorableBuilder;
        let mut mc_builder = McIgnorableBuilder::new();
        if self.preserved_namespaces.is_none() {
            if has_descent {
                mc_builder.add("x14ac");
            }
            if has_uid {
                mc_builder.add("xr");
            }
        }
        if let Some(ref ns) = self.preserved_namespaces {
            mc_builder.add_from_namespace_map(ns);
            // Add Tier 1 prefixes that aren't in preserved namespaces (edge case)
            if has_descent {
                mc_builder.add("x14ac");
            }
            if has_uid {
                mc_builder.add("xr");
            }
        }

        // Worksheet root element with namespaces
        w.start_element("worksheet")
            .attr("xmlns", SPREADSHEET_NS)
            .attr("xmlns:r", RELATIONSHIPS_NS);

        // Check which Tier 1 namespaces are already covered by preserved_namespaces.
        // When preserved_namespaces contains x14ac or xr, we emit them via Tier 2
        // in their original document order rather than Tier 1, preserving namespace ordering.
        let preserved_has_x14ac = self
            .preserved_namespaces
            .as_ref()
            .map_or(false, |ns| ns.has_prefix("x14ac"));
        let preserved_has_xr = self
            .preserved_namespaces
            .as_ref()
            .map_or(false, |ns| ns.has_prefix("xr"));
        // When preserved_namespaces contains "mc", defer xmlns:mc + mc:Ignorable to the
        // preserved namespace loop so the original attribute order is reproduced exactly.
        // Otherwise emit them immediately after xmlns:r (the default/fresh-write path).
        let preserved_has_mc = self
            .preserved_namespaces
            .as_ref()
            .map_or(false, |ns| ns.has_prefix("mc"));

        let mc_uri = "http://schemas.openxmlformats.org/markup-compatibility/2006";
        let ignorable_value = mc_builder.build();

        // Fresh-write mode (no preserved namespaces): emit xmlns:mc
        // when extension prefixes are present, since we're generating new XML.
        // Round-trip mode (preserved namespaces exist): only emit mc if the original had it
        // — if the original didn't have xmlns:mc, we shouldn't inject it.
        // Note: mc:Ignorable is deferred to after all namespace declarations (matching Excel's ordering).
        let is_fresh_write = self.preserved_namespaces.is_none();
        if !mc_builder.is_empty() && !preserved_has_mc && is_fresh_write {
            w.attr("xmlns:mc", mc_uri);
        }

        // Emit Tier 1 namespace declarations (only when not already in preserved_namespaces)
        if has_descent && !preserved_has_x14ac {
            w.attr(
                "xmlns:x14ac",
                "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac",
            );
        }
        if has_uid && !preserved_has_xr {
            w.attr(
                "xmlns:xr",
                "http://schemas.microsoft.com/office/spreadsheetml/2014/revision",
            );
        }

        // Tier 2: Emit captured extension namespace declarations (skip already-emitted ones).
        // When preserved_namespaces contains "mc", emit xmlns:mc + mc:Ignorable at the position
        // where "mc" appears in the original document order.
        if let Some(ref ns) = self.preserved_namespaces {
            for decl in ns.all() {
                if let Some(ref prefix) = decl.prefix {
                    if prefix == "r" {
                        // Already emitted above — skip
                        continue;
                    }
                    if prefix == "mc" {
                        // Emit xmlns:mc + mc:Ignorable at the preserved position
                        // (matching Excel's ordering: mc:Ignorable immediately after xmlns:mc)
                        if !mc_builder.is_empty() {
                            w.attr("xmlns:mc", mc_uri);
                            if let Some(ref ignorable) = ignorable_value {
                                w.attr("mc:Ignorable", ignorable);
                            }
                        }
                        continue;
                    }
                    // Skip Tier 1 namespaces that were already emitted above
                    if (prefix == "x14ac" && has_descent && !preserved_has_x14ac)
                        || (prefix == "xr" && has_uid && !preserved_has_xr)
                    {
                        continue;
                    }
                    // Skip default namespace (already emitted as xmlns=...)
                    w.attr(&format!("xmlns:{}", prefix), &decl.uri);
                }
            }
        }

        if let Some(ref uid) = self.uid {
            w.attr("xr:uid", uid);
        }

        // Emit mc:Ignorable at end only in fresh-write mode (no preserved namespaces).
        // In round-trip mode, mc:Ignorable was already emitted inline with xmlns:mc above.
        if is_fresh_write {
            if let Some(ref ignorable) = ignorable_value {
                w.attr("mc:Ignorable", ignorable);
            }
        }

        w.end_attrs();

        // Tier 2: Emit preserved elements with position First
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_first("worksheet") {
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write dimension
        self.write_dimension(&mut w);

        // Tier 2: Emit preserved elements after dimension (e.g., sheetPr in non-standard order)
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("worksheet", "dimension") {
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write sheet views
        self.write_sheet_views(&mut w);

        // Tier 2: Emit preserved elements after sheetViews
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("worksheet", "sheetViews") {
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write sheet format properties
        self.write_sheet_format_pr(&mut w);

        // Tier 2: Emit preserved elements after sheetFormatPr (e.g., sheetPr with codeName)
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("worksheet", "sheetFormatPr") {
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write column definitions
        self.write_cols(&mut w);

        // Tier 2: Emit preserved elements after cols / before sheetData
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("worksheet", "cols") {
                w.raw_str(&elem.raw_xml);
            }
            for elem in preserved.get_before("worksheet", "sheetData") {
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write sheet data (rows and cells)
        self.write_sheet_data(&mut w);

        // Tier 2: Emit preserved elements after sheetData.
        // When preserved elements contain sheetProtection, prefer the preserved
        // (verbatim original) version over the domain-generated one for round-trip fidelity.
        let skip_table_parts = self.table_parts_xml.is_some();
        let skip_pivot_table_definitions = !self.pivot_table_r_ids.is_empty();
        let mut protection_emitted_from_preserved = false;
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("worksheet", "sheetData") {
                if skip_table_parts && elem.raw_xml.contains("<tableParts") {
                    continue;
                }
                if self.should_skip_preserved_pivot_table_definition(
                    &elem.raw_xml,
                    skip_pivot_table_definitions,
                ) {
                    continue;
                }
                if elem.raw_xml.contains("<sheetProtection") {
                    protection_emitted_from_preserved = true;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write sheetProtection only if not already emitted from preserved elements
        if !protection_emitted_from_preserved {
            if let Some(ref sp) = self.sheet_protection_xml {
                w.raw_str(sp);
            }
        }

        // Write autoFilter (OOXML order: after sheetData, before sortState)
        if let Some(ref af) = self.auto_filter_xml {
            w.raw_str(af);
        }

        // Write sortState (OOXML order: after autoFilter, before mergeCells)
        if let Some(ref ss) = self.sort_state_xml {
            w.raw_str(ss);
        }

        // Write merge cells
        self.write_merge_cells(&mut w);

        // Drain preserved elements positioned after mergeCells (e.g. phoneticPr)
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("worksheet", "mergeCells") {
                if skip_table_parts && elem.raw_xml.contains("<tableParts") {
                    continue;
                }
                if self.should_skip_preserved_pivot_table_definition(
                    &elem.raw_xml,
                    skip_pivot_table_definitions,
                ) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write conditionalFormatting (OOXML order: after mergeCells/phoneticPr, before dataValidations)
        if let Some(ref cf) = self.conditional_formatting_xml {
            w.raw_str(cf);
        }

        // Write dataValidations (OOXML order: after conditionalFormatting, before hyperlinks)
        if let Some(ref dv) = self.data_validations_xml {
            w.raw_str(dv);
        }

        // Write hyperlinks (OOXML order: after dataValidations, before printOptions)
        if !self.hyperlinks.is_empty() {
            w.start_element("hyperlinks").end_attrs();
            for hl in &self.hyperlinks {
                let el = w.start_element("hyperlink").attr("ref", &hl.cell_ref);
                if let Some(r_id) = &hl.r_id {
                    el.attr("r:id", r_id);
                }
                if !hl.location.is_empty() {
                    el.attr("location", &hl.location);
                }
                if !hl.display.is_empty() {
                    el.attr("display", &hl.display);
                }
                if !hl.tooltip.is_empty() {
                    el.attr("tooltip", &hl.tooltip);
                }
                if let Some(uid) = &hl.uid {
                    el.attr("xr:uid", uid);
                }
                el.self_close();
            }
            w.end_element("hyperlinks");
        }

        // Write print settings (printOptions, pageMargins, pageSetup, headerFooter, breaks)
        // These must appear after mergeCells in OOXML element order.
        if let Some(ref pw) = self.print_writer {
            pw.write_to(&mut w);
        }

        // Drain preserved elements positioned after print-related elements
        // (e.g. ignoredErrors after pageMargins/pageSetup, before drawing)
        // Skip structured elements we regenerate explicitly to avoid stale references.
        if let Some(ref preserved) = self.preserved_elements {
            for after in &[
                "printOptions",
                "pageMargins",
                "pageSetup",
                "headerFooter",
                "rowBreaks",
                "colBreaks",
            ] {
                for elem in preserved.get_after("worksheet", after) {
                    if skip_table_parts && elem.raw_xml.contains("<tableParts") {
                        continue;
                    }
                    if self.should_skip_preserved_pivot_table_definition(
                        &elem.raw_xml,
                        skip_pivot_table_definitions,
                    ) {
                        continue;
                    }
                    w.raw_str(&elem.raw_xml);
                }
            }
        }

        // Write customProperties (OOXML order: after colBreaks, before drawing)
        if let Some(ref cp) = self.custom_properties_xml {
            w.raw_str(cp);
        }

        // Write <drawing r:id="..."/> (OOXML order: after colBreaks, before legacyDrawing)
        if let Some(ref r_id) = self.drawing_r_id {
            w.start_element("drawing").attr("r:id", r_id).self_close();
        }

        // Drain preserved elements positioned after drawing
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("worksheet", "drawing") {
                if skip_table_parts && elem.raw_xml.contains("<tableParts") {
                    continue;
                }
                if self.should_skip_preserved_pivot_table_definition(
                    &elem.raw_xml,
                    skip_pivot_table_definitions,
                ) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write <legacyDrawing r:id="..."/> (OOXML order: after drawing, before legacyDrawingHF)
        if let Some(ref r_id) = self.legacy_drawing_r_id {
            w.start_element("legacyDrawing")
                .attr("r:id", r_id)
                .self_close();
        }

        // Write <legacyDrawingHF r:id="..."/> (OOXML order: after legacyDrawing, before ignoredErrors)
        if let Some(ref r_id) = self.legacy_drawing_hf_r_id {
            w.start_element("legacyDrawingHF")
                .attr("r:id", r_id)
                .self_close();
        }

        // Drain preserved elements positioned after legacyDrawingHF (e.g. ignoredErrors)
        // Skip controls mc:AlternateContent if we have explicit controls_xml to avoid duplication.
        let skip_controls = self.controls_xml.is_some();
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("worksheet", "legacyDrawing") {
                if skip_table_parts && elem.raw_xml.contains("<tableParts") {
                    continue;
                }
                if skip_controls && elem.raw_xml.contains("<controls") {
                    continue;
                }
                if self.should_skip_preserved_pivot_table_definition(
                    &elem.raw_xml,
                    skip_pivot_table_definitions,
                ) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Tier 2: Emit any remaining preserved elements with AfterElement positions
        // not already handled by the explicit drains above.
        if let Some(ref preserved) = self.preserved_elements {
            let handled = &[
                // Pre-sheetData known elements (replayed inline above)
                "dimension",
                "sheetViews",
                "sheetFormatPr",
                "cols",
                // Post-sheetData known elements
                "sheetData",
                "mergeCells",
                "printOptions",
                "pageMargins",
                "pageSetup",
                "headerFooter",
                "rowBreaks",
                "colBreaks",
                "drawing",
                "legacyDrawing",
            ];
            for elem in preserved.get_after_any("worksheet", handled) {
                if skip_table_parts && elem.raw_xml.contains("<tableParts") {
                    continue;
                }
                if skip_controls && elem.raw_xml.contains("<controls") {
                    continue;
                }
                if self.should_skip_preserved_pivot_table_definition(
                    &elem.raw_xml,
                    skip_pivot_table_definitions,
                ) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Write controls mc:AlternateContent (OOXML order: after legacyDrawingHF, before tableParts)
        if let Some(ref ctrl) = self.controls_xml {
            w.raw_str(ctrl);
        }

        // Write tableParts (OOXML order: after legacyDrawing, before extLst)
        if let Some(ref tp) = self.table_parts_xml {
            w.raw_str(tp);
        }

        // Write generated pivot table references. The sheet relationship file
        // resolves each r:id to a pivotTable part; the worksheet XML marker is
        // the structured ownership contract for Excel-compatible consumers.
        for r_id in &self.pivot_table_r_ids {
            w.start_element("pivotTableDefinition")
                .attr("r:id", r_id)
                .self_close();
        }

        // Write extLst (OOXML order: after tableParts, last child of worksheet)
        if let Some(ref ext) = self.ext_lst_xml {
            w.raw_str(ext);
        }

        // Tier 2: Emit preserved elements with position Last
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_last("worksheet") {
                if self.should_skip_preserved_pivot_table_definition(
                    &elem.raw_xml,
                    skip_pivot_table_definitions,
                ) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Close worksheet
        w.end_element("worksheet");

        w.finish()
    }

    /// Calculate dimension from data if not explicitly set.
    fn calculate_dimension(&self) -> Option<(u32, u32, u32, u32)> {
        if let Some(dim) = self.dimension {
            return Some(dim);
        }

        // Calculate from row/cell data
        let mut min_row = u32::MAX;
        let mut max_row = 0u32;
        let mut min_col = u32::MAX;
        let mut max_col = 0u32;

        for (&row_idx, (_, cells)) in &self.rows {
            if !cells.is_empty() {
                min_row = min_row.min(row_idx);
                max_row = max_row.max(row_idx);

                for cell in cells {
                    min_col = min_col.min(cell.col);
                    max_col = max_col.max(cell.col);
                }
            }
        }

        if min_row <= max_row && min_col <= max_col {
            Some((min_row, min_col, max_row, max_col))
        } else {
            None
        }
    }

    fn write_sheet_format_pr(&self, w: &mut XmlWriter) {
        write_sheet_format_pr(w, &self.sheet_format_pr);
    }

    fn write_dimension(&self, w: &mut XmlWriter) {
        // Prefer the raw dimension string for exact round-trip fidelity
        if let Some(ref dim_ref) = self.dimension_ref {
            w.start_element("dimension")
                .attr("ref", dim_ref)
                .self_close();
        } else {
            write_dimensions(w, self.calculate_dimension());
        }
    }

    fn write_sheet_views(&self, w: &mut XmlWriter) {
        write_sheet_views(w, &self.sheet_views);
    }

    fn write_cols(&self, w: &mut XmlWriter) {
        write_cols(w, &self.cols);
    }

    fn write_sheet_data(&self, w: &mut XmlWriter) {
        w.start_element("sheetData").end_attrs();

        let mut runs: Vec<&AuthoredStyleRun> = self.authored_style_runs.iter().collect();
        runs.sort_by_key(|run| {
            (
                run.start_row,
                run.start_col,
                run.end_row,
                run.end_col,
                run.style_id,
            )
        });

        let mut row_iter = self.rows.iter().peekable();
        let mut run_idx = 0usize;
        let mut active_runs: Vec<&AuthoredStyleRun> = Vec::new();
        let mut current_row = match (row_iter.peek(), runs.first()) {
            (Some((row, _)), Some(run)) => (**row).min(run.start_row),
            (Some((row, _)), None) => **row,
            (None, Some(run)) => run.start_row,
            (None, None) => {
                w.end_element("sheetData");
                return;
            }
        };

        loop {
            while run_idx < runs.len() && runs[run_idx].start_row <= current_row {
                active_runs.push(runs[run_idx]);
                run_idx += 1;
            }
            active_runs.retain(|run| run.end_row >= current_row);

            let row_entry = if row_iter.peek().is_some_and(|(row, _)| **row == current_row) {
                row_iter.next().map(|(_, entry)| entry)
            } else {
                None
            };
            let empty_row;
            let (row_def, cells) = match row_entry {
                Some((row_def, cells)) => (row_def, cells.as_slice()),
                None => {
                    empty_row = RowDef::default();
                    (&empty_row, &[][..])
                }
            };
            self.write_row(w, current_row, row_def, cells, &active_runs);

            let next_data_row = row_iter.peek().map(|(row, _)| **row);
            let next_run_row = runs.get(run_idx).map(|run| run.start_row);
            let next_active_row = if active_runs.is_empty() {
                None
            } else {
                Some(current_row.saturating_add(1))
            };
            let next_row = [next_data_row, next_run_row, next_active_row]
                .into_iter()
                .flatten()
                .min();
            let Some(next_row) = next_row else {
                break;
            };
            if next_row <= current_row {
                break;
            }
            current_row = next_row;
        }

        w.end_element("sheetData");
    }

    fn write_row(
        &self,
        w: &mut XmlWriter,
        row_idx: u32,
        row_def: &RowDef,
        cells: &[CellData],
        authored_style_runs: &[&AuthoredStyleRun],
    ) {
        let mut authored_style_cells =
            authored_style_cells_for_row(row_idx, cells, authored_style_runs);
        // Skip empty rows with no special properties
        if cells.is_empty()
            && authored_style_cells.is_empty()
            && row_def.height.is_none()
            && row_def.hidden.is_none()
            && row_def.style.is_none()
            && !row_def.custom_format
            && row_def.outline_level.is_none()
            && row_def.descent.is_none()
            && row_def.collapsed.is_none()
            && row_def.spans.is_none()
            && !row_def.bare_empty
        {
            return;
        }

        w.start_element("row").attr_num("r", row_idx + 1); // 1-indexed

        // Only write spans if preserved from original XML — don't auto-compute
        if let Some(ref spans) = row_def.spans {
            w.attr("spans", spans);
        }

        if let Some(style) = row_def.style {
            w.attr_num("s", style);
        }
        if row_def.custom_format || row_def.style.is_some() {
            w.attr("customFormat", "1");
        }
        if let Some(height) = row_def.height {
            if let Some(ref hs) = row_def.height_str {
                w.attr("ht", hs);
            } else {
                w.attr("ht", &format_f64(height));
            }
        }
        match row_def.hidden {
            Some(true) => {
                w.attr("hidden", "1");
            }
            Some(false) => {
                w.attr("hidden", "0");
            }
            None => {}
        }
        if row_def.custom_height {
            w.attr("customHeight", "1");
        }
        if let Some(level) = row_def.outline_level {
            w.attr_num("outlineLevel", level);
        }
        match row_def.collapsed {
            Some(true) => {
                w.attr("collapsed", "1");
            }
            Some(false) => {
                w.attr("collapsed", "0");
            }
            None => {}
        }
        if row_def.thick_top {
            w.attr("thickTop", "1");
        }
        if row_def.thick_bot {
            w.attr("thickBot", "1");
        }
        if let Some(descent) = row_def.descent {
            w.attr("x14ac:dyDescent", &format_f64(descent));
        }

        if cells.is_empty() && authored_style_cells.is_empty() {
            w.self_close();
        } else {
            w.end_attrs();

            let mut row_cells: Vec<CellData> = cells.to_vec();
            row_cells.append(&mut authored_style_cells);
            row_cells.sort_by_key(|c| c.col);

            for cell in &row_cells {
                self.write_cell(w, cell);
            }

            w.end_element("row");
        }
    }

    fn write_cell(&self, w: &mut XmlWriter, cell: &CellData) {
        let cell_ref = to_a1(cell.row, cell.col);

        w.start_element("c");

        // Write cm before r to match Excel's attribute ordering
        if cell.cm {
            w.attr("cm", "1");
        }

        w.attr("r", &cell_ref);

        // Write style index
        if let Some(style) = cell.style_index {
            w.attr_num("s", style);
        }

        // Write type attribute based on value
        match &cell.value {
            CellValue::Empty => {
                // Empty cells normally don't need a type, but if the original XML
                // had an explicit type (e.g., t="s" on a valueless cell), preserve it.
                if let Some(ref t) = cell.explicit_type {
                    w.attr("t", t);
                }
            }
            CellValue::Number(_) => {
                // Numbers use default type (no t attribute needed)
            }
            CellValue::String(_) => {
                w.attr("t", "s");
            }
            CellValue::InlineString(_) => {
                w.attr("t", "inlineStr");
            }
            CellValue::FormulaString(_) => {
                w.attr("t", "str");
            }
            CellValue::Boolean(_) => {
                w.attr("t", "b");
            }
            CellValue::Error(..) => {
                w.attr("t", "e");
            }
            CellValue::Formula { cached_value, .. } => {
                // Formula type depends on cached value
                if let Some(cached) = cached_value {
                    match cached.as_ref() {
                        CellValue::String(_) => {
                            // Cached value is an SST index: write t="s" to preserve
                            // the original cell's shared-string cached value (non-standard
                            // but used by some Excel versions for formula cells).
                            w.attr("t", "s");
                        }
                        CellValue::InlineString(_) | CellValue::FormulaString(_) => {
                            w.attr("t", "str");
                        }
                        CellValue::Boolean(_) => {
                            w.attr("t", "b");
                        }
                        CellValue::Error(..) => {
                            w.attr("t", "e");
                        }
                        _ => {} // Numbers don't need type
                    }
                } else if let Some(ref hint) = cell.formula_type_hint {
                    // No cached value, but the original XML had an explicit type
                    w.attr("t", hint);
                }
            }
        }

        // Write vm (value metadata index) after type — matches Excel attribute ordering
        if let Some(vm_val) = cell.vm {
            w.attr_num("vm", vm_val);
        }

        // For cells with no children (empty value), emit self-closing tag: <c r="A1" s="3"/>
        if matches!(&cell.value, CellValue::Empty) {
            w.self_close();
            return;
        }

        w.end_attrs();

        // Write value content
        match &cell.value {
            CellValue::Empty => {
                unreachable!("Empty cells handled above with self_close()");
            }
            CellValue::Number(n) => {
                // Use the original string representation when available to
                // preserve exact numeric precision from the source file.
                let formatted = match &cell.original_value {
                    Some(orig) => orig.clone(),
                    None => format_number(*n),
                };
                w.element_with_text("v", &formatted);
            }
            CellValue::String(idx) => {
                w.element_with_text("v", &idx.to_string());
            }
            CellValue::InlineString(s) => {
                w.start_element("is").end_attrs();
                let needs_preserve = s.starts_with(' ')
                    || s.ends_with(' ')
                    || s.starts_with('\t')
                    || s.ends_with('\t')
                    || s.contains('\n');
                if needs_preserve {
                    w.start_element("t")
                        .attr("xml:space", "preserve")
                        .end_attrs()
                        .text_xstring(s)
                        .end_element("t");
                } else {
                    w.start_element("t")
                        .end_attrs()
                        .text_xstring(s)
                        .end_element("t");
                }
                w.end_element("is");
            }
            CellValue::FormulaString(s) => {
                // t="str" uses plain <v> element, not <is><t>
                if cell.preserve_space_value {
                    w.start_element("v")
                        .attr("xml:space", "preserve")
                        .end_attrs()
                        .text_xstring(s)
                        .end_element("v");
                } else if s.is_empty() {
                    w.start_element("v").self_close();
                } else {
                    w.start_element("v")
                        .end_attrs()
                        .text_xstring(s)
                        .end_element("v");
                }
            }
            CellValue::Boolean(b) => {
                w.element_with_text("v", if *b { "1" } else { "0" });
            }
            CellValue::Error(e) => {
                w.element_with_text("v", e);
            }
            CellValue::Formula {
                formula,
                cached_value,
                cell_formula,
            } => {
                use ooxml_types::worksheet::CellFormulaType;
                let ca = cell.force_recalc;
                let psf = cell.preserve_space_formula;

                match cell_formula {
                    Some(cf) if cf.t == CellFormulaType::Shared && cf.si.is_some() => {
                        let si = cf.si.unwrap();
                        if let Some(ref ref_range) = cf.r#ref {
                            // Master cell: <f t="shared" si="N" ref="...">formula</f>
                            let b = w
                                .start_element("f")
                                .attr("t", "shared")
                                .attr("si", &si.to_string())
                                .attr("ref", ref_range);
                            if ca {
                                b.attr("ca", "1");
                            }
                            if psf {
                                b.attr("xml:space", "preserve");
                            }
                            b.end_attrs();
                            w.text(&cf.text);
                            w.end_element("f");
                        } else {
                            // Reference cell: <f t="shared" si="N"/> (self-closing, no formula text)
                            if ca {
                                w.empty_element(
                                    "f",
                                    &[("t", "shared"), ("si", &si.to_string()), ("ca", "1")],
                                );
                            } else {
                                w.empty_element("f", &[("t", "shared"), ("si", &si.to_string())]);
                            }
                        }
                    }
                    Some(cf) if cf.t == CellFormulaType::Array => {
                        // Array formula: <f ref="..." t="array">formula</f>
                        if let Some(ref ref_range) = cf.r#ref {
                            let b = w
                                .start_element("f")
                                .attr("ref", ref_range)
                                .attr("t", "array");
                            if cf.aca {
                                b.attr("aca", "1");
                            }
                            if ca {
                                b.attr("ca", "1");
                            }
                            if psf {
                                b.attr("xml:space", "preserve");
                            }
                            b.end_attrs();
                            w.text(&cf.text);
                            w.end_element("f");
                        } else {
                            let b = w.start_element("f");
                            if ca {
                                b.attr("ca", "1");
                            }
                            if psf {
                                b.attr("xml:space", "preserve");
                            }
                            b.end_attrs();
                            w.text(formula);
                            w.end_element("f");
                        }
                    }
                    Some(cf) if cf.t == CellFormulaType::DataTable => {
                        // Data table formula: <f t="dataTable" ref="..." dt2D="1" dtr="1" r1="..." r2="..."/>
                        let b = w.start_element("f").attr("t", "dataTable");
                        if let Some(ref ref_range) = cf.r#ref {
                            b.attr("ref", ref_range);
                        }
                        if cf.dt2d {
                            b.attr("dt2D", "1");
                        }
                        if cf.dtr {
                            b.attr("dtr", "1");
                        }
                        if cf.del1 {
                            b.attr("del1", "1");
                        }
                        if cf.del2 {
                            b.attr("del2", "1");
                        }
                        if cf.aca {
                            b.attr("aca", "1");
                        }
                        if let Some(ref r1) = cf.r1 {
                            b.attr("r1", r1);
                        }
                        if let Some(ref r2) = cf.r2 {
                            b.attr("r2", r2);
                        }
                        if cf.bx {
                            b.attr("bx", "1");
                        }
                        if ca || cf.ca {
                            b.attr("ca", "1");
                        }
                        // Data table <f> elements are self-closing in OOXML.
                        b.self_close();
                    }
                    _ => {
                        // Normal formula: <f>formula</f> or <f ca="1">formula</f>
                        if ca || psf {
                            let b = w.start_element("f");
                            if ca {
                                b.attr("ca", "1");
                            }
                            if psf {
                                b.attr("xml:space", "preserve");
                            }
                            b.end_attrs();
                            w.text(formula);
                            w.end_element("f");
                        } else {
                            w.element_with_text("f", formula);
                        }
                    }
                }
                // Cached value writing
                if let Some(cached) = cached_value {
                    let psv = cell.preserve_space_value;
                    match cached.as_ref() {
                        CellValue::Number(n) => {
                            let formatted = match &cell.original_value {
                                Some(orig) => orig.clone(),
                                None => format_number(*n),
                            };
                            w.element_with_text("v", &formatted);
                        }
                        CellValue::String(idx) => {
                            w.element_with_text("v", &idx.to_string());
                        }
                        CellValue::Boolean(b) => {
                            w.element_with_text("v", if *b { "1" } else { "0" });
                        }
                        CellValue::Error(e) => {
                            w.element_with_text("v", e);
                        }
                        CellValue::InlineString(s) | CellValue::FormulaString(s) => {
                            // Emit xml:space="preserve" on <v> when the original had it.
                            // This preserves round-trip fidelity for formula-string cached
                            // values that contain leading/trailing whitespace.
                            if psv {
                                w.start_element("v")
                                    .attr("xml:space", "preserve")
                                    .end_attrs()
                                    .text_xstring(s)
                                    .end_element("v");
                            } else if s.is_empty() {
                                w.start_element("v").self_close();
                            } else {
                                w.start_element("v")
                                    .end_attrs()
                                    .text_xstring(s)
                                    .end_element("v");
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        w.end_element("c");
    }

    fn write_merge_cells(&self, w: &mut XmlWriter) {
        write_merge_cells(w, &self.merges, self.merge_cells_emit_count);
    }
}

// ============================================================================
// Helper Functions — re-exported from common::a1
// ============================================================================

pub use crate::infra::a1::{col_to_letter, to_a1};

/// Format a number for XLSX output.
///
/// Removes unnecessary trailing zeros and handles integers cleanly.
fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        // Integer that can be represented exactly
        format!("{:.0}", n)
    } else {
        // Use full precision but trim trailing zeros
        let s = format!("{}", n);
        // Remove trailing zeros after decimal point
        if s.contains('.') {
            s.trim_end_matches('0').trim_end_matches('.').to_string()
        } else {
            s
        }
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_format_number_integer() {
        assert_eq!(format_number(42.0), "42");
        assert_eq!(format_number(0.0), "0");
        assert_eq!(format_number(-100.0), "-100");
    }

    #[test]
    fn test_format_number_decimal() {
        assert_eq!(format_number(3.14), "3.14");
        assert_eq!(format_number(1.5), "1.5");
        assert_eq!(format_number(0.001), "0.001");
    }

    // -------------------------------------------------------------------------
    // Basic cell tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_number_cell() {
        let mut writer = SheetWriter::new();
        writer.set_number(0, 0, 42.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<c r=\"A1\">"));
        assert!(xml.contains("<v>42</v>"));
        assert!(xml.contains("</c>"));
    }

    #[test]
    fn test_write_string_cell() {
        let mut writer = SheetWriter::new();
        writer.set_string(0, 0, 5);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<c r=\"A1\" t=\"s\">"));
        assert!(xml.contains("<v>5</v>"));
    }

    #[test]
    fn test_write_inline_string_cell() {
        let mut writer = SheetWriter::new();
        writer.set_inline_string(0, 0, "Hello World");

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<c r=\"A1\" t=\"inlineStr\">"));
        assert!(xml.contains("<is><t>Hello World</t></is>"));
    }

    #[test]
    fn test_write_boolean_cell() {
        let mut writer = SheetWriter::new();
        writer.set_boolean(0, 0, true);
        writer.set_boolean(0, 1, false);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<c r=\"A1\" t=\"b\">"));
        assert!(xml.contains("<v>1</v>"));
        assert!(xml.contains("<c r=\"B1\" t=\"b\">"));
        assert!(xml.contains("<v>0</v>"));
    }

    #[test]
    fn test_write_error_cell() {
        let mut writer = SheetWriter::new();
        writer.set_error(0, 0, "#DIV/0!");

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<c r=\"A1\" t=\"e\">"));
        assert!(xml.contains("<v>#DIV/0!</v>"));
    }

    #[test]
    fn test_write_formula_cell() {
        let mut writer = SheetWriter::new();
        writer.set_formula(0, 0, "SUM(B1:B10)");

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<c r=\"A1\">"));
        assert!(xml.contains("<f>SUM(B1:B10)</f>"));
    }

    #[test]
    fn test_write_formula_with_cached_value() {
        let mut writer = SheetWriter::new();
        writer.set_formula_with_value(0, 0, "A1*2", CellValue::Number(84.0));

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<f>A1*2</f>"));
        assert!(xml.contains("<v>84</v>"));
    }

    #[test]
    fn test_write_formula_with_force_recalc() {
        let mut writer = SheetWriter::new();
        let mut cd = CellData::new(
            0,
            0,
            CellValue::Formula {
                formula: "IF(D2=\"\",\"\",TODAY()-D2)".to_string(),
                cached_value: Some(Box::new(CellValue::Number(42.0))),
                cell_formula: None,
            },
        );
        cd.force_recalc = true;
        writer.add_cell(cd);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(
            xml.contains("<f ca=\"1\">IF(D2="),
            "Expected ca=\"1\" on <f> element, got: {}",
            xml
        );
        assert!(xml.contains("<v>42</v>"));
    }

    // -------------------------------------------------------------------------
    // Column width tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_column_widths() {
        let mut writer = SheetWriter::new();
        writer.set_col_width(0, 15.0);
        writer.set_col_width(1, 20.0);
        writer.set_number(0, 0, 1.0); // Add a cell so sheet isn't empty

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<cols>"));
        assert!(xml.contains("<col min=\"1\" max=\"1\" width=\"15\""));
        assert!(xml.contains("<col min=\"2\" max=\"2\" width=\"20\""));
        assert!(xml.contains("customWidth=\"1\""));
        assert!(xml.contains("</cols>"));
    }

    #[test]
    fn test_write_column_range() {
        let mut writer = SheetWriter::new();
        writer.add_col(ColWidth::range(1, 5, 12.0));
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<col min=\"1\" max=\"5\" width=\"12\""));
    }

    #[test]
    fn test_write_hidden_column() {
        let mut writer = SheetWriter::new();
        writer.add_col(ColWidth::range(2, 2, 10.0).with_hidden(true));
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("hidden=\"1\""));
    }

    // -------------------------------------------------------------------------
    // Row height tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_row_height() {
        let mut writer = SheetWriter::new();
        writer.set_row_height(0, 20.0);
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<row r=\"1\""));
        assert!(xml.contains("ht=\"20\""));
        assert!(xml.contains("customHeight=\"1\""));
    }

    #[test]
    fn test_write_hidden_row() {
        let mut writer = SheetWriter::new();
        writer.set_row_hidden(0, true);
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("hidden=\"1\""));
    }

    // -------------------------------------------------------------------------
    // Merge cell tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_merge_cells() {
        let mut writer = SheetWriter::new();
        writer.add_merge(0, 0, 0, 2); // A1:C1
        writer.add_merge(1, 0, 3, 1); // A2:B4
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<mergeCells count=\"2\">"));
        assert!(xml.contains("<mergeCell ref=\"A1:C1\"/>"));
        assert!(xml.contains("<mergeCell ref=\"A2:B4\"/>"));
        assert!(xml.contains("</mergeCells>"));
    }

    #[test]
    fn test_merge_range_to_ref() {
        let merge = MergeRange::from_coords(0, 0, 2, 3);
        assert_eq!(merge.to_ref(), "A1:D3");
    }

    // -------------------------------------------------------------------------
    // Frozen pane tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_write_frozen_rows() {
        let mut writer = SheetWriter::new();
        writer.set_frozen(1, 0); // Freeze 1 row
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<pane"));
        assert!(xml.contains("ySplit=\"1\""));
        assert!(xml.contains("topLeftCell=\"A2\""));
        assert!(xml.contains("state=\"frozen\""));
    }

    #[test]
    fn test_write_frozen_cols() {
        let mut writer = SheetWriter::new();
        writer.set_frozen(0, 1); // Freeze 1 column
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<pane"));
        assert!(xml.contains("xSplit=\"1\""));
        assert!(xml.contains("topLeftCell=\"B1\""));
    }

    #[test]
    fn test_write_frozen_both() {
        let mut writer = SheetWriter::new();
        writer.set_frozen(1, 1); // Freeze 1 row and 1 column
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("xSplit=\"1\""));
        assert!(xml.contains("ySplit=\"1\""));
        assert!(xml.contains("topLeftCell=\"B2\""));
        assert!(xml.contains("activePane=\"bottomRight\""));
    }

    // -------------------------------------------------------------------------
    // Dimension tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_auto_dimension() {
        let mut writer = SheetWriter::new();
        writer.set_number(0, 0, 1.0);
        writer.set_number(5, 3, 2.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<dimension ref=\"A1:D6\"/>"));
    }

    #[test]
    fn test_explicit_dimension() {
        let mut writer = SheetWriter::new();
        writer.set_dimension(0, 0, 9, 9);
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<dimension ref=\"A1:J10\"/>"));
    }

    // -------------------------------------------------------------------------
    // Complete worksheet tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_complete_worksheet_xml() {
        let mut writer = SheetWriter::new();

        // Set column widths
        writer.set_col_width(0, 15.0);
        writer.set_col_width(1, 10.0);

        // Add cells
        writer.set_string(0, 0, 0); // A1: shared string
        writer.set_number(0, 1, 42.0); // B1: number
        writer.set_boolean(0, 2, true); // C1: boolean
        writer.set_formula_with_value(0, 3, "B1*2", CellValue::Number(84.0)); // D1: formula

        // Set row height
        writer.set_row_height(0, 20.0);

        // Add inline string
        writer.set_inline_string(1, 0, "Inline text"); // A2

        // Add merge
        writer.add_merge(0, 0, 0, 1); // A1:B1

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Verify XML structure
        assert!(xml.contains("<?xml version=\"1.0\""));
        assert!(xml.contains("<worksheet xmlns="));
        assert!(xml.contains("<dimension ref="));
        assert!(xml.contains("<sheetViews>"));
        assert!(xml.contains("<sheetFormatPr"));
        assert!(xml.contains("<cols>"));
        assert!(xml.contains("<sheetData>"));
        assert!(xml.contains("<mergeCells"));
        assert!(xml.contains("</worksheet>"));
    }

    #[test]
    fn test_worksheet_with_style() {
        let mut writer = SheetWriter::new();
        writer.add_cell(CellData::with_style(0, 0, CellValue::Number(42.0), 1));

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<c r=\"A1\" s=\"1\">"));
    }

    #[test]
    fn test_empty_worksheet() {
        let writer = SheetWriter::new();
        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Should still have valid structure
        assert!(xml.contains("<?xml version=\"1.0\""));
        assert!(xml.contains("<worksheet"));
        assert!(xml.contains("<sheetData>"));
        assert!(xml.contains("</sheetData>"));
        assert!(xml.contains("</worksheet>"));

        // Should not have dimension, cols, or mergeCells
        assert!(!xml.contains("<dimension"));
        assert!(!xml.contains("<cols>"));
        assert!(!xml.contains("<mergeCells"));
    }

    #[test]
    fn test_multiple_rows() {
        let mut writer = SheetWriter::new();
        writer.set_number(0, 0, 1.0);
        writer.set_number(1, 0, 2.0);
        writer.set_number(2, 0, 3.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("<row r=\"1\""));
        assert!(xml.contains("<row r=\"2\""));
        assert!(xml.contains("<row r=\"3\""));
    }

    #[test]
    fn test_cells_sorted_by_column() {
        let mut writer = SheetWriter::new();
        // Add cells out of order
        writer.set_number(0, 2, 3.0); // C1
        writer.set_number(0, 0, 1.0); // A1
        writer.set_number(0, 1, 2.0); // B1

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Find positions of cell references
        let a1_pos = xml.find("r=\"A1\"").unwrap();
        let b1_pos = xml.find("r=\"B1\"").unwrap();
        let c1_pos = xml.find("r=\"C1\"").unwrap();

        // Verify order
        assert!(a1_pos < b1_pos);
        assert!(b1_pos < c1_pos);
    }

    // -------------------------------------------------------------------------
    // Sheet view tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sheet_view_zoom() {
        let mut writer = SheetWriter::new();
        writer.set_view(SheetView {
            zoom_scale: 150,
            ..Default::default()
        });
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("zoomScale=\"150\""));
    }

    #[test]
    fn test_sheet_view_hide_gridlines() {
        let mut writer = SheetWriter::new();
        writer.set_view(SheetView {
            show_grid_lines: false,
            ..Default::default()
        });
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("showGridLines=\"0\""));
    }

    #[test]
    fn test_sheet_view_tab_selected() {
        let mut writer = SheetWriter::new();
        writer.set_view(SheetView {
            tab_selected: true,
            ..Default::default()
        });
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("tabSelected=\"1\""));
    }

    #[test]
    fn test_sheet_view_all_attributes() {
        let mut writer = SheetWriter::new();
        writer.set_view(SheetView {
            window_protection: true,
            show_formulas: true,
            show_grid_lines: false,
            show_row_col_headers: false,
            show_zeros: false,
            tab_selected: true,
            show_ruler: false,
            show_outline_symbols: false,
            show_white_space: false,
            view: SheetViewType::PageLayout,
            top_left_cell: Some("C5".to_string()),
            zoom_scale: 125,
            zoom_scale_normal: 100,
            zoom_scale_page_layout_view: Some(80),
            zoom_scale_sheet_layout_view: Some(60),
            right_to_left: true,
            ..Default::default()
        });
        writer.set_number(0, 0, 1.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("windowProtection=\"1\""));
        assert!(xml.contains("showFormulas=\"1\""));
        assert!(xml.contains("showGridLines=\"0\""));
        assert!(xml.contains("showRowColHeaders=\"0\""));
        assert!(xml.contains("showZeros=\"0\""));
        assert!(xml.contains("rightToLeft=\"1\""));
        assert!(xml.contains("tabSelected=\"1\""));
        assert!(xml.contains("showRuler=\"0\""));
        assert!(xml.contains("showOutlineSymbols=\"0\""));
        assert!(xml.contains("showWhiteSpace=\"0\""));
        assert!(xml.contains("view=\"pageLayout\""));
        assert!(xml.contains("topLeftCell=\"C5\""));
        assert!(xml.contains("zoomScale=\"125\""));
        assert!(xml.contains("zoomScaleNormal=\"100\""));
        assert!(xml.contains("zoomScalePageLayoutView=\"80\""));
        assert!(xml.contains("zoomScaleSheetLayoutView=\"60\""));
    }

    // -------------------------------------------------------------------------
    // XML escaping tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_inline_string_escaping() {
        let mut writer = SheetWriter::new();
        writer.set_inline_string(0, 0, "Test <>&\"' chars");

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("&lt;"));
        assert!(xml.contains("&gt;"));
        assert!(xml.contains("&amp;"));
    }

    #[test]
    fn test_formula_escaping() {
        let mut writer = SheetWriter::new();
        writer.set_formula(0, 0, "IF(A1>0,\"Yes\",\"No\")");

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("IF(A1&gt;0,"));
    }

    // -------------------------------------------------------------------------
    // dyDescent round-trip tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_dy_descent_write_default_and_per_row() {
        let mut writer = SheetWriter::new();
        let mut fmt = SheetFormatPr::default();
        fmt.default_row_descent = Some(0.3);
        writer.set_sheet_format_pr(fmt);

        writer.set_row_height(0, 15.0);
        writer.set_row_descent(0, 0.3);
        writer.set_row_height(1, 20.0);
        writer.set_row_descent(1, 0.35);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Namespace declarations
        assert!(xml.contains("xmlns:mc="), "should have mc namespace");
        assert!(xml.contains("xmlns:x14ac="), "should have x14ac namespace");
        assert!(
            xml.contains("mc:Ignorable=\"x14ac\""),
            "should have mc:Ignorable"
        );

        // Default descent on sheetFormatPr
        assert!(
            xml.contains("x14ac:dyDescent=\"0.3\""),
            "sheetFormatPr should have dyDescent"
        );

        // Per-row descent
        assert!(
            xml.contains("x14ac:dyDescent=\"0.35\""),
            "row with non-default descent"
        );
    }

    #[test]
    fn test_dy_descent_no_namespaces_when_absent() {
        let mut writer = SheetWriter::new();
        writer.set_number(0, 0, 42.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(
            !xml.contains("xmlns:mc"),
            "should not have mc namespace when no descent data"
        );
        assert!(
            !xml.contains("xmlns:x14ac"),
            "should not have x14ac namespace when no descent data"
        );
        assert!(
            !xml.contains("mc:Ignorable"),
            "should not have mc:Ignorable when no descent data"
        );
        assert!(
            !xml.contains("dyDescent"),
            "should not have dyDescent when no descent data"
        );
    }

    #[test]
    fn test_dy_descent_parse_and_write_roundtrip() {
        // Simulate parsing a sheet XML fragment with dyDescent attributes
        use crate::common::range::RowHeight;
        use crate::domain::cells::{CellData, ParseExtras, parse_worksheet_fast_with_extras};

        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"
           xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
           mc:Ignorable="x14ac">
<sheetFormatPr defaultRowHeight="14.4" x14ac:dyDescent="0.3"/>
<sheetData>
<row r="1" ht="14.4" x14ac:dyDescent="0.3"><c r="A1"><v>1</v></c></row>
<row r="2" ht="20" x14ac:dyDescent="0.35"><c r="A2"><v>2</v></c></row>
</sheetData>
</worksheet>"#;

        let shared_strings: Vec<&str> = vec![];
        let mut cells = vec![CellData::default(); 100];
        let mut strings = Vec::new();
        let mut row_heights = Vec::new();
        let mut extras = ParseExtras::default();

        let count = parse_worksheet_fast_with_extras(
            xml,
            &shared_strings,
            &mut cells,
            &mut strings,
            &mut row_heights,
            &mut extras,
            &[],
        );

        assert_eq!(count, 2, "should parse 2 cells");
        assert_eq!(extras.row_descents.len(), 2, "should have 2 row descents");

        // Verify parsed descent values
        assert_eq!(extras.row_descents[0], (0, 0.3)); // row 1 -> 0-indexed row 0
        assert_eq!(extras.row_descents[1], (1, 0.35)); // row 2 -> 0-indexed row 1

        // Parse default descent from sheetFormatPr
        let pre_sd = &xml[..xml.windows(10).position(|w| w == b"<sheetData").unwrap()];
        let fmt_pr = crate::domain::worksheet::read::parse_sheet_format_pr(pre_sd);
        assert_eq!(fmt_pr.default_row_descent, Some(0.3));

        // Now write back
        let mut writer = SheetWriter::new();
        let mut fmt = SheetFormatPr::default();
        fmt.default_row_height = 14.4;
        fmt.default_row_descent = Some(0.3);
        writer.set_sheet_format_pr(fmt);

        // Only non-default descent values
        writer.set_row_height(0, 14.4);
        writer.set_row_height(1, 20.0);
        writer.set_row_descent(1, 0.35); // Only row 2 has non-default descent

        let output = String::from_utf8(writer.to_xml()).unwrap();

        // Verify output XML
        assert!(
            output.contains("mc:Ignorable=\"x14ac\""),
            "root should have mc:Ignorable"
        );
        assert!(
            output.contains("xmlns:x14ac="),
            "root should have x14ac namespace"
        );
        assert!(
            output.contains("x14ac:dyDescent=\"0.3\""),
            "sheetFormatPr should have default descent"
        );
        assert!(
            output.contains("x14ac:dyDescent=\"0.35\""),
            "row 2 should have non-default descent"
        );
    }

    // -------------------------------------------------------------------------
    // xr:uid round-trip tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_xr_uid_write() {
        let mut writer = SheetWriter::new();
        writer.set_uid("{00000000-0001-0000-0000-000000000000}".to_string());
        writer.set_number(0, 0, 42.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("xmlns:mc="), "should have mc namespace");
        assert!(xml.contains("xmlns:xr="), "should have xr namespace");
        assert!(
            xml.contains("mc:Ignorable=\"xr\""),
            "should have mc:Ignorable with xr"
        );
        assert!(
            xml.contains("xr:uid=\"{00000000-0001-0000-0000-000000000000}\""),
            "should have xr:uid"
        );
        // Should NOT have x14ac when no descent data
        assert!(
            !xml.contains("xmlns:x14ac"),
            "should not have x14ac when no descent data"
        );
    }

    #[test]
    fn test_xr_uid_no_namespaces_when_absent() {
        let mut writer = SheetWriter::new();
        writer.set_number(0, 0, 42.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(
            !xml.contains("xmlns:xr"),
            "should not have xr namespace when no uid"
        );
        assert!(
            !xml.contains("xr:uid"),
            "should not have xr:uid when no uid"
        );
    }

    #[test]
    fn test_xr_uid_combined_with_descent() {
        let mut writer = SheetWriter::new();
        writer.set_uid("{ABCDEF01-2345-6789-ABCD-EF0123456789}".to_string());
        let mut fmt = SheetFormatPr::default();
        fmt.default_row_descent = Some(0.3);
        writer.set_sheet_format_pr(fmt);
        writer.set_number(0, 0, 42.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("xmlns:mc="), "should have mc namespace");
        assert!(xml.contains("xmlns:x14ac="), "should have x14ac namespace");
        assert!(xml.contains("xmlns:xr="), "should have xr namespace");
        assert!(
            xml.contains("mc:Ignorable=\"x14ac xr\""),
            "should have mc:Ignorable with both x14ac and xr"
        );
        assert!(
            xml.contains("xr:uid=\"{ABCDEF01-2345-6789-ABCD-EF0123456789}\""),
            "should have xr:uid"
        );
        assert!(
            xml.contains("x14ac:dyDescent=\"0.3\""),
            "should have dyDescent"
        );
    }

    #[test]
    fn test_xr_uid_parse_and_write_roundtrip() {
        use crate::infra::scanner::{extract_quoted_value, find_attr_simd};

        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
           xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"
           xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"
           xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
           mc:Ignorable="x14ac xr"
           xr:uid="{00000000-0001-0000-0000-000000000000}">
<sheetFormatPr defaultRowHeight="14.4" x14ac:dyDescent="0.3"/>
<sheetData>
<row r="1" ht="14.4" x14ac:dyDescent="0.3"><c r="A1"><v>1</v></c></row>
</sheetData>
</worksheet>"#;

        // Parse xr:uid from pre_sd
        let pre_sd = &xml[..xml.windows(10).position(|w| w == b"<sheetData").unwrap()];
        let uid = find_attr_simd(pre_sd, b"xr:uid=\"", 0).and_then(|p| {
            let value_start = p + b"xr:uid=\"".len();
            extract_quoted_value(pre_sd, value_start)
                .map(|(s, e)| String::from_utf8_lossy(&pre_sd[s..e]).into_owned())
        });
        assert_eq!(
            uid.as_deref(),
            Some("{00000000-0001-0000-0000-000000000000}")
        );

        // Parse default descent
        let fmt_pr = crate::domain::worksheet::read::parse_sheet_format_pr(pre_sd);
        assert_eq!(fmt_pr.default_row_descent, Some(0.3));

        // Write back
        let mut writer = SheetWriter::new();
        writer.set_uid(uid.unwrap());
        let mut fmt = SheetFormatPr::default();
        fmt.default_row_height = 14.4;
        fmt.default_row_descent = Some(0.3);
        writer.set_sheet_format_pr(fmt);
        writer.set_row_height(0, 14.4);
        writer.set_row_descent(0, 0.3);
        writer.set_number(0, 0, 1.0);

        let output = String::from_utf8(writer.to_xml()).unwrap();

        // Verify output XML
        assert!(
            output.contains("mc:Ignorable=\"x14ac xr\""),
            "root should have mc:Ignorable with both"
        );
        assert!(
            output.contains("xmlns:xr="),
            "root should have xr namespace"
        );
        assert!(
            output.contains("xmlns:x14ac="),
            "root should have x14ac namespace"
        );
        assert!(
            output.contains("xr:uid=\"{00000000-0001-0000-0000-000000000000}\""),
            "should have xr:uid"
        );
        assert!(
            output.contains("x14ac:dyDescent=\"0.3\""),
            "sheetFormatPr should have descent"
        );
    }

    #[test]
    fn test_preserved_namespaces_mc_ignorable_roundtrip() {
        // Simulate round-trip of a sheet that has mc:Ignorable="x14ac xr xr2 xr3"
        // but where the Tier 1 domain fields (dyDescent, uid) might or might not be present.
        use crate::roundtrip::namespaces::NamespaceMap;

        let mut ns = NamespaceMap::new();
        ns.capture_from_element(
            br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.openxmlformats.org/officeDocument/2006/relationships/metadata/core-properties" mc:Ignorable="x14ac xr xr2 xr3">"#
        );

        // Case 1: has_descent=true, has_uid=true (common case)
        {
            let mut writer = SheetWriter::new();
            writer.set_preserved_namespaces(ns.clone());
            writer.set_uid("{TEST-UID}".to_string());
            let mut fmt = SheetFormatPr::default();
            fmt.default_row_height = 14.4;
            fmt.default_row_descent = Some(0.3);
            writer.set_sheet_format_pr(fmt);

            let output = String::from_utf8(writer.to_xml()).unwrap();
            assert!(
                output.contains("mc:Ignorable="),
                "Case 1: mc:Ignorable should be present.\nGot: {}",
                &output[..output.len().min(500)]
            );
            assert!(
                output.contains("xmlns:mc="),
                "Case 1: xmlns:mc should be present"
            );
        }

        // Case 2: has_descent=false, has_uid=false (edge case — preserved namespaces have extension prefixes but no domain data uses them)
        {
            let mut writer = SheetWriter::new();
            writer.set_preserved_namespaces(ns.clone());
            // No uid, no descent

            let output = String::from_utf8(writer.to_xml()).unwrap();
            assert!(
                output.contains("mc:Ignorable="),
                "Case 2: mc:Ignorable should be present even without Tier 1 domain fields.\nGot: {}",
                &output[..output.len().min(500)]
            );
            assert!(
                output.contains("xmlns:mc="),
                "Case 2: xmlns:mc should be present"
            );
        }

        // Case 3: preserved namespaces exist but DON'T have mc — should not inject mc:Ignorable
        {
            let mut ns_no_mc = NamespaceMap::new();
            ns_no_mc.capture_from_element(
                br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">"#
            );

            let mut writer = SheetWriter::new();
            writer.set_preserved_namespaces(ns_no_mc);
            let mut fmt = SheetFormatPr::default();
            fmt.default_row_height = 14.4;
            fmt.default_row_descent = Some(0.3);
            writer.set_sheet_format_pr(fmt);

            let output = String::from_utf8(writer.to_xml()).unwrap();
            // Original didn't have mc:Ignorable, so we should NOT inject it
            assert!(
                !output.contains("mc:Ignorable="),
                "Case 3: mc:Ignorable should NOT be injected when original didn't have it.\nGot: {}",
                &output[..output.len().min(500)]
            );
            assert!(
                !output.contains("xmlns:mc="),
                "Case 3: xmlns:mc should NOT be injected when original didn't have it"
            );
        }
    }
}
