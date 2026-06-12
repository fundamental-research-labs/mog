//! Unified XLSX writer that consumes `ParseOutput` from domain-types.
//!
//! Modeled workbook state is generated from domain types.
//!
//! UTF-8 boundary guard: the two `&s[..n]` slices in this file truncate
//! ASCII-only identifier strings (relationship IDs, hyperlink target
//! fragments) at ASCII-delimiter byte offsets. Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

mod assembly;
mod chart_auxiliary;
mod chart_extents;
mod chart_replay;
mod differential_formats;
mod doc_props;
mod export_context;
mod export_report;
mod external_links;
mod form_control_export_plan;
mod form_controls;
mod hyperlink_targets;
mod media;
mod metadata;
mod ole_objects;
mod pivot_package;
mod preflight_phase;
mod printer_settings;
mod relationship_ids;
mod rich_data;
mod sheet_builder;
mod sheet_cells;
mod sheet_columns;
mod sheet_ext_merge;
mod sheet_formulas;
mod sheet_outlines;
mod sheet_parts;
mod sheet_preservation;
mod sheet_rows;
mod sheet_views;
mod style_remap;
mod styles;
mod table_export_plan;
mod theme_parts;
mod threaded_comments;
mod vml_merge;
mod workbook_parts;
mod worksheet_custom_properties;
mod zip_assembly;

use domain_types::ParseOutput;
use domain_types::domain::hyperlink::HyperlinkTargetKind;
// ChartSpec / AnchorPosition are re-exported from domain_types::domain::chart via domain_types::*
// but we don't need them as standalone imports — they're accessed via sheet_data.charts.

use super::write_error::WriteError;
use crate::domain::drawings::write::{
    AbsoluteAnchor, CellAnchor, ChartExRef, ChartRef, ClientData, DrawingAnchor, DrawingObject,
    DrawingWriter, Extent, OneCellAnchor, Position, TwoCellAnchor,
};
use crate::write::relationships::{RelationshipManager, create_sheet_rels};
use crate::write::{
    ControlsWriter, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CTRL_PROP, REL_DRAWING,
    REL_HYPERLINK, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS, REL_SLICER, REL_TABLE,
    REL_THREADED_COMMENT, REL_VML_DRAWING,
};

use assembly::{
    ChartAuxiliaryRelationshipGraphEntry, ChartEntry, ChartExEntry, DrawingRelationshipGraphEntry,
    VmlPreviewRelationshipGraphEntry, WorksheetCommentsGraphEntry,
    WorksheetControlPropertyGraphEntry, WorksheetDrawingGraphEntry,
    WorksheetFormControlVmlGraphEntry, WorksheetHeaderFooterVmlGraphEntry,
    WorksheetHyperlinkGraphEntry, WorksheetOleObjectGraphEntry, WorksheetOleVmlGraphEntry,
    WorksheetPrinterSettingsGraphEntry, WorksheetTableGraphEntry,
    WorksheetThreadedCommentsGraphEntry,
};

pub use export_report::{
    ExportDiagnostic, ExportDiagnosticCode, ExportReport, ExportSemanticImpact,
};
pub use sheet_ext_merge::strip_modeled_x14_data_validations_from_ext_lst;

fn worksheet_legacy_vml_path(
    sheet_idx: usize,
    comments: &[WorksheetCommentsGraphEntry],
    form_controls: &[WorksheetFormControlVmlGraphEntry],
    ole_vml: &[WorksheetOleVmlGraphEntry],
) -> Option<String> {
    comments
        .iter()
        .find(|entry| entry.sheet_idx == sheet_idx)
        .map(|entry| entry.vml_path.clone())
        .or_else(|| {
            form_controls
                .iter()
                .find(|entry| entry.sheet_idx == sheet_idx)
                .map(|entry| entry.path.clone())
        })
        .or_else(|| {
            ole_vml
                .iter()
                .find(|entry| entry.sheet_idx == sheet_idx)
                .map(|entry| entry.path.clone())
        })
}

fn imported_worksheet_hyperlink_relationship_id(
    output: &ParseOutput,
    sheet_num: usize,
    target: &str,
    target_mode: Option<&str>,
) -> Option<String> {
    let owner_path = format!("xl/worksheets/sheet{sheet_num}.xml");
    output
        .package_fidelity
        .as_ref()?
        .part_relationships
        .iter()
        .find(|info| info.owner_path == owner_path)?
        .relationships
        .iter()
        .find(|relationship| {
            relationship.relationship_type == REL_HYPERLINK
                && relationship.target == target
                && relationship.target_mode.as_deref() == target_mode
        })
        .map(|relationship| relationship.id.clone())
}

#[derive(Debug, Default)]
struct DrawingPathAllocator {
    reserved: std::collections::BTreeSet<String>,
    used: std::collections::BTreeSet<String>,
    next_idx: usize,
}

impl DrawingPathAllocator {
    fn from_output(
        output: &ParseOutput,
        all_chart_entries: &[Vec<ChartEntry>],
        all_chart_ex_entries: &[Vec<ChartExEntry>],
    ) -> Self {
        let mut allocator = Self {
            next_idx: 1,
            ..Self::default()
        };
        if let Some(package_fidelity) = &output.package_fidelity {
            for part in &package_fidelity.opaque_parts {
                allocator.reserve_if_drawing_family(&part.path);
            }
        }
        for (sheet_idx, chart_entries) in all_chart_entries.iter().enumerate() {
            for entry in chart_entries {
                let chart_path = format!("xl/charts/chart{}.xml", entry.global_idx);
                let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
                allocator.reserve_chart_auxiliary_paths(chart_spec, &chart_path);
            }
        }
        for (sheet_idx, chart_ex_entries) in all_chart_ex_entries.iter().enumerate() {
            for entry in chart_ex_entries {
                let chart_path = format!("xl/charts/chartEx{}.xml", entry.global_idx);
                let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
                allocator.reserve_chart_auxiliary_paths(chart_spec, &chart_path);
            }
        }
        allocator
    }

    fn reserve_chart_auxiliary_paths(
        &mut self,
        chart_spec: &domain_types::ChartSpec,
        chart_path: &str,
    ) {
        if !chart_replay::chart_allows_current_auxiliary_replay(chart_spec, chart_path) {
            return;
        }
        let Some(aux) = chart_auxiliary::chart_auxiliary_data(chart_spec) else {
            return;
        };
        for path in chart_auxiliary::supported_auxiliary_file_paths(&aux, chart_path) {
            self.reserve_if_drawing_family(&path);
        }
    }

    fn reserve_if_drawing_family(&mut self, path: &str) {
        let normalized = domain_types::normalize_package_path(path);
        if Self::drawing_family_index(&normalized).is_some() {
            self.reserved.insert(normalized);
        }
    }

    fn allocate(&mut self, preferred_path: Option<&str>) -> String {
        if let Some(path) = preferred_path.map(domain_types::normalize_package_path)
            && Self::drawing_family_index(&path).is_some()
            && !self.reserved.contains(&path)
            && self.used.insert(path.clone())
        {
            return path;
        }
        loop {
            let path = format!("xl/drawings/drawing{}.xml", self.next_idx);
            self.next_idx += 1;
            if self.reserved.contains(&path) {
                continue;
            }
            if self.used.insert(path.clone()) {
                return path;
            }
        }
    }

    fn drawing_family_index(path: &str) -> Option<usize> {
        let file_name = path.rsplit('/').next()?;
        let number = file_name.strip_prefix("drawing")?.strip_suffix(".xml")?;
        number.parse().ok()
    }
}

/// Write an XLSX file from a `ParseOutput`.
///
/// Modeled workbook state is generated from domain types.
pub fn write_xlsx_from_parse_output(output: &ParseOutput) -> Result<Vec<u8>, WriteError> {
    reject_unsupported_package_profile(output)?;

    let export_context::WorkbookPreflight {
        output: remapped_output,
        styles_writer,
        shared_strings,
        mut sheet_writers,
        sheet_extras,
        all_chart_entries,
        all_chart_ex_entries,
        pivot_data,
        mut all_image_blobs,
    } = preflight_phase::run(output);
    let output = &remapped_output;

    // ── Build sheet rels and assign r:ids ────────────────────────────────
    // We need to build rels for each sheet and update hyperlink/table r:ids.
    let mut sheet_hyperlink_outputs: Vec<Option<Vec<crate::output::results::HyperlinkOutput>>> =
        vec![None; output.sheets.len()];
    let mut worksheet_hyperlink_relationships: Vec<WorksheetHyperlinkGraphEntry> = Vec::new();
    let mut worksheet_control_property_relationships: Vec<WorksheetControlPropertyGraphEntry> =
        Vec::new();
    let mut worksheet_header_footer_vml_relationships: Vec<WorksheetHeaderFooterVmlGraphEntry> =
        Vec::new();
    let mut worksheet_form_control_vml_relationships: Vec<WorksheetFormControlVmlGraphEntry> =
        Vec::new();
    let mut worksheet_ole_object_relationships: Vec<WorksheetOleObjectGraphEntry> = Vec::new();
    let mut worksheet_ole_vml_relationships: Vec<WorksheetOleVmlGraphEntry> = Vec::new();
    let mut vml_preview_relationships: Vec<VmlPreviewRelationshipGraphEntry> = Vec::new();
    let mut worksheet_drawing_relationships: Vec<WorksheetDrawingGraphEntry> = Vec::new();
    let mut drawing_relationships: Vec<DrawingRelationshipGraphEntry> = Vec::new();
    let mut chart_auxiliary_relationships: Vec<ChartAuxiliaryRelationshipGraphEntry> = Vec::new();
    let mut worksheet_printer_settings_relationships: Vec<WorksheetPrinterSettingsGraphEntry> =
        Vec::new();
    let mut worksheet_comments_relationships: Vec<WorksheetCommentsGraphEntry> = Vec::new();
    let mut worksheet_threaded_comments_relationships: Vec<WorksheetThreadedCommentsGraphEntry> =
        Vec::new();
    let mut worksheet_table_relationships: Vec<WorksheetTableGraphEntry> = Vec::new();
    let mut worksheet_pivot_table_relationships: Vec<(usize, String, String)> = Vec::new();
    let mut worksheet_slicer_relationships: Vec<(usize, usize)> = Vec::new();
    let mut worksheet_timeline_relationships: Vec<(usize, usize)> = Vec::new();

    // Per-sheet drawing XML (the drawingN.xml content).
    let mut drawing_xml_data: Vec<Option<Vec<u8>>> = Vec::with_capacity(output.sheets.len());
    let mut drawing_writer_data: Vec<Option<DrawingWriter>> =
        Vec::with_capacity(output.sheets.len());

    // Track which sheets have drawings (for content types).
    let mut sheets_with_drawings: Vec<usize> = Vec::new();
    let mut drawing_path_allocator =
        DrawingPathAllocator::from_output(output, &all_chart_entries, &all_chart_ex_entries);

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
    let mut global_slicer_idx: usize = 0;
    let mut global_timeline_idx: usize = 0;

    // Also re-process hyperlinks to assign correct r:ids.
    for (sheet_idx, sheet_data) in output.sheets.iter().enumerate() {
        let extras = &sheet_extras[sheet_idx];
        let has_comments = extras.comments.is_some();
        let has_threaded_comments = extras.threaded_comments.is_some();
        let has_tables = !extras.tables.is_empty();
        let has_slicers = !sheet_data.slicers.is_empty();
        let has_timelines = !sheet_data.timelines.is_empty();
        let has_hyperlinks = extras.has_external_hyperlinks;
        let has_charts = extras.has_charts;
        let has_chart_ex = extras.has_chart_ex;
        let has_floating_objects = extras.has_floating_objects;
        let has_slicer_anchors = !sheet_data.slicer_anchors.is_empty();
        let has_timeline_anchors = !sheet_data.timeline_anchors.is_empty();
        let needs_drawing = has_charts
            || has_chart_ex
            || has_floating_objects
            || has_slicer_anchors
            || has_timeline_anchors;

        let has_printer_settings = extras.has_printer_settings;
        let has_hf_vml = extras.hf_vml.is_some();
        let has_form_controls = !extras.form_controls.is_empty();
        let has_ole_objects = !extras.ole_objects.is_empty();
        let has_custom_properties = extras.custom_properties.is_some();
        let has_pivot_tables = pivot_data
            .pivot_table_entries
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
            && !has_ole_objects
            && !has_custom_properties
            && !has_pivot_tables
            && !has_slicers
            && !has_timelines
        {
            drawing_xml_data.push(None);
            drawing_writer_data.push(None);
            continue;
        }

        let sheet_num = sheet_idx + 1;
        let mut rels = create_sheet_rels();

        // Hyperlink rels (external URLs and internal links stored as rels).
        if has_hyperlinks || !sheet_data.hyperlinks.is_empty() {
            let mut hyperlink_outputs = Vec::with_capacity(sheet_data.hyperlinks.len());
            for hl in &sheet_data.hyperlinks {
                let Some(target) = hl.target.clone() else {
                    hyperlink_outputs.push(crate::output::results::HyperlinkOutput {
                        cell_ref: hl.cell_ref.clone(),
                        location: hl.location.clone().unwrap_or_default(),
                        display: hl.display.clone().unwrap_or_default(),
                        tooltip: hl.tooltip.clone().unwrap_or_default(),
                        target: None,
                        r_id: None,
                        uid: hl.uid.clone(),
                        target_kind: hl.target_kind,
                        target_mode: hl.target_mode.clone(),
                    });
                    continue;
                };
                let target_kind = hl.target_kind.or_else(|| {
                    if hyperlink_targets::needs_relationship(&target) {
                        Some(HyperlinkTargetKind::Relationship)
                    } else {
                        Some(HyperlinkTargetKind::InlineLocation)
                    }
                });
                if target_kind == Some(HyperlinkTargetKind::InlineLocation) {
                    hyperlink_outputs.push(crate::output::results::HyperlinkOutput {
                        cell_ref: hl.cell_ref.clone(),
                        location: hl.location.clone().unwrap_or(target),
                        display: hl.display.clone().unwrap_or_default(),
                        tooltip: hl.tooltip.clone().unwrap_or_default(),
                        target: None,
                        r_id: None,
                        uid: hl.uid.clone(),
                        target_kind,
                        target_mode: hl.target_mode.clone(),
                    });
                    continue;
                }

                let target_mode = hl.target_mode.clone().or_else(|| {
                    if target.starts_with('#') {
                        None
                    } else {
                        Some("External".to_string())
                    }
                });
                let r_id = rels.add_with_target_mode(REL_HYPERLINK, &target, target_mode.clone());
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
                    target: Some(target.clone()),
                    r_id: Some(r_id),
                    uid: hl.uid.clone(),
                    target_kind,
                    target_mode: target_mode.clone(),
                });
                worksheet_hyperlink_relationships.push(WorksheetHyperlinkGraphEntry {
                    sheet_idx,
                    hyperlink_idx,
                    target,
                    target_mode,
                    relationship_id_hint: imported_worksheet_hyperlink_relationship_id(
                        output,
                        sheet_num,
                        hyperlink_outputs[hyperlink_idx]
                            .target
                            .as_deref()
                            .unwrap_or_default(),
                        hyperlink_outputs[hyperlink_idx].target_mode.as_deref(),
                    )
                    .or_else(|| hyperlink_outputs[hyperlink_idx].r_id.clone()),
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
            if let Some(n) = extract_comment_number(&comments_path) {
                global_comment_idx = global_comment_idx.max(n);
            }
            let comments_target = worksheet_relative_target(&comments_path);
            let generated_comments_r_id = rels.add(REL_COMMENTS, &comments_target);
            let comments_relationship_id_hint = sheet_extras[sheet_idx]
                .original_comment_relationship_id
                .clone()
                .or(Some(generated_comments_r_id));
            let vml_path = sheet_extras[sheet_idx]
                .original_vml_path
                .clone()
                .unwrap_or_else(|| format!("xl/drawings/vmlDrawing{}.vml", global_vml_idx));
            if let Some(n) = extract_vml_drawing_number(&vml_path) {
                global_vml_idx = global_vml_idx.max(n);
            }
            let vml_target = worksheet_relative_target(&vml_path);
            let generated_vml_r_id = rels.add(REL_VML_DRAWING, &vml_target);
            let vml_relationship_id_hint = sheet_extras[sheet_idx]
                .original_vml_relationship_id
                .clone()
                .or(Some(generated_vml_r_id));
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
            let relationship_id_hint = Some(rels.add(REL_VML_DRAWING, &hf_target));
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
                let r_id = rels.add(REL_CTRL_PROP, &target);
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
                let relationship_id_hint = Some(rels.add(REL_VML_DRAWING, &target));
                worksheet_form_control_vml_relationships.push(WorksheetFormControlVmlGraphEntry {
                    sheet_idx,
                    path,
                    target,
                    relationship_id_hint,
                });
            }
        }

        // OLE object worksheet relationships and shared legacy VML drawing.
        if has_ole_objects {
            for (ole_idx, ole) in sheet_extras[sheet_idx].ole_objects.iter().enumerate() {
                let target = worksheet_relative_target(&ole.embedding_path);
                let r_id = rels.add(&ole.embedding_relationship_type, &target);
                worksheet_ole_object_relationships.push(WorksheetOleObjectGraphEntry {
                    sheet_idx,
                    ole_idx,
                    embedding_path: ole.embedding_path.clone(),
                    embedding_content_type: ole.embedding_content_type.clone(),
                    embedding_relationship_type: ole.embedding_relationship_type.clone(),
                    target,
                    relationship_id_hint: Some(
                        ole.embedding_relationship_id_hint.clone().unwrap_or(r_id),
                    ),
                });
            }

            if !has_comments && !has_form_controls {
                global_vml_idx += 1;
                let path = sheet_extras[sheet_idx]
                    .original_vml_path
                    .clone()
                    .unwrap_or_else(|| format!("xl/drawings/vmlDrawing{}.vml", global_vml_idx));
                if let Some(n) = extract_vml_drawing_number(&path) {
                    global_vml_idx = global_vml_idx.max(n);
                }
                let target = worksheet_relative_target(&path);
                let relationship_id_hint = Some(rels.add(REL_VML_DRAWING, &target));
                worksheet_ole_vml_relationships.push(WorksheetOleVmlGraphEntry {
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
            if let Some(path) = sheet_extras[sheet_idx]
                .original_threaded_comments_path
                .as_deref()
                && let Some(n) = extract_threaded_comment_number(path)
            {
                global_tc_idx = global_tc_idx.max(n);
            }
            worksheet_threaded_comments_relationships.push(
                threaded_comments::add_relationship_for_export(
                    sheet_idx,
                    global_tc_idx,
                    sheet_extras[sheet_idx]
                        .original_threaded_comments_path
                        .as_deref(),
                    sheet_extras[sheet_idx]
                        .original_threaded_comments_relationship_id
                        .as_deref(),
                    &mut rels,
                ),
            );
        }

        // Table rels
        if has_tables {
            let tables_before: usize = sheet_extras[..sheet_idx]
                .iter()
                .map(|e| e.tables.len())
                .sum();

            for i in 0..extras.tables.len() {
                let global_idx = tables_before + i + 1;
                let table = &extras.source_tables[i];
                let path = table_export_plan::table_part_path_for_export(table, global_idx);
                let target = table_export_plan::worksheet_target_for_table_part(&path);
                let relationship_id_hint = if let Some(hint) = &table.worksheet_relationship_id_hint
                {
                    rels.add_with_id(hint, REL_TABLE, &target);
                    Some(hint.clone())
                } else {
                    Some(rels.add(REL_TABLE, &target))
                };
                worksheet_table_relationships.push(WorksheetTableGraphEntry {
                    sheet_idx,
                    path,
                    target,
                    relationship_id_hint,
                });
            }
        }

        if has_slicers {
            for _ in &sheet_data.slicers {
                global_slicer_idx += 1;
                worksheet_slicer_relationships.push((sheet_idx, global_slicer_idx));
            }
        }
        if has_timelines {
            global_timeline_idx += 1;
            worksheet_timeline_relationships.push((sheet_idx, global_timeline_idx));
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
                worksheet_pivot_table_relationships.push((sheet_idx, entry.path.clone(), r_id));
            }
        }

        // Chart / Drawing / Floating Object rels
        if needs_drawing {
            global_drawing_idx += 1;
            let _chart_entries = &all_chart_entries[sheet_idx];

            let drawing_path = drawing_path_allocator
                .allocate(sheet_extras[sheet_idx].original_drawing_path.as_deref());
            let drawing_target = worksheet_relative_target(&drawing_path);
            worksheet_drawing_relationships.push(WorksheetDrawingGraphEntry {
                sheet_idx,
                path: drawing_path.clone(),
                target: drawing_target,
                relationship_id_hint: sheet_extras[sheet_idx]
                    .original_drawing_relationship_id
                    .clone(),
            });

            // Build drawing .rels (drawing→chart references, image refs).
            let mut drawing_rels = RelationshipManager::new();

            // Build DrawingWriter with all anchors (features + charts + floating objects).
            let mut drawing_writer = DrawingWriter::new();
            drawing_writer.set_suppress_unregistered_relationships(true);
            let deferred_feature_anchors =
                super::drawing_writer_helpers::build_feature_drawing_anchors(
                    &sheet_data.timeline_anchors,
                    &sheet_data.slicer_anchors,
                );
            // ── Floating objects (images, shapes, text boxes, groups, connectors, SmartArt) ──
            // IMPORTANT: Image rels must be registered BEFORE chart rels so that
            // `add_with_id` bumps `next_id` past the provisional image rIds. Otherwise
            // chart `add()` calls would generate rId1/rId2/… that collide with
            // image relationship IDs already embedded in the provisional drawing XML.
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
                // Register provisional image ids before chart rels so later
                // graph-resolution can remap drawing XML without local id collisions.
                for (r_id, image_path) in &drawing_data.image_rels {
                    if drawing_rels.get_by_id(r_id).is_none() {
                        drawing_rels.add_with_id(
                            r_id,
                            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
                            image_path,
                        );
                    }
                }

                for rel in &drawing_data.drawing_rels {
                    if drawing_rels.get_by_id(&rel.id).is_some() {
                        continue;
                    }
                    if crate::write::package_graph::is_external_target_mode(
                        rel.target_mode.as_deref(),
                    ) {
                        drawing_rels.add_external_with_id(&rel.id, &rel.rel_type, &rel.target);
                    } else {
                        drawing_rels.add_with_id(&rel.id, &rel.rel_type, &rel.target);
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
                    let default_cx_target = format!("../charts/chartEx{}.xml", cx_entry.global_idx);
                    let cx_path = format!("xl/charts/chartEx{}.xml", cx_entry.global_idx);
                    let use_imported_relationship_identity =
                        chart_replay::chart_allows_current_auxiliary_replay(chart_spec, &cx_path);
                    let cx_target = if use_imported_relationship_identity {
                        chart_frame
                            .and_then(|frame| frame.relationship_target.clone())
                            .unwrap_or(default_cx_target)
                    } else {
                        default_cx_target
                    };
                    let cx_r_id = if use_imported_relationship_identity
                        && let Some(rid) =
                            chart_frame.and_then(|frame| frame.relationship_id.clone())
                    {
                        relationship_ids::reserve_preferred_or_allocate(
                            &mut drawing_rels,
                            &rid,
                            REL_CHART_EX,
                            &cx_target,
                        )
                    } else {
                        drawing_rels
                            .find_by_target(&cx_target)
                            .unwrap_or_else(|| drawing_rels.add(REL_CHART_EX, &cx_target))
                    };
                    let frame_cnv =
                        chart_frame.map(|frame| &frame.graphic_frame.nv_graphic_frame_pr.c_nv_pr);
                    let frame_nv =
                        chart_frame.map(|frame| &frame.graphic_frame.nv_graphic_frame_pr);
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
                    let frame_extent = chart_extents::frame_extent(chart_spec);
                    let anchor_extent = chart_extents::anchor_extent(chart_spec);
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
                        hidden: frame_cnv
                            .map(|cnv| cnv.hidden)
                            .unwrap_or(chart_spec.cnv_pr_hidden),
                        xfrm_off_x: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.off_x())
                            .unwrap_or(chart_spec.position.anchor_col_offset),
                        xfrm_off_y: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.off_y())
                            .unwrap_or(chart_spec.position.anchor_row_offset),
                        xfrm_ext_cx: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.ext_cx() as i64)
                            .unwrap_or(frame_extent.cx),
                        xfrm_ext_cy: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.ext_cy() as i64)
                            .unwrap_or(frame_extent.cy),
                        xfrm_rot: chart_frame
                            .and_then(|frame| frame.graphic_frame.xfrm.rotation)
                            .map(|rot| rot.value()),
                        xfrm_flip_h: chart_frame.and_then(|frame| frame.graphic_frame.xfrm.flip_h),
                        xfrm_flip_v: chart_frame.and_then(|frame| frame.graphic_frame.xfrm.flip_v),
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
                    };
                    let edit_as = chart_frame
                        .and_then(|frame| frame.edit_as.as_deref())
                        .or(chart_spec.anchor_edit_as.as_deref())
                        .map(ooxml_types::drawings::EditAs::from_ooxml);
                    let chart_object = DrawingObject::ChartEx(cx_ref);
                    let raw_alternate_content = if chart_replay::chart_ex_allows_raw_anchor_replay(
                        chart_spec,
                        &cx_path,
                        match &chart_object {
                            DrawingObject::ChartEx(cx_ref) => cx_ref.r_id.as_str(),
                            _ => "",
                        },
                    ) {
                        chart_frame
                            .and_then(|frame| frame.raw_alternate_content.clone())
                            .map(|raw_xml| crate::domain::drawings::McAlternateContent { raw_xml })
                    } else {
                        None
                    };
                    let drawing_anchor = if let (Some(x), Some(y)) = (
                        chart_spec.position.absolute_x,
                        chart_spec.position.absolute_y,
                    ) {
                        DrawingAnchor::Absolute(
                            AbsoluteAnchor {
                                pos: Position { x, y },
                                extent: anchor_extent,
                                client_data,
                            },
                            chart_object,
                        )
                    } else {
                        DrawingAnchor::TwoCell(
                            TwoCellAnchor {
                                from,
                                to,
                                edit_as,
                                client_data,
                                mc_alternate_content: raw_alternate_content,
                            },
                            chart_object,
                        )
                    };
                    deferred_chart_anchors.push((anchor_index, drawing_anchor));
                    cx_local_idx += 1;
                } else {
                    let Some(chart_entry) = chart_entry_map.get(&source_idx) else {
                        continue;
                    };
                    let default_chart_target =
                        format!("../charts/chart{}.xml", chart_entry.global_idx);
                    let chart_path = format!("xl/charts/chart{}.xml", chart_entry.global_idx);
                    let use_imported_relationship_identity =
                        chart_replay::chart_allows_current_auxiliary_replay(
                            chart_spec,
                            &chart_path,
                        );
                    let chart_target = if use_imported_relationship_identity {
                        chart_frame
                            .and_then(|frame| frame.relationship_target.clone())
                            .unwrap_or(default_chart_target)
                    } else {
                        default_chart_target
                    };
                    let chart_r_id = if use_imported_relationship_identity
                        && let Some(rid) =
                            chart_frame.and_then(|frame| frame.relationship_id.clone())
                    {
                        relationship_ids::reserve_preferred_or_allocate(
                            &mut drawing_rels,
                            &rid,
                            REL_CHART,
                            &chart_target,
                        )
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
                    let frame_extent = chart_extents::frame_extent(chart_spec);
                    let anchor_extent = chart_extents::anchor_extent(chart_spec);

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
                            .unwrap_or(frame_extent.cx),
                        xfrm_ext_cy: chart_frame
                            .map(|frame| frame.graphic_frame.xfrm.ext_cy() as i64)
                            .unwrap_or(frame_extent.cy),
                        xfrm_rot: chart_frame
                            .and_then(|frame| frame.graphic_frame.xfrm.rotation)
                            .map(|rot| rot.value()),
                        xfrm_flip_h: chart_frame.and_then(|frame| frame.graphic_frame.xfrm.flip_h),
                        xfrm_flip_v: chart_frame.and_then(|frame| frame.graphic_frame.xfrm.flip_v),
                    };
                    if let (Some(x), Some(y)) = (
                        chart_spec.position.absolute_x,
                        chart_spec.position.absolute_y,
                    ) {
                        deferred_chart_anchors.push((
                            anchor_index,
                            DrawingAnchor::Absolute(
                                AbsoluteAnchor {
                                    pos: Position { x, y },
                                    extent: anchor_extent,
                                    client_data,
                                },
                                DrawingObject::Chart(chart_ref),
                            ),
                        ));
                    } else if let (Some(cx), Some(cy)) =
                        (chart_spec.position.extent_cx, chart_spec.position.extent_cy)
                    {
                        let cx = chart_extents::positive_i64(cx).unwrap_or(anchor_extent.cx);
                        let cy = chart_extents::positive_i64(cy).unwrap_or(anchor_extent.cy);
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

            super::drawing_writer_helpers::add_ordered_anchors(
                &mut drawing_writer,
                [
                    deferred_feature_anchors,
                    deferred_fobj_anchors,
                    deferred_chart_anchors,
                ],
            );

            drawing_xml_data.push(None);
            drawing_writer_data.push(Some(drawing_writer));
            if !drawing_rels.is_empty() {
                for rel in drawing_rels.relationships() {
                    let target_path = if crate::write::package_graph::is_external_target_mode(
                        rel.target_mode.as_deref(),
                    ) || (rel.rel_type == REL_HYPERLINK
                        && rel.target.starts_with('#'))
                    {
                        rel.target.clone()
                    } else {
                        crate::infra::opc::resolve_relationship_target(
                            Some(&drawing_path),
                            &rel.target,
                        )
                        .map_err(|err| {
                            WriteError::PackageIntegrity(format!(
                                "invalid drawing relationship target for {}: {} ({:?})",
                                drawing_path, rel.target, err
                            ))
                        })?
                    };
                    drawing_relationships.push(DrawingRelationshipGraphEntry {
                        drawing_path: drawing_path.clone(),
                        rel_type: rel.rel_type.clone(),
                        target_path,
                        target_mode: rel.target_mode.clone(),
                        relationship_id_hint: rel.id.clone(),
                    });
                }
            }
            sheets_with_drawings.push(global_drawing_idx);
        } else {
            drawing_xml_data.push(None);
            drawing_writer_data.push(None);
        }

        // Printer settings relationship.
        if has_printer_settings {
            if let Some(entry) = sheet_data.print_settings.as_ref().and_then(|ps| {
                printer_settings::relationship_for_export(
                    sheet_idx,
                    sheet_num,
                    ps,
                    output.package_fidelity.as_ref(),
                )
            }) {
                worksheet_printer_settings_relationships.push(entry);
            }
        }
    }

    for (sheet_idx, extras) in sheet_extras.iter().enumerate() {
        if extras.ole_objects.is_empty() {
            continue;
        }
        let Some(vml_path) = worksheet_legacy_vml_path(
            sheet_idx,
            &worksheet_comments_relationships,
            &worksheet_form_control_vml_relationships,
            &worksheet_ole_vml_relationships,
        ) else {
            continue;
        };
        for ole in &extras.ole_objects {
            let (Some(preview_path), Some(relationship_id_hint)) = (
                ole.preview_path.clone(),
                ole.preview_relationship_id_hint
                    .clone()
                    .or_else(|| ole.object.preview_image_rel_id.clone()),
            ) else {
                continue;
            };
            vml_preview_relationships.push(VmlPreviewRelationshipGraphEntry {
                vml_path: vml_path.clone(),
                preview_path,
                relationship_id_hint,
            });
        }
    }

    // ── 3. Build package graph facts needed before workbook.xml ─────────
    // Theme and properties are computed before workbook XML so relationship IDs
    // come from a resolved graph instead of workbook-local guesses.
    let theme_xml = Some(theme_parts::theme_xml_for_export(output));
    let has_theme = theme_xml.is_some();
    let doc_props_xml = doc_props::build_doc_props_xml(output);
    let core_props_xml = doc_props_xml.core;
    let app_props_xml = doc_props_xml.app;
    let custom_props_xml = doc_props_xml.custom;
    let metadata_xml = metadata::metadata_xml_for_export(output);
    let rich_data_parts = rich_data::parts_for_export(output);
    let rich_data_related_parts = rich_data::related_parts_for_export(output);
    let persons_xml: Option<Vec<u8>> = if output.has_persons_part || !output.persons.is_empty() {
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
                theme_part_path: output
                    .theme
                    .as_ref()
                    .and_then(|theme| theme.theme_part_path.clone()),
                theme_relationship_id_hint: output
                    .theme
                    .as_ref()
                    .and_then(|theme| theme.theme_relationship_id_hint.clone()),
                theme_relationship_type: output
                    .theme
                    .as_ref()
                    .and_then(|theme| theme.theme_relationship_type.clone()),
                has_shared_strings: shared_strings.has_part_content(),
                has_core_props: core_props_xml.is_some(),
                has_app_props: app_props_xml.is_some(),
                has_custom_props: custom_props_xml.is_some(),
                has_metadata: metadata_xml.is_some(),
                has_persons: persons_xml.is_some(),
                has_doc_metadata_label_info: false,
                package_fidelity: output.package_fidelity.clone(),
            },
        )?;
    for (link, part_name) in &external_link_exports {
        crate::write::package_graph::register_workbook_external_link(
            &mut package_graph_builder,
            part_name,
            external_links::workbook_relationship_id_hint(link, part_name),
        )?;
        external_links::register_owned_relationships(&mut package_graph_builder, part_name, link);
    }
    if !output.connections.is_empty() {
        crate::write::package_graph::register_workbook_connections(&mut package_graph_builder)?;
    }
    let feature_properties = output
        .metadata
        .as_ref()
        .map(|metadata| &metadata.feature_properties)
        .filter(|feature_properties| {
            !feature_properties.bags.is_empty()
                && feature_properties
                    .bags
                    .iter()
                    .all(|bag| bag.kind != domain_types::FeaturePropertyBagKind::Unknown)
        });
    if let Some(feature_properties) = feature_properties {
        crate::write::package_graph::register_workbook_feature_property_bags(
            &mut package_graph_builder,
            feature_properties,
        )?;
    }
    for entry in &pivot_data.pivot_cache_entries {
        crate::write::package_graph::register_pivot_cache(
            &mut package_graph_builder,
            &entry.definition_path,
            entry.records_path.as_deref(),
            &entry.workbook_relationship_type,
            entry.workbook_relationship_id_hint.as_deref(),
            entry.records_relationship_type.as_deref(),
            entry.records_relationship_id_hint.as_deref(),
            entry.external_source_relationship_type.as_deref(),
            entry.external_source_relationship_target.as_deref(),
            entry.external_source_relationship_target_mode.as_deref(),
            entry.external_source_relationship_id_hint.as_deref(),
        )?;
    }
    rich_data::register_parts(
        &mut package_graph_builder,
        &rich_data_parts,
        &rich_data_related_parts,
    )?;
    for entry in &worksheet_hyperlink_relationships {
        crate::write::package_graph::register_worksheet_hyperlink(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.target,
            entry.target_mode.as_deref(),
            entry.relationship_id_hint.as_deref(),
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
    for extras in &sheet_extras {
        let Some(hf) = &extras.hf_vml else {
            continue;
        };
        for (relationship_id, target) in &hf.image_targets {
            let Ok(target_path) =
                crate::infra::opc::resolve_relationship_target(Some(&hf.vml_path), target)
            else {
                continue;
            };
            if package_graph_builder.contains_part(&target_path) {
                crate::write::package_graph::register_part_image_relationship(
                    &mut package_graph_builder,
                    &hf.vml_path,
                    &target_path,
                    relationship_id,
                );
            }
        }
    }
    for entry in &worksheet_form_control_vml_relationships {
        crate::write::package_graph::register_worksheet_vml_drawing(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            entry.relationship_id_hint.as_deref(),
        )?;
    }
    for entry in &worksheet_ole_vml_relationships {
        crate::write::package_graph::register_worksheet_vml_drawing(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            entry.relationship_id_hint.as_deref(),
        )?;
    }
    for entry in &worksheet_ole_object_relationships {
        crate::write::package_graph::register_ole_embedding_part(
            &mut package_graph_builder,
            &entry.embedding_path,
            &entry.embedding_content_type,
        )?;
        crate::write::package_graph::register_worksheet_ole_object(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.embedding_path,
            &entry.embedding_relationship_type,
            entry.relationship_id_hint.as_deref(),
        );
    }
    for entry in &vml_preview_relationships {
        crate::write::package_graph::register_media_part(
            &mut package_graph_builder,
            &entry.preview_path,
        )?;
        crate::write::package_graph::register_part_image_relationship(
            &mut package_graph_builder,
            &entry.vml_path,
            &entry.preview_path,
            &entry.relationship_id_hint,
        );
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
        for entry in chart_entries {
            let chart_path = format!("xl/charts/chart{}.xml", entry.global_idx);
            crate::write::package_graph::register_chart(
                &mut package_graph_builder,
                entry.global_idx,
            )?;
            let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
            if chart_replay::chart_allows_current_auxiliary_replay(chart_spec, &chart_path)
                && let Some(aux) = chart_auxiliary::chart_auxiliary_data(chart_spec)
            {
                let auxiliary_paths =
                    chart_auxiliary::supported_auxiliary_file_paths(&aux, &chart_path);
                for (path, _) in aux.auxiliary_files {
                    if !auxiliary_paths.contains(path.trim_start_matches('/')) {
                        continue;
                    }
                    if registered_chart_auxiliary_parts
                        .insert(path.trim_start_matches('/').to_string())
                    {
                        crate::write::package_graph::register_chart_auxiliary_part(
                            &mut package_graph_builder,
                            path,
                        )?;
                    }
                }
                for rel in aux.chart_relationships {
                    let (Some(rel_type), Some(target)) =
                        (rel.relationship_type.as_deref(), rel.target.as_deref())
                    else {
                        continue;
                    };
                    let Some(target_path) =
                        crate::infra::opc::resolve_relationship_target(Some(&chart_path), target)
                            .ok()
                            .map(|target| target.trim_start_matches('/').to_string())
                    else {
                        continue;
                    };
                    if chart_auxiliary::is_supported_auxiliary_relationship(rel_type, &target_path)
                        && auxiliary_paths.contains(&target_path)
                    {
                        chart_auxiliary_relationships.push(ChartAuxiliaryRelationshipGraphEntry {
                            chart_path: chart_path.clone(),
                            rel_type: rel_type.to_string(),
                            target_path,
                            relationship_id_hint: rel.r_id.clone(),
                        });
                    }
                }
            }
            chart_replay::register_chart_owned_external_relationships(
                &mut package_graph_builder,
                &chart_path,
                chart_spec,
            )?;
        }
    }
    for (sheet_idx, chart_ex_entries) in all_chart_ex_entries.iter().enumerate() {
        for entry in chart_ex_entries {
            let chart_path = format!("xl/charts/chartEx{}.xml", entry.global_idx);
            crate::write::package_graph::register_chart_ex(
                &mut package_graph_builder,
                entry.global_idx,
            )?;
            let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
            if chart_replay::chart_allows_current_auxiliary_replay(chart_spec, &chart_path)
                && let Some(aux) = chart_auxiliary::chart_auxiliary_data(chart_spec)
            {
                let auxiliary_paths =
                    chart_auxiliary::supported_auxiliary_file_paths(&aux, &chart_path);
                for (path, _) in aux.auxiliary_files {
                    if !auxiliary_paths.contains(path.trim_start_matches('/')) {
                        continue;
                    }
                    if registered_chart_auxiliary_parts
                        .insert(path.trim_start_matches('/').to_string())
                    {
                        crate::write::package_graph::register_chart_auxiliary_part(
                            &mut package_graph_builder,
                            path,
                        )?;
                    }
                }
                for rel in aux.chart_relationships {
                    let (Some(rel_type), Some(target)) =
                        (rel.relationship_type.as_deref(), rel.target.as_deref())
                    else {
                        continue;
                    };
                    let Some(target_path) =
                        crate::infra::opc::resolve_relationship_target(Some(&chart_path), target)
                            .ok()
                            .map(|target| target.trim_start_matches('/').to_string())
                    else {
                        continue;
                    };
                    if chart_auxiliary::is_supported_auxiliary_relationship(rel_type, &target_path)
                        && auxiliary_paths.contains(&target_path)
                    {
                        chart_auxiliary_relationships.push(ChartAuxiliaryRelationshipGraphEntry {
                            chart_path: chart_path.clone(),
                            rel_type: rel_type.to_string(),
                            target_path,
                            relationship_id_hint: rel.r_id.clone(),
                        });
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
    media::register_image_blob_parts(&mut package_graph_builder, &all_image_blobs)?;
    let mut drawing_relationship_keys = Vec::with_capacity(drawing_relationships.len());
    for (entry_idx, entry) in drawing_relationships.iter().enumerate() {
        let relationship_key = if entry.rel_type == REL_CHART {
            crate::write::package_graph::register_drawing_chart_relationship(
                &mut package_graph_builder,
                &entry.drawing_path,
                &entry.target_path,
                &entry.relationship_id_hint,
            )?
        } else if entry.rel_type == REL_CHART_EX {
            crate::write::package_graph::register_drawing_chart_ex_relationship(
                &mut package_graph_builder,
                &entry.drawing_path,
                &entry.target_path,
                &entry.relationship_id_hint,
            )?
        } else if entry.rel_type
            == "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
            && !crate::write::package_graph::is_external_target_mode(entry.target_mode.as_deref())
        {
            crate::write::package_graph::register_drawing_image_relationship(
                &mut package_graph_builder,
                &entry.drawing_path,
                &entry.target_path,
                &entry.relationship_id_hint,
            )?
        } else {
            crate::write::package_graph::register_drawing_relationship_with_target_mode(
                &mut package_graph_builder,
                &entry.drawing_path,
                &entry.rel_type,
                &entry.target_path,
                entry.target_mode.as_deref(),
                &entry.relationship_id_hint,
            )?
        };
        drawing_relationship_keys.push((entry_idx, relationship_key));
    }
    for entry in &worksheet_printer_settings_relationships {
        crate::write::package_graph::register_worksheet_printer_settings_payload(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            entry.bytes.clone(),
            &entry.content_type,
            &entry.relationship_id_hint,
        )?;
    }
    package_graph_builder.register_imported_opaque_parts()?;
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
    for entry in &worksheet_table_relationships {
        crate::write::package_graph::register_worksheet_table(
            &mut package_graph_builder,
            entry.sheet_idx,
            &entry.path,
            entry.relationship_id_hint.as_deref(),
        )?;
    }
    let mut query_table_global_idx = 0usize;
    for (sheet_idx, extras) in sheet_extras.iter().enumerate() {
        let tables_before: usize = sheet_extras[..sheet_idx]
            .iter()
            .map(|e| e.tables.len())
            .sum();
        for (table_idx, table) in extras.source_tables.iter().enumerate() {
            if let Some(query_table) = &table.query_table {
                query_table_global_idx += 1;
                let table_global_idx = tables_before + table_idx + 1;
                let table_path =
                    table_export_plan::table_part_path_for_export(table, table_global_idx);
                let query_table_path = table_export_plan::query_table_part_path_for_export(
                    query_table,
                    query_table_global_idx,
                );
                crate::write::package_graph::register_table_query_table(
                    &mut package_graph_builder,
                    &table_path,
                    &query_table_path,
                    query_table.relationship_id.as_deref(),
                )?;
            }
        }
    }
    for (sheet_idx, global_idx) in &worksheet_slicer_relationships {
        crate::write::package_graph::register_worksheet_slicer(
            &mut package_graph_builder,
            *sheet_idx,
            *global_idx,
            None,
        )?;
    }
    for (sheet_idx, global_idx) in &worksheet_timeline_relationships {
        crate::write::package_graph::register_worksheet_timeline(
            &mut package_graph_builder,
            *sheet_idx,
            *global_idx,
            None,
        )?;
    }
    for (idx, _) in output.slicer_caches.iter().enumerate() {
        crate::write::package_graph::register_workbook_slicer_cache(
            &mut package_graph_builder,
            idx + 1,
            None,
        )?;
    }
    for (idx, _) in output.timeline_caches.iter().enumerate() {
        crate::write::package_graph::register_workbook_timeline_cache(
            &mut package_graph_builder,
            idx + 1,
            None,
        )?;
    }
    if let Some(part) = &output.volatile_dependency_part {
        crate::write::package_graph::register_workbook_volatile_dependencies(
            &mut package_graph_builder,
            part,
        )?;
    }
    for (sheet_idx, pivot_table_path, relationship_id_hint) in &worksheet_pivot_table_relationships
    {
        crate::write::package_graph::register_worksheet_pivot_table(
            &mut package_graph_builder,
            *sheet_idx,
            pivot_table_path,
            Some(relationship_id_hint),
        )?;
    }
    let cache_id_to_definition_path: std::collections::HashMap<u32, String> = pivot_data
        .pivot_cache_entries
        .iter()
        .map(|e| (e.cache_id, e.definition_path.clone()))
        .collect();
    for entry in &pivot_data.pivot_table_entries {
        if let Some(cache_definition_path) = cache_id_to_definition_path.get(&entry.cache_id) {
            crate::write::package_graph::register_pivot_table_cache_relationship_for_path(
                &mut package_graph_builder,
                &entry.path,
                cache_definition_path,
                entry.cache_relationship_id_hint.as_deref(),
            );
        }
    }
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
        let mut resolved_ids = std::collections::HashMap::new();
        for (entry_idx, relationship_key) in drawing_relationship_keys
            .iter()
            .filter(|(entry_idx, _)| drawing_relationships[*entry_idx].drawing_path == drawing_path)
        {
            let entry = &drawing_relationships[*entry_idx];
            let resolved_id = package_graph
                .relationship_id_for_key(*relationship_key)
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing resolved drawing relationship for {} relationship {} target {}",
                        drawing_path, entry.relationship_id_hint, entry.target_path
                    ))
                })?;
            resolved_ids.insert(entry.relationship_id_hint.clone(), resolved_id);
        }
        drawing_writer.remap_relationship_ids(&resolved_ids);
        drawing_xml_data[sheet_idx] = Some(drawing_writer.to_xml());
    }

    let mut resolved_hyperlink_ids_by_sheet_target: std::collections::HashMap<
        (usize, String, Option<String>),
        std::collections::VecDeque<String>,
    > = std::collections::HashMap::new();
    for sheet_idx in 0..output.sheets.len() {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        };
        for rel in package_graph
            .relationship_manager_for_owner(&owner)
            .relationships()
        {
            if rel.rel_type == REL_HYPERLINK {
                resolved_hyperlink_ids_by_sheet_target
                    .entry((sheet_idx, rel.target.clone(), rel.target_mode.clone()))
                    .or_default()
                    .push_back(rel.id.clone());
            }
        }
    }
    for entry in &worksheet_hyperlink_relationships {
        let r_id = resolved_hyperlink_ids_by_sheet_target
            .get_mut(&(
                entry.sheet_idx,
                entry.target.clone(),
                entry.target_mode.clone(),
            ))
            .and_then(|ids| ids.pop_front())
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet hyperlink relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.target
                ))
            })?;
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
        let base_shape_id = if extras.comments.is_some() {
            vml_merge::form_control_base_shape_id(&output.sheets[sheet_idx].comments)
        } else {
            1025
        };
        let ctrl_xml = controls_writer.write_worksheet_controls(base_shape_id, &ctrl_prop_r_ids);
        sheet_writers[sheet_idx].set_controls_xml(String::from_utf8_lossy(&ctrl_xml).to_string());
    }

    for (sheet_idx, extras) in sheet_extras.iter().enumerate() {
        if extras.ole_objects.is_empty() {
            continue;
        }
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        };
        let mut ole_r_ids = Vec::with_capacity(extras.ole_objects.len());
        for entry in worksheet_ole_object_relationships
            .iter()
            .filter(|entry| entry.sheet_idx == sheet_idx)
        {
            let r_id = package_graph
                .relationship_id(&owner, &entry.embedding_relationship_type, &entry.target)
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing worksheet OLE relationship for sheet {} target {}",
                        sheet_idx + 1,
                        entry.target
                    ))
                })?
                .to_string();
            ole_r_ids.push((entry.ole_idx, r_id));
        }
        ole_r_ids.sort_by_key(|(idx, _)| *idx);
        let ole_r_ids: Vec<String> = ole_r_ids.into_iter().map(|(_, r_id)| r_id).collect();
        let ole_xml = ole_objects::write_worksheet_ole_objects(&extras.ole_objects, &ole_r_ids);
        sheet_writers[sheet_idx].set_ole_objects_xml(String::from_utf8_lossy(&ole_xml).to_string());

        if let Some(vml_entry) = worksheet_ole_vml_relationships
            .iter()
            .find(|entry| entry.sheet_idx == sheet_idx)
        {
            let r_id = package_graph
                .relationship_id(&owner, REL_VML_DRAWING, &vml_entry.target)
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing worksheet OLE VML relationship for sheet {} target {}",
                        sheet_idx + 1,
                        vml_entry.target
                    ))
                })?
                .to_string();
            sheet_writers[sheet_idx].set_legacy_drawing_r_id(r_id);
        }
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
                    "missing worksheet printer-settings relationship for sheet {} target {}",
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
        sheet_writers[entry.sheet_idx].set_drawing_r_id(r_id);
    }

    for (sheet_idx, global_idx) in &worksheet_slicer_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: *sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", *sheet_idx + 1),
        };
        let target = format!("../slicers/slicer{global_idx}.xml");
        let r_id = package_graph
            .relationship_id(&owner, REL_SLICER, &target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet slicer relationship for sheet {} target {}",
                    *sheet_idx + 1,
                    target
                ))
            })?
            .to_string();
        let mut writer = crate::write::xml_writer::XmlWriter::new();
        crate::domain::slicers::write::write_worksheet_slicer_ext(&mut writer, &r_id);
        sheet_writers[*sheet_idx]
            .append_ext_lst_entry(String::from_utf8(writer.finish()).unwrap_or_default());
    }

    for entry in &worksheet_comments_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        package_graph
            .relationship_id(&owner, REL_COMMENTS, &entry.comments_target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet comments relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.comments_target
                ))
            })?;

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
        sheet_writers[entry.sheet_idx].set_legacy_drawing_r_id(vml_r_id);
    }

    for entry in &worksheet_threaded_comments_relationships {
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: entry.sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", entry.sheet_idx + 1),
        };
        package_graph
            .relationship_id(&owner, REL_THREADED_COMMENT, &entry.target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet threaded comments relationship for sheet {} target {}",
                    entry.sheet_idx + 1,
                    entry.target
                ))
            })?;
    }

    for (sheet_idx, extras) in sheet_extras.iter().enumerate() {
        if extras.tables.is_empty() {
            continue;
        }
        let owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        };
        let mut table_parts_xml = String::new();
        table_parts_xml.push_str(&format!("<tableParts count=\"{}\">", extras.tables.len()));
        for entry in worksheet_table_relationships
            .iter()
            .filter(|entry| entry.sheet_idx == sheet_idx)
        {
            let table_r_id = package_graph
                .relationship_id(&owner, REL_TABLE, &entry.target)
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing worksheet table relationship for sheet {} table {}",
                        sheet_idx + 1,
                        entry.path
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
        let pivot_table_r_ids: Vec<String> = pivot_data
            .pivot_table_entries
            .iter()
            .filter(|entry| entry.sheet_idx == sheet_idx)
            .map(|entry| {
                let target = pivot_package::worksheet_relative_target(&entry.path);
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
    let workbook_parts::WorkbookXmlParts {
        workbook_xml,
        workbook_rels_xml,
    } = workbook_parts::build_workbook_xml(
        output,
        &package_graph,
        &pivot_data,
        &external_link_exports,
    )?;

    // ── 6. Generate XML parts ───────────────────────────────────────────
    let styles_xml = styles_writer.to_xml();
    // SST entries are derived from current cells and emitted in insertion order;
    // the index returned by `add()` is the slot at which the entry lands in
    // <sst>. This is load-bearing for cells, which carry positional SST indices.
    let has_referenced_shared_strings = shared_strings.has_part_content();
    let shared_strings_xml = shared_strings.to_xml();

    zip_assembly::write_zip_package(
        output,
        &package_graph,
        &pivot_data,
        sheet_writers,
        &sheet_extras,
        &external_link_exports,
        workbook_xml,
        workbook_rels_xml,
        styles_xml,
        shared_strings_xml,
        has_referenced_shared_strings,
        theme_xml,
        core_props_xml,
        app_props_xml,
        custom_props_xml,
        metadata_xml,
        rich_data_parts,
        rich_data_related_parts,
        persons_xml,
        &all_chart_entries,
        &all_chart_ex_entries,
        all_image_blobs,
        &drawing_xml_data,
        &worksheet_comments_relationships,
        &worksheet_form_control_vml_relationships,
        &worksheet_ole_vml_relationships,
        &worksheet_drawing_relationships,
        &worksheet_threaded_comments_relationships,
    )
}

pub fn write_xlsx_from_parse_output_with_report(
    output: &ParseOutput,
) -> Result<(Vec<u8>, ExportReport), WriteError> {
    let report = export_report::build_export_report(output);
    let bytes = write_xlsx_from_parse_output(output)?;
    Ok((bytes, report))
}

fn reject_unsupported_package_profile(output: &ParseOutput) -> Result<(), WriteError> {
    let profile = output
        .package_fidelity
        .as_ref()
        .and_then(|metadata| metadata.package_profile.as_ref())
        .map(|hint| hint.profile.as_str());
    let conformance = output.workbook_conformance.as_deref();

    if profile.is_some_and(|value| value.eq_ignore_ascii_case("MixedInvalid")) {
        return Err(WriteError::PackageIntegrity(
            "cannot export XLSX package with mixed Strict/Transitional OOXML profile evidence"
                .to_string(),
        ));
    }

    let strict_profile = profile.is_some_and(|value| value.eq_ignore_ascii_case("Strict"));
    let strict_conformance = conformance.is_some_and(|value| value.eq_ignore_ascii_case("strict"));
    if strict_profile || strict_conformance {
        return Err(WriteError::PackageIntegrity(
            "OOXML Strict package export is not enabled for the full modeled XLSX surface"
                .to_string(),
        ));
    }

    Ok(())
}

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

fn extract_comment_number(path: &str) -> Option<usize> {
    let file = path.rsplit('/').next()?;
    file.strip_prefix("comments")?
        .strip_suffix(".xml")?
        .parse()
        .ok()
}

fn extract_threaded_comment_number(path: &str) -> Option<usize> {
    let file = path.rsplit('/').next()?;
    file.strip_prefix("threadedComment")?
        .strip_suffix(".xml")?
        .parse()
        .ok()
}

#[cfg(test)]
mod tests;
