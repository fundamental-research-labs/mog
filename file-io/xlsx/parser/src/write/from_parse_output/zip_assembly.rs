use domain_types::{ParseOutput, RoundTripContext};

use super::assembly::{
    ChartEntry, ChartExEntry, SheetExtras, WorksheetDrawingGraphEntry,
    WorksheetFormControlVmlGraphEntry, WorksheetThreadedCommentsGraphEntry,
};
use super::{
    WriteError, chart_allows_auxiliary_replay, chart_auxiliary, external_links, vml_merge,
};
use crate::domain::content_types::write::ContentTypesManager;
use crate::write::package_graph::ResolvedPackageGraph;
use crate::write::pivot_writer::PivotWriteData;
use crate::write::relationships::RelationshipManager;
use crate::write::{CompressionMethod, ControlsWriter, SheetWriter, ZipWriter};

#[allow(clippy::too_many_arguments)]
pub(super) fn write_zip_package(
    output: &ParseOutput,
    round_trip_ctx: Option<&RoundTripContext>,
    package_graph: &ResolvedPackageGraph,
    pivot_data: &PivotWriteData,
    sheet_writers: Vec<SheetWriter>,
    _sheet_rels_data: Vec<Option<RelationshipManager>>,
    sheet_extras: &[SheetExtras],
    external_link_exports: &[(domain_types::domain::external_link::ExternalLink, String)],
    workbook_xml: Vec<u8>,
    workbook_rels_xml: Vec<u8>,
    styles_xml: Vec<u8>,
    shared_strings_xml: Vec<u8>,
    has_referenced_shared_strings: bool,
    theme_xml: Option<Vec<u8>>,
    core_props_xml: Option<Vec<u8>>,
    app_props_xml: Option<Vec<u8>>,
    custom_props_xml: Option<Vec<u8>>,
    metadata_xml: Option<Vec<u8>>,
    persons_xml: Option<Vec<u8>>,
    all_chart_entries: &[Vec<ChartEntry>],
    all_chart_ex_entries: &[Vec<ChartExEntry>],
    all_image_blobs: Vec<(String, Vec<u8>)>,
    drawing_xml_data: &[Option<Vec<u8>>],
    drawing_rels_data: &[Option<Vec<u8>>],
    drawing_rels_should_emit: &[bool],
    worksheet_form_control_vml_relationships: &[WorksheetFormControlVmlGraphEntry],
    worksheet_drawing_relationships: &[WorksheetDrawingGraphEntry],
    worksheet_threaded_comments_relationships: &[WorksheetThreadedCommentsGraphEntry],
) -> Result<Vec<u8>, WriteError> {
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
    let content_types_xml = content_types.to_xml();

    let root_rels = package_graph
        .relationship_manager_for_owner(&crate::write::package_graph::PackageOwner::Root);
    let root_rels_xml = root_rels.to_xml();

    // ── 7. Assemble ZIP ─────────────────────────────────────────────────
    let mut zip = ZipWriter::with_compression(CompressionMethod::Deflate(1));

    zip.add_file("[Content_Types].xml", content_types_xml);
    zip.add_file("_rels/.rels", root_rels_xml);
    add_registered_part(package_graph, &mut zip, "xl/workbook.xml", workbook_xml)?;
    zip.add_file("xl/_rels/workbook.xml.rels", workbook_rels_xml);
    add_registered_part(package_graph, &mut zip, "xl/styles.xml", styles_xml)?;

    if has_referenced_shared_strings {
        add_registered_part(
            package_graph,
            &mut zip,
            "xl/sharedStrings.xml",
            shared_strings_xml,
        )?;
    }

    // Theme
    if let Some(ref theme) = theme_xml {
        add_registered_part(
            package_graph,
            &mut zip,
            "xl/theme/theme1.xml",
            theme.clone(),
        )?;
    }

    // Document Properties
    if let Some(ref core) = core_props_xml {
        add_registered_part(package_graph, &mut zip, "docProps/core.xml", core.clone())?;
    }
    if let Some(ref app) = app_props_xml {
        add_registered_part(package_graph, &mut zip, "docProps/app.xml", app.clone())?;
    }
    if let Some(ref custom) = custom_props_xml {
        add_registered_part(
            package_graph,
            &mut zip,
            "docProps/custom.xml",
            custom.clone(),
        )?;
    }

    // Metadata passthrough
    if let Some(ref meta) = metadata_xml {
        add_registered_part(package_graph, &mut zip, "xl/metadata.xml", meta.clone())?;
    }
    // Persons (threaded comments author list)
    if let Some(ref persons) = persons_xml {
        add_registered_part(
            package_graph,
            &mut zip,
            "xl/persons/person.xml",
            persons.clone(),
        )?;
    }

    // External links — serialize from domain types
    for (link, part_name) in external_link_exports {
        let zip_path = external_links::zip_path(part_name);
        let owner = crate::write::package_graph::PackageOwner::Part {
            path: zip_path.clone(),
        };
        let link_for_xml =
            external_links::with_resolved_relationship_ids(package_graph, link, &owner);
        let xml = crate::domain::external::write::write_external_link_xml(&link_for_xml);
        add_registered_part(package_graph, &mut zip, &zip_path, xml)?;
        let rels = package_graph.relationship_manager_for_owner(&owner);
        if !rels.is_empty() {
            zip.add_file(&external_links::rels_path(&zip_path), rels.to_xml());
        }
    }

    crate::write::opaque_subgraph::write_opaque_parts(&mut zip, package_graph);

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
    for (idx, sheet_xml) in sheet_xmls.into_iter().enumerate() {
        let sheet_num = idx + 1;
        add_registered_part(
            package_graph,
            &mut zip,
            &format!("xl/worksheets/sheet{}.xml", sheet_num),
            sheet_xml,
        )?;

        // Sheet rels
        let sheet_owner = crate::write::package_graph::PackageOwner::Worksheet {
            index: idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        };
        let rels = package_graph.relationship_manager_for_owner(&sheet_owner);
        if !rels.is_empty() {
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
            add_registered_part(package_graph, &mut zip, &comment_path, comments_xml.clone())?;
            let merged_vml = if !sheet_extras[idx].form_controls.is_empty() {
                let base_shape_id =
                    vml_merge::form_control_base_shape_id(&output.sheets[idx].comments);
                let form_controls = vml_merge::controls_with_shape_ids(
                    &sheet_extras[idx].form_controls,
                    base_shape_id,
                );
                let controls_writer = ControlsWriter::new(form_controls);
                let form_control_vml = controls_writer.write_vml_form_controls(base_shape_id);
                vml_merge::merge_form_controls_into_comment_vml(vml_xml, &form_control_vml)
                    .ok_or_else(|| {
                        WriteError::PackageIntegrity(format!(
                            "failed to merge form-control VML into comment VML for sheet {}",
                            idx + 1
                        ))
                    })?
            } else {
                vml_xml.clone()
            };
            add_registered_part(package_graph, &mut zip, &vml_path, merged_vml)?;
        }

        // Header/footer image VML — generated from domain types
        if let Some(ref hf) = sheet_extras[idx].hf_vml {
            let vml_xml = crate::domain::print::hf_images::write_hf_images_vml(
                &hf.images,
                &hf.idmap_data,
                hf.spid_base,
            );
            add_registered_part(package_graph, &mut zip, &hf.vml_path, vml_xml)?;

            let rels = package_graph.relationship_manager_for_owner(
                &crate::write::package_graph::PackageOwner::Part {
                    path: hf.vml_path.clone(),
                },
            );
            if !rels.is_empty() {
                let rels_path = hf.rels_path.clone().unwrap_or_else(|| {
                    crate::write::package_graph::part_relationships_path(&hf.vml_path)
                });
                zip.add_file(&rels_path, rels.to_xml());
            }
        }

        // Form controls: ctrlProp XML files and VML drawing
        if !sheet_extras[idx].form_controls.is_empty() {
            let base_shape_id = if sheet_extras[idx].comments.is_some() {
                vml_merge::form_control_base_shape_id(&output.sheets[idx].comments)
            } else {
                1025
            };
            let controls = if sheet_extras[idx].comments.is_some() {
                vml_merge::controls_with_shape_ids(&sheet_extras[idx].form_controls, base_shape_id)
            } else {
                sheet_extras[idx].form_controls.clone()
            };
            let controls_writer = ControlsWriter::new(controls.clone());

            // Write ctrlProp XML files
            for i in 0..controls.len() {
                zip_ctrl_prop_idx += 1;
                let ctrl_prop_xml = controls_writer.write_ctrl_prop(i);
                add_registered_part(
                    package_graph,
                    &mut zip,
                    &format!("xl/ctrlProps/ctrlProp{}.xml", zip_ctrl_prop_idx),
                    ctrl_prop_xml,
                )?;
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
                add_registered_part(package_graph, &mut zip, &vml_entry.path, vml_xml)?;
            }
        }

        // Threaded comment XML
        if let Some(ref tc_xml) = sheet_extras[idx].threaded_comments {
            let tc_entry = worksheet_threaded_comments_relationships
                .iter()
                .find(|entry| entry.sheet_idx == idx)
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing graph-registered threaded comments part for sheet {}",
                        idx + 1
                    ))
                })?;
            add_registered_part(package_graph, &mut zip, &tc_entry.path, tc_xml.clone())?;
        }

        if let Some(custom_properties) = &sheet_extras[idx].custom_properties {
            for part in &custom_properties.parts {
                add_registered_part(package_graph, &mut zip, &part.path, part.data.clone())?;
            }
        }
    }

    // Table XML files
    {
        let mut table_global = 0usize;
        for extras in sheet_extras {
            for table_xml in &extras.tables {
                table_global += 1;
                add_registered_part(
                    package_graph,
                    &mut zip,
                    &format!("xl/tables/table{}.xml", table_global),
                    table_xml.clone(),
                )?;
            }
        }
    }

    // Pivot table and cache XML files
    for entry in &pivot_data.pivot_table_entries {
        let pivot_table_path = format!("xl/pivotTables/pivotTable{}.xml", entry.global_idx);
        add_registered_part(
            package_graph,
            &mut zip,
            &pivot_table_path,
            entry.xml.clone(),
        )?;
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
        add_registered_part(
            package_graph,
            &mut zip,
            &format!("xl/pivotCache/pivotCacheDefinition{}.xml", entry.global_idx),
            entry.definition_xml.clone(),
        )?;
        add_registered_part(
            package_graph,
            &mut zip,
            &format!("xl/pivotCache/pivotCacheRecords{}.xml", entry.global_idx),
            entry.records_xml.clone(),
        )?;
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

            for entry in chart_entries {
                let chart_path = format!("xl/charts/chart{}.xml", entry.global_idx);
                add_registered_part(package_graph, &mut zip, &chart_path, entry.xml.clone())?;

                // Write chart auxiliary files (style XML, colors XML) only
                // when the current chart still carries imported chart identity.
                let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
                if chart_allows_auxiliary_replay(chart_spec)
                    && let Some(aux) =
                        chart_auxiliary::standard_chart_auxiliary_data(sheet_rt, chart_spec)
                {
                    let auxiliary_paths =
                        chart_auxiliary::supported_auxiliary_file_paths(aux, &chart_path);
                    // Write auxiliary files (style, colors XML) preserving their original paths.
                    for aux_file in &aux.auxiliary_files {
                        if !auxiliary_paths.contains(aux_file.path.trim_start_matches('/')) {
                            continue;
                        }
                        add_registered_part(
                            package_graph,
                            &mut zip,
                            &aux_file.path,
                            aux_file.data.clone(),
                        )?;
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

            for entry in chart_ex_entries {
                let chart_path = format!("xl/charts/chartEx{}.xml", entry.global_idx);
                add_registered_part(package_graph, &mut zip, &chart_path, entry.xml.clone())?;

                // Write ChartEx auxiliary files only when the current chart
                // still carries imported chart identity.
                let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
                if chart_allows_auxiliary_replay(chart_spec)
                    && let Some(aux) =
                        chart_auxiliary::chart_ex_auxiliary_data(sheet_rt, chart_spec)
                {
                    let auxiliary_paths =
                        chart_auxiliary::supported_auxiliary_file_paths(aux, &chart_path);
                    for aux_file in &aux.auxiliary_files {
                        if !auxiliary_paths.contains(aux_file.path.trim_start_matches('/')) {
                            continue;
                        }
                        add_registered_part(
                            package_graph,
                            &mut zip,
                            &aux_file.path,
                            aux_file.data.clone(),
                        )?;
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
        add_registered_part(package_graph, &mut zip, &zip_path, image_bytes)?;
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
            let drawing_rels_path =
                crate::write::package_graph::part_relationships_path(drawing_path);

            if let Some(ref drawing_xml) = drawing_xml_data[idx] {
                add_registered_part(package_graph, &mut zip, drawing_path, drawing_xml.clone())?;
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

fn add_registered_part(
    package_graph: &ResolvedPackageGraph,
    zip: &mut ZipWriter,
    path: &str,
    data: Vec<u8>,
) -> Result<(), WriteError> {
    if !package_graph.contains_part(path) {
        return Err(WriteError::PackageIntegrity(format!(
            "attempted to write unregistered package part: {}",
            path.trim_start_matches('/')
        )));
    }
    zip.add_file(path, data);
    Ok(())
}
