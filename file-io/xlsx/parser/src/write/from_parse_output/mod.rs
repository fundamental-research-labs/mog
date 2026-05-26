//! Unified XLSX writer that consumes `ParseOutput` from domain-types.
//!
//! When `round_trip_ctx` is `Some`, raw XML blobs are used for round-trip fidelity.
//! When `None`, clean OOXML is generated from the domain types alone.
//!
//! UTF-8 boundary guard: the two `&s[..n]` slices in this file truncate
//! ASCII-only identifier strings (relationship IDs, hyperlink target
//! fragments) at ASCII-delimiter byte offsets. Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

mod pivot_package;
mod sheet_builder;
mod styles;

use domain_types::Hyperlink;
use domain_types::ParseOutput;
use domain_types::RoundTripContext;
// ChartSpec / AnchorPosition are re-exported from domain_types::domain::chart via domain_types::*
// but we don't need them as standalone imports — they're accessed via sheet_data.charts.

use super::write_error::WriteError;
use super::{
    CompressionMethod, SharedStringsWriter, WorkbookWriter, ZipWriter,
    create_root_rels_full_with_custom, create_workbook_rels,
};
use crate::domain::charts::chart_ex_write::serialize_chart_ex_space;
use crate::domain::charts::write_canonical::serialize_chart_space;
use crate::domain::content_types::write::ContentTypesManager;
use crate::domain::drawings::write::{
    CellAnchor, ChartExRef, ChartRef, ClientData, DrawingAnchor, DrawingObject, DrawingWriter,
    Extent, OneCellAnchor, OpaqueGraphicFrame, TwoCellAnchor,
};
use crate::write::pivot_writer;
use crate::write::relationships::{RelationshipManager, create_sheet_rels};
use crate::write::{
    CONTENT_TYPE_CTRL_PROP, ControlsWriter, DefinedNameDef, REL_CHART, REL_CHART_EX, REL_COMMENTS,
    REL_CTRL_PROP, REL_DRAWING, REL_HYPERLINK, REL_PERSON, REL_PIVOT_CACHE, REL_PRINTER_SETTINGS,
    REL_TABLE, REL_THREADED_COMMENT, REL_VML_DRAWING,
};

/// Per-sheet extra data needed for ZIP assembly (comments, tables, rels).
struct SheetExtras {
    /// (comments_xml, vml_xml) if the sheet has comments.
    comments: Option<(Vec<u8>, Vec<u8>)>,
    /// Threaded comment XML (xl/threadedComments/threadedComment{N}.xml) if this sheet
    /// has comments with thread_id set.
    threaded_comments: Option<Vec<u8>>,
    /// Table XML bytes, one per table. Index is local to this sheet.
    tables: Vec<Vec<u8>>,
    /// Table relationship XML bytes for tables that have them (e.g., query tables).
    /// Each entry is `(table_local_index, rels_xml_bytes)`.
    table_rels: Vec<(usize, Vec<u8>)>,
    /// Whether this sheet has external hyperlinks (needs rels).
    has_external_hyperlinks: bool,
    /// Whether this sheet has standard charts that need drawing.
    has_charts: bool,
    /// Whether this sheet has ChartEx (modern) charts that need drawing.
    has_chart_ex: bool,
    /// Whether this sheet has floating objects (images, shapes, etc.) that need drawing.
    has_floating_objects: bool,
    /// Original comment ZIP path from round-trip context (e.g. "xl/comments6.xml").
    /// When set, this path is used instead of sequential numbering.
    original_comment_path: Option<String>,
    /// Original VML drawing ZIP path from round-trip context.
    original_vml_path: Option<String>,
    /// Original drawing ZIP path from round-trip context (e.g. "xl/drawings/drawing1.xml").
    /// When set, this path is used instead of sequential numbering.
    original_drawing_path: Option<String>,
    /// Parsed header/footer image VML data (from legacyDrawingHF).
    /// Stored as domain types — the writer generates VML XML from these.
    hf_vml: Option<crate::domain::print::hf_images::ParsedHfVml>,
    /// Whether this sheet references a printer settings binary (pageSetup r:id).
    has_printer_settings: bool,
    /// Form controls for this sheet (converted from domain types).
    form_controls: Vec<crate::domain::controls::read::FormControl>,
}

/// Per-chart data needed during ZIP assembly. Includes the original ChartSpec
/// reference index so we can retrieve position/size for drawing anchors.
struct ChartEntry {
    /// Global 1-based chart index (for xl/charts/chart{N}.xml path).
    global_idx: usize,
    /// Index into the original `sheet_data.charts` Vec.
    source_idx: usize,
    /// Serialized chart XML bytes.
    xml: Vec<u8>,
}

/// Per-ChartEx data needed during ZIP assembly.
struct ChartExEntry {
    /// Global 1-based chart-ex index (for xl/charts/chartEx{N}.xml path).
    global_idx: usize,
    /// Index into the original `sheet_data.charts` Vec.
    source_idx: usize,
    /// Serialized ChartEx XML bytes.
    xml: Vec<u8>,
}

fn should_reconstruct_chart_space(chart_spec: &domain_types::ChartSpec) -> bool {
    if chart_spec.preserved_chart_xml.is_some() {
        return false;
    }

    if matches!(
        chart_spec.definition,
        Some(domain_types::ChartDefinition::Chart(_))
    ) {
        return false;
    }

    chart_spec.rt.is_some()
        || !chart_spec.series.is_empty()
        || chart_spec
            .data_range
            .as_deref()
            .is_some_and(|r| !r.is_empty())
        || chart_spec.axes.is_some()
        || chart_spec.legend.is_some()
        || chart_spec.data_labels.is_some()
        || chart_spec.data_table.is_some()
}

/// Write an XLSX file from a `ParseOutput`.
///
/// When `round_trip_ctx` is `Some`, raw XML blobs are used for round-trip fidelity.
/// When `None`, clean OOXML is generated from the domain types alone.
pub fn write_xlsx_from_parse_output(
    output: &ParseOutput,
    round_trip_ctx: Option<&RoundTripContext>,
) -> Result<Vec<u8>, WriteError> {
    // ── 1. Build styles ─────────────────────────────────────────────────
    // Prefer the full parsed Stylesheet from RoundTripContext (lossless: preserves
    // theme/indexed colors, cellStyleXfs, dxfs, table styles, named styles, etc.).
    // Fall back to the lossy DocumentFormat reconstruction when no stylesheet is available
    // (e.g., new files created from scratch or after Yrs round-trip without stylesheet storage).
    // Track whether we use the lossless stylesheet path. When true, cellXfs
    // are passed through directly and cell style_id values should NOT be offset
    // by +1. When false (lossy palette path), a default is inserted at cellXfs[0]
    // so cell style_id values must be offset by +1.
    let has_lossless_stylesheet = round_trip_ctx
        .and_then(|ctx| ctx.parsed_stylesheet.as_ref())
        .is_some();

    let styles_writer = if let Some(ctx) = round_trip_ctx {
        if let Some(ref stylesheet) = ctx.parsed_stylesheet {
            let mut writer = build_styles_from_stylesheet(
                stylesheet,
                ctx.styles_ext_lst_xml.as_deref(),
                &ctx.styles_namespace_attrs,
            );
            // When formats are mutated via the API on XLSX-imported cells,
            // their xlsxStyleId is cleared and the export adds new entries
            // to style_palette. Append these as new cellXfs entries after
            // the original stylesheet entries.
            if !output.style_palette.is_empty() {
                append_palette_to_lossless_styles(&mut writer, &output.style_palette);
            }
            writer
        } else {
            build_styles(&output.style_palette)
        }
    } else {
        build_styles(&output.style_palette)
    };

    // ── 2. Build sheets ─────────────────────────────────────────────────
    // When round-tripping with a raw SST passthrough, seed the SharedStringsWriter
    // with the original string→index mapping so that cell <v> indices match the
    // preserved SST XML ordering.
    let mut shared_strings = if let Some(ctx) = round_trip_ctx {
        if ctx.raw_shared_strings_xml.is_some() && !ctx.shared_strings_list.is_empty() {
            let mut sst = SharedStringsWriter::with_capacity(ctx.shared_strings_list.len());
            let has_rich = !ctx.shared_strings_rich_runs.is_empty();
            let has_phonetic = !ctx.shared_strings_phonetic_xml.is_empty();
            for (i, s) in ctx.shared_strings_list.iter().enumerate() {
                // Use rich text runs when available for this entry
                let idx = if has_rich {
                    if let Some(Some(runs)) = ctx.shared_strings_rich_runs.get(i) {
                        sst.seed_rich(runs.clone())
                    } else {
                        sst.seed(s)
                    }
                } else {
                    sst.seed(s)
                };
                // Attach phonetic XML if present for this entry
                if has_phonetic {
                    if let Some(Some(phonetic)) = ctx.shared_strings_phonetic_xml.get(i) {
                        sst.set_phonetic_xml(idx, phonetic.clone());
                    }
                }
            }
            // Preserve the original SST count attribute for round-trip fidelity
            if let Some(count) = ctx.original_sst_count {
                sst.set_original_sst_count(count);
            }
            sst
        } else {
            SharedStringsWriter::new()
        }
    } else {
        SharedStringsWriter::new()
    };
    let mut sheet_writers = Vec::with_capacity(output.sheets.len());
    let mut sheet_extras = Vec::with_capacity(output.sheets.len());

    // Global table counter for archive paths (xl/tables/table{N}.xml).
    let mut global_table_idx: u32 = 0;

    // Global chart counter for archive paths (xl/charts/chart{N}.xml).
    let mut global_chart_idx: usize = 0;

    // Per-sheet chart entries: Vec<Vec<ChartEntry>> (outer = sheet, inner = charts in that sheet).
    let mut all_chart_entries: Vec<Vec<ChartEntry>> = Vec::with_capacity(output.sheets.len());

    // Global ChartEx counter for archive paths (xl/charts/chartEx{N}.xml).
    let mut global_chart_ex_idx: usize = 0;

    // Per-sheet ChartEx entries: Vec<Vec<ChartExEntry>>.
    let mut all_chart_ex_entries: Vec<Vec<ChartExEntry>> = Vec::with_capacity(output.sheets.len());

    // Collected image blobs from floating objects: (zip_path, bytes).
    let mut all_image_blobs: Vec<(String, Vec<u8>)> = Vec::new();

    for (sheet_idx, sheet_data) in output.sheets.iter().enumerate() {
        let sheet_num = sheet_idx + 1;

        // Determine how many external hyperlinks this sheet has (need r:id refs).
        let external_hyperlinks: Vec<&Hyperlink> = sheet_data
            .hyperlinks
            .iter()
            .filter(|h| h.target.is_some())
            .collect();
        let has_external_hyperlinks = !external_hyperlinks.is_empty();

        // Collect Data Table body-cell positions for this sheet. Body cells
        // carry a synthesized formula in the data model but the OOXML writer
        // must emit `<v>`-only for them (only the master cell carries
        // `<f t="dataTable">`). See `sheet_builder::build_sheet` for the
        // sanitization detail.
        let data_table_body_positions: std::collections::HashSet<(u32, u32)> = output
            .data_table_regions
            .iter()
            .filter(|r| r.sheet_index as usize == sheet_idx)
            .flat_map(|r| {
                let (start_row, start_col) = (r.start_row, r.start_col);
                let (end_row, end_col) = (r.end_row, r.end_col);
                (start_row..=end_row).flat_map(move |row| {
                    (start_col..=end_col).filter_map(move |col| {
                        // Master is (start_row, start_col) — exclude it; only
                        // body cells need formula suppression.
                        if row == start_row && col == start_col {
                            None
                        } else {
                            Some((row, col))
                        }
                    })
                })
            })
            .collect();
        let sheet_data_table_regions: Vec<_> = output
            .data_table_regions
            .iter()
            .filter(|r| r.sheet_index as usize == sheet_idx)
            .cloned()
            .collect();

        // Build the base SheetWriter (cells, merges, views, etc.)
        let sheet_rt = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx));
        let mut sheet_writer = build_sheet(
            sheet_data,
            &mut shared_strings,
            has_lossless_stylesheet,
            sheet_rt,
            &data_table_body_positions,
            &sheet_data_table_regions,
        );

        // Preserve whether <mergeCells> had a count attribute
        if let Some(srt) = sheet_rt {
            sheet_writer.set_merge_cells_emit_count(srt.merge_cells_has_count);
        }

        // ── Sheet UID (xr:uid on <worksheet> root) ───────────────────
        if let Some(ref uid) = sheet_data.uid {
            sheet_writer.set_uid(uid.clone());
        }

        // ── Preserved Namespaces + Dimension (round-trip) ──────────────
        if let Some(ctx) = round_trip_ctx {
            if let Some(sheet_rt) = ctx.sheets.get(sheet_idx) {
                if !sheet_rt.preserved_namespace_attrs.is_empty() {
                    let mut ns_map = crate::roundtrip::namespaces::NamespaceMap::new();
                    for (prefix, uri) in &sheet_rt.preserved_namespace_attrs {
                        if prefix.is_empty() {
                            ns_map.set_default(uri.as_str());
                        } else {
                            ns_map.add_prefixed(prefix.as_str(), uri.as_str());
                        }
                    }
                    sheet_writer.set_preserved_namespaces(ns_map);
                }
                // Preserve original <dimension ref="..."/> for round-trip fidelity
                if let Some(ref dim) = sheet_rt.original_dimension {
                    sheet_writer.set_dimension_ref(dim.clone());
                }
                // Preserve original row spans attributes for round-trip fidelity
                for (row, spans) in &sheet_rt.row_spans {
                    sheet_writer.set_row_spans(*row, spans.clone());
                }
                // Preserve thickBot/thickTop row attributes for round-trip fidelity
                for &row in &sheet_rt.row_thick_bot {
                    sheet_writer.set_row_thick_bot(row, true);
                }
                for &row in &sheet_rt.row_thick_top {
                    sheet_writer.set_row_thick_top(row, true);
                }
                // Preserve collapsed row attributes for round-trip fidelity
                for (&row, &collapsed) in &sheet_rt.row_collapsed {
                    sheet_writer.set_row_collapsed(row, collapsed);
                }
                // Preserve explicit hidden="0" for round-trip fidelity
                for &row in &sheet_rt.row_hidden_explicit_false {
                    sheet_writer.set_row_hidden(row, false);
                }
                // Preserve explicit outlineLevel="0" for round-trip fidelity
                for &row in &sheet_rt.row_outline_level_zero {
                    sheet_writer.set_row_outline_level(row, 0);
                }
                // Preserve bare empty rows (rows with no cells but with formatting)
                for &row in &sheet_rt.bare_empty_rows {
                    sheet_writer.mark_bare_empty_row(row);
                }
                // Preserve unknown XML elements (e.g., <sheetPr> with <tabColor>).
                // When sparklines exist in domain data, filter out extLst from preserved
                // elements to avoid duplicating the extLst (sparklines are written fresh
                // via set_ext_lst_xml, so preserved extLst would be redundant).
                if !sheet_rt.sheet_preserved_elements.is_empty() {
                    let pairs: Vec<_> = if !sheet_data.sparklines.is_empty() {
                        sheet_rt
                            .sheet_preserved_elements
                            .iter()
                            .filter(|(_, xml)| !xml.contains("<extLst"))
                            .cloned()
                            .collect()
                    } else {
                        sheet_rt.sheet_preserved_elements.clone()
                    };
                    if !pairs.is_empty() {
                        let preserved = crate::roundtrip::unknown_elements::PreservedElements::from_position_pairs(&pairs);
                        sheet_writer.set_preserved_elements(preserved);
                    }
                }
            }
        }

        // ── Hyperlinks ──────────────────────────────────────────────────
        // Hyperlink r:ids are assigned during rels generation below.
        // Both external and internal hyperlinks get relationship entries
        // (Excel stores internal links as rels with Target="#Sheet!Cell").

        // ── Data Validations ────────────────────────────────────────────
        // Typed OOXML preservation: worksheet-level data validations now reconstruct
        // from typed `SheetData.data_validations` + container-attr fields
        // (`data_validations_declared_count`,
        // `data_validations_disable_prompts`, `data_validations_x_window`,
        // `data_validations_y_window`). The former raw-XML sidecar on
        // `SheetRoundTripContext.data_validations_xml` has been removed.
        if !sheet_data.data_validations.is_empty() {
            let xml = crate::domain::validation::write::validations_xml_from_domain_with_opts(
                &sheet_data.data_validations,
                sheet_data.data_validations_disable_prompts,
                sheet_data.data_validations_x_window,
                sheet_data.data_validations_y_window,
                sheet_data.data_validations_declared_count,
            );
            sheet_writer.set_data_validations_xml(xml);
        }

        // ── Conditional Formats ─────────────────────────────────────────
        if !sheet_data.conditional_formats.is_empty() {
            let xml = crate::domain::cond_format::write::cf_xml_from_domain(
                &sheet_data.conditional_formats,
            );
            sheet_writer.set_conditional_formatting_xml(xml);
        }

        // ── Print Settings ──────────────────────────────────────────────
        if let Some(ref ps) = sheet_data.print_settings {
            let pw = crate::domain::print::write::print_writer_from_domain(ps);
            sheet_writer.set_print_writer(pw);
        }

        // ── Sheet Protection ────────────────────────────────────────────
        if let Some(ref prot) = sheet_data.protection {
            if prot.is_protected {
                let xml = crate::domain::protection::write::sheet_protection_xml_from_domain(prot);
                sheet_writer.set_sheet_protection_xml(xml);
            }
        }

        // ── Page Breaks ──────────────────────────────────────────────────
        if let Some(ref pb) = sheet_data.page_breaks {
            if !pb.row_breaks.is_empty() || !pb.col_breaks.is_empty() {
                // Page breaks are written by PrintWriter as rowBreaks/colBreaks.
                // Ensure a PrintWriter exists and add breaks to it.
                let pw = sheet_writer.ensure_print_writer();
                for brk in &pb.row_breaks {
                    pw.add_row_break_full(brk.id, brk.min, brk.max, brk.manual, brk.pt);
                }
                for brk in &pb.col_breaks {
                    pw.add_col_break_full(brk.id, brk.min, brk.max, brk.manual, brk.pt);
                }
            }
        }

        // ── Outline Groups (rows only) ─────────────────────────────────
        // Column outline levels are handled during column coalescing in build_sheet.
        if !sheet_data.outline_groups.is_empty() {
            apply_outline_groups_rows_only(&mut sheet_writer, &sheet_data.outline_groups);
        }
        // Re-apply explicit hidden="0" AFTER outline groups, because
        // apply_outline_groups_rows_only may override hidden=true for grouped rows
        // that were actually visible in the original (e.g., partially expanded groups).
        if let Some(sheet_rt) = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx)) {
            for &row in &sheet_rt.row_hidden_explicit_false {
                sheet_writer.set_row_hidden(row, false);
            }
        }
        // ── Auto Filter ─────────────────────────────────────────────────
        // Typed OOXML preservation: auto filter now reconstructs from the typed
        // `SheetData.auto_filter` only. The former raw-XML sidecar
        // fallback on `SheetRoundTripContext.auto_filter_xml` is gone — the
        // domain type is lossless over CT_AutoFilter.
        if let Some(ref af) = sheet_data.auto_filter {
            let xml = crate::domain::auto_filter::write::write_auto_filter_xml(af);
            sheet_writer.set_auto_filter_xml(xml);
        }

        // ── Sort State ──────────────────────────────────────────────────
        // Typed OOXML preservation: worksheet-level sort state now reconstructs from
        // the typed `SheetData.sort_state`. The former raw-XML sidecar on
        // `SheetRoundTripContext.sort_state_xml` was silently dropping sort
        // state on the Yrs-hydration path whenever the blob was absent.
        if let Some(ref ss) = sheet_data.sort_state {
            let xml = crate::domain::auto_filter::write::write_sort_state_xml(ss);
            sheet_writer.set_sort_state_xml(xml);
        }

        // ── Sparklines / extLst ──────────────────────────────────────────
        let sheet_rt_for_ext = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx));
        if !sheet_data.sparklines.is_empty() {
            if let Some(ext_xml) =
                sheet_rt_for_ext.and_then(|sheet_rt| sheet_rt.ext_lst_xml.as_ref())
            {
                sheet_writer.set_ext_lst_xml(ext_xml.clone());
            } else {
                let xml = crate::domain::sparklines::write::sparklines_xml_from_domain(
                    &sheet_data.name,
                    &sheet_data.sparklines,
                );
                sheet_writer.set_ext_lst_xml(xml);
            }
        } else {
            let preserved_has_ext_lst = sheet_rt_for_ext
                .map(|sheet_rt| {
                    !sheet_rt.sheet_preserved_elements.is_empty()
                        && sheet_rt
                            .sheet_preserved_elements
                            .iter()
                            .any(|(_, xml)| xml.contains("<extLst"))
                })
                .unwrap_or(false);
            if !preserved_has_ext_lst {
                if let Some(ext_xml) =
                    sheet_rt_for_ext.and_then(|sheet_rt| sheet_rt.ext_lst_xml.as_ref())
                {
                    sheet_writer.set_ext_lst_xml(ext_xml.clone());
                } else if sheet_rt_for_ext
                    .map(|sheet_rt| sheet_rt.has_empty_ext_lst)
                    .unwrap_or(false)
                {
                    sheet_writer.set_ext_lst_xml("<extLst/>".to_string());
                }
            }
        }

        // ── Comments ────────────────────────────────────────────────────
        let comments_data = if !sheet_data.comments.is_empty() {
            let sheet_rt = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx));
            let original_authors = sheet_rt
                .map(|rt| rt.comment_authors.as_slice())
                .filter(|a| !a.is_empty());
            let root_ns_attrs = sheet_rt
                .map(|rt| rt.comments_root_namespace_attrs.as_slice())
                .filter(|a| !a.is_empty());
            let (comments_xml, generated_vml_xml) =
                crate::domain::comments::write::comments_from_domain(
                    sheet_num,
                    &sheet_data.comments,
                    original_authors,
                    root_ns_attrs,
                );
            // Prefer raw VML bytes from RoundTripContext for lossless round-tripping
            // (preserves original shape IDs, colors, dimensions, etc.).
            let vml_xml = round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .and_then(|sheet_rt| sheet_rt.raw_vml_drawings.first())
                .map(|vml_part| vml_part.data.clone())
                .unwrap_or(generated_vml_xml);
            Some((comments_xml, vml_xml))
        } else {
            None
        };

        // ── Threaded Comments ────────────────────────────────────────────
        let threaded_comments =
            crate::domain::comments::write::threaded_comments_xml_from_domain(&sheet_data.comments);

        // ── Tables (per-sheet) ───────────────────────────────────────────
        let mut table_xmls = Vec::new();
        let tables_before_this_sheet = global_table_idx;
        for table_spec in &sheet_data.tables {
            global_table_idx += 1;
            // Prefer the original table ID from the parsed file; fall back to
            // sequential counter for tables created from scratch.
            let table_id = if table_spec.id > 0 {
                table_spec.id
            } else {
                global_table_idx
            };
            table_xmls.push(
                crate::domain::tables::write::table_writer_from_domain(table_id, table_spec)
                    .to_xml(),
            );
        }

        // ── Table Rels (from round-trip context) ─────────────────────────
        // Table _rels files (e.g., xl/tables/_rels/table1.xml.rels) link tables
        // to external data sources like query tables. Preserved verbatim.
        let mut table_rels_data: Vec<(usize, Vec<u8>)> = Vec::new();
        if let Some(sheet_rt) = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx)) {
            for blob in &sheet_rt.table_xml_passthroughs {
                if blob.path.contains("/_rels/") && blob.path.ends_with(".rels") {
                    if let Some(table_num) = extract_table_number_from_rels_path(&blob.path) {
                        if table_num > tables_before_this_sheet && table_num <= global_table_idx {
                            let local_idx = (table_num - tables_before_this_sheet - 1) as usize;
                            table_rels_data.push((local_idx, blob.data.clone()));
                        }
                    }
                }
            }
        }

        // ── Charts (per-sheet) ──────────────────────────────────────────
        // We zip chart_specs with chart_entries later, so only increment the
        // global counter AFTER successful deserialization to keep them aligned.
        let mut chart_entries_for_sheet: Vec<ChartEntry> = Vec::new();
        let sheet_rt_for_charts = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx));
        let mut chart_local_idx: usize = 0;
        for (source_idx, chart_spec) in sheet_data.charts.iter().enumerate() {
            if chart_spec.is_chart_ex {
                continue; // handled by ChartEx pipeline below
            }
            // Reconstruct API-created charts from typed fields. Imported charts can
            // use their preserved XML directly to avoid deep ChartSpace JSON
            // rehydration during L2 export.
            let chart_xml = if let Some(raw_xml) = &chart_spec.preserved_chart_xml {
                raw_xml.as_bytes().to_vec()
            } else if should_reconstruct_chart_space(chart_spec) {
                let chart_space =
                    crate::domain::charts::reconstruct::reconstruct_chart_space(chart_spec);
                serialize_chart_space(&chart_space)
            } else {
                // Legacy: read from definition blob
                match &chart_spec.definition {
                    Some(domain_types::ChartDefinition::Chart(cs)) => serialize_chart_space(cs),
                    _ => continue, // not a standard chart
                }
            };
            // Preserve original chart number from round-trip context when available.
            // E.g., if original was "xl/charts/chart2.xml", extract 2 instead of using
            // the sequential counter (which would produce chart1.xml).
            let original_idx = sheet_rt_for_charts
                .and_then(|srt| srt.chart_auxiliary_data.get(chart_local_idx))
                .and_then(|aux| aux.original_path.as_ref())
                .and_then(|path| {
                    // Extract number from "xl/charts/chart{N}.xml"
                    let fname = path.rsplit('/').next()?;
                    let num_str = fname.strip_prefix("chart")?.strip_suffix(".xml")?;
                    num_str.parse::<usize>().ok()
                });
            let idx = if let Some(orig) = original_idx {
                // Track the highest index we've used so sequential fallback
                // doesn't collide with preserved original numbers.
                if orig > global_chart_idx {
                    global_chart_idx = orig;
                }
                orig
            } else {
                global_chart_idx += 1;
                global_chart_idx
            };
            chart_entries_for_sheet.push(ChartEntry {
                global_idx: idx,
                source_idx,
                xml: chart_xml,
            });
            chart_local_idx += 1;
        }
        let has_charts = !chart_entries_for_sheet.is_empty();
        all_chart_entries.push(chart_entries_for_sheet);

        // ── ChartEx (per-sheet) ─────────────────────────────────────────
        let mut chart_ex_entries_for_sheet: Vec<ChartExEntry> = Vec::new();
        let mut chart_ex_local_idx: usize = 0;
        for (source_idx, chart_spec) in sheet_data.charts.iter().enumerate() {
            if !chart_spec.is_chart_ex {
                continue;
            }
            // ChartDefinition directly wraps ChartExSpace — no deserialization needed.
            let chart_ex_space: &ooxml_types::chart_ex::ChartExSpace = match &chart_spec.definition
            {
                Some(domain_types::ChartDefinition::ChartEx(cs)) => cs,
                _ => continue, // not a chartEx
            };
            // Preserve original chartEx number from round-trip context when available.
            let original_idx = sheet_rt_for_charts
                .and_then(|srt| srt.chart_ex_auxiliary_data.get(chart_ex_local_idx))
                .and_then(|aux| aux.original_path.as_ref())
                .and_then(|path| {
                    let fname = path.rsplit('/').next()?;
                    let num_str = fname.strip_prefix("chartEx")?.strip_suffix(".xml")?;
                    num_str.parse::<usize>().ok()
                });
            let idx = if let Some(orig) = original_idx {
                if orig > global_chart_ex_idx {
                    global_chart_ex_idx = orig;
                }
                orig
            } else {
                global_chart_ex_idx += 1;
                global_chart_ex_idx
            };
            let chart_ex_xml = serialize_chart_ex_space(chart_ex_space);
            chart_ex_entries_for_sheet.push(ChartExEntry {
                global_idx: idx,
                source_idx,
                xml: chart_ex_xml,
            });
            chart_ex_local_idx += 1;
        }
        let has_chart_ex = !chart_ex_entries_for_sheet.is_empty();
        all_chart_ex_entries.push(chart_ex_entries_for_sheet);

        // Check for floating objects (images, shapes, etc.)
        let has_floating_objects = !sheet_data.floating_objects.is_empty();

        // Extract original comment/VML/drawing paths from round-trip context for ZIP assembly
        let (original_comment_path, original_vml_path, hf_vml, original_drawing_path) =
            round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .map(|sheet_rt| {
                    let mut cp: Option<String> = None;
                    let mut dp: Option<String> = None;
                    // Identify the comment VML path by matching legacyDrawing r:id
                    let comment_vml_path: Option<String> =
                        sheet_rt.legacy_drawing_r_id.as_ref().and_then(|rid| {
                            sheet_rt
                                .sheet_opc_rels
                                .iter()
                                .find(|r| &r.id == rid && r.rel_type.ends_with("/vmlDrawing"))
                                .map(|r| opc_target_to_zip_path(&r.target, "xl/worksheets"))
                        });
                    for rel in &sheet_rt.sheet_opc_rels {
                        if rel.rel_type.ends_with("/comments") {
                            cp = Some(opc_target_to_zip_path(&rel.target, "xl/worksheets"));
                        } else if rel.rel_type.ends_with("/drawing") {
                            dp = Some(opc_target_to_zip_path(&rel.target, "xl/worksheets"));
                        }
                    }
                    // Parse extra VML drawings (header/footer images) into domain types
                    let mut hf_vml_parsed: Option<crate::domain::print::hf_images::ParsedHfVml> =
                        None;
                    for vml_part in &sheet_rt.raw_vml_drawings {
                        if comment_vml_path.as_ref() == Some(&vml_part.path) {
                            continue;
                        }
                        let rels_path = vml_part.rels.as_ref().map(|r| r.path.as_str());
                        let rels_data = vml_part.rels.as_ref().map(|r| r.data.as_slice());
                        if let Some(parsed) = crate::domain::print::hf_images::parse_hf_vml_context(
                            &vml_part.path,
                            &vml_part.data,
                            rels_path,
                            rels_data,
                        ) {
                            hf_vml_parsed = Some(parsed);
                            break; // Only one HF VML per sheet
                        }
                    }
                    (
                        cp,
                        comment_vml_path,
                        hf_vml_parsed,
                        sheet_rt.original_drawing_path.clone().or(dp),
                    )
                })
                .unwrap_or((None, None, None, None));

        let has_printer_settings = sheet_data
            .print_settings
            .as_ref()
            .and_then(|ps| ps.r_id.as_ref())
            .is_some();

        // ── Form Controls ──────────────────────────────────────────────
        // Extract form controls from the unified floating_objects vec
        let form_control_fobjs: Vec<&domain_types::domain::floating_object::FloatingObject> =
            sheet_data
                .floating_objects
                .iter()
                .filter(|fo| {
                    matches!(
                        &fo.data,
                        domain_types::domain::floating_object::FloatingObjectData::FormControl(_)
                    )
                })
                .collect();
        let form_controls = convert_unified_form_controls(&form_control_fobjs);

        sheet_writers.push(sheet_writer);
        sheet_extras.push(SheetExtras {
            comments: comments_data,
            threaded_comments,
            tables: table_xmls,
            table_rels: table_rels_data,
            has_external_hyperlinks,
            has_charts,
            has_chart_ex,
            has_floating_objects,
            original_comment_path,
            original_vml_path,
            hf_vml,
            original_drawing_path,
            has_printer_settings,
            form_controls,
        });
    }

    // Now set tableParts XML on sheet writers for sheets that have tables.
    for (idx, extras) in sheet_extras.iter().enumerate() {
        if !extras.tables.is_empty() {
            let mut table_parts_xml = String::new();
            let table_count = extras.tables.len();
            table_parts_xml.push_str(&format!("<tableParts count=\"{}\">", table_count));
            // The r:ids for tables in sheet rels will be assigned below.
            // For now, use placeholders that match what we'll generate.
            // Table r:ids come after hyperlink and comment r:ids.
            for i in 0..table_count {
                // Placeholder r:id — will be set correctly during rels generation.
                table_parts_xml.push_str(&format!("<tablePart r:id=\"rIdTable{}\"/>", i + 1));
            }
            table_parts_xml.push_str("</tableParts>");
            sheet_writers[idx].set_table_parts_xml(table_parts_xml);
        }
    }

    // ── Build pivot table and cache data ──────────────────────────────
    let pivot_data = pivot_writer::build_pivot_data(output, round_trip_ctx);

    // ── Build sheet rels and assign r:ids ────────────────────────────────
    // We need to build rels for each sheet and update hyperlink/table r:ids.
    let mut sheet_rels_data: Vec<Option<Vec<u8>>> = Vec::with_capacity(output.sheets.len());

    // Per-sheet drawing rels XML (for drawing→chart references).
    let mut drawing_rels_data: Vec<Option<Vec<u8>>> = Vec::with_capacity(output.sheets.len());

    // Per-sheet drawing XML (the drawingN.xml content).
    let mut drawing_xml_data: Vec<Option<Vec<u8>>> = Vec::with_capacity(output.sheets.len());

    // Track which sheets have drawings (for content types).
    let mut sheets_with_drawings: Vec<usize> = Vec::new();

    // Global VML drawing counter for archive paths (xl/drawings/vmlDrawing{N}.vml).
    // Excel numbers VML drawings sequentially across all sheets (1, 2, 3...),
    // NOT by sheet index. This counter mirrors the pattern used by global_table_idx.
    let mut global_vml_idx: usize = 0;

    // Global drawing counter for archive paths (xl/drawings/drawing{N}.xml).
    // Excel numbers drawings sequentially across sheets that have drawings (1, 2, 3...),
    // NOT by sheet index. Same pattern as VML drawings and comments.
    let mut global_drawing_idx: usize = 0;

    // Global comment counter for archive paths (xl/comments{N}.xml).
    // Excel numbers comment files sequentially across sheets that have comments (1, 2, 3...),
    // NOT by sheet index. Same pattern as VML drawings and tables.
    let mut global_comment_idx: usize = 0;

    // Global threaded comment counter (xl/threadedComments/threadedComment{N}.xml).
    let mut global_tc_idx: usize = 0;

    // Global ctrlProp counter for archive paths (xl/ctrlProps/ctrlProp{N}.xml).
    let mut global_ctrl_prop_idx: usize = 0;

    // Also re-process hyperlinks to assign correct r:ids.
    for (sheet_idx, sheet_data) in output.sheets.iter().enumerate() {
        let extras = &sheet_extras[sheet_idx];
        let has_comments = extras.comments.is_some();
        let has_threaded_comments = extras.threaded_comments.is_some();
        let has_tables = !extras.tables.is_empty();
        let has_hyperlinks = extras.has_external_hyperlinks;
        let has_charts = extras.has_charts;
        let has_chart_ex = extras.has_chart_ex;
        let has_floating_objects = extras.has_floating_objects;
        let has_drawing_passthroughs = round_trip_ctx
            .and_then(|ctx| ctx.sheets.get(sheet_idx))
            .map(|srt| !srt.drawing_anchor_passthroughs.is_empty())
            .unwrap_or(false);
        let has_preserved_drawing_relationship = round_trip_ctx
            .and_then(|ctx| ctx.sheets.get(sheet_idx))
            .map(|srt| {
                srt.sheet_opc_rels
                    .iter()
                    .any(|r| r.rel_type.ends_with("/drawing"))
            })
            .unwrap_or(false);
        let needs_drawing = has_charts
            || has_chart_ex
            || has_floating_objects
            || has_drawing_passthroughs
            || has_preserved_drawing_relationship;
        let has_modeled_drawing_content =
            has_charts || has_chart_ex || has_floating_objects || has_drawing_passthroughs;

        let has_printer_settings = extras.has_printer_settings;
        let has_hf_vml = extras.hf_vml.is_some();
        let has_form_controls = !extras.form_controls.is_empty();
        let has_pivot_tables = pivot_data
            .pivot_table_entries
            .iter()
            .any(|e| e.sheet_idx == sheet_idx)
            || pivot_data
                .preserved_pivot_table_entries
                .iter()
                .any(|e| e.sheet_idx == sheet_idx);
        let has_original_sheet_rels = round_trip_ctx
            .and_then(|ctx| ctx.sheets.get(sheet_idx))
            .map(|srt| !srt.sheet_opc_rels.is_empty())
            .unwrap_or(false);

        let has_any_hyperlinks = has_hyperlinks || !sheet_data.hyperlinks.is_empty();
        if !has_comments
            && !has_tables
            && !has_any_hyperlinks
            && !needs_drawing
            && !has_threaded_comments
            && !has_printer_settings
            && !has_hf_vml
            && !has_form_controls
            && !has_pivot_tables
            && !has_original_sheet_rels
        {
            sheet_rels_data.push(None);
            drawing_rels_data.push(None);
            drawing_xml_data.push(None);
            continue;
        }

        let sheet_num = sheet_idx + 1;

        // When round-trip context provides original sheet relationships,
        // replay them to preserve relationship IDs and ordering.
        let has_original_rels = round_trip_ctx
            .and_then(|ctx| ctx.sheets.get(sheet_idx))
            .map(|srt| !srt.sheet_opc_rels.is_empty())
            .unwrap_or(false);

        let mut rels = if has_original_rels {
            let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];
            // Convert domain_types::OpcRelationship → ooxml_types::shared::OpcRelationship
            let ooxml_rels: Vec<ooxml_types::shared::OpcRelationship> = srt
                .sheet_opc_rels
                .iter()
                .filter(|r| pivot_package::keep_sheet_relationship(&pivot_data, r))
                .map(|r| ooxml_types::shared::OpcRelationship {
                    id: r.id.clone(),
                    rel_type: r.rel_type.clone(),
                    target: r.target.clone(),
                    target_mode: r.target_mode.clone(),
                })
                .collect();
            RelationshipManager::from_original(&ooxml_rels)
        } else {
            create_sheet_rels()
        };

        // Classify whether a hyperlink target needs a relationship (r:id) or can be
        // written as a plain `location` attribute. External URLs, `#`-prefixed internal
        // refs (originally stored as rels), and UNC/file paths need rels. Plain internal
        // locations like "Sheet1!A1" don't.
        fn target_needs_rel(target: &str) -> bool {
            target.starts_with('#')
                || target.contains("://")
                || target.starts_with("\\\\")
                || target.starts_with("file:")
        }

        // Hyperlink rels (external URLs and internal links stored as rels)
        if !has_original_rels {
            let mut hyperlink_r_ids: Vec<(Option<String>, bool)> = Vec::new();
            for hl in &sheet_data.hyperlinks {
                if let Some(ref target) = hl.target {
                    if target_needs_rel(target) {
                        let r_id = rels.add_external(REL_HYPERLINK, target);
                        let is_internal_rel = target.starts_with('#');
                        hyperlink_r_ids.push((Some(r_id), is_internal_rel));
                    } else {
                        // Internal location-based link — no relationship needed.
                        hyperlink_r_ids.push((None, false));
                    }
                } else if let Some(ref location) = hl.location {
                    // Has location but no target — write as location attribute directly.
                    hyperlink_r_ids.push((None, false));
                    let _ = location; // suppress unused warning
                } else {
                    hyperlink_r_ids.push((None, false));
                }
            }

            // Update hyperlink r:ids on the sheet writer.
            if has_hyperlinks || !sheet_data.hyperlinks.is_empty() {
                let mut hyperlink_outputs = Vec::with_capacity(sheet_data.hyperlinks.len());
                for (i, hl) in sheet_data.hyperlinks.iter().enumerate() {
                    let (r_id, is_internal_rel) =
                        hyperlink_r_ids.get(i).cloned().unwrap_or((None, false));
                    // When an internal link has an r:id, the location is encoded in the
                    // rel target — don't also write it as a `location` attribute.
                    let location = if is_internal_rel {
                        String::new()
                    } else if r_id.is_none() {
                        // No relationship — use location or target as the location attribute.
                        hl.location
                            .clone()
                            .or_else(|| hl.target.clone())
                            .unwrap_or_default()
                    } else {
                        hl.location.clone().unwrap_or_default()
                    };
                    hyperlink_outputs.push(crate::output::results::HyperlinkOutput {
                        cell_ref: hl.cell_ref.clone(),
                        location,
                        display: hl.display.clone().unwrap_or_default(),
                        tooltip: hl.tooltip.clone().unwrap_or_default(),
                        r_id,
                        uid: hl.uid.clone(),
                    });
                }
                sheet_writers[sheet_idx].set_hyperlinks(hyperlink_outputs);
            }
        } else if has_hyperlinks || !sheet_data.hyperlinks.is_empty() {
            // With original rels, extract hyperlink r:ids from existing relationships
            let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];
            let mut hl_rels: Vec<&domain_types::OpcRelationship> = srt
                .sheet_opc_rels
                .iter()
                .filter(|r| r.rel_type.ends_with("/hyperlink"))
                .collect();
            // Sort by rId numeric suffix to match the order hyperlinks appear.
            // Lexicographic sort puts "rId10" before "rId2"; extract the number.
            hl_rels.sort_by(|a, b| {
                let num = |s: &str| {
                    s.strip_prefix("rId")
                        .and_then(|n| n.parse::<u32>().ok())
                        .unwrap_or(0)
                };
                num(&a.id).cmp(&num(&b.id))
            });

            // Build a lookup of rel targets → rel IDs for matching hyperlinks to rels.
            // Internal rels have targets like "#Sheet!A1", external ones have URLs.
            // Use Vec<String> per target to handle duplicate targets (multiple hyperlinks
            // pointing to the same URL each have their own rId in the rels file).
            let mut rel_target_to_ids: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            for r in &hl_rels {
                rel_target_to_ids
                    .entry(r.target.clone())
                    .or_default()
                    .push(r.id.clone());
            }

            let mut hyperlink_outputs = Vec::with_capacity(sheet_data.hyperlinks.len());
            for hl in &sheet_data.hyperlinks {
                // Match this hyperlink to an original rel by target.
                // Check external target first, then internal location (#location format).
                let matched_rel = hl
                    .target
                    .as_ref()
                    .and_then(|t| {
                        let ids = rel_target_to_ids.get_mut(t)?;
                        if ids.is_empty() {
                            return None;
                        }
                        let id = ids.remove(0);
                        Some((id, t.starts_with('#')))
                    })
                    .or_else(|| {
                        // For internal links, Yrs export strips "#" from target and puts
                        // it in location. Check if "#" + location matches a rel target.
                        hl.location.as_ref().and_then(|loc| {
                            let prefixed = format!("#{}", loc);
                            let ids = rel_target_to_ids.get_mut(&prefixed)?;
                            if ids.is_empty() {
                                return None;
                            }
                            let id = ids.remove(0);
                            Some((id, true))
                        })
                    });

                let (r_id, location) = if let Some((rel_id, is_internal_rel)) = matched_rel {
                    let loc = if is_internal_rel {
                        // Location is in the rel target — don't duplicate it.
                        String::new()
                    } else {
                        hl.location.clone().unwrap_or_default()
                    };
                    (Some(rel_id), loc)
                } else {
                    // No matching rel — write as location attribute.
                    let loc = hl
                        .location
                        .clone()
                        .or_else(|| hl.target.clone())
                        .unwrap_or_default();
                    (None, loc)
                };
                hyperlink_outputs.push(crate::output::results::HyperlinkOutput {
                    cell_ref: hl.cell_ref.clone(),
                    location,
                    display: hl.display.clone().unwrap_or_default(),
                    tooltip: hl.tooltip.clone().unwrap_or_default(),
                    r_id,
                    uid: hl.uid.clone(),
                });
            }
            sheet_writers[sheet_idx].set_hyperlinks(hyperlink_outputs);
        }

        // Comment rels
        if has_comments {
            if !has_original_rels {
                global_vml_idx += 1;
                global_comment_idx += 1;
                let _comments_r_id = rels.add(
                    REL_COMMENTS,
                    &format!("../comments{}.xml", global_comment_idx),
                );
                let vml_r_id = rels.add(
                    REL_VML_DRAWING,
                    &format!("../drawings/vmlDrawing{}.vml", global_vml_idx),
                );
                sheet_writers[sheet_idx].set_legacy_drawing_r_id(vml_r_id);
            } else {
                // Extract VML r:id from original rels
                let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];
                if let Some(vml_rel) = srt
                    .sheet_opc_rels
                    .iter()
                    .find(|r| r.rel_type.ends_with("/vmlDrawing"))
                {
                    sheet_writers[sheet_idx].set_legacy_drawing_r_id(vml_rel.id.clone());
                }
                // Still bump counters to stay in sync for sheets without original rels
                global_vml_idx += 1;
                global_comment_idx += 1;
            }
        }

        // Header/footer VML rels (legacyDrawingHF)
        if sheet_extras[sheet_idx].hf_vml.is_some() {
            if has_original_rels {
                let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];
                if let Some(hf_r_id) = &srt.legacy_drawing_hf_r_id {
                    sheet_writers[sheet_idx].set_legacy_drawing_hf_r_id(hf_r_id.clone());
                }
            } else {
                // Generate new relationship for HF VML
                global_vml_idx += 1;
                let hf_vml_r_id = rels.add(
                    REL_VML_DRAWING,
                    &format!("../drawings/vmlDrawing{}.vml", global_vml_idx),
                );
                sheet_writers[sheet_idx].set_legacy_drawing_hf_r_id(hf_vml_r_id);
            }
        }

        // Form controls rels (ctrlProp, VML, worksheet controls XML)
        if has_form_controls {
            let controls = &sheet_extras[sheet_idx].form_controls;
            let controls_writer = ControlsWriter::new(controls.clone());
            let base_shape_id: u32 = 1025;

            if has_original_rels {
                // Extract ctrlProp r:ids from original rels
                let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];
                let mut ctrl_prop_r_ids: Vec<String> = srt
                    .sheet_opc_rels
                    .iter()
                    .filter(|r| r.rel_type.ends_with("/ctrlProp"))
                    .map(|r| r.id.clone())
                    .collect();
                // Sort by rId numeric suffix
                ctrl_prop_r_ids.sort_by(|a, b| {
                    let num = |s: &str| {
                        s.strip_prefix("rId")
                            .and_then(|n| n.parse::<u32>().ok())
                            .unwrap_or(0)
                    };
                    num(a).cmp(&num(b))
                });

                // Set VML legacyDrawing for form controls if not already set by comments
                if !has_comments {
                    if let Some(vml_rel) = srt
                        .sheet_opc_rels
                        .iter()
                        .find(|r| r.rel_type.ends_with("/vmlDrawing"))
                    {
                        sheet_writers[sheet_idx].set_legacy_drawing_r_id(vml_rel.id.clone());
                    }
                    global_vml_idx += 1;
                }

                // Prefer the original worksheet controls XML for imported files.
                // This preserves mc:Fallback presence/absence and namespace placement.
                if let Some(raw_controls_xml) = &srt.worksheet_controls_xml {
                    sheet_writers[sheet_idx].set_controls_xml(raw_controls_xml.clone());
                } else {
                    let ctrl_xml =
                        controls_writer.write_worksheet_controls(base_shape_id, &ctrl_prop_r_ids);
                    sheet_writers[sheet_idx]
                        .set_controls_xml(String::from_utf8_lossy(&ctrl_xml).to_string());
                }

                // Bump global counter to stay in sync
                global_ctrl_prop_idx += controls.len();
            } else {
                // Add ctrlProp relationships
                let mut ctrl_prop_r_ids: Vec<String> = Vec::with_capacity(controls.len());
                for _ in 0..controls.len() {
                    global_ctrl_prop_idx += 1;
                    let r_id = rels.add(
                        REL_CTRL_PROP,
                        &format!("../ctrlProps/ctrlProp{}.xml", global_ctrl_prop_idx),
                    );
                    ctrl_prop_r_ids.push(r_id);
                }

                // Add VML drawing relationship for form controls (separate from comment VML)
                if !has_comments {
                    global_vml_idx += 1;
                    let vml_r_id = rels.add(
                        REL_VML_DRAWING,
                        &format!("../drawings/vmlDrawing{}.vml", global_vml_idx),
                    );
                    sheet_writers[sheet_idx].set_legacy_drawing_r_id(vml_r_id);
                }

                // Generate worksheet controls XML
                let ctrl_xml =
                    controls_writer.write_worksheet_controls(base_shape_id, &ctrl_prop_r_ids);
                sheet_writers[sheet_idx]
                    .set_controls_xml(String::from_utf8_lossy(&ctrl_xml).to_string());
            }
        }

        // Threaded comment rels (must come after legacy comment rels)
        if has_threaded_comments {
            global_tc_idx += 1;
            if !has_original_rels {
                rels.add(
                    REL_THREADED_COMMENT,
                    &format!("../threadedComments/threadedComment{}.xml", global_tc_idx),
                );
            }
        }

        // Table rels
        if has_tables {
            if has_original_rels {
                // Extract table r:ids from original rels
                let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];
                let mut table_r_ids: Vec<String> = srt
                    .sheet_opc_rels
                    .iter()
                    .filter(|r| r.rel_type.ends_with("/table"))
                    .map(|r| r.id.clone())
                    .collect();
                table_r_ids.sort();

                let mut table_parts_xml = String::new();
                table_parts_xml
                    .push_str(&format!("<tableParts count=\"{}\">", extras.tables.len()));
                for (i, _) in extras.tables.iter().enumerate() {
                    let r_id = table_r_ids
                        .get(i)
                        .cloned()
                        .unwrap_or_else(|| format!("rId{}", i + 1));
                    table_parts_xml.push_str(&format!("<tablePart r:id=\"{}\"/>", r_id));
                }
                table_parts_xml.push_str("</tableParts>");
                sheet_writers[sheet_idx].set_table_parts_xml(table_parts_xml);
            } else {
                // Compute the global table index offset for this sheet's tables.
                let tables_before: usize = sheet_extras[..sheet_idx]
                    .iter()
                    .map(|e| e.tables.len())
                    .sum();

                // Build tableParts XML with correct r:ids.
                let mut table_parts_xml = String::new();
                table_parts_xml
                    .push_str(&format!("<tableParts count=\"{}\">", extras.tables.len()));
                for i in 0..extras.tables.len() {
                    let global_idx = tables_before + i + 1;
                    let table_r_id =
                        rels.add(REL_TABLE, &format!("../tables/table{}.xml", global_idx));
                    table_parts_xml.push_str(&format!("<tablePart r:id=\"{}\"/>", table_r_id));
                }
                table_parts_xml.push_str("</tableParts>");
                sheet_writers[sheet_idx].set_table_parts_xml(table_parts_xml);
            }
        }

        // Pivot table rels (sheet → pivotTable) and worksheet-level references.
        //
        // OOXML consumers discover worksheet-owned pivot tables from structured
        // `<pivotTableDefinition r:id="..."/>` children in the worksheet XML.
        // The relationship file supplies the target part; both must be kept in
        // lockstep with the generated authoritative pivot paths.
        let preserved_pivot_table_r_ids =
            pivot_package::preserved_sheet_relationship_ids(&pivot_data, sheet_idx);
        if !preserved_pivot_table_r_ids.is_empty() {
            sheet_writers[sheet_idx].set_preserved_pivot_table_r_ids(preserved_pivot_table_r_ids);
        }
        let pivot_table_r_ids =
            pivot_package::add_sheet_relationships(&mut rels, &pivot_data, sheet_idx);
        if !pivot_table_r_ids.is_empty() {
            sheet_writers[sheet_idx].set_pivot_table_r_ids(pivot_table_r_ids);
        }

        // Chart / Drawing / Floating Object rels
        if needs_drawing {
            global_drawing_idx += 1;
            let _chart_entries = &all_chart_entries[sheet_idx];

            if has_original_rels {
                // Extract drawing r:id from original rels
                let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];
                if let Some(dr) = srt
                    .sheet_opc_rels
                    .iter()
                    .find(|r| r.rel_type.ends_with("/drawing"))
                {
                    sheet_writers[sheet_idx].set_drawing_r_id(dr.id.clone());
                }
            } else {
                // Add sheet→drawing relationship.
                let drawing_r_id = rels.add(
                    REL_DRAWING,
                    &format!("../drawings/drawing{}.xml", global_drawing_idx),
                );
                sheet_writers[sheet_idx].set_drawing_r_id(drawing_r_id);
            }

            // Build drawing .rels (drawing→chart references, image refs).
            // When original drawing OPC rels are available, initialize from them to
            // preserve the original relationship order and IDs.
            let has_drawing_opc_rels = round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .map(|srt| !srt.drawing_opc_rels.is_empty())
                .unwrap_or(false);
            let mut drawing_rels = if has_drawing_opc_rels {
                let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];
                let ooxml_rels: Vec<ooxml_types::shared::OpcRelationship> = srt
                    .drawing_opc_rels
                    .iter()
                    .map(|r| ooxml_types::shared::OpcRelationship {
                        id: r.id.clone(),
                        rel_type: r.rel_type.clone(),
                        target: r.target.clone(),
                        target_mode: r.target_mode.clone(),
                    })
                    .collect();
                RelationshipManager::from_original(&ooxml_rels)
            } else {
                RelationshipManager::new()
            };

            let imported_drawing = round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .and_then(|srt| srt.imported_drawing.clone());

            // Build DrawingWriter with all anchors (charts + floating objects).
            let mut drawing_writer = DrawingWriter::new();
            if let Some(attrs) = round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .map(|srt| srt.drawing_root_namespace_attrs.clone())
                .filter(|attrs| !attrs.is_empty())
            {
                drawing_writer.set_root_namespace_attrs(attrs);
            }

            // ── Collect drawing anchor passthroughs (mc:AlternateContent, e.g., ChartEx) ──
            // These carry their own relationship IDs (embedded in the raw XML).
            // Stored with their original anchor index so we can insert them at the
            // correct position after all other anchors are added, preserving order.
            let has_passthroughs = round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .map(|srt| !srt.drawing_anchor_passthroughs.is_empty())
                .unwrap_or(false);
            let mut passthrough_chart_ex_count = 0usize;
            let mut deferred_passthroughs: Vec<(usize, DrawingAnchor)> = Vec::new();
            if has_passthroughs {
                let srt = &round_trip_ctx.unwrap().sheets[sheet_idx];

                for (orig_idx, raw_xml) in &srt.drawing_anchor_passthroughs {
                    use crate::domain::drawings::McAlternateContent;
                    if raw_xml.contains("2014/chartex") || raw_xml.contains("chartEx") {
                        passthrough_chart_ex_count += 1;
                    }
                    let mc = McAlternateContent {
                        raw_xml: raw_xml.clone(),
                    };
                    let anchor = if raw_xml.starts_with("<xdr:oneCellAnchor") {
                        DrawingAnchor::OneCell(
                            OneCellAnchor {
                                from: CellAnchor {
                                    col: 0,
                                    row: 0,
                                    col_off: 0,
                                    row_off: 0,
                                },
                                extent: Extent { cx: 0, cy: 0 },
                                client_data: ClientData::default(),
                                mc_alternate_content: Some(mc),
                            },
                            DrawingObject::GraphicFrame(OpaqueGraphicFrame {
                                raw_xml: String::new(),
                            }),
                        )
                    } else {
                        DrawingAnchor::TwoCell(
                            TwoCellAnchor {
                                from: CellAnchor {
                                    col: 0,
                                    row: 0,
                                    col_off: 0,
                                    row_off: 0,
                                },
                                to: CellAnchor {
                                    col: 0,
                                    row: 0,
                                    col_off: 0,
                                    row_off: 0,
                                },
                                edit_as: None,
                                client_data: ClientData::default(),
                                mc_alternate_content: Some(mc),
                            },
                            DrawingObject::GraphicFrame(OpaqueGraphicFrame {
                                raw_xml: String::new(),
                            }),
                        )
                    };
                    deferred_passthroughs.push((*orig_idx, anchor));
                }
            }

            // ── Floating objects (images, shapes, text boxes, groups, connectors, SmartArt) ──
            // IMPORTANT: Image rels must be registered BEFORE chart rels so that
            // `add_with_id` bumps `next_id` past the original rIds. Otherwise
            // chart `add()` calls would generate rId1/rId2/… that collide with
            // existing image relationship IDs, causing images to be lost.
            //
            // Floating object anchors are deferred (not added to DrawingWriter yet)
            // so they can be interleaved with chart anchors in their original drawing
            // anchor order. This preserves the anchor sequence from the original XLSX.
            let mut deferred_fobj_anchors: Vec<(Option<usize>, DrawingAnchor)> = Vec::new();
            if has_floating_objects {
                use super::drawing_writer_helpers::build_sheet_drawing_data;

                let drawing_data = build_sheet_drawing_data(&sheet_data.floating_objects);

                deferred_fobj_anchors = drawing_data.anchors;

                // Add image relationships for images whose bytes are already
                // handled by binary_blobs passthrough (no need to re-emit bytes).
                // Uses add_with_id to preserve original relationship IDs for round-trip fidelity.
                // Must be registered before chart rels to reserve original rIds.
                // Skip if already present (from from_original).
                for (r_id, image_path) in &drawing_data.image_rels {
                    if drawing_rels.find_by_target(image_path).is_none() {
                        drawing_rels.add_with_id(
                            r_id,
                            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
                            image_path,
                        );
                    }
                }

                // Add image relationships and collect blobs for ZIP assembly.
                for (image_path, image_bytes) in drawing_data.image_blobs {
                    let _image_r_id = drawing_rels.find_by_target(&image_path)
                        .unwrap_or_else(|| drawing_rels.add(
                            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
                            &image_path,
                        ));
                    // Resolve the relative path (e.g. "../media/image1.png") to absolute ZIP path.
                    let zip_path = if let Some(stripped) = image_path.strip_prefix("../") {
                        format!("xl/{}", stripped)
                    } else {
                        format!("xl/media/{}", image_path)
                    };
                    all_image_blobs.push((zip_path, image_bytes));
                }
            }

            // ── Charts (regular + ChartEx interleaved in original order) ──
            // Chart anchors are also deferred so we can interleave them with floating
            // objects in their original drawing anchor order.
            let chart_entries = &all_chart_entries[sheet_idx];
            let chart_ex_entries = &all_chart_ex_entries[sheet_idx];
            let chart_entry_map: std::collections::HashMap<usize, &ChartEntry> =
                chart_entries.iter().map(|e| (e.source_idx, e)).collect();
            let chart_ex_entry_map: std::collections::HashMap<usize, &ChartExEntry> =
                chart_ex_entries.iter().map(|e| (e.source_idx, e)).collect();

            let mut deferred_chart_anchors: Vec<(Option<usize>, DrawingAnchor)> = Vec::new();
            let mut regular_local_idx: usize = 0;
            let mut cx_local_idx: usize = 0;
            for (source_idx, chart_spec) in sheet_data.charts.iter().enumerate() {
                let chart_frame = chart_spec.chart_frame.as_ref();
                let anchor_index = chart_frame
                    .and_then(|frame| frame.anchor_index.and_then(|idx| usize::try_from(idx).ok()))
                    .or(chart_spec.anchor_index);
                let from = CellAnchor {
                    col: chart_spec.position.anchor_col,
                    row: chart_spec.position.anchor_row,
                    col_off: chart_spec.position.anchor_col_offset,
                    row_off: chart_spec.position.anchor_row_offset,
                };
                let to = CellAnchor {
                    col: chart_spec
                        .position
                        .end_col
                        .unwrap_or(chart_spec.position.anchor_col + 8),
                    row: chart_spec
                        .position
                        .end_row
                        .unwrap_or(chart_spec.position.anchor_row + 15),
                    col_off: chart_spec.position.end_col_offset.unwrap_or(0),
                    row_off: chart_spec.position.end_row_offset.unwrap_or(0),
                };
                let client_data = ClientData {
                    locks_with_sheet: chart_frame
                        .and_then(|frame| frame.client_data_locks_with_sheet)
                        .or(chart_spec.client_data_locks_with_sheet)
                        .unwrap_or(true),
                    prints_with_sheet: chart_frame
                        .and_then(|frame| frame.client_data_prints_with_sheet)
                        .or(chart_spec.client_data_prints_with_sheet)
                        .unwrap_or(true),
                };

                if chart_spec.is_chart_ex {
                    // Skip if this chartEx was already handled by a drawing anchor passthrough.
                    if passthrough_chart_ex_count > 0 && cx_local_idx < passthrough_chart_ex_count {
                        cx_local_idx += 1;
                        continue;
                    }
                    let Some(cx_entry) = chart_ex_entry_map.get(&source_idx) else {
                        continue;
                    };
                    let cx_target = chart_frame
                        .and_then(|frame| frame.relationship_target.clone())
                        .unwrap_or_else(|| format!("../charts/chartEx{}.xml", cx_entry.global_idx));
                    let cx_r_id = if let Some(rid) =
                        chart_frame.and_then(|frame| frame.relationship_id.clone())
                    {
                        if drawing_rels.get_by_id(&rid).is_none() {
                            drawing_rels.add_with_id(&rid, REL_CHART_EX, &cx_target);
                        }
                        rid
                    } else {
                        drawing_rels
                            .find_by_target(&cx_target)
                            .unwrap_or_else(|| drawing_rels.add(REL_CHART_EX, &cx_target))
                    };
                    let frame_cnv =
                        chart_frame.map(|frame| &frame.graphic_frame.nv_graphic_frame_pr.c_nv_pr);
                    let cx_ref = ChartExRef {
                        r_id: cx_r_id,
                        name: frame_cnv
                            .and_then(|cnv| (!cnv.name.is_empty()).then(|| cnv.name.clone()))
                            .or_else(|| chart_spec.cnv_pr_name.clone())
                            .or_else(|| chart_spec.title.clone())
                            .unwrap_or_else(|| format!("Chart {}", cx_local_idx + 1)),
                        id: frame_cnv
                            .and_then(|cnv| (cnv.id.value() != 0).then_some(cnv.id.value()))
                            .or(chart_spec.cnv_pr_id)
                            .unwrap_or((cx_local_idx + 100) as u32),
                        fallback_off_x: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.off_x())
                            .unwrap_or(chart_spec.position.anchor_col_offset),
                        fallback_off_y: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.off_y())
                            .unwrap_or(chart_spec.position.anchor_row_offset),
                        fallback_ext_cx: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.ext_cx() as i64)
                            .unwrap_or((chart_spec.size.width as i64) * 9525),
                        fallback_ext_cy: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.ext_cy() as i64)
                            .unwrap_or((chart_spec.size.height as i64) * 9525),
                        macro_name: chart_frame
                            .and_then(|frame| frame.graphic_frame.macro_name.clone())
                            .or_else(|| chart_spec.macro_name.clone()),
                    };
                    let edit_as = chart_frame
                        .and_then(|frame| frame.edit_as.as_deref())
                        .or(chart_spec.anchor_edit_as.as_deref())
                        .map(ooxml_types::drawings::EditAs::from_ooxml);
                    deferred_chart_anchors.push((
                        anchor_index,
                        DrawingAnchor::TwoCell(
                            TwoCellAnchor {
                                from,
                                to,
                                edit_as,
                                client_data,
                                mc_alternate_content: None,
                            },
                            DrawingObject::ChartEx(cx_ref),
                        ),
                    ));
                    cx_local_idx += 1;
                } else {
                    let Some(chart_entry) = chart_entry_map.get(&source_idx) else {
                        continue;
                    };
                    let default_chart_target =
                        format!("../charts/chart{}.xml", chart_entry.global_idx);
                    let chart_target = chart_frame
                        .and_then(|frame| frame.relationship_target.clone())
                        .unwrap_or(default_chart_target);
                    let chart_r_id = if let Some(rid) =
                        chart_frame.and_then(|frame| frame.relationship_id.clone())
                    {
                        if drawing_rels.get_by_id(&rid).is_none() {
                            drawing_rels.add_with_id(&rid, REL_CHART, &chart_target);
                        }
                        rid
                    } else {
                        drawing_rels
                            .find_by_target(&chart_target)
                            .unwrap_or_else(|| drawing_rels.add(REL_CHART, &chart_target))
                    };
                    let frame_nv =
                        chart_frame.map(|frame| &frame.graphic_frame.nv_graphic_frame_pr);
                    let frame_cnv = frame_nv.map(|nv| &nv.c_nv_pr);
                    let chart_name = frame_cnv
                        .and_then(|cnv| (!cnv.name.is_empty()).then(|| cnv.name.clone()))
                        .or_else(|| chart_spec.cnv_pr_name.clone())
                        .or_else(|| chart_spec.title.clone())
                        .unwrap_or_else(|| format!("Chart {}", regular_local_idx + 1));
                    let chart_id = frame_cnv
                        .and_then(|cnv| (cnv.id.value() != 0).then_some(cnv.id.value()))
                        .or(chart_spec.cnv_pr_id)
                        .unwrap_or((regular_local_idx + 2) as u32);
                    let frame_locks = frame_nv
                        .map(|nv| nv.c_nv_graphic_frame_pr.clone())
                        .unwrap_or_default();
                    let has_gf_locks = frame_nv
                        .map(|nv| {
                            nv.has_graphic_frame_locks || nv.no_change_aspect_explicit.is_some()
                        })
                        .unwrap_or_else(|| {
                            chart_spec.has_graphic_frame_locks
                                || chart_spec.no_change_aspect.is_some()
                        });
                    let no_change_aspect_explicit = frame_nv
                        .and_then(|nv| nv.no_change_aspect_explicit)
                        .or(chart_spec.no_change_aspect);

                    let chart_ref = ChartRef {
                        original_id: Some(chart_id),
                        name: chart_name,
                        descr: frame_cnv
                            .and_then(|cnv| cnv.descr.clone())
                            .or_else(|| chart_spec.cnv_pr_descr.clone()),
                        title: frame_cnv
                            .and_then(|cnv| cnv.title.clone())
                            .or_else(|| chart_spec.cnv_pr_title.clone()),
                        hidden: frame_cnv
                            .map(|cnv| cnv.hidden)
                            .unwrap_or(chart_spec.cnv_pr_hidden),
                        hlink_click: frame_cnv.and_then(|cnv| cnv.hlink_click.clone()),
                        hlink_hover: frame_cnv.and_then(|cnv| cnv.hlink_hover.clone()),
                        r_id: chart_r_id,
                        macro_name: chart_frame
                            .and_then(|frame| frame.graphic_frame.macro_name.clone())
                            .or_else(|| chart_spec.macro_name.clone()),
                        nv_ext_lst: frame_cnv
                            .and_then(|cnv| cnv.ext_lst.clone())
                            .or_else(|| chart_spec.cnv_pr_ext_lst.clone()),
                        graphic_frame_locks: frame_locks,
                        has_graphic_frame_locks: has_gf_locks,
                        no_change_aspect_explicit,
                        no_drilldown: frame_nv.map(|nv| nv.no_drilldown).unwrap_or(false),
                        c_nv_graphic_frame_pr_ext_lst: frame_nv
                            .and_then(|nv| nv.c_nv_graphic_frame_pr_ext_lst.clone()),
                        xfrm_off_x: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.off_x())
                            .unwrap_or(chart_spec.xfrm_off_x),
                        xfrm_off_y: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.off_y())
                            .unwrap_or(chart_spec.xfrm_off_y),
                        xfrm_ext_cx: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.ext_cx() as i64)
                            .unwrap_or(chart_spec.xfrm_ext_cx),
                        xfrm_ext_cy: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.ext_cy() as i64)
                            .unwrap_or(chart_spec.xfrm_ext_cy),
                    };
                    if let (Some(cx), Some(cy)) =
                        (chart_spec.position.extent_cx, chart_spec.position.extent_cy)
                    {
                        deferred_chart_anchors.push((
                            anchor_index,
                            DrawingAnchor::OneCell(
                                OneCellAnchor {
                                    from,
                                    extent: Extent { cx, cy },
                                    client_data,
                                    mc_alternate_content: None,
                                },
                                DrawingObject::Chart(chart_ref),
                            ),
                        ));
                    } else {
                        let edit_as = chart_frame
                            .and_then(|frame| frame.edit_as.as_deref())
                            .or(chart_spec.anchor_edit_as.as_deref())
                            .map(ooxml_types::drawings::EditAs::from_ooxml);
                        deferred_chart_anchors.push((
                            anchor_index,
                            DrawingAnchor::TwoCell(
                                TwoCellAnchor {
                                    from,
                                    to,
                                    edit_as,
                                    client_data,
                                    mc_alternate_content: None,
                                },
                                DrawingObject::Chart(chart_ref),
                            ),
                        ));
                    }
                    regular_local_idx += 1;
                }
            }

            // ── Interleave all deferred anchors in original drawing order ──
            // Floating objects have explicit anchor indices from ooxml props.
            // Passthroughs have explicit anchor indices from the parser.
            // Charts now also carry explicit anchor indices from ChartSpec.anchor_index.
            // Any anchors without explicit indices fill the remaining slots in order.
            {
                // Collect all known (occupied) anchor indices from fobj, charts, and passthroughs.
                let mut occupied: std::collections::BTreeSet<usize> =
                    std::collections::BTreeSet::new();
                for (idx, _) in &deferred_fobj_anchors {
                    if let Some(i) = idx {
                        occupied.insert(*i);
                    }
                }
                for (idx, _) in &deferred_passthroughs {
                    occupied.insert(*idx);
                }
                // Charts with explicit anchor_index from ChartSpec
                for (idx, _) in &deferred_chart_anchors {
                    if let Some(i) = idx {
                        occupied.insert(*i);
                    }
                }

                // Assign unindexed chart anchors to the remaining (free) indices.
                let total = deferred_fobj_anchors.len()
                    + deferred_chart_anchors.len()
                    + deferred_passthroughs.len();
                let mut free_indices: Vec<usize> =
                    (0..total).filter(|i| !occupied.contains(i)).collect();
                let unindexed_chart_count = deferred_chart_anchors
                    .iter()
                    .filter(|(idx, _)| idx.is_none())
                    .count();
                while free_indices.len() < unindexed_chart_count {
                    let next = free_indices.last().map_or(total, |&i| i + 1);
                    free_indices.push(next);
                }

                // Build a combined list of (index, anchor).
                let mut all_anchors: Vec<(usize, DrawingAnchor)> = Vec::with_capacity(total);

                for (idx, anchor) in deferred_fobj_anchors {
                    let i = idx.unwrap_or(usize::MAX);
                    all_anchors.push((i, anchor));
                }
                let mut free_idx_iter = free_indices.into_iter();
                for (idx, anchor) in deferred_chart_anchors {
                    let i = idx.unwrap_or_else(|| free_idx_iter.next().unwrap_or(usize::MAX));
                    all_anchors.push((i, anchor));
                }
                for (idx, anchor) in deferred_passthroughs {
                    all_anchors.push((idx, anchor));
                }

                // Sort by anchor index to restore original order.
                all_anchors.sort_by_key(|&(idx, _)| idx);

                for (_, anchor) in all_anchors {
                    drawing_writer.add_anchor(anchor);
                }
            }

            let drawing_xml = if has_modeled_drawing_content {
                drawing_writer.to_xml()
            } else if let Some(ref imported) = imported_drawing {
                imported.data.clone()
            } else {
                DrawingWriter::new().to_xml()
            };
            drawing_xml_data.push(Some(drawing_xml));
            // Emit drawing .rels when there are actual relationships OR when the
            // original archive had a .rels file (even if empty) for round-trip fidelity.
            let had_original_rels_file = round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .map(|srt| srt.has_drawing_rels_file)
                .unwrap_or(false);
            if let Some(imported) = imported_drawing
                && let Some(rels) = imported.rels
            {
                drawing_rels_data.push(Some(rels.data));
            } else if !drawing_rels.is_empty() || had_original_rels_file {
                drawing_rels_data.push(Some(drawing_rels.to_xml()));
            } else {
                drawing_rels_data.push(None);
            }
            sheets_with_drawings.push(global_drawing_idx);
        } else {
            drawing_xml_data.push(None);
            drawing_rels_data.push(None);
        }

        // Printer settings relationship.
        // When original rels exist, the printer settings rel was already replayed above.
        // When they don't, generate it from the domain model's r:id.
        if has_printer_settings && !has_original_rels {
            if let Some(ref ps) = sheet_data.print_settings {
                if let Some(ref r_id) = ps.r_id {
                    // Use the r:id from the domain model as the relationship ID.
                    // The target path follows the standard convention.
                    // The actual binary is written by binary blob passthrough.
                    rels.add_with_id(
                        r_id,
                        REL_PRINTER_SETTINGS,
                        &format!("../printerSettings/printerSettings{}.bin", sheet_num),
                    );
                }
            }
        }

        if rels.is_empty() {
            sheet_rels_data.push(None);
        } else {
            sheet_rels_data.push(Some(rels.to_xml()));
        }
    }

    // ── 3. Build workbook.xml ───────────────────────────────────────────
    let mut workbook_writer = WorkbookWriter::new();
    // Use original workbook rIds when available for round-trip fidelity,
    // falling back to sequential rId1, rId2, ... for new workbooks.
    let has_original_r_ids = round_trip_ctx
        .map(|ctx| ctx.sheet_workbook_r_ids.len() == output.sheets.len())
        .unwrap_or(false);
    for (idx, sheet_data) in output.sheets.iter().enumerate() {
        let r_id = if has_original_r_ids {
            round_trip_ctx.unwrap().sheet_workbook_r_ids[idx].clone()
        } else {
            format!("rId{}", idx + 1)
        };
        let sheet_id = sheet_data.sheet_id.unwrap_or(idx as u32 + 1);
        workbook_writer.add_sheet_def(super::SheetDef::with_state(
            &sheet_data.name,
            sheet_id,
            &r_id,
            sheet_data.visibility,
        ));
    }

    // Set workbook views from RoundTripContext (preserves tabRatio, window position, etc.)
    if let Some(ctx) = round_trip_ctx {
        if !ctx.workbook_views.is_empty() {
            let views: Vec<ooxml_types::workbook::BookView> = ctx
                .workbook_views
                .iter()
                .cloned()
                .map(ooxml_types::workbook::BookView::from)
                .collect();
            workbook_writer.set_views(views);
        }
    }

    // Add defined names (named ranges)
    for named_range in &output.named_ranges {
        let mut def = DefinedNameDef::new(&named_range.name, &named_range.refers_to);
        def.local_sheet_id = named_range.local_sheet_id;
        def.hidden = named_range.hidden;
        def.comment = named_range.comment.clone();
        def.custom_menu = named_range.custom_menu.clone();
        def.description = named_range.description.clone();
        def.help = named_range.help.clone();
        def.status_bar = named_range.status_bar.clone();
        def.xlm = named_range.xlm;
        def.function = named_range.function;
        def.vb_procedure = named_range.vb_procedure;
        def.publish_to_server = named_range.publish_to_server;
        def.workbook_parameter = named_range.workbook_parameter;
        def.xml_space_preserve = named_range.xml_space_preserve;
        workbook_writer.add_defined_name_full(def);
    }

    // ── Workbook Protection ──────────────────────────────────────────
    if let Some(ref prot) = output.protection {
        workbook_writer.set_workbook_protection(prot.clone());
    }

    // ── Workbook Preserved Namespaces + Elements (round-trip) ─────
    if let Some(ctx) = round_trip_ctx {
        if !ctx.workbook_namespace_attrs.is_empty() {
            let mut ns_map = crate::roundtrip::namespaces::NamespaceMap::new();
            for (prefix, uri) in &ctx.workbook_namespace_attrs {
                if prefix.is_empty() {
                    ns_map.set_default(uri.as_str());
                } else {
                    ns_map.add_prefixed(prefix.as_str(), uri.as_str());
                }
            }
            workbook_writer.set_preserved_namespaces(ns_map);
        }
        if !ctx.workbook_preserved_elements.is_empty() {
            let preserved =
                crate::roundtrip::unknown_elements::PreservedElements::from_position_pairs(
                    &ctx.workbook_preserved_elements,
                );
            workbook_writer.set_preserved_elements(preserved);
        }
    }

    // ── Iterative Calc Settings ──────────────────────────────────────
    {
        let calc = crate::domain::workbook::write::calc_settings_from_domain(&output.calculation);
        workbook_writer.set_calc_settings(calc);
    }

    // ── 4. Build theme XML (optional) ────────────────────────────────
    // Pass round_trip_ctx through so the theme writer can use the full parsed
    // font scheme, format scheme, objectDefaults, etc. for lossless round-tripping.
    let theme_xml = output
        .theme
        .as_ref()
        .map(|t| crate::domain::themes::write::theme_writer_from_domain(t, round_trip_ctx));
    let has_theme = theme_xml.is_some();

    // ── 5. Build document properties XML (optional) ──────────────────
    // Prefer raw XML blobs from RoundTripContext for lossless round-tripping.
    let core_props_xml: Option<Vec<u8>> = round_trip_ctx
        .and_then(|ctx| ctx.raw_doc_props_core_xml.clone())
        .or_else(|| {
            output
                .properties
                .as_ref()
                .map(crate::domain::metadata::write::write_core_props_xml)
        });
    let app_props_xml: Option<Vec<u8>> = round_trip_ctx
        .and_then(|ctx| ctx.raw_doc_props_app_xml.clone())
        .or_else(|| {
            output
                .properties
                .as_ref()
                .map(|_| crate::domain::metadata::write::write_app_props_xml())
        });
    // has_doc_props: true when we actually have core/app XML to emit (from
    // ParseOutput.properties OR from RoundTripContext raw blobs).
    let has_doc_props = core_props_xml.is_some() || app_props_xml.is_some();
    let custom_props_xml: Option<Vec<u8>> =
        round_trip_ctx.and_then(|ctx| ctx.raw_doc_props_custom_xml.clone());
    let has_custom_props = custom_props_xml.is_some();
    // xl/metadata.xml passthrough
    let metadata_xml: Option<Vec<u8>> = round_trip_ctx.and_then(|ctx| ctx.raw_metadata_xml.clone());
    let external_link_exports: Vec<(domain_types::domain::external_link::ExternalLink, String)> =
        round_trip_ctx
            .map(|ctx| {
                ctx.external_links
                    .iter()
                    .map(|link| (link.clone(), external_link_part_name(link)))
                    .collect()
            })
            .unwrap_or_default();

    // ── 6. Generate XML parts ───────────────────────────────────────────
    let styles_xml = styles_writer.to_xml();
    // SST entries are emitted in insertion order; the index returned by
    // `add()` / `seed()` is the slot at which the entry lands in <sst>.
    // This is load-bearing for cells, which carry positional SST indices.
    let shared_strings_xml = shared_strings.to_xml();

    // Build content types with knowledge of comments, tables, theme, and props.
    let has_any_comments = sheet_extras.iter().any(|e| e.comments.is_some());
    let _total_table_count: usize = sheet_extras.iter().map(|e| e.tables.len()).sum();

    let mut content_types = ContentTypesManager::new();
    // Replay original Default entries from RoundTripContext for round-trip fidelity.
    // Original files may include defaults for image extensions, printerSettings, etc.
    // that the writer wouldn't otherwise emit (e.g., when no images are present).
    let used_rt_defaults = if let Some(ctx) = round_trip_ctx {
        if !ctx.content_type_defaults.is_empty() {
            for (ext, ct) in &ctx.content_type_defaults {
                content_types.add_default(ext, ct);
            }
            true
        } else {
            false
        }
    } else {
        false
    };
    if !used_rt_defaults {
        content_types.add_default(
            "rels",
            "application/vnd.openxmlformats-package.relationships+xml",
        );
        content_types.add_default("xml", "application/xml");
    }
    if has_any_comments {
        content_types.add_default(
            "vml",
            "application/vnd.openxmlformats-officedocument.vmlDrawing",
        );
    }
    // Replay original Override entries from RoundTripContext for order fidelity,
    // then fill in any overrides for parts that weren't in the original.
    let used_rt_overrides = if let Some(ctx) = round_trip_ctx {
        if !ctx.content_type_overrides.is_empty() {
            for (part_name, ct) in &ctx.content_type_overrides {
                if !pivot_package::keep_content_type_override(&pivot_data, part_name, ct)
                    || part_name == "/xl/calcChain.xml"
                {
                    continue;
                }
                content_types.add_override(part_name, ct);
            }
            true
        } else {
            false
        }
    } else {
        false
    };
    if !content_types.has_override("/xl/workbook.xml") {
        content_types.add_workbook();
    }
    for i in 1..=output.sheets.len() {
        let path = format!("/xl/worksheets/sheet{}.xml", i);
        if !content_types.has_override(&path) {
            content_types.add_worksheet(i);
        }
    }
    if !content_types.has_override("/xl/styles.xml") {
        content_types.add_styles();
    }
    if !shared_strings.is_empty() && !content_types.has_override("/xl/sharedStrings.xml") {
        content_types.add_shared_strings();
    }
    if has_theme && !content_types.has_override("/xl/theme/theme1.xml") {
        content_types.add_theme();
    }
    if has_doc_props {
        if !content_types.has_override("/docProps/core.xml") {
            content_types.add_core_properties();
        }
        if !content_types.has_override("/docProps/app.xml") {
            content_types.add_extended_properties();
        }
    }
    if has_custom_props && !content_types.has_override("/docProps/custom.xml") {
        content_types.add_custom_properties();
    }
    if metadata_xml.is_some() && !content_types.has_override("/xl/metadata.xml") {
        content_types.add_metadata();
    }
    if round_trip_ctx.map_or(false, |ctx| ctx.doc_metadata_label_info.is_some())
        && !content_types.has_override("/docMetadata/LabelInfo.xml")
    {
        content_types.add_doc_metadata_label_info();
    }
    {
        let mut ct_comment_idx = 0usize;
        let mut ct_tc_idx = 0usize;
        for extras in &sheet_extras {
            if extras.comments.is_some() {
                ct_comment_idx += 1;
                if let Some(ref path) = extras.original_comment_path {
                    let normalized = if path.starts_with('/') {
                        path.clone()
                    } else {
                        format!("/{}", path)
                    };
                    if !content_types.has_override(&normalized) {
                        content_types.add_comments_path(path);
                    }
                } else {
                    let path = format!("/xl/comments{}.xml", ct_comment_idx);
                    if !content_types.has_override(&path) {
                        content_types.add_comments(ct_comment_idx);
                    }
                }
            }
            if extras.threaded_comments.is_some() {
                ct_tc_idx += 1;
                let path = format!("/xl/threadedComments/threadedComment{}.xml", ct_tc_idx);
                if !content_types.has_override(&path) {
                    content_types
                        .add_override(&path, "application/vnd.ms-excel.threadedcomments+xml");
                }
            }
        }
    }
    // Emit persons.xml content type if we have person data, regardless of
    // whether threaded comments exist (Excel can store persons without threads).
    let has_persons = !output.persons.is_empty();
    if has_persons {
        content_types.add_override(
            "/xl/persons/person.xml",
            "application/vnd.ms-excel.person+xml",
        );
    }
    {
        let mut table_global = 0usize;
        for extras in &sheet_extras {
            for _ in &extras.tables {
                table_global += 1;
                let path = format!("/xl/tables/table{}.xml", table_global);
                if !content_types.has_override(&path) {
                    content_types.add_table(table_global);
                }
            }
        }
    }
    // Pivot table and cache content types.
    pivot_package::add_pivot_content_types(&mut content_types, &pivot_data);
    // Form control (ctrlProp) content types.
    {
        let mut ct_ctrl_idx: usize = 0;
        for extras in &sheet_extras {
            for _ in &extras.form_controls {
                ct_ctrl_idx += 1;
                let path = format!("/xl/ctrlProps/ctrlProp{}.xml", ct_ctrl_idx);
                if !content_types.has_override(&path) {
                    content_types.add_override(&path, CONTENT_TYPE_CTRL_PROP);
                }
            }
        }
    }
    // Chart and drawing content types.
    // Use original drawing paths from round-trip context when available,
    // otherwise use sequential global drawing index.
    {
        let mut ct_drawing_idx: usize = 0;
        for (idx, _) in output.sheets.iter().enumerate() {
            if drawing_xml_data[idx].is_none() {
                continue;
            }
            ct_drawing_idx += 1;
            if let Some(ref orig_path) = sheet_extras[idx].original_drawing_path {
                let ct_path = if orig_path.starts_with('/') {
                    orig_path.clone()
                } else {
                    format!("/{}", orig_path)
                };
                if !content_types.has_override(&ct_path) {
                    content_types.add_override(
                        &ct_path,
                        "application/vnd.openxmlformats-officedocument.drawing+xml",
                    );
                }
            } else {
                content_types.add_drawing(ct_drawing_idx);
            }
        }
    }
    for chart_entries in &all_chart_entries {
        for entry in chart_entries {
            let path = format!("/xl/charts/chart{}.xml", entry.global_idx);
            if !content_types.has_override(&path) {
                content_types.add_chart(entry.global_idx);
            }
        }
    }
    for chart_ex_entries in &all_chart_ex_entries {
        for entry in chart_ex_entries {
            let path = format!("/xl/charts/chartEx{}.xml", entry.global_idx);
            if !content_types.has_override(&path) {
                content_types.add_chart_ex(entry.global_idx);
            }
        }
    }
    // Chart auxiliary file content types (style, colors).
    if let Some(ctx) = round_trip_ctx {
        for sheet_rt in &ctx.sheets {
            for aux in &sheet_rt.chart_auxiliary_data {
                for aux_file in &aux.auxiliary_files {
                    let abs_path = if aux_file.path.starts_with('/') {
                        aux_file.path.clone()
                    } else {
                        format!("/{}", aux_file.path)
                    };
                    if content_types.has_override(&abs_path) {
                        continue;
                    }
                    if aux_file.path.contains("style") {
                        content_types.add_chart_style(&aux_file.path);
                    } else if aux_file.path.contains("colors") || aux_file.path.contains("color") {
                        content_types.add_chart_color_style(&aux_file.path);
                    }
                }
            }
        }
    }
    // ChartEx auxiliary file content types (style, colors).
    if let Some(ctx) = round_trip_ctx {
        for sheet_rt in &ctx.sheets {
            for aux in &sheet_rt.chart_ex_auxiliary_data {
                for aux_file in &aux.auxiliary_files {
                    let abs_path = if aux_file.path.starts_with('/') {
                        aux_file.path.clone()
                    } else {
                        format!("/{}", aux_file.path)
                    };
                    if content_types.has_override(&abs_path) {
                        continue;
                    }
                    if aux_file.path.contains("style") {
                        content_types.add_chart_style(&aux_file.path);
                    } else if aux_file.path.contains("colors") || aux_file.path.contains("color") {
                        content_types.add_chart_color_style(&aux_file.path);
                    }
                }
            }
        }
    }
    // Image content types (must be registered BEFORE to_xml()).
    for (zip_path, _) in &all_image_blobs {
        let ext = zip_path.rsplit('.').next().unwrap_or("png").to_lowercase();
        match ext.as_str() {
            "png" => {
                content_types.add_default("png", "image/png");
            }
            "jpg" | "jpeg" => {
                content_types.add_default("jpeg", "image/jpeg");
            }
            "gif" => {
                content_types.add_default("gif", "image/gif");
            }
            "bmp" => {
                content_types.add_default("bmp", "image/bmp");
            }
            "tiff" | "tif" => {
                content_types.add_default("tiff", "image/tiff");
            }
            "emf" => {
                content_types.add_default("emf", "image/x-emf");
            }
            "wmf" => {
                content_types.add_default("wmf", "image/x-wmf");
            }
            _ => {
                content_types.add_default(&ext, &format!("image/{}", ext));
            }
        }
    }
    // Web extension content types (skip if already replayed from RT overrides)
    let has_web_extensions = round_trip_ctx
        .map(|ctx| !ctx.web_extension_parts.is_empty())
        .unwrap_or(false);
    if has_web_extensions && !used_rt_overrides {
        if let Some(ctx) = round_trip_ctx {
            for part in &ctx.web_extension_parts {
                if part.path.ends_with("taskpanes.xml") {
                    content_types.add_override(
                        &format!("/{}", part.path),
                        crate::domain::web_extensions::read::CT_WEB_EXTENSION_TASKPANES,
                    );
                } else if part.path.ends_with(".xml") && !part.path.contains("_rels/") {
                    content_types.add_override(
                        &format!("/{}", part.path),
                        crate::domain::web_extensions::read::CT_WEB_EXTENSION,
                    );
                }
            }
        }
    }
    // CustomXml content types (skip if already replayed from RT overrides)
    let has_custom_xml = round_trip_ctx
        .map(|ctx| !ctx.custom_xml_parts.is_empty())
        .unwrap_or(false);
    if has_custom_xml && !used_rt_overrides {
        if let Some(ctx) = round_trip_ctx {
            for part in &ctx.custom_xml_parts {
                if part.path.contains("itemProps")
                    && part.path.ends_with(".xml")
                    && !part.path.contains("_rels/")
                {
                    content_types.add_override(
                        &format!("/{}", part.path),
                        "application/vnd.openxmlformats-officedocument.customXmlProperties+xml",
                    );
                }
            }
        }
    }
    // External link content types (skip if already replayed from RT overrides)
    let has_external_links = !external_link_exports.is_empty();
    if has_external_links && !used_rt_overrides {
        for (_, part_name) in &external_link_exports {
            content_types.add_override(
                &format!("/{}", external_link_zip_path(part_name)),
                crate::domain::external::write::CT_EXTERNAL_LINK,
            );
        }
    }
    let content_types_xml = content_types.to_xml();

    let root_rels = if let Some(ctx) = round_trip_ctx {
        if !ctx.root_relationships.is_empty() {
            use ooxml_types::shared::OpcRelationship as OoOpc;
            let opc_rels: Vec<OoOpc> = ctx
                .root_relationships
                .iter()
                .map(|r| OoOpc {
                    id: r.id.clone(),
                    rel_type: r.rel_type.clone(),
                    target: r.target.clone(),
                    target_mode: r.target_mode.clone(),
                })
                .collect();
            super::RelationshipManager::from_original(&opc_rels)
        } else {
            let mut rels = create_root_rels_full_with_custom(
                "xl/workbook.xml",
                has_doc_props,
                has_doc_props,
                has_custom_props,
            );
            if has_web_extensions {
                rels.add(
                    crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES,
                    "/xl/webextensions/taskpanes.xml",
                );
            }
            rels
        }
    } else {
        let mut rels = create_root_rels_full_with_custom(
            "xl/workbook.xml",
            has_doc_props,
            has_doc_props,
            has_custom_props,
        );
        if has_web_extensions {
            rels.add(
                crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES,
                "/xl/webextensions/taskpanes.xml",
            );
        }
        rels
    };
    let root_rels_xml = root_rels.to_xml();

    // Build workbook relationships (xl/_rels/workbook.xml.rels).
    //
    // When round-trip context has original rels AND the sheet count hasn't changed,
    // replay the original relationships with their original IDs for fidelity.
    // Otherwise, generate fresh sequential rIds.
    let using_original_wb_rels = round_trip_ctx
        .map(|ctx| {
            !ctx.workbook_relationships.is_empty()
                && !ctx.sheet_workbook_r_ids.is_empty()
                && ctx.sheet_workbook_r_ids.len() == output.sheets.len()
        })
        .unwrap_or(false);

    let mut workbook_rels = if using_original_wb_rels {
        let ctx = round_trip_ctx.unwrap();
        use ooxml_types::shared::OpcRelationship as OoOpc;
        let opc_rels: Vec<OoOpc> = ctx
            .workbook_relationships
            .iter()
            .filter(|r| {
                pivot_package::keep_workbook_relationship(&pivot_data, r)
                    && r.rel_type != super::REL_CALC_CHAIN
            })
            .map(|r| OoOpc {
                id: r.id.clone(),
                rel_type: r.rel_type.clone(),
                target: r.target.clone(),
                target_mode: r.target_mode.clone(),
            })
            .collect();
        super::RelationshipManager::from_original(&opc_rels)
    } else {
        let mut rels = create_workbook_rels(
            output.sheets.len(),
            true,
            has_theme,
            !shared_strings.is_empty(),
        );
        if metadata_xml.is_some() {
            rels.add(super::REL_METADATA, "metadata.xml");
        }
        // Add customXml relationships
        if has_custom_xml {
            if let Some(ctx) = round_trip_ctx {
                for part in &ctx.custom_xml_parts {
                    if part.path.starts_with("customXml/item")
                        && part.path.ends_with(".xml")
                        && !part.path.contains("itemProps")
                        && !part.path.contains("_rels/")
                    {
                        rels.add(
                            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
                            &format!("../{}", part.path),
                        );
                    }
                }
            }
        }
        // Add external link relationships
        if has_external_links {
            for (link_def, part_name) in &external_link_exports {
                if let Some(imported) = &link_def.imported_identity {
                    if rels.get_by_id(&imported.workbook_rel_id).is_none() {
                        rels.add_with_id(
                            &imported.workbook_rel_id,
                            super::REL_EXTERNAL_LINK,
                            part_name,
                        );
                    }
                } else if rels.find_by_target(part_name).is_none() {
                    rels.add(super::REL_EXTERNAL_LINK, part_name);
                }
            }
        }
        // Copy over unmanaged relationship types from original context.
        if let Some(ctx) = round_trip_ctx {
            const MANAGED_TYPES: &[&str] = &[
                super::REL_WORKSHEET,
                super::REL_STYLES,
                super::REL_THEME,
                super::REL_SHARED_STRINGS,
                super::REL_METADATA,
                super::REL_EXTERNAL_LINK,
                super::REL_PIVOT_CACHE,
                super::REL_PERSON,
                super::REL_CALC_CHAIN,
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
            ];
            for orig_rel in &ctx.workbook_relationships {
                if !MANAGED_TYPES.contains(&orig_rel.rel_type.as_str()) {
                    rels.add_with_id(&orig_rel.id, &orig_rel.rel_type, &orig_rel.target);
                }
            }
        }
        rels
    };

    // Build persons.xml if we have person data (Excel can store persons
    // without threaded comments; gate only on persons being present).
    // Fall back to raw_persons_xml from RoundTripContext for lossless round-tripping
    // (preserves empty personList elements that the domain model doesn't capture).
    let persons_xml: Option<Vec<u8>> = if !output.persons.is_empty() {
        let xml = crate::domain::comments::write::persons_xml_from_domain(&output.persons);
        if !workbook_rels.has_rel_type(REL_PERSON) {
            workbook_rels.add(REL_PERSON, "persons/person.xml");
        }
        Some(xml)
    } else if let Some(raw) = round_trip_ctx.and_then(|ctx| ctx.raw_persons_xml.clone()) {
        if !workbook_rels.has_rel_type(REL_PERSON) {
            workbook_rels.add(REL_PERSON, "persons/person.xml");
        }
        Some(raw)
    } else {
        None
    };

    // Pivot cache workbook rels + pivotCaches XML for workbook.xml.
    // Clean imported cache entries come from the typed package sidecar and keep
    // their original relationship IDs/targets; generated entries are appended.
    let mut pivot_cache_xml_entries: Vec<(u32, String)> = Vec::new();
    for entry in &pivot_data.preserved_workbook_cache_entries {
        if workbook_rels.get_by_id(&entry.relationship_id).is_none() {
            if let Some(existing) = workbook_rels.find_by_target(&entry.relationship_target) {
                pivot_cache_xml_entries.push((entry.cache_id, existing));
                continue;
            }
            workbook_rels.add_with_id(
                &entry.relationship_id,
                REL_PIVOT_CACHE,
                &entry.relationship_target,
            );
        }
        pivot_cache_xml_entries.push((entry.cache_id, entry.relationship_id.clone()));
    }
    for entry in &pivot_data.pivot_cache_entries {
        let target = format!("pivotCache/pivotCacheDefinition{}.xml", entry.global_idx);
        // When using RT rels, the pivot cache rel may already be present — find its rId.
        let r_id = if let Some(existing) = workbook_rels
            .relationships()
            .iter()
            .find(|r| r.target == target)
        {
            existing.id.clone()
        } else {
            workbook_rels.add(REL_PIVOT_CACHE, &target)
        };
        pivot_cache_xml_entries.push((entry.cache_id, r_id));
    }
    if !pivot_cache_xml_entries.is_empty() {
        let pivot_caches_xml = pivot_writer::build_pivot_caches_xml(&pivot_cache_xml_entries);
        workbook_writer.set_pivot_caches_xml(pivot_caches_xml);
    }

    if has_external_links {
        let external_reference_r_ids: Vec<String> = external_link_exports
            .iter()
            .filter_map(|(link, part_name)| {
                link.imported_identity
                    .as_ref()
                    .map(|identity| identity.workbook_rel_id.clone())
                    .or_else(|| {
                        workbook_rels
                            .relationships()
                            .iter()
                            .find(|rel| {
                                rel.rel_type == super::REL_EXTERNAL_LINK && rel.target == *part_name
                            })
                            .map(|rel| rel.id.clone())
                    })
            })
            .collect();
        workbook_writer.set_external_reference_r_ids(external_reference_r_ids);
    }

    let workbook_rels_xml = workbook_rels.to_xml();
    let workbook_xml = workbook_writer.to_xml();

    // ── 7. Assemble ZIP ─────────────────────────────────────────────────
    let mut zip = ZipWriter::with_compression(CompressionMethod::Deflate(1));

    zip.add_file("[Content_Types].xml", content_types_xml);
    zip.add_file("_rels/.rels", root_rels_xml);
    zip.add_file("xl/workbook.xml", workbook_xml);
    zip.add_file("xl/_rels/workbook.xml.rels", workbook_rels_xml);
    zip.add_file("xl/styles.xml", styles_xml);

    if !shared_strings.is_empty() {
        zip.add_file("xl/sharedStrings.xml", shared_strings_xml);
    }

    // Theme
    if let Some(ref theme) = theme_xml {
        zip.add_file("xl/theme/theme1.xml", theme.clone());
    }

    // Document Properties
    if let Some(ref core) = core_props_xml {
        zip.add_file("docProps/core.xml", core.clone());
    }
    if let Some(ref app) = app_props_xml {
        zip.add_file("docProps/app.xml", app.clone());
    }
    if let Some(ref custom) = custom_props_xml {
        zip.add_file("docProps/custom.xml", custom.clone());
    }

    // Metadata passthrough
    if let Some(ref meta) = metadata_xml {
        zip.add_file("xl/metadata.xml", meta.clone());
    }
    // docMetadata/LabelInfo.xml passthrough
    if let Some(ctx) = round_trip_ctx {
        if let Some(ref label_info) = ctx.doc_metadata_label_info {
            zip.add_file("docMetadata/LabelInfo.xml", label_info.clone());
        }
    }

    // Persons (threaded comments author list)
    if let Some(ref persons) = persons_xml {
        zip.add_file("xl/persons/person.xml", persons.clone());
    }

    // External links — serialize from domain types
    for (link, part_name) in &external_link_exports {
        let xml = crate::domain::external::write::write_external_link_xml(link);
        let zip_path = external_link_zip_path(part_name);
        zip.add_file(&zip_path, xml);
        // Write rels if the link has file paths
        if let Some(rels) = crate::domain::external::write::write_external_link_rels(link) {
            zip.add_file(&external_link_rels_path(&zip_path), rels);
        }
    }

    // Web extension parts passthrough
    if let Some(ctx) = round_trip_ctx {
        for part in &ctx.web_extension_parts {
            zip.add_file(&part.path, part.data.clone());
        }
    }

    // CustomXml parts passthrough
    if let Some(ctx) = round_trip_ctx {
        for part in &ctx.custom_xml_parts {
            zip.add_file(&part.path, part.data.clone());
        }
    }

    // Binary blob passthrough (printerSettings, vbaProject, richData, media, etc.)
    if let Some(ctx) = round_trip_ctx {
        for part in &ctx.binary_blobs {
            if !pivot_package::keep_binary_blob(&pivot_data, &part.path) {
                continue;
            }
            zip.add_file(&part.path, part.data.clone());
        }
    }

    // Pre-generate all sheet XMLs (parallel when the "parallel" feature is enabled).
    #[cfg(feature = "parallel")]
    let sheet_xmls: Vec<Vec<u8>> = {
        use rayon::prelude::*;
        sheet_writers
            .into_par_iter()
            .map(|sw| sw.to_xml())
            .collect()
    };
    #[cfg(not(feature = "parallel"))]
    let sheet_xmls: Vec<Vec<u8>> = sheet_writers.into_iter().map(|sw| sw.to_xml()).collect();

    let mut zip_vml_idx: usize = 0;
    let mut zip_comment_idx: usize = 0;
    let mut zip_ctrl_prop_idx: usize = 0;
    let mut zip_tc_idx: usize = 0;
    for (idx, sheet_xml) in sheet_xmls.into_iter().enumerate() {
        let sheet_num = idx + 1;
        zip.add_file(&format!("xl/worksheets/sheet{}.xml", sheet_num), sheet_xml);

        // Sheet rels
        if let Some(ref rels_xml) = sheet_rels_data[idx] {
            zip.add_file(
                &format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num),
                rels_xml.clone(),
            );
        }

        // Comment XML + VML
        if let Some((ref comments_xml, ref vml_xml)) = sheet_extras[idx].comments {
            zip_vml_idx += 1;
            zip_comment_idx += 1;
            // Use original paths from round-trip context when available
            let comment_path = sheet_extras[idx]
                .original_comment_path
                .clone()
                .unwrap_or_else(|| format!("xl/comments{}.xml", zip_comment_idx));
            let vml_path = sheet_extras[idx]
                .original_vml_path
                .clone()
                .unwrap_or_else(|| format!("xl/drawings/vmlDrawing{}.vml", zip_vml_idx));
            zip.add_file(&comment_path, comments_xml.clone());
            zip.add_file(&vml_path, vml_xml.clone());

            // Write comment VML .rels if available from round-trip context
            if let Some(ctx) = round_trip_ctx {
                if let Some(sheet_rt) = ctx.sheets.get(idx) {
                    if let Some(comment_vml_path) = &sheet_extras[idx].original_vml_path {
                        for vml_part in &sheet_rt.raw_vml_drawings {
                            if &vml_part.path == comment_vml_path {
                                if let Some(ref rels) = vml_part.rels {
                                    zip.add_file(&rels.path, rels.data.clone());
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Header/footer image VML — generated from domain types
        if let Some(ref hf) = sheet_extras[idx].hf_vml {
            let vml_xml = crate::domain::print::hf_images::write_hf_images_vml(
                &hf.images,
                &hf.idmap_data,
                hf.spid_base,
            );
            zip.add_file(&hf.vml_path, vml_xml);

            // Generate .rels from parsed image targets
            if let Some(ref rels_path) = hf.rels_path {
                if !hf.image_targets.is_empty() {
                    let targets: Vec<(&str, &str)> = hf
                        .image_targets
                        .iter()
                        .map(|(id, target)| (id.as_str(), target.as_str()))
                        .collect();
                    let rels_xml = crate::domain::print::hf_images::write_hf_images_vml_rels(
                        &hf.images, &targets,
                    );
                    zip.add_file(rels_path, rels_xml);
                }
            }
        }

        // Form controls: ctrlProp XML files and VML drawing
        if !sheet_extras[idx].form_controls.is_empty() {
            let controls = &sheet_extras[idx].form_controls;
            let controls_writer = ControlsWriter::new(controls.clone());
            let base_shape_id: u32 = 1025;

            // Write ctrlProp XML files
            for i in 0..controls.len() {
                zip_ctrl_prop_idx += 1;
                let ctrl_prop_xml = controls_writer.write_ctrl_prop(i);
                zip.add_file(
                    &format!("xl/ctrlProps/ctrlProp{}.xml", zip_ctrl_prop_idx),
                    ctrl_prop_xml,
                );
            }

            // Write VML drawing for form controls (separate from comment VML)
            if sheet_extras[idx].comments.is_none() {
                if let Some(ctx) = round_trip_ctx
                    && let Some(sheet_rt) = ctx.sheets.get(idx)
                    && let Some(original_vml_path) = &sheet_extras[idx].original_vml_path
                    && let Some(vml_part) = sheet_rt
                        .raw_vml_drawings
                        .iter()
                        .find(|part| &part.path == original_vml_path)
                {
                    if let Some(n) = extract_vml_drawing_number(&vml_part.path) {
                        zip_vml_idx = zip_vml_idx.max(n);
                    }
                    zip.add_file(&vml_part.path, vml_part.data.clone());
                    if let Some(ref rels) = vml_part.rels {
                        zip.add_file(&rels.path, rels.data.clone());
                    }
                } else {
                    zip_vml_idx += 1;

                    let vml_xml = controls_writer.write_vml_form_controls(base_shape_id);

                    zip.add_file(
                        &format!("xl/drawings/vmlDrawing{}.vml", zip_vml_idx),
                        vml_xml,
                    );
                }
            }
        }

        // Threaded comment XML
        if let Some(ref tc_xml) = sheet_extras[idx].threaded_comments {
            zip_tc_idx += 1;
            zip.add_file(
                &format!("xl/threadedComments/threadedComment{}.xml", zip_tc_idx),
                tc_xml.clone(),
            );
        }
    }

    // Table XML files and their relationship files
    {
        let mut table_global = 0usize;
        for extras in &sheet_extras {
            let base_global = table_global;
            for table_xml in &extras.tables {
                table_global += 1;
                zip.add_file(
                    &format!("xl/tables/table{}.xml", table_global),
                    table_xml.clone(),
                );
            }
            // Write table _rels files (e.g., xl/tables/_rels/table1.xml.rels)
            for (local_idx, rels_data) in &extras.table_rels {
                let global_idx = base_global + local_idx + 1;
                zip.add_file(
                    &format!("xl/tables/_rels/table{}.xml.rels", global_idx),
                    rels_data.clone(),
                );
            }
        }
    }

    // Pivot table and cache XML files
    // Build a cache_id → cache global_idx lookup for pivot table rels.
    let cache_id_to_global: std::collections::HashMap<u32, usize> = pivot_data
        .pivot_cache_entries
        .iter()
        .map(|e| (e.cache_id, e.global_idx))
        .collect();
    for entry in &pivot_data.pivot_table_entries {
        zip.add_file(
            &format!("xl/pivotTables/pivotTable{}.xml", entry.global_idx),
            entry.xml.clone(),
        );
        // Pivot table rels (table → cache definition).
        if let Some(&cache_global_idx) = cache_id_to_global.get(&entry.cache_id) {
            let pt_rels_xml = pivot_writer::build_pivot_table_rels_xml(cache_global_idx);
            zip.add_file(
                &format!(
                    "xl/pivotTables/_rels/pivotTable{}.xml.rels",
                    entry.global_idx
                ),
                pt_rels_xml,
            );
        }
    }
    for entry in &pivot_data.pivot_cache_entries {
        zip.add_file(
            &format!("xl/pivotCache/pivotCacheDefinition{}.xml", entry.global_idx),
            entry.definition_xml.clone(),
        );
        zip.add_file(
            &format!("xl/pivotCache/pivotCacheRecords{}.xml", entry.global_idx),
            entry.records_xml.clone(),
        );
        // Pivot cache definition rels (definition → records relationship).
        let cache_rels_xml = pivot_writer::build_pivot_cache_rels_xml(&format!(
            "pivotCacheRecords{}.xml",
            entry.global_idx
        ));
        zip.add_file(
            &format!(
                "xl/pivotCache/_rels/pivotCacheDefinition{}.xml.rels",
                entry.global_idx
            ),
            cache_rels_xml,
        );
    }

    // Chart XML files + auxiliary files (style, colors, .rels)
    {
        for (sheet_idx, chart_entries) in all_chart_entries.iter().enumerate() {
            let sheet_rt = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx));

            for (local_idx, entry) in chart_entries.iter().enumerate() {
                zip.add_file(
                    &format!("xl/charts/chart{}.xml", entry.global_idx),
                    entry.xml.clone(),
                );

                // Write chart auxiliary files (style XML, colors XML, .rels) from round-trip context.
                if let Some(srt) = sheet_rt {
                    if let Some(aux) = srt.chart_auxiliary_data.get(local_idx) {
                        // Write chart .rels
                        if let Some(ref rels_data) = aux.chart_rels {
                            let rels_path =
                                format!("xl/charts/_rels/chart{}.xml.rels", entry.global_idx);
                            zip.add_file(&rels_path, rels_data.clone());
                        }

                        // Write auxiliary files (style, colors XML) preserving their original paths.
                        for aux_file in &aux.auxiliary_files {
                            zip.add_file(&aux_file.path, aux_file.data.clone());
                        }
                    }
                }
            }
        }
    }

    // ChartEx XML files + auxiliary files (style, colors, .rels)
    {
        for (sheet_idx, chart_ex_entries) in all_chart_ex_entries.iter().enumerate() {
            let sheet_rt = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx));

            for (local_idx, entry) in chart_ex_entries.iter().enumerate() {
                zip.add_file(
                    &format!("xl/charts/chartEx{}.xml", entry.global_idx),
                    entry.xml.clone(),
                );

                // Write ChartEx auxiliary files from round-trip context.
                if let Some(srt) = sheet_rt {
                    if let Some(aux) = srt.chart_ex_auxiliary_data.get(local_idx) {
                        if let Some(ref rels_data) = aux.chart_rels {
                            let rels_path =
                                format!("xl/charts/_rels/chartEx{}.xml.rels", entry.global_idx);
                            zip.add_file(&rels_path, rels_data.clone());
                        }
                        for aux_file in &aux.auxiliary_files {
                            zip.add_file(&aux_file.path, aux_file.data.clone());
                        }
                    }
                }
            }
        }
    }

    // Image blobs (from floating objects) — content types already registered above.
    for (zip_path, image_bytes) in all_image_blobs {
        zip.add_file(&zip_path, image_bytes);
    }

    // Drawing XML files and their .rels
    {
        let mut zip_drawing_idx: usize = 0;
        for (idx, _) in output.sheets.iter().enumerate() {
            if drawing_xml_data[idx].is_none() {
                continue;
            }
            zip_drawing_idx += 1;

            // Use original path from round-trip context when available
            let drawing_path = sheet_extras[idx]
                .original_drawing_path
                .clone()
                .unwrap_or_else(|| format!("xl/drawings/drawing{}.xml", zip_drawing_idx));
            // Derive the .rels path from the drawing path
            let drawing_filename = drawing_path.rsplit('/').next().unwrap_or("drawing.xml");
            let drawing_rels_path = format!("xl/drawings/_rels/{}.rels", drawing_filename);

            if let Some(ref drawing_xml) = drawing_xml_data[idx] {
                zip.add_file(&drawing_path, drawing_xml.clone());
            }

            if let Some(ref drawing_rels_xml) = drawing_rels_data[idx] {
                zip.add_file(&drawing_rels_path, drawing_rels_xml.clone());
            }
        }
    }

    let xlsx_bytes = zip.finish().map_err(WriteError::from)?;
    let archive = crate::XlsxArchive::new(&xlsx_bytes)
        .map_err(|e| WriteError::PackageIntegrity(format!("exported ZIP is invalid: {e}")))?;
    if let Err(errors) =
        crate::infra::package_integrity::validate_archive_package_integrity(&archive)
    {
        let message = errors
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(WriteError::PackageIntegrity(message));
    }
    Ok(xlsx_bytes)
}

use sheet_builder::{apply_outline_groups_rows_only, build_sheet};
use styles::{append_palette_to_lossless_styles, build_styles, build_styles_from_stylesheet};

/// Extract the table number from a table rels path.
/// e.g., "xl/tables/_rels/table1.xml.rels" → Some(1)
fn extract_table_number_from_rels_path(path: &str) -> Option<u32> {
    let filename = path.rsplit('/').next()?;
    // filename is like "table1.xml.rels"
    let stripped = filename.strip_prefix("table")?;
    let dot_pos = stripped.find('.')?;
    stripped[..dot_pos].parse().ok()
}

use crate::infra::opc::opc_target_to_zip_path;

fn extract_vml_drawing_number(path: &str) -> Option<usize> {
    let file = path.rsplit('/').next()?;
    file.strip_prefix("vmlDrawing")?
        .strip_suffix(".vml")?
        .parse()
        .ok()
}

/// Convert domain-types `FormControl` items into parser-internal `FormControl`
/// items for the controls writer.
///
/// The domain FormControl stores control type, anchor, and a JSON properties blob.
/// This reverses the conversion done in `to_parse_output::features::convert_form_controls`.
/// Convert unified `FloatingObject` items with `FormControl` data into writer `FormControl`.
fn convert_unified_form_controls(
    controls: &[&domain_types::domain::floating_object::FloatingObject],
) -> Vec<crate::domain::controls::read::FormControl> {
    use crate::domain::controls::read::{
        AnchorSource, CheckState, ControlAnchor, FormControl, FormControlProperties,
        FormControlType, VmlShapeProps,
    };
    use std::collections::HashMap;

    controls
        .iter()
        .filter_map(|fo| {
            let fc_data = match &fo.data {
                domain_types::domain::floating_object::FloatingObjectData::FormControl(d) => d,
                _ => return None,
            };
            // Filter out "Note" controls
            if fc_data.control_type == "Note" {
                return None;
            }

            let object_type = FormControlType::from_str(&fc_data.control_type);
            let props = fc_data.ooxml.as_ref();
            let default_props =
                domain_types::domain::floating_object::FormControlOoxmlProps::default();
            let p = props.unwrap_or(&default_props);
            let anchor_ref = &fo.common.anchor;

            let anchor_source = match p.anchor_source.as_str() {
                "Modern" => AnchorSource::Modern,
                _ => AnchorSource::Vml,
            };

            let anchor = ControlAnchor {
                from_col: anchor_ref.anchor_col,
                from_col_offset: anchor_ref.anchor_col_offset,
                from_row: anchor_ref.anchor_row,
                from_row_offset: anchor_ref.anchor_row_offset,
                to_col: anchor_ref.end_col.unwrap_or(anchor_ref.anchor_col + 2),
                to_col_offset: anchor_ref.end_col_offset.unwrap_or(0),
                to_row: anchor_ref.end_row.unwrap_or(anchor_ref.anchor_row + 2),
                to_row_offset: anchor_ref.end_row_offset.unwrap_or(0),
                anchor_source,
            };

            let checked = p.checked.as_deref().map(CheckState::from_str);

            let vml_extras: HashMap<String, String> = p.vml_extras.clone();

            let items: Vec<String> = p.items.clone();

            let name_opt = if fo.common.name.is_empty() {
                None
            } else {
                Some(fo.common.name.clone())
            };

            let properties = FormControlProperties {
                name: name_opt,
                alt_text: p.alt_text.clone(),
                linked_cell: fc_data.cell_link.clone(),
                input_range: fc_data.input_range.clone(),
                fmla_group: p.fmla_group.clone(),
                fmla_txbx: p.fmla_txbx.clone(),
                checked,
                val: p.val,
                sel: p.sel,
                min_value: p.min,
                max_value: p.max,
                increment: p.inc,
                page_increment: p.page,
                drop_lines: p.drop_lines,
                sel_type: p.sel_type.clone(),
                drop_style: p.drop_style.clone(),
                macro_name: p.macro_name.clone(),
                colored: p.colored,
                dx: p.dx,
                horiz: p.horiz,
                first_button: p.first_button,
                no_three_d: p.no_three_d,
                no_three_d2: p.no_three_d2,
                lock_text: p.lock_text,
                multi_sel: p.multi_sel.clone(),
                text_h_align: p.text_h_align.clone(),
                text_v_align: p.text_v_align.clone(),
                edit_val: p.edit_val.clone(),
                multi_line: p.multi_line,
                vertical_bar: p.vertical_bar,
                password_edit: p.password_edit,
                just_last_x: p.just_last_x,
                width_min: p.width_min,
                items,
                vml_extras,
            };

            let shape_id = if p.shape_id != 0 {
                Some(p.shape_id)
            } else {
                None
            };

            let control_pr_attrs: HashMap<String, String> = p.control_pr_attrs.clone();

            // Read the typed VmlShapeProps directly (typed OOXML preservation).
            let vml_shape: VmlShapeProps = p.vml_shape.clone().unwrap_or_default();

            Some(FormControl {
                object_type,
                anchor,
                properties,
                shape_id,
                control_pr_attrs,
                move_with_cells: p.move_with_cells,
                size_with_cells: p.size_with_cells,
                vml_shape,
            })
        })
        .collect()
}

fn external_link_part_name(link: &domain_types::domain::external_link::ExternalLink) -> String {
    link.imported_identity
        .as_ref()
        .map(|identity| identity.part_name.clone())
        .unwrap_or_else(|| format!("externalLinks/externalLink{}.xml", link.id))
}

fn external_link_zip_path(part_name: &str) -> String {
    let trimmed = part_name.trim_start_matches('/');
    if trimmed.starts_with("xl/") {
        trimmed.to_string()
    } else {
        format!("xl/{}", trimmed)
    }
}

fn external_link_rels_path(zip_path: &str) -> String {
    let file_name = zip_path.rsplit('/').next().unwrap_or(zip_path);
    format!("xl/externalLinks/_rels/{}.rels", file_name)
}

#[cfg(test)]
mod tests;
