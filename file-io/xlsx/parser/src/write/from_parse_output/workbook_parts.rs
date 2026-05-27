use domain_types::{ParseOutput, RoundTripContext};

use super::WriteError;
use super::external_links;
use crate::write::package_graph::ResolvedPackageGraph;
use crate::write::pivot_writer;
use crate::write::pivot_writer::PivotWriteData;
use crate::write::relationships::RelationshipManager;
use crate::write::{
    DefinedNameDef, REL_EXTERNAL_LINK, REL_PIVOT_CACHE, REL_WORKSHEET, SheetDef, WorkbookWriter,
};

pub(super) struct WorkbookXmlParts {
    pub(super) workbook_xml: Vec<u8>,
    pub(super) workbook_rels_xml: Vec<u8>,
}

pub(super) fn build_workbook_xml(
    output: &ParseOutput,
    round_trip_ctx: Option<&RoundTripContext>,
    package_graph: &ResolvedPackageGraph,
    pivot_data: &PivotWriteData,
    external_link_exports: &[(domain_types::domain::external_link::ExternalLink, String)],
    sheet_rels_data: &mut [Option<RelationshipManager>],
) -> Result<WorkbookXmlParts, WriteError> {
    // ── 4. Build workbook.xml ───────────────────────────────────────────
    let mut workbook_writer = WorkbookWriter::new();
    for (idx, sheet_data) in output.sheets.iter().enumerate() {
        let sheet_target = format!("worksheets/sheet{}.xml", idx + 1);
        let r_id = package_graph
            .relationship_id(
                &crate::write::package_graph::PackageOwner::Workbook,
                REL_WORKSHEET,
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
        workbook_writer.add_sheet_def(SheetDef::with_state(
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
            let preserved_pairs: Vec<_> = ctx
                .workbook_preserved_elements
                .iter()
                .filter(|(_, xml)| !raw_xml_contains_relationship_id_attr(xml))
                .cloned()
                .collect();
            if !preserved_pairs.is_empty() {
                let preserved =
                    crate::roundtrip::unknown_elements::PreservedElements::from_position_pairs(
                        &preserved_pairs,
                    );
                workbook_writer.set_preserved_elements(preserved);
            }
        }
    }

    // ── Iterative Calc Settings ──────────────────────────────────────
    {
        let calc = crate::domain::workbook::write::calc_settings_from_domain(&output.calculation);
        workbook_writer.set_calc_settings(calc);
    }

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

    if !external_link_exports.is_empty() {
        let external_reference_r_ids: Vec<String> = external_link_exports
            .iter()
            .filter_map(|(_, part_name)| {
                package_graph
                    .relationship_id(
                        &crate::write::package_graph::PackageOwner::Workbook,
                        REL_EXTERNAL_LINK,
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

    Ok(WorkbookXmlParts {
        workbook_xml,
        workbook_rels_xml,
    })
}

fn raw_xml_contains_relationship_id_attr(raw_xml: &str) -> bool {
    raw_xml_contains_r_id_attr(raw_xml) || raw_xml_contains_prefixed_relationship_id_attr(raw_xml)
}

fn raw_xml_contains_r_id_attr(raw_xml: &str) -> bool {
    let bytes = raw_xml.as_bytes();
    let mut pos = 0;
    while let Some(offset) = find_subslice(&bytes[pos..], b"r:id") {
        pos += offset + b"r:id".len();
        let mut cursor = pos;
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if bytes.get(cursor) == Some(&b'=') {
            return true;
        }
    }
    false
}

fn raw_xml_contains_prefixed_relationship_id_attr(raw_xml: &str) -> bool {
    let bytes = raw_xml.as_bytes();
    let mut pos = 0;

    while let Some(offset) = find_subslice(&bytes[pos..], b":id") {
        let colon = pos + offset;
        let attr_end = colon + b":id".len();
        let mut cursor = attr_end;
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'=') {
            pos = attr_end;
            continue;
        }
        cursor += 1;
        while bytes
            .get(cursor)
            .is_some_and(|byte| byte.is_ascii_whitespace())
        {
            cursor += 1;
        }

        let Some(&quote) = bytes.get(cursor) else {
            pos = attr_end;
            continue;
        };
        if quote != b'"' && quote != b'\'' {
            pos = attr_end;
            continue;
        }
        cursor += 1;
        if bytes
            .get(cursor..cursor + b"rId".len())
            .is_some_and(|value| value == b"rId")
        {
            return true;
        }

        pos = attr_end;
    }

    false
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
