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

            if is_external_target_mode(rel.target_mode.as_deref()) {
                continue;
            }

            match relationship_target_part_path(&rel.owner_rels_path, &rel.target) {
                Ok(Some(target_path)) => {
                    if !self.parts.contains_key(&target_path) {
                        errors.push(PackageIntegrityIssue::MissingRelationshipTarget {
                            rels_path: rel.owner_rels_path.clone(),
                            id: rel.id.clone(),
                            target: rel.target.clone(),
                            resolved_path: target_path,
                        });
                    } else {
                        validate_relationship_target_semantic_kind(
                            rel,
                            &target_path,
                            &self.parts,
                            &mut errors,
                        );
                    }
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
            validate_opaque_part_relationship_references(part, &self.relationships, &mut errors);
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
        let target_part_path = relationship_target_part_path(&owner_rels_path, target)
            .ok()
            .flatten();
        self.relationships
            .iter()
            .find(|rel| {
                rel.owner_rels_path == owner_rels_path
                    && rel.relationship_type == relationship_type
                    && (rel.target == target
                        || target_part_path.as_ref().is_some_and(|target_part_path| {
                            relationship_target_part_path(&owner_rels_path, &rel.target)
                                .ok()
                                .flatten()
                                .as_ref()
                                == Some(target_part_path)
                        }))
            })
            .map(|rel| rel.id.as_str())
    }

    pub fn relationship_id_for_nth_match(
        &self,
        owner: &PackageOwner,
        relationship_type: &str,
        target: &str,
        target_mode: Option<&str>,
        excluded_indices: &[usize],
    ) -> Option<(usize, &str)> {
        let owner_rels_path = owner_rels_path(owner);
        self.relationships
            .iter()
            .enumerate()
            .find(|(index, rel)| {
                !excluded_indices.contains(index)
                    && rel.owner_rels_path == owner_rels_path
                    && rel.relationship_type == relationship_type
                    && rel.target == target
                    && rel.target_mode.as_deref() == target_mode
            })
            .map(|(index, rel)| (index, rel.id.as_str()))
    }

    pub fn relationship_id_for_key(&self, key: RegisteredRelationshipKey) -> Option<&str> {
        self.relationships
            .iter()
            .find(|rel| rel.source_key == key)
            .map(|rel| rel.id.as_str())
    }

    pub fn add_content_types_to(&self, content_types: &mut ContentTypesManager) {
        content_types.add_default("rels", CT_RELATIONSHIPS);
        content_types.add_default("xml", CT_XML);

        let mut parts: Vec<_> = self.parts.values().collect();
        parts.sort_by(|a, b| {
            content_type_part_order(&a.path)
                .cmp(&content_type_part_order(&b.path))
                .then_with(|| a.path.cmp(&b.path))
        });

        for part in parts {
            if let Some((extension, content_type)) = &part.default_extension {
                content_types.add_default(extension, content_type);
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
                || matches!(extension.as_str(), "rels" | "xml")
            {
                let emitted = content_types
                    .defaults()
                    .iter()
                    .find(|default| default.extension.eq_ignore_ascii_case(&hint.extension))
                    .map(|default| default.content_type.as_str());
                if emitted.is_some_and(|emitted| {
                    imported_default_content_type_alias_is_allowed(
                        &extension,
                        emitted,
                        &hint.content_type,
                    )
                }) {
                    content_types
                        .prefer_existing_default_content_type(&hint.extension, &hint.content_type);
                }
            }
        }
    }

    pub fn content_type_manifest_dispositions(
        &self,
    ) -> Vec<domain_types::PackageContentTypeManifestDisposition> {
        let Some(metadata) = self.package_fidelity.as_ref() else {
            return Vec::new();
        };

        let emitted_defaults = self.emitted_content_type_defaults();
        let emitted_overrides = self.emitted_content_type_overrides();
        let mut dispositions = Vec::new();

        for hint in &metadata.content_type_defaults {
            let extension = hint.extension.to_ascii_lowercase();
            let emitted_content_type = emitted_defaults.get(&extension).cloned();
            let (disposition, reason_code, severity, outcome, message) = match emitted_content_type
                .as_deref()
            {
                Some(emitted) if emitted == hint.content_type => (
                    domain_types::PackageContentTypeManifestDispositionKind::Preserved,
                    "requiredDefaultPreserved",
                    domain_types::PackageContentTypeManifestSeverity::Info,
                    domain_types::PackageContentTypeManifestExportOutcome::Succeeded,
                    format!(
                        "Imported content type default for .{} is required by the current package.",
                        hint.extension
                    ),
                ),
                Some(emitted)
                    if imported_default_content_type_alias_is_allowed(
                        &extension,
                        emitted,
                        &hint.content_type,
                    ) =>
                {
                    (
                        domain_types::PackageContentTypeManifestDispositionKind::Preserved,
                        "ownerApprovedDefaultAliasPreserved",
                        domain_types::PackageContentTypeManifestSeverity::Info,
                        domain_types::PackageContentTypeManifestExportOutcome::Succeeded,
                        format!(
                            "Imported content type default for .{} is an owner-approved alias for the current package.",
                            hint.extension
                        ),
                    )
                }
                Some(_) => (
                    domain_types::PackageContentTypeManifestDispositionKind::Rewritten,
                    "requiredDefaultCanonicalized",
                    domain_types::PackageContentTypeManifestSeverity::Info,
                    domain_types::PackageContentTypeManifestExportOutcome::Succeeded,
                    format!(
                        "Imported content type default for .{} was rewritten to the current owner's content type.",
                        hint.extension
                    ),
                ),
                None => (
                    domain_types::PackageContentTypeManifestDispositionKind::UnusedDefaultDropped,
                    "noCurrentPartUsesExtension",
                    domain_types::PackageContentTypeManifestSeverity::Info,
                    domain_types::PackageContentTypeManifestExportOutcome::Succeeded,
                    format!(
                        "Imported content type default for .{} was dropped because no current emitted part uses that extension.",
                        hint.extension
                    ),
                ),
            };

            dispositions.push(domain_types::PackageContentTypeManifestDisposition {
                row_kind: domain_types::PackageContentTypeManifestRowKind::Default,
                extension: Some(hint.extension.clone()),
                part_name: None,
                imported_content_type: hint.content_type.clone(),
                emitted_content_type,
                feature_owner: feature_owner_for_default_extension(&extension).to_string(),
                owner_policy_class: owner_policy_for_default_extension(&extension).to_string(),
                disposition,
                reason_code: reason_code.to_string(),
                severity,
                affected_relationships: Vec::new(),
                affected_content_type_rows: vec![format!("Default:{}", hint.extension)],
                semantic_impact: semantic_impact_for_default_extension(&extension).to_string(),
                export_outcome: outcome,
                diagnostic_code: format!("xlsxContentType.{reason_code}"),
                diagnostic_message: message,
            });
        }

        for hint in &metadata.content_type_overrides {
            let part_name = normalize_part_path(&hint.part_name);
            let emitted_content_type = emitted_overrides.get(&part_name).cloned();
            let (disposition, reason_code, severity, outcome, message) = match emitted_content_type
                .as_deref()
            {
                Some(emitted) if emitted == hint.content_type => (
                    domain_types::PackageContentTypeManifestDispositionKind::Preserved,
                    "currentPartOverridePreserved",
                    domain_types::PackageContentTypeManifestSeverity::Info,
                    domain_types::PackageContentTypeManifestExportOutcome::Succeeded,
                    format!(
                        "Imported content type override for {} is required by the current package.",
                        part_name
                    ),
                ),
                Some(_) => (
                    domain_types::PackageContentTypeManifestDispositionKind::Rewritten,
                    "currentPartOverrideCanonicalized",
                    domain_types::PackageContentTypeManifestSeverity::Info,
                    domain_types::PackageContentTypeManifestExportOutcome::Succeeded,
                    format!(
                        "Imported content type override for {} was rewritten to the current owner's content type.",
                        part_name
                    ),
                ),
                None => dropped_override_disposition(&part_name),
            };

            dispositions.push(domain_types::PackageContentTypeManifestDisposition {
                row_kind: domain_types::PackageContentTypeManifestRowKind::Override,
                extension: None,
                part_name: Some(part_name.clone()),
                imported_content_type: hint.content_type.clone(),
                emitted_content_type,
                feature_owner: feature_owner_for_part_path(&part_name).to_string(),
                owner_policy_class: owner_policy_for_part_path(&part_name).to_string(),
                disposition,
                reason_code: reason_code.to_string(),
                severity,
                affected_relationships: affected_relationships_for_part(&part_name),
                affected_content_type_rows: vec![format!("Override:/{}", part_name)],
                semantic_impact: semantic_impact_for_part_path(&part_name).to_string(),
                export_outcome: outcome,
                diagnostic_code: format!("xlsxContentType.{reason_code}"),
                diagnostic_message: message,
            });
        }

        dispositions
    }

    fn emitted_content_type_defaults(&self) -> HashMap<String, String> {
        let mut defaults = HashMap::from([
            (
                "rels".to_string(),
                "application/vnd.openxmlformats-package.relationships+xml".to_string(),
            ),
            ("xml".to_string(), "application/xml".to_string()),
        ]);
        for part in self.parts.values() {
            if let Some((extension, content_type)) = &part.default_extension {
                defaults.insert(extension.to_ascii_lowercase(), content_type.clone());
            }
        }
        defaults
    }

    fn emitted_content_type_overrides(&self) -> HashMap<String, String> {
        self.parts
            .values()
            .filter_map(|part| {
                part.content_type
                    .as_ref()
                    .map(|content_type| (part.path.clone(), content_type.clone()))
            })
            .collect()
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

fn imported_default_content_type_alias_is_allowed(
    extension: &str,
    emitted_content_type: &str,
    imported_content_type: &str,
) -> bool {
    if emitted_content_type == imported_content_type {
        return true;
    }
    matches!(
        (
            extension,
            emitted_content_type,
            imported_content_type.to_ascii_lowercase().as_str()
        ),
        ("jpg" | "jpeg", "image/jpeg", "image/jpg")
    )
}

fn dropped_override_disposition(
    part_name: &str,
) -> (
    domain_types::PackageContentTypeManifestDispositionKind,
    &'static str,
    domain_types::PackageContentTypeManifestSeverity,
    domain_types::PackageContentTypeManifestExportOutcome,
    String,
) {
    if is_security_sensitive_part_path(part_name) {
        (
            domain_types::PackageContentTypeManifestDispositionKind::SecurityDropped,
            "securitySensitivePartDropped",
            domain_types::PackageContentTypeManifestSeverity::Warning,
            domain_types::PackageContentTypeManifestExportOutcome::SucceededWithLoss,
            format!(
                "Imported content type override for {} was dropped by active-content policy.",
                part_name
            ),
        )
    } else if is_typed_owner_part_path(part_name) {
        (
            domain_types::PackageContentTypeManifestDispositionKind::TypedOwnerDropped,
            "typedOwnerDidNotEmitPart",
            domain_types::PackageContentTypeManifestSeverity::Info,
            domain_types::PackageContentTypeManifestExportOutcome::SucceededWithLoss,
            format!(
                "Imported content type override for {} was dropped because the current typed owner did not emit that part.",
                part_name
            ),
        )
    } else if is_unsupported_active_or_relationship_bearing_part_path(part_name) {
        (
            domain_types::PackageContentTypeManifestDispositionKind::UnsupportedDropped,
            "unsupportedPackageArtifactDropped",
            domain_types::PackageContentTypeManifestSeverity::Warning,
            domain_types::PackageContentTypeManifestExportOutcome::SucceededWithLoss,
            format!(
                "Imported content type override for {} was dropped because no current supported owner emitted it.",
                part_name
            ),
        )
    } else {
        (
            domain_types::PackageContentTypeManifestDispositionKind::StaleDropped,
            "noCurrentPackageOwner",
            domain_types::PackageContentTypeManifestSeverity::Info,
            domain_types::PackageContentTypeManifestExportOutcome::Succeeded,
            format!(
                "Imported content type override for {} was dropped because it has no current emitted package part.",
                part_name
            ),
        )
    }
}

fn feature_owner_for_default_extension(extension: &str) -> &'static str {
    match extension {
        "rels" | "xml" => "opcPackage",
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "tif" | "tiff" | "svg" | "emf" | "wmf" => "media",
        "vml" => "legacyDrawing",
        "bin" => "binaryPackagePart",
        _ => "unknownPackagePart",
    }
}

fn owner_policy_for_default_extension(extension: &str) -> &'static str {
    match extension {
        "rels" | "xml" => "mandatoryPackageDefault",
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "tif" | "tiff" | "svg" | "emf" | "wmf" | "vml" => {
            "typedOwnerOrOwnerScopedOpaque"
        }
        "bin" => "typedOwnerOrSecurityPolicy",
        _ => "ownerClassified",
    }
}

fn semantic_impact_for_default_extension(extension: &str) -> &'static str {
    match extension {
        "rels" | "xml" => "Package infrastructure content type.",
        "bin" => {
            "Binary package part content type; wrong aliases can change active-content semantics."
        }
        _ => "No workbook semantic impact when no current emitted part uses this extension.",
    }
}

fn feature_owner_for_part_path(path: &str) -> &'static str {
    if path == "xl/workbook.xml" {
        "workbook"
    } else if path.starts_with("xl/worksheets/") {
        "worksheet"
    } else if path.starts_with("xl/comments") || path.starts_with("xl/threadedComments/") {
        "comments"
    } else if path == "xl/persons/person.xml" {
        "persons"
    } else if path.starts_with("xl/media/") {
        "media"
    } else if path.starts_with("xl/webextensions/") {
        "webextensions"
    } else if path == "xl/connections.xml" {
        "connections"
    } else if path == crate::domain::feature_property_bags::DEFAULT_FEATURE_PROPERTY_BAG_PATH {
        "featurePropertyBags"
    } else if is_security_sensitive_part_path(path) {
        "activeContent"
    } else {
        "unknownPackagePart"
    }
}

fn owner_policy_for_part_path(path: &str) -> &'static str {
    if is_security_sensitive_part_path(path) {
        "unsafeOrPolicyBlocked"
    } else if is_unsupported_active_or_relationship_bearing_part_path(path) {
        "activeExternalCapableOwner"
    } else if is_typed_owner_part_path(path) {
        "typedModeledOwner"
    } else {
        "staleEvidence"
    }
}

fn semantic_impact_for_part_path(path: &str) -> &'static str {
    if is_security_sensitive_part_path(path) {
        "Active-content artifact omitted from the exported package."
    } else if is_typed_owner_part_path(path) {
        "Typed owner did not emit this imported part in the current workbook state."
    } else {
        "No current emitted package part uses this imported override."
    }
}

fn affected_relationships_for_part(path: &str) -> Vec<String> {
    if path.starts_with("xl/webextensions/") {
        vec![
            "_rels/.rels".to_string(),
            "xl/webextensions/_rels/taskpanes.xml.rels".to_string(),
        ]
    } else if path == "xl/persons/person.xml" || path == "xl/connections.xml" {
        vec!["xl/_rels/workbook.xml.rels".to_string()]
    } else {
        Vec::new()
    }
}

fn is_typed_owner_part_path(path: &str) -> bool {
    path == "xl/workbook.xml"
        || path == "xl/styles.xml"
        || path == "xl/sharedStrings.xml"
        || path == "xl/theme/theme1.xml"
        || path == "xl/metadata.xml"
        || path == "xl/persons/person.xml"
        || path == "xl/connections.xml"
        || path == crate::domain::feature_property_bags::DEFAULT_FEATURE_PROPERTY_BAG_PATH
        || path.starts_with("docProps/")
        || path.starts_with("xl/worksheets/")
        || path.starts_with("xl/comments")
        || path.starts_with("xl/threadedComments/")
        || path.starts_with("xl/tables/")
        || path.starts_with("xl/queryTables/")
        || path.starts_with("xl/pivotTables/")
        || path.starts_with("xl/pivotCache/")
        || path.starts_with("xl/charts/")
        || path.starts_with("xl/drawings/")
        || path.starts_with("xl/slicers/")
        || path.starts_with("xl/slicerCaches/")
}

fn is_security_sensitive_part_path(path: &str) -> bool {
    path.ends_with("vbaProject.bin")
        || path.contains("/activeX/")
        || path.starts_with("xl/activeX/")
        || path.starts_with("xl/macrosheets/")
        || path.starts_with("_xmlsignatures/")
        || path.contains("/_xmlsignatures/")
}

fn is_unsupported_active_or_relationship_bearing_part_path(path: &str) -> bool {
    path.starts_with("xl/webextensions/")
        || path.starts_with("xl/externalLinks/")
        || path.starts_with("xl/model/")
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
