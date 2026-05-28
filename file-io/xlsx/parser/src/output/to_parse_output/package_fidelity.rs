use super::*;

pub(super) fn build_package_fidelity_metadata(
    result: &FullParseResult,
) -> Option<domain_types::PackageFidelityMetadata> {
    let mut metadata = domain_types::PackageFidelityMetadata {
        package_profile: result.package_inventory.as_ref().map(|inventory| {
            domain_types::PackageProfileHint {
                profile: inventory.profile.as_str().to_string(),
                evidence: inventory.profile_evidence.clone(),
            }
        }),
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
        sheet_workbook_r_ids: result.sheet_workbook_r_ids.clone(),
        opaque_parts: Vec::new(),
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
    };

    let mut raw_parts = Vec::<(String, Vec<u8>)>::new();
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

    (!metadata.is_empty()).then_some(metadata)
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
