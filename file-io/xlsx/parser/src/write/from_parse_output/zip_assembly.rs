use domain_types::ParseOutput;

use super::assembly::{
    ChartEntry, ChartExEntry, SheetExtras, WorksheetCommentsGraphEntry, WorksheetDrawingGraphEntry,
    WorksheetFormControlVmlGraphEntry, WorksheetOleVmlGraphEntry,
    WorksheetThreadedCommentsGraphEntry,
};
use super::{WriteError, chart_auxiliary, chart_replay, external_links, vml_merge};
use crate::domain::content_types::write::ContentTypesManager;
use crate::write::package_graph::ResolvedPackageGraph;
use crate::write::pivot_writer::PivotWriteData;
use crate::write::{CompressionMethod, ControlsWriter, SheetWriter, ZipWriter};

#[allow(clippy::too_many_arguments)]
pub(super) fn write_zip_package(
    output: &ParseOutput,
    package_graph: &ResolvedPackageGraph,
    pivot_data: &PivotWriteData,
    sheet_writers: Vec<SheetWriter>,
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
    rich_data_parts: Vec<domain_types::RichDataPart>,
    rich_data_related_parts: Vec<domain_types::RichDataRelatedPart>,
    persons_xml: Option<Vec<u8>>,
    all_chart_entries: &[Vec<ChartEntry>],
    all_chart_ex_entries: &[Vec<ChartExEntry>],
    all_image_blobs: Vec<(String, Vec<u8>)>,
    drawing_xml_data: &[Option<Vec<u8>>],
    worksheet_comments_relationships: &[WorksheetCommentsGraphEntry],
    worksheet_form_control_vml_relationships: &[WorksheetFormControlVmlGraphEntry],
    worksheet_ole_vml_relationships: &[WorksheetOleVmlGraphEntry],
    worksheet_drawing_relationships: &[WorksheetDrawingGraphEntry],
    worksheet_threaded_comments_relationships: &[WorksheetThreadedCommentsGraphEntry],
) -> Result<Vec<u8>, WriteError> {
    // Build content types from the resolved package graph. Imported manifest
    // hints may update graph-required rows, but cannot add stale rows.
    let _total_table_count: usize = sheet_extras.iter().map(|e| e.tables.len()).sum();

    let mut content_types = ContentTypesManager::new();
    package_graph.add_content_types_to(&mut content_types);
    package_graph.apply_content_type_preferences_to(&mut content_types);
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
        let theme_path = output
            .theme
            .as_ref()
            .and_then(|theme| theme.theme_part_path.as_deref())
            .unwrap_or("xl/theme/theme1.xml")
            .trim_start_matches('/');
        add_registered_part(package_graph, &mut zip, theme_path, theme.clone())?;
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
    if let Some(part) = &output.volatile_dependency_part {
        add_registered_part(package_graph, &mut zip, &part.path, part.bytes.clone())?;
        let owner = crate::write::package_graph::PackageOwner::Part {
            path: part.path.clone(),
        };
        let rels = package_graph.relationship_manager_for_owner(&owner);
        if !rels.is_empty() {
            zip.add_file(
                &crate::write::package_graph::part_relationships_path(&part.path),
                rels.to_xml(),
            );
        }
    }
    if let Some(feature_properties) = output
        .metadata
        .as_ref()
        .map(|metadata| &metadata.feature_properties)
        .filter(|feature_properties| {
            !feature_properties.bags.is_empty()
                && feature_properties
                    .bags
                    .iter()
                    .all(|bag| bag.kind != domain_types::FeaturePropertyBagKind::Unknown)
        })
    {
        let path = feature_properties
            .package
            .as_ref()
            .map(|package| package.path.as_str())
            .unwrap_or(crate::domain::feature_property_bags::DEFAULT_FEATURE_PROPERTY_BAG_PATH);
        add_registered_part(
            package_graph,
            &mut zip,
            path,
            crate::domain::feature_property_bags::write_feature_property_bags_xml(
                feature_properties,
            ),
        )?;
    }

    // Metadata passthrough
    if let Some(ref meta) = metadata_xml {
        add_registered_part(package_graph, &mut zip, "xl/metadata.xml", meta.clone())?;
    }
    for part in rich_data_parts {
        add_registered_part(package_graph, &mut zip, &part.path, part.data)?;
        let owner = crate::write::package_graph::PackageOwner::Part {
            path: part.path.clone(),
        };
        let rels = package_graph.relationship_manager_for_owner(&owner);
        if !rels.is_empty() {
            zip.add_file(
                &crate::write::package_graph::part_relationships_path(&part.path),
                rels.to_xml(),
            );
        }
    }
    for part in rich_data_related_parts {
        add_registered_part(package_graph, &mut zip, &part.path, part.data)?;
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
            external_links::with_resolved_relationship_ids(package_graph, link, &owner)?;
        let xml = crate::domain::external::write::write_external_link_xml(&link_for_xml);
        add_registered_part(package_graph, &mut zip, &zip_path, xml)?;
        let rels = package_graph.relationship_manager_for_owner(&owner);
        if !rels.is_empty() {
            zip.add_file(&external_links::rels_path(&zip_path), rels.to_xml());
        }
    }

    if !output.connections.is_empty() {
        let xml =
            crate::domain::connections::write_connections_xml(&output.connections.connections);
        add_registered_part(package_graph, &mut zip, "xl/connections.xml", xml)?;
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
            let comments_entry = worksheet_comments_relationships
                .iter()
                .find(|entry| entry.sheet_idx == idx)
                .ok_or_else(|| {
                    WriteError::PackageIntegrity(format!(
                        "missing graph-registered comments parts for sheet {}",
                        idx + 1
                    ))
                })?;
            add_registered_part(
                package_graph,
                &mut zip,
                &comments_entry.comments_path,
                comments_xml.clone(),
            )?;
            let merged_vml = if !sheet_extras[idx].form_controls.is_empty()
                || !sheet_extras[idx].ole_objects.is_empty()
            {
                let base_shape_id =
                    vml_merge::form_control_base_shape_id(&output.sheets[idx].comments);
                let controls_writer = ControlsWriter::new(sheet_extras[idx].form_controls.clone());
                let preview_rel_ids = ole_preview_relationship_ids(
                    package_graph,
                    &comments_entry.vml_path,
                    &sheet_extras[idx],
                );
                let form_control_vml = controls_writer.write_vml_with_ole(
                    base_shape_id,
                    &sheet_extras[idx]
                        .ole_objects
                        .iter()
                        .map(|entry| entry.object.clone())
                        .collect::<Vec<_>>(),
                    &preview_rel_ids,
                );
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
            add_registered_part(
                package_graph,
                &mut zip,
                &comments_entry.vml_path,
                merged_vml,
            )?;
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

        // Form controls and OLE objects: ctrlProp XML files and shared VML drawing
        if !sheet_extras[idx].form_controls.is_empty() || !sheet_extras[idx].ole_objects.is_empty()
        {
            let base_shape_id = if sheet_extras[idx].comments.is_some() {
                vml_merge::form_control_base_shape_id(&output.sheets[idx].comments)
            } else {
                1025
            };
            let controls = sheet_extras[idx].form_controls.clone();
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

            // Write VML drawing for form controls and OLE objects (separate from comment VML)
            if sheet_extras[idx].comments.is_none() {
                let vml_path = worksheet_form_control_vml_relationships
                    .iter()
                    .find(|entry| entry.sheet_idx == idx)
                    .map(|entry| entry.path.as_str())
                    .or_else(|| {
                        worksheet_ole_vml_relationships
                            .iter()
                            .find(|entry| entry.sheet_idx == idx)
                            .map(|entry| entry.path.as_str())
                    })
                    .ok_or_else(|| {
                        WriteError::PackageIntegrity(format!(
                            "missing graph-registered legacy VML part for sheet {}",
                            idx + 1
                        ))
                    })?;
                let preview_rel_ids =
                    ole_preview_relationship_ids(package_graph, vml_path, &sheet_extras[idx]);
                let ole_objects = sheet_extras[idx]
                    .ole_objects
                    .iter()
                    .map(|entry| entry.object.clone())
                    .collect::<Vec<_>>();
                let vml_xml = controls_writer.write_vml_with_ole(
                    base_shape_id,
                    &ole_objects,
                    &preview_rel_ids,
                );
                add_registered_part(package_graph, &mut zip, vml_path, vml_xml)?;
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

    let mut written_ole_parts = std::collections::BTreeSet::new();
    let mut vml_paths_with_preview_rels = std::collections::BTreeSet::new();
    for (idx, extras) in sheet_extras.iter().enumerate() {
        if extras.ole_objects.is_empty() {
            continue;
        }
        for ole in &extras.ole_objects {
            if written_ole_parts.insert(ole.embedding_path.clone()) {
                add_registered_part(
                    package_graph,
                    &mut zip,
                    &ole.embedding_path,
                    ole.embedding_bytes.clone(),
                )?;
            }
            if let (Some(path), Some(bytes)) = (&ole.preview_path, &ole.preview_bytes)
                && written_ole_parts.insert(path.clone())
            {
                add_registered_part(package_graph, &mut zip, path, bytes.clone())?;
            }
        }

        let Some(vml_path) = legacy_vml_path_for_sheet(
            idx,
            worksheet_comments_relationships,
            worksheet_form_control_vml_relationships,
            worksheet_ole_vml_relationships,
        ) else {
            continue;
        };
        if vml_paths_with_preview_rels.insert(vml_path.clone()) {
            let vml_rels = package_graph.relationship_manager_for_owner(
                &crate::write::package_graph::PackageOwner::Part {
                    path: vml_path.clone(),
                },
            );
            if !vml_rels.is_empty() {
                zip.add_file(
                    &crate::write::package_graph::part_relationships_path(&vml_path),
                    vml_rels.to_xml(),
                );
            }
        }
    }

    // Table XML files
    {
        let mut table_global = 0usize;
        let mut query_table_global = 0usize;
        for extras in sheet_extras {
            for (local_idx, table_xml) in extras.tables.iter().enumerate() {
                table_global += 1;
                add_registered_part(
                    package_graph,
                    &mut zip,
                    &format!("xl/tables/table{}.xml", table_global),
                    table_xml.clone(),
                )?;
                let owner = crate::write::package_graph::PackageOwner::Part {
                    path: format!("xl/tables/table{}.xml", table_global),
                };
                let table_rels = package_graph.relationship_manager_for_owner(&owner);
                if !table_rels.is_empty() {
                    zip.add_file(
                        &format!("xl/tables/_rels/table{}.xml.rels", table_global),
                        table_rels.to_xml(),
                    );
                }
                if let Some(query_table) = extras
                    .source_tables
                    .get(local_idx)
                    .and_then(|table| table.query_table.as_ref())
                {
                    query_table_global += 1;
                    add_registered_part(
                        package_graph,
                        &mut zip,
                        &format!("xl/queryTables/queryTable{}.xml", query_table_global),
                        crate::domain::connections::write_query_table_xml(query_table),
                    )?;
                }
            }
        }
    }

    // Slicer XML files
    {
        let mut slicer_global = 0usize;
        for sheet in &output.sheets {
            for slicer in &sheet.slicers {
                slicer_global += 1;
                let xml =
                    crate::domain::slicers::write::write_slicer_part(std::slice::from_ref(slicer));
                add_registered_part(
                    package_graph,
                    &mut zip,
                    &format!("xl/slicers/slicer{}.xml", slicer_global),
                    xml,
                )?;
            }
        }
    }

    for (idx, cache) in output.slicer_caches.iter().enumerate() {
        let xml = crate::domain::slicers::write::write_slicer_cache(cache);
        add_registered_part(
            package_graph,
            &mut zip,
            &format!("xl/slicerCaches/slicerCache{}.xml", idx + 1),
            xml,
        )?;
    }

    // Timeline XML files
    {
        let mut timeline_global = 0usize;
        for sheet in &output.sheets {
            if sheet.timelines.is_empty() {
                continue;
            }
            timeline_global += 1;
            let xml = crate::domain::timelines::write::write_timeline_part(&sheet.timelines);
            add_registered_part(
                package_graph,
                &mut zip,
                &format!("xl/timelines/timeline{}.xml", timeline_global),
                xml,
            )?;
        }
    }

    for (idx, cache) in output.timeline_caches.iter().enumerate() {
        let xml = crate::domain::timelines::write::write_timeline_cache(cache);
        add_registered_part(
            package_graph,
            &mut zip,
            &format!("xl/timelineCaches/timelineCache{}.xml", idx + 1),
            xml,
        )?;
    }

    // Pivot table and cache XML files
    for entry in &pivot_data.pivot_table_entries {
        add_registered_part(package_graph, &mut zip, &entry.path, entry.xml.clone())?;
        let pt_rels = package_graph.relationship_manager_for_owner(
            &crate::write::package_graph::PackageOwner::Part {
                path: entry.path.clone(),
            },
        );
        if !pt_rels.is_empty() {
            zip.add_file(&entry.rels_path, pt_rels.to_xml());
        }
    }
    for entry in &pivot_data.pivot_cache_entries {
        add_registered_part(
            package_graph,
            &mut zip,
            &entry.definition_path,
            entry.definition_xml.clone(),
        )?;
        if let (Some(records_path), Some(records_xml)) = (&entry.records_path, &entry.records_xml) {
            add_registered_part(package_graph, &mut zip, records_path, records_xml.clone())?;
        }
        // Pivot cache definition rels (definition → records relationship).
        let cache_rels = package_graph.relationship_manager_for_owner(
            &crate::write::package_graph::PackageOwner::Part {
                path: entry.definition_path.clone(),
            },
        );
        if !cache_rels.is_empty() {
            zip.add_file(
                &pivot_cache_rels_path(&entry.definition_path),
                cache_rels.to_xml(),
            );
        }
    }

    // Chart XML files + auxiliary files (style, colors, .rels)
    {
        for (sheet_idx, chart_entries) in all_chart_entries.iter().enumerate() {
            for entry in chart_entries {
                let chart_path = format!("xl/charts/chart{}.xml", entry.global_idx);
                add_registered_part(package_graph, &mut zip, &chart_path, entry.xml.clone())?;
                let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
                let typed_user_shapes =
                    chart_auxiliary::chart_user_shapes_data(chart_spec, &chart_path);
                let mut written_auxiliary_paths = std::collections::BTreeSet::new();

                // Write chart auxiliary files (style XML, colors XML) only
                // when the current chart still carries imported chart identity.
                if chart_replay::chart_allows_auxiliary_replay(chart_spec)
                    && let Some(aux) = chart_auxiliary::chart_auxiliary_data(chart_spec)
                {
                    let auxiliary_paths =
                        chart_auxiliary::supported_auxiliary_file_paths(&aux, &chart_path);
                    // Write auxiliary files (style, colors XML) preserving their original paths.
                    for (path, data) in aux.auxiliary_files {
                        if !auxiliary_paths.contains(path.trim_start_matches('/')) {
                            continue;
                        }
                        written_auxiliary_paths.insert(path.trim_start_matches('/').to_string());
                        add_registered_part(package_graph, &mut zip, path, data.clone())?;
                    }
                }
                if let Some(user_shapes) = typed_user_shapes
                    && written_auxiliary_paths.insert(user_shapes.path.clone())
                {
                    add_registered_part(
                        package_graph,
                        &mut zip,
                        &user_shapes.path,
                        user_shapes.data.to_vec(),
                    )?;
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
            for entry in chart_ex_entries {
                let chart_path = format!("xl/charts/chartEx{}.xml", entry.global_idx);
                add_registered_part(package_graph, &mut zip, &chart_path, entry.xml.clone())?;

                // Write ChartEx auxiliary files only when the current chart
                // still carries imported chart identity.
                let chart_spec = &output.sheets[sheet_idx].charts[entry.source_idx];
                if chart_replay::chart_allows_auxiliary_replay(chart_spec)
                    && let Some(aux) = chart_auxiliary::chart_auxiliary_data(chart_spec)
                {
                    let auxiliary_paths =
                        chart_auxiliary::supported_auxiliary_file_paths(&aux, &chart_path);
                    for (path, data) in aux.auxiliary_files {
                        if !auxiliary_paths.contains(path.trim_start_matches('/')) {
                            continue;
                        }
                        add_registered_part(package_graph, &mut zip, path, data.clone())?;
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

            let drawing_rels = package_graph.relationship_manager_for_owner(
                &crate::write::package_graph::PackageOwner::Part {
                    path: drawing_path.to_string(),
                },
            );
            if !drawing_rels.is_empty() {
                zip.add_file(&drawing_rels_path, drawing_rels.to_xml());
            }
        }
    }

    for part in package_graph.opaque_parts() {
        let bytes = part.bytes.clone().ok_or_else(|| {
            WriteError::PackageIntegrity(format!("opaque part {} has no bytes to emit", part.path))
        })?;
        zip.add_file(&part.path, bytes);
        let owner = crate::write::package_graph::PackageOwner::Part {
            path: part.path.clone(),
        };
        let rels = package_graph.relationship_manager_for_owner(&owner);
        if !rels.is_empty() {
            zip.add_file(
                &crate::write::package_graph::part_relationships_path(&part.path),
                rels.to_xml(),
            );
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

fn pivot_cache_rels_path(definition_path: &str) -> String {
    let (dir, file_name) = definition_path
        .rsplit_once('/')
        .unwrap_or(("xl/pivotCache", definition_path));
    format!("{dir}/_rels/{file_name}.rels")
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

fn ole_preview_relationship_ids(
    package_graph: &ResolvedPackageGraph,
    vml_path: &str,
    extras: &SheetExtras,
) -> Vec<String> {
    let owner = crate::write::package_graph::PackageOwner::Part {
        path: vml_path.to_string(),
    };
    extras
        .ole_objects
        .iter()
        .map(|ole| {
            let Some(preview_path) = &ole.preview_path else {
                return String::new();
            };
            let target = relative_target(vml_path, preview_path);
            package_graph
                .relationship_id(
                    &owner,
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
                    &target,
                )
                .map(str::to_string)
                .unwrap_or_default()
        })
        .collect()
}

fn legacy_vml_path_for_sheet(
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

fn relative_target(owner_path: &str, target_path: &str) -> String {
    let from_dir = owner_path.rsplit_once('/').map_or("", |(dir, _)| dir);
    let from_components: Vec<_> = from_dir
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let to_components: Vec<_> = target_path
        .trim_start_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let common = from_components
        .iter()
        .zip(&to_components)
        .take_while(|(a, b)| a == b)
        .count();
    let mut result = vec![".."; from_components.len().saturating_sub(common)];
    result.extend(to_components[common..].iter().copied());
    result.join("/")
}
