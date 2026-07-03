use std::collections::{BTreeSet, HashMap};

use super::WriteError;
use super::assembly::WorksheetCustomPropertyGraphEntry;

#[derive(Clone)]
pub(super) struct WorksheetCustomProperties {
    pub xml: String,
    pub parts: Vec<WorksheetCustomPropertyPart>,
}

#[derive(Clone)]
pub(super) struct WorksheetCustomPropertyPart {
    pub path: String,
    pub relationship_id_hint: String,
    pub data: Vec<u8>,
}

pub(super) fn build_for_sheet(
    sheet_idx: usize,
    sheet_data: &domain_types::SheetData,
    package_fidelity: Option<&domain_types::PackageFidelityMetadata>,
) -> Option<WorksheetCustomProperties> {
    let xml = sheet_data
        .worksheet_semantic_containers
        .custom_properties
        .as_ref()?
        .raw_xml
        .clone();
    if xml.is_empty() {
        return None;
    }

    let referenced_ids: BTreeSet<String> = crate::infra::xml::relationship_attr_values(&xml)
        .into_iter()
        .collect();
    if referenced_ids.is_empty() {
        return Some(WorksheetCustomProperties {
            xml,
            parts: Vec::new(),
        });
    }

    let metadata = package_fidelity?;
    let owner_path = worksheet_owner_path(sheet_idx);
    let relationships = metadata
        .part_relationships
        .iter()
        .find(|info| domain_types::normalize_package_path(&info.owner_path) == owner_path)?;
    let opaque_parts_by_path: HashMap<String, &domain_types::OpaquePackagePartHint> = metadata
        .opaque_parts
        .iter()
        .map(|part| (domain_types::normalize_package_path(&part.path), part))
        .collect();

    let mut parts = Vec::new();
    let mut unresolved_ids = BTreeSet::new();
    for relationship_id in &referenced_ids {
        let Some(relationship) = relationships.relationships.iter().find(|relationship| {
            relationship.id == *relationship_id
                && relationship.relationship_type == crate::infra::opc::REL_CUSTOM_PROPERTY
                && !crate::write::package_graph::is_external_target_mode(
                    relationship.target_mode.as_deref(),
                )
        }) else {
            unresolved_ids.insert(relationship_id.clone());
            continue;
        };
        let Some(target_path) =
            crate::infra::opc::resolve_relationship_target(Some(&owner_path), &relationship.target)
                .ok()
                .map(|target| domain_types::normalize_package_path(&target))
        else {
            unresolved_ids.insert(relationship_id.clone());
            continue;
        };
        if !is_worksheet_custom_property_part(&target_path) {
            unresolved_ids.insert(relationship_id.clone());
            continue;
        }
        let Some(part) = opaque_parts_by_path.get(&target_path) else {
            unresolved_ids.insert(relationship_id.clone());
            continue;
        };
        parts.push(WorksheetCustomPropertyPart {
            path: target_path,
            relationship_id_hint: relationship.id.clone(),
            data: part.bytes.clone(),
        });
    }

    if parts.is_empty() {
        return None;
    }
    let xml = remove_custom_property_entries_with_relationship_ids(&xml, &unresolved_ids);
    if !unresolved_ids.is_empty()
        && crate::infra::xml::relationship_attr_values(&xml)
            .iter()
            .any(|id| unresolved_ids.contains(id))
    {
        return None;
    }
    if !contains_custom_property_entry(&xml) {
        return None;
    }

    Some(WorksheetCustomProperties { xml, parts })
}

pub(super) fn remap_relationship_ids(
    package_graph: &crate::write::package_graph::ResolvedPackageGraph,
    sheet_idx: usize,
    custom_properties: &WorksheetCustomProperties,
    relationships: &[WorksheetCustomPropertyGraphEntry],
    relationship_keys: &[(
        usize,
        crate::write::package_graph::RegisteredRelationshipKey,
    )],
) -> Result<String, WriteError> {
    let mut resolved_ids = HashMap::new();
    for (entry_idx, relationship_key) in relationship_keys
        .iter()
        .filter(|(entry_idx, _)| relationships[*entry_idx].sheet_idx == sheet_idx)
    {
        let entry = &relationships[*entry_idx];
        let resolved_id = package_graph
            .relationship_id_for_key(*relationship_key)
            .ok_or_else(|| {
                WriteError::PackageIntegrity(format!(
                    "missing worksheet custom-property relationship for sheet {} target {}",
                    sheet_idx + 1,
                    entry.target
                ))
            })?;
        if resolved_id != entry.relationship_id_hint {
            resolved_ids.insert(entry.relationship_id_hint.clone(), resolved_id.to_string());
        }
    }

    Ok(crate::infra::xml::remap_relationship_attrs(
        &custom_properties.xml,
        &resolved_ids,
    ))
}

fn worksheet_owner_path(sheet_idx: usize) -> String {
    format!("xl/worksheets/sheet{}.xml", sheet_idx + 1)
}

fn is_worksheet_custom_property_part(path: &str) -> bool {
    path.starts_with("xl/customProperty/") && path.ends_with(".xml")
}

fn remove_custom_property_entries_with_relationship_ids(
    xml: &str,
    relationship_ids: &BTreeSet<String>,
) -> String {
    if relationship_ids.is_empty() {
        return xml.to_string();
    }

    let bytes = xml.as_bytes();
    let mut out = String::with_capacity(xml.len());
    let mut cursor = 0;
    let mut search_from = 0;
    while let Some(start) = crate::infra::scanner::find_tag_simd(bytes, b"customPr", search_from) {
        let Some((_, end)) = crate::infra::xml_fragment::extract_element_bounds(bytes, start)
        else {
            break;
        };
        let fragment = &xml[start..end];
        if crate::infra::xml::relationship_attr_values(fragment)
            .iter()
            .any(|id| relationship_ids.contains(id))
        {
            out.push_str(&xml[cursor..start]);
            cursor = end;
        }
        search_from = end;
    }
    out.push_str(&xml[cursor..]);
    out
}

fn contains_custom_property_entry(xml: &str) -> bool {
    crate::infra::scanner::find_tag_simd(xml.as_bytes(), b"customPr", 0).is_some()
}
