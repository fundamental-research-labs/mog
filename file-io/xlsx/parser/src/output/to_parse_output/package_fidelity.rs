use super::*;

pub(super) fn build_package_fidelity_metadata(
    result: &FullParseResult,
) -> Option<domain_types::PackageFidelityMetadata> {
    let mut metadata = domain_types::PackageFidelityMetadata {
        provenance_version: domain_types::PackageProvenanceVersion::default(),
        workbook_xml_fidelity: result.workbook_xml_fidelity.clone(),
        package_profile: result.package_inventory.as_ref().map(|inventory| {
            domain_types::PackageProfileHint {
                profile: inventory.profile.as_str().to_string(),
                evidence: inventory.profile_evidence.clone(),
            }
        }),
        shared_string_table: build_shared_string_table_fidelity(result),
        content_type_defaults: result
            .content_type_defaults
            .iter()
            .map(
                |(extension, content_type)| domain_types::PackageContentTypeDefaultHint {
                    extension: extension.clone(),
                    content_type: content_type.clone(),
                },
            )
            .collect(),
        content_type_overrides: result
            .content_type_overrides
            .iter()
            .map(
                |(part_name, content_type)| domain_types::PackageContentTypeOverrideHint {
                    part_name: domain_types::normalize_package_path(part_name),
                    original_part_name: part_name.clone(),
                    content_type: content_type.clone(),
                },
            )
            .collect(),
        content_type_manifest_dispositions: Vec::new(),
        root_relationships: result
            .root_relationships
            .iter()
            .cloned()
            .map(domain_types::PackageRelationshipHint::from)
            .collect(),
        workbook_relationships: result
            .workbook_relationships
            .iter()
            .cloned()
            .map(domain_types::PackageRelationshipHint::from)
            .collect(),
        part_relationships: build_part_relationship_package_infos(result),
        sheet_workbook_r_ids: result.sheet_workbook_r_ids.clone(),
        opaque_parts: Vec::new(),
        raw_doc_props: build_raw_doc_props_hints(result),
        pivot_cache_packages: result.pivot_cache_packages.clone(),
        relationship_provenance: build_relationship_provenance(result),
        diagnostics: result
            .package_inventory
            .as_ref()
            .map(|inventory| {
                inventory
                    .diagnostics
                    .iter()
                    .map(|diagnostic| domain_types::PackageFidelityDiagnostic {
                        code: diagnostic.code.to_string(),
                        message: diagnostic.message.clone(),
                        part: diagnostic.part.clone(),
                        relationship_id: diagnostic.relationship_id.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        package_diagnostics: build_package_diagnostics(result),
    };

    let mut raw_parts = Vec::<(String, Vec<u8>)>::new();
    if let Some(inventory) = result.package_inventory.as_ref() {
        raw_parts.extend(inventory.entries.iter().filter_map(|entry| {
            entry
                .bytes
                .as_ref()
                .map(|bytes| (entry.normalized_path.clone(), bytes.clone()))
        }));
    }
    if let Some(extensions) = result.extensions.as_ref() {
        raw_parts.extend(
            extensions
                .imported_parts
                .entries()
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.clone())),
        );
    }
    raw_parts.extend(result.custom_xml_parts.iter().cloned());
    if let Some(bytes) = result.raw_doc_metadata_label_info.clone() {
        raw_parts.push(("docMetadata/LabelInfo.xml".to_string(), bytes));
    }

    metadata.opaque_parts = build_opaque_package_part_hints(result, raw_parts);
    append_webextension_cluster_diagnostic(&mut metadata);

    (!metadata.is_empty()).then_some(metadata)
}

fn build_shared_string_table_fidelity(
    result: &FullParseResult,
) -> Option<domain_types::SharedStringTableFidelity> {
    let entries: Vec<domain_types::SharedStringEntryFidelity> = result
        .shared_strings
        .iter()
        .enumerate()
        .filter_map(|(idx, text)| {
            let index = u32::try_from(idx).ok()?;
            let has_rich_text = result
                .shared_strings_rich_runs
                .get(idx)
                .and_then(Option::as_ref)
                .is_some_and(|runs| !runs.is_empty());
            let has_phonetic = result
                .shared_strings_phonetic_xml
                .get(idx)
                .and_then(Option::as_ref)
                .is_some_and(|xml| !xml.is_empty());
            let kind = if has_rich_text {
                domain_types::SharedStringEntryKind::RichText
            } else if text.is_empty() {
                domain_types::SharedStringEntryKind::Empty
            } else {
                domain_types::SharedStringEntryKind::PlainText
            };
            Some(domain_types::SharedStringEntryFidelity {
                index,
                text: text.clone(),
                kind,
                has_phonetic,
            })
        })
        .collect();

    let fidelity = domain_types::SharedStringTableFidelity {
        declared_count: result.shared_strings_declared_count,
        declared_unique_count: result.shared_strings_declared_unique_count,
        entries,
        ext_lst_xml: result
            .shared_strings_ext_lst_xml
            .clone()
            .unwrap_or_default(),
    };

    (!fidelity.is_empty()).then_some(fidelity)
}

fn build_part_relationship_package_infos(
    result: &FullParseResult,
) -> Vec<domain_types::PartRelationshipPackageInfo> {
    let mut infos: Vec<_> = result
        .package_inventory
        .as_ref()
        .map(crate::infra::opc_inventory::relationships_by_owner)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(owner_path, relationships)| {
            let owner_path = domain_types::normalize_package_path(&owner_path);
            if owner_path == "xl/workbook.xml" || relationships.is_empty() {
                return None;
            }
            let relationships = relationships
                .into_iter()
                .map(|relationship| domain_types::PackageRelationshipHint {
                    id: relationship.id,
                    relationship_type: relationship.relationship_type,
                    target: relationship.target,
                    target_mode: relationship.target_mode,
                })
                .collect();
            Some(domain_types::PartRelationshipPackageInfo {
                owner_path,
                relationships,
            })
        })
        .collect();
    infos.sort_by(|a, b| a.owner_path.cmp(&b.owner_path));
    infos
}

fn build_relationship_provenance(
    result: &FullParseResult,
) -> Vec<domain_types::RelationshipProvenance> {
    let Some(inventory) = result.package_inventory.as_ref() else {
        return Vec::new();
    };
    inventory
        .relationships
        .iter()
        .enumerate()
        .map(
            |(imported_order, relationship)| domain_types::RelationshipProvenance {
                owner_rels_path: relationship
                    .owner
                    .as_deref()
                    .map(owner_rels_path_from_part)
                    .unwrap_or_else(|| "_rels/.rels".to_string()),
                imported_relationship_id: relationship.id.clone(),
                relationship_type: relationship.relationship_type.clone(),
                original_target: relationship.target.clone(),
                resolved_target_path: relationship.resolved_target.clone(),
                target_mode: relationship.target_mode.clone(),
                imported_order,
                stable_owner_key: relationship.owner.clone(),
            },
        )
        .collect()
}

fn build_package_diagnostics(result: &FullParseResult) -> Vec<domain_types::XlsxPackageDiagnostic> {
    result
        .package_inventory
        .as_ref()
        .map(|inventory| {
            inventory
                .diagnostics
                .iter()
                .map(|diagnostic| domain_types::XlsxPackageDiagnostic {
                    code: package_diagnostic_code(diagnostic.code).to_string(),
                    severity: package_diagnostic_severity(diagnostic.code),
                    owner_id: package_diagnostic_owner(diagnostic.part.as_deref()),
                    action: domain_types::XlsxDiagnosticAction::Dropped,
                    reason: package_diagnostic_reason(diagnostic.code),
                    continuation: package_diagnostic_continuation(diagnostic.code),
                    lifecycle: domain_types::XlsxDiagnosticLifecycle::ImportOnlyEvidence,
                    normalized_part_path: diagnostic
                        .part
                        .as_deref()
                        .map(domain_types::normalize_package_path),
                    original_part_path: diagnostic.part.clone(),
                    relationship_owner_path: None,
                    relationship_id: diagnostic.relationship_id.clone(),
                    relationship_type: None,
                    target_mode: None,
                    content_type: None,
                    affected_graph: Vec::new(),
                    semantics_changed: true,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn package_diagnostic_code(code: &str) -> &'static str {
    match code {
        "invalid_relationship_owner" => "xlsx.packageGraph.danglingRelationship",
        "unsupported_needs_model_dropped" => "xlsx.extensions.unsupportedDropped",
        "active_forbidden_dropped" | "security_disabled_active_content" => {
            "xlsx.activeContent.blocked"
        }
        _ => "xlsx.ownerPolicy.unmatched",
    }
}

fn package_diagnostic_severity(code: &str) -> domain_types::XlsxDiagnosticSeverity {
    match code {
        "active_forbidden_dropped" | "security_disabled_active_content" => {
            domain_types::XlsxDiagnosticSeverity::Blocked
        }
        "invalid_relationship_owner" => domain_types::XlsxDiagnosticSeverity::Error,
        _ => domain_types::XlsxDiagnosticSeverity::Warning,
    }
}

fn package_diagnostic_reason(code: &str) -> domain_types::XlsxDiagnosticReason {
    match code {
        "invalid_relationship_owner" => domain_types::XlsxDiagnosticReason::DanglingRelationship,
        "active_forbidden_dropped" | "security_disabled_active_content" => {
            domain_types::XlsxDiagnosticReason::UnsafeActiveContent
        }
        "unsupported_needs_model_dropped" => domain_types::XlsxDiagnosticReason::UnsupportedFeature,
        _ => domain_types::XlsxDiagnosticReason::UnmatchedOwnerPolicy,
    }
}

fn package_diagnostic_continuation(code: &str) -> domain_types::XlsxDiagnosticContinuation {
    match code {
        "active_forbidden_dropped"
        | "security_disabled_active_content"
        | "invalid_relationship_owner" => domain_types::XlsxDiagnosticContinuation::ExportFailed,
        _ => domain_types::XlsxDiagnosticContinuation::ExportContinuedWithSemanticChangeWarning,
    }
}

fn package_diagnostic_owner(part: Option<&str>) -> domain_types::XlsxPackageOwnerId {
    let Some(part) = part else {
        return domain_types::XlsxPackageOwnerId::UnknownInertPackageData;
    };
    let part = domain_types::normalize_package_path(part);
    if part == "xl/vbaProject.bin"
        || part.starts_with("xl/activeX/")
        || part.starts_with("_xmlsignatures/")
    {
        domain_types::XlsxPackageOwnerId::ActiveContent
    } else if part.starts_with("xl/externalLinks/") || part == "xl/connections.xml" {
        domain_types::XlsxPackageOwnerId::ExternalLinks
    } else if part.starts_with("xl/printerSettings/") {
        domain_types::XlsxPackageOwnerId::PrinterSettings
    } else if part.starts_with("xl/pivot") {
        domain_types::XlsxPackageOwnerId::Pivots
    } else {
        domain_types::XlsxPackageOwnerId::UnknownInertPackageData
    }
}

fn owner_rels_path_from_part(owner_part: &str) -> String {
    let normalized = domain_types::normalize_package_path(owner_part);
    if let Some((dir, file)) = normalized.rsplit_once('/') {
        format!("{dir}/_rels/{file}.rels")
    } else {
        format!("_rels/{normalized}.rels")
    }
}

fn build_opaque_package_part_hints(
    result: &FullParseResult,
    raw_parts: Vec<(String, Vec<u8>)>,
) -> Vec<domain_types::OpaquePackagePartHint> {
    let mut relationship_sidecars: HashMap<String, Vec<domain_types::PackageRelationshipHint>> =
        result
            .package_inventory
            .as_ref()
            .map(crate::infra::opc_inventory::relationships_by_owner)
            .unwrap_or_default()
            .into_iter()
            .map(|(owner, relationships)| {
                (
                    owner,
                    relationships
                        .into_iter()
                        .map(|relationship| domain_types::PackageRelationshipHint {
                            id: relationship.id,
                            relationship_type: relationship.relationship_type,
                            target: relationship.target,
                            target_mode: relationship.target_mode,
                        })
                        .collect(),
                )
            })
            .collect();
    let mut part_bytes = Vec::<(String, Vec<u8>)>::new();

    for (path, bytes) in raw_parts {
        let normalized = domain_types::normalize_package_path(&path);
        if normalized.ends_with(".rels") && normalized.contains("/_rels/") {
            if let Some(owner) = crate::infra::opc::relationship_owner_from_rels_path(&normalized) {
                relationship_sidecars.insert(
                    owner,
                    parse_all_rels(&bytes)
                        .into_iter()
                        .map(domain_types::PackageRelationshipHint::from)
                        .collect(),
                );
            }
        } else if package_part_is_forbidden_active_content(&normalized) {
            continue;
        } else {
            part_bytes.push((normalized, bytes));
        }
    }

    part_bytes
        .into_iter()
        .map(|(path, bytes)| {
            let content_type = package_content_type_for_path(result, &path);
            let relationships = relationship_sidecars.remove(&path).unwrap_or_default();
            domain_types::OpaquePackagePartHint {
                path,
                bytes,
                content_type,
                relationships,
            }
        })
        .collect()
}

fn package_part_is_forbidden_active_content(path: &str) -> bool {
    matches!(
        crate::write::package_ownership::auxiliary_package_part_policy(path),
        Some(crate::write::package_ownership::AuxiliaryPackagePartPolicy::ActiveForbidden)
    )
}

fn build_raw_doc_props_hints(result: &FullParseResult) -> Vec<domain_types::RawDocPropsHint> {
    let mut hints = Vec::new();
    let properties = document_properties_from_result(result);
    if let (Some(bytes), Some(properties)) =
        (result.raw_doc_props_core_xml.clone(), properties.as_ref())
    {
        hints.push(domain_types::RawDocPropsHint {
            path: "docProps/core.xml".to_string(),
            bytes,
            generated_at_import: crate::domain::metadata::write::write_core_props_xml(properties),
        });
    }
    if let Some(bytes) = result.raw_doc_props_app_xml.clone()
        && (result.doc_props_app.is_some() || properties.is_some())
    {
        hints.push(domain_types::RawDocPropsHint {
            path: "docProps/app.xml".to_string(),
            bytes,
            generated_at_import: crate::domain::metadata::write::write_app_props_xml(
                result.doc_props_app.as_ref(),
            ),
        });
    }
    if let (Some(bytes), Some(properties)) =
        (result.raw_doc_props_custom_xml.clone(), properties.as_ref())
    {
        if !properties.custom.is_empty() || !properties.typed_custom.is_empty() {
            hints.push(domain_types::RawDocPropsHint {
                path: "docProps/custom.xml".to_string(),
                bytes,
                generated_at_import: crate::domain::metadata::write::write_custom_props_xml(
                    properties,
                ),
            });
        }
    }
    hints
}

fn document_properties_from_result(
    result: &FullParseResult,
) -> Option<domain_types::DocumentProperties> {
    (result.doc_props_core.is_some() || result.doc_props_custom.is_some()).then(|| {
        let core = result.doc_props_core.as_ref();
        let typed_custom: Vec<_> = result.doc_props_custom.clone().unwrap_or_default();
        domain_types::DocumentProperties {
            title: core.and_then(|core| core.title.clone()),
            creator: core.and_then(|core| core.creator.clone()),
            description: core.and_then(|core| core.description.clone()),
            identifier: core.and_then(|core| core.identifier.clone()),
            language: core.and_then(|core| core.language.clone()),
            subject: core.and_then(|core| core.subject.clone()),
            created: core.and_then(|core| core.created.clone()),
            modified: core.and_then(|core| core.modified.clone()),
            last_modified_by: core.and_then(|core| core.last_modified_by.clone()),
            category: core.and_then(|core| core.category.clone()),
            keywords: core.and_then(|core| core.keywords.clone()),
            content_status: core.and_then(|core| core.content_status.clone()),
            content_type: core.and_then(|core| core.content_type.clone()),
            last_printed: core.and_then(|core| core.last_printed.clone()),
            revision: core.and_then(|core| core.revision.clone()),
            version: core.and_then(|core| core.version.clone()),
            custom: typed_custom
                .iter()
                .map(|prop| (prop.name.clone(), prop.value.as_legacy_string()))
                .collect(),
            typed_custom,
        }
    })
}

fn package_content_type_for_path(result: &FullParseResult, path: &str) -> Option<String> {
    let normalized = domain_types::normalize_package_path(path);
    result
        .content_type_overrides
        .iter()
        .find(|(part_name, _)| domain_types::normalize_package_path(part_name) == normalized)
        .map(|(_, content_type)| content_type.clone())
        .or_else(|| {
            normalized.rsplit_once('.').and_then(|(_, extension)| {
                result
                    .content_type_defaults
                    .iter()
                    .find(|(default_extension, _)| {
                        default_extension.eq_ignore_ascii_case(extension)
                    })
                    .map(|(_, content_type)| content_type.clone())
            })
        })
}

const REL_WEB_EXTENSION_TASKPANES: &str =
    "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes";
const REL_WEB_EXTENSION: &str =
    "http://schemas.microsoft.com/office/2011/relationships/webextension";
const CT_WEB_EXTENSION_TASKPANES: &str = "application/vnd.ms-office.webextensiontaskpanes+xml";
const CT_WEB_EXTENSION: &str = "application/vnd.ms-office.webextension+xml";

fn append_webextension_cluster_diagnostic(metadata: &mut domain_types::PackageFidelityMetadata) {
    if !metadata.opaque_parts.iter().any(|part| {
        domain_types::normalize_package_path(&part.path).starts_with("xl/webextensions/")
    }) {
        return;
    }

    let (code, message, part) = match webextension_cluster_drop_reason(metadata) {
        None => (
            "webextensionClusterPreservedQuarantined",
            "Preserved Office webextension taskpane package cluster as inert quarantined package data",
            Some("xl/webextensions/taskpanes.xml".to_string()),
        ),
        Some(reason) => reason,
    };

    metadata
        .diagnostics
        .push(domain_types::PackageFidelityDiagnostic {
            code: code.to_string(),
            message: message.to_string(),
            part,
            relationship_id: None,
        });
}

fn webextension_cluster_drop_reason(
    metadata: &domain_types::PackageFidelityMetadata,
) -> Option<(&'static str, &'static str, Option<String>)> {
    let parts: std::collections::HashMap<String, &domain_types::OpaquePackagePartHint> = metadata
        .opaque_parts
        .iter()
        .filter_map(|part| {
            let path = domain_types::normalize_package_path(&part.path);
            path.starts_with("xl/webextensions/")
                .then_some((path, part))
        })
        .collect();

    let has_root_relationship = metadata.root_relationships.iter().any(|hint| {
        hint.relationship_type == REL_WEB_EXTENSION_TASKPANES
            && hint
                .target_mode
                .as_deref()
                .map(|mode| !mode.eq_ignore_ascii_case("External"))
                .unwrap_or(true)
            && crate::infra::opc::resolve_relationship_target(None, &hint.target)
                .ok()
                .is_some_and(|target| {
                    domain_types::normalize_package_path(&target)
                        == "xl/webextensions/taskpanes.xml"
                })
    });
    if !has_root_relationship {
        return Some((
            "webextensionClusterDroppedMissingRootRelationship",
            "Dropped Office webextension taskpane package cluster because the root taskpanes relationship was missing",
            None,
        ));
    }

    let Some(taskpanes) = parts.get("xl/webextensions/taskpanes.xml") else {
        return Some((
            "webextensionClusterDroppedMissingTaskpanesPart",
            "Dropped Office webextension taskpane package cluster because taskpanes.xml was missing",
            Some("xl/webextensions/taskpanes.xml".to_string()),
        ));
    };
    if taskpanes.content_type.as_deref() != Some(CT_WEB_EXTENSION_TASKPANES) {
        return Some((
            "webextensionClusterDroppedMissingContentType",
            "Dropped Office webextension taskpane package cluster because taskpanes.xml did not have the required content type",
            Some("xl/webextensions/taskpanes.xml".to_string()),
        ));
    }

    for hint in &taskpanes.relationships {
        if hint.relationship_type != REL_WEB_EXTENSION {
            continue;
        }
        if hint
            .target_mode
            .as_deref()
            .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
        {
            continue;
        }
        let Ok(target) = crate::infra::opc::resolve_relationship_target(
            Some("xl/webextensions/taskpanes.xml"),
            &hint.target,
        ) else {
            return Some((
                "webextensionClusterDroppedUnsafeInternalTarget",
                "Dropped Office webextension taskpane package cluster because a taskpane relationship target could not be resolved safely",
                Some("xl/webextensions/taskpanes.xml".to_string()),
            ));
        };
        let target = domain_types::normalize_package_path(&target);
        if !target.starts_with("xl/webextensions/") {
            return Some((
                "webextensionClusterDroppedUnsafeInternalTarget",
                "Dropped Office webextension taskpane package cluster because an internal taskpane target escaped xl/webextensions",
                Some(target),
            ));
        }
        let Some(part) = parts.get(&target) else {
            return Some((
                "webextensionClusterDroppedMissingReferencedPart",
                "Dropped Office webextension taskpane package cluster because a referenced webextension part was missing",
                Some(target),
            ));
        };
        if part.content_type.as_deref() != Some(CT_WEB_EXTENSION) {
            return Some((
                "webextensionClusterDroppedMissingContentType",
                "Dropped Office webextension taskpane package cluster because a referenced webextension part did not have the required content type",
                Some(target),
            ));
        }
    }

    None
}
