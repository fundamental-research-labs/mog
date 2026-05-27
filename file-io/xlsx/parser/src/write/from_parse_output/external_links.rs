use domain_types::domain::external_link::ExternalLink;

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
    let default_rel_type = crate::domain::external::write::REL_EXTERNAL_LINK_PATH;
    let primary_rel_type = link
        .file_path_rel_type
        .as_deref()
        .unwrap_or(default_rel_type);
    if let Some(target) = &link.file_path {
        crate::write::package_graph::register_external_link_relationship(
            graph,
            part_name,
            primary_rel_type,
            target,
            link.file_path_rid.as_deref().or(Some("rId1")),
        );
    }
    if let Some(target) = &link.alternate_url {
        crate::write::package_graph::register_external_link_relationship(
            graph,
            part_name,
            default_rel_type,
            target,
            link.alternate_url_rid.as_deref().or(Some("rId2")),
        );
    }
    if let Some(target) = &link.relative_url {
        let default_rid = if link.alternate_url.is_some() {
            "rId3"
        } else {
            "rId2"
        };
        crate::write::package_graph::register_external_link_relationship(
            graph,
            part_name,
            default_rel_type,
            target,
            link.relative_url_rid.as_deref().or(Some(default_rid)),
        );
    }
    for extra in &link.extra_rels {
        crate::write::package_graph::register_external_link_relationship(
            graph,
            part_name,
            &extra.rel_type,
            &extra.target,
            Some(&extra.id),
        );
    }
}

pub(super) fn with_resolved_relationship_ids(
    package_graph: &crate::write::package_graph::ResolvedPackageGraph,
    link: &ExternalLink,
    owner: &crate::write::package_graph::PackageOwner,
) -> ExternalLink {
    let mut link = link.clone();
    let default_rel_type = crate::domain::external::write::REL_EXTERNAL_LINK_PATH;
    let primary_rel_type = link
        .file_path_rel_type
        .as_deref()
        .unwrap_or(default_rel_type);
    if let Some(target) = &link.file_path {
        link.file_path_rid = package_graph
            .relationship_id(owner, primary_rel_type, target)
            .map(str::to_string)
            .or(link.file_path_rid);
    }
    if let Some(target) = &link.alternate_url {
        link.alternate_url_rid = package_graph
            .relationship_id(owner, default_rel_type, target)
            .map(str::to_string)
            .or(link.alternate_url_rid);
    }
    if let Some(target) = &link.relative_url {
        link.relative_url_rid = package_graph
            .relationship_id(owner, default_rel_type, target)
            .map(str::to_string)
            .or(link.relative_url_rid);
    }
    link
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
