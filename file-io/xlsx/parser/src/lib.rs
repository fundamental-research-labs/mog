// Typed-boundary authorship guardrail (W10): any remaining `&str[n..]` slice must be
// accompanied by an explicit `#[allow(clippy::string_slice)]` with a one-line
// ASCII-boundary justification. See `AGENTS.md` at repo root.
#![warn(clippy::string_slice)]

//! High-performance XLSX parser
//!
//! This crate provides a fast XLSX parser optimized for parsing large spreadsheets.
//!
//! Target: Parse 500K cells in under 50ms.
//!
//! # Architecture
//!
//! Modules are organized into logical groups:
//! - **`read/`** — Domain-specific parsers (strings, styles, workbook, etc.)
//! - **`pipeline/`** — Parse orchestration (full, fast, lazy, streaming)
//! - **`infra/`** — Shared XML, ZIP, namespace, and parser infrastructure
//! - **`output/`** — Result types and serialization helpers
//! - **Root-level** — Infrastructure (error handling, scanner, arena, etc.)
//! - **Domain subdirs** — Complex feature parsers (cell_parser, charts, tables, etc.)

// Allow these clippy lints at crate level for intentional patterns:
// - redundant_closure: Many parsing functions use closures for clarity with map/and_then
// - field_reassign_with_default: Parsing code intentionally builds structs field-by-field
// - derivable_impls: Some Default impls are explicit for clarity
// - unnecessary_map_or: map_or is clearer than is_none_or in some contexts
// - manual_range_contains: Explicit bounds checks can be clearer
// - only_used_in_recursion: Recursive functions may have params unused at the top level
// - if_same_then_else: Some parsing patterns have identical branches for different inputs
// - collapsible_if: Separate conditions can be clearer in parsing code
// - should_implement_trait: Custom from_str methods for parsing bytes, not FromStr trait
// - needless_range_loop: Loop variable indexing is intentional for clarity in some search code
// - manual_clamp: Explicit max/min chains can be clearer than clamp
// - large_enum_variant: Some enums have large variants by design
// - unnecessary_cast: Some casts are for cross-platform compatibility
// - wrong_self_convention: Custom to_* methods don't always need self by value
// - manual_div_ceil: Explicit division is clearer in some contexts
#![allow(clippy::redundant_closure)]
#![allow(clippy::field_reassign_with_default)]
#![allow(clippy::derivable_impls)]
#![allow(clippy::unnecessary_map_or)]
#![allow(clippy::manual_range_contains)]
#![allow(clippy::only_used_in_recursion)]
#![allow(clippy::if_same_then_else)]
#![allow(clippy::collapsible_if)]
#![allow(clippy::should_implement_trait)]
#![allow(clippy::needless_range_loop)]
#![allow(clippy::manual_clamp)]
#![allow(clippy::large_enum_variant)]
#![allow(clippy::unnecessary_cast)]
#![allow(clippy::wrong_self_convention)]
#![allow(clippy::manual_div_ceil)]

// =============================================================================
// Timing Helpers
// =============================================================================

pub(crate) fn now_us() -> f64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_micros() as f64)
            .unwrap_or(0.0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() * 1_000.0
    }
}

// =============================================================================
// Modules
// =============================================================================

// Infrastructure
pub mod bridge;
pub mod infra;

// Domain modules (all OOXML features)
pub mod domain;

// Orchestration
pub mod output;
pub mod pipeline; // Parse orchestration
pub mod testing; // Shared test contract adapters
pub mod zip; // ZIP archive reading // Result types (was: wasm/)

// Write pipeline
pub mod write;

// =============================================================================
// === Entry Points ===
// =============================================================================

// Native entry point — now crate-private. External consumers use parse_xlsx_to_output().
// Still accessible within the crate for binaries (crashtest, profile_corpus) and tests.
pub use pipeline::full_parse::parse_xlsx_full_native;
pub use pipeline::full_parse::parse_xlsx_full_native_max_sheets;

// =============================================================================
// === Core Result Types ===
// =============================================================================

pub use output::results::{
    CELL_TYPE_VAL_BOOL, CELL_TYPE_VAL_EMPTY, CELL_TYPE_VAL_ERROR, CELL_TYPE_VAL_FORMULA,
    CELL_TYPE_VAL_NUMBER, CELL_TYPE_VAL_STRING, CellMetadataBlock, CellMetadataRecord, ColWidth,
    CustomProperty, CustomPropertyValue, DocPropsApp, DocPropsCore, DocPropsCustom,
    FutureMetadataBlock, FutureMetadataGroup, LazyParseResult, LazyParseResultWithErrors,
    MergeRange, MetadataOutput, MetadataTypeOutput, Pane, PaneState, ParseResult,
    ParseResultWithErrors, ParseStats, ParseTimings, ParsedCellRange, ParsedTable,
    ParsedTableColumn, RowHeight, SheetPane,
};

// FullParseResult and related types are public so integration/corpus tests can use
// parse_xlsx_full_native(). External consumers may prefer parse_xlsx_to_output().
pub use output::results::{FullCellData, FullParseError, FullParseResult, FullParsedSheet};

pub use domain::cells::{
    CELL_TYPE_BOOL, CELL_TYPE_EMPTY, CELL_TYPE_ERROR, CELL_TYPE_FORMULA, CELL_TYPE_FORMULA_STRING,
    CELL_TYPE_NUMBER, CELL_TYPE_STRING, CellData, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE,
    VALUE_TYPE_NONE, VALUE_TYPE_SHARED_STRING,
};

// =============================================================================
// === Lazy Loading ===
// =============================================================================

pub use pipeline::lazy::{LazyWorkbook, ParseError, ParsedSheet, SheetMetadata};

// =============================================================================
// === Error Handling ===
// =============================================================================

pub use infra::error::{
    ErrorCode, ErrorCollector, ErrorLocation, ErrorSeverity, ParseContext, ParseErrorDetail,
    ParseMode, col_to_letter, format_cell_ref, recover_cell_reference, recover_number,
    recover_shared_string, recover_style_index,
};

// =============================================================================
// === Archive & ZIP ===
// =============================================================================

pub use zip::{XlsxArchive, ZipEntry, ZipError};

// =============================================================================
// === Write Module ===
// =============================================================================

pub use write::{
    CT_CHART, CT_COMMENTS, CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES, CT_DRAWING, CT_EMF,
    CT_EXTENDED_PROPERTIES, CT_GIF, CT_JPEG, CT_METADATA, CT_PIVOT_CACHE, CT_PIVOT_TABLE, CT_PNG,
    CT_RELATIONSHIPS, CT_SHARED_STRINGS, CT_STYLES, CT_TABLE, CT_TABLE_SINGLE_CELLS, CT_THEME,
    CT_VBA, CT_WMF, CT_WORKBOOK, CT_WORKSHEET, CT_XML, CompressionMethod, ContentTypeDefault,
    ContentTypeOverride, ContentTypesManager, ZipWriteEntry, ZipWriteError, ZipWriter,
    create_xlsx_content_types,
};

// =============================================================================
// === Domain Types ===
// =============================================================================

pub use domain::controls::read::{
    extract_vml_shape_number, parse_vml_imagedata, parse_worksheet_controls,
    parse_worksheet_controls_from_xml,
};
pub use domain::controls::types::{
    ActiveXControl, AnchorSource, CheckState, ControlAnchor, FormControl, FormControlProperties,
    FormControlType, ModernAnchorResult, OleObject, WorksheetControl, WorksheetControlRef,
    WorksheetControls,
};
pub use domain::external::ExternalLinks;
pub use domain::hyperlinks::{
    Hyperlink, HyperlinkRelationship, HyperlinkType, Hyperlinks, TargetMode,
};
pub use domain::names::{BuiltInName, DefinedName, DefinedNames};
pub use domain::print::{
    CellComments, HeaderFooter, HeaderFooterSection, Orientation, PageBreak, PageBreaks,
    PageMargins, PageOrder, PageSetup, PaperSize, PrintErrors, PrintOptions, PrintSettings,
};
pub use domain::protection::read::{
    FileSharing, HashAlgorithm, SheetProtection, SheetProtectionParse, WorkbookProtection,
    WorkbookProtectionParse,
};
pub use domain::rich_text::{
    Color, FontProperties, PhoneticProperties, PhoneticRun, RichText, RunProperties, TextRun,
    UnderlineStyle, VerticalAlign,
};
pub use domain::sparklines::read::{
    DisplayEmptyCellsAs, Sparkline, SparklineAxisType, SparklineColor, SparklineGroup,
    SparklineGroups, SparklineType, parse_sparklines,
};
pub use domain::strings::read::SharedStrings;
pub use domain::styles::read::{builtin_format, get_number_format, is_date_format, parse_styles};
pub use domain::styles::types::{CellXfDef, NumberFormatDef, Stylesheet};
pub use domain::tables::{
    AutoFilter, FilterColumn, Table, TableColumn, TableStyleInfo, TableType, TotalsRowFunction,
};
pub use domain::themes::{
    ColorScheme, FontCollection, FontScheme, FormatScheme, RgbColor, Theme, ThemeColor,
    ThemeFontDef,
};
pub use domain::workbook::read::{
    CalcPrSettings, SheetInfo, parse_calc_settings, parse_workbook, parse_workbook_rels,
};
pub use domain_types::domain::external_link::{
    CachedValue, ExternalCacheValue, ExternalDefinedName, ExternalLink, ExternalLinkType,
};

// =============================================================================
// === XML Infrastructure And Import Helpers ===
// =============================================================================

pub use infra::imported_parts::{
    CT_OLE_OBJECT, CT_PRINTER_SETTINGS, ImportedPackageParts, infer_content_type,
};
pub use infra::xml_fragment::{extract_element_bounds, extract_element_xml};
pub use infra::xml_namespaces::{
    NS_CONTENT_TYPES, NS_DRAWING_ML, NS_MC, NS_RELATIONSHIPS, NS_SPREADSHEET_ML, NS_X14,
    NamespaceDeclaration, NamespaceMap, NamespaceWriter, styles_namespaces, workbook_namespaces,
    worksheet_namespaces,
};
pub use pipeline::import_extensions::ImportExtensionParts;

// =============================================================================
// === Streaming & Infrastructure ===
// =============================================================================

pub use infra::arena::ParseArena;

pub use pipeline::streaming::{
    DEFAULT_BUFFER_SIZE, ParseState, StreamingCellParser, StreamingDeflate,
};

#[cfg(all(not(target_arch = "wasm32"), feature = "parallel"))]
pub use pipeline::parallel::{
    ParallelParseError, ParallelParseResult, SheetCells, parse_xlsx_parallel,
};

// === Utilities ===

pub use output::results::{errors_to_json, escape_json_string, mode_from_u32, parse_a1_range};

pub use domain::comments::read::parse_comments_for_sheet;
pub use domain::cond_format::read::parse_conditional_formats;
pub use domain::pivot::read::parse_all_pivot_caches;
pub use domain::tables::read::parse_tables_for_sheet;
pub use domain::validation::read::{parse_data_validations, parse_x14_data_validations};
pub use domain::worksheet::read::{
    parse_col_widths, parse_dimensions, parse_frozen_pane, parse_merge_cells,
    parse_sheet_format_pr, parse_sheet_view, parse_sheet_views,
};

// =============================================================================
// === Domain-typed parse output ===
// =============================================================================

// full_parse_result_to_parse_output is now crate-private; use parse_xlsx_to_output() instead.
pub(crate) use output::to_parse_output::full_parse_result_to_parse_output;

/// Parse XLSX bytes directly into shared domain types.
///
/// Returns:
/// - `ParseOutput`: Semantic data (cells, merges, styles, domain objects)
/// - `ParseDiagnostics`: Parse errors and statistics
pub fn parse_xlsx_to_output(
    xlsx_data: &[u8],
) -> Result<(domain_types::ParseOutput, domain_types::ParseDiagnostics), String> {
    let result = parse_xlsx_full_native(xlsx_data, None)?;
    Ok(full_parse_result_to_parse_output(&result))
}

/// Parse XLSX with a limit on the number of sheets to fully parse.
/// Sheets beyond `max_sheets` get metadata only (name, dimensions, visibility)
/// but no cell data, merges, charts, comments, etc.
pub fn parse_xlsx_to_output_max_sheets(
    xlsx_data: &[u8],
    max_sheets: usize,
) -> Result<(domain_types::ParseOutput, domain_types::ParseDiagnostics), String> {
    let result =
        pipeline::full_parse::parse_xlsx_full_native_max_sheets(xlsx_data, None, max_sheets)?;
    Ok(full_parse_result_to_parse_output(&result))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_xlsx_with_sheet(sheet_xml: Vec<u8>) -> Vec<u8> {
        let mut zip = ZipWriter::new();
        zip.add_file(
            "[Content_Types].xml",
            br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#.to_vec(),
        );
        zip.add_file(
            "_rels/.rels",
            br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_vec(),
        );
        zip.add_file(
            "xl/workbook.xml",
            br#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#.to_vec(),
        );
        zip.add_file(
            "xl/_rels/workbook.xml.rels",
            br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.to_vec(),
        );
        zip.add_file("xl/worksheets/sheet1.xml", sheet_xml);
        zip.finish().expect("minimal xlsx zip")
    }

    #[test]
    fn test_now_us_returns_positive() {
        let t = now_us();
        assert!(t > 0.0);
    }

    #[test]
    fn public_parse_rejects_malformed_zip() {
        let result = parse_xlsx_to_output(b"PK\x03\x04truncated");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("archive"));
    }

    #[test]
    fn public_parse_rejects_malformed_worksheet_utf8() {
        let xlsx = minimal_xlsx_with_sheet(vec![
            b'<', b'w', b'o', b'r', b'k', b's', b'h', b'e', b'e', b't', b'>', 0xff,
        ]);

        let result = parse_xlsx_to_output(&xlsx);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("UTF-8"));
    }

    /// Regression test: charts must survive export → re-import → re-export.
    /// Tests that absolute OPC target paths (e.g., `/xl/drawings/drawing1.xml`)
    /// are correctly normalized to ZIP paths during export.
    #[test]
    fn test_chart_double_round_trip() {
        let fixture = include_bytes!("../test-corpus/parity/charts/chart-bar.xlsx");
        let (output1, _) = parse_xlsx_to_output(fixture).expect("first parse failed");
        let charts_1: usize = output1.sheets.iter().map(|s| s.charts.len()).sum();
        assert!(charts_1 > 0, "original should have charts");

        // Export
        let exported = write::from_parse_output::write_xlsx_from_parse_output(&output1)
            .expect("export failed");

        // Verify drawing paths in the exported archive are correct
        {
            let archive = crate::zip::XlsxArchive::new(&exported).expect("re-open archive");
            let drawing_paths: Vec<_> = archive
                .entries()
                .iter()
                .filter(|e| e.name.contains("drawing") && e.name.ends_with(".xml"))
                .map(|e| e.name.clone())
                .collect();
            for path in &drawing_paths {
                assert!(
                    !path.contains("//"),
                    "drawing path has double slash: {}",
                    path
                );
            }
        }

        // Re-import and verify charts survive
        let (output2, _) = parse_xlsx_to_output(&exported).expect("re-import failed");
        let charts_2: usize = output2.sheets.iter().map(|s| s.charts.len()).sum();
        assert_eq!(charts_2, charts_1, "charts lost during re-import");
    }

    #[test]
    fn chart_xml_stabilizes_after_reimport_export() {
        let fixture = include_bytes!("../test-corpus/parity/charts/chart-bar.xlsx");
        let (output1, _) = parse_xlsx_to_output(fixture).expect("first parse failed");
        let exported1 = write::from_parse_output::write_xlsx_from_parse_output(&output1)
            .expect("first export failed");

        let (output2, _) = parse_xlsx_to_output(&exported1).expect("second parse failed");
        let exported2 = write::from_parse_output::write_xlsx_from_parse_output(&output2)
            .expect("second export failed");

        let archive1 = crate::zip::XlsxArchive::new(&exported1).expect("first archive");
        let archive2 = crate::zip::XlsxArchive::new(&exported2).expect("second archive");
        let chart1 = archive1
            .read_file("xl/charts/chart1.xml")
            .expect("first chart XML");
        let chart2 = archive2
            .read_file("xl/charts/chart1.xml")
            .expect("second chart XML");

        assert_eq!(
            chart2, chart1,
            "canonical chart XML changed after re-import/export"
        );
    }
}
