use domain_types::PackageFidelityMetadata;

use super::{
    PackageOwner, PackageRelationship, PackageRelationshipTarget, RelationshipIdentityHint,
    is_external_target_mode, normalize_part_path,
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

pub(super) fn imported_relationship_hint<'a>(
    metadata: Option<&'a PackageFidelityMetadata>,
    owner: &PackageOwner,
    relationship_type: &str,
    target_path: &str,
) -> Option<&'a domain_types::PackageRelationshipHint> {
    let metadata = metadata?;
    let (owner_part, hints) = relationship_hints_for_owner(metadata, owner)?;
    let normalized_target = normalize_part_path(target_path);
    hints.iter().find(|hint| {
        hint.relationship_type == relationship_type
            && !is_external_target_mode(hint.target_mode.as_deref())
            && imported_internal_target(owner_part, hint)
                .is_some_and(|target| target == normalized_target)
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ImportedRelationshipMatch<'a> {
    pub order: usize,
    pub id: &'a str,
    pub target: &'a str,
    pub target_mode: Option<&'a String>,
}

pub(super) fn imported_relationship_match<'a>(
    metadata: Option<&'a PackageFidelityMetadata>,
    relationship: &PackageRelationship,
    current_occurrence: usize,
) -> Option<ImportedRelationshipMatch<'a>> {
    let metadata = metadata?;
    let (owner_part, hints) = relationship_hints_for_owner(metadata, &relationship.owner)?;
    let target_key = relationship_target_key(&relationship.target)?;
    let mut occurrence = 0;
    hints.iter().enumerate().find_map(|(order, hint)| {
        if hint.relationship_type != relationship.relationship_type {
            return None;
        }
        let hint_key = imported_relationship_target_key(owner_part, hint)?;
        if hint_key != target_key {
            return None;
        }
        let matched_occurrence = occurrence;
        occurrence += 1;
        if matched_occurrence == current_occurrence {
            Some(ImportedRelationshipMatch {
                order,
                id: hint.id.as_str(),
                target: hint.target.as_str(),
                target_mode: hint.target_mode.as_ref(),
            })
        } else {
            None
        }
    })
}

pub(super) fn relationship_current_occurrence(
    relationships: &[(super::RegisteredRelationshipKey, PackageRelationship)],
    index: usize,
) -> usize {
    let relationship = &relationships[index].1;
    let Some(target_key) = relationship_target_key(&relationship.target) else {
        return 0;
    };
    relationships[..index]
        .iter()
        .map(|(_, candidate)| candidate)
        .filter(|candidate| {
            candidate.owner == relationship.owner
                && candidate.relationship_type == relationship.relationship_type
                && relationship_target_key(&candidate.target).as_ref() == Some(&target_key)
        })
        .count()
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

fn relationship_target_key(target: &PackageRelationshipTarget) -> Option<(u8, String)> {
    match target {
        PackageRelationshipTarget::InternalPart { path } => Some((0, normalize_part_path(path))),
        PackageRelationshipTarget::External { target, .. } => Some((1, target.clone())),
        PackageRelationshipTarget::InternalPath { target } => Some((2, target.clone())),
    }
}

fn imported_relationship_target_key(
    owner_part: Option<&str>,
    hint: &domain_types::PackageRelationshipHint,
) -> Option<(u8, String)> {
    if is_external_target_mode(hint.target_mode.as_deref()) {
        return Some((1, hint.target.clone()));
    }
    if hint.target.starts_with('#') {
        return Some((2, hint.target.clone()));
    }
    imported_internal_target(owner_part, hint).map(|target| (0, normalize_part_path(&target)))
}

fn relationship_hints_for_owner<'a>(
    metadata: &'a PackageFidelityMetadata,
    owner: &PackageOwner,
) -> Option<(Option<&'a str>, &'a [domain_types::PackageRelationshipHint])> {
    match owner {
        PackageOwner::Root => Some((None, metadata.root_relationships.as_slice())),
        PackageOwner::Workbook => Some((
            Some("xl/workbook.xml"),
            metadata.workbook_relationships.as_slice(),
        )),
        PackageOwner::Worksheet { path, .. } | PackageOwner::Part { path } => {
            let owner_path = normalize_part_path(path);
            metadata
                .part_relationships
                .iter()
                .find(|info| normalize_part_path(&info.owner_path) == owner_path)
                .map(|info| {
                    (
                        Some(info.owner_path.as_str()),
                        info.relationships.as_slice(),
                    )
                })
        }
    }
}
