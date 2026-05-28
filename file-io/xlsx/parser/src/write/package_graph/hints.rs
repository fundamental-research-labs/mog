use std::collections::{HashMap, HashSet};

use domain_types::PackageFidelityMetadata;

use super::{
    PackageOwner, PackageRelationship, PackageRelationshipTarget, RelationshipIdentityHint,
    RelationshipOwnerPath, is_external_target_mode, normalize_part_path, owner_rels_path,
};

pub(super) fn imported_relationship_identity_hint(
    metadata: Option<&PackageFidelityMetadata>,
    owner: &PackageOwner,
    relationship_type: &str,
    target_path: &str,
) -> Option<RelationshipIdentityHint> {
    imported_relationship_hint(metadata, owner, relationship_type, target_path)
        .map(|hint| RelationshipIdentityHint::new(hint.id.as_str()))
}

pub(super) fn current_relationship_hint_id<'a>(
    metadata: Option<&'a PackageFidelityMetadata>,
    relationship: &PackageRelationship,
) -> Option<&'a str> {
    let PackageRelationshipTarget::InternalPart { path } = &relationship.target else {
        return None;
    };
    imported_relationship_hint(
        metadata,
        &relationship.owner,
        &relationship.relationship_type,
        path,
    )
    .map(|hint| hint.id.as_str())
}

pub(super) fn imported_relationship_hint<'a>(
    metadata: Option<&'a PackageFidelityMetadata>,
    owner: &PackageOwner,
    relationship_type: &str,
    target_path: &str,
) -> Option<&'a domain_types::PackageRelationshipHint> {
    let metadata = metadata?;
    let (owner_part, hints) = match owner {
        PackageOwner::Root => (None, metadata.root_relationships.as_slice()),
        PackageOwner::Workbook => (
            Some("xl/workbook.xml"),
            metadata.workbook_relationships.as_slice(),
        ),
        _ => return None,
    };
    let normalized_target = normalize_part_path(target_path);
    hints.iter().find(|hint| {
        hint.relationship_type == relationship_type
            && !is_external_target_mode(hint.target_mode.as_deref())
            && imported_internal_target(owner_part, hint)
                .is_some_and(|target| target == normalized_target)
    })
}

pub(super) fn imported_relationship_order(
    metadata: Option<&PackageFidelityMetadata>,
    eligible_by_owner: &HashMap<RelationshipOwnerPath, bool>,
    relationship: &PackageRelationship,
) -> usize {
    let Some(metadata) = metadata else {
        return usize::MAX;
    };
    let owner_rels_path = owner_rels_path(&relationship.owner);
    if !eligible_by_owner
        .get(&owner_rels_path)
        .copied()
        .unwrap_or(false)
    {
        return usize::MAX;
    }
    let PackageRelationshipTarget::InternalPart { path } = &relationship.target else {
        return usize::MAX;
    };
    let (owner_part, hints) = match &relationship.owner {
        PackageOwner::Root => (None, metadata.root_relationships.as_slice()),
        PackageOwner::Workbook => (
            Some("xl/workbook.xml"),
            metadata.workbook_relationships.as_slice(),
        ),
        _ => return usize::MAX,
    };
    let normalized_target = normalize_part_path(path);
    hints
        .iter()
        .position(|hint| {
            hint.relationship_type == relationship.relationship_type
                && !is_external_target_mode(hint.target_mode.as_deref())
                && imported_internal_target(owner_part, hint)
                    .is_some_and(|target| target == normalized_target)
        })
        .unwrap_or(usize::MAX)
}

pub(super) fn imported_order_eligible_by_owner(
    metadata: Option<&PackageFidelityMetadata>,
    relationships: &[PackageRelationship],
) -> HashMap<RelationshipOwnerPath, bool> {
    let mut result = HashMap::new();
    let Some(metadata) = metadata else {
        return result;
    };
    result.insert(
        owner_rels_path(&PackageOwner::Root),
        imported_owner_set_matches_current(None, &metadata.root_relationships, relationships),
    );
    result.insert(
        owner_rels_path(&PackageOwner::Workbook),
        imported_owner_set_matches_current(
            Some("xl/workbook.xml"),
            &metadata.workbook_relationships,
            relationships,
        ),
    );
    result
}

pub(super) fn imported_owner_set_matches_current(
    owner_part: Option<&str>,
    imported: &[domain_types::PackageRelationshipHint],
    relationships: &[PackageRelationship],
) -> bool {
    let owner = if owner_part.is_none() {
        PackageOwner::Root
    } else {
        PackageOwner::Workbook
    };
    let current_set: HashSet<(String, String)> = relationships
        .iter()
        .filter(|relationship| relationship.owner == owner)
        .filter_map(|relationship| {
            let PackageRelationshipTarget::InternalPart { path } = &relationship.target else {
                return None;
            };
            Some((
                relationship.relationship_type.clone(),
                normalize_part_path(path),
            ))
        })
        .collect();
    let imported_set: HashSet<(String, String)> = imported
        .iter()
        .filter(|hint| !is_external_target_mode(hint.target_mode.as_deref()))
        .filter_map(|hint| {
            imported_internal_target(owner_part, hint)
                .map(|target| (hint.relationship_type.clone(), normalize_part_path(&target)))
        })
        .collect();
    current_set == imported_set
}

pub(super) fn imported_internal_target(
    owner_part: Option<&str>,
    hint: &domain_types::PackageRelationshipHint,
) -> Option<String> {
    if is_external_target_mode(hint.target_mode.as_deref()) {
        return None;
    }
    crate::infra::opc::resolve_relationship_target(owner_part, &hint.target).ok()
}
