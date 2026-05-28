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
        shared_string_table: result.shared_strings_ext_lst_xml.as_ref().map(|xml| {
            domain_types::SharedStringTableFidelity {
                ext_lst_xml: xml.clone(),
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
        raw_doc_props: build_raw_doc_props_hints(result),
        pivot_cache_packages: result.pivot_cache_packages.clone(),
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
