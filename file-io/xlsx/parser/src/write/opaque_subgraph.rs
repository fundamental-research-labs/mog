use domain_types::{
    BlobPart, OpaquePackageOwner, OpaquePackageOwnership, OpaquePackagePart,
    OpaquePackageRelationship, OpaquePackageSubgraph, OpaqueRelationshipTarget, RoundTripContext,
};
use std::collections::HashSet;

use super::package_graph::{
    OpaquePackageOwnershipState, PackageGraphBuilder, PackagePart, PackagePartKind,
    ResolvedPackageGraph,
};
use super::write_error::WriteError;
use super::zip_writer::ZipWriter;
const REL_WORKSHEET_CUSTOM_PROPERTY: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty";

pub fn register_round_trip_opaque_subgraphs(
    graph: &mut PackageGraphBuilder,
    round_trip_ctx: Option<&RoundTripContext>,
    output: &domain_types::ParseOutput,
    _pivot_data: &crate::write::pivot_writer::PivotWriteData,
) -> Result<(), WriteError> {
    for subgraph in round_trip_opaque_subgraphs(round_trip_ctx, output) {
        graph.register_opaque_subgraph(&subgraph)?;
    }
    Ok(())
}

pub fn register_round_trip_opaque_parts(
    graph: &mut PackageGraphBuilder,
    round_trip_ctx: Option<&RoundTripContext>,
    output: &domain_types::ParseOutput,
) -> Result<(), WriteError> {
    for subgraph in round_trip_opaque_subgraphs(round_trip_ctx, output) {
        if !emits_opaque_part(subgraph.ownership) {
            continue;
        }
        for part in &subgraph.parts {
            if !emits_opaque_part(part.ownership) {
                continue;
            }
            graph.register_opaque_part(
                PackagePart {
                    path: normalize_path(&part.part.path),
                    content_type: part.content_type.clone(),
                    default_extension: part.default_extension.clone(),
                    kind: PackagePartKind::OpaqueClean,
                    bytes: Some(part.part.data.clone()),
                },
                OpaquePackageOwnershipState::Clean,
            )?;
        }
    }
    Ok(())
}

pub fn write_opaque_parts(zip: &mut ZipWriter, graph: &ResolvedPackageGraph) {
    for (path, bytes) in graph.raw_opaque_parts() {
        zip.add_file(path, bytes.to_vec());
    }
    for (path, bytes) in graph.opaque_relationship_parts() {
        zip.add_file(&path, bytes);
    }
}

fn emits_opaque_part(ownership: OpaquePackageOwnership) -> bool {
    matches!(
        ownership,
        OpaquePackageOwnership::CleanImported | OpaquePackageOwnership::OrphanCleanPackageData
    )
}

pub fn round_trip_opaque_subgraphs(
    round_trip_ctx: Option<&RoundTripContext>,
    output: &domain_types::ParseOutput,
) -> Vec<OpaquePackageSubgraph> {
    let Some(ctx) = round_trip_ctx else {
        return Vec::new();
    };
    let mut subgraphs = explicit_or_legacy_opaque_subgraphs(ctx);
    subgraphs.retain(|subgraph| !is_modeled_feature_opaque_subgraph(subgraph));
    subgraphs.retain(|subgraph| !is_shadowed_worksheet_drawing_subgraph(output, subgraph));
    subgraphs.retain(|subgraph| !is_worksheet_custom_property_subgraph(subgraph));
    subgraphs.retain(|subgraph| !is_stale_printer_settings_subgraph(output, subgraph));
    remove_feature_owned_hf_vml_parts(ctx, output, &mut subgraphs);
    subgraphs
}

pub fn round_trip_worksheet_custom_property_subgraphs(
    round_trip_ctx: Option<&RoundTripContext>,
) -> Vec<OpaquePackageSubgraph> {
    let Some(ctx) = round_trip_ctx else {
        return Vec::new();
    };
    explicit_or_legacy_opaque_subgraphs(ctx)
        .into_iter()
        .filter(is_worksheet_custom_property_subgraph)
        .collect()
}

pub fn normalized_round_trip_opaque_subgraphs(
    round_trip_ctx: Option<&RoundTripContext>,
) -> Vec<OpaquePackageSubgraph> {
    let Some(ctx) = round_trip_ctx else {
        return Vec::new();
    };
    explicit_or_legacy_opaque_subgraphs(ctx)
}

fn explicit_or_legacy_opaque_subgraphs(ctx: &RoundTripContext) -> Vec<OpaquePackageSubgraph> {
    ctx.opaque_package_subgraphs
        .iter()
        .filter_map(normalize_explicit_opaque_subgraph)
        .collect()
}

fn is_shadowed_worksheet_drawing_subgraph(
    output: &domain_types::ParseOutput,
    subgraph: &OpaquePackageSubgraph,
) -> bool {
    if subgraph.ownership != OpaquePackageOwnership::CleanImported {
        return false;
    }
    if subgraph.owner_relationship.relationship_type != crate::write::REL_DRAWING {
        return false;
    }
    let OpaquePackageOwner::Worksheet { index, .. } = &subgraph.owner_relationship.owner else {
        return false;
    };
    output
        .sheets
        .get(*index)
        .is_some_and(|sheet| !sheet.charts.is_empty() || !sheet.floating_objects.is_empty())
}

fn is_worksheet_custom_property_subgraph(subgraph: &OpaquePackageSubgraph) -> bool {
    subgraph.ownership == OpaquePackageOwnership::CleanImported
        && subgraph.owner_relationship.relationship_type == REL_WORKSHEET_CUSTOM_PROPERTY
        && matches!(
            subgraph.owner_relationship.owner,
            OpaquePackageOwner::Worksheet { .. }
        )
}

fn is_stale_printer_settings_subgraph(
    output: &domain_types::ParseOutput,
    subgraph: &OpaquePackageSubgraph,
) -> bool {
    let Some(path) = opaque_subgraph_single_part_path(subgraph) else {
        return false;
    };
    if !path.starts_with("xl/printerSettings/") {
        return false;
    }

    output.sheets.iter().any(|sheet| {
        let Some(print_settings) = &sheet.print_settings else {
            return false;
        };
        let Some(identity) = &print_settings.imported_printer_settings else {
            return false;
        };
        normalize_path(&identity.path) == path
            && identity.page_setup
                != domain_types::PrinterSettingsPageSetupFingerprint::from_print_settings(
                    print_settings,
                )
    })
}

fn is_modeled_feature_opaque_subgraph(subgraph: &OpaquePackageSubgraph) -> bool {
    is_modeled_feature_relationship_type(&subgraph.owner_relationship.relationship_type)
        || subgraph.relationships.iter().any(|relationship| {
            is_modeled_feature_relationship_type(&relationship.relationship_type)
        })
        || subgraph
            .parts
            .iter()
            .any(|part| is_modeled_feature_part_path(&part.part.path))
}

fn is_modeled_feature_relationship_type(rel_type: &str) -> bool {
    matches!(
        rel_type,
        crate::infra::opc::REL_PIVOT_TABLE
            | crate::infra::opc::REL_PIVOT_CACHE
            | crate::infra::opc::REL_PIVOT_CACHE_RECORDS
            | crate::infra::opc::REL_SLICER
            | crate::infra::opc::REL_SLICER_CACHE
    )
}

fn is_modeled_feature_part_path(path: &str) -> bool {
    let path = normalize_path(path);
    path.starts_with("xl/pivotTables/")
        || path.starts_with("xl/pivotCache/")
        || path.starts_with("xl/slicers/")
        || path.starts_with("xl/slicerCaches/")
}

fn opaque_subgraph_single_part_path(subgraph: &OpaquePackageSubgraph) -> Option<String> {
    match &subgraph.owner {
        OpaquePackageOwner::Part { path } => Some(normalize_path(path)),
        _ => subgraph
            .parts
            .first()
            .map(|part| normalize_path(&part.part.path)),
    }
}

fn remove_feature_owned_hf_vml_parts(
    ctx: &RoundTripContext,
    output: &domain_types::ParseOutput,
    subgraphs: &mut Vec<OpaquePackageSubgraph>,
) {
    let hf_vml_paths = feature_owned_hf_vml_paths(ctx, output);
    if hf_vml_paths.is_empty() {
        return;
    }
    for subgraph in subgraphs.iter_mut() {
        subgraph
            .parts
            .retain(|part| !hf_vml_paths.contains(&normalize_path(&part.part.path)));
        subgraph.relationships.retain(|relationship| {
            !matches!(
                &relationship.owner,
                OpaquePackageOwner::Part { path } if hf_vml_paths.contains(&normalize_path(path))
            )
        });
    }
    subgraphs.retain(|subgraph| {
        !subgraph.parts.is_empty()
            || !subgraph.relationships.is_empty()
            || subgraph.ownership == OpaquePackageOwnership::CleanImported
    });
}

fn feature_owned_hf_vml_paths(
    ctx: &RoundTripContext,
    _output: &domain_types::ParseOutput,
) -> HashSet<String> {
    ctx.sheets
        .iter()
        .enumerate()
        .flat_map(|(sheet_idx, sheet_rt)| {
            let comment_vml_path = comment_vml_path(sheet_idx, sheet_rt);
            sheet_rt
                .raw_vml_drawings
                .iter()
                .filter(move |vml| comment_vml_path.as_deref() != Some(vml.path.as_str()))
                .filter(|vml| {
                    let rels_path = vml.rels.as_ref().map(|rels| rels.path.as_str());
                    let rels_data = vml.rels.as_ref().map(|rels| rels.data.as_slice());
                    crate::domain::print::hf_images::parse_hf_vml_context(
                        &vml.path, &vml.data, rels_path, rels_data,
                    )
                    .is_some()
                })
                .map(|vml| normalize_path(&vml.path))
        })
        .collect()
}

fn comment_vml_path(
    sheet_idx: usize,
    sheet_rt: &domain_types::SheetRoundTripContext,
) -> Option<String> {
    let legacy_drawing_r_id = sheet_rt.legacy_drawing_r_id.as_ref()?;
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
    sheet_rt
        .sheet_opc_rels
        .iter()
        .find(|rel| {
            &rel.id == legacy_drawing_r_id
                && rel.rel_type == crate::infra::opc::REL_VML_DRAWING
                && rel.target_mode.as_deref() != Some("External")
        })
        .and_then(|rel| {
            crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target).ok()
        })
        .map(|path| normalize_path(&path))
}

fn normalize_explicit_opaque_subgraph(
    subgraph: &OpaquePackageSubgraph,
) -> Option<OpaquePackageSubgraph> {
    let sidecar_relationships = relationships_from_opaque_sidecar_parts(&subgraph.parts)?;
    let mut normalized = subgraph.clone();
    normalized
        .parts
        .retain(|part| !is_relationship_part(&part.part.path));
    normalized.relationships.extend(sidecar_relationships);
    closed_opaque_subgraph(&normalized).then_some(normalized)
}

fn relationships_from_legacy_sidecars(
    parts: &[BlobPart],
) -> Option<Vec<OpaquePackageRelationship>> {
    let part_paths: HashSet<_> = parts
        .iter()
        .filter(|part| !is_relationship_part(&part.path))
        .map(|part| normalize_path(&part.path))
        .collect();
    let mut relationships = Vec::new();
    for part in parts.iter().filter(|part| is_relationship_part(&part.path)) {
        let owner_path = relationship_owner_path(&part.path)?;
        for rel in crate::domain::workbook::read::parse_all_rels(&part.data) {
            let target = if rel.target_mode.as_deref() == Some("External") {
                OpaqueRelationshipTarget::External { target: rel.target }
            } else {
                let resolved =
                    crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target)
                        .ok()?;
                let resolved = normalize_path(&resolved);
                if !part_paths.contains(&resolved) {
                    return None;
                }
                OpaqueRelationshipTarget::InternalPart { path: resolved }
            };
            relationships.push(OpaquePackageRelationship {
                owner: OpaquePackageOwner::Part {
                    path: owner_path.clone(),
                },
                relationship_type: rel.rel_type,
                target,
                relationship_id_hint: Some(rel.id),
            });
        }
    }
    Some(relationships)
}

fn relationships_from_opaque_sidecar_parts(
    parts: &[OpaquePackagePart],
) -> Option<Vec<OpaquePackageRelationship>> {
    let blob_parts = parts
        .iter()
        .map(|part| part.part.clone())
        .collect::<Vec<_>>();
    relationships_from_legacy_sidecars(&blob_parts)
}

fn closed_opaque_subgraph(subgraph: &OpaquePackageSubgraph) -> bool {
    let part_paths: HashSet<_> = subgraph
        .parts
        .iter()
        .map(|part| normalize_path(&part.part.path))
        .collect();
    if let OpaqueRelationshipTarget::InternalPart { path } = &subgraph.owner_relationship.target
        && !part_paths.contains(&normalize_path(path))
    {
        return false;
    }
    subgraph.relationships.iter().all(|relationship| {
        if let OpaqueRelationshipTarget::InternalPart { path } = &relationship.target {
            part_paths.contains(&normalize_path(path))
        } else {
            true
        }
    }) && clean_owned_subgraph_has_no_unreachable_parts(subgraph, &part_paths)
}

fn clean_owned_subgraph_has_no_unreachable_parts(
    subgraph: &OpaquePackageSubgraph,
    part_paths: &HashSet<String>,
) -> bool {
    if subgraph.ownership != OpaquePackageOwnership::CleanImported {
        return true;
    }
    let OpaqueRelationshipTarget::InternalPart { path } = &subgraph.owner_relationship.target
    else {
        return part_paths.is_empty();
    };

    let mut reachable = HashSet::new();
    let mut stack = vec![normalize_path(path)];
    while let Some(path) = stack.pop() {
        if !part_paths.contains(&path) || !reachable.insert(path.clone()) {
            continue;
        }
        for relationship in &subgraph.relationships {
            let OpaquePackageOwner::Part { path: owner_path } = &relationship.owner else {
                continue;
            };
            if normalize_path(owner_path) != path {
                continue;
            }
            if let OpaqueRelationshipTarget::InternalPart { path: target_path } =
                &relationship.target
            {
                stack.push(normalize_path(target_path));
            }
        }
    }

    part_paths.iter().all(|path| reachable.contains(path))
}

fn is_relationship_part(path: &str) -> bool {
    let path = normalize_path(path);
    path.contains("/_rels/") && path.ends_with(".rels")
}

fn relationship_owner_path(rels_path: &str) -> Option<String> {
    let rels_path = normalize_path(rels_path);
    let (dir, file) = rels_path.rsplit_once('/')?;
    let owner_file = file.strip_suffix(".rels")?;
    let owner_dir = dir.strip_suffix("/_rels")?;
    Some(if owner_dir.is_empty() {
        owner_file.to_string()
    } else {
        format!("{owner_dir}/{owner_file}")
    })
}

fn default_extension_for_path(path: &str) -> Option<(String, String)> {
    if path.ends_with(".rels") {
        Some((
            "rels".to_string(),
            "application/vnd.openxmlformats-package.relationships+xml".to_string(),
        ))
    } else if path.ends_with(".xml") {
        Some(("xml".to_string(), "application/xml".to_string()))
    } else {
        None
    }
}

fn normalize_path(path: &str) -> String {
    path.trim_start_matches('/').replace('\\', "/")
}
