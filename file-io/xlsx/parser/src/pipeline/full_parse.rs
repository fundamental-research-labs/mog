//! Native full-parse pipeline for XLSX files.
//!
//! This module contains the core parse logic shared between the WASM entry points
//! (`wasm_bindings.rs`) and native CLI tools (`bin/crashtest.rs`). All functions
//! here are pure Rust with no WASM dependencies.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices
//! attribute / sheet-qualified reference content at byte offsets
//! produced by ASCII-only delimiters (`<`, `>`, `"`, `=`, `!`, `$`).
//! Char-boundary by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::domain::cells::{
    CellData, ParseExtras, apply_parse_extras, build_col_styles_from_widths,
    coalesce_authored_style_only_cells, convert_cell_data, data_table_info,
    parse_worksheet_fast_with_extras,
};
use crate::domain::charts::read::{
    parse_charts_for_sheet, parse_connectors_for_sheet, parse_drawing_and_charts_for_sheet,
    parse_smartart_for_sheet,
};
use crate::domain::comments::read::parse_comments_for_sheet;
use crate::domain::cond_format::read::parse_conditional_formats;
use crate::domain::controls::read::{parse_form_controls_for_sheet, parse_ole_objects_for_sheet};
use crate::domain::hyperlinks;
use crate::domain::names;
use crate::domain::pivot::read::parse_all_pivot_caches;
use crate::domain::print;
use crate::domain::protection::read as protection;
use crate::domain::protection::read::{SheetProtectionParse, WorkbookProtectionParse};
use crate::domain::slicers::read::{parse_all_slicer_caches, parse_slicers_for_sheet};
use crate::domain::sparklines;
use crate::domain::strings::read::SharedStrings;
use crate::domain::styles::read::{parse_known_fonts, parse_styles};
use crate::domain::tables::read::parse_tables_for_sheet;
use crate::domain::themes;
use crate::domain::validation::read::{parse_data_validations, parse_x14_data_validations};
use crate::domain::workbook::read as workbook;
use crate::domain::workbook::read::parse_calc_settings;
use crate::domain::worksheet::read::{
    parse_col_widths, parse_frozen_pane, parse_merge_cells, parse_sheet_format_pr,
    parse_sheet_views,
};
use crate::infra::error::{ParseContext, ParseMode};
use crate::infra::opc::opc_target_to_zip_path;
#[cfg(all(not(target_arch = "wasm32"), feature = "parallel"))]
use crate::output::results::{
    CommentOutput, ConnectorOutput, FormControlOutput, OleObjectOutput, ParsedTable,
    SmartArtPartsOutput,
};
use crate::output::results::{
    DefinedNameOutput, FullCellData, FullParseError, FullParseResult, FullParsedSheet,
    HyperlinkOutput, ParseStats, ParseTimings, ProtectionOutput, RawVmlDrawing, SparklineSummary,
    StylesOutput,
};
use crate::zip::constants::{
    MAX_CHARTS, MAX_MERGES, MAX_PIVOTS, MAX_SHARED_STRINGS, MAX_STYLES, MAX_TABLES,
    MAX_VALIDATIONS, MAX_WORKSHEET_CELLS,
};
use crate::zip::{XlsxArchive, ZipError};

use super::doc_props::{parse_doc_props_app, parse_doc_props_core, parse_doc_props_custom};
use super::metadata::parse_metadata;

use crate::roundtrip::namespaces::NamespaceMap;
use crate::roundtrip::preservation::ExtensionPreservation;
use crate::roundtrip::unknown_elements::PreservedElements;

mod helpers;
pub(crate) use helpers::extract_attr_value;
use helpers::*;

// =============================================================================
// Main Native Parse Function
// =============================================================================

fn ensure_count_limit(label: &str, count: usize, limit: usize) -> Result<(), String> {
    if count > limit {
        Err(format!(
            "{label} count {count} exceeds XLSX parser safety limit {limit}"
        ))
    } else {
        Ok(())
    }
}

fn ensure_no_archive_safety_error(archive: &XlsxArchive<'_>) -> Result<(), String> {
    if let Some(error) = archive.fatal_safety_error() {
        Err(format!("Fatal XLSX archive safety error: {}", error))
    } else {
        Ok(())
    }
}

fn count_worksheet_cell_elements(xml: &[u8]) -> usize {
    let mut count = 0usize;
    let mut pos = 0usize;
    while let Some(rel) = memchr::memmem::find(&xml[pos..], b"<c") {
        let start = pos + rel;
        let next = start + 2;
        if next >= xml.len() || matches!(xml[next], b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r') {
            count += 1;
        }
        pos = next;
    }
    count
}

/// Parse an XLSX file from raw bytes and return a full structured result.
///
/// This is the core parse pipeline shared between WASM entry points and native
/// CLI tools. It performs all the same steps as the WASM `parse_xlsx_full` but
/// returns a native `Result<FullParseResult, String>` instead of `Result<JsValue, JsValue>`.
///
/// # Profiling (Chrome-style on-demand)
///
/// Pass `Some(&mut ParseTimings::zero())` to enable detailed phase timing.
/// Pass `None` for production — zero overhead, the `profile!()` branches are
/// trivially predicted and optimized away.
///
/// # Arguments
/// * `xlsx_data` - The raw bytes of the XLSX file
/// * `timings` - Optional timing context; when Some, phase durations are recorded
///
/// # Returns
/// * `Ok(FullParseResult)` - The complete parsed workbook
/// * `Err(String)` - An error message if parsing fails fatally
pub fn parse_xlsx_full_native(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
) -> Result<FullParseResult, String> {
    parse_xlsx_full_native_impl(xlsx_data, timings, None)
}

/// Parse XLSX with a limit on full sheet parsing. Sheets beyond `max_sheets`
/// get only metadata (name, dimensions, visibility) with empty cell vectors.
pub fn parse_xlsx_full_native_max_sheets(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
    max_sheets: usize,
) -> Result<FullParseResult, String> {
    parse_xlsx_full_native_impl(xlsx_data, timings, Some(max_sheets))
}

fn parse_xlsx_full_native_impl(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
    max_sheets: Option<usize>,
) -> Result<FullParseResult, String> {
    // Validate input
    if xlsx_data.is_empty() {
        return Err("Empty XLSX data".to_string());
    }

    // Verify ZIP signature
    if xlsx_data.len() < 4 || &xlsx_data[0..4] != b"PK\x03\x04" {
        return Err("Invalid XLSX file: not a valid ZIP archive".to_string());
    }

    // Profiling checkpoints (zero-cost when timings is None)
    let tick = |t: &Option<&mut ParseTimings>| if t.is_some() { crate::now_us() } else { 0.0 };
    let t0 = tick(&timings);

    // Create parse context in lenient mode
    let mut ctx = ParseContext::new(ParseMode::Lenient);

    // Open ZIP archive
    ctx.set_current_part("xlsx archive");
    let archive = match XlsxArchive::new(xlsx_data) {
        Ok(a) => a,
        Err(e) => {
            return Err(format!("Failed to open XLSX archive: {}", e));
        }
    };
    let t1 = tick(&timings);

    // Parse shared strings
    ctx.set_current_part("xl/sharedStrings.xml");
    let shared_strings_xml = match archive.get_shared_strings() {
        Ok(xml) => xml,
        Err(ZipError::FileNotFound(_)) => Vec::new(),
        Err(e) => return Err(format!("Failed to read xl/sharedStrings.xml: {}", e)),
    };
    let t_ss1 = tick(&timings);
    let ss_xml_len = shared_strings_xml.len();
    let mut shared_strings_parser = SharedStrings::parse(shared_strings_xml);
    let t_ss2 = tick(&timings);

    // Build shared strings Vec + rich text runs + phonetic XML
    let string_count = shared_strings_parser.len();
    ensure_count_limit("shared string", string_count, MAX_SHARED_STRINGS)?;
    let mut shared_strings: Vec<String> = Vec::with_capacity(string_count);
    let mut shared_strings_rich_runs: Vec<Option<Vec<domain_types::RichTextRun>>> =
        Vec::with_capacity(string_count);
    let mut shared_strings_phonetic_xml: Vec<Option<Vec<u8>>> = Vec::with_capacity(string_count);
    for i in 0..string_count {
        let bytes = shared_strings_parser.get(i);
        let s = std::str::from_utf8(bytes).map_err(|err| {
            format!(
                "xl/sharedStrings.xml contains malformed UTF-8 in shared string {} at byte {}",
                i,
                err.valid_up_to()
            )
        })?;
        shared_strings.push(s.to_owned());
        shared_strings_rich_runs.push(shared_strings_parser.get_rich_text_runs(i));
        shared_strings_phonetic_xml.push(shared_strings_parser.get_phonetic_xml(i));
    }
    let t2 = tick(&timings);

    // Parse styles
    ctx.set_current_part("xl/styles.xml");
    let styles_xml = match archive.get_styles() {
        Ok(xml) => xml,
        Err(ZipError::FileNotFound(_)) => Vec::new(),
        Err(e) => return Err(format!("Failed to read xl/styles.xml: {}", e)),
    };
    let mut styles = parse_styles(&styles_xml);
    let total_style_records = styles
        .num_fmts
        .len()
        .saturating_add(styles.fonts.len())
        .saturating_add(styles.fills.len())
        .saturating_add(styles.borders.len())
        .saturating_add(styles.cell_style_xfs.len())
        .saturating_add(styles.cell_xfs.len());
    ensure_count_limit("style", total_style_records, MAX_STYLES)?;
    styles.known_fonts = parse_known_fonts(&styles_xml);
    let mut styles_output = StylesOutput::from(&styles);
    styles_output.known_fonts = styles.known_fonts;
    styles_output.raw_fonts = styles.fonts.clone();
    styles_output.raw_cell_xfs = styles.cell_xfs.clone();
    styles_output.raw_cell_style_xfs = styles.cell_style_xfs.clone();
    let t3 = tick(&timings);

    // Parse theme (optional)
    ctx.set_current_part("xl/theme/theme1.xml");
    let (
        theme_name,
        theme_color_scheme,
        theme_font_scheme,
        theme_format_scheme,
        theme_object_defaults_xml,
        theme_extra_clr_scheme_lst_xml,
        theme_ext_lst_xml,
    ) = if let Ok(theme_xml) = archive.read_file("xl/theme/theme1.xml") {
        let theme = themes::Theme::parse(&theme_xml);
        (
            Some(theme.name.clone()),
            Some(theme.color_scheme.clone()),
            Some(theme.font_scheme.clone()),
            Some(theme.format_scheme.clone()),
            theme.object_defaults_xml.clone(),
            theme.extra_clr_scheme_lst_xml.clone(),
            theme.ext_lst_xml.clone(),
        )
    } else {
        (None, None, None, None, None, None, None)
    };
    ensure_no_archive_safety_error(&archive)?;

    // Parse workbook for sheet names and defined names
    ctx.set_current_part("xl/workbook.xml");
    let workbook_xml = archive
        .get_workbook()
        .map_err(|e| format!("Failed to read xl/workbook.xml: {}", e))?;
    let sheet_infos = workbook::parse_workbook(&workbook_xml);

    // Tier 2: Capture workbook namespace declarations and preserved elements
    let workbook_namespaces = capture_namespaces_from_xml(&workbook_xml);
    let workbook_preserved = capture_workbook_preserved_elements(&workbook_xml);

    // Tier 2: Capture styles namespace declarations
    let styles_namespaces = capture_namespaces_from_xml(&styles_xml);

    // Capture styles extLst as opaque XML for round-trip fidelity
    let styles_ext_lst_xml = capture_ext_lst_raw(&styles_xml);

    // Parse ALL relationships for round-trip fidelity
    let root_rels_xml = match archive.read_file("_rels/.rels") {
        Ok(xml) => xml,
        Err(ZipError::FileNotFound(_)) => Vec::new(),
        Err(e) => return Err(format!("Failed to read _rels/.rels: {}", e)),
    };
    let root_relationships = workbook::parse_all_rels(&root_rels_xml);
    let wb_rels_xml = archive
        .read_file("xl/_rels/workbook.xml.rels")
        .map_err(|e| format!("Failed to read xl/_rels/workbook.xml.rels: {}", e))?;
    let workbook_relationships = workbook::parse_all_rels(&wb_rels_xml);

    // Parse defined names
    let defined_names_parser = names::DefinedNames::parse(&workbook_xml);
    let defined_names: Vec<DefinedNameOutput> = defined_names_parser
        .iter()
        .map(|dn| DefinedNameOutput {
            name: dn.name.clone(),
            refers_to: dn.refers_to.clone(),
            local_sheet_id: dn.local_sheet_id,
            hidden: dn.hidden,
            comment: dn.comment.clone(),
            description: dn.description.clone(),
            help: dn.help.clone(),
            status_bar: dn.status_bar.clone(),
            custom_menu: dn.custom_menu.clone(),
            function: dn.function,
            vb_procedure: dn.vb_procedure,
            xlm: dn.xlm,
            publish_to_server: dn.publish_to_server,
            workbook_parameter: dn.workbook_parameter,
            xml_space_preserve: dn.xml_space_preserve,
        })
        .collect();

    // Parse workbook protection (optional) — preserve all 15 fields via From impl
    let workbook_protection: Option<domain_types::WorkbookProtection> =
        protection::WorkbookProtection::parse(&workbook_xml).map(|wp| wp.into());

    // Parse calculation settings (iterative calc support)
    let calc_settings = parse_calc_settings(&workbook_xml);
    let workbook_views = crate::domain::workbook::read::parse_workbook_views(&workbook_xml);
    let workbook_properties =
        crate::domain::workbook::read::parse_workbook_properties(&workbook_xml);
    let file_version = crate::domain::workbook::read::parse_file_version(&workbook_xml);
    let file_sharing = crate::domain::workbook::read::parse_file_sharing(&workbook_xml);
    let web_publishing = crate::domain::workbook::read::parse_web_publishing(&workbook_xml);

    // Parse all pivot cache definitions (workbook-level, needed before per-sheet pivot tables)
    let pivot_caches = parse_all_pivot_caches(&archive);

    // Parse all slicer cache definitions (workbook-level)
    let slicer_caches = parse_all_slicer_caches(&archive);
    ensure_no_archive_safety_error(&archive)?;

    let t4 = tick(&timings);

    // Parse each worksheet
    let sheet_count = archive.worksheet_count();
    // When max_sheets is set, only parse cell data for the first N sheets.
    let parse_cell_count = match max_sheets {
        Some(n) => sheet_count.min(n),
        None => sheet_count,
    };
    let mut total_cells: u32 = 0;

    // Worksheet sub-phase accumulators (zero-cost when timings is None)
    let mut ws_zip_acc: f64 = 0.0;
    let mut ws_parse_acc: f64 = 0.0;
    let mut ws_convert_acc: f64 = 0.0;
    let mut ws_postprocess_acc: f64 = 0.0;
    let mut ws_auxiliary_acc: f64 = 0.0;
    let mut ws_aux_zip_io_acc: f64 = 0.0;
    // Auxiliary sub-parser accumulators
    let mut ws_aux_merge_acc: f64 = 0.0;
    let mut ws_aux_cond_fmt_acc: f64 = 0.0;
    let mut ws_aux_data_val_acc: f64 = 0.0;
    let mut ws_aux_hyperlinks_acc: f64 = 0.0;
    let mut ws_aux_protection_acc: f64 = 0.0;
    let mut ws_aux_print_acc: f64 = 0.0;
    let mut ws_aux_frozen_pane_acc: f64 = 0.0;
    let mut ws_aux_dimensions_acc: f64 = 0.0;
    let mut ws_aux_sparklines_acc: f64 = 0.0;
    // Aux ZIP I/O sub-phase accumulators
    let mut aux_zip_comments_acc: f64 = 0.0;
    let mut aux_zip_tables_acc: f64 = 0.0;
    let mut aux_zip_pivots_acc: f64 = 0.0;
    let mut aux_zip_charts_acc: f64 = 0.0;
    let mut aux_zip_smartart_acc: f64 = 0.0;
    let mut aux_zip_slicers_acc: f64 = 0.0;
    let mut aux_zip_form_controls_acc: f64 = 0.0;
    let mut aux_zip_ole_acc: f64 = 0.0;
    let mut aux_zip_connectors_acc: f64 = 0.0;
    let mut aux_zip_rels_vml_acc: f64 = 0.0;

    // Tier 2: Per-sheet extension data (populated by both parallel and sequential paths)
    let mut sheet_ext_namespaces: Vec<NamespaceMap> = Vec::new();
    let mut sheet_ext_preserved: Vec<PreservedElements> = Vec::new();

    // --- Parallel path: when `parallel` feature is enabled and profiling is off ---
    #[cfg(all(not(target_arch = "wasm32"), feature = "parallel"))]
    let mut sheets: Vec<FullParsedSheet> = if timings.is_none() {
        use rayon::prelude::*;

        // Step 1: Pre-decompress all worksheets + pre-read comments/tables sequentially
        // (archive access is not thread-safe)
        struct PreDecompressed {
            idx: usize,
            name: String,
            xml: Vec<u8>,
            comments: Vec<CommentOutput>,
            comment_authors: Vec<String>,
            comments_root_namespace_attrs: Vec<(String, String)>,
            tables: Vec<ParsedTable>,
            table_xml_passthroughs: Vec<(String, Vec<u8>)>,
            parsed_pivot_configs: Vec<domain_types::domain::pivot::ParsedPivotTable>,
            charts: Vec<domain_types::ChartSpec>,
            smartart_diagrams: Vec<SmartArtPartsOutput>,
            slicers: Vec<ooxml_types::slicers::SlicerDef>,
            slicer_anchors: Vec<ooxml_types::slicers::SlicerAnchor>,
            form_controls: Vec<FormControlOutput>,
            ole_objects: Vec<OleObjectOutput>,
            connectors: Vec<ConnectorOutput>,
            sheet_opc_rels: Vec<ooxml_types::shared::OpcRelationship>,
            raw_vml_drawings: Vec<(String, Vec<u8>, Option<(String, Vec<u8>)>)>,
            parsed_drawing: Option<crate::domain::drawings::types::Drawing>,
            parsed_charts: Vec<crate::domain::charts::Chart>,
            parsed_chart_ex: Vec<crate::output::results::ParsedChartEx>,
        }

        let mut pre_sheets: Vec<PreDecompressed> = Vec::with_capacity(sheet_count);
        for sheet_idx in 0..sheet_count {
            let sheet_num = sheet_idx + 1;
            let sheet_name = sheet_infos
                .get(sheet_idx)
                .map(|si| si.name.clone())
                .unwrap_or_else(|| format!("Sheet{}", sheet_num));

            let worksheet_xml = archive
                .get_worksheet(sheet_num)
                .map_err(|e| format!("Failed to read worksheet {}: {}", sheet_num, e))?;
            ensure_count_limit(
                "worksheet cell",
                count_worksheet_cell_elements(&worksheet_xml),
                MAX_WORKSHEET_CELLS,
            )?;

            let (comments, comment_authors, comments_root_namespace_attrs) =
                parse_comments_for_sheet(&archive, sheet_num);
            let (tables, table_xml_passthroughs) = parse_tables_for_sheet(&archive, sheet_num);
            ensure_count_limit("table", tables.len(), MAX_TABLES)?;
            let parsed_pivot_configs = crate::domain::pivot::read::parse_pivot_tables_for_sheet_v2(
                &archive,
                sheet_num,
                &sheet_name,
                &pivot_caches,
            );
            ensure_count_limit("pivot table", parsed_pivot_configs.len(), MAX_PIVOTS)?;
            let charts = parse_charts_for_sheet(&archive, sheet_num);
            ensure_count_limit("chart", charts.len(), MAX_CHARTS)?;
            let (parsed_drawing, parsed_charts) =
                parse_drawing_and_charts_for_sheet(&archive, sheet_num);
            let parsed_chart_ex =
                crate::domain::charts::read::parse_chart_ex_for_sheet(&archive, sheet_num);
            let smartart_diagrams =
                convert_smartart_parts(parse_smartart_for_sheet(&archive, sheet_num));
            let (slicers, slicer_anchors) = parse_slicers_for_sheet(&archive, sheet_num);
            let form_controls = parse_form_controls_for_sheet(&archive, sheet_num, &worksheet_xml);
            let ole_objects = parse_ole_objects_for_sheet(&archive, sheet_num, &worksheet_xml);
            let connectors = parse_connectors_for_sheet(&archive, sheet_num);

            // Preserve raw sheet-level OPC relationships for round-trip fidelity
            let sheet_opc_rels = {
                let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
                archive
                    .read_file(&rels_path)
                    .map(|xml| workbook::parse_all_rels(&xml))
                    .unwrap_or_default()
            };

            // Read raw VML drawing bytes for verbatim round-trip passthrough.
            // A sheet can have multiple VML drawings (e.g. one for comment shapes,
            // another for embedded images referenced by those comments).
            let raw_vml_drawings: Vec<(String, Vec<u8>, Option<(String, Vec<u8>)>)> =
                sheet_opc_rels
                    .iter()
                    .filter(|r| r.rel_type == crate::infra::opc::REL_VML_DRAWING)
                    .filter_map(|rel| {
                        let zip_path = opc_target_to_zip_path(&rel.target, "xl/worksheets");
                        archive.read_file(&zip_path).ok().map(|bytes| {
                            // Also read the VML .rels file if it exists
                            let vml_rels = {
                                let dir = zip_path.rfind('/').map(|p| &zip_path[..p]).unwrap_or("");
                                let filename = zip_path
                                    .rfind('/')
                                    .map(|p| &zip_path[p + 1..])
                                    .unwrap_or(&zip_path);
                                let rels_path = format!("{}/_rels/{}.rels", dir, filename);
                                archive.read_file(&rels_path).ok().map(|rb| (rels_path, rb))
                            };
                            (zip_path, bytes, vml_rels)
                        })
                    })
                    .collect();

            pre_sheets.push(PreDecompressed {
                idx: sheet_idx,
                name: sheet_name,
                xml: worksheet_xml,
                comments,
                comment_authors,
                comments_root_namespace_attrs,
                tables,
                table_xml_passthroughs,
                parsed_pivot_configs,
                charts,
                smartart_diagrams,
                slicers,
                slicer_anchors,
                form_controls,
                ole_objects,
                connectors,
                sheet_opc_rels,
                raw_vml_drawings,
                parsed_drawing,
                parsed_charts,
                parsed_chart_ex,
            });
        }

        // Step 2: Process all sheets in parallel
        let parsed: Vec<SheetProcessResult> = pre_sheets
            .into_par_iter()
            .map(|ps| {
                let parsed_drawing = ps.parsed_drawing;
                let parsed_charts = ps.parsed_charts;
                let parsed_chart_ex = ps.parsed_chart_ex;
                let mut result = process_sheet_parallel(
                    ps.idx,
                    ps.name,
                    &ps.xml,
                    &shared_strings,
                    ps.comments,
                    ps.comment_authors,
                    ps.comments_root_namespace_attrs,
                    ps.tables,
                    ps.table_xml_passthroughs,
                    ps.charts,
                    ps.smartart_diagrams,
                    ps.slicers,
                    ps.slicer_anchors,
                    ps.form_controls,
                    ps.ole_objects,
                    ps.connectors,
                    ps.sheet_opc_rels,
                    ps.raw_vml_drawings,
                )?;
                result.sheet.parsed_drawing = parsed_drawing;
                result.sheet.parsed_charts = parsed_charts;
                result.sheet.parsed_chart_ex = parsed_chart_ex;
                result.sheet.parsed_pivot_configs = ps.parsed_pivot_configs;
                Ok(result)
            })
            .collect::<Result<Vec<_>, String>>()?;

        // Accumulate total cells
        for r in &parsed {
            total_cells += r.cell_count as u32;
        }

        // Sort by sheet index to maintain order, then decompose
        let mut sorted: Vec<SheetProcessResult> = parsed.into_iter().collect();
        sorted.sort_by_key(|r| r.sheet.index);
        let mut sheets = Vec::with_capacity(sorted.len());
        let mut par_sheet_namespaces = Vec::with_capacity(sorted.len());
        let mut par_sheet_preserved = Vec::with_capacity(sorted.len());
        for r in sorted {
            let mut s = r.sheet;
            s.sheet_id = sheet_infos.get(s.index).map(|si| si.sheet_id);
            s.state = sheet_infos
                .get(s.index)
                .map(|si| si.state)
                .unwrap_or_default();
            sheets.push(s);
            par_sheet_namespaces.push(r.namespaces);
            par_sheet_preserved.push(r.preserved);
        }
        sheet_ext_namespaces = par_sheet_namespaces;
        sheet_ext_preserved = par_sheet_preserved;
        sheets
    } else {
        // Fall through to sequential path when profiling is enabled
        parse_sheets_sequential(
            &archive,
            sheet_count,
            &sheet_infos,
            &shared_strings,
            &pivot_caches,
            &mut ctx,
            &timings,
            &tick,
            &mut total_cells,
            &mut ws_zip_acc,
            &mut ws_parse_acc,
            &mut ws_convert_acc,
            &mut ws_postprocess_acc,
            &mut ws_auxiliary_acc,
            &mut ws_aux_zip_io_acc,
            &mut ws_aux_merge_acc,
            &mut ws_aux_cond_fmt_acc,
            &mut ws_aux_data_val_acc,
            &mut ws_aux_hyperlinks_acc,
            &mut ws_aux_protection_acc,
            &mut ws_aux_print_acc,
            &mut ws_aux_frozen_pane_acc,
            &mut ws_aux_dimensions_acc,
            &mut ws_aux_sparklines_acc,
            &mut aux_zip_comments_acc,
            &mut aux_zip_tables_acc,
            &mut aux_zip_pivots_acc,
            &mut aux_zip_charts_acc,
            &mut aux_zip_smartart_acc,
            &mut aux_zip_slicers_acc,
            &mut aux_zip_form_controls_acc,
            &mut aux_zip_ole_acc,
            &mut aux_zip_connectors_acc,
            &mut aux_zip_rels_vml_acc,
            &mut sheet_ext_namespaces,
            &mut sheet_ext_preserved,
        )?
    };

    // --- Sequential path: default when `parallel` feature is not enabled ---
    #[cfg(not(all(not(target_arch = "wasm32"), feature = "parallel")))]
    let mut sheets: Vec<FullParsedSheet> = parse_sheets_sequential(
        &archive,
        parse_cell_count,
        &sheet_infos,
        &shared_strings,
        &pivot_caches,
        &mut ctx,
        &timings,
        &tick,
        &mut total_cells,
        &mut ws_zip_acc,
        &mut ws_parse_acc,
        &mut ws_convert_acc,
        &mut ws_postprocess_acc,
        &mut ws_auxiliary_acc,
        &mut ws_aux_zip_io_acc,
        &mut ws_aux_merge_acc,
        &mut ws_aux_cond_fmt_acc,
        &mut ws_aux_data_val_acc,
        &mut ws_aux_hyperlinks_acc,
        &mut ws_aux_protection_acc,
        &mut ws_aux_print_acc,
        &mut ws_aux_frozen_pane_acc,
        &mut ws_aux_dimensions_acc,
        &mut ws_aux_sparklines_acc,
        &mut aux_zip_comments_acc,
        &mut aux_zip_tables_acc,
        &mut aux_zip_pivots_acc,
        &mut aux_zip_charts_acc,
        &mut aux_zip_smartart_acc,
        &mut aux_zip_slicers_acc,
        &mut aux_zip_form_controls_acc,
        &mut aux_zip_ole_acc,
        &mut aux_zip_connectors_acc,
        &mut aux_zip_rels_vml_acc,
        &mut sheet_ext_namespaces,
        &mut sheet_ext_preserved,
    )?;

    if ctx.should_stop() {
        let msg = ctx
            .errors()
            .last()
            .map(|e| e.to_string())
            .unwrap_or_else(|| "fatal XLSX parser safety error".to_string());
        return Err(msg);
    }
    ensure_no_archive_safety_error(&archive)?;

    // When max_sheets is active, add metadata-only entries for skipped sheets.
    // Read the worksheet XML header (view settings, frozen panes, dimensions)
    // without parsing cells — this is fast (~1ms per sheet).
    if parse_cell_count < sheet_count {
        for sheet_idx in parse_cell_count..sheet_count {
            let sheet_num = sheet_idx + 1;
            let sheet_info = sheet_infos.get(sheet_idx);
            let sheet_name = sheet_info
                .map(|si| si.name.clone())
                .unwrap_or_else(|| format!("Sheet{}", sheet_num));
            let mut empty_sheet = FullParsedSheet::default();
            empty_sheet.name = sheet_name;
            empty_sheet.index = sheet_idx;
            empty_sheet.sheet_id = sheet_info.map(|si| si.sheet_id);
            empty_sheet.state = sheet_info
                .map(|si| si.state)
                .unwrap_or(crate::domain::workbook::types::SheetState::Visible);

            // Extract view settings from the worksheet XML header (before <sheetData>).
            // This gives us gridlines, frozen panes, zoom, RTL, etc. without cell parsing.
            let metadata_xml = match archive.get_worksheet(sheet_num) {
                Ok(xml) => Some(xml),
                Err(ZipError::FileNotFound(_)) => None,
                Err(e) => return Err(format!("Failed to read worksheet {}: {}", sheet_num, e)),
            };
            if let Some(xml) = metadata_xml {
                let pre_sd = memchr::memmem::find(&xml, b"<sheetData")
                    .map(|p| &xml[..p])
                    .unwrap_or(&xml);
                empty_sheet.view_options = parse_sheet_views(pre_sd)
                    .into_iter()
                    .map(crate::output::results::SheetViewOutput::from)
                    .collect();
                empty_sheet.frozen_pane = parse_frozen_pane(pre_sd);
                let fmt_pr = parse_sheet_format_pr(pre_sd);
                empty_sheet.default_row_height = fmt_pr.default_row_height;
                empty_sheet.default_col_width = fmt_pr.default_col_width;
            }

            sheets.push(empty_sheet);
            sheet_ext_namespaces.push(Default::default());
            sheet_ext_preserved.push(Default::default());
        }
    }

    let t5 = tick(&timings);

    // Collect errors
    let errors: Vec<FullParseError> = ctx.errors().iter().map(|e| e.into()).collect();

    // Parse docProps (optional)
    // Store raw bytes for verbatim round-trip passthrough (avoids element reordering,
    // formatting differences, and loss of uncommon properties like Pages, Words, etc.)
    let raw_doc_props_core_xml: Option<Vec<u8>> = archive.read_file("docProps/core.xml").ok();
    let doc_props_core = raw_doc_props_core_xml
        .as_deref()
        .map(|xml| parse_doc_props_core(xml));
    let raw_doc_props_app_xml: Option<Vec<u8>> = archive.read_file("docProps/app.xml").ok();
    let doc_props_app = raw_doc_props_app_xml
        .as_deref()
        .map(|xml| parse_doc_props_app(xml));
    let raw_doc_props_custom_xml: Option<Vec<u8>> = archive.read_file("docProps/custom.xml").ok();
    let doc_props_custom = raw_doc_props_custom_xml
        .as_deref()
        .map(|xml| parse_doc_props_custom(xml));

    // Parse xl/metadata.xml (optional — used for dynamic array metadata, etc.)
    // Store raw bytes for verbatim round-trip passthrough (avoids namespace rewriting issues)
    let raw_metadata_xml: Option<Vec<u8>> = archive.read_file("xl/metadata.xml").ok();
    let metadata = raw_metadata_xml.as_deref().map(|xml| parse_metadata(xml));

    // Read docMetadata/LabelInfo.xml if present — store raw bytes for verbatim passthrough
    let raw_doc_metadata_label_info: Option<Vec<u8>> =
        archive.read_file("docMetadata/LabelInfo.xml").ok();

    // Parse external links into domain types for proper round-tripping.
    // workbook.xml externalReferences order is authoritative for formula
    // ordinals; part filenames are only package locations.
    let external_links = {
        use crate::domain::external::read::{ExternalLinks, external_book_rid};
        use domain_types::domain::external_link::{ExternalLink, ImportedExternalLinkIdentity};
        let mut links: Vec<ExternalLink> = Vec::new();

        let external_ref_rids = parse_external_reference_rids(&workbook_xml);
        let mut seen_parts = std::collections::HashSet::new();

        for (idx, workbook_rel_id) in external_ref_rids.iter().enumerate() {
            let Some(rel) = workbook_relationships
                .iter()
                .find(|rel| rel.id == *workbook_rel_id)
            else {
                continue;
            };
            if rel.rel_type != crate::write::relationships::REL_EXTERNAL_LINK {
                continue;
            }

            let part_name = rel.target.clone();
            let zip_path = external_link_zip_path(&part_name);
            if let Ok(xml_data) = archive.read_file(&zip_path) {
                let excel_ordinal = idx as u32 + 1;
                if let Some(mut link) =
                    ExternalLinks::parse_external_link(&xml_data, &excel_ordinal.to_string())
                {
                    let rels_path = external_link_rels_path(&zip_path);
                    if let Ok(rels_data) = archive.read_file(&rels_path) {
                        ExternalLinks::resolve_rels(&mut link, &rels_data, &xml_data);
                    }
                    link.imported_identity = Some(ImportedExternalLinkIdentity {
                        excel_ordinal,
                        workbook_rel_id: workbook_rel_id.clone(),
                        part_name: part_name.clone(),
                        external_book_rid: external_book_rid(&xml_data),
                        target: Some(rel.target.clone()),
                        target_mode: rel.target_mode.clone(),
                    });
                    seen_parts.insert(zip_path);
                    links.push(link);
                }
            }
        }

        // Preserve parse visibility for malformed packages that have externalLink
        // parts but omitted workbook externalReferences. These links have no
        // formula ordinal identity and will not be emitted as referenced links.
        let mut orphan_entries: Vec<String> = archive
            .entries()
            .iter()
            .filter(|e| {
                e.name.starts_with("xl/externalLinks/externalLink")
                    && e.name.ends_with(".xml")
                    && !e.name.contains("_rels/")
                    && !seen_parts.contains(&e.name)
            })
            .map(|e| e.name.clone())
            .collect();
        orphan_entries.sort();
        for entry_name in orphan_entries {
            if let Ok(xml_data) = archive.read_file(&entry_name) {
                let link_id = (links.len() + 1).to_string();
                if let Some(mut link) = ExternalLinks::parse_external_link(&xml_data, &link_id) {
                    let rels_path = external_link_rels_path(&entry_name);
                    if let Ok(rels_data) = archive.read_file(&rels_path) {
                        ExternalLinks::resolve_rels(&mut link, &rels_data, &xml_data);
                    }
                    links.push(link);
                }
            }
        }
        links
    };

    // Rewrite external workbook references ([N]SheetName!Ref → SheetName!Ref)
    // in all formula strings where the referenced sheet exists locally.
    let mut sheets = sheets;
    let mut defined_names = defined_names;
    crate::pipeline::external_refs::rewrite_all_external_refs(
        &mut sheets,
        &mut defined_names,
        &external_links,
    );

    // Capture customXml/ parts for verbatim round-trip passthrough
    let mut custom_xml_parts: Vec<(String, Vec<u8>)> = Vec::new();
    for entry in archive.entries() {
        if entry.name.starts_with("customXml/") {
            if let Ok(data) = archive.read_file_verbatim(&entry.name) {
                custom_xml_parts.push((entry.name.clone(), data));
            }
        }
    }

    // Capture xl/persons/person.xml for verbatim round-trip passthrough (modern threaded comments metadata)
    let raw_persons_xml: Option<Vec<u8>> = archive.read_file("xl/persons/person.xml").ok();

    // Capture xl/threadedComments/ parts for verbatim round-trip passthrough
    let mut raw_threaded_comments: Vec<(String, Vec<u8>)> = Vec::new();
    for entry in archive.entries() {
        if entry.name.starts_with("xl/threadedComments/") {
            if let Ok(data) = archive.read_file(&entry.name) {
                raw_threaded_comments.push((entry.name.clone(), data));
            }
        }
    }

    // Collect web extension parts (xl/webextensions/) for round-trip fidelity.
    // These are stored as raw bytes in BinaryPassthrough so they are written back verbatim.
    let web_extension_parts =
        crate::domain::web_extensions::read::parse_web_extensions(&archive).map(|(_, parts)| parts);
    ensure_no_archive_safety_error(&archive)?;

    // Parse [Content_Types].xml to preserve original default and override mappings for round-trip fidelity
    let parsed_content_types = archive
        .get_content_types()
        .ok()
        .and_then(|xml| crate::domain::content_types::read::ContentTypes::parse(&xml).ok());
    let content_type_defaults = parsed_content_types
        .as_ref()
        .map(|ct| {
            ct.ordered_defaults()
                .map(|(ext, mime)| (ext.to_string(), mime.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let content_type_overrides = parsed_content_types
        .as_ref()
        .map(|ct| {
            ct.ordered_overrides()
                .map(|(part, mime)| (part.to_string(), mime.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    ensure_no_archive_safety_error(&archive)?;

    // Build result
    let result = FullParseResult {
        sheets,
        shared_strings,
        shared_strings_rich_runs,
        shared_strings_phonetic_xml,
        styles: styles_output,
        theme: None,
        defined_names,
        workbook_protection,
        errors,
        stats: ParseStats {
            total_cells,
            total_sheets: sheet_count as u32,
            parse_time_us: 0, // Timing is done on JS side
        },
        calc_id: calc_settings.calc_id,
        iterative_calc: calc_settings.iterate,
        max_iterations: calc_settings
            .has_explicit_iterate_count
            .then_some(calc_settings.iterate_count),
        max_change: calc_settings
            .has_explicit_iterate_delta
            .then_some(calc_settings.iterate_delta),
        calc_pr_settings: Some(calc_settings),
        pivot_caches,
        slicer_caches,
        theme_name,
        theme_color_scheme,
        theme_font_scheme,
        theme_format_scheme,
        theme_object_defaults_xml,
        theme_extra_clr_scheme_lst_xml,
        theme_ext_lst_xml,
        styles_ext_lst_xml,
        parsed_stylesheet: Some(styles),
        doc_props_core,
        doc_props_app,
        doc_props_custom,
        raw_doc_props_core_xml,
        raw_doc_props_app_xml,
        raw_doc_props_custom_xml,
        metadata,
        content_type_defaults,
        content_type_overrides,
        root_relationships,
        workbook_relationships,
        sheet_workbook_r_ids: sheet_infos.iter().map(|si| si.r_id.clone()).collect(),
        raw_metadata_xml,
        raw_doc_metadata_label_info,
        external_links,
        custom_xml_parts,
        raw_persons_xml,
        raw_threaded_comments,
        workbook_views,
        workbook_properties,
        file_version,
        file_sharing,
        web_publishing,
        extensions: {
            let mut binary_passthrough =
                crate::roundtrip::binary_passthrough::BinaryPassthrough::new();
            if let Some(parts) = web_extension_parts {
                for (path, data) in parts.parts {
                    binary_passthrough.record(path, data);
                }
            }
            // Capture printer settings, feature property bags, and embedded media
            // for round-trip fidelity. Media files (images) are binary blobs
            // referenced by drawing relationships — the domain model captures the
            // structural references (Drawing → Picture → blip_fill.embed_id),
            // but the binary content must be preserved verbatim.
            for entry in archive.entries() {
                if entry.name.starts_with("xl/printerSettings/")
                    || entry.name.starts_with("xl/featurePropertyBag/")
                    || entry.name.starts_with("xl/media/")
                    || entry.name.starts_with("xl/customProperty")
                    || entry.name.starts_with("xl/vbaProject.bin")
                    || entry.name.starts_with("xl/richData/")
                    || entry.name.starts_with("xl/volatileDependencies.xml")
                    || entry.name.starts_with("xl/connections.xml")
                    || entry.name.starts_with("xl/queryTables/")
                    || entry.name.starts_with("xl/timelineCaches/")
                    || entry.name.starts_with("xl/timelines/")
                    // Pivots and slicers are modeled features. Do not capture
                    // their package parts through generic roundtrip passthrough.
                    // Note: xl/ctrlProps/ is NOT included here because the structured
                    // ControlsWriter in from_parse_output.rs already regenerates ctrlProp files
                    // from parsed FormControl data. Adding them to binary passthrough would
                    // create duplicates.
                    || entry.name.starts_with("docProps/thumbnail.")
                {
                    if let Ok(data) = archive.read_file(&entry.name) {
                        binary_passthrough.record(entry.name.clone(), data);
                    }
                }
            }
            let ext = ExtensionPreservation {
                workbook_namespaces,
                workbook_preserved,
                sheet_namespaces: sheet_ext_namespaces,
                sheet_preserved: sheet_ext_preserved,
                styles_namespaces,
                binary_passthrough,
            };
            if ext.is_empty() { None } else { Some(ext) }
        },
    };

    // Fill profiling data if requested
    if let Some(t) = timings {
        t.zip_index_us = t1 - t0;
        t.shared_strings_us = t2 - t1;
        t.ss_zip_us = t_ss1 - t1;
        t.ss_parse_refs_us = t_ss2 - t_ss1;
        t.ss_materialize_us = t2 - t_ss2;
        t.ss_xml_bytes = ss_xml_len as f64;
        let (plain, entities, rich) = shared_strings_parser.count_categories();
        t.ss_count_total = string_count as f64;
        t.ss_count_plain = plain as f64;
        t.ss_count_entities = entities as f64;
        t.ss_count_rich_text = rich as f64;
        t.styles_us = t3 - t2;
        t.metadata_us = t4 - t3;
        t.worksheet_parse_us = t5 - t4;
        t.total_us = t5 - t0;
        // Worksheet sub-phase breakdown
        t.ws_zip_decompress_us = ws_zip_acc;
        t.ws_cell_parse_us = ws_parse_acc;
        t.ws_cell_convert_us = ws_convert_acc;
        t.ws_postprocess_us = ws_postprocess_acc;
        t.ws_auxiliary_us = ws_auxiliary_acc;
        t.ws_aux_zip_io_us = ws_aux_zip_io_acc;
        t.ws_aux_merge_us = ws_aux_merge_acc;
        t.ws_aux_cond_fmt_us = ws_aux_cond_fmt_acc;
        t.ws_aux_data_val_us = ws_aux_data_val_acc;
        t.ws_aux_hyperlinks_us = ws_aux_hyperlinks_acc;
        t.ws_aux_protection_us = ws_aux_protection_acc;
        t.ws_aux_print_us = ws_aux_print_acc;
        t.ws_aux_frozen_pane_us = ws_aux_frozen_pane_acc;
        t.ws_aux_dimensions_us = ws_aux_dimensions_acc;
        t.ws_aux_sparklines_us = ws_aux_sparklines_acc;
        // Aux ZIP I/O sub-phases
        t.aux_zip_comments_us = aux_zip_comments_acc;
        t.aux_zip_tables_us = aux_zip_tables_acc;
        t.aux_zip_pivots_us = aux_zip_pivots_acc;
        t.aux_zip_charts_us = aux_zip_charts_acc;
        t.aux_zip_smartart_us = aux_zip_smartart_acc;
        t.aux_zip_slicers_us = aux_zip_slicers_acc;
        t.aux_zip_form_controls_us = aux_zip_form_controls_acc;
        t.aux_zip_ole_us = aux_zip_ole_acc;
        t.aux_zip_connectors_us = aux_zip_connectors_acc;
        t.aux_zip_rels_vml_us = aux_zip_rels_vml_acc;
    }

    Ok(result)
}

// =============================================================================
// Per-Sheet Processing Helpers
// =============================================================================

/// Result of processing a single sheet, including Tier 2 extension data.
#[cfg(all(not(target_arch = "wasm32"), feature = "parallel"))]
struct SheetProcessResult {
    sheet: FullParsedSheet,
    cell_count: usize,
    namespaces: NamespaceMap,
    preserved: PreservedElements,
}

/// Process a single sheet's XML into a FullParsedSheet. Used by the parallel path.
#[cfg(all(not(target_arch = "wasm32"), feature = "parallel"))]
fn process_sheet_core(
    sheet_idx: usize,
    sheet_name: String,
    worksheet_xml: &[u8],
    shared_strings: &[String],
    comments_json: Vec<CommentOutput>,
    comment_authors: Vec<String>,
    comments_root_namespace_attrs: Vec<(String, String)>,
    tables: Vec<ParsedTable>,
    table_xml_passthroughs: Vec<(String, Vec<u8>)>,
    charts: Vec<domain_types::ChartSpec>,
    smartart_diagrams: Vec<SmartArtPartsOutput>,
    slicers: Vec<ooxml_types::slicers::SlicerDef>,
    slicer_anchors: Vec<ooxml_types::slicers::SlicerAnchor>,
    form_controls: Vec<FormControlOutput>,
    ole_objects: Vec<OleObjectOutput>,
    connectors: Vec<ConnectorOutput>,
    sheet_opc_rels: Vec<ooxml_types::shared::OpcRelationship>,
    raw_vml_drawings: Vec<(String, Vec<u8>, Option<(String, Vec<u8>)>)>,
) -> Result<SheetProcessResult, String> {
    let shared_string_refs: Vec<&str> = shared_strings.iter().map(|s| s.as_str()).collect();
    // Count actual <c elements via memchr for accurate pre-allocation,
    // avoiding the expensive retry loop when the heuristic underestimates.
    let cell_count_estimate = count_worksheet_cell_elements(worksheet_xml);
    ensure_count_limit("worksheet cell", cell_count_estimate, MAX_WORKSHEET_CELLS)?;
    let mut buffer_size = cell_count_estimate.max(1000);
    let mut cells_buffer: Vec<CellData> = vec![CellData::default(); buffer_size];
    let mut strings_buffer: Vec<u8> = Vec::with_capacity(cell_count_estimate * 20);

    let mut row_heights = Vec::new();
    let mut extras = ParseExtras::default();

    // Parse col widths early so we can build a col-style lookup for the cell parser
    let pre_sd = memchr::memmem::find(worksheet_xml, b"<sheetData")
        .map(|p| &worksheet_xml[..p])
        .unwrap_or(worksheet_xml);
    let col_widths = parse_col_widths(pre_sd);
    let fmt_pr = parse_sheet_format_pr(pre_sd);
    let default_row_height = fmt_pr.default_row_height;
    let default_col_width = fmt_pr.default_col_width;
    let base_col_width = fmt_pr.base_col_width;
    let default_row_descent = fmt_pr.default_row_descent;
    let outline_level_row = fmt_pr.outline_level_row;
    let outline_level_col = fmt_pr.outline_level_col;
    let custom_height = fmt_pr.custom_height;
    let zero_height = fmt_pr.zero_height;

    let sheet_properties = crate::domain::worksheet::read::parse_sheet_properties(pre_sd);
    let outline_properties = sheet_properties
        .as_ref()
        .and_then(|properties| properties.outline_pr.clone());

    let explicit_blank_cells = extract_explicit_blank_cells(worksheet_xml);
    let header_footer_xml = extract_raw_element_xml(worksheet_xml, b"headerFooter");
    let worksheet_controls_xml = extract_worksheet_controls_xml(worksheet_xml);

    // Tier 2: Capture worksheet namespace declarations from the <worksheet> root element
    let sheet_namespaces = capture_namespaces_from_xml(worksheet_xml);

    // Extract xr:uid from the <worksheet> root element (stable sheet identity for co-authoring)
    let uid = {
        use crate::infra::scanner::{extract_quoted_value, find_attr_simd};
        find_attr_simd(pre_sd, b"xr:uid=\"", 0).and_then(|p| {
            let value_start = p + b"xr:uid=\"".len();
            extract_quoted_value(pre_sd, value_start).map(|(s, e)| {
                std::str::from_utf8(&pre_sd[s..e])
                    .expect("worksheet XML attributes were validated as UTF-8")
                    .to_owned()
            })
        })
    };

    // Build col_styles from col_widths so the cell parser can skip empty cells
    // whose style matches the column default. The XLSX writer reconstructs these
    // from col_styles metadata (already preserved in SheetData.col_styles), so
    // individual empty styled cells don't need to survive in the cell list.
    let col_styles: Vec<Option<u32>> = build_col_styles_from_widths(&col_widths);

    let mut cell_count = parse_worksheet_fast_with_extras(
        worksheet_xml,
        &shared_string_refs,
        &mut cells_buffer,
        &mut strings_buffer,
        &mut row_heights,
        &mut extras,
        &col_styles,
    );

    // If the buffer was completely filled, the parser may have truncated cells.
    // Retry with progressively larger buffers until all cells are captured.
    while cell_count == buffer_size {
        buffer_size *= 2;
        cells_buffer = vec![CellData::default(); buffer_size];
        strings_buffer.clear();
        row_heights.clear();
        extras = ParseExtras::default();

        cell_count = parse_worksheet_fast_with_extras(
            worksheet_xml,
            &shared_string_refs,
            &mut cells_buffer,
            &mut strings_buffer,
            &mut row_heights,
            &mut extras,
            &col_styles,
        );
    }

    // CellData → FullCellData conversion (reusable decode buffer avoids per-cell alloc)
    let mut decode_buf = Vec::with_capacity(256);
    let mut cells: Vec<FullCellData> = cells_buffer
        .iter()
        .take(cell_count)
        .map(|c| convert_cell_data(c, &strings_buffer, &mut decode_buf))
        .collect();

    // Apply collected extras (replaces postprocess_worksheet XML rescan)
    apply_parse_extras(
        &mut cells,
        &extras,
        &cells_buffer[..cell_count],
        &strings_buffer,
        shared_strings,
    );

    // Auxiliary XML parsers — scope to post-sheetData region for performance.
    // All auxiliary elements (merges, CF, DV, hyperlinks, protection, print,
    // sparklines) appear AFTER </sheetData>. By scoping the scan, we avoid
    // redundantly scanning the massive sheetData section (~97% of XML bytes).
    // Handle both `</sheetData>` (normal) and `<sheetData/>` (self-closing, empty sheet).
    let post_sd = find_post_sheet_data_region(worksheet_xml);

    // Tier 2: Capture preserved (unknown) child elements from pre and post sheetData regions
    let sheet_preserved = capture_sheet_preserved_elements(worksheet_xml, pre_sd, post_sd);

    let merges = parse_merge_cells(post_sd);
    ensure_count_limit("merge", merges.len(), MAX_MERGES)?;
    let (conditional_formats, conditional_formatting_full) = parse_conditional_formats(post_sd);
    let (data_validations, dv_container_attrs) = parse_data_validations(post_sd);
    ensure_count_limit("data validation", data_validations.len(), MAX_VALIDATIONS)?;
    let data_validations_declared_count = dv_container_attrs.declared_count;
    let data_validations_disable_prompts = dv_container_attrs.disable_prompts;
    let data_validations_x_window = dv_container_attrs.x_window;
    let data_validations_y_window = dv_container_attrs.y_window;
    let (x14_data_validations, x14_dv_container_attrs) = parse_x14_data_validations(post_sd);
    ensure_count_limit(
        "x14 data validation",
        x14_data_validations.len(),
        MAX_VALIDATIONS,
    )?;
    let x14_data_validations_declared_count = x14_dv_container_attrs.declared_count;
    let x14_data_validations_disable_prompts = x14_dv_container_attrs.disable_prompts;
    let x14_data_validations_x_window = x14_dv_container_attrs.x_window;
    let x14_data_validations_y_window = x14_dv_container_attrs.y_window;
    let auto_filter = crate::domain::auto_filter::read::parse_auto_filter(post_sd);
    let sort_state = crate::domain::worksheet::read::parse_standalone_sort_state(post_sd);
    let custom_properties_xml =
        crate::domain::worksheet::read::extract_custom_properties_xml(post_sd);

    // Extract full <extLst>...</extLst> from post-sheetData for round-trip passthrough
    let ext_lst_xml = extract_worksheet_ext_lst_xml(post_sd);

    let hyperlinks_parsed: Vec<HyperlinkOutput> = hyperlinks::Hyperlinks::parse(post_sd)
        .map(|hl| {
            hl.hyperlinks
                .iter()
                .map(|h| HyperlinkOutput {
                    cell_ref: h.cell_ref.clone(),
                    location: h.location.as_deref().unwrap_or("").to_string(),
                    display: h.display.as_deref().unwrap_or("").to_string(),
                    tooltip: h.tooltip.as_deref().unwrap_or("").to_string(),
                    r_id: h.r_id.clone(),
                    uid: h.uid.clone(),
                    target_kind: h.target_kind,
                    target_mode: h.target_mode.clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    let protection_output =
        protection::SheetProtection::parse(post_sd).map(|sp| ProtectionOutput {
            password: sp.password,
            algorithm_name: {
                let alg = sp.algorithm_name.as_str();
                (!alg.is_empty()).then(|| alg.to_string())
            },
            hash_value: sp.hash_value,
            salt_value: sp.salt_value,
            spin_count: sp.spin_count,
            sheet: sp.sheet,
            objects: sp.objects,
            scenarios: sp.scenarios,
            format_cells: sp.format_cells,
            format_columns: sp.format_columns,
            format_rows: sp.format_rows,
            insert_columns: sp.insert_columns,
            insert_rows: sp.insert_rows,
            insert_hyperlinks: sp.insert_hyperlinks,
            delete_columns: sp.delete_columns,
            delete_rows: sp.delete_rows,
            sort: sp.sort,
            auto_filter: sp.auto_filter,
            pivot_tables: sp.pivot_tables,
            select_locked_cells: sp.select_locked_cells,
            select_unlocked_cells: sp.select_unlocked_cells,
        });
    let worksheet_semantic_containers =
        crate::domain::worksheet::read::parse_worksheet_semantic_containers(post_sd);

    let mut ps = print::PrintSettings::parse(post_sd);
    ps.page_setup_properties = sheet_properties
        .as_ref()
        .and_then(|properties| properties.page_set_up_pr.clone());
    let (print_settings, page_breaks) = crate::output::results::build_print_settings_output(&ps);

    // Frozen pane is in pre-sheetData XML. Col widths and row heights
    // were already extracted earlier / by the cell parser.
    let frozen_pane = parse_frozen_pane(pre_sd);
    let view_options: Vec<crate::output::results::SheetViewOutput> = parse_sheet_views(pre_sd)
        .into_iter()
        .map(crate::output::results::SheetViewOutput::from)
        .collect();

    let sparkline_groups = sparklines::parse_sparklines(post_sd);
    let sparklines_output: Vec<SparklineSummary> = sparkline_groups
        .iter()
        .map(|sg| SparklineSummary {
            sparkline_type: match sg.sparkline_type {
                sparklines::SparklineType::Line => "line".to_string(),
                sparklines::SparklineType::Column => "column".to_string(),
                sparklines::SparklineType::WinLoss => "winLoss".to_string(),
            },
            sparklines_count: sg.sparklines.len(),
        })
        .collect();

    let data_tables_info = extras.data_tables.iter().map(data_table_info).collect();

    // Parse legacyDrawing r:id from the post-sheetData region
    let legacy_drawing_r_id = crate::domain::worksheet::read::parse_legacy_drawing_r_id(post_sd);
    let legacy_drawing_hf_r_id =
        crate::domain::worksheet::read::parse_legacy_drawing_hf_r_id(post_sd);

    // Build per-row descent map — preserve ALL original values for roundtrip fidelity.
    // Previously we filtered out values matching default_row_descent, but Excel
    // explicitly writes dyDescent on every row and expects it back.
    let row_descents_map: std::collections::HashMap<u32, f64> =
        extras.row_descents.iter().cloned().collect();

    // Build per-row spans map from parsed extras
    let row_spans_map: std::collections::HashMap<u32, String> =
        extras.row_spans.iter().cloned().collect();
    let authored_style_runs = coalesce_authored_style_only_cells(&extras.authored_style_only_cells);

    let sheet = FullParsedSheet {
        name: sheet_name,
        index: sheet_idx,
        sheet_id: None,            // Set later from SheetInfo at assembly time
        state: Default::default(), // Set later from SheetInfo at assembly time
        cells,
        authored_style_runs,
        explicit_blank_cells,
        merges,
        conditional_formats,
        conditional_formatting_full,
        data_validations,
        data_validations_declared_count,
        data_validations_disable_prompts,
        data_validations_x_window,
        data_validations_y_window,
        x14_data_validations,
        x14_data_validations_declared_count,
        x14_data_validations_disable_prompts,
        x14_data_validations_x_window,
        x14_data_validations_y_window,
        tables,
        table_xml_passthroughs,
        parsed_pivot_configs: Vec::new(), // Set after process_sheet_core by caller
        data_tables: data_tables_info,
        sparklines: sparklines_output,
        sparkline_groups,
        comments: comments_json,
        comment_authors,
        comments_root_namespace_attrs,
        hyperlinks: hyperlinks_parsed,
        protection: protection_output,
        worksheet_semantic_containers,
        print_settings,
        header_footer_xml,
        page_breaks,
        default_row_height,
        default_col_width,
        base_col_width,
        default_row_descent,
        outline_level_row,
        outline_level_col,
        custom_height,
        zero_height,
        uid,
        row_descents: row_descents_map,
        row_spans: row_spans_map,
        bare_empty_rows: extras.bare_empty_rows.clone(),
        col_widths,
        row_heights,
        frozen_pane,
        view_options,
        sheet_properties,
        outline_properties,
        charts,
        smartart_diagrams,
        slicers,
        slicer_anchors,
        form_controls,
        worksheet_controls_xml,
        ole_objects,
        connectors,
        ext_lst_xml,
        sheet_opc_rels,
        auto_filter,
        sort_state,
        custom_properties_xml,
        raw_vml_drawings,
        legacy_drawing_r_id,
        legacy_drawing_hf_r_id,
        parsed_drawing: None,
        parsed_charts: Vec::new(),
        parsed_chart_ex: Vec::new(),
    };

    Ok(SheetProcessResult {
        sheet,
        cell_count,
        namespaces: sheet_namespaces,
        preserved: sheet_preserved,
    })
}

/// Parallel entry point: process a single sheet (called from rayon threads).
#[cfg(all(not(target_arch = "wasm32"), feature = "parallel"))]
fn process_sheet_parallel(
    sheet_idx: usize,
    sheet_name: String,
    worksheet_xml: &[u8],
    shared_strings: &[String],
    comments_json: Vec<CommentOutput>,
    comment_authors: Vec<String>,
    comments_root_namespace_attrs: Vec<(String, String)>,
    tables: Vec<ParsedTable>,
    table_xml_passthroughs: Vec<(String, Vec<u8>)>,
    charts: Vec<domain_types::ChartSpec>,
    smartart_diagrams: Vec<SmartArtPartsOutput>,
    slicers: Vec<ooxml_types::slicers::SlicerDef>,
    slicer_anchors: Vec<ooxml_types::slicers::SlicerAnchor>,
    form_controls: Vec<FormControlOutput>,
    ole_objects: Vec<OleObjectOutput>,
    connectors: Vec<ConnectorOutput>,
    sheet_opc_rels: Vec<ooxml_types::shared::OpcRelationship>,
    raw_vml_drawings: Vec<(String, Vec<u8>, Option<(String, Vec<u8>)>)>,
) -> Result<SheetProcessResult, String> {
    process_sheet_core(
        sheet_idx,
        sheet_name,
        worksheet_xml,
        shared_strings,
        comments_json,
        comment_authors,
        comments_root_namespace_attrs,
        tables,
        table_xml_passthroughs,
        charts,
        smartart_diagrams,
        slicers,
        slicer_anchors,
        form_controls,
        ole_objects,
        connectors,
        sheet_opc_rels,
        raw_vml_drawings,
    )
}

/// Sequential worksheet loop with per-sheet profiling support.
fn parse_sheets_sequential(
    archive: &XlsxArchive,
    sheet_count: usize,
    sheet_infos: &[workbook::SheetInfo],
    shared_strings: &[String],
    pivot_caches: &std::collections::HashMap<u32, crate::domain::pivot::types::ParsedPivotCache>,
    ctx: &mut ParseContext,
    timings: &Option<&mut ParseTimings>,
    tick: &dyn Fn(&Option<&mut ParseTimings>) -> f64,
    total_cells: &mut u32,
    ws_zip_acc: &mut f64,
    ws_parse_acc: &mut f64,
    ws_convert_acc: &mut f64,
    ws_postprocess_acc: &mut f64,
    ws_auxiliary_acc: &mut f64,
    ws_aux_zip_io_acc: &mut f64,
    ws_aux_merge_acc: &mut f64,
    ws_aux_cond_fmt_acc: &mut f64,
    ws_aux_data_val_acc: &mut f64,
    ws_aux_hyperlinks_acc: &mut f64,
    ws_aux_protection_acc: &mut f64,
    ws_aux_print_acc: &mut f64,
    ws_aux_frozen_pane_acc: &mut f64,
    ws_aux_dimensions_acc: &mut f64,
    ws_aux_sparklines_acc: &mut f64,
    // Aux ZIP I/O sub-phase accumulators
    aux_zip_comments_acc: &mut f64,
    aux_zip_tables_acc: &mut f64,
    aux_zip_pivots_acc: &mut f64,
    aux_zip_charts_acc: &mut f64,
    aux_zip_smartart_acc: &mut f64,
    aux_zip_slicers_acc: &mut f64,
    aux_zip_form_controls_acc: &mut f64,
    aux_zip_ole_acc: &mut f64,
    aux_zip_connectors_acc: &mut f64,
    aux_zip_rels_vml_acc: &mut f64,
    // Tier 2: Per-sheet extension data outputs
    ext_namespaces_out: &mut Vec<NamespaceMap>,
    ext_preserved_out: &mut Vec<PreservedElements>,
) -> Result<Vec<FullParsedSheet>, String> {
    let mut sheets: Vec<FullParsedSheet> = Vec::with_capacity(sheet_count);

    for sheet_idx in 0..sheet_count {
        let sheet_num = sheet_idx + 1;
        let sheet_path = format!("xl/worksheets/sheet{}.xml", sheet_num);
        ctx.set_current_part(&sheet_path);

        let sheet_info = sheet_infos.get(sheet_idx);
        let sheet_name = sheet_info
            .map(|si| si.name.clone())
            .unwrap_or_else(|| format!("Sheet{}", sheet_num));
        let _sheet_id = sheet_info.map(|si| si.sheet_id);

        // --- Sub-phase: ZIP decompression ---
        let ws_t0 = tick(timings);
        let worksheet_xml = archive
            .get_worksheet(sheet_num)
            .map_err(|e| format!("Failed to read worksheet {}: {}", sheet_num, e))?;
        ensure_count_limit(
            "worksheet cell",
            count_worksheet_cell_elements(&worksheet_xml),
            MAX_WORKSHEET_CELLS,
        )?;
        let ws_t1 = tick(timings);

        // --- Sub-phase: Core cell parse ---
        let shared_string_refs: Vec<&str> = shared_strings.iter().map(|s| s.as_str()).collect();
        let estimated_cells = worksheet_xml.len() / 50;
        let mut buffer_size = estimated_cells.max(1000);
        let mut cells_buffer: Vec<CellData> = vec![CellData::default(); buffer_size];
        let mut strings_buffer: Vec<u8> = Vec::with_capacity(estimated_cells * 20);

        let mut row_heights = Vec::new();
        let mut extras = ParseExtras::default();

        // Parse col widths early so we can build a col-style lookup for the cell parser
        let pre_sd_early = memchr::memmem::find(&worksheet_xml, b"<sheetData")
            .map(|p| &worksheet_xml[..p])
            .unwrap_or(&worksheet_xml);
        let col_widths = parse_col_widths(pre_sd_early);
        let fmt_pr_seq = parse_sheet_format_pr(pre_sd_early);
        let default_row_height = fmt_pr_seq.default_row_height;
        let default_col_width = fmt_pr_seq.default_col_width;
        let base_col_width = fmt_pr_seq.base_col_width;
        let default_row_descent = fmt_pr_seq.default_row_descent;
        let outline_level_row = fmt_pr_seq.outline_level_row;
        let outline_level_col = fmt_pr_seq.outline_level_col;
        let custom_height = fmt_pr_seq.custom_height;
        let zero_height = fmt_pr_seq.zero_height;

        let sheet_properties = crate::domain::worksheet::read::parse_sheet_properties(pre_sd_early);
        let outline_properties = sheet_properties
            .as_ref()
            .and_then(|properties| properties.outline_pr.clone());

        let explicit_blank_cells = extract_explicit_blank_cells(&worksheet_xml);
        let header_footer_xml = extract_raw_element_xml(&worksheet_xml, b"headerFooter");
        let worksheet_controls_xml = extract_worksheet_controls_xml(&worksheet_xml);

        // Tier 2: Capture worksheet namespace declarations
        let seq_sheet_ns = capture_namespaces_from_xml(&worksheet_xml);

        // Extract xr:uid from the <worksheet> root element (stable sheet identity for co-authoring)
        let uid = {
            use crate::infra::scanner::{extract_quoted_value, find_attr_simd};
            find_attr_simd(pre_sd_early, b"xr:uid=\"", 0).and_then(|p| {
                let value_start = p + b"xr:uid=\"".len();
                extract_quoted_value(pre_sd_early, value_start).map(|(s, e)| {
                    std::str::from_utf8(&pre_sd_early[s..e])
                        .expect("worksheet XML attributes were validated as UTF-8")
                        .to_owned()
                })
            })
        };

        let col_styles: Vec<Option<u32>> = build_col_styles_from_widths(&col_widths);

        let mut cell_count = parse_worksheet_fast_with_extras(
            &worksheet_xml,
            &shared_string_refs,
            &mut cells_buffer,
            &mut strings_buffer,
            &mut row_heights,
            &mut extras,
            &col_styles,
        );

        // If the buffer was completely filled, the parser may have truncated cells.
        // Retry with progressively larger buffers until all cells are captured.
        while cell_count == buffer_size {
            buffer_size *= 2;
            cells_buffer = vec![CellData::default(); buffer_size];
            strings_buffer.clear();
            row_heights.clear();
            extras = ParseExtras::default();

            cell_count = parse_worksheet_fast_with_extras(
                &worksheet_xml,
                &shared_string_refs,
                &mut cells_buffer,
                &mut strings_buffer,
                &mut row_heights,
                &mut extras,
                &col_styles,
            );
        }
        let ws_t2 = tick(timings);

        // --- Sub-phase: CellData → FullCellData conversion ---
        let mut decode_buf = Vec::with_capacity(256);
        let mut cells: Vec<FullCellData> = cells_buffer
            .iter()
            .take(cell_count)
            .map(|c| convert_cell_data(c, &strings_buffer, &mut decode_buf))
            .collect();
        let ws_t3 = tick(timings);

        // --- Sub-phase: Postprocessing (inline from extras, no XML rescan) ---
        apply_parse_extras(
            &mut cells,
            &extras,
            &cells_buffer[..cell_count],
            &strings_buffer,
            shared_strings,
        );
        let ws_t4 = tick(timings);

        *total_cells += cell_count as u32;

        // --- Sub-phase: Auxiliary parsers (with individual timing) ---
        // Optimization: Find </sheetData> boundary and scope post-sheetData
        // parsers to only scan the small region after it (~3% of XML).
        // This avoids redundant scanning through the massive sheetData section.
        // Handle both `</sheetData>` (normal) and `<sheetData/>` (self-closing, empty sheet).
        let post_sd = find_post_sheet_data_region(&worksheet_xml);

        // Extract full <extLst>...</extLst> from post-sheetData for round-trip passthrough
        let _ext_lst_xml = extract_worksheet_ext_lst_xml(post_sd);

        // Tier 2: Capture preserved (unknown) child elements
        let seq_sheet_preserved =
            capture_sheet_preserved_elements(&worksheet_xml, pre_sd_early, post_sd);

        let aux_t0 = tick(timings);
        let merges = parse_merge_cells(post_sd);
        ensure_count_limit("merge", merges.len(), MAX_MERGES)?;
        let aux_t1 = tick(timings);
        let (conditional_formats, conditional_formatting_full) = parse_conditional_formats(post_sd);
        let aux_t2 = tick(timings);
        let (data_validations, dv_container_attrs) = parse_data_validations(post_sd);
        ensure_count_limit("data validation", data_validations.len(), MAX_VALIDATIONS)?;
        let data_validations_declared_count = dv_container_attrs.declared_count;
        let data_validations_disable_prompts = dv_container_attrs.disable_prompts;
        let data_validations_x_window = dv_container_attrs.x_window;
        let data_validations_y_window = dv_container_attrs.y_window;
        let (x14_data_validations, x14_dv_container_attrs) = parse_x14_data_validations(post_sd);
        ensure_count_limit(
            "x14 data validation",
            x14_data_validations.len(),
            MAX_VALIDATIONS,
        )?;
        let x14_data_validations_declared_count = x14_dv_container_attrs.declared_count;
        let x14_data_validations_disable_prompts = x14_dv_container_attrs.disable_prompts;
        let x14_data_validations_x_window = x14_dv_container_attrs.x_window;
        let x14_data_validations_y_window = x14_dv_container_attrs.y_window;
        let auto_filter = crate::domain::auto_filter::read::parse_auto_filter(post_sd);
        let sort_state = crate::domain::worksheet::read::parse_standalone_sort_state(post_sd);
        let custom_properties_xml =
            crate::domain::worksheet::read::extract_custom_properties_xml(post_sd);
        let ext_lst_xml = extract_worksheet_ext_lst_xml(post_sd);
        let aux_t3 = tick(timings);

        let hyperlinks_parsed: Vec<HyperlinkOutput> = hyperlinks::Hyperlinks::parse(post_sd)
            .map(|hl| {
                hl.hyperlinks
                    .iter()
                    .map(|h| HyperlinkOutput {
                        cell_ref: h.cell_ref.clone(),
                        location: h.location.as_deref().unwrap_or("").to_string(),
                        display: h.display.as_deref().unwrap_or("").to_string(),
                        tooltip: h.tooltip.as_deref().unwrap_or("").to_string(),
                        r_id: h.r_id.clone(),
                        uid: h.uid.clone(),
                        target_kind: h.target_kind,
                        target_mode: h.target_mode.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let aux_t4 = tick(timings);

        let protection_output =
            protection::SheetProtection::parse(post_sd).map(|sp| ProtectionOutput {
                password: sp.password,
                algorithm_name: {
                    let alg = sp.algorithm_name.as_str();
                    (!alg.is_empty()).then(|| alg.to_string())
                },
                hash_value: sp.hash_value,
                salt_value: sp.salt_value,
                spin_count: sp.spin_count,
                sheet: sp.sheet,
                objects: sp.objects,
                scenarios: sp.scenarios,
                format_cells: sp.format_cells,
                format_columns: sp.format_columns,
                format_rows: sp.format_rows,
                insert_columns: sp.insert_columns,
                insert_rows: sp.insert_rows,
                insert_hyperlinks: sp.insert_hyperlinks,
                delete_columns: sp.delete_columns,
                delete_rows: sp.delete_rows,
                sort: sp.sort,
                auto_filter: sp.auto_filter,
                pivot_tables: sp.pivot_tables,
                select_locked_cells: sp.select_locked_cells,
                select_unlocked_cells: sp.select_unlocked_cells,
            });
        let aux_t5 = tick(timings);

        let mut ps = print::PrintSettings::parse(post_sd);
        ps.page_setup_properties = sheet_properties
            .as_ref()
            .and_then(|properties| properties.page_set_up_pr.clone());
        let (print_settings, page_breaks) =
            crate::output::results::build_print_settings_output(&ps);
        let aux_t6 = tick(timings);

        // Frozen pane is in pre-sheetData XML. Col widths and row heights
        // were already extracted earlier / by the cell parser.
        let pre_sd = memchr::memmem::find(&worksheet_xml, b"<sheetData")
            .map(|p| &worksheet_xml[..p])
            .unwrap_or(&worksheet_xml);
        let frozen_pane = parse_frozen_pane(pre_sd);
        let aux_t7 = tick(timings);
        let view_options: Vec<crate::output::results::SheetViewOutput> = parse_sheet_views(pre_sd)
            .into_iter()
            .map(crate::output::results::SheetViewOutput::from)
            .collect();
        let aux_t8 = tick(timings);

        let sparkline_groups = sparklines::parse_sparklines(post_sd);
        let sparklines_output: Vec<SparklineSummary> = sparkline_groups
            .iter()
            .map(|sg| SparklineSummary {
                sparkline_type: match sg.sparkline_type {
                    sparklines::SparklineType::Line => "line".to_string(),
                    sparklines::SparklineType::Column => "column".to_string(),
                    sparklines::SparklineType::WinLoss => "winLoss".to_string(),
                },
                sparklines_count: sg.sparklines.len(),
            })
            .collect();
        let aux_t9 = tick(timings);

        let ws_t5a = aux_t9; // reuse for compatibility

        // Parse comments (requires ZIP reads for comment XML files)
        let az_t0 = tick(timings);
        let (comments_output, comment_authors, comments_root_namespace_attrs) =
            parse_comments_for_sheet(archive, sheet_num);

        // Parse tables (requires ZIP reads for table XML files and .rels)
        let az_t1 = tick(timings);
        let (tables, table_xml_passthroughs) = parse_tables_for_sheet(archive, sheet_num);
        ensure_count_limit("table", tables.len(), MAX_TABLES)?;

        // Parse pivot tables (requires ZIP reads for pivot table XML files and .rels)
        let az_t2 = tick(timings);
        let parsed_pivot_configs = crate::domain::pivot::read::parse_pivot_tables_for_sheet_v2(
            archive,
            sheet_num,
            &sheet_name,
            pivot_caches,
        );
        ensure_count_limit("pivot table", parsed_pivot_configs.len(), MAX_PIVOTS)?;

        // Parse charts (requires ZIP reads for drawing, drawing.rels, and chart XML files)
        let az_t3 = tick(timings);
        let charts = parse_charts_for_sheet(archive, sheet_num);
        ensure_count_limit("chart", charts.len(), MAX_CHARTS)?;
        let (parsed_drawing, parsed_charts) =
            parse_drawing_and_charts_for_sheet(archive, sheet_num);
        let parsed_chart_ex =
            crate::domain::charts::read::parse_chart_ex_for_sheet(archive, sheet_num);

        // Parse SmartArt diagrams (requires ZIP reads for drawing, drawing.rels, and diagram XML parts)
        let az_t4 = tick(timings);
        let smartart_diagrams =
            convert_smartart_parts(parse_smartart_for_sheet(archive, sheet_num));

        // Parse slicers (requires ZIP reads for slicer XML files, drawing XML for anchors)
        let az_t5 = tick(timings);
        let (slicers, slicer_anchors) = parse_slicers_for_sheet(archive, sheet_num);

        // Parse form controls (requires ZIP reads for ctrlProp XML files, VML drawings, and .rels)
        let az_t6 = tick(timings);
        let form_controls = parse_form_controls_for_sheet(archive, sheet_num, &worksheet_xml);

        // Parse OLE embedded objects (requires ZIP reads for .rels and VML drawings)
        let az_t7 = tick(timings);
        let ole_objects = parse_ole_objects_for_sheet(archive, sheet_num, &worksheet_xml);

        // Parse connectors (requires ZIP reads for drawing XML)
        let az_t8 = tick(timings);
        let connectors = parse_connectors_for_sheet(archive, sheet_num);

        // Preserve raw sheet-level OPC relationships for round-trip fidelity
        let az_t9 = tick(timings);
        let sheet_opc_rels = {
            let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
            archive
                .read_file(&rels_path)
                .map(|xml| workbook::parse_all_rels(&xml))
                .unwrap_or_default()
        };

        // Read raw VML drawing bytes for verbatim round-trip passthrough.
        // A sheet can have multiple VML drawings (e.g. one for comment shapes,
        // another for embedded images referenced by those comments).
        let raw_vml_drawings: Vec<RawVmlDrawing> = sheet_opc_rels
            .iter()
            .filter(|r| r.rel_type == crate::infra::opc::REL_VML_DRAWING)
            .filter_map(|rel| {
                let zip_path = opc_target_to_zip_path(&rel.target, "xl/worksheets");
                archive.read_file(&zip_path).ok().map(|bytes| {
                    // Also read the VML .rels file if it exists
                    let vml_rels = {
                        let dir = zip_path.rfind('/').map(|p| &zip_path[..p]).unwrap_or("");
                        let filename = zip_path
                            .rfind('/')
                            .map(|p| &zip_path[p + 1..])
                            .unwrap_or(&zip_path);
                        let rels_path = format!("{}/_rels/{}.rels", dir, filename);
                        archive.read_file(&rels_path).ok().map(|rb| (rels_path, rb))
                    };
                    (zip_path, bytes, vml_rels)
                })
            })
            .collect();

        let ws_t5 = tick(timings);

        // Accumulate sub-phase timings
        *ws_zip_acc += ws_t1 - ws_t0;
        *ws_parse_acc += ws_t2 - ws_t1;
        *ws_convert_acc += ws_t3 - ws_t2;
        *ws_postprocess_acc += ws_t4 - ws_t3;
        *ws_auxiliary_acc += ws_t5a - ws_t4;
        *ws_aux_zip_io_acc += ws_t5 - ws_t5a;
        // Accumulate auxiliary sub-parser timings
        *ws_aux_merge_acc += aux_t1 - aux_t0;
        *ws_aux_cond_fmt_acc += aux_t2 - aux_t1;
        *ws_aux_data_val_acc += aux_t3 - aux_t2;
        *ws_aux_hyperlinks_acc += aux_t4 - aux_t3;
        *ws_aux_protection_acc += aux_t5 - aux_t4;
        *ws_aux_print_acc += aux_t6 - aux_t5;
        *ws_aux_frozen_pane_acc += aux_t7 - aux_t6;
        *ws_aux_dimensions_acc += aux_t8 - aux_t7;
        *ws_aux_sparklines_acc += aux_t9 - aux_t8;
        // Accumulate aux ZIP I/O sub-phase timings
        *aux_zip_comments_acc += az_t1 - az_t0;
        *aux_zip_tables_acc += az_t2 - az_t1;
        *aux_zip_pivots_acc += az_t3 - az_t2;
        *aux_zip_charts_acc += az_t4 - az_t3;
        *aux_zip_smartart_acc += az_t5 - az_t4;
        *aux_zip_slicers_acc += az_t6 - az_t5;
        *aux_zip_form_controls_acc += az_t7 - az_t6;
        *aux_zip_ole_acc += az_t8 - az_t7;
        *aux_zip_connectors_acc += az_t9 - az_t8;
        *aux_zip_rels_vml_acc += ws_t5 - az_t9;

        let data_tables_info = extras.data_tables.iter().map(data_table_info).collect();

        // Parse legacyDrawing r:id from the post-sheetData region
        let legacy_drawing_r_id =
            crate::domain::worksheet::read::parse_legacy_drawing_r_id(post_sd);
        let legacy_drawing_hf_r_id =
            crate::domain::worksheet::read::parse_legacy_drawing_hf_r_id(post_sd);

        // Build per-row descent map — preserve ALL original values for roundtrip fidelity
        let row_descents_map: std::collections::HashMap<u32, f64> =
            extras.row_descents.iter().cloned().collect();

        let row_spans_map: std::collections::HashMap<u32, String> =
            extras.row_spans.iter().cloned().collect();
        let authored_style_runs =
            coalesce_authored_style_only_cells(&extras.authored_style_only_cells);

        sheets.push(FullParsedSheet {
            name: sheet_name,
            index: sheet_idx,
            sheet_id: sheet_infos.get(sheet_idx).map(|si| si.sheet_id),
            state: sheet_infos
                .get(sheet_idx)
                .map(|si| si.state)
                .unwrap_or_default(),
            cells,
            authored_style_runs,
            explicit_blank_cells,
            merges,
            conditional_formats,
            conditional_formatting_full,
            data_validations,
            data_validations_declared_count,
            data_validations_disable_prompts,
            data_validations_x_window,
            data_validations_y_window,
            x14_data_validations,
            x14_data_validations_declared_count,
            x14_data_validations_disable_prompts,
            x14_data_validations_x_window,
            x14_data_validations_y_window,
            tables,
            table_xml_passthroughs,
            parsed_pivot_configs,
            data_tables: data_tables_info,
            sparklines: sparklines_output,
            sparkline_groups,
            comments: comments_output,
            comment_authors,
            comments_root_namespace_attrs,
            hyperlinks: hyperlinks_parsed,
            protection: protection_output,
            worksheet_semantic_containers:
                crate::domain::worksheet::read::parse_worksheet_semantic_containers(post_sd),
            print_settings,
            header_footer_xml,
            page_breaks,
            default_row_height,
            default_col_width,
            base_col_width,
            default_row_descent,
            outline_level_row,
            outline_level_col,
            custom_height,
            zero_height,
            uid,
            row_descents: row_descents_map,
            row_spans: row_spans_map,
            bare_empty_rows: extras.bare_empty_rows.clone(),
            col_widths,
            row_heights,
            frozen_pane,
            view_options,
            sheet_properties,
            outline_properties,
            charts,
            smartart_diagrams,
            slicers,
            slicer_anchors,
            form_controls,
            worksheet_controls_xml,
            ole_objects,
            connectors,
            sheet_opc_rels,
            raw_vml_drawings,
            parsed_drawing,
            parsed_charts,
            parsed_chart_ex,
            legacy_drawing_r_id,
            legacy_drawing_hf_r_id,
            auto_filter,
            sort_state,
            custom_properties_xml,
            ext_lst_xml,
        });

        // Tier 2: Store per-sheet extension data
        ext_namespaces_out.push(seq_sheet_ns);
        ext_preserved_out.push(seq_sheet_preserved);
    }

    Ok(sheets)
}
