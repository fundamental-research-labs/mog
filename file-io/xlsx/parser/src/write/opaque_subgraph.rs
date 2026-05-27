use domain_types::{
    BlobPart, OpaquePackageOwner, OpaquePackageOwnership, OpaquePackagePart,
    OpaquePackageRelationship, OpaquePackageSubgraph, OpaqueRelationshipTarget, RoundTripContext,
};
use std::collections::{HashMap, HashSet};

use super::package_graph::{
    OpaquePackageOwnershipState, PackageGraphBuilder, PackagePart, PackagePartKind,
    ResolvedPackageGraph,
};
use super::write_error::WriteError;
use super::zip_writer::ZipWriter;
use crate::domain::content_types::write::{CT_PIVOT_CACHE, CT_PIVOT_TABLE};

const REL_CUSTOM_XML: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";
const CT_PIVOT_CACHE_RECORDS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml";
const REL_WORKSHEET_CUSTOM_PROPERTY: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty";

pub fn register_round_trip_opaque_subgraphs(
    graph: &mut PackageGraphBuilder,
    round_trip_ctx: Option<&RoundTripContext>,
    output: &domain_types::ParseOutput,
    _pivot_data: &crate::write::pivot_writer::PivotWriteData,
) -> Result<(), WriteError> {
    for subgraph in opaque_subgraphs(round_trip_ctx, output) {
        graph.register_opaque_subgraph(&subgraph)?;
    }
    Ok(())
}

pub fn register_round_trip_opaque_parts(
    graph: &mut PackageGraphBuilder,
    round_trip_ctx: Option<&RoundTripContext>,
    output: &domain_types::ParseOutput,
) -> Result<(), WriteError> {
    for subgraph in opaque_subgraphs(round_trip_ctx, output) {
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

fn opaque_subgraphs(
    round_trip_ctx: Option<&RoundTripContext>,
    output: &domain_types::ParseOutput,
) -> Vec<OpaquePackageSubgraph> {
    let Some(ctx) = round_trip_ctx else {
        return Vec::new();
    };
    let mut subgraphs = Vec::new();
    if ctx.opaque_package_subgraphs.is_empty() {
        subgraphs.extend(lower_legacy_web_extensions(ctx));
        subgraphs.extend(lower_legacy_custom_xml(ctx));
    } else {
        subgraphs.extend(
            ctx.opaque_package_subgraphs
                .iter()
                .filter_map(normalize_explicit_opaque_subgraph),
        );
    }
    subgraphs.retain(|subgraph| !is_shadowed_worksheet_drawing_subgraph(output, subgraph));
    subgraphs.retain(|subgraph| !is_worksheet_custom_property_subgraph(subgraph));
    remove_feature_owned_hf_vml_parts(ctx, output, &mut subgraphs);
    subgraphs.extend(lower_pivot_package(ctx));
    subgraphs
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
                && rel.rel_type.ends_with("/vmlDrawing")
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

fn lower_legacy_web_extensions(ctx: &RoundTripContext) -> Vec<OpaquePackageSubgraph> {
    let Some(taskpanes) = ctx
        .web_extension_parts
        .iter()
        .find(|part| normalize_path(&part.path) == "xl/webextensions/taskpanes.xml")
    else {
        return Vec::new();
    };
    let Some(relationships) = relationships_from_legacy_sidecars(&ctx.web_extension_parts) else {
        return Vec::new();
    };
    let Some(owner_relationship_id_hint) = relationship_hint(
        &ctx.root_relationships,
        None,
        crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES,
        &taskpanes.path,
    ) else {
        return Vec::new();
    };

    vec![OpaquePackageSubgraph {
        owner: OpaquePackageOwner::Root,
        owner_relationship: OpaquePackageRelationship {
            owner: OpaquePackageOwner::Root,
            relationship_type: crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES
                .to_string(),
            target: OpaqueRelationshipTarget::InternalPart {
                path: taskpanes.path.clone(),
            },
            relationship_id_hint: Some(owner_relationship_id_hint),
        },
        parts: ctx
            .web_extension_parts
            .iter()
            .filter(|part| !is_relationship_part(&part.path))
            .map(|part| {
                let path = normalize_path(&part.path);
                let content_type = if path.ends_with("taskpanes.xml") {
                    Some(
                        crate::domain::web_extensions::read::CT_WEB_EXTENSION_TASKPANES.to_string(),
                    )
                } else if path.ends_with(".xml") && !path.contains("/_rels/") {
                    Some(crate::domain::web_extensions::read::CT_WEB_EXTENSION.to_string())
                } else {
                    None
                };
                opaque_part(part, content_type)
            })
            .collect(),
        relationships,
        ownership: OpaquePackageOwnership::CleanImported,
    }]
    .into_iter()
    .filter(closed_opaque_subgraph)
    .collect()
}

fn lower_legacy_custom_xml(ctx: &RoundTripContext) -> Vec<OpaquePackageSubgraph> {
    ctx.custom_xml_parts
        .iter()
        .filter(|part| {
            let path = normalize_path(&part.path);
            path.starts_with("customXml/item")
                && path.ends_with(".xml")
                && !path.contains("itemProps")
                && !path.contains("/_rels/")
        })
        .filter_map(|item| {
            let item_parts = ctx
                .custom_xml_parts
                .iter()
                .filter(|part| custom_xml_part_belongs_to_item(&item.path, &part.path))
                .cloned()
                .collect::<Vec<_>>();
            let relationships = relationships_from_legacy_sidecars(&item_parts)?;
            let owner_relationship_id_hint = relationship_hint(
                &ctx.workbook_relationships,
                Some("xl/workbook.xml"),
                REL_CUSTOM_XML,
                &item.path,
            )?;
            Some(OpaquePackageSubgraph {
                owner: OpaquePackageOwner::Workbook,
                owner_relationship: OpaquePackageRelationship {
                    owner: OpaquePackageOwner::Workbook,
                    relationship_type: REL_CUSTOM_XML.to_string(),
                    target: OpaqueRelationshipTarget::InternalPart {
                        path: item.path.clone(),
                    },
                    relationship_id_hint: Some(owner_relationship_id_hint),
                },
                parts: item_parts
                    .iter()
                    .filter(|part| !is_relationship_part(&part.path))
                    .map(|part| {
                        let path = normalize_path(&part.path);
                        let content_type = if path.contains("itemProps")
                            && path.ends_with(".xml")
                            && !path.contains("/_rels/")
                        {
                            Some(
                                "application/vnd.openxmlformats-officedocument.customXmlProperties+xml"
                                    .to_string(),
                            )
                        } else {
                            None
                        };
                        opaque_part(part, content_type)
                    })
                    .collect(),
                relationships,
                ownership: OpaquePackageOwnership::CleanImported,
            })
        })
        .filter(closed_opaque_subgraph)
        .collect()
}

fn lower_pivot_package(ctx: &RoundTripContext) -> Vec<OpaquePackageSubgraph> {
    let package = &ctx.pivot_package;
    if package.is_empty() {
        return Vec::new();
    }

    let content_types: HashMap<String, String> = package
        .content_type_overrides
        .iter()
        .filter(|ct| ct.ownership == domain_types::PivotPackageOwnership::CleanImported)
        .map(|ct| {
            (
                normalize_content_type_part_name(&ct.part_name),
                ct.content_type.clone(),
            )
        })
        .collect();
    let mut parts = Vec::new();

    for cache in &package.cache_definitions {
        if cache.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        parts.push(opaque_pivot_part(
            &cache.definition_path,
            cache.raw_definition_xml.clone(),
            content_types
                .get(&normalize_content_type_part_name(&cache.definition_path))
                .cloned()
                .or_else(|| Some(CT_PIVOT_CACHE.to_string())),
        ));
        if let (Some(records_path), Some(records_xml)) =
            (&cache.records_path, &cache.raw_records_xml)
        {
            parts.push(opaque_pivot_part(
                records_path,
                records_xml.clone(),
                content_types
                    .get(&normalize_content_type_part_name(records_path))
                    .cloned()
                    .or_else(|| Some(CT_PIVOT_CACHE_RECORDS.to_string())),
            ));
        }
    }

    for table in &package.pivot_tables {
        if table.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        parts.push(opaque_pivot_part(
            &table.table_path,
            table.raw_table_xml.clone(),
            content_types
                .get(&normalize_content_type_part_name(&table.table_path))
                .cloned()
                .or_else(|| Some(CT_PIVOT_TABLE.to_string())),
        ));
    }

    for orphan in &package.orphan_parts {
        if orphan.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        parts.push(opaque_pivot_part(
            &orphan.part.path,
            orphan.part.data.clone(),
            orphan.content_type.clone(),
        ));
    }

    let part_paths: HashSet<_> = parts
        .iter()
        .map(|part| normalize_path(&part.part.path))
        .collect();
    let mut relationships = Vec::new();
    for cache in &package.cache_definitions {
        if cache.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        let Some(rels) = pivot_package_relationships(
            &cache.definition_path,
            &cache.raw_relationships,
            &part_paths,
        ) else {
            return Vec::new();
        };
        relationships.extend(rels);
    }
    for table in &package.pivot_tables {
        if table.ownership != domain_types::PivotPackageOwnership::CleanImported {
            continue;
        }
        let Some(rels) =
            pivot_package_relationships(&table.table_path, &table.raw_relationships, &part_paths)
        else {
            return Vec::new();
        };
        relationships.extend(rels);
    }

    if parts.is_empty() {
        return Vec::new();
    }

    vec![OpaquePackageSubgraph {
        owner: OpaquePackageOwner::Part {
            path: "xl/workbook.xml".to_string(),
        },
        owner_relationship: OpaquePackageRelationship {
            owner: OpaquePackageOwner::Part {
                path: "xl/workbook.xml".to_string(),
            },
            relationship_type: String::new(),
            target: OpaqueRelationshipTarget::InternalPath {
                target: String::new(),
            },
            relationship_id_hint: None,
        },
        parts,
        relationships,
        ownership: OpaquePackageOwnership::OrphanCleanPackageData,
    }]
}

fn custom_xml_part_belongs_to_item(item_path: &str, candidate_path: &str) -> bool {
    let item_path = normalize_path(item_path);
    let candidate_path = normalize_path(candidate_path);
    if candidate_path == item_path {
        return true;
    }
    let Some(item_name) = item_path.rsplit('/').next() else {
        return false;
    };
    let Some(item_number) = item_name
        .strip_prefix("item")
        .and_then(|name| name.strip_suffix(".xml"))
    else {
        return false;
    };
    candidate_path == format!("customXml/_rels/{item_name}.rels")
        || candidate_path == format!("customXml/itemProps{item_number}.xml")
}

fn opaque_part(part: &BlobPart, content_type: Option<String>) -> OpaquePackagePart {
    let path = normalize_path(&part.path);
    OpaquePackagePart {
        part: BlobPart {
            path: path.clone(),
            data: part.data.clone(),
        },
        content_type,
        default_extension: if path.ends_with(".rels") {
            Some((
                "rels".to_string(),
                "application/vnd.openxmlformats-package.relationships+xml".to_string(),
            ))
        } else if path.ends_with(".xml") {
            Some(("xml".to_string(), "application/xml".to_string()))
        } else {
            None
        },
        ownership: OpaquePackageOwnership::CleanImported,
    }
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

fn pivot_package_relationships(
    owner_path: &str,
    raw_relationships: &[domain_types::OpcRelationship],
    part_paths: &HashSet<String>,
) -> Option<Vec<OpaquePackageRelationship>> {
    let owner_path = normalize_path(owner_path);
    raw_relationships
        .iter()
        .map(|rel| {
            let target = if rel.target_mode.as_deref() == Some("External") {
                OpaqueRelationshipTarget::External {
                    target: rel.target.clone(),
                }
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
            Some(OpaquePackageRelationship {
                owner: OpaquePackageOwner::Part {
                    path: owner_path.clone(),
                },
                relationship_type: rel.rel_type.clone(),
                target,
                relationship_id_hint: Some(rel.id.clone()),
            })
        })
        .collect()
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
    })
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

fn opaque_pivot_part(path: &str, data: Vec<u8>, content_type: Option<String>) -> OpaquePackagePart {
    let path = normalize_path(path);
    let default_extension = default_extension_for_path(path.as_str());
    OpaquePackagePart {
        part: BlobPart { path, data },
        content_type,
        default_extension,
        ownership: OpaquePackageOwnership::OrphanCleanPackageData,
    }
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

fn relationship_hint(
    relationships: &[domain_types::OpcRelationship],
    owner_path: Option<&str>,
    relationship_type: &str,
    target_path: &str,
) -> Option<String> {
    let target_path = normalize_path(target_path);
    relationships
        .iter()
        .find(|rel| {
            rel.rel_type == relationship_type
                && rel.target_mode.as_deref() != Some("External")
                && crate::infra::opc::resolve_relationship_target(owner_path, &rel.target)
                    .map(|resolved| normalize_path(&resolved) == target_path)
                    .unwrap_or(false)
        })
        .map(|rel| rel.id.clone())
}

fn normalize_path(path: &str) -> String {
    path.trim_start_matches('/').replace('\\', "/")
}

fn normalize_content_type_part_name(path: &str) -> String {
    format!("/{}", normalize_path(path))
}
