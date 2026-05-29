use domain_types::domain::external_link::{
    ExternalLink, ExternalLinkRelationship, ExternalLinkRelationshipCurrentness,
    ExternalLinkRelationshipRole,
};

pub(super) fn part_name(link: &ExternalLink) -> String {
    link.imported_identity
        .as_ref()
        .and_then(|identity| normalized_external_link_part_name(&identity.part_name))
        .unwrap_or_else(|| format!("externalLinks/externalLink{}.xml", link.id))
}

pub(super) fn zip_path(part_name: &str) -> String {
    let trimmed = part_name.trim_start_matches('/');
    if trimmed.starts_with("xl/") {
        trimmed.to_string()
    } else {
        format!("xl/{}", trimmed)
    }
}

pub(super) fn workbook_target(part_name: &str) -> String {
    part_name
        .trim_start_matches('/')
        .strip_prefix("xl/")
        .unwrap_or_else(|| part_name.trim_start_matches('/'))
        .to_string()
}

pub(super) fn workbook_relationship_id_hint<'a>(
    link: &'a ExternalLink,
    part_name: &str,
) -> Option<&'a str> {
    let identity = link.imported_identity.as_ref()?;
    if identity.target_mode.is_some() {
        return None;
    }
    let expected_target = workbook_target(part_name);
    if identity
        .target
        .as_deref()
        .is_some_and(|target| target != expected_target)
    {
        return None;
    }
    Some(identity.workbook_rel_id.as_str())
}

pub(super) fn register_owned_relationships(
    graph: &mut crate::write::package_graph::PackageGraphBuilder,
    part_name: &str,
    link: &ExternalLink,
) {
    for relationship in effective_relationships(link) {
        if !is_supported_external_link_relationship_type(&relationship.relationship_type) {
            continue;
        }
        crate::write::package_graph::register_external_link_relationship(
            graph,
            part_name,
            &relationship.relationship_type,
            &relationship.target,
            relationship.target_mode.as_deref().or(Some("External")),
            relationship.imported_id_hint.as_deref(),
        );
    }
}

pub(super) fn with_resolved_relationship_ids(
    package_graph: &crate::write::package_graph::ResolvedPackageGraph,
    link: &ExternalLink,
    owner: &crate::write::package_graph::PackageOwner,
) -> Result<ExternalLink, crate::write::WriteError> {
    let mut link = link.clone();
    link.file_path_rid = None;
    link.alternate_url_rid = None;
    link.relative_url_rid = None;
    let relationships = effective_relationships(&link);
    let mut resolved_indices = Vec::new();
    for relationship in &relationships {
        if !is_supported_external_link_relationship_type(&relationship.relationship_type) {
            if relationship
                .roles
                .iter()
                .any(|role| !matches!(role, ExternalLinkRelationshipRole::ExtraPath))
            {
                return Err(crate::write::WriteError::PackageIntegrity(format!(
                    "unsupported external link relationship for owner {owner:?} source {} type {} target {}",
                    relationship.source_key, relationship.relationship_type, relationship.target
                )));
            }
            continue;
        }
        let (index, resolved_id) = package_graph
            .relationship_id_for_nth_match(
                owner,
                &relationship.relationship_type,
                &relationship.target,
                relationship.target_mode.as_deref().or(Some("External")),
                &resolved_indices,
            )
            .map(|(index, id)| (index, id.to_string()))
            .ok_or_else(|| {
                missing_relationship_error(
                    owner,
                    &relationship.relationship_type,
                    &relationship.target,
                )
            })?;
        resolved_indices.push(index);
        if relationship
            .roles
            .contains(&ExternalLinkRelationshipRole::ExternalBook)
        {
            link.file_path_rid = Some(resolved_id.clone());
        }
        if relationship
            .roles
            .contains(&ExternalLinkRelationshipRole::AlternateAbsoluteUrl)
        {
            link.alternate_url_rid = Some(resolved_id.clone());
        }
        if relationship
            .roles
            .contains(&ExternalLinkRelationshipRole::AlternateRelativeUrl)
        {
            link.relative_url_rid = Some(resolved_id);
        }
    }
    Ok(link)
}

fn missing_relationship_error(
    owner: &crate::write::package_graph::PackageOwner,
    relationship_type: &str,
    target: &str,
) -> crate::write::WriteError {
    crate::write::WriteError::PackageIntegrity(format!(
        "missing external link relationship for owner {owner:?} type {relationship_type} target {target}"
    ))
}

fn supported_external_link_relationship_type<'a>(
    rel_type: Option<&'a str>,
    default_rel_type: &'a str,
) -> &'a str {
    rel_type
        .filter(|rel_type| is_supported_external_link_relationship_type(rel_type))
        .unwrap_or(default_rel_type)
}

fn is_supported_external_link_relationship_type(rel_type: &str) -> bool {
    crate::infra::opc::is_external_workbook_base_path_relationship_type(rel_type)
}

fn effective_relationships(link: &ExternalLink) -> Vec<ExternalLinkRelationship> {
    if !link.relationships.is_empty() {
        let mut relationships: Vec<_> = link
            .relationships
            .iter()
            .map(|relationship| relationship_current_for_live_fields(link, relationship))
            .filter(|relationship| {
                relationship.currentness == ExternalLinkRelationshipCurrentness::Current
                    || relationship.currentness == ExternalLinkRelationshipCurrentness::Regenerated
            })
            .collect();
        relationships.sort_by_key(|relationship| relationship.order.unwrap_or(u32::MAX));
        return relationships;
    }

    synthesized_legacy_relationships(link)
}

fn relationship_current_for_live_fields(
    link: &ExternalLink,
    relationship: &ExternalLinkRelationship,
) -> ExternalLinkRelationship {
    let mut relationship = relationship.clone();
    if relationship
        .roles
        .contains(&ExternalLinkRelationshipRole::ExternalBook)
        && let Some(target) = &link.file_path
        && relationship.target != *target
    {
        relationship.target = target.clone();
        relationship.imported_id_hint = None;
        relationship.currentness = ExternalLinkRelationshipCurrentness::Regenerated;
    }
    if relationship
        .roles
        .contains(&ExternalLinkRelationshipRole::AlternateAbsoluteUrl)
        && let Some(target) = &link.alternate_url
        && relationship.target != *target
    {
        relationship.target = target.clone();
        relationship.imported_id_hint = None;
        relationship.currentness = ExternalLinkRelationshipCurrentness::Regenerated;
    }
    if relationship
        .roles
        .contains(&ExternalLinkRelationshipRole::AlternateRelativeUrl)
        && let Some(target) = &link.relative_url
        && relationship.target != *target
    {
        relationship.target = target.clone();
        relationship.imported_id_hint = None;
        relationship.currentness = ExternalLinkRelationshipCurrentness::Regenerated;
    }
    relationship
}

fn synthesized_legacy_relationships(link: &ExternalLink) -> Vec<ExternalLinkRelationship> {
    let default_rel_type = crate::domain::external::write::REL_EXTERNAL_LINK_PATH;
    let primary_rel_type = supported_external_link_relationship_type(
        link.file_path_rel_type.as_deref(),
        default_rel_type,
    );
    let mut relationships = Vec::new();

    if let Some(target) = &link.file_path {
        relationships.push(ExternalLinkRelationship {
            source_key: "legacy:filePath".to_string(),
            imported_id_hint: link
                .file_path_rid
                .clone()
                .or_else(|| Some("rId1".to_string())),
            relationship_type: primary_rel_type.to_string(),
            target: target.clone(),
            target_mode: Some("External".to_string()),
            order: Some(0),
            roles: vec![ExternalLinkRelationshipRole::ExternalBook],
            currentness: ExternalLinkRelationshipCurrentness::Regenerated,
        });
    }
    if let Some(target) = &link.alternate_url {
        relationships.push(ExternalLinkRelationship {
            source_key: "legacy:alternateUrl".to_string(),
            imported_id_hint: link
                .alternate_url_rid
                .clone()
                .or_else(|| Some("rId2".to_string())),
            relationship_type: default_rel_type.to_string(),
            target: target.clone(),
            target_mode: Some("External".to_string()),
            order: Some(1),
            roles: vec![ExternalLinkRelationshipRole::AlternateAbsoluteUrl],
            currentness: ExternalLinkRelationshipCurrentness::Regenerated,
        });
    }
    if let Some(target) = &link.relative_url {
        let default_rid = if link.alternate_url.is_some() {
            "rId3"
        } else {
            "rId2"
        };
        relationships.push(ExternalLinkRelationship {
            source_key: "legacy:relativeUrl".to_string(),
            imported_id_hint: link
                .relative_url_rid
                .clone()
                .or_else(|| Some(default_rid.to_string())),
            relationship_type: default_rel_type.to_string(),
            target: target.clone(),
            target_mode: Some("External".to_string()),
            order: Some(2),
            roles: vec![ExternalLinkRelationshipRole::AlternateRelativeUrl],
            currentness: ExternalLinkRelationshipCurrentness::Regenerated,
        });
    }
    for (index, extra) in link.extra_rels.iter().enumerate() {
        relationships.push(ExternalLinkRelationship {
            source_key: format!("legacy:extra:{index}"),
            imported_id_hint: Some(extra.id.clone()),
            relationship_type: extra.rel_type.clone(),
            target: extra.target.clone(),
            target_mode: Some("External".to_string()),
            order: Some(index as u32 + 3),
            roles: vec![ExternalLinkRelationshipRole::ExtraPath],
            currentness: ExternalLinkRelationshipCurrentness::Regenerated,
        });
    }

    if let Some(order) = &link.rels_id_order {
        relationships.sort_by_key(|relationship| {
            relationship
                .imported_id_hint
                .as_ref()
                .and_then(|id| order.iter().position(|ordered| ordered == id))
                .unwrap_or(usize::MAX)
        });
    }

    relationships
}

pub(super) fn rels_path(zip_path: &str) -> String {
    let file_name = zip_path.rsplit('/').next().unwrap_or(zip_path);
    format!("xl/externalLinks/_rels/{}.rels", file_name)
}

fn normalized_external_link_part_name(part_name: &str) -> Option<String> {
    let trimmed = part_name.trim_start_matches('/');
    let normalized = trimmed.strip_prefix("xl/").unwrap_or(trimmed);
    if normalized.contains("/../") || normalized.starts_with("../") {
        return None;
    }
    let file_name = normalized.rsplit('/').next().unwrap_or(normalized);
    if normalized.starts_with("externalLinks/externalLink")
        && file_name.starts_with("externalLink")
        && file_name.ends_with(".xml")
    {
        Some(normalized.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::package_graph::{PackageGraphBuilder, PackageOwner};

    #[test]
    fn external_link_xml_requires_graph_resolved_relationship_ids() {
        let graph = PackageGraphBuilder::new().resolve().unwrap();
        let owner = PackageOwner::Part {
            path: "xl/externalLinks/externalLink1.xml".to_string(),
        };
        let link = ExternalLink {
            id: "1".to_string(),
            file_path: Some("file:///stale.xlsx".to_string()),
            file_path_rid: Some("rIdStale".to_string()),
            ..Default::default()
        };

        let err = with_resolved_relationship_ids(&graph, &link, &owner)
            .expect_err("stale imported r:id must not be used without graph relationship");

        assert!(format!("{err}").contains("missing external link relationship"));
    }

    #[test]
    fn duplicate_external_link_relationship_targets_resolve_by_role_order() {
        let mut graph = PackageGraphBuilder::new();
        let part_name = "externalLinks/externalLink1.xml";
        let target = "file:///same.xlsx".to_string();
        let link = ExternalLink {
            id: "1".to_string(),
            file_path: Some(target.clone()),
            alternate_url: Some(target.clone()),
            relationships: vec![
                ExternalLinkRelationship {
                    source_key: "primary".to_string(),
                    imported_id_hint: Some("rId1".to_string()),
                    relationship_type: crate::domain::external::write::REL_EXTERNAL_LINK_PATH
                        .to_string(),
                    target: target.clone(),
                    target_mode: Some("External".to_string()),
                    order: Some(0),
                    roles: vec![ExternalLinkRelationshipRole::ExternalBook],
                    currentness: ExternalLinkRelationshipCurrentness::Current,
                },
                ExternalLinkRelationship {
                    source_key: "absolute".to_string(),
                    imported_id_hint: Some("rId2".to_string()),
                    relationship_type: crate::domain::external::write::REL_EXTERNAL_LINK_PATH
                        .to_string(),
                    target,
                    target_mode: Some("External".to_string()),
                    order: Some(1),
                    roles: vec![ExternalLinkRelationshipRole::AlternateAbsoluteUrl],
                    currentness: ExternalLinkRelationshipCurrentness::Current,
                },
            ],
            ..Default::default()
        };

        register_owned_relationships(&mut graph, part_name, &link);
        let graph = graph.resolve().unwrap();
        let owner = PackageOwner::Part {
            path: "xl/externalLinks/externalLink1.xml".to_string(),
        };
        let resolved = with_resolved_relationship_ids(&graph, &link, &owner).unwrap();

        assert_eq!(resolved.file_path_rid.as_deref(), Some("rId1"));
        assert_eq!(resolved.alternate_url_rid.as_deref(), Some("rId2"));
        let rels = graph.relationship_manager_for_owner(&owner);
        assert_eq!(rels.relationships().len(), 2);
    }
}
