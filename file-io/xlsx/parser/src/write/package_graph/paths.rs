use super::{PackageOwner, RelationshipOwnerPath, WriteError};

pub fn part_relationships_path(part_path: &str) -> String {
    owner_rels_path(&PackageOwner::Part {
        path: normalize_part_path(part_path),
    })
}

pub(in crate::write) fn normalize_external_link_part_path(part_name: &str) -> String {
    let trimmed = normalize_part_path(part_name);
    if trimmed.starts_with("xl/") {
        trimmed
    } else {
        format!("xl/{trimmed}")
    }
}

pub(in crate::write) fn relative_target(
    owner_path: &str,
    target_path: &str,
) -> Result<String, WriteError> {
    let owner_path = normalize_part_path(owner_path);
    let target_path = normalize_part_path(target_path);
    let owner_dir = owner_path.rsplit_once('/').map_or("", |(dir, _)| dir);
    Ok(relative_path(owner_dir, &target_path))
}

pub(in crate::write) fn relative_path(from_dir: &str, to_path: &str) -> String {
    let from_components: Vec<_> = from_dir
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let to_components: Vec<_> = to_path.split('/').filter(|part| !part.is_empty()).collect();
    let common = from_components
        .iter()
        .zip(&to_components)
        .take_while(|(a, b)| a == b)
        .count();
    let mut result = vec![".."; from_components.len() - common];
    result.extend(to_components[common..].iter().copied());
    result.join("/")
}

pub(in crate::write) fn owner_rels_path(owner: &PackageOwner) -> RelationshipOwnerPath {
    match owner {
        PackageOwner::Root => "_rels/.rels".to_string(),
        PackageOwner::Workbook => "xl/_rels/workbook.xml.rels".to_string(),
        PackageOwner::Worksheet { path, .. } | PackageOwner::Part { path } => {
            let path = normalize_part_path(path);
            if let Some((dir, file)) = path.rsplit_once('/') {
                format!("{}/_rels/{}.rels", dir, file)
            } else {
                format!("_rels/{}.rels", path)
            }
        }
    }
}

pub(in crate::write) fn normalize_part_path(path: &str) -> String {
    path.trim_start_matches('/').to_string()
}

pub(in crate::write) fn relationship_target_part_path(
    owner_rels_path: &str,
    target: &str,
) -> Result<Option<String>, String> {
    if target.starts_with('#') {
        return Ok(None);
    }
    let target_part = target.split_once('#').map_or(target, |(part, _)| part);
    if target_part.is_empty() {
        return Ok(None);
    }
    let owner_part = owner_part_path_from_rels_path(owner_rels_path)
        .ok_or_else(|| format!("invalid relationship owner path {owner_rels_path}"))?;
    crate::infra::opc::resolve_relationship_target(owner_part.as_deref(), target_part)
        .map_err(|err| format!("{err:?}"))
        .map(|path| normalize_part_path(&path))
        .map(Some)
}

pub(in crate::write) fn owner_part_path_from_rels_path(
    owner_rels_path: &str,
) -> Option<Option<String>> {
    if owner_rels_path == "_rels/.rels" {
        return Some(None);
    }
    let (dir, file) = owner_rels_path.rsplit_once("/_rels/")?;
    let owner_file = file.strip_suffix(".rels")?;
    Some(Some(if dir.is_empty() {
        owner_file.to_string()
    } else {
        format!("{dir}/{owner_file}")
    }))
}
