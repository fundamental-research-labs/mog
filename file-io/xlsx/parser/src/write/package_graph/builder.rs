use std::collections::{BTreeMap, HashMap, HashSet};

use domain_types::PackageFidelityMetadata;

use super::{
    AuxiliaryPackagePartPolicy, PackageOwner, PackagePart, PackagePartKind, PackageRelationship,
    PackageRelationshipTarget, RelationshipIdentityHint, ResolvedPackageGraph,
    ResolvedPackageRelationship, allocate_relationship_id, current_relationship_hint_id,
    imported_internal_target, imported_opaque_part, imported_order_eligible_by_owner,
    imported_relationship_order, normalize_part_path, owner_rels_path, resolve_target,
    same_inert_cluster, validate_internal_target_is_registered,
};
use crate::write::write_error::WriteError;

#[derive(Debug, Default)]
pub struct PackageGraphBuilder {
    parts: BTreeMap<String, PackagePart>,
    relationships: Vec<PackageRelationship>,
    package_fidelity: Option<PackageFidelityMetadata>,
}

impl PackageGraphBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_package_fidelity(package_fidelity: Option<PackageFidelityMetadata>) -> Self {
        Self {
            package_fidelity,
            ..Self::default()
        }
    }

    pub fn register_part(&mut self, part: PackagePart) -> Result<(), WriteError> {
        self.register_part_inner(part)
    }

    fn register_part_inner(&mut self, mut part: PackagePart) -> Result<(), WriteError> {
        part.path = normalize_part_path(&part.path);
        if let Some(existing) = self.parts.get(&part.path) {
            if existing.kind != part.kind {
                return Err(WriteError::PackageIntegrity(format!(
                    "package part path is owned by both modeled and opaque writers: {}",
                    part.path
                )));
            }
            if existing.bytes.is_none()
                && part.bytes.is_none()
                && existing.content_type == part.content_type
                && existing.default_extension == part.default_extension
            {
                return Ok(());
            }
            if existing.bytes.is_some() && part.bytes.is_some() && existing.bytes == part.bytes {
                return Ok(());
            }
            return Err(WriteError::PackageIntegrity(format!(
                "duplicate emitted package part path: {}",
                part.path
            )));
        }
        self.parts.insert(part.path.clone(), part);
        Ok(())
    }

    pub fn add_relationship(&mut self, mut relationship: PackageRelationship) {
        if let PackageRelationshipTarget::InternalPart { path } = &mut relationship.target {
            *path = normalize_part_path(path);
        }
        self.relationships.push(relationship);
    }

    pub fn contains_part(&self, path: &str) -> bool {
        self.parts.contains_key(&normalize_part_path(path))
    }

    pub fn register_imported_opaque_parts(&mut self) -> Result<(), WriteError> {
        let Some(metadata) = self.package_fidelity.clone() else {
            return Ok(());
        };

        for part in &metadata.opaque_parts {
            if crate::write::package_ownership::auxiliary_package_part_policy(&part.path)
                != Some(AuxiliaryPackagePartPolicy::InertOpaqueAuxiliary)
            {
                continue;
            }
            if crate::write::package_ownership::modeled_feature_part_must_not_be_opaque(&part.path)
            {
                continue;
            }
            if self.contains_part(&part.path) {
                continue;
            }
            self.register_part(imported_opaque_part(
                &part.path,
                part.content_type.clone(),
                part.bytes.clone(),
            ))?;
        }

        self.register_imported_root_and_workbook_opaque_relationships(&metadata);
        self.register_imported_opaque_sidecar_relationships(&metadata);

        Ok(())
    }

    fn register_imported_root_and_workbook_opaque_relationships(
        &mut self,
        metadata: &PackageFidelityMetadata,
    ) {
        for hint in &metadata.root_relationships {
            let Some(target_path) = imported_internal_target(None, hint) else {
                continue;
            };
            if self.is_opaque_part(&target_path) {
                self.add_imported_hint_relationship(PackageOwner::Root, hint, target_path);
            }
        }

        for hint in &metadata.workbook_relationships {
            let Some(target_path) = imported_internal_target(Some("xl/workbook.xml"), hint) else {
                continue;
            };
            if self.is_opaque_part(&target_path) {
                self.add_imported_hint_relationship(PackageOwner::Workbook, hint, target_path);
            }
        }
    }

    fn register_imported_opaque_sidecar_relationships(
        &mut self,
        metadata: &PackageFidelityMetadata,
    ) {
        for part in &metadata.opaque_parts {
            if !self.is_opaque_part(&part.path) {
                continue;
            }
            let owner = PackageOwner::Part {
                path: part.path.clone(),
            };
            for hint in &part.relationships {
                if hint.target_mode.as_deref() == Some("External") {
                    self.add_relationship(PackageRelationship {
                        owner: owner.clone(),
                        relationship_type: hint.relationship_type.clone(),
                        target: PackageRelationshipTarget::External {
                            target: hint.target.clone(),
                        },
                        identity_hint: Some(RelationshipIdentityHint::new(hint.id.as_str())),
                    });
                    continue;
                }

                let Some(target_path) = imported_internal_target(Some(&part.path), hint) else {
                    continue;
                };
                if self.is_opaque_part(&target_path) && same_inert_cluster(&part.path, &target_path)
                {
                    self.add_imported_hint_relationship(owner.clone(), hint, target_path);
                }
            }
        }
    }

    fn add_imported_hint_relationship(
        &mut self,
        owner: PackageOwner,
        hint: &domain_types::PackageRelationshipHint,
        target_path: String,
    ) {
        if self.relationship_exists(&owner, &hint.relationship_type, &target_path) {
            return;
        }
        self.add_relationship(PackageRelationship {
            owner,
            relationship_type: hint.relationship_type.clone(),
            target: PackageRelationshipTarget::InternalPart { path: target_path },
            identity_hint: Some(RelationshipIdentityHint::new(hint.id.as_str())),
        });
    }

    fn relationship_exists(&self, owner: &PackageOwner, relationship_type: &str, path: &str) -> bool {
        let normalized = normalize_part_path(path);
        self.relationships.iter().any(|rel| {
            &rel.owner == owner
                && rel.relationship_type == relationship_type
                && matches!(
                    &rel.target,
                    PackageRelationshipTarget::InternalPart { path } if normalize_part_path(path) == normalized
                )
        })
    }

    fn is_opaque_part(&self, path: &str) -> bool {
        self.parts
            .get(&normalize_part_path(path))
            .is_some_and(|part| matches!(part.kind, PackagePartKind::Opaque))
    }

    pub fn resolve(self) -> Result<ResolvedPackageGraph, WriteError> {
        let mut used_ids_by_owner: HashMap<String, HashSet<String>> = HashMap::new();
        let mut next_id_by_owner: HashMap<String, u32> = HashMap::new();
        let mut relationships = Vec::with_capacity(self.relationships.len());
        let imported_order_eligible =
            imported_order_eligible_by_owner(self.package_fidelity.as_ref(), &self.relationships);

        let mut pending: Vec<_> = self.relationships.iter().enumerate().collect();
        pending.sort_by_key(|(index, relationship)| {
            (
                imported_relationship_order(
                    self.package_fidelity.as_ref(),
                    &imported_order_eligible,
                    relationship,
                ),
                *index,
            )
        });

        for (_, relationship) in pending {
            validate_internal_target_is_registered(relationship, &self.parts)?;
            let owner_rels_path = owner_rels_path(&relationship.owner);
            let hinted_id = relationship
                .identity_hint
                .as_ref()
                .map(|hint| hint.id.as_str())
                .or_else(|| current_relationship_hint_id(self.package_fidelity.as_ref(), relationship));
            let id = allocate_relationship_id(
                &owner_rels_path,
                hinted_id,
                &mut used_ids_by_owner,
                &mut next_id_by_owner,
            );
            let (target, target_mode) = resolve_target(&relationship.owner, &relationship.target)?;
            relationships.push(ResolvedPackageRelationship {
                owner_rels_path,
                id,
                relationship_type: relationship.relationship_type.clone(),
                target,
                target_mode,
            });
        }

        Ok(ResolvedPackageGraph {
            parts: self.parts,
            relationships,
            package_fidelity: self.package_fidelity,
        })
    }
}
