use std::collections::{HashMap, HashSet};

use domain_types::ParseOutput;

use super::assembly::WorksheetActiveXControlGraphEntry;
use crate::infra::scanner::{find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_u32_attr};
use crate::infra::xml_fragment::extract_element_bounds;

pub(super) fn imported_worksheet_active_x_controls(
    output: &ParseOutput,
    sheet_idx: usize,
) -> Vec<WorksheetActiveXControlGraphEntry> {
    let Some(metadata) = output.package_fidelity.as_ref() else {
        return Vec::new();
    };
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
    let Some(info) = metadata
        .part_relationships
        .iter()
        .find(|info| domain_types::normalize_package_path(&info.owner_path) == owner_path)
    else {
        return Vec::new();
    };
    let opaque_active_x_parts: std::collections::HashSet<_> = metadata
        .opaque_parts
        .iter()
        .map(|part| domain_types::normalize_package_path(&part.path))
        .filter(|path| path.starts_with("xl/activeX/"))
        .collect();

    info.relationships
        .iter()
        .filter(|relationship| {
            relationship.relationship_type == crate::infra::opc::REL_ACTIVE_X_CONTROL
                && !crate::write::package_graph::is_external_target_mode(
                    relationship.target_mode.as_deref(),
                )
        })
        .filter_map(|relationship| {
            let target_path = crate::infra::opc::resolve_relationship_target(
                Some(&owner_path),
                &relationship.target,
            )
            .ok()
            .map(|target| domain_types::normalize_package_path(&target))?;
            if !opaque_active_x_parts.contains(&target_path) {
                return None;
            }
            Some(WorksheetActiveXControlGraphEntry {
                sheet_idx,
                target_path,
                relationship_id_hint: relationship.id.clone(),
            })
        })
        .collect()
}

pub(super) fn remap_imported_worksheet_relationship_ids(
    output: &ParseOutput,
    package_graph: &crate::write::package_graph::ResolvedPackageGraph,
    sheet_idx: usize,
    raw_xml: &str,
) -> String {
    let Some(metadata) = output.package_fidelity.as_ref() else {
        return raw_xml.to_string();
    };
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
    let Some(info) = metadata
        .part_relationships
        .iter()
        .find(|info| domain_types::normalize_package_path(&info.owner_path) == owner_path)
    else {
        return raw_xml.to_string();
    };
    let owner = crate::write::package_graph::PackageOwner::Worksheet {
        index: sheet_idx,
        path: owner_path,
    };
    let mut resolved_ids = std::collections::HashMap::new();
    for relationship in &info.relationships {
        let Some(resolved_id) = package_graph.relationship_id(
            &owner,
            &relationship.relationship_type,
            &relationship.target,
        ) else {
            continue;
        };
        if resolved_id != relationship.id {
            resolved_ids.insert(relationship.id.clone(), resolved_id.to_string());
        }
    }
    crate::infra::xml::remap_relationship_attrs(raw_xml, &resolved_ids)
}

pub(super) fn merge_generated_controls_with_imported_active_x(
    output: &ParseOutput,
    package_graph: &crate::write::package_graph::ResolvedPackageGraph,
    sheet_idx: usize,
    generated_controls_xml: &str,
    raw_imported_controls_xml: &str,
    active_x_relationships: &[WorksheetActiveXControlGraphEntry],
) -> String {
    let imported_active_x_relationship_ids: HashSet<String> = active_x_relationships
        .iter()
        .filter(|entry| entry.sheet_idx == sheet_idx)
        .map(|entry| entry.relationship_id_hint.clone())
        .collect();
    let worksheet_relationship_types = worksheet_relationship_types_by_id(output, sheet_idx);
    let generated_shape_ids = control_shape_ids(generated_controls_xml);
    let imported_control_branches = imported_control_branches(
        raw_imported_controls_xml,
        &imported_active_x_relationship_ids,
        &worksheet_relationship_types,
        &generated_shape_ids,
    );
    if imported_control_branches.iter().all(String::is_empty) {
        return generated_controls_xml.to_string();
    }
    let remapped_control_branches: Vec<String> = imported_control_branches
        .into_iter()
        .map(|branch| {
            remap_imported_worksheet_relationship_ids(output, package_graph, sheet_idx, &branch)
        })
        .collect();
    append_controls_to_generated_controls_branches(
        generated_controls_xml,
        &remapped_control_branches,
    )
}

fn worksheet_relationship_types_by_id(
    output: &ParseOutput,
    sheet_idx: usize,
) -> HashMap<String, String> {
    let Some(metadata) = output.package_fidelity.as_ref() else {
        return HashMap::new();
    };
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
    metadata
        .part_relationships
        .iter()
        .find(|info| domain_types::normalize_package_path(&info.owner_path) == owner_path)
        .map(|info| {
            info.relationships
                .iter()
                .map(|relationship| {
                    (
                        relationship.id.clone(),
                        relationship.relationship_type.clone(),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn control_shape_ids(controls_xml: &str) -> HashSet<u32> {
    let bytes = controls_xml.as_bytes();
    let mut shape_ids = HashSet::new();
    let mut pos = 0;
    while let Some(control_start) = find_tag_simd(bytes, b"control", pos) {
        let Some(tag_end) = find_gt_simd(bytes, control_start).map(|pos| pos + 1) else {
            break;
        };
        let start_tag = &bytes[control_start..tag_end];
        if let Some(shape_id) = parse_u32_attr(start_tag, b"shapeId=\"") {
            shape_ids.insert(shape_id);
        }
        pos = tag_end;
    }
    shape_ids
}

fn imported_control_branches(
    controls_xml: &str,
    active_x_relationship_ids: &HashSet<String>,
    worksheet_relationship_types: &HashMap<String, String>,
    generated_shape_ids: &HashSet<u32>,
) -> Vec<String> {
    let bytes = controls_xml.as_bytes();
    let mut branches = Vec::new();
    let mut pos = 0;
    while let Some(controls_start) = find_tag_simd(bytes, b"controls", pos) {
        let Some((_, controls_end)) = extract_element_bounds(bytes, controls_start) else {
            let Some(tag_end) = find_gt_simd(bytes, controls_start).map(|pos| pos + 1) else {
                break;
            };
            pos = tag_end;
            continue;
        };
        let branch = imported_control_elements_in_branch(
            &bytes[controls_start..controls_end],
            active_x_relationship_ids,
            worksheet_relationship_types,
            generated_shape_ids,
        )
        .concat();
        branches.push(branch);
        pos = controls_end;
    }
    branches
}

fn imported_control_elements_in_branch(
    controls_branch: &[u8],
    active_x_relationship_ids: &HashSet<String>,
    worksheet_relationship_types: &HashMap<String, String>,
    generated_shape_ids: &HashSet<u32>,
) -> Vec<String> {
    let bytes = controls_branch;
    let mut controls = Vec::new();
    let mut pos = 0;
    while let Some(control_start) = find_tag_simd(bytes, b"control", pos) {
        let Some(tag_end) = find_gt_simd(bytes, control_start).map(|pos| pos + 1) else {
            break;
        };
        let start_tag = &bytes[control_start..tag_end];
        if !should_preserve_imported_control(
            start_tag,
            active_x_relationship_ids,
            worksheet_relationship_types,
            generated_shape_ids,
        ) {
            pos = tag_end;
            continue;
        }
        let Some((_, element_end)) = extract_element_bounds(bytes, control_start) else {
            pos = tag_end;
            continue;
        };
        if let Ok(element) = std::str::from_utf8(&bytes[control_start..element_end]) {
            controls.push(element.to_string());
        }
        pos = element_end;
    }
    controls
}

fn should_preserve_imported_control(
    start_tag: &[u8],
    active_x_relationship_ids: &HashSet<String>,
    worksheet_relationship_types: &HashMap<String, String>,
    generated_shape_ids: &HashSet<u32>,
) -> bool {
    let r_id = parse_string_attr(start_tag, b"r:id").unwrap_or_default();
    if active_x_relationship_ids.contains(&r_id) {
        return true;
    }
    if worksheet_relationship_types
        .get(&r_id)
        .is_some_and(|relationship_type| {
            relationship_type == crate::infra::opc::REL_ACTIVE_X_CONTROL
        })
    {
        return true;
    }
    if !r_id.is_empty() && !worksheet_relationship_types.contains_key(&r_id) {
        return true;
    }
    if parse_u32_attr(start_tag, b"shapeId=\"")
        .is_some_and(|shape_id| generated_shape_ids.contains(&shape_id))
    {
        return false;
    }
    true
}

fn append_controls_to_generated_controls_branches(
    generated_controls_xml: &str,
    imported_control_branches: &[String],
) -> String {
    let mut merged = generated_controls_xml.to_string();
    let generated_branch_count = generated_controls_xml.matches("</controls>").count();
    let mut search_from = 0;
    let mut inserted = false;
    let mut branch_idx = 0;
    while let Some(relative_close) = merged[search_from..].find("</controls>") {
        let close = search_from + relative_close;
        let insertion = imported_controls_for_generated_branch(
            imported_control_branches,
            branch_idx,
            generated_branch_count,
        );
        merged.insert_str(close, &insertion);
        search_from = close + insertion.len() + "</controls>".len();
        inserted = true;
        branch_idx += 1;
    }
    if inserted {
        merged
    } else {
        let insertion = imported_control_branches.concat();
        format!("<controls>{insertion}</controls>")
    }
}

fn imported_controls_for_generated_branch(
    imported_control_branches: &[String],
    branch_idx: usize,
    generated_branch_count: usize,
) -> String {
    if imported_control_branches.len() == 1 {
        return imported_control_branches[0].clone();
    }
    if branch_idx >= imported_control_branches.len() {
        return String::new();
    }
    if branch_idx + 1 == generated_branch_count
        && imported_control_branches.len() > generated_branch_count
    {
        return imported_control_branches[branch_idx..].concat();
    }
    imported_control_branches[branch_idx].clone()
}
