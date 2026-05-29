use domain_types::{ParseOutput, WorkbookSheetKind};

use super::WriteError;
use super::external_links;
use crate::infra::xml_namespaces::NamespaceMap;
use crate::write::package_graph::{PackageOwner, ResolvedPackageGraph};
use crate::write::pivot_writer;
use crate::write::pivot_writer::PivotWriteData;
use crate::write::{
    DefinedNameDef, REL_EXTERNAL_LINK, REL_SLICER_CACHE, REL_WORKSHEET, SheetDef, WorkbookWriter,
};

pub(super) struct WorkbookXmlParts {
    pub(super) workbook_xml: Vec<u8>,
    pub(super) workbook_rels_xml: Vec<u8>,
}

pub(super) fn build_workbook_xml(
    output: &ParseOutput,
    package_graph: &ResolvedPackageGraph,
    pivot_data: &PivotWriteData,
    external_link_exports: &[(domain_types::domain::external_link::ExternalLink, String)],
) -> Result<WorkbookXmlParts, WriteError> {
    // ── 4. Build workbook.xml ───────────────────────────────────────────
    let mut workbook_writer = WorkbookWriter::new();
    if !output.workbook_root_namespaces.is_empty() {
        workbook_writer.set_root_namespaces(NamespaceMap::from(&output.workbook_root_namespaces));
    }
    if let Some(fidelity) = output
        .package_fidelity
        .as_ref()
        .map(|package| package.workbook_xml_fidelity.clone())
        .filter(|fidelity| !fidelity.is_empty())
    {
        workbook_writer.set_workbook_xml_fidelity(fidelity);
    }
    if output.workbook_sheet_inventory.is_empty() {
        add_generated_sheet_defs(output, package_graph, &mut workbook_writer)?;
    } else {
        add_inventory_sheet_defs(output, package_graph, &mut workbook_writer)?;
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
    if let Some(xml) = output.custom_workbook_views_xml.as_ref() {
        workbook_writer.set_custom_workbook_views_xml(xml.clone());
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
        def.function_group_id = named_range.function_group_id;
        def.shortcut_key = named_range.shortcut_key.clone();
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
    if let Some(ref web_publishing) = output.web_publishing {
        workbook_writer.set_web_publishing(web_publishing.clone());
    }
    workbook_writer.set_conformance(output.workbook_conformance.clone());

    // ── Iterative Calc Settings ──────────────────────────────────────
    {
        let calc = crate::domain::workbook::write::calc_settings_for_export(
            &output.calculation,
            Some(&output.calc_id_provenance),
            super::export_report::requires_consumer_recalc(output),
        );
        workbook_writer.set_calc_settings(calc.settings);
    }

    let workbook_rels = package_graph.relationship_manager_for_owner(&PackageOwner::Workbook);
    // Pivot cache workbook rels + pivotCaches XML for workbook.xml.
    // Pivot caches are generated from modeled pivot state; the removed legacy
    // round-trip sidecar must not contribute workbook cache entries.
    let mut pivot_cache_xml_entries: Vec<(u32, String)> = Vec::new();
    let mut x14_pivot_cache_xml_entries: Vec<(u32, String)> = Vec::new();
    let mut x15_timeline_pivot_cache_xml_entries: Vec<(u32, String)> = Vec::new();
    for entry in &pivot_data.pivot_cache_entries {
        let target = workbook_relative_target(&entry.definition_path);
        let r_id = package_graph
            .relationship_id(
                &PackageOwner::Workbook,
                &entry.workbook_relationship_type,
                &target,
            )
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing workbook relationship for generated pivot cache {target}"
                ))
            })?
            .to_string();
        match entry.workbook_ref_scope {
            domain_types::domain::pivot::PivotCacheWorkbookRefScope::WorkbookPivotCaches => {
                pivot_cache_xml_entries.push((entry.cache_id, r_id));
            }
            domain_types::domain::pivot::PivotCacheWorkbookRefScope::X14PivotCaches => {
                x14_pivot_cache_xml_entries.push((entry.cache_id, r_id));
            }
            domain_types::domain::pivot::PivotCacheWorkbookRefScope::X15TimelineCachePivotCaches => {
                x15_timeline_pivot_cache_xml_entries.push((entry.cache_id, r_id));
            }
        }
    }
    if !pivot_cache_xml_entries.is_empty() {
        let pivot_caches_xml = pivot_writer::build_pivot_caches_xml(&pivot_cache_xml_entries);
        workbook_writer.set_pivot_caches_xml(pivot_caches_xml);
    }
    let x14_pivot_caches_xml =
        pivot_writer::build_x14_pivot_caches_ext_xml(&x14_pivot_cache_xml_entries);
    if !x14_pivot_caches_xml.is_empty() {
        workbook_writer.add_ext_lst_entry(x14_pivot_caches_xml);
    }
    let x15_timeline_pivot_caches_xml = pivot_writer::build_x15_timeline_cache_pivot_caches_ext_xml(
        &x15_timeline_pivot_cache_xml_entries,
    );
    if !x15_timeline_pivot_caches_xml.is_empty() {
        workbook_writer.add_ext_lst_entry(x15_timeline_pivot_caches_xml);
    }

    let slicer_cache_r_ids: Vec<String> = output
        .slicer_caches
        .iter()
        .enumerate()
        .filter_map(|(idx, _)| {
            let target = format!("slicerCaches/slicerCache{}.xml", idx + 1);
            package_graph
                .relationship_id(&PackageOwner::Workbook, REL_SLICER_CACHE, &target)
                .map(str::to_string)
        })
        .collect();
    if !slicer_cache_r_ids.is_empty() {
        let refs: Vec<&str> = slicer_cache_r_ids.iter().map(String::as_str).collect();
        let mut writer = crate::write::xml_writer::XmlWriter::new();
        crate::domain::slicers::write::write_workbook_slicer_caches_ext(&mut writer, &refs);
        workbook_writer.add_ext_lst_entry(String::from_utf8(writer.finish()).unwrap_or_default());
    }

    if !external_link_exports.is_empty() {
        let external_reference_r_ids: Vec<String> = external_link_exports
            .iter()
            .filter_map(|(_, part_name)| {
                package_graph
                    .relationship_id(
                        &PackageOwner::Workbook,
                        REL_EXTERNAL_LINK,
                        &external_links::workbook_target(part_name),
                    )
                    .map(str::to_string)
            })
            .collect();
        workbook_writer.set_external_reference_r_ids(external_reference_r_ids);
    }

    let workbook_rels_xml = workbook_rels.to_xml();
    let workbook_xml = workbook_writer.to_xml();

    Ok(WorkbookXmlParts {
        workbook_xml,
        workbook_rels_xml,
    })
}

fn add_generated_sheet_defs(
    output: &ParseOutput,
    package_graph: &ResolvedPackageGraph,
    workbook_writer: &mut WorkbookWriter,
) -> Result<(), WriteError> {
    for (idx, sheet_data) in output.sheets.iter().enumerate() {
        let sheet_target = format!("worksheets/sheet{}.xml", idx + 1);
        let r_id = package_graph
            .relationship_id(&PackageOwner::Workbook, REL_WORKSHEET, &sheet_target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing workbook relationship for sheet {}",
                    idx + 1
                ))
            })?
            .to_string();
        let sheet_id = sheet_data.sheet_id.unwrap_or(idx as u32 + 1);
        workbook_writer.add_sheet_def(SheetDef::with_state(
            &sheet_data.name,
            sheet_id,
            &r_id,
            sheet_data.visibility,
        ));
    }
    Ok(())
}

fn add_inventory_sheet_defs(
    output: &ParseOutput,
    package_graph: &ResolvedPackageGraph,
    workbook_writer: &mut WorkbookWriter,
) -> Result<(), WriteError> {
    let mut inventory = output.workbook_sheet_inventory.clone();
    inventory.sort_by_key(|entry| entry.workbook_order);
    for entry in inventory {
        if !matches!(
            entry.kind,
            WorkbookSheetKind::Worksheet
                | WorkbookSheetKind::Chartsheet
                | WorkbookSheetKind::Dialogsheet
        ) {
            continue;
        }
        let Some(part_path) = entry.normalized_part_path.as_deref() else {
            continue;
        };
        if !matches!(entry.kind, WorkbookSheetKind::Worksheet)
            && !package_graph.contains_part(part_path)
        {
            continue;
        }
        let relationship_type = entry.relationship_type.as_deref().unwrap_or(REL_WORKSHEET);
        let target = workbook_relative_target(part_path);
        let r_id = package_graph
            .relationship_id(&PackageOwner::Workbook, relationship_type, &target)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing workbook relationship for imported sheet target {target}"
                ))
            })?
            .to_string();

        let sheet_data = entry
            .editable_sheet_index
            .and_then(|index| output.sheets.get(index));
        let name = sheet_data
            .map(|sheet| sheet.name.as_str())
            .unwrap_or(entry.name.as_str());
        let sheet_id = sheet_data
            .and_then(|sheet| sheet.sheet_id)
            .or(entry.sheet_id)
            .unwrap_or(entry.workbook_order + 1);
        let visibility = sheet_data
            .map(|sheet| sheet.visibility)
            .unwrap_or(entry.visibility);
        workbook_writer.add_sheet_def(SheetDef::with_state(name, sheet_id, &r_id, visibility));
    }
    Ok(())
}

fn workbook_relative_target(path: &str) -> String {
    path.strip_prefix("xl/")
        .unwrap_or(path)
        .trim_start_matches('/')
        .to_string()
}
