use std::collections::{BTreeMap, HashMap, HashSet};

use domain_types::PackageFidelityMetadata;

use super::{
    AuxiliaryPackagePartPolicy, CT_PRINTER_SETTINGS, PackageOwner, PackagePart, PackagePartKind,
    PackageRelationship, PackageRelationshipTarget, RegisteredRelationshipKey,
    RelationshipIdentityHint, ResolvedPackageGraph, ResolvedPackageRelationship,
    allocate_relationship_id, imported_internal_target, imported_opaque_part,
    imported_relationship_match, is_external_target_mode, normalize_part_path, owner_rels_path,
    relationship_current_occurrence, resolve_target, same_inert_cluster,
    validate_internal_target_is_registered,
};
use crate::write::write_error::WriteError;

#[derive(Debug, Default)]
pub struct PackageGraphBuilder {
    parts: BTreeMap<String, PackagePart>,
    relationships: Vec<(RegisteredRelationshipKey, PackageRelationship)>,
    next_relationship_key: usize,
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
            if existing.semantic_kind != part.semantic_kind {
                return Err(WriteError::PackageIntegrity(format!(
                    "package part path {} is claimed as both {:?} and {:?}",
                    part.path, existing.semantic_kind, part.semantic_kind
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

    pub fn add_relationship(
        &mut self,
        mut relationship: PackageRelationship,
    ) -> RegisteredRelationshipKey {
        if let PackageRelationshipTarget::InternalPart { path } = &mut relationship.target {
            *path = normalize_part_path(path);
        }
        let key = RegisteredRelationshipKey(self.next_relationship_key);
        self.next_relationship_key += 1;
        self.relationships.push((key, relationship));
        key
    }

    pub fn add_relationship_if_absent(
        &mut self,
        relationship: PackageRelationship,
    ) -> RegisteredRelationshipKey {
        let relationship = normalize_relationship_target(relationship);
        if let Some((key, _)) = self.relationships.iter().find(|(_, existing)| {
            existing.owner == relationship.owner
                && existing.relationship_type == relationship.relationship_type
                && existing.target == relationship.target
        }) {
            return *key;
        }
        self.add_relationship(relationship)
    }

    pub fn contains_part(&self, path: &str) -> bool {
        self.parts.contains_key(&normalize_part_path(path))
    }

    pub fn register_imported_print_settings_part(
        &mut self,
        path: &str,
    ) -> Result<bool, WriteError> {
        let normalized_path = normalize_part_path(path);
        if self.contains_part(&normalized_path) {
            return Ok(true);
        }
        let Some(metadata) = self.package_fidelity.as_ref() else {
            return Ok(false);
        };
        let Some((part_path, bytes)) = metadata
            .opaque_parts
            .iter()
            .find(|part| normalize_part_path(&part.path) == normalized_path)
            .map(|part| (part.path.clone(), part.bytes.clone()))
        else {
            return Ok(false);
        };
        if crate::write::package_ownership::modeled_owner_for_part(&normalized_path)
            != Some(crate::write::package_ownership::PackageFeatureOwner::PrintSettings)
        {
            return Ok(false);
        }
        self.register_part(imported_opaque_part(
            &part_path,
            Some(CT_PRINTER_SETTINGS.to_string()),
            bytes,
        ))?;
        Ok(true)
    }

    pub fn register_imported_opaque_parts(&mut self) -> Result<(), WriteError> {
        let Some(metadata) = self.package_fidelity.clone() else {
            return Ok(());
        };
        let non_editable_sheet_cluster = non_editable_sheet_cluster_paths(&metadata);
        let webextension_cluster = validated_webextension_cluster_paths(&metadata);

        for part in &metadata.opaque_parts {
            let normalized_path = normalize_part_path(&part.path);
            if normalized_path.starts_with("xl/webextensions/")
                && !webextension_cluster.contains(&normalized_path)
            {
                continue;
            }
            let is_non_editable_sheet_cluster =
                non_editable_sheet_cluster.contains(&normalized_path);
            let is_inert_auxiliary =
                crate::write::package_ownership::auxiliary_package_part_policy(&part.path)
                    == Some(AuxiliaryPackagePartPolicy::InertOpaqueAuxiliary);
            let is_quarantined_active =
                crate::write::package_ownership::auxiliary_package_part_policy(&part.path)
                    == Some(AuxiliaryPackagePartPolicy::ActiveQuarantined);
            if !is_inert_auxiliary && !is_non_editable_sheet_cluster && !is_quarantined_active {
                continue;
            }
            if is_quarantined_active && normalize_part_path(&part.path) != "xl/vbaProject.bin" {
                continue;
            }
            if !is_non_editable_sheet_cluster
                && !is_quarantined_active
                && crate::write::package_ownership::modeled_feature_part_must_not_be_opaque(
                    &part.path,
                )
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
        self.register_imported_opaque_sidecar_relationships(&metadata, &non_editable_sheet_cluster);

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
        non_editable_sheet_cluster: &HashSet<String>,
    ) {
        for part in &metadata.opaque_parts {
            if !self.is_opaque_part(&part.path) {
                continue;
            }
            let owner = PackageOwner::Part {
                path: part.path.clone(),
            };
            for hint in opaque_part_relationship_hints(metadata, part) {
                if is_external_target_mode(hint.target_mode.as_deref()) {
                    continue;
                }

                let Some(target_path) = imported_internal_target(Some(&part.path), hint) else {
                    continue;
                };
                if self.is_opaque_part(&target_path)
                    && (same_inert_cluster(&part.path, &target_path)
                        || same_quarantined_active_cluster(&part.path, &target_path)
                        || same_non_editable_sheet_cluster(
                            &part.path,
                            &target_path,
                            non_editable_sheet_cluster,
                        ))
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

    fn relationship_exists(
        &self,
        owner: &PackageOwner,
        relationship_type: &str,
        path: &str,
    ) -> bool {
        let normalized = normalize_part_path(path);
        self.relationships.iter().any(|(_, rel)| {
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
        let mut pending: Vec<_> = self
            .relationships
            .iter()
            .enumerate()
            .map(|(index, (source_key, relationship))| {
                let current_occurrence =
                    relationship_current_occurrence(&self.relationships, index);
                let imported_match = imported_relationship_match(
                    self.package_fidelity.as_ref(),
                    relationship,
                    current_occurrence,
                );
                (index, source_key, relationship, imported_match)
            })
            .collect();
        pending.sort_by_key(|(index, _, _, imported_match)| {
            (
                imported_match
                    .as_ref()
                    .map(|matched| matched.order)
                    .unwrap_or(usize::MAX),
                *index,
            )
        });

        for (_, source_key, relationship, imported_match) in pending {
            validate_internal_target_is_registered(relationship, &self.parts)?;
            let owner_rels_path = owner_rels_path(&relationship.owner);
            let hinted_id = imported_match.map(|matched| matched.id).or_else(|| {
                relationship
                    .identity_hint
                    .as_ref()
                    .map(|hint| hint.id.as_str())
            });
            let id = allocate_relationship_id(
                &owner_rels_path,
                hinted_id,
                &mut used_ids_by_owner,
                &mut next_id_by_owner,
            );
            let (target, target_mode) = match (&relationship.target, imported_match) {
                (PackageRelationshipTarget::InternalPart { .. }, Some(imported_match)) => (
                    imported_match.target.to_string(),
                    imported_match.target_mode.cloned(),
                ),
                _ => resolve_target(&relationship.owner, &relationship.target)?,
            };
            relationships.push(ResolvedPackageRelationship {
                source_key: *source_key,
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

fn normalize_relationship_target(mut relationship: PackageRelationship) -> PackageRelationship {
    if let PackageRelationshipTarget::InternalPart { path } = &mut relationship.target {
        *path = normalize_part_path(path);
    }
    relationship
}

fn non_editable_sheet_cluster_paths(metadata: &PackageFidelityMetadata) -> HashSet<String> {
    let opaque_paths: HashSet<String> = metadata
        .opaque_parts
        .iter()
        .map(|part| normalize_part_path(&part.path))
        .collect();
    let mut cluster = HashSet::new();
    for hint in &metadata.workbook_relationships {
        if !is_non_editable_sheet_relationship(&hint.relationship_type) {
            continue;
        }
        let Some(path) = imported_internal_target(Some("xl/workbook.xml"), hint) else {
            continue;
        };
        let path = normalize_part_path(&path);
        if opaque_paths.contains(&path) {
            cluster.insert(path);
        }
    }

    let mut changed = true;
    while changed {
        changed = false;
        for part in &metadata.opaque_parts {
            let source = normalize_part_path(&part.path);
            if !cluster.contains(&source) {
                continue;
            }
            for hint in &part.relationships {
                if is_external_target_mode(hint.target_mode.as_deref()) {
                    continue;
                }
                let Some(target) = imported_internal_target(Some(&source), hint) else {
                    continue;
                };
                let target = normalize_part_path(&target);
                if opaque_paths.contains(&target) && cluster.insert(target) {
                    changed = true;
                }
            }
        }
    }
    cluster
}

fn is_non_editable_sheet_relationship(relationship_type: &str) -> bool {
    matches!(
        relationship_type,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet"
            | "http://schemas.openxmlformats.org/officeDocument/2006/relationships/dialogsheet"
    )
}

fn same_non_editable_sheet_cluster(
    owner_path: &str,
    target_path: &str,
    cluster: &HashSet<String>,
) -> bool {
    cluster.contains(&normalize_part_path(owner_path))
        && cluster.contains(&normalize_part_path(target_path))
}

fn same_quarantined_active_cluster(owner_path: &str, target_path: &str) -> bool {
    normalize_part_path(owner_path) == "xl/vbaProject.bin"
        && normalize_part_path(target_path) == "xl/vbaProject.bin"
}

const REL_WEB_EXTENSION_TASKPANES: &str =
    "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes";
const REL_WEB_EXTENSION: &str =
    "http://schemas.microsoft.com/office/2011/relationships/webextension";
const CT_WEB_EXTENSION_TASKPANES: &str = "application/vnd.ms-office.webextensiontaskpanes+xml";
const CT_WEB_EXTENSION: &str = "application/vnd.ms-office.webextension+xml";

fn validated_webextension_cluster_paths(metadata: &PackageFidelityMetadata) -> HashSet<String> {
    let opaque_by_path: HashMap<String, &domain_types::OpaquePackagePartHint> = metadata
        .opaque_parts
        .iter()
        .map(|part| (normalize_part_path(&part.path), part))
        .collect();

    if !opaque_by_path
        .keys()
        .any(|path| path.starts_with("xl/webextensions/"))
    {
        return HashSet::new();
    }

    let has_root_relationship = metadata.root_relationships.iter().any(|hint| {
        hint.relationship_type == REL_WEB_EXTENSION_TASKPANES
            && !is_external_target_mode(hint.target_mode.as_deref())
            && imported_internal_target(None, hint).is_some_and(|target| {
                normalize_part_path(&target) == "xl/webextensions/taskpanes.xml"
            })
    });
    if !has_root_relationship {
        return HashSet::new();
    }

    let Some(taskpanes) = opaque_by_path.get("xl/webextensions/taskpanes.xml") else {
        return HashSet::new();
    };
    if taskpanes.content_type.as_deref() != Some(CT_WEB_EXTENSION_TASKPANES) {
        return HashSet::new();
    }

    let mut cluster = HashSet::from(["xl/webextensions/taskpanes.xml".to_string()]);
    for hint in opaque_part_relationship_hints(metadata, taskpanes) {
        if hint.relationship_type != REL_WEB_EXTENSION {
            continue;
        }
        if is_external_target_mode(hint.target_mode.as_deref()) {
            continue;
        }
        let Some(target) = imported_internal_target(Some("xl/webextensions/taskpanes.xml"), hint)
        else {
            return HashSet::new();
        };
        let target = normalize_part_path(&target);
        if !target.starts_with("xl/webextensions/") {
            return HashSet::new();
        }
        let Some(part) = opaque_by_path.get(&target) else {
            return HashSet::new();
        };
        if part.content_type.as_deref() != Some(CT_WEB_EXTENSION) {
            return HashSet::new();
        }
        cluster.insert(target);
    }

    cluster
}

fn opaque_part_relationship_hints<'a>(
    metadata: &'a PackageFidelityMetadata,
    part: &'a domain_types::OpaquePackagePartHint,
) -> Vec<&'a domain_types::PackageRelationshipHint> {
    let normalized_path = normalize_part_path(&part.path);
    let mut hints: Vec<&domain_types::PackageRelationshipHint> =
        part.relationships.iter().collect();
    if let Some(info) = metadata
        .part_relationships
        .iter()
        .find(|info| normalize_part_path(&info.owner_path) == normalized_path)
    {
        for hint in &info.relationships {
            if !hints.iter().any(|existing| {
                existing.id == hint.id
                    && existing.relationship_type == hint.relationship_type
                    && existing.target == hint.target
                    && existing.target_mode == hint.target_mode
            }) {
                hints.push(hint);
            }
        }
    }
    hints
}
