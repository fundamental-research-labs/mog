use std::collections::{BTreeMap, HashMap, HashSet};

use super::{
    PackageOwner, PackagePart, PackageRelationship, PackageRelationshipTarget, normalize_part_path,
    relative_target,
};
use crate::write::write_error::WriteError;

pub(super) fn allocate_relationship_id(
    owner_rels_path: &str,
    hinted_id: Option<&str>,
    used_ids_by_owner: &mut HashMap<String, HashSet<String>>,
    next_id_by_owner: &mut HashMap<String, u32>,
) -> String {
    let used = used_ids_by_owner
        .entry(owner_rels_path.to_string())
        .or_default();
    let next_id = next_id_by_owner
        .entry(owner_rels_path.to_string())
        .or_insert(1);

    if let Some(hinted_id) = hinted_id
        && used.insert(hinted_id.to_string())
    {
        bump_next_id(next_id, hinted_id);
        return hinted_id.to_string();
    }

    loop {
        let id = format!("rId{}", *next_id);
        *next_id += 1;
        if used.insert(id.clone()) {
            return id;
        }
    }
}

pub(super) fn bump_next_id(next_id: &mut u32, id: &str) {
    if let Some(num_str) = id.strip_prefix("rId")
        && let Ok(num) = num_str.parse::<u32>()
        && num >= *next_id
    {
        *next_id = num + 1;
    }
}

pub(super) fn resolve_target(
    owner: &PackageOwner,
    target: &PackageRelationshipTarget,
) -> Result<(String, Option<String>), WriteError> {
    match target {
        PackageRelationshipTarget::InternalPath { target } => Ok((target.clone(), None)),
        PackageRelationshipTarget::External { target } => {
            Ok((target.clone(), Some("External".to_string())))
        }
        PackageRelationshipTarget::InternalPart { path } => {
            let target = match owner {
                PackageOwner::Root => format!("/{}", normalize_part_path(path)),
                PackageOwner::Workbook => relative_target("xl/workbook.xml", path)?,
                PackageOwner::Worksheet {
                    path: owner_path, ..
                }
                | PackageOwner::Part { path: owner_path } => relative_target(owner_path, path)?,
            };
            Ok((target, None))
        }
    }
}

pub(super) fn validate_internal_target_is_registered(
    relationship: &PackageRelationship,
    parts: &BTreeMap<String, PackagePart>,
) -> Result<(), WriteError> {
    if let PackageRelationshipTarget::InternalPart { path } = &relationship.target {
        let normalized = normalize_part_path(path);
        if !parts.contains_key(&normalized) {
            return Err(WriteError::PackageIntegrity(format!(
                "relationship target is not an emitted package part: {}",
                normalized
            )));
        }
    }
    Ok(())
}
