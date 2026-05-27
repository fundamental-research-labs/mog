use domain_types::{Hyperlink, RoundTripContext};

use super::assembly::{ChartEntry, ChartExEntry, SheetExtras};
use super::chart_auxiliary;
use super::form_controls::convert_unified_form_controls;
use super::sheet_builder::{apply_outline_groups_rows_only, build_sheet};
use super::{
    chart_allows_auxiliary_replay, comments_have_imported_identity, sheet_preservation,
    should_reconstruct_chart_space, worksheet_custom_properties,
};
use crate::domain::charts::chart_ex_write::serialize_chart_ex_space;
use crate::domain::charts::write_canonical::serialize_chart_space;
use crate::infra::opc::opc_target_to_zip_path;
use crate::write::{SharedStringsWriter, SheetWriter};

pub(super) struct BuiltSheetParts {
    pub(super) sheet_writers: Vec<SheetWriter>,
    pub(super) sheet_extras: Vec<SheetExtras>,
    pub(super) all_chart_entries: Vec<Vec<ChartEntry>>,
    pub(super) all_chart_ex_entries: Vec<Vec<ChartExEntry>>,
}

pub(super) fn build_shared_strings(
    round_trip_ctx: Option<&RoundTripContext>,
) -> SharedStringsWriter {
    if let Some(ctx) = round_trip_ctx {
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
    }
}

pub(super) fn build_sheet_parts(
    output: &domain_types::ParseOutput,
    round_trip_ctx: Option<&RoundTripContext>,
    shared_strings: &mut SharedStringsWriter,
    has_lossless_stylesheet: bool,
) -> BuiltSheetParts {
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
            shared_strings,
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
                if crate::infra::xml::raw_xml_contains_relationship_attr(raw_xml) {
                    continue;
                }
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
                    chart_auxiliary::standard_chart_auxiliary_data(sheet_rt_for_charts, chart_spec)
                        .and_then(chart_auxiliary::standard_chart_number)
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
        }
        let has_charts = !chart_entries_for_sheet.is_empty();
        all_chart_entries.push(chart_entries_for_sheet);

        // ── ChartEx (per-sheet) ─────────────────────────────────────────
        let mut chart_ex_entries_for_sheet: Vec<ChartExEntry> = Vec::new();
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
                    chart_auxiliary::chart_ex_auxiliary_data(sheet_rt_for_charts, chart_spec)
                        .and_then(chart_auxiliary::chart_ex_number)
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
                    let hf_vml_parsed = (!sheet_data.hf_images.is_empty())
                        .then(|| {
                            header_footer_vml_from_opaque_subgraphs(
                                round_trip_ctx,
                                sheet_idx,
                                comment_vml_path.as_deref(),
                                &sheet_data.hf_images,
                            )
                        })
                        .flatten();
                    (
                        None,
                        comment_vml_path,
                        hf_vml_parsed,
                        original_drawing_path_for_export(sheet_data, sheet_rt),
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
        let custom_properties = round_trip_ctx.and_then(|ctx| {
            ctx.sheets.get(sheet_idx).and_then(|sheet_rt| {
                worksheet_custom_properties::custom_properties_for_export(ctx, sheet_rt, sheet_idx)
            })
        });

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
            custom_properties,
        });
    }

    BuiltSheetParts {
        sheet_writers,
        sheet_extras,
        all_chart_entries,
        all_chart_ex_entries,
    }
}

fn original_drawing_path_for_export(
    sheet_data: &domain_types::SheetData,
    sheet_rt: &domain_types::SheetRoundTripContext,
) -> Option<String> {
    let original_path = sheet_rt.original_drawing_path.as_ref()?;
    let imported_path = sheet_rt
        .imported_drawing
        .as_ref()
        .map(|drawing| drawing.path.trim_start_matches('/').replace('\\', "/"));
    if imported_path.as_deref() != Some(original_path.trim_start_matches('/')) {
        return None;
    }
    current_sheet_has_imported_drawing_identity(sheet_data).then(|| original_path.clone())
}

fn current_sheet_has_imported_drawing_identity(sheet_data: &domain_types::SheetData) -> bool {
    sheet_data
        .charts
        .iter()
        .any(|chart| chart.chart_frame.is_some())
        || sheet_data
            .floating_objects
            .iter()
            .any(floating_object_has_imported_drawing_identity)
}

fn floating_object_has_imported_drawing_identity(
    object: &domain_types::domain::floating_object::FloatingObject,
) -> bool {
    use domain_types::domain::floating_object::FloatingObjectData;

    match &object.data {
        FloatingObjectData::Picture(data) => data.ooxml.is_some(),
        FloatingObjectData::Shape(data) => data.ooxml.is_some(),
        FloatingObjectData::Textbox(data) => data.ooxml.is_some(),
        FloatingObjectData::Connector(data) => data.ooxml.is_some(),
        FloatingObjectData::Chart(data) => data
            .ooxml
            .as_ref()
            .and_then(|ooxml| ooxml.drawing_frame.as_ref())
            .is_some(),
        FloatingObjectData::OleObject(data) => data.ooxml.is_some(),
        FloatingObjectData::FormControl(data) => data.ooxml.is_some(),
        _ => false,
    }
}

fn header_footer_vml_from_opaque_subgraphs(
    round_trip_ctx: Option<&RoundTripContext>,
    sheet_idx: usize,
    comment_vml_path: Option<&str>,
    modeled_images: &[domain_types::domain::print::HeaderFooterImageInfo],
) -> Option<crate::domain::print::hf_images::ParsedHfVml> {
    let clean_subgraphs =
        crate::write::opaque_subgraph::normalized_round_trip_opaque_subgraphs(round_trip_ctx);
    for subgraph in clean_subgraphs {
        if !emits_clean_opaque_part(subgraph.ownership) {
            continue;
        }
        if !subgraph_allows_hf_vml_for_sheet(&subgraph, sheet_idx) {
            continue;
        }
        for part in subgraph.parts.iter().filter(|part| {
            emits_clean_opaque_part(part.ownership)
                && part.part.path.ends_with(".vml")
                && comment_vml_path != Some(part.part.path.as_str())
        }) {
            let rels_path = crate::write::package_graph::part_relationships_path(&part.part.path);
            let rels_data = opaque_relationships_xml_for_owner(&subgraph, &part.part.path);
            let Some(parsed) = crate::domain::print::hf_images::parse_hf_vml_context(
                &part.part.path,
                &part.part.data,
                Some(&rels_path),
                rels_data.as_deref(),
            ) else {
                continue;
            };
            if let Some(filtered) =
                filter_hf_vml_to_modeled_clean_images(parsed, modeled_images, &subgraph)
            {
                return Some(filtered);
            }
        }
    }
    None
}

fn subgraph_allows_hf_vml_for_sheet(
    subgraph: &domain_types::OpaquePackageSubgraph,
    sheet_idx: usize,
) -> bool {
    match &subgraph.owner {
        domain_types::OpaquePackageOwner::Worksheet { index, .. } => *index == sheet_idx,
        _ => true,
    }
}

fn opaque_relationships_xml_for_owner(
    subgraph: &domain_types::OpaquePackageSubgraph,
    owner_path: &str,
) -> Option<Vec<u8>> {
    let owner_path = normalize_path(owner_path);
    let mut rels = crate::write::relationships::RelationshipManager::new();
    let mut has_relationships = false;
    for relationship in &subgraph.relationships {
        let domain_types::OpaquePackageOwner::Part { path } = &relationship.owner else {
            continue;
        };
        if normalize_path(path) != owner_path {
            continue;
        }
        let target = match &relationship.target {
            domain_types::OpaqueRelationshipTarget::InternalPart { path } => {
                relative_target(&owner_path, path)
            }
            domain_types::OpaqueRelationshipTarget::InternalPath { target } => target.clone(),
            domain_types::OpaqueRelationshipTarget::External { target } => target.clone(),
        };
        if let Some(id) = &relationship.relationship_id_hint {
            rels.add_with_id(id, &relationship.relationship_type, &target);
        } else {
            rels.add(&relationship.relationship_type, &target);
        }
        has_relationships = true;
    }
    has_relationships.then(|| rels.to_xml())
}

fn emits_clean_opaque_part(ownership: domain_types::OpaquePackageOwnership) -> bool {
    matches!(
        ownership,
        domain_types::OpaquePackageOwnership::CleanImported
            | domain_types::OpaquePackageOwnership::OrphanCleanPackageData
    )
}

fn filter_hf_vml_to_modeled_clean_images(
    mut hf_vml: crate::domain::print::hf_images::ParsedHfVml,
    modeled_images: &[domain_types::domain::print::HeaderFooterImageInfo],
    subgraph: &domain_types::OpaquePackageSubgraph,
) -> Option<crate::domain::print::hf_images::ParsedHfVml> {
    let modeled_by_target: std::collections::HashMap<
        String,
        &domain_types::domain::print::HeaderFooterImageInfo,
    > = modeled_images
        .iter()
        .filter_map(|image| {
            normalize_hf_image_target(&hf_vml.vml_path, &image.src).map(|target| (target, image))
        })
        .collect();

    let modeled_by_rel_id: std::collections::HashMap<
        String,
        &domain_types::domain::print::HeaderFooterImageInfo,
    > = hf_vml
        .image_targets
        .iter()
        .filter_map(|(rel_id, target)| {
            let target_path = normalize_hf_image_target(&hf_vml.vml_path, target)?;
            let modeled = modeled_by_target.get(&target_path).copied()?;
            (subgraph_contains_clean_part(subgraph, &target_path)
                && modeled_hf_position_matches(modeled.position, rel_id, &hf_vml.images))
            .then(|| (rel_id.clone(), modeled))
        })
        .collect();

    hf_vml.images.retain_mut(|image| {
        let Some(modeled) = modeled_by_rel_id.get(&image.image_rel_id) else {
            return false;
        };
        if !hf_image_positions_match(image.position, modeled.position) {
            return false;
        }
        image.title = modeled.title.clone();
        image.width_pt = modeled.width_pt;
        image.height_pt = modeled.height_pt;
        true
    });
    if hf_vml.images.is_empty() {
        return None;
    }

    hf_vml
        .image_targets
        .retain(|(rel_id, _)| modeled_by_rel_id.contains_key(rel_id));
    Some(hf_vml)
}

fn subgraph_contains_clean_part(
    subgraph: &domain_types::OpaquePackageSubgraph,
    path: &str,
) -> bool {
    let normalized = normalize_path(path);
    subgraph.parts.iter().any(|part| {
        emits_clean_opaque_part(part.ownership) && normalize_path(&part.part.path) == normalized
    })
}

fn normalize_hf_image_target(vml_path: &str, target: &str) -> Option<String> {
    if target.starts_with("data:") {
        return None;
    }
    if target.trim_start_matches('/').starts_with("xl/") {
        return Some(target.trim_start_matches('/').to_string());
    }
    crate::infra::opc::resolve_relationship_target(Some(vml_path), target).ok()
}

fn normalize_path(path: &str) -> String {
    path.trim_start_matches('/').replace('\\', "/")
}

fn relative_target(owner_path: &str, target_path: &str) -> String {
    let owner_path = normalize_path(owner_path);
    let target_path = normalize_path(target_path);
    let owner_dir = owner_path.rsplit_once('/').map_or("", |(dir, _)| dir);
    let from_components: Vec<_> = owner_dir
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let to_components: Vec<_> = target_path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let common = from_components
        .iter()
        .zip(&to_components)
        .take_while(|(a, b)| a == b)
        .count();
    let mut result = vec![".."; from_components.len() - common];
    result.extend(to_components[common..].iter().copied());
    result.join("/")
}

fn modeled_hf_position_matches(
    position: domain_types::domain::print::HfImagePosition,
    rel_id: &str,
    images: &[crate::domain::print::hf_images::HeaderFooterImage],
) -> bool {
    images
        .iter()
        .find(|image| image.image_rel_id == rel_id)
        .is_some_and(|image| hf_image_positions_match(image.position, position))
}

fn hf_image_positions_match(
    parsed: crate::domain::print::hf_images::HfImagePosition,
    modeled: domain_types::domain::print::HfImagePosition,
) -> bool {
    matches!(
        (parsed, modeled),
        (
            crate::domain::print::hf_images::HfImagePosition::LeftHeader,
            domain_types::domain::print::HfImagePosition::LeftHeader
        ) | (
            crate::domain::print::hf_images::HfImagePosition::CenterHeader,
            domain_types::domain::print::HfImagePosition::CenterHeader
        ) | (
            crate::domain::print::hf_images::HfImagePosition::RightHeader,
            domain_types::domain::print::HfImagePosition::RightHeader
        ) | (
            crate::domain::print::hf_images::HfImagePosition::LeftFooter,
            domain_types::domain::print::HfImagePosition::LeftFooter
        ) | (
            crate::domain::print::hf_images::HfImagePosition::CenterFooter,
            domain_types::domain::print::HfImagePosition::CenterFooter
        ) | (
            crate::domain::print::hf_images::HfImagePosition::RightFooter,
            domain_types::domain::print::HfImagePosition::RightFooter
        )
    )
}
