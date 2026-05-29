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
use crate::domain::print::write::PrintWriter;
use domain_types::{AuthoredStyleRun, WorksheetSemanticContainers};
pub use ooxml_types::worksheet::{
    ColWidth, MergeRange, OutlineProperties, Selection, SheetCalcPr, SheetPane, SheetProperties,
    SheetView, SheetViewType,
};
use std::collections::BTreeMap;

mod body;
mod cell;
mod data;
mod formula_storage;
mod hyperlinks;
mod raw_sections;
mod relationships;
mod root;
mod sheet_data;

#[cfg(test)]
use cell::format_number;
pub use data::{CellData, CellValue, RowDef, SheetFormatPr};

// ============================================================================
// Sheet Writer
// ============================================================================

/// The main sheet writer.
///
/// Generates worksheet XML for XLSX files.
///
/// Worksheet `<dimension>` is semantic output: by default it is derived from
/// the cells queued on this writer, with empty sheets emitting the canonical
/// `A1` extent. Imported dimension refs may be supplied as typed advisory
/// metadata when the parse-output owner intentionally carries them forward.
#[derive(Debug, Clone)]
pub struct SheetWriter {
    /// Sheet dimension (startRow, startCol, endRow, endCol), all 0-indexed
    pub(super) dimension: Option<(u32, u32, u32, u32)>,
    /// Authored worksheet dimension ref to emit in the canonical dimension slot.
    pub(super) dimension_ref: Option<String>,
    /// Column definitions
    pub(super) cols: Vec<ColWidth>,
    /// Row data: row index -> (RowDef, cells)
    pub(super) rows: BTreeMap<u32, (RowDef, Vec<CellData>)>,
    /// Authored style-only blank cell coverage.
    pub(super) authored_style_runs: Vec<AuthoredStyleRun>,
    /// Merge ranges
    pub(super) merges: Vec<MergeRange>,
    /// Sheet view settings (one or more `<sheetView>` elements)
    pub(super) sheet_views: Vec<SheetView>,
    /// Direct-child `<extLst>` under `<sheetViews>`.
    pub(super) sheet_views_ext_lst_xml: Option<String>,
    /// Modeled worksheet properties emitted as `<sheetPr>`.
    pub(super) sheet_properties: Option<SheetProperties>,
    /// Print settings (margins, page setup, header/footer, print options, breaks)
    pub(super) print_writer: Option<PrintWriter>,
    /// Sheet format properties (default row height, column width)
    pub(super) sheet_format_pr: SheetFormatPr,
    /// Stable sheet identity for co-authoring (xr:uid on <worksheet> root)
    pub(super) uid: Option<String>,
    /// Tier 2: Captured namespace declarations for round-trip fidelity
    pub(super) root_namespaces: Option<crate::infra::xml_namespaces::NamespaceMap>,
    /// Raw autoFilter XML for verbatim round-trip passthrough.
    pub(super) auto_filter_xml: Option<String>,
    /// Typed worksheet semantic containers emitted from SheetData, not preserved XML.
    pub(super) worksheet_semantic_containers: WorksheetSemanticContainers,
    /// Typed worksheet calculation properties emitted as `<sheetCalcPr>`.
    pub(super) sheet_calc_pr: Option<SheetCalcPr>,
    /// Raw sortState XML for verbatim round-trip passthrough.
    pub(super) sort_state_xml: Option<String>,
    /// Raw conditionalFormatting XML for verbatim round-trip passthrough.
    pub(super) conditional_formatting_xml: Option<String>,
    /// Raw dataValidations XML for verbatim round-trip passthrough.
    pub(super) data_validations_xml: Option<String>,
    /// Raw customProperties XML for verbatim round-trip passthrough.
    pub(super) custom_properties_xml: Option<String>,
    /// Relationship ID for `<legacyDrawing r:id="..."/>` element.
    /// Links to the VML drawing part for comments, form controls, etc.
    pub(super) legacy_drawing_r_id: Option<String>,
    /// Relationship ID for `<legacyDrawingHF r:id="..."/>` element.
    /// Links to the VML drawing part for header/footer images.
    pub(super) legacy_drawing_hf_r_id: Option<String>,
    /// Relationship ID for `<drawing r:id="..."/>` element.
    /// Links to the DrawingML drawing part.
    pub(super) drawing_r_id: Option<String>,
    /// Hyperlinks for round-trip fidelity.
    pub(super) hyperlinks: Vec<crate::output::results::HyperlinkOutput>,
    /// Raw sheetProtection XML for verbatim passthrough.
    pub(super) sheet_protection_xml: Option<String>,
    /// Raw mc:AlternateContent controls XML for form controls.
    pub(super) controls_xml: Option<String>,
    /// Modeled worksheet `<oleObjects>` XML.
    pub(super) ole_objects_xml: Option<String>,
    /// Raw tableParts XML for verbatim passthrough.
    pub(super) table_parts_xml: Option<String>,
    /// Relationship IDs for generated worksheet pivot table references.
    pub(super) pivot_table_r_ids: Vec<String>,
    /// Raw extLst XML for sparklines and other extensions.
    pub(super) ext_lst_xml: Option<String>,
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
            sheet_views: vec![SheetView::default()],
            sheet_views_ext_lst_xml: None,
            sheet_properties: None,
            print_writer: None,
            sheet_format_pr: SheetFormatPr::default(),
            uid: None,
            root_namespaces: None,
            auto_filter_xml: None,
            worksheet_semantic_containers: WorksheetSemanticContainers::default(),
            sheet_calc_pr: None,
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
            ole_objects_xml: None,
            table_parts_xml: None,
            pivot_table_r_ids: Vec::new(),
            ext_lst_xml: None,
        }
    }

    /// Set sheet dimension explicitly.
    ///
    /// Most production exports should leave this unset so the writer derives
    /// the `<dimension>` ref from modeled cells. This override is for callers
    /// that already computed a compatible semantic extent, not for replaying
    /// an authored worksheet XML string.
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

    /// Set an authored worksheet dimension ref that was already validated by
    /// the parse-output owner against the live cells this writer will emit.
    pub fn set_dimension_ref(&mut self, dimension_ref: String) -> &mut Self {
        self.dimension_ref = Some(dimension_ref);
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
                && last.width_str == col.width_str
                && last.custom_width == col.custom_width
                && last.custom_width_attr == col.custom_width_attr
                && last.hidden == col.hidden
                && last.hidden_attr == col.hidden_attr
                && last.best_fit == col.best_fit
                && last.best_fit_attr == col.best_fit_attr
                && last.style == col.style
                && last.outline_level == col.outline_level
                && last.collapsed == col.collapsed
                && last.collapsed_attr == col.collapsed_attr
                && last.phonetic == col.phonetic
                && last.phonetic_attr == col.phonetic_attr
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
        col_width.custom_width_attr = Some(true);
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
                cw.hidden_attr = Some(true);
            }
        } else {
            // Create a minimal col entry with no custom width
            let mut cw = ColWidth::range(col_1indexed, col_1indexed, 0.0);
            cw.width = None;
            cw.outline_level = Some(level);
            cw.hidden = hidden;
            if hidden {
                cw.hidden_attr = Some(true);
            }
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
            if collapsed {
                cw.collapsed_attr = Some(true);
            }
        } else {
            let mut cw = ColWidth::range(col_1indexed, col_1indexed, 0.0);
            cw.width = None;
            cw.collapsed = collapsed;
            if collapsed {
                cw.collapsed_attr = Some(true);
            }
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

    /// Set row phonetic display flag.
    pub fn set_row_phonetic(&mut self, row: u32, phonetic: bool) -> &mut Self {
        let entry = self
            .rows
            .entry(row)
            .or_insert_with(|| (RowDef::default(), Vec::new()));
        entry.0.phonetic = phonetic;
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

    /// Set direct-child `<sheetViews><extLst>...` XML after safety filtering.
    pub fn set_sheet_views_ext_lst_xml(&mut self, xml: String) -> &mut Self {
        self.sheet_views_ext_lst_xml = Some(xml);
        self
    }

    /// Set modeled worksheet outline properties.
    pub fn set_outline_properties(&mut self, outline_properties: OutlineProperties) -> &mut Self {
        let mut properties = self.sheet_properties.take().unwrap_or_default();
        properties.outline_pr = Some(outline_properties);
        self.sheet_properties = Some(properties);
        self
    }

    /// Set modeled worksheet properties.
    pub fn set_sheet_properties(&mut self, sheet_properties: SheetProperties) -> &mut Self {
        self.sheet_properties = Some(sheet_properties);
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

    /// Set root namespace declarations for round-trip fidelity.
    pub fn set_root_namespaces(
        &mut self,
        ns: crate::infra::xml_namespaces::NamespaceMap,
    ) -> &mut Self {
        self.root_namespaces = Some(ns);
        self
    }

    /// Set raw autoFilter XML for verbatim round-trip passthrough.
    pub fn set_auto_filter_xml(&mut self, xml: String) -> &mut Self {
        self.auto_filter_xml = Some(xml);
        self
    }

    pub fn set_worksheet_semantic_containers(
        &mut self,
        containers: WorksheetSemanticContainers,
    ) -> &mut Self {
        self.worksheet_semantic_containers = containers;
        self
    }

    pub fn set_sheet_calc_pr(&mut self, sheet_calc_pr: SheetCalcPr) -> &mut Self {
        self.sheet_calc_pr = Some(sheet_calc_pr);
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

    /// Set raw extLst XML for sparklines and other extensions.
    pub fn set_ext_lst_xml(&mut self, xml: String) -> &mut Self {
        self.ext_lst_xml = Some(xml);
        self
    }

    /// Append a generated `<ext ...>` entry to the worksheet `<extLst>`.
    pub fn append_ext_lst_entry(&mut self, ext_xml: String) -> &mut Self {
        match self.ext_lst_xml.as_mut() {
            Some(existing) => {
                if let Some(pos) = existing.rfind("</extLst>") {
                    existing.insert_str(pos, &ext_xml);
                } else {
                    existing.push_str(&ext_xml);
                }
            }
            None => {
                self.ext_lst_xml = Some(format!("<extLst>{ext_xml}</extLst>"));
            }
        }
        self
    }

    /// Set raw mc:AlternateContent controls XML for form controls.
    pub fn set_controls_xml(&mut self, xml: String) -> &mut Self {
        self.controls_xml = Some(xml);
        self
    }

    /// Set modeled worksheet `<oleObjects>` XML.
    pub fn set_ole_objects_xml(&mut self, xml: String) -> &mut Self {
        self.ole_objects_xml = Some(xml);
        self
    }

    /// Check if legacy_drawing_r_id has been set.
    pub fn has_legacy_drawing_r_id(&self) -> bool {
        self.legacy_drawing_r_id.is_some()
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
        w.write_declaration();
        root::write_worksheet_start(&mut w, self);
        body::write_worksheet_body(&mut w, self);
        root::write_worksheet_end(&mut w);
        w.finish()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

pub use crate::infra::a1::{col_to_letter, to_a1};

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests;
