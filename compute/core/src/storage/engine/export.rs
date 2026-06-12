//! XLSX export — builds a `ParseOutput` from the current Yrs storage state and
//! produces `.xlsx` bytes from the engine's live state.
//!
//! This is the reverse of `hydration.rs`: instead of writing structured Y.Maps
//! from a `ParseOutput`, we READ the structured Y.Maps and produce a `ParseOutput`.
//!
//! This is needed so the unified XLSX writer can consume modeled `ParseOutput`
//! from the running engine.
//!
//! ## Architecture
//!
//! ```text
//! YrsComputeEngine (live state)
//!     │
//!     ▼
//! build_parse_output_from_yrs()
//!     ├── Per sheet:
//!     │   ├── read cells from grid_indexes (CellId → position) + compute values
//!     │   ├── read merges from Yrs merges map
//!     │   ├── read frozen panes, view settings from sheet meta
//!     │   ├── read row heights, col widths (custom dimensions)
//!     │   ├── read comments from Yrs comments map
//!     │   └── build style_palette entries from cell/row/col formats
//!     └── Workbook-level: named ranges
//! ```
//!
//! ## Key challenge: identity → position reversal
//!
//! Cells in Yrs are keyed by CellId (UUID), but `ParseOutput` needs `(row, col)`.
//! We use the in-memory `GridIndex` to reverse CellId → `(row, col)`.

use bridge_core as bridge;
use value_types::ComputeError;

use domain_types::{
    CellData, ColStyleEntry, DocumentFormat, ParseOutput, RowStyleEntry, SheetDimensions,
    domain::filter::AutoFilter,
    domain::floating_object::FloatingObject,
    domain::hyperlink::Hyperlink,
    domain::outline::OutlineGroup,
    domain::print::PageBreaks,
    domain::protection::SheetProtection,
    domain::sparkline::{Sparkline as DomainSparkline, SparklineGroup},
    domain::theme::ThemeData,
    domain::validation::ValidationSpec,
    domain::workbook::WorkbookProtection,
};

use yrs::{Map, MapRef, Out, ReadTxn};

use cell_types::SheetId;

use super::YrsComputeEngine;

pub(super) use crate::range_manager::pos_to_a1;

// =============================================================================
// Sorted map iteration helpers
// =============================================================================

/// Parse the numeric suffix from a key like `"prefix-42"` and return it for sorting.
/// Returns `None` for non-numeric suffixes (e.g., UUID keys from runtime CRUD).
fn parse_key_suffix(key: &str) -> Option<usize> {
    key.rsplit_once('-')
        .and_then(|(_, suffix)| suffix.parse::<usize>().ok())
}

/// Collect map entries sorted by key numeric suffix.
/// Numeric-suffix keys sort first (ascending by suffix), then non-numeric keys
/// sort lexicographically after them.
pub(super) fn sorted_map_entries<T: ReadTxn>(map: &MapRef, txn: &T) -> Vec<(String, Out)> {
    let mut entries: Vec<(String, Out)> = map.iter(txn).map(|(k, v)| (k.to_string(), v)).collect();
    entries.sort_by(|(a, _), (b, _)| {
        let a_idx = parse_key_suffix(a);
        let b_idx = parse_key_suffix(b);
        match (a_idx, b_idx) {
            (Some(ai), Some(bi)) => ai.cmp(&bi).then_with(|| a.cmp(b)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.cmp(b),
        }
    });
    entries
}

// =============================================================================
// Export result type
// =============================================================================

/// Result of `export_to_parse_output`.
#[derive(Debug, Clone)]
pub struct ExportParseResult {
    /// Semantic spreadsheet data (same type the XLSX parser emits).
    pub parse_output: ParseOutput,
}

// =============================================================================
// Bridge API (exposed to TS via WASM / N-API / Tauri)
// =============================================================================

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "export",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    /// Exports the current workbook state to XLSX bytes in a single call.
    ///
    /// Uses the export path: Yrs → `ParseOutput` → `write_xlsx_from_parse_output` → bytes.
    /// This produces a rich XLSX (styles, comments, dimensions, named ranges).
    #[bridge::read(scope = "workbook")]
    #[tracing::instrument(name = "engine_export_to_xlsx_bytes", skip_all)]
    pub fn export_to_xlsx_bytes(&self) -> Result<Vec<u8>, ComputeError> {
        let result = self.export_to_parse_output()?;
        self.write_xlsx_export_result(&result)
    }

    /// Exports the current workbook state through the modeled parse-output path.
    ///
    /// This anti-cheat path must agree with normal export for modeled workbook
    /// facts. Any difference outside registered opaque subgraphs means source
    /// bytes are still required for modeled correctness.
    #[bridge::read(scope = "workbook")]
    #[tracing::instrument(name = "engine_export_to_xlsx_bytes_context_stripped", skip_all)]
    pub fn export_to_xlsx_bytes_context_stripped(&self) -> Result<Vec<u8>, ComputeError> {
        let result = self.export_to_parse_output()?;
        self.write_xlsx_export_result(&result)
    }

    fn write_xlsx_export_result(
        &self,
        result: &ExportParseResult,
    ) -> Result<Vec<u8>, ComputeError> {
        let bytes = {
            let mut profile =
                crate::xlsx_profile::PhaseTimer::new("export", "export_to_xlsx_writer");
            let bytes = xlsx_api::export_from_parse_output(&result.parse_output).map_err(|e| {
                ComputeError::ExportError {
                    message: e.to_string(),
                }
            })?;
            profile.counter("sheets", result.parse_output.sheets.len() as u64);
            profile.counter(
                "cells",
                result
                    .parse_output
                    .sheets
                    .iter()
                    .map(|sheet| sheet.cells.len() as u64)
                    .sum::<u64>(),
            );
            profile.counter("bytes", bytes.len() as u64);
            bytes
        };

        Ok(bytes)
    }
}

// =============================================================================
// Main entry point
// =============================================================================

impl YrsComputeEngine {
    /// Build a `ParseOutput` from the current Yrs storage state.
    ///
    /// Reads structured Y.Map fields (not JSON blobs) for all domains.
    /// This produces the same type that the XLSX parser emits, enabling
    /// the unified XLSX writer to consume it.
    #[tracing::instrument(name = "build_parse_output_from_yrs", skip_all)]
    pub fn build_parse_output_from_yrs(&self) -> ParseOutput {
        let mut profile =
            crate::xlsx_profile::PhaseTimer::new("export", "build_parse_output_from_yrs");
        let parse_output =
            super::services::export::build_parse_output_from_yrs(&self.stores, &self.mirror);
        profile.counter("sheets", parse_output.sheets.len() as u64);
        profile.counter(
            "cells",
            parse_output
                .sheets
                .iter()
                .map(|sheet| sheet.cells.len() as u64)
                .sum::<u64>(),
        );
        parse_output
    }

    /// Export the engine state as a `ParseOutput`.
    #[tracing::instrument(name = "engine_export_to_parse_output", skip_all)]
    pub fn export_to_parse_output(&self) -> Result<ExportParseResult, ComputeError> {
        self.require_all_sheets_materialized("export_to_parse_output")?;
        let parse_output = self.build_parse_output_from_yrs();
        Ok(ExportParseResult { parse_output })
    }
}

impl YrsComputeEngine {
    fn require_all_sheets_materialized(&self, operation: &str) -> Result<(), ComputeError> {
        if self.deferred_hydration.is_some() {
            return Err(ComputeError::InvalidInput {
                message: format!(
                    "{operation} requires deferred XLSX hydration to complete before reading all sheets"
                ),
            });
        }
        Ok(())
    }
}

// =============================================================================
// Per-sheet cell export
// =============================================================================

#[allow(dead_code)]
impl YrsComputeEngine {
    /// Export all cells for a sheet as position-keyed `CellData`.
    ///
    /// Iterates the grid_index (which maps CellId → position) and reads
    /// values from ComputeCore (for recalc'd formulas) or the mirror.
    /// Builds style_palette entries for cells with formatting.
    ///
    /// Style ids are derived from the current semantic formats and the generated
    /// export palette; imported XLSX `cellXfs` indices are not preserved as
    /// style identity.
    fn export_cells_for_sheet(
        &self,
        sheet_id: &SheetId,
        style_palette: &mut Vec<DocumentFormat>,
    ) -> Vec<CellData> {
        let palette = super::services::export::LocalPalette::from_vec(style_palette);
        let result = super::services::export::export_cells_for_sheet(
            &self.stores,
            &self.mirror,
            sheet_id,
            &palette,
        );
        *style_palette = palette.into_vec();
        result
    }

    /// Export dimensions (custom row heights and column widths) for a sheet.
    fn export_dimensions_for_sheet(
        &self,
        sheet_id: &SheetId,
        override_max_col: Option<u32>,
    ) -> SheetDimensions {
        super::services::export::export_dimensions_for_sheet(
            &self.stores,
            &self.mirror,
            sheet_id,
            override_max_col,
        )
    }

    /// Export row-level and column-level style overrides for a sheet.
    ///
    /// Style ids are derived from the current semantic formats and the generated
    /// export palette; imported XLSX `cellXfs` indices are not preserved as
    /// style identity.
    fn export_row_col_styles_for_sheet(
        &self,
        sheet_id: &SheetId,
        max_row: u32,
        max_col: u32,
        style_palette: &mut Vec<DocumentFormat>,
    ) -> (Vec<RowStyleEntry>, Vec<ColStyleEntry>) {
        let palette = super::services::export::LocalPalette::from_vec(style_palette);
        let result = super::services::export::export_row_col_styles_for_sheet(
            &self.stores,
            sheet_id,
            max_row,
            max_col,
            &palette,
        );
        *style_palette = palette.into_vec();
        result
    }

    /// Resolve a cell_id string to (row, col) using the compute mirror.
    fn resolve_cell_position(&self, sheet_id: &SheetId, cell_id_hex: &str) -> Option<(u32, u32)> {
        let result = self.get_cell_position(sheet_id, cell_id_hex)?;
        Some((result.row, result.col))
    }

    /// Export all hyperlinks for a sheet, reading both cell-level hyperlinks
    /// and any range hyperlinks stored in the sheet meta.
    fn export_hyperlinks_for_sheet(&self, sheet_id: &SheetId) -> Vec<Hyperlink> {
        super::services::export::export_hyperlinks_for_sheet(&self.stores, sheet_id)
    }

    /// Export the container-level `disablePrompts` flag for data validations.
    fn export_dv_disable_prompts(&self, sheet_id: &SheetId) -> bool {
        super::services::export::export_dv_disable_prompts(&self.stores, sheet_id)
    }

    /// Export a container-level u32 attribute from sheet meta (e.g. dvXWindow, dvYWindow).
    fn export_dv_window_attr(&self, sheet_id: &SheetId, key: &str) -> Option<u32> {
        super::services::export::export_dv_window_attr(&self.stores, sheet_id, key)
    }

    /// Export data validations from the canonical range-backed validation store.
    fn export_data_validations_for_sheet(&self, sheet_id: &SheetId) -> Vec<ValidationSpec> {
        super::services::export::export_data_validations_for_sheet(&self.stores, sheet_id)
    }

    /// Export sheet protection from the structured Y.Map in sheet meta
    /// using `yrs_schema::protection::sheet_from_yrs_map`. Falls back to legacy JSON string.
    fn export_sheet_protection(&self, sheet_id: &SheetId) -> Option<SheetProtection> {
        super::services::export::export_sheet_protection(&self.stores, sheet_id)
    }

    /// Export sparklines from the structured sparklines Y.Map using yrs_schema.
    fn export_sparklines_for_sheet(&self, sheet_id: &SheetId) -> Vec<DomainSparkline> {
        super::services::export::export_sparklines_for_sheet(&self.stores, sheet_id)
    }

    /// Export sparkline groups from the structured sparklines Y.Map using yrs_schema.
    fn export_sparkline_groups_for_sheet(&self, sheet_id: &SheetId) -> Vec<SparklineGroup> {
        super::services::export::export_sparkline_groups_for_sheet(&self.stores, sheet_id)
    }

    /// Export page breaks from sheet metadata.
    fn export_page_breaks_for_sheet(&self, sheet_id: &SheetId) -> Option<PageBreaks> {
        super::services::export::export_page_breaks_for_sheet(&self.stores, sheet_id)
    }

    /// Export auto filter by reading FilterState entries from the runtime filters
    /// map and converting the AutoFilter-kind entry back to OOXML AutoFilter.
    fn export_auto_filter_for_sheet(&self, sheet_id: &SheetId) -> Option<AutoFilter> {
        let pos_resolver =
            |cell_id: &str| -> Option<(u32, u32)> { self.resolve_cell_position(sheet_id, cell_id) };
        super::services::export::export_auto_filter_for_sheet(&self.stores, sheet_id, &pos_resolver)
    }

    /// Export outline groups from the grouping Y.Map using yrs_schema.
    fn export_outline_groups_for_sheet(
        &self,
        sheet_id: &SheetId,
    ) -> (
        Vec<OutlineGroup>,
        Option<ooxml_types::worksheet::OutlineProperties>,
    ) {
        super::services::export::export_outline_groups_for_sheet(&self.stores, sheet_id)
    }

    /// Export floating objects from the floating objects Y.Map.
    fn export_floating_objects_for_sheet(
        &self,
        sheet_id: &SheetId,
    ) -> (
        Vec<FloatingObject>,
        Vec<ooxml_types::slicers::SlicerDef>,
        Vec<ooxml_types::slicers::SlicerAnchor>,
        Vec<ooxml_types::timelines::TimelineDef>,
        Vec<ooxml_types::timelines::TimelineAnchor>,
    ) {
        super::services::export::export_floating_objects_for_sheet(
            &self.stores,
            &self.mirror,
            sheet_id,
        )
    }

    /// Export theme data from the workbook-level theme map.
    fn export_workbook_theme(&self) -> Option<ThemeData> {
        super::services::export::export_workbook_theme(&self.stores)
    }

    /// Export workbook protection from the workbook settings map.
    fn export_workbook_protection(&self) -> Option<WorkbookProtection> {
        super::services::export::export_workbook_protection(&self.stores)
    }

    /// Export slicer caches from the workbook-level slicers map.
    fn export_workbook_slicer_caches(&self) -> Vec<ooxml_types::slicers::SlicerCacheDef> {
        super::services::export::export_workbook_slicer_caches(&self.stores, None)
    }

    /// Export parsed pivot tables from workbook-level pivotSpecs map.
    fn export_workbook_parsed_pivot_tables(
        &self,
    ) -> Vec<domain_types::domain::pivot::ParsedPivotTable> {
        super::services::export::export_workbook_parsed_pivot_tables(&self.stores)
    }
}

// =============================================================================
// Format conversion
// =============================================================================

/// Convert a `CellFormat` (compute-core format) to a `DocumentFormat` (domain-types).
pub(super) fn cell_format_to_document_format(fmt: &domain_types::CellFormat) -> DocumentFormat {
    DocumentFormat::from(fmt)
}

// =============================================================================
// Helpers
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pos_to_a1() {
        assert_eq!(pos_to_a1(0, 0), "A1");
        assert_eq!(pos_to_a1(0, 1), "B1");
        assert_eq!(pos_to_a1(0, 25), "Z1");
        assert_eq!(pos_to_a1(0, 26), "AA1");
        assert_eq!(pos_to_a1(0, 27), "AB1");
        assert_eq!(pos_to_a1(9, 2), "C10");
        assert_eq!(pos_to_a1(0, 701), "ZZ1");
    }

    #[test]
    fn test_cell_format_to_document_format_empty() {
        let fmt = domain_types::CellFormat::default();
        let doc_fmt = cell_format_to_document_format(&fmt);
        assert_eq!(doc_fmt, DocumentFormat::default());
    }

    #[test]
    fn test_cell_format_to_document_format_with_font() {
        let mut fmt = domain_types::CellFormat::default();
        fmt.font_family = Some("Arial".to_string());
        fmt.bold = Some(true);
        fmt.font_size = Some(domain_types::FontSize::from_millipoints(14000));
        let doc_fmt = cell_format_to_document_format(&fmt);
        assert!(doc_fmt.font.is_some());
        let font = doc_fmt.font.unwrap();
        assert_eq!(font.name, Some("Arial".to_string()));
        assert_eq!(font.bold, Some(true));
        assert_eq!(font.size, Some(14000));
    }

    #[test]
    fn test_cell_format_to_document_format_with_fill() {
        let mut fmt = domain_types::CellFormat::default();
        fmt.background_color = Some("#FF0000".to_string());
        let doc_fmt = cell_format_to_document_format(&fmt);
        assert!(doc_fmt.fill.is_some());
        let fill = doc_fmt.fill.unwrap();
        assert_eq!(fill.background_color, Some("#FF0000".to_string()));
    }
}
