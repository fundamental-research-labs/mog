use domain_types::{ParseOutput, RichDataPart};

use super::WriteError;

pub(super) fn parts_for_export(output: &ParseOutput) -> Vec<RichDataPart> {
    let Some(rich_data) = output
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.rich_data.as_ref())
    else {
        return Vec::new();
    };

    if rich_data.parts.is_empty() {
        return Vec::new();
    }
    if metadata_preserves_rich_data_cluster(output)
        || output
            .sheets
            .iter()
            .any(|sheet| sheet.cells.iter().any(|cell| cell.vm.is_some()))
    {
        return rich_data.parts.clone();
    }

    Vec::new()
}

pub(super) fn related_parts_for_export(
    output: &ParseOutput,
) -> Vec<domain_types::RichDataRelatedPart> {
    if parts_for_export(output).is_empty() {
        return Vec::new();
    }
    output
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.rich_data.as_ref())
        .map(|rich_data| rich_data.related_parts.clone())
        .unwrap_or_default()
}

pub(super) fn register_parts(
    graph: &mut crate::write::package_graph::PackageGraphBuilder,
    parts: &[RichDataPart],
    related_parts: &[domain_types::RichDataRelatedPart],
) -> Result<(), WriteError> {
    for part in parts {
        graph.register_part(crate::write::package_graph::modeled_part(
            &part.path,
            &part.content_type,
        ))?;
        for relationship in &part.relationships {
            let target = if crate::write::package_graph::is_external_target_mode(
                relationship.target_mode.as_deref(),
            ) {
                crate::write::package_graph::PackageRelationshipTarget::External {
                    target: relationship.target.clone(),
                    target_mode: relationship.target_mode.clone(),
                }
            } else {
                let target_path = crate::infra::opc::resolve_relationship_target(
                    Some(&part.path),
                    &relationship.target,
                )
                .map_err(|err| {
                    WriteError::PackageIntegrity(format!(
                        "invalid richData relationship target for {}: {} ({:?})",
                        part.path, relationship.target, err
                    ))
                })?;
                crate::write::package_graph::PackageRelationshipTarget::InternalPart {
                    path: target_path,
                }
            };
            graph.add_relationship(crate::write::package_graph::PackageRelationship {
                owner: crate::write::package_graph::PackageOwner::Part {
                    path: part.path.clone(),
                },
                relationship_type: relationship.rel_type.clone(),
                target,
                identity_hint: Some(crate::write::package_graph::RelationshipIdentityHint::new(
                    relationship.id.as_str(),
                )),
            });
        }
    }
    for part in related_parts {
        if part.path.starts_with("xl/media/") {
            if let Some(content_type) = part.content_type.as_deref() {
                crate::write::package_graph::register_media_part_with_content_type(
                    graph,
                    &part.path,
                    content_type,
                )?;
            } else {
                crate::write::package_graph::register_media_part_with_bytes(
                    graph, &part.path, &part.data,
                )?;
            }
        } else {
            graph.register_part(crate::write::package_graph::modeled_part(
                &part.path,
                part.content_type
                    .as_deref()
                    .unwrap_or("application/octet-stream"),
            ))?;
        }
    }
    Ok(())
}

fn metadata_preserves_rich_data_cluster(output: &ParseOutput) -> bool {
    output.metadata.as_ref().is_some_and(|metadata| {
        super::metadata::imported_metadata_xml_is_current(output, metadata)
            || (!metadata.value_metadata.is_empty() && metadata.imported_metadata_xml.is_none())
    })
}
