use domain_types::Hyperlink;

use super::assembly::{ChartEntry, ChartExEntry, SheetExtras};
use super::chart_auxiliary;
use super::form_control_export_plan::build_form_control_export_plan;
use super::form_controls::convert_unified_form_controls;
use super::ole_objects::convert_unified_ole_objects;
use super::sheet_builder::{apply_outline_groups_rows_only, build_sheet};
use super::sheet_ext_merge::merge_ext_lst_entries;
use super::style_remap::StyleExportRemapper;
use super::{chart_replay, sheet_preservation};
use crate::domain::charts::chart_ex::write::serialize_chart_ex_space;
use crate::domain::charts::write_canonical::serialize_chart_space;
use crate::infra::xml_namespaces::NamespaceMap;
use crate::write::{SharedStringsWriter, SheetWriter};

pub(super) struct BuiltSheetParts {
    pub(super) sheet_writers: Vec<SheetWriter>,
    pub(super) sheet_extras: Vec<SheetExtras>,
    pub(super) all_chart_entries: Vec<Vec<ChartEntry>>,
    pub(super) all_chart_ex_entries: Vec<Vec<ChartExEntry>>,
}

pub(super) fn build_shared_strings(output: &domain_types::ParseOutput) -> SharedStringsWriter {
    let capacity = output
        .sheets
        .iter()
        .map(|sheet| sheet.cells.len())
        .sum::<usize>();
    SharedStringsWriter::with_capacity(capacity)
}

pub(super) fn build_sheet_parts(
    output: &domain_types::ParseOutput,
    shared_strings: &mut SharedStringsWriter,
    style_remapper: &StyleExportRemapper,
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

    // Metadata refs are emitted only with an authoritative modeled metadata part.
    let emit_cell_metadata_refs = output.metadata.as_ref().is_some_and(|m| !m.is_empty());
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
        let mut sheet_writer = build_sheet(
            sheet_data,
            shared_strings,
            &data_table_body_positions,
            &sheet_data_table_regions,
            emit_cell_metadata_refs,
            style_remapper,
        );
        if !sheet_data.worksheet_root_namespaces.is_empty() {
            sheet_writer
                .set_root_namespaces(NamespaceMap::from(&sheet_data.worksheet_root_namespaces));
        }

        // ── Sheet UID (xr:uid on <worksheet> root) ───────────────────
        if let Some(ref uid) = sheet_data.uid {
            sheet_writer.set_uid(uid.clone());
        }
        if !sheet_data.worksheet_semantic_containers.is_empty() {
            sheet_writer.set_worksheet_semantic_containers(
                sheet_data.worksheet_semantic_containers.clone(),
            );
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
        // The former raw data-validations sidecar has been removed.
        if !sheet_data.data_validations.is_empty()
            || sheet_data.data_validations_disable_prompts
            || sheet_data.data_validations_x_window.is_some()
            || sheet_data.data_validations_y_window.is_some()
            || sheet_data.data_validations_declared_count.is_some()
        {
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
        sheet_preservation::apply_visible_row_hints_for_export(&mut sheet_writer, sheet_data);
        // ── Auto Filter ─────────────────────────────────────────────────
        // Typed OOXML preservation: auto filter now reconstructs from the typed
        // `SheetData.auto_filter` only. The former raw-XML sidecar
        // fallback on raw auto-filter XML is gone — the
        // domain type is lossless over CT_AutoFilter.
        let strict_output = output
            .workbook_conformance
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case("strict"));
        if let Some(ref af) = sheet_data.auto_filter {
            let xml = crate::domain::auto_filter::write::write_auto_filter_xml_with_strict(
                af,
                strict_output,
            );
            sheet_writer.set_auto_filter_xml(xml);
        }

        // ── Sort State ──────────────────────────────────────────────────
        // Typed OOXML preservation: worksheet-level sort state now reconstructs from
        // the typed `SheetData.sort_state`. The former raw-XML sidecar on
        // raw sort-state sidecar was silently dropping sort
        // state on the Yrs-hydration path whenever the blob was absent.
        if let Some(ref ss) = sheet_data.sort_state {
            let xml = crate::domain::auto_filter::write::write_sort_state_xml(ss);
            sheet_writer.set_sort_state_xml(xml);
        }

        // ── Sparklines / extLst ──────────────────────────────────────────
        let mut ext_entries = Vec::new();
        if !sheet_data.sparkline_groups.is_empty() {
            let xml = crate::domain::sparklines::write::sparkline_groups_xml_from_domain(
                &sheet_data.name,
                &sheet_data.sparklines,
                &sheet_data.sparkline_groups,
            );
            ext_entries.push(xml);
        } else if !sheet_data.sparklines.is_empty() {
            let xml = crate::domain::sparklines::write::sparklines_xml_from_domain(
                &sheet_data.name,
                &sheet_data.sparklines,
            );
            ext_entries.push(xml);
        }
        if !sheet_data.x14_data_validations.is_empty()
            || sheet_data.x14_data_validations_disable_prompts
            || sheet_data.x14_data_validations_x_window.is_some()
            || sheet_data.x14_data_validations_y_window.is_some()
            || sheet_data.x14_data_validations_declared_count.is_some()
        {
            let xml =
                crate::domain::validation::write::x14_validations_ext_xml_from_domain_with_opts(
                    &sheet_data.x14_data_validations,
                    sheet_data.x14_data_validations_disable_prompts,
                    sheet_data.x14_data_validations_x_window,
                    sheet_data.x14_data_validations_y_window,
                    sheet_data.x14_data_validations_declared_count,
                );
            if !xml.is_empty() {
                ext_entries.push(xml);
            }
        }
        if !sheet_data.conditional_formats.is_empty() {
            let xml =
                crate::domain::cond_format::write::x14_conditional_formatting_ext_xml_from_domain(
                    &sheet_data.conditional_formats,
                );
            if !xml.is_empty() {
                ext_entries.push(xml);
            }
        }
        if sheet_data.worksheet_ext_lst_xml.is_some() || !ext_entries.is_empty() {
            let merged_ext_lst =
                merge_ext_lst_entries(sheet_data.worksheet_ext_lst_xml.as_deref(), &ext_entries);
            if !merged_ext_lst.is_empty() {
                sheet_writer.set_ext_lst_xml(merged_ext_lst);
            }
        }

        // ── Comments ────────────────────────────────────────────────────
        let comments_data = if !sheet_data.comments.is_empty() {
            let original_authors = (!sheet_data.legacy_comment_authors.is_empty())
                .then_some(sheet_data.legacy_comment_authors.as_slice());
            let root_ns_attrs = sheet_data.comment_package.as_ref().and_then(|package| {
                (!package.comments_root_namespace_attrs.is_empty())
                    .then_some(package.comments_root_namespace_attrs.as_slice())
            });
            let root_ext_lst_xml = sheet_data
                .comment_package
                .as_ref()
                .and_then(|package| package.comments_ext_lst_xml.as_deref());
            let (comments_xml, generated_vml_xml) =
                crate::domain::comments::write::comments_from_domain_with_package(
                    sheet_num,
                    &sheet_data.comments,
                    original_authors,
                    root_ns_attrs,
                    root_ext_lst_xml,
                    sheet_data.comment_package.as_ref(),
                );
            Some((comments_xml, generated_vml_xml))
        } else {
            None
        };

        // ── Threaded Comments ────────────────────────────────────────────
        let threaded_root_ns_attrs = sheet_data.comment_package.as_ref().and_then(|package| {
            (!package.threaded_comments_root_namespace_attrs.is_empty())
                .then_some(package.threaded_comments_root_namespace_attrs.as_slice())
        });
        let threaded_comments = crate::domain::comments::write::threaded_comments_xml_from_domain(
            &sheet_data.comments,
            threaded_root_ns_attrs,
        );

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
                crate::domain::tables::write::table_writer_from_domain_with_strict(
                    table_id,
                    table_spec,
                    strict_output,
                )
                .to_xml(),
            );
        }

        // ── Charts (per-sheet) ──────────────────────────────────────────
        // We zip chart_specs with chart_entries later, so only increment the
        // global counter AFTER successful deserialization to keep them aligned.
        let mut chart_entries_for_sheet: Vec<ChartEntry> = Vec::new();
        for (source_idx, chart_spec) in sheet_data.charts.iter().enumerate() {
            if chart_spec.is_chart_ex {
                continue; // handled by ChartEx pipeline below
            }
            // Reconstruct from typed fields when present so modeled chart edits
            // are not overridden by stale preserved ChartSpace XML.
            let chart_xml = if chart_replay::should_reconstruct_chart_space(chart_spec) {
                let chart_space =
                    crate::domain::charts::reconstruct::reconstruct_chart_space(chart_spec);
                serialize_chart_space(&chart_space)
            } else {
                match &chart_spec.definition {
                    Some(domain_types::ChartDefinition::Chart(cs)) => serialize_chart_space(cs),
                    _ => continue, // not a standard chart
                }
            };
            // Preserve original chart number from the imported chart object when available.
            // E.g., if original was "xl/charts/chart2.xml", extract 2 instead of using
            // the sequential counter (which would produce chart1.xml).
            let original_idx = chart_replay::chart_allows_auxiliary_replay(chart_spec)
                .then(|| {
                    chart_auxiliary::chart_auxiliary_data(chart_spec)
                        .and_then(|aux| chart_auxiliary::standard_chart_number(&aux))
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
            // Preserve original chartEx number from the imported chart object when available.
            let original_idx = chart_replay::chart_ex_original_number(chart_spec).or_else(|| {
                chart_replay::chart_allows_auxiliary_replay(chart_spec)
                    .then(|| {
                        chart_auxiliary::chart_auxiliary_data(chart_spec)
                            .and_then(|aux| chart_auxiliary::chart_ex_number(&aux))
                    })
                    .flatten()
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
            let chart_path = format!("xl/charts/chartEx{idx}.xml");
            let chart_ex_xml =
                if chart_replay::chart_ex_allows_opaque_replay(chart_spec, &chart_path) {
                    chart_spec
                        .chart_ex_replay
                        .as_ref()
                        .map(|replay| replay.original_xml.clone())
                        .unwrap_or_else(|| serialize_chart_ex_space(chart_ex_space))
                } else {
                    serialize_chart_ex_space(chart_ex_space)
                };
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

        let (
            original_comment_path,
            original_vml_path,
            hf_vml,
            original_drawing_path,
            original_drawing_relationship_id,
        ) = (
            sheet_data
                .comment_package
                .as_ref()
                .and_then(|package| package.comments_path_hint.clone()),
            sheet_data
                .comment_package
                .as_ref()
                .and_then(|package| package.vml_path_hint.clone()),
            None,
            sheet_data
                .drawing_package
                .as_ref()
                .and_then(|package| package.drawing_path_hint.clone()),
            sheet_data
                .drawing_package
                .as_ref()
                .and_then(|package| package.drawing_relationship_id_hint.clone()),
        );

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
        let ole_objects = convert_unified_ole_objects(&sheet_data.floating_objects);
        let form_control_plan =
            build_form_control_export_plan(&form_controls, &sheet_data.comments, &ole_objects);
        let custom_properties = None;

        sheet_writers.push(sheet_writer);
        sheet_extras.push(SheetExtras {
            comments: comments_data,
            threaded_comments,
            tables: table_xmls,
            source_tables: sheet_data.tables.clone(),
            has_external_hyperlinks,
            has_charts,
            has_chart_ex,
            has_floating_objects,
            original_comment_path,
            original_comment_relationship_id: sheet_data
                .comment_package
                .as_ref()
                .and_then(|package| package.comments_relationship_id_hint.clone()),
            original_vml_path,
            original_vml_relationship_id: sheet_data
                .comment_package
                .as_ref()
                .and_then(|package| package.vml_relationship_id_hint.clone()),
            original_threaded_comments_path: sheet_data
                .comment_package
                .as_ref()
                .and_then(|package| package.threaded_comments_path_hint.clone()),
            original_threaded_comments_relationship_id: sheet_data
                .comment_package
                .as_ref()
                .and_then(|package| package.threaded_comments_relationship_id_hint.clone()),
            hf_vml,
            original_drawing_path,
            original_drawing_relationship_id,
            has_printer_settings,
            form_controls: form_control_plan.controls,
            form_control_diagnostics: form_control_plan.diagnostics,
            ole_objects,
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
