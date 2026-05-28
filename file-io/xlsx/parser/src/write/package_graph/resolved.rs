use super::*;

impl ResolvedPackageGraph {
    pub fn validate_for_export(&self) -> Result<(), WriteError> {
        let mut errors = Vec::new();
        let mut relationship_ids_by_owner: HashMap<&str, HashSet<&str>> = HashMap::new();

        for part in self.parts.values() {
            if part.content_type.is_none() && part.default_extension.is_none() {
                errors.push(PackageIntegrityIssue::MissingPartContentType {
                    part_path: part.path.clone(),
                });
            }
            if let Some((extension, content_type)) = &part.default_extension
                && (extension.is_empty() || content_type.is_empty())
            {
                errors.push(PackageIntegrityIssue::MissingPartContentType {
                    part_path: part.path.clone(),
                });
            }
            validate_required_content_type(part, &mut errors);
        }

        for rel in &self.relationships {
            let ids = relationship_ids_by_owner
                .entry(rel.owner_rels_path.as_str())
                .or_default();
            if !ids.insert(rel.id.as_str()) {
                errors.push(PackageIntegrityIssue::DuplicateRelationshipId {
                    rels_path: rel.owner_rels_path.clone(),
                    id: rel.id.clone(),
                });
            }

            if let Some(Some(owner_part)) = owner_part_path_from_rels_path(&rel.owner_rels_path)
                && !self.parts.contains_key(&owner_part)
            {
                errors.push(PackageIntegrityIssue::MissingRelationshipOwner {
                    rels_path: rel.owner_rels_path.clone(),
                    owner_path: owner_part,
                });
            }

            validate_known_relationship_owner(rel, &self.parts, &mut errors);

            if rel.target_mode.as_deref() == Some("External") {
                continue;
            }

            match relationship_target_part_path(&rel.owner_rels_path, &rel.target) {
                Ok(Some(target_path)) if !self.parts.contains_key(&target_path) => {
                    errors.push(PackageIntegrityIssue::MissingRelationshipTarget {
                        rels_path: rel.owner_rels_path.clone(),
                        id: rel.id.clone(),
                        target: rel.target.clone(),
                        resolved_path: target_path,
                    });
                }
                Ok(_) => {}
                Err(reason) => errors.push(PackageIntegrityIssue::InvalidRelationshipTarget {
                    rels_path: rel.owner_rels_path.clone(),
                    id: rel.id.clone(),
                    target: rel.target.clone(),
                    reason,
                }),
            }
        }

        for part in self.parts.values() {
            validate_modeled_part_owner_relationship(part, &self.relationships, &mut errors);
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(WriteError::PackageIntegrityIssues(errors))
        }
    }

    pub fn relationship_manager_for_owner(&self, owner: &PackageOwner) -> RelationshipManager {
        let owner_rels_path = owner_rels_path(owner);
        let relationships: Vec<_> = self
            .relationships
            .iter()
            .filter(|rel| rel.owner_rels_path == owner_rels_path)
            .map(|rel| Relationship {
                id: rel.id.clone(),
                rel_type: rel.relationship_type.clone(),
                target: rel.target.clone(),
                target_mode: rel.target_mode.clone(),
            })
            .collect();
        RelationshipManager::from_relationships(relationships)
    }

    pub fn relationship_id(
        &self,
        owner: &PackageOwner,
        relationship_type: &str,
        target: &str,
    ) -> Option<&str> {
        let owner_rels_path = owner_rels_path(owner);
        self.relationships
            .iter()
            .find(|rel| {
                rel.owner_rels_path == owner_rels_path
                    && rel.relationship_type == relationship_type
                    && rel.target == target
            })
            .map(|rel| rel.id.as_str())
    }

    pub fn add_content_types_to(&self, content_types: &mut ContentTypesManager) {
        let mut parts: Vec<_> = self.parts.values().collect();
        parts.sort_by(|a, b| {
            content_type_part_order(&a.path)
                .cmp(&content_type_part_order(&b.path))
                .then_with(|| a.path.cmp(&b.path))
        });

        for part in parts {
            if let Some((extension, content_type)) = &part.default_extension {
                let hinted_content_type = self
                    .package_fidelity
                    .as_ref()
                    .and_then(|metadata| metadata.content_type_default_for_extension(extension))
                    .unwrap_or(content_type);
                content_types.add_default(extension, hinted_content_type);
            }
            if let Some(content_type) = &part.content_type {
                content_types.add_override(&part.path, content_type);
            }
        }
    }

    pub fn apply_content_type_preferences_to(&self, content_types: &mut ContentTypesManager) {
        let Some(metadata) = self.package_fidelity.as_ref() else {
            return;
        };
        let emitted_default_extensions: HashSet<String> = self
            .parts
            .values()
            .filter_map(|part| {
                part.default_extension
                    .as_ref()
                    .map(|(extension, _)| extension.to_ascii_lowercase())
            })
            .collect();
        for hint in &metadata.content_type_defaults {
            let extension = hint.extension.to_ascii_lowercase();
            if emitted_default_extensions.contains(&extension)
                || matches!(extension.as_str(), "rels" | "xml" | "bin")
            {
                content_types
                    .prefer_existing_default_content_type(&hint.extension, &hint.content_type);
            }
        }
    }

    pub fn contains_part(&self, path: &str) -> bool {
        self.parts.contains_key(&normalize_part_path(path))
    }

    pub fn opaque_parts(&self) -> impl Iterator<Item = &PackagePart> {
        self.parts
            .values()
            .filter(|part| matches!(part.kind, PackagePartKind::Opaque))
    }
}

fn content_type_part_order(path: &str) -> u8 {
    if path == "xl/workbook.xml" {
        0
    } else if path.starts_with("xl/theme/") {
        10
    } else if path == "xl/styles.xml" {
        20
    } else if path == "xl/sharedStrings.xml" {
        30
    } else if path.starts_with("xl/worksheets/") {
        40
    } else if path == "xl/metadata.xml" {
        50
    } else if path.starts_with("xl/") {
        60
    } else if path == "docProps/core.xml" {
        90
    } else if path == "docProps/app.xml" {
        91
    } else if path == "docProps/custom.xml" {
        92
    } else {
        80
    }
}
