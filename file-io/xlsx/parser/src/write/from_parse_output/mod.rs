//! Unified XLSX writer that consumes `ParseOutput` from domain-types.
//!
//! Round-trip context supplies identity hints and clean opaque package data.
//! Modeled workbook state is generated from domain types.
//!
//! UTF-8 boundary guard: the two `&s[..n]` slices in this file truncate
//! ASCII-only identifier strings (relationship IDs, hyperlink target
//! fragments) at ASCII-delimiter byte offsets. Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

mod doc_props;
mod external_links;
mod metadata;
mod package_authority;
mod pivot_package;
mod sheet_builder;
mod sheet_preservation;
mod styles;

use domain_types::Hyperlink;
use domain_types::ParseOutput;
use domain_types::RoundTripContext;
// ChartSpec / AnchorPosition are re-exported from domain_types::domain::chart via domain_types::*
// but we don't need them as standalone imports — they're accessed via sheet_data.charts.

use super::write_error::WriteError;
use super::{CompressionMethod, SharedStringsWriter, WorkbookWriter, ZipWriter};
use crate::domain::charts::chart_ex_write::serialize_chart_ex_space;
use crate::domain::charts::write_canonical::serialize_chart_space;
use crate::domain::content_types::write::ContentTypesManager;
use crate::domain::drawings::write::{
    CellAnchor, ChartExRef, ChartRef, ClientData, DrawingAnchor, DrawingObject, DrawingWriter,
    Extent, OneCellAnchor, TwoCellAnchor,
};
use crate::write::pivot_writer;
use crate::write::relationships::{RelationshipManager, create_sheet_rels};
use crate::write::{
    ControlsWriter, DefinedNameDef, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CTRL_PROP,
    REL_DRAWING, REL_HYPERLINK, REL_PIVOT_CACHE, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_TABLE,
    REL_THREADED_COMMENT, REL_VML_DRAWING,
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

struct WorksheetCommentsGraphEntry {
    sheet_idx: usize,
    comments_path: String,
    comments_target: String,
    comments_relationship_id_hint: Option<String>,
    vml_path: String,
    vml_target: String,
    vml_relationship_id_hint: Option<String>,
}

struct WorksheetHyperlinkGraphEntry {
    sheet_idx: usize,
    hyperlink_idx: usize,
    target: String,
    relationship_id_hint: String,
}

struct WorksheetControlPropertyGraphEntry {
    sheet_idx: usize,
    global_idx: usize,
    target: String,
    relationship_id_hint: String,
}

struct WorksheetHeaderFooterVmlGraphEntry {
    sheet_idx: usize,
    path: String,
    target: String,
    relationship_id_hint: Option<String>,
}

struct WorksheetFormControlVmlGraphEntry {
    sheet_idx: usize,
    path: String,
    target: String,
    relationship_id_hint: Option<String>,
}

struct WorksheetDrawingGraphEntry {
    sheet_idx: usize,
    path: String,
    target: String,
    relationship_id_hint: Option<String>,
}

struct DrawingRelationshipGraphEntry {
    drawing_path: String,
    rel_type: String,
    target_path: String,
    relationship_id_hint: String,
}

struct ChartAuxiliaryRelationshipGraphEntry {
    chart_path: String,
    rel_type: String,
    target_path: String,
    relationship_id_hint: String,
}

struct WorksheetPrinterSettingsGraphEntry {
    sheet_idx: usize,
    path: String,
    target: String,
    relationship_id_hint: String,
}

struct WorksheetThreadedCommentsGraphEntry {
    sheet_idx: usize,
    path: String,
    target: String,
    relationship_id_hint: Option<String>,
}

fn should_reconstruct_chart_space(chart_spec: &domain_types::ChartSpec) -> bool {
    if has_modeled_chart_space_state(chart_spec) {
        return true;
    }

    if matches!(
        chart_spec.definition,
        Some(domain_types::ChartDefinition::Chart(_))
    ) {
        return false;
    }

    chart_spec.rt.is_some()
}

fn has_modeled_chart_space_state(chart_spec: &domain_types::ChartSpec) -> bool {
    chart_spec
        .title
        .as_deref()
        .is_some_and(|title| !title.is_empty())
        || !chart_spec.series.is_empty()
        || chart_spec
            .data_range
            .as_deref()
            .is_some_and(|range| !range.is_empty())
        || chart_spec.axes.is_some()
        || chart_spec.legend.is_some()
        || chart_spec.data_labels.is_some()
        || chart_spec.data_table.is_some()
        || chart_spec.style.is_some()
        || chart_spec.rounded_corners.is_some()
        || chart_spec.auto_title_deleted.is_some()
        || chart_spec.show_data_labels_over_max.is_some()
        || chart_spec.chart_format.is_some()
        || chart_spec.plot_format.is_some()
        || chart_spec.title_format.is_some()
        || chart_spec.title_rich_text.is_some()
        || chart_spec.title_formula.is_some()
        || chart_spec.display_blanks_as.is_some()
        || chart_spec.plot_visible_only.is_some()
        || chart_spec.sub_type.is_some()
        || chart_spec.gap_width.is_some()
        || chart_spec.overlap.is_some()
        || chart_spec.doughnut_hole_size.is_some()
        || chart_spec.first_slice_angle.is_some()
        || chart_spec.bubble_scale.is_some()
        || chart_spec.split_type.is_some()
        || chart_spec.split_value.is_some()
        || chart_spec.view_3d.is_some()
        || chart_spec.floor_format.is_some()
        || chart_spec.side_wall_format.is_some()
        || chart_spec.back_wall_format.is_some()
}

fn chart_allows_auxiliary_replay(chart_spec: &domain_types::ChartSpec) -> bool {
    !should_reconstruct_chart_space(chart_spec)
        && (chart_spec.preserved_chart_xml.is_some()
            || chart_spec
                .rt
                .as_ref()
                .is_some_and(|rt| !rt.auxiliary_files.is_empty() || rt.chart_rels_bytes.is_some()))
}

fn has_clean_opaque_part(round_trip_ctx: Option<&RoundTripContext>, path: &str) -> bool {
    let Some(ctx) = round_trip_ctx else {
        return false;
    };
    let normalized = path.trim_start_matches('/');
    ctx.opaque_package_subgraphs.iter().any(|subgraph| {
        subgraph.parts.iter().any(|part| {
            part.part.path.trim_start_matches('/') == normalized
                && matches!(
                    part.ownership,
                    domain_types::OpaquePackageOwnership::CleanImported
                        | domain_types::OpaquePackageOwnership::OrphanCleanPackageData
                )
        })
    })
}

fn comments_have_imported_identity(sheet_data: &domain_types::SheetData) -> bool {
    sheet_data.comments.iter().any(|comment| {
        comment.shape_id.is_some() || comment.xr_uid.as_deref().is_some_and(|uid| !uid.is_empty())
    })
}

/// Write an XLSX file from a `ParseOutput`.
///
/// Round-trip context supplies identity hints and clean opaque package data;
/// modeled workbook state is generated from domain types.
pub fn write_xlsx_from_parse_output(
    output: &ParseOutput,
    round_trip_ctx: Option<&RoundTripContext>,
) -> Result<Vec<u8>, WriteError> {
    // ── 1. Build styles ─────────────────────────────────────────────────
    // Use the imported stylesheet only while current modeled objects still
    // reference its raw cellXfs indices. If styles are no longer referenced,
    // regenerate from modeled style state so stale imported style facts do not
    // survive deletion.
    // Track whether we use the lossless stylesheet path. When true, cellXfs
    // are passed through directly and cell style_id values should NOT be offset
    // by +1. When false (lossy palette path), a default is inserted at cellXfs[0]
    // so cell style_id values must be offset by +1.
    let has_style_references = output_references_style_ids(output);
    let has_lossless_stylesheet = has_style_references
        && round_trip_ctx
            .and_then(|ctx| ctx.parsed_stylesheet.as_ref())
            .is_some();

    let styles_writer = if let Some(ctx) = round_trip_ctx {
        if has_style_references && let Some(ref stylesheet) = ctx.parsed_stylesheet {
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
    // Imported shared string entries are non-authoritative per-cell hints. A
    // hint is emitted only when a current cell still references the same
    // original SST index and text; stale raw SST XML and count metadata never
    // override the generated table.
    let mut shared_strings = if let Some(ctx) = round_trip_ctx {
        if !ctx.shared_strings_list.is_empty() {
            let mut sst = SharedStringsWriter::with_capacity(ctx.shared_strings_list.len());
            for (i, s) in ctx.shared_strings_list.iter().enumerate() {
                sst.add_imported_hint(
                    i,
                    s,
                    ctx.shared_strings_rich_runs.get(i).cloned().flatten(),
                    ctx.shared_strings_phonetic_xml.get(i).cloned().flatten(),
                );
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

    // Metadata refs are emitted only with an authoritative metadata part.
    // Raw `xl/metadata.xml` replay is intentionally disabled until the metadata
    // domain has a modeled writer.
    let emit_cell_metadata_refs = false;
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
            emit_cell_metadata_refs,
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
                if let Some(dim) =
                    sheet_preservation::original_dimension_for_export(sheet_data, sheet_rt)
                {
                    sheet_writer.set_dimension_ref(dim.clone());
                }
                sheet_preservation::apply_row_hints_for_export(
                    &mut sheet_writer,
                    sheet_data,
                    sheet_rt,
                );
                if let Some(preserved) =
                    sheet_preservation::preserved_elements_for_export(sheet_data, sheet_rt)
                {
                    sheet_writer.set_preserved_elements(preserved);
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
            let mut ps = ps.clone();
            ps.r_id = None;
            let pw = crate::domain::print::write::print_writer_from_domain(&ps);
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
            sheet_preservation::apply_visible_row_hints_for_export(
                &mut sheet_writer,
                sheet_data,
                sheet_rt,
            );
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
            let xml = crate::domain::sparklines::write::sparklines_xml_from_domain(
                &sheet_data.name,
                &sheet_data.sparklines,
            );
            sheet_writer.set_ext_lst_xml(xml);
        } else {
            if let Some(sheet_rt) = sheet_rt_for_ext {
                if let Some(ext_xml) =
                    sheet_preservation::standalone_ext_lst_for_export(sheet_data, sheet_rt)
                {
                    sheet_writer.set_ext_lst_xml(ext_xml.clone());
                } else if sheet_preservation::empty_ext_lst_for_export(sheet_data, sheet_rt) {
                    sheet_writer.set_ext_lst_xml("<extLst/>".to_string());
                }
            }
        }

        // ── Comments ────────────────────────────────────────────────────
        let comments_data = if !sheet_data.comments.is_empty() {
            let sheet_rt = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx));
            let imported_comment_identity = comments_have_imported_identity(sheet_data);
            let original_authors = sheet_rt
                .map(|rt| rt.comment_authors.as_slice())
                .filter(|authors| imported_comment_identity && !authors.is_empty());
            let root_ns_attrs = sheet_rt
                .map(|rt| rt.comments_root_namespace_attrs.as_slice())
                .filter(|attrs| imported_comment_identity && !attrs.is_empty());
            let (comments_xml, generated_vml_xml) =
                crate::domain::comments::write::comments_from_domain(
                    sheet_num,
                    &sheet_data.comments,
                    original_authors,
                    root_ns_attrs,
                );
            Some((comments_xml, generated_vml_xml))
        } else {
            None
        };

        // ── Threaded Comments ────────────────────────────────────────────
        let threaded_comments =
            crate::domain::comments::write::threaded_comments_xml_from_domain(&sheet_data.comments);

        // ── Tables (per-sheet) ───────────────────────────────────────────
        let mut table_xmls = Vec::new();
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
            // Reconstruct from typed fields when present so modeled chart edits
            // are not overridden by stale preserved ChartSpace XML.
            let chart_xml = if should_reconstruct_chart_space(chart_spec) {
                let chart_space =
                    crate::domain::charts::reconstruct::reconstruct_chart_space(chart_spec);
                serialize_chart_space(&chart_space)
            } else if let Some(raw_xml) = &chart_spec.preserved_chart_xml {
                raw_xml.as_bytes().to_vec()
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
            let original_idx = chart_allows_auxiliary_replay(chart_spec)
                .then(|| {
                    sheet_rt_for_charts
                        .and_then(|srt| srt.chart_auxiliary_data.get(chart_local_idx))
                        .and_then(|aux| aux.original_path.as_ref())
                        .and_then(|path| {
                            // Extract number from "xl/charts/chart{N}.xml"
                            let fname = path.rsplit('/').next()?;
                            let num_str = fname.strip_prefix("chart")?.strip_suffix(".xml")?;
                            num_str.parse::<usize>().ok()
                        })
                })
                .flatten();
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
            let original_idx = chart_allows_auxiliary_replay(chart_spec)
                .then(|| {
                    sheet_rt_for_charts
                        .and_then(|srt| srt.chart_ex_auxiliary_data.get(chart_ex_local_idx))
                        .and_then(|aux| aux.original_path.as_ref())
                        .and_then(|path| {
                            let fname = path.rsplit('/').next()?;
                            let num_str = fname.strip_prefix("chartEx")?.strip_suffix(".xml")?;
                            num_str.parse::<usize>().ok()
                        })
                })
                .flatten();
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
                    // Identify the comment VML path by matching legacyDrawing r:id
                    let comment_vml_path: Option<String> =
                        if comments_have_imported_identity(sheet_data) {
                            sheet_rt.legacy_drawing_r_id.as_ref().and_then(|rid| {
                                sheet_rt
                                    .sheet_opc_rels
                                    .iter()
                                    .find(|r| &r.id == rid && r.rel_type.ends_with("/vmlDrawing"))
                                    .map(|r| opc_target_to_zip_path(&r.target, "xl/worksheets"))
                            })
                        } else {
                            None
                        };
                    // Parse imported header/footer image VML only while the
                    // current modeled sheet still has header/footer images.
                    // Otherwise stale raw VML would resurrect deleted images.
                    let mut hf_vml_parsed: Option<crate::domain::print::hf_images::ParsedHfVml> =
                        None;
                    if !sheet_data.hf_images.is_empty() {
                        for vml_part in &sheet_rt.raw_vml_drawings {
                            if comment_vml_path.as_ref() == Some(&vml_part.path) {
                                continue;
                            }
                            let rels_path = vml_part.rels.as_ref().map(|r| r.path.as_str());
                            let rels_data = vml_part.rels.as_ref().map(|r| r.data.as_slice());
                            if let Some(parsed) =
                                crate::domain::print::hf_images::parse_hf_vml_context(
                                    &vml_part.path,
                                    &vml_part.data,
                                    rels_path,
                                    rels_data,
                                )
                            {
                                hf_vml_parsed = Some(parsed);
                                break; // Only one HF VML per sheet
                            }
                        }
                    }
                    (
                        None,
                        comment_vml_path,
                        hf_vml_parsed,
                        sheet_rt.original_drawing_path.clone(),
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

    // ── Build pivot table and cache data ──────────────────────────────
    let pivot_data = pivot_writer::build_pivot_data(output, round_trip_ctx);

    // ── Build sheet rels and assign r:ids ────────────────────────────────
    // We need to build rels for each sheet and update hyperlink/table r:ids.
    let mut sheet_rels_data: Vec<Option<RelationshipManager>> =
        Vec::with_capacity(output.sheets.len());
    let mut sheet_hyperlink_outputs: Vec<Option<Vec<crate::output::results::HyperlinkOutput>>> =
        vec![None; output.sheets.len()];
    let mut worksheet_hyperlink_relationships: Vec<WorksheetHyperlinkGraphEntry> = Vec::new();
    let mut worksheet_control_property_relationships: Vec<WorksheetControlPropertyGraphEntry> =
        Vec::new();
    let mut worksheet_header_footer_vml_relationships: Vec<WorksheetHeaderFooterVmlGraphEntry> =
        Vec::new();
    let mut worksheet_form_control_vml_relationships: Vec<WorksheetFormControlVmlGraphEntry> =
        Vec::new();
    let mut worksheet_drawing_relationships: Vec<WorksheetDrawingGraphEntry> = Vec::new();
    let mut drawing_relationships: Vec<DrawingRelationshipGraphEntry> = Vec::new();
    let mut chart_auxiliary_relationships: Vec<ChartAuxiliaryRelationshipGraphEntry> = Vec::new();
    let mut worksheet_printer_settings_relationships: Vec<WorksheetPrinterSettingsGraphEntry> =
        Vec::new();
    let mut worksheet_comments_relationships: Vec<WorksheetCommentsGraphEntry> = Vec::new();
    let mut worksheet_threaded_comments_relationships: Vec<WorksheetThreadedCommentsGraphEntry> =
        Vec::new();
    let mut worksheet_table_relationships: Vec<(usize, usize, String)> = Vec::new();
    let mut worksheet_pivot_table_relationships: Vec<(usize, usize, String)> = Vec::new();

    // Per-sheet drawing rels XML (for drawing→chart references).
    let mut drawing_rels_data: Vec<Option<Vec<u8>>> = Vec::with_capacity(output.sheets.len());
    let mut drawing_rels_should_emit: Vec<bool> = Vec::with_capacity(output.sheets.len());

    // Per-sheet drawing XML (the drawingN.xml content).
    let mut drawing_xml_data: Vec<Option<Vec<u8>>> = Vec::with_capacity(output.sheets.len());
    let mut drawing_writer_data: Vec<Option<DrawingWriter>> =
        Vec::with_capacity(output.sheets.len());

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
        let needs_drawing = has_charts || has_chart_ex || has_floating_objects;

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
        {
            sheet_rels_data.push(None);
            drawing_rels_data.push(None);
            drawing_xml_data.push(None);
            continue;
        }

        let sheet_num = sheet_idx + 1;
        let original_sheet_rels = round_trip_ctx
            .and_then(|ctx| ctx.sheets.get(sheet_idx))
            .map(|srt| srt.sheet_opc_rels.as_slice())
            .unwrap_or(&[]);

        let mut rels = create_sheet_rels();

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

        // Hyperlink rels (external URLs and internal links stored as rels).
        if has_hyperlinks || !sheet_data.hyperlinks.is_empty() {
            let mut hl_rels: Vec<&domain_types::OpcRelationship> = original_sheet_rels
                .iter()
                .filter(|r| r.rel_type == REL_HYPERLINK)
                .collect();
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
                let Some(target) = hl.target.clone() else {
                    hyperlink_outputs.push(crate::output::results::HyperlinkOutput {
                        cell_ref: hl.cell_ref.clone(),
                        location: hl.location.clone().unwrap_or_default(),
                        display: hl.display.clone().unwrap_or_default(),
                        tooltip: hl.tooltip.clone().unwrap_or_default(),
                        r_id: None,
                        uid: hl.uid.clone(),
                    });
                    continue;
                };
                if !target_needs_rel(&target) {
                    hyperlink_outputs.push(crate::output::results::HyperlinkOutput {
                        cell_ref: hl.cell_ref.clone(),
                        location: hl.location.clone().unwrap_or(target),
                        display: hl.display.clone().unwrap_or_default(),
                        tooltip: hl.tooltip.clone().unwrap_or_default(),
                        r_id: None,
                        uid: hl.uid.clone(),
                    });
                    continue;
                }

                let hinted_id = rel_target_to_ids.get_mut(&target).and_then(|ids| {
                    if ids.is_empty() {
                        None
                    } else {
                        Some(ids.remove(0))
                    }
                });
                let r_id = if let Some(ref hinted_id) = hinted_id {
                    rels.add_external_with_id(hinted_id, REL_HYPERLINK, &target);
                    hinted_id.clone()
                } else {
                    rels.add_external(REL_HYPERLINK, &target)
                };
                let hyperlink_idx = hyperlink_outputs.len();
                let is_internal_rel = target.starts_with('#');
                let location = if is_internal_rel {
                    String::new()
                } else {
                    hl.location.clone().unwrap_or_default()
                };
                hyperlink_outputs.push(crate::output::results::HyperlinkOutput {
                    cell_ref: hl.cell_ref.clone(),
                    location,
                    display: hl.display.clone().unwrap_or_default(),
                    tooltip: hl.tooltip.clone().unwrap_or_default(),
                    r_id: Some(r_id),
                    uid: hl.uid.clone(),
                });
                worksheet_hyperlink_relationships.push(WorksheetHyperlinkGraphEntry {
                    sheet_idx,
                    hyperlink_idx,
                    target,
                    relationship_id_hint: hyperlink_outputs[hyperlink_idx]
                        .r_id
                        .clone()
                        .unwrap_or_default(),
                });
            }
            sheet_hyperlink_outputs[sheet_idx] = Some(hyperlink_outputs);
        }

        // Comment rels
        if has_comments {
            global_vml_idx += 1;
            global_comment_idx += 1;
            let comments_path = sheet_extras[sheet_idx]
                .original_comment_path
                .clone()
                .unwrap_or_else(|| format!("xl/comments{}.xml", global_comment_idx));
            let comments_target = worksheet_relative_target(&comments_path);
            let comments_relationship_id_hint = if let Some(r_id) =
                package_authority::relationship_id_hint(
                    original_sheet_rels,
                    REL_COMMENTS,
                    &comments_target,
                    None,
                )
                .filter(|r_id| rels.get_by_id(r_id).is_none())
            {
                rels.add_with_id(&r_id, REL_COMMENTS, &comments_target);
                Some(r_id)
            } else {
                Some(rels.add(REL_COMMENTS, &comments_target))
            };
            let vml_path = sheet_extras[sheet_idx]
                .original_vml_path
                .clone()
                .unwrap_or_else(|| format!("xl/drawings/vmlDrawing{}.vml", global_vml_idx));
            let vml_target = worksheet_relative_target(&vml_path);
            let vml_relationship_id_hint = if let Some(r_id) =
                package_authority::relationship_id_hint(
                    original_sheet_rels,
                    REL_VML_DRAWING,
                    &vml_target,
                    None,
                )
                .filter(|r_id| rels.get_by_id(r_id).is_none())
            {
                rels.add_with_id(&r_id, REL_VML_DRAWING, &vml_target);
                Some(r_id)
            } else {
                Some(rels.add(REL_VML_DRAWING, &vml_target))
            };
            worksheet_comments_relationships.push(WorksheetCommentsGraphEntry {
                sheet_idx,
                comments_path,
                comments_target,
                comments_relationship_id_hint,
                vml_path,
                vml_target,
                vml_relationship_id_hint,
            });
        }

        // Header/footer VML rels (legacyDrawingHF)
        if sheet_extras[sheet_idx].hf_vml.is_some() {
            let hf = sheet_extras[sheet_idx].hf_vml.as_ref().unwrap();
            if let Some(n) = extract_vml_drawing_number(&hf.vml_path) {
                global_vml_idx = global_vml_idx.max(n);
            }
            let hf_target = worksheet_relative_target(&hf.vml_path);
            let relationship_id_hint = if let Some(r_id) = package_authority::relationship_id_hint(
                original_sheet_rels,
                REL_VML_DRAWING,
                &hf_target,
                None,
            )
            .filter(|r_id| rels.get_by_id(r_id).is_none())
            {
                rels.add_with_id(&r_id, REL_VML_DRAWING, &hf_target);
                Some(r_id)
            } else {
                Some(rels.add(REL_VML_DRAWING, &hf_target))
            };
            worksheet_header_footer_vml_relationships.push(WorksheetHeaderFooterVmlGraphEntry {
                sheet_idx,
                path: hf.vml_path.clone(),
                target: hf_target,
                relationship_id_hint,
            });
        }

        // Form controls rels (ctrlProp, VML, worksheet controls XML)
        if has_form_controls {
            let controls = &sheet_extras[sheet_idx].form_controls;

            let mut ctrl_prop_r_ids: Vec<String> = Vec::with_capacity(controls.len());
            for _ in 0..controls.len() {
                global_ctrl_prop_idx += 1;
                let target = format!("../ctrlProps/ctrlProp{}.xml", global_ctrl_prop_idx);
                let r_id = if let Some(r_id) = package_authority::relationship_id_hint(
                    original_sheet_rels,
                    REL_CTRL_PROP,
                    &target,
                    None,
                ) {
                    rels.add_with_id(&r_id, REL_CTRL_PROP, &target);
                    r_id
                } else {
                    rels.add(REL_CTRL_PROP, &target)
                };
                ctrl_prop_r_ids.push(r_id);
                worksheet_control_property_relationships.push(WorksheetControlPropertyGraphEntry {
                    sheet_idx,
                    global_idx: global_ctrl_prop_idx,
                    target,
                    relationship_id_hint: ctrl_prop_r_ids.last().cloned().unwrap_or_default(),
                });
            }

            // Add VML drawing relationship for form controls (separate from comment VML)
            if !has_comments {
                global_vml_idx += 1;
                let path = sheet_extras[sheet_idx]
                    .original_vml_path
                    .clone()
                    .unwrap_or_else(|| format!("xl/drawings/vmlDrawing{}.vml", global_vml_idx));
                if let Some(n) = extract_vml_drawing_number(&path) {
                    global_vml_idx = global_vml_idx.max(n);
                }
                let target = worksheet_relative_target(&path);
                let relationship_id_hint = if let Some(r_id) =
                    package_authority::relationship_id_hint(
                        original_sheet_rels,
                        REL_VML_DRAWING,
                        &target,
                        None,
                    )
                    .filter(|r_id| rels.get_by_id(r_id).is_none())
                {
                    rels.add_with_id(&r_id, REL_VML_DRAWING, &target);
                    Some(r_id)
                } else {
                    Some(rels.add(REL_VML_DRAWING, &target))
                };
                worksheet_form_control_vml_relationships.push(WorksheetFormControlVmlGraphEntry {
                    sheet_idx,
                    path,
                    target,
                    relationship_id_hint,
                });
            }
        }

        // Threaded comment rels (must come after legacy comment rels)
        if has_threaded_comments {
            global_tc_idx += 1;
            let path = format!("xl/threadedComments/threadedComment{}.xml", global_tc_idx);
            let target = worksheet_relative_target(&path);
            let relationship_id_hint = if let Some(r_id) = package_authority::relationship_id_hint(
                original_sheet_rels,
                REL_THREADED_COMMENT,
                &target,
                None,
            )
            .filter(|r_id| rels.get_by_id(r_id).is_none())
            {
                rels.add_with_id(&r_id, REL_THREADED_COMMENT, &target);
                Some(r_id)
            } else {
                Some(rels.add(REL_THREADED_COMMENT, &target))
            };
            worksheet_threaded_comments_relationships.push(WorksheetThreadedCommentsGraphEntry {
                sheet_idx,
                path,
                target,
                relationship_id_hint,
            });
        }

        // Table rels
        if has_tables {
            let tables_before: usize = sheet_extras[..sheet_idx]
                .iter()
                .map(|e| e.tables.len())
                .sum();

            for i in 0..extras.tables.len() {
                let global_idx = tables_before + i + 1;
                let target = format!("../tables/table{}.xml", global_idx);
                let table_r_id = if let Some(r_id) = package_authority::relationship_id_hint(
                    original_sheet_rels,
                    REL_TABLE,
                    &target,
                    None,
                ) {
                    rels.add_with_id(&r_id, REL_TABLE, &target);
                    r_id
                } else {
                    rels.add(REL_TABLE, &target)
                };
                worksheet_table_relationships.push((sheet_idx, global_idx, table_r_id));
            }
        }

        // Pivot table rels (sheet → pivotTable) and worksheet-level references.
        //
        // OOXML consumers discover worksheet-owned pivot tables from structured
        // `<pivotTableDefinition r:id="..."/>` children in the worksheet XML.
        // The relationship file supplies the target part; both must be kept in
        // lockstep with the generated authoritative pivot paths.
        let pivot_table_r_ids =
            pivot_package::add_sheet_relationships(&mut rels, &pivot_data, sheet_idx);
        if !pivot_table_r_ids.is_empty() {
            for (entry, r_id) in pivot_data
                .pivot_table_entries
                .iter()
                .filter(|entry| entry.sheet_idx == sheet_idx)
                .zip(pivot_table_r_ids)
            {
                worksheet_pivot_table_relationships.push((sheet_idx, entry.global_idx, r_id));
            }
        }

        // Chart / Drawing / Floating Object rels
        if needs_drawing {
            global_drawing_idx += 1;
            let _chart_entries = &all_chart_entries[sheet_idx];

            let drawing_path = sheet_extras[sheet_idx]
                .original_drawing_path
                .clone()
                .unwrap_or_else(|| format!("xl/drawings/drawing{}.xml", global_drawing_idx));
            let drawing_target = worksheet_relative_target(&drawing_path);
            let drawing_relationship_id_hint = if let Some(r_id) =
                package_authority::relationship_id_hint(
                    original_sheet_rels,
                    REL_DRAWING,
                    &drawing_target,
                    None,
                )
                .filter(|r_id| rels.get_by_id(r_id).is_none())
            {
                rels.add_with_id(&r_id, REL_DRAWING, &drawing_target);
                Some(r_id)
            } else {
                Some(rels.add(REL_DRAWING, &drawing_target))
            };
            worksheet_drawing_relationships.push(WorksheetDrawingGraphEntry {
                sheet_idx,
                path: drawing_path.clone(),
                target: drawing_target,
                relationship_id_hint: drawing_relationship_id_hint,
            });

            // Build drawing .rels (drawing→chart references, image refs).
            let mut drawing_rels = RelationshipManager::new();

            // Build DrawingWriter with all anchors (charts + floating objects).
            let mut drawing_writer = DrawingWriter::new();
            if let Some(attrs) = round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .map(|srt| srt.drawing_root_namespace_attrs.clone())
                .filter(|attrs| !attrs.is_empty())
            {
                drawing_writer.set_root_namespace_attrs(attrs);
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

                // Add image relationships for images whose bytes are emitted
                // from modeled floating-object image blobs below.
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
            // Charts now also carry explicit anchor indices from ChartSpec.anchor_index.
            // Any anchors without explicit indices fill the remaining slots in order.
            {
                // Collect all known (occupied) anchor indices from fobj and charts.
                let mut occupied: std::collections::BTreeSet<usize> =
                    std::collections::BTreeSet::new();
                for (idx, _) in &deferred_fobj_anchors {
                    if let Some(i) = idx {
                        occupied.insert(*i);
                    }
                }
                // Charts with explicit anchor_index from ChartSpec
                for (idx, _) in &deferred_chart_anchors {
                    if let Some(i) = idx {
                        occupied.insert(*i);
                    }
                }

                // Assign unindexed chart anchors to the remaining (free) indices.
                let total = deferred_fobj_anchors.len() + deferred_chart_anchors.len();
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

                // Sort by anchor index to restore original order.
                all_anchors.sort_by_key(|&(idx, _)| idx);

                for (_, anchor) in all_anchors {
                    drawing_writer.add_anchor(anchor);
                }
            }

            drawing_xml_data.push(None);
            drawing_writer_data.push(Some(drawing_writer));
            // Emit drawing .rels when there are actual relationships OR when the
            // original archive had a .rels file (even if empty) for round-trip fidelity.
            let had_original_rels_file = round_trip_ctx
                .and_then(|ctx| ctx.sheets.get(sheet_idx))
                .map(|srt| srt.has_drawing_rels_file)
                .unwrap_or(false);
            if !drawing_rels.is_empty() || had_original_rels_file {
                for rel in drawing_rels.relationships() {
                    let target_path = crate::infra::opc::resolve_relationship_target(
                        Some(&drawing_path),
                        &rel.target,
                    )
                    .map_err(|err| {
                        WriteError::PackageIntegrity(format!(
                            "invalid drawing relationship target for {}: {} ({:?})",
                            drawing_path, rel.target, err
                        ))
                    })?;
                    drawing_relationships.push(DrawingRelationshipGraphEntry {
                        drawing_path: drawing_path.clone(),
                        rel_type: rel.rel_type.clone(),
                        target_path,
                        relationship_id_hint: rel.id.clone(),
                    });
                }
                drawing_rels_data.push(None);
                drawing_rels_should_emit.push(true);
            } else {
                drawing_rels_data.push(None);
                drawing_rels_should_emit.push(false);
            }
            sheets_with_drawings.push(global_drawing_idx);
        } else {
            drawing_xml_data.push(None);
            drawing_writer_data.push(None);
            drawing_rels_data.push(None);
            drawing_rels_should_emit.push(false);
        }

        // Printer settings relationship.
        if has_printer_settings {
            if let Some(ref ps) = sheet_data.print_settings {
                let path = format!("xl/printerSettings/printerSettings{}.bin", sheet_num);
                let target = format!("../printerSettings/printerSettings{}.bin", sheet_num);
                if has_clean_opaque_part(round_trip_ctx, &path) {
                    let r_id = ps
                        .r_id
                        .clone()
                        .filter(|r_id| rels.get_by_id(r_id).is_none())
                        .or_else(|| {
                            package_authority::relationship_id_hint(
                                original_sheet_rels,
                                REL_PRINTER_SETTINGS,
                                &target,
                                None,
                            )
                            .filter(|r_id| rels.get_by_id(r_id).is_none())
                        })
                        .unwrap_or_else(|| rels.add(REL_PRINTER_SETTINGS, &target));
                    if rels.find_by_target(&target).is_none() {
                        rels.add_with_id(&r_id, REL_PRINTER_SETTINGS, &target);
                    }
                    worksheet_printer_settings_relationships.push(
                        WorksheetPrinterSettingsGraphEntry {
                            sheet_idx,
                            path,
                            target,
                            relationship_id_hint: r_id,
                        },
                    );
                }
            }
        }

        if rels.is_empty() {
            sheet_rels_data.push(None);
        } else {
            sheet_rels_data.push(Some(rels));
        }
    }

    // ── 3. Build package graph facts needed before workbook.xml ─────────
    // Theme and properties are computed before workbook XML so relationship IDs
    // come from a resolved graph instead of workbook-local guesses.
    let theme_xml = output
        .theme
        .as_ref()
        .map(|t| crate::domain::themes::write::theme_writer_from_domain(t, round_trip_ctx));
    let has_theme = theme_xml.is_some();
    let doc_props_xml = doc_props::build_doc_props_xml(output);
    let core_props_xml = doc_props_xml.core;
    let app_props_xml = doc_props_xml.app;
    let custom_props_xml = doc_props_xml.custom;
    let metadata_xml = metadata::metadata_xml_for_export(output, round_trip_ctx);
    let persons_xml: Option<Vec<u8>> = if !output.persons.is_empty() {
        Some(crate::domain::comments::write::persons_xml_from_domain(
            &output.persons,
        ))
    } else {
        None
    };
    let external_link_exports: Vec<(domain_types::domain::external_link::ExternalLink, String)> =
        output
            .external_links
            .iter()
            .map(|link| (link.clone(), external_links::part_name(link)))
            .collect();
    let mut package_graph_builder =
        crate::write::package_graph::build_modeled_workbook_graph_builder(
            crate::write::package_graph::ModeledWorkbookGraphOptions {
                sheet_count: output.sheets.len(),
                has_theme,
                has_shared_strings: shared_strings.has_referenced_entries(),
                has_core_props: core_props_xml.is_some(),
                has_app_props: app_props_xml.is_some(),
                has_custom_props: custom_props_xml.is_some(),
                has_metadata: metadata_xml.is_some(),
                has_persons: persons_xml.is_some(),
                has_doc_metadata_label_info: false,
            },
            round_trip_ctx,
        )?;
    for (link, part_name) in &external_link_exports {
        crate::write::package_graph::register_workbook_external_link(
            &mut package_graph_builder,
            part_name,
            external_links::workbook_relationship_id_hint(link, part_name),
        )?;
        external_links::register_owned_relationships(&mut package_graph_builder, part_name, link);
    }
    for entry in &pivot_data.preserved_workbook_cache_entries {
        crate::write::package_graph::register_preserved_workbook_pivot_cache(
            &mut package_graph_builder,
            &entry.relationship_target,
            &entry.relationship_id,
        );
    }
    for entry in &pivot_data.pivot_cache_entries {
        crate::write::package_graph::register_generated_pivot_cache(
            &mut package_graph_builder,
            entry.global_idx,
        )?;
    }
    for entry in &worksheet_hyperlink_relationships {
        crate::write::package_graph::register_worksheet_hyperlink(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.target,
            &entry.relationship_id_hint,
        );
    }
    for entry in &worksheet_control_property_relationships {
        crate::write::package_graph::register_worksheet_control_property(
            &mut package_graph_builder,
            entry.sheet_idx,
            entry.global_idx,
            &entry.relationship_id_hint,
        )?;
    }
    for entry in &worksheet_header_footer_vml_relationships {
        crate::write::package_graph::register_worksheet_vml_drawing(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            entry.relationship_id_hint.as_deref(),
        )?;
    }
    for entry in &worksheet_form_control_vml_relationships {
        crate::write::package_graph::register_worksheet_vml_drawing(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            entry.relationship_id_hint.as_deref(),
        )?;
    }
    for entry in &worksheet_drawing_relationships {
        crate::write::package_graph::register_worksheet_drawing(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            entry.relationship_id_hint.as_deref(),
        )?;
    }
    let mut registered_chart_auxiliary_parts = std::collections::BTreeSet::new();
    for (sheet_idx, chart_entries) in all_chart_entries.iter().enumerate() {
        for (local_idx, entry) in chart_entries.iter().enumerate() {
            let chart_path = format!("xl/charts/chart{}.xml", entry.global_idx);
            crate::write::package_graph::register_chart(
                &mut package_graph_builder,
                entry.global_idx,
            )?;
            let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
            if chart_allows_auxiliary_replay(chart_spec)
                && let Some(aux) = round_trip_ctx
                    .and_then(|ctx| ctx.sheets.get(sheet_idx))
                    .and_then(|srt| srt.chart_auxiliary_data.get(local_idx))
            {
                let auxiliary_paths: std::collections::BTreeSet<_> = aux
                    .auxiliary_files
                    .iter()
                    .filter(|aux_file| {
                        crate::write::package_graph::is_supported_chart_auxiliary_part(
                            &aux_file.path,
                        )
                    })
                    .map(|aux_file| aux_file.path.trim_start_matches('/').to_string())
                    .collect();
                for aux_file in &aux.auxiliary_files {
                    if !crate::write::package_graph::is_supported_chart_auxiliary_part(
                        &aux_file.path,
                    ) {
                        continue;
                    }
                    if registered_chart_auxiliary_parts
                        .insert(aux_file.path.trim_start_matches('/').to_string())
                    {
                        crate::write::package_graph::register_chart_auxiliary_part(
                            &mut package_graph_builder,
                            &aux_file.path,
                        )?;
                    }
                }
                if let Some(rels_data) = &aux.chart_rels {
                    for rel in crate::domain::workbook::read::parse_all_rels(rels_data) {
                        if rel.target_mode.as_deref() == Some("External") {
                            continue;
                        }
                        let Ok(target_path) = crate::infra::opc::resolve_relationship_target(
                            Some(&chart_path),
                            &rel.target,
                        ) else {
                            continue;
                        };
                        let target_path = target_path.trim_start_matches('/').to_string();
                        if auxiliary_paths.contains(&target_path) {
                            chart_auxiliary_relationships.push(
                                ChartAuxiliaryRelationshipGraphEntry {
                                    chart_path: chart_path.clone(),
                                    rel_type: rel.rel_type,
                                    target_path,
                                    relationship_id_hint: rel.id,
                                },
                            );
                        }
                    }
                }
            }
        }
    }
    for (sheet_idx, chart_ex_entries) in all_chart_ex_entries.iter().enumerate() {
        for (local_idx, entry) in chart_ex_entries.iter().enumerate() {
            let chart_path = format!("xl/charts/chartEx{}.xml", entry.global_idx);
            crate::write::package_graph::register_chart_ex(
                &mut package_graph_builder,
                entry.global_idx,
            )?;
            let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
            if chart_allows_auxiliary_replay(chart_spec)
                && let Some(aux) = round_trip_ctx
                    .and_then(|ctx| ctx.sheets.get(sheet_idx))
                    .and_then(|srt| srt.chart_ex_auxiliary_data.get(local_idx))
            {
                let auxiliary_paths: std::collections::BTreeSet<_> = aux
                    .auxiliary_files
                    .iter()
                    .filter(|aux_file| {
                        crate::write::package_graph::is_supported_chart_auxiliary_part(
                            &aux_file.path,
                        )
                    })
                    .map(|aux_file| aux_file.path.trim_start_matches('/').to_string())
                    .collect();
                for aux_file in &aux.auxiliary_files {
                    if !crate::write::package_graph::is_supported_chart_auxiliary_part(
                        &aux_file.path,
                    ) {
                        continue;
                    }
                    if registered_chart_auxiliary_parts
                        .insert(aux_file.path.trim_start_matches('/').to_string())
                    {
                        crate::write::package_graph::register_chart_auxiliary_part(
                            &mut package_graph_builder,
                            &aux_file.path,
                        )?;
                    }
                }
                if let Some(rels_data) = &aux.chart_rels {
                    for rel in crate::domain::workbook::read::parse_all_rels(rels_data) {
                        if rel.target_mode.as_deref() == Some("External") {
                            continue;
                        }
                        let Ok(target_path) = crate::infra::opc::resolve_relationship_target(
                            Some(&chart_path),
                            &rel.target,
                        ) else {
                            continue;
                        };
                        let target_path = target_path.trim_start_matches('/').to_string();
                        if auxiliary_paths.contains(&target_path) {
                            chart_auxiliary_relationships.push(
                                ChartAuxiliaryRelationshipGraphEntry {
                                    chart_path: chart_path.clone(),
                                    rel_type: rel.rel_type,
                                    target_path,
                                    relationship_id_hint: rel.id,
                                },
                            );
                        }
                    }
                }
            }
        }
    }
    for entry in &chart_auxiliary_relationships {
        crate::write::package_graph::register_chart_auxiliary_relationship(
            &mut package_graph_builder,
            &entry.chart_path,
            &entry.rel_type,
            &entry.target_path,
            &entry.relationship_id_hint,
        );
    }
    for zip_path in all_image_blobs
        .iter()
        .map(|(zip_path, _)| zip_path.as_str())
        .collect::<std::collections::BTreeSet<_>>()
    {
        crate::write::package_graph::register_media_part(&mut package_graph_builder, zip_path)?;
    }
    for entry in &drawing_relationships {
        if entry.rel_type == REL_CHART {
            crate::write::package_graph::register_drawing_chart_relationship(
                &mut package_graph_builder,
                &entry.drawing_path,
                &entry.target_path,
                &entry.relationship_id_hint,
            )?;
        } else if entry.rel_type == REL_CHART_EX {
            crate::write::package_graph::register_drawing_chart_ex_relationship(
                &mut package_graph_builder,
                &entry.drawing_path,
                &entry.target_path,
                &entry.relationship_id_hint,
            )?;
        } else if entry.rel_type
            == "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
        {
            crate::write::package_graph::register_drawing_image_relationship(
                &mut package_graph_builder,
                &entry.drawing_path,
                &entry.target_path,
                &entry.relationship_id_hint,
            )?;
        }
    }
    for entry in &worksheet_printer_settings_relationships {
        crate::write::package_graph::register_worksheet_printer_settings(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            &entry.relationship_id_hint,
        );
    }
    for entry in &worksheet_comments_relationships {
        crate::write::package_graph::register_worksheet_comments(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.comments_path,
            entry.comments_relationship_id_hint.as_deref(),
            &entry.vml_path,
            entry.vml_relationship_id_hint.as_deref(),
        )?;
    }
    for entry in &worksheet_threaded_comments_relationships {
        crate::write::package_graph::register_worksheet_threaded_comments(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            entry.relationship_id_hint.as_deref(),
        )?;
    }
    for (sheet_idx, global_idx, relationship_id_hint) in &worksheet_table_relationships {
        crate::write::package_graph::register_worksheet_table(
            &mut package_graph_builder,
            *sheet_idx,
            *global_idx,
            Some(relationship_id_hint),
        )?;
    }
    for entry in &pivot_data.preserved_pivot_table_entries {
        crate::write::package_graph::register_preserved_worksheet_pivot_table(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.relationship_target,
            &entry.relationship_id,
        )?;
    }
    for (sheet_idx, global_idx, relationship_id_hint) in &worksheet_pivot_table_relationships {
        crate::write::package_graph::register_generated_worksheet_pivot_table(
            &mut package_graph_builder,
            *sheet_idx,
            *global_idx,
            Some(relationship_id_hint),
        )?;
    }
    let cache_id_to_global: std::collections::HashMap<u32, usize> = pivot_data
        .pivot_cache_entries
        .iter()
        .map(|e| (e.cache_id, e.global_idx))
        .collect();
    for entry in &pivot_data.pivot_table_entries {
        if let Some(&cache_global_idx) = cache_id_to_global.get(&entry.cache_id) {
            crate::write::package_graph::register_generated_pivot_table_cache_relationship(
                &mut package_graph_builder,
                entry.global_idx,
                cache_global_idx,
            );
        }
    }
    crate::write::opaque_subgraph::register_round_trip_opaque_subgraphs(
        &mut package_graph_builder,
        round_trip_ctx,
        &pivot_data,
    )?;
    let package_graph = package_graph_builder.resolve()?;
    package_graph.validate_for_export()?;

    for (sheet_idx, drawing_writer) in drawing_writer_data.iter_mut().enumerate() {
        let Some(drawing_writer) = drawing_writer else {
            continue;
        };
        let drawing_path = worksheet_drawing_relationships
            .iter()
            .find(|entry| entry.sheet_idx == sheet_idx)
            .map(|entry| entry.path.as_str())
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing graph-registered drawing part for sheet {}",
                    sheet_idx + 1
                ))
            })?;
        let drawing_rels = package_graph.relationship_manager_for_owner(
            &crate::write::package_graph::PackageOwner::Part {
                path: drawing_path.to_string(),
            },
        );
        let mut resolved_ids = std::collections::HashMap::new();
        for entry in drawing_relationships
            .iter()
            .filter(|entry| entry.drawing_path == drawing_path)
        {
            let resolved_id = drawing_rels
                .relationships()
                .iter()
                .find(|rel| {
                    rel.rel_type == entry.rel_type
                        && crate::infra::opc::resolve_relationship_target(
                            Some(drawing_path),
                            &rel.target,
                        )
                        .map(|target| target == entry.target_path)
                        .unwrap_or(false)
                })
                .map(|rel| rel.id.clone())
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing resolved drawing relationship for {} target {}",
                        drawing_path, entry.target_path
                    ))
                })?;
            resolved_ids.insert(entry.relationship_id_hint.clone(), resolved_id);
        }
        drawing_writer.remap_relationship_ids(&resolved_ids);
        drawing_xml_data[sheet_idx] = Some(drawing_writer.to_xml());
    }

    for entry in &worksheet_hyperlink_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        let r_id = package_graph
            .relationship_id(&owner, REL_HYPERLINK, &entry.target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet hyperlink relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.target
                ))
            })?
            .to_string();
        if let Some(hyperlinks) = sheet_hyperlink_outputs[entry.sheet_idx].as_mut()
            && let Some(hyperlink) = hyperlinks.get_mut(entry.hyperlink_idx)
        {
            hyperlink.r_id = Some(r_id);
        }
    }
    for (sheet_idx, hyperlinks) in sheet_hyperlink_outputs.into_iter().enumerate() {
        if let Some(hyperlinks) = hyperlinks {
            sheet_writers[sheet_idx].set_hyperlinks(hyperlinks);
        }
    }

    for (sheet_idx, extras) in sheet_extras.iter().enumerate() {
        if extras.form_controls.is_empty() {
            continue;
        }
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        };
        let mut ctrl_prop_r_ids = Vec::with_capacity(extras.form_controls.len());
        for entry in worksheet_control_property_relationships
            .iter()
            .filter(|entry| entry.sheet_idx == sheet_idx)
        {
            let r_id = package_graph
                .relationship_id(&owner, REL_CTRL_PROP, &entry.target)
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing worksheet control property relationship for sheet {} target {}",
                        sheet_idx + 1,
                        entry.target
                    ))
                })?
                .to_string();
            ctrl_prop_r_ids.push(r_id);
        }
        let controls_writer = ControlsWriter::new(extras.form_controls.clone());
        let ctrl_xml = controls_writer.write_worksheet_controls(1025, &ctrl_prop_r_ids);
        sheet_writers[sheet_idx].set_controls_xml(String::from_utf8_lossy(&ctrl_xml).to_string());
    }

    for entry in &worksheet_printer_settings_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        let r_id = package_graph
            .relationship_id(&owner, REL_PRINTER_SETTINGS, &entry.target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet printer settings relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.target
                ))
            })?
            .to_string();
        sheet_writers[entry.sheet_idx]
            .ensure_print_writer()
            .set_printer_settings_r_id(Some(r_id));
    }

    for entry in &worksheet_header_footer_vml_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        let r_id = package_graph
            .relationship_id(&owner, REL_VML_DRAWING, &entry.target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet header/footer VML relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.target
                ))
            })?
            .to_string();
        let rels = sheet_rels_data[entry.sheet_idx].get_or_insert_with(create_sheet_rels);
        if rels.find_by_target(&entry.target).is_none() {
            rels.add_with_id(&r_id, REL_VML_DRAWING, &entry.target);
        }
        sheet_writers[entry.sheet_idx].set_legacy_drawing_hf_r_id(r_id);
    }

    for entry in &worksheet_form_control_vml_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        let r_id = package_graph
            .relationship_id(&owner, REL_VML_DRAWING, &entry.target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet form-control VML relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.target
                ))
            })?
            .to_string();
        let rels = sheet_rels_data[entry.sheet_idx].get_or_insert_with(create_sheet_rels);
        rels.set_with_id(&r_id, REL_VML_DRAWING, &entry.target);
        sheet_writers[entry.sheet_idx].set_legacy_drawing_r_id(r_id);
    }

    for entry in &worksheet_drawing_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        let r_id = package_graph
            .relationship_id(&owner, REL_DRAWING, &entry.target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet drawing relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.target
                ))
            })?
            .to_string();
        let rels = sheet_rels_data[entry.sheet_idx].get_or_insert_with(create_sheet_rels);
        rels.set_with_id(&r_id, REL_DRAWING, &entry.target);
        sheet_writers[entry.sheet_idx].set_drawing_r_id(r_id);
    }

    for entry in &worksheet_comments_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        let comments_r_id = package_graph
            .relationship_id(&owner, REL_COMMENTS, &entry.comments_target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet comments relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.comments_target
                ))
            })?
            .to_string();
        let rels = sheet_rels_data[entry.sheet_idx].get_or_insert_with(create_sheet_rels);
        if rels.find_by_target(&entry.comments_target).is_none() {
            rels.add_with_id(&comments_r_id, REL_COMMENTS, &entry.comments_target);
        }

        let vml_r_id = package_graph
            .relationship_id(&owner, REL_VML_DRAWING, &entry.vml_target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet VML drawing relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.vml_target
                ))
            })?
            .to_string();
        let rels = sheet_rels_data[entry.sheet_idx].get_or_insert_with(create_sheet_rels);
        if rels.find_by_target(&entry.vml_target).is_none() {
            rels.add_with_id(&vml_r_id, REL_VML_DRAWING, &entry.vml_target);
        }
        sheet_writers[entry.sheet_idx].set_legacy_drawing_r_id(vml_r_id);
    }

    for entry in &worksheet_threaded_comments_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        let r_id = package_graph
            .relationship_id(&owner, REL_THREADED_COMMENT, &entry.target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet threaded comments relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.target
                ))
            })?
            .to_string();
        let rels = sheet_rels_data[entry.sheet_idx].get_or_insert_with(create_sheet_rels);
        if rels.find_by_target(&entry.target).is_none() {
            rels.add_with_id(&r_id, REL_THREADED_COMMENT, &entry.target);
        }
    }

    for (sheet_idx, extras) in sheet_extras.iter().enumerate() {
        if extras.tables.is_empty() {
            continue;
        }
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        };
        let tables_before: usize = sheet_extras[..sheet_idx]
            .iter()
            .map(|e| e.tables.len())
            .sum();
        let mut table_parts_xml = String::new();
        table_parts_xml.push_str(&format!("<tableParts count=\"{}\">", extras.tables.len()));
        for i in 0..extras.tables.len() {
            let global_idx = tables_before + i + 1;
            let target = format!("../tables/table{}.xml", global_idx);
            let table_r_id = package_graph
                .relationship_id(&owner, REL_TABLE, &target)
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing worksheet table relationship for sheet {} table {}",
                        sheet_idx + 1,
                        global_idx
                    ))
                })?;
            table_parts_xml.push_str(&format!("<tablePart r:id=\"{}\"/>", table_r_id));
        }
        table_parts_xml.push_str("</tableParts>");
        sheet_writers[sheet_idx].set_table_parts_xml(table_parts_xml);
    }
    for sheet_idx in 0..output.sheets.len() {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        };
        let preserved_pivot_table_r_ids: Vec<String> = pivot_data
            .preserved_pivot_table_entries
            .iter()
            .filter(|entry| entry.sheet_idx == sheet_idx)
            .map(|entry| {
                package_graph
                    .relationship_id(&owner, REL_PIVOT_TABLE, &entry.relationship_target)
                    .ok_or_else(|| {
                        WriteError::PackageIntegrity(format!(
                            "missing preserved worksheet pivot relationship for sheet {} target {}",
                            sheet_idx + 1,
                            entry.relationship_target
                        ))
                    })
                    .map(str::to_string)
            })
            .collect::<Result<_, _>>()?;
        if !preserved_pivot_table_r_ids.is_empty() {
            sheet_writers[sheet_idx].set_preserved_pivot_table_r_ids(preserved_pivot_table_r_ids);
        }

        let pivot_table_r_ids: Vec<String> = pivot_data
            .pivot_table_entries
            .iter()
            .filter(|entry| entry.sheet_idx == sheet_idx)
            .map(|entry| {
                let target = format!("../pivotTables/pivotTable{}.xml", entry.global_idx);
                package_graph
                    .relationship_id(&owner, REL_PIVOT_TABLE, &target)
                    .ok_or_else(|| {
                        WriteError::PackageIntegrity(format!(
                            "missing generated worksheet pivot relationship for sheet {} target {}",
                            sheet_idx + 1,
                            target
                        ))
                    })
                    .map(str::to_string)
            })
            .collect::<Result<_, _>>()?;
        if !pivot_table_r_ids.is_empty() {
            sheet_writers[sheet_idx].set_pivot_table_r_ids(pivot_table_r_ids);
        }
    }

    // ── 4. Build workbook.xml ───────────────────────────────────────────
    let mut workbook_writer = WorkbookWriter::new();
    for (idx, sheet_data) in output.sheets.iter().enumerate() {
        let sheet_target = format!("worksheets/sheet{}.xml", idx + 1);
        let r_id = package_graph
            .relationship_id(
                &crate::write::package_graph::PackageOwner::Workbook,
                super::REL_WORKSHEET,
                &sheet_target,
            )
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing workbook relationship for sheet {}",
                    idx + 1
                ))
            })?
            .to_string();
        let sheet_id = sheet_data.sheet_id.unwrap_or(idx as u32 + 1);
        workbook_writer.add_sheet_def(super::SheetDef::with_state(
            &sheet_data.name,
            sheet_id,
            &r_id,
            sheet_data.visibility,
        ));
    }

    if !output.workbook_views.is_empty() {
        let views: Vec<ooxml_types::workbook::BookView> = output
            .workbook_views
            .iter()
            .cloned()
            .map(ooxml_types::workbook::BookView::from)
            .collect();
        workbook_writer.set_views(views);
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

    if let Some(ref file_version) = output.file_version {
        workbook_writer.set_file_version(file_version.clone());
    }
    if let Some(ref file_sharing) = output.file_sharing {
        workbook_writer.set_file_sharing(file_sharing.clone());
    }
    if let Some(ref workbook_properties) = output.workbook_properties {
        workbook_writer.set_workbook_properties(workbook_properties.clone());
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
    content_types.add_default(
        "rels",
        "application/vnd.openxmlformats-package.relationships+xml",
    );
    content_types.add_default("xml", "application/xml");
    if has_any_comments {
        content_types.add_default(
            "vml",
            "application/vnd.openxmlformats-officedocument.vmlDrawing",
        );
    }
    package_graph.add_content_types_to(&mut content_types);
    // Comments, VML comment drawings, and threaded comments are registered
    // through the package graph when emitted.
    // docMetadata/LabelInfo.xml is registered through the package graph when emitted.
    // persons.xml is registered through the package graph when emitted.
    // Table content types are registered through the package graph when emitted.
    // Pivot table and cache content types are registered through the package graph.
    // Form control (ctrlProp) content types are registered through the package graph.
    // Drawing content types are registered through the package graph when emitted.
    // Chart and ChartEx content types are registered through the package graph.
    // Generated media content types are registered through the package graph.
    // Chart auxiliary content types are registered through the package graph.
    let has_external_links = !external_link_exports.is_empty();
    let content_types_xml = content_types.to_xml();

    let root_rels = package_graph
        .relationship_manager_for_owner(&crate::write::package_graph::PackageOwner::Root);
    let root_rels_xml = root_rels.to_xml();

    let workbook_rels = package_graph
        .relationship_manager_for_owner(&crate::write::package_graph::PackageOwner::Workbook);
    // Pivot cache workbook rels + pivotCaches XML for workbook.xml.
    // Clean imported cache entries come from the typed package sidecar and keep
    // their original relationship IDs/targets; generated entries are appended.
    let mut pivot_cache_xml_entries: Vec<(u32, String)> = Vec::new();
    for entry in &pivot_data.preserved_workbook_cache_entries {
        let r_id = package_graph
            .relationship_id(
                &crate::write::package_graph::PackageOwner::Workbook,
                REL_PIVOT_CACHE,
                &entry.relationship_target,
            )
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing workbook relationship for preserved pivot cache {}",
                    entry.relationship_target
                ))
            })?
            .to_string();
        pivot_cache_xml_entries.push((entry.cache_id, r_id));
    }
    for entry in &pivot_data.pivot_cache_entries {
        let target = format!("pivotCache/pivotCacheDefinition{}.xml", entry.global_idx);
        let r_id = package_graph
            .relationship_id(
                &crate::write::package_graph::PackageOwner::Workbook,
                REL_PIVOT_CACHE,
                &target,
            )
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing workbook relationship for generated pivot cache {target}"
                ))
            })?
            .to_string();
        pivot_cache_xml_entries.push((entry.cache_id, r_id));
    }
    if !pivot_cache_xml_entries.is_empty() {
        let pivot_caches_xml = pivot_writer::build_pivot_caches_xml(&pivot_cache_xml_entries);
        workbook_writer.set_pivot_caches_xml(pivot_caches_xml);
    }

    if has_external_links {
        let external_reference_r_ids: Vec<String> = external_link_exports
            .iter()
            .filter_map(|(_, part_name)| {
                package_graph
                    .relationship_id(
                        &crate::write::package_graph::PackageOwner::Workbook,
                        super::REL_EXTERNAL_LINK,
                        &external_links::workbook_target(part_name),
                    )
                    .map(str::to_string)
            })
            .collect();
        workbook_writer.set_external_reference_r_ids(external_reference_r_ids);
    }

    for sheet_idx in 0..output.sheets.len() {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        };
        let rels = package_graph.relationship_manager_for_owner(&owner);
        sheet_rels_data[sheet_idx] = (!rels.is_empty()).then_some(rels);
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

    if shared_strings.has_referenced_entries() {
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
    // Persons (threaded comments author list)
    if let Some(ref persons) = persons_xml {
        zip.add_file("xl/persons/person.xml", persons.clone());
    }

    // External links — serialize from domain types
    for (link, part_name) in &external_link_exports {
        let zip_path = external_links::zip_path(part_name);
        let owner = crate::write::package_graph::PackageOwner::Part {
            path: zip_path.clone(),
        };
        let link_for_xml =
            external_links::with_resolved_relationship_ids(&package_graph, link, &owner);
        let xml = crate::domain::external::write::write_external_link_xml(&link_for_xml);
        zip.add_file(&zip_path, xml);
        let rels = package_graph.relationship_manager_for_owner(&owner);
        if !rels.is_empty() {
            zip.add_file(&external_links::rels_path(&zip_path), rels.to_xml());
        }
    }

    crate::write::opaque_subgraph::write_opaque_parts(&mut zip, &package_graph);

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
        if let Some(ref rels) = sheet_rels_data[idx] {
            zip.add_file(
                &format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num),
                rels.to_xml(),
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
                let vml_entry = worksheet_form_control_vml_relationships
                    .iter()
                    .find(|entry| entry.sheet_idx == idx)
                    .ok_or_else(|| {
                        WriteError::PackageIntegrity(format!(
                            "missing graph-registered form-control VML part for sheet {}",
                            idx + 1
                        ))
                    })?;
                let vml_xml = controls_writer.write_vml_form_controls(base_shape_id);
                zip.add_file(&vml_entry.path, vml_xml);
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

    // Table XML files
    {
        let mut table_global = 0usize;
        for extras in &sheet_extras {
            for table_xml in &extras.tables {
                table_global += 1;
                zip.add_file(
                    &format!("xl/tables/table{}.xml", table_global),
                    table_xml.clone(),
                );
            }
        }
    }

    // Pivot table and cache XML files
    for entry in &pivot_data.pivot_table_entries {
        let pivot_table_path = format!("xl/pivotTables/pivotTable{}.xml", entry.global_idx);
        zip.add_file(&pivot_table_path, entry.xml.clone());
        let pt_rels = package_graph.relationship_manager_for_owner(
            &crate::write::package_graph::PackageOwner::Part {
                path: pivot_table_path,
            },
        );
        if !pt_rels.is_empty() {
            zip.add_file(
                &format!(
                    "xl/pivotTables/_rels/pivotTable{}.xml.rels",
                    entry.global_idx
                ),
                pt_rels.to_xml(),
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
        let cache_rels_xml = package_graph
            .relationship_manager_for_owner(&crate::write::package_graph::PackageOwner::Part {
                path: format!("xl/pivotCache/pivotCacheDefinition{}.xml", entry.global_idx),
            })
            .to_xml();
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
                let chart_path = format!("xl/charts/chart{}.xml", entry.global_idx);
                zip.add_file(&chart_path, entry.xml.clone());

                // Write chart auxiliary files (style XML, colors XML) only
                // when the current chart still carries imported chart identity.
                let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
                if chart_allows_auxiliary_replay(chart_spec)
                    && let Some(srt) = sheet_rt
                {
                    if let Some(aux) = srt.chart_auxiliary_data.get(local_idx) {
                        // Write auxiliary files (style, colors XML) preserving their original paths.
                        for aux_file in &aux.auxiliary_files {
                            if !crate::write::package_graph::is_supported_chart_auxiliary_part(
                                &aux_file.path,
                            ) {
                                continue;
                            }
                            zip.add_file(&aux_file.path, aux_file.data.clone());
                        }
                    }
                }
                let chart_rels = package_graph.relationship_manager_for_owner(
                    &crate::write::package_graph::PackageOwner::Part { path: chart_path },
                );
                if !chart_rels.is_empty() {
                    let rels_path = format!("xl/charts/_rels/chart{}.xml.rels", entry.global_idx);
                    zip.add_file(&rels_path, chart_rels.to_xml());
                }
            }
        }
    }

    // ChartEx XML files + auxiliary files (style, colors, .rels)
    {
        for (sheet_idx, chart_ex_entries) in all_chart_ex_entries.iter().enumerate() {
            let sheet_rt = round_trip_ctx.and_then(|ctx| ctx.sheets.get(sheet_idx));

            for (local_idx, entry) in chart_ex_entries.iter().enumerate() {
                let chart_path = format!("xl/charts/chartEx{}.xml", entry.global_idx);
                zip.add_file(&chart_path, entry.xml.clone());

                // Write ChartEx auxiliary files only when the current chart
                // still carries imported chart identity.
                let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
                if chart_allows_auxiliary_replay(chart_spec)
                    && let Some(srt) = sheet_rt
                {
                    if let Some(aux) = srt.chart_ex_auxiliary_data.get(local_idx) {
                        for aux_file in &aux.auxiliary_files {
                            if !crate::write::package_graph::is_supported_chart_auxiliary_part(
                                &aux_file.path,
                            ) {
                                continue;
                            }
                            zip.add_file(&aux_file.path, aux_file.data.clone());
                        }
                    }
                }
                let chart_rels = package_graph.relationship_manager_for_owner(
                    &crate::write::package_graph::PackageOwner::Part { path: chart_path },
                );
                if !chart_rels.is_empty() {
                    let rels_path = format!("xl/charts/_rels/chartEx{}.xml.rels", entry.global_idx);
                    zip.add_file(&rels_path, chart_rels.to_xml());
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
        for (idx, _) in output.sheets.iter().enumerate() {
            if drawing_xml_data[idx].is_none() {
                continue;
            }

            let drawing_path = worksheet_drawing_relationships
                .iter()
                .find(|entry| entry.sheet_idx == idx)
                .map(|entry| entry.path.as_str())
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing graph-registered drawing part for sheet {}",
                        idx + 1
                    ))
                })?;
            // Derive the .rels path from the drawing path
            let drawing_filename = drawing_path.rsplit('/').next().unwrap_or("drawing.xml");
            let drawing_rels_path = format!("xl/drawings/_rels/{}.rels", drawing_filename);

            if let Some(ref drawing_xml) = drawing_xml_data[idx] {
                zip.add_file(drawing_path, drawing_xml.clone());
            }

            if drawing_rels_should_emit[idx] {
                if let Some(ref drawing_rels_xml) = drawing_rels_data[idx] {
                    zip.add_file(&drawing_rels_path, drawing_rels_xml.clone());
                } else {
                    let drawing_rels = package_graph.relationship_manager_for_owner(
                        &crate::write::package_graph::PackageOwner::Part {
                            path: drawing_path.to_string(),
                        },
                    );
                    zip.add_file(&drawing_rels_path, drawing_rels.to_xml());
                }
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
use styles::{
    append_palette_to_lossless_styles, build_styles, build_styles_from_stylesheet,
    output_references_style_ids,
};

use crate::infra::opc::opc_target_to_zip_path;

fn worksheet_relative_target(zip_path: &str) -> String {
    let path = zip_path.trim_start_matches('/');
    path.strip_prefix("xl/")
        .map(|rest| format!("../{rest}"))
        .unwrap_or_else(|| path.to_string())
}

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

#[cfg(test)]
mod tests;
