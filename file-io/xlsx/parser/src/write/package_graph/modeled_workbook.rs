use domain_types::{PackageFidelityMetadata, XlsxPackagePartKind};

use super::{
    CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES, CT_DOC_METADATA_LABEL_INFO, CT_EXTENDED_PROPERTIES,
    CT_METADATA, CT_SHARED_STRINGS, CT_STYLES, CT_THEME, CT_WORKBOOK, CT_WORKSHEET,
    PackageGraphBuilder, PackageOwner, PackagePart, PackagePartKind, PackageRelationship,
    PackageRelationshipTarget, REL_CORE_PROPERTIES, REL_CUSTOM_PROPERTIES, REL_EXTENDED_PROPERTIES,
    REL_METADATA, REL_OFFICE_DOCUMENT, REL_PERSON, REL_SHARED_STRINGS, REL_STYLES, REL_THEME,
    REL_WORKSHEET, RelationshipIdentityHint, ResolvedPackageGraph,
    imported_relationship_identity_hint, normalize_part_path,
};
use crate::write::write_error::WriteError;

#[derive(Debug, Clone)]
pub struct ModeledWorkbookGraphOptions {
    pub sheet_count: usize,
    pub has_theme: bool,
    pub theme_part_path: Option<String>,
    pub theme_relationship_id_hint: Option<String>,
    pub theme_relationship_type: Option<String>,
    pub has_shared_strings: bool,
    pub has_core_props: bool,
    pub has_app_props: bool,
    pub has_custom_props: bool,
    pub has_metadata: bool,
    pub has_persons: bool,
    pub has_doc_metadata_label_info: bool,
    pub package_fidelity: Option<PackageFidelityMetadata>,
}

pub fn build_modeled_workbook_graph_builder(
    options: ModeledWorkbookGraphOptions,
) -> Result<PackageGraphBuilder, WriteError> {
    let mut graph = PackageGraphBuilder::with_package_fidelity(options.package_fidelity.clone());

    register_modeled_workbook_graph(&mut graph, options)?;
    Ok(graph)
}

pub fn build_modeled_workbook_graph(
    options: ModeledWorkbookGraphOptions,
) -> Result<ResolvedPackageGraph, WriteError> {
    let mut graph = PackageGraphBuilder::with_package_fidelity(options.package_fidelity.clone());

    register_modeled_workbook_graph(&mut graph, options)?;

    graph.resolve()
}

fn register_modeled_workbook_graph(
    graph: &mut PackageGraphBuilder,
    options: ModeledWorkbookGraphOptions,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part("xl/workbook.xml", CT_WORKBOOK))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Root,
        relationship_type: REL_OFFICE_DOCUMENT.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/workbook.xml".to_string(),
        },
        identity_hint: imported_relationship_identity_hint(
            options.package_fidelity.as_ref(),
            &PackageOwner::Root,
            REL_OFFICE_DOCUMENT,
            "xl/workbook.xml",
        ),
    });

    for sheet_idx in 0..options.sheet_count {
        let path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
        graph.register_part(modeled_part(&path, CT_WORKSHEET))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: REL_WORKSHEET.to_string(),
            target: PackageRelationshipTarget::InternalPart { path },
            identity_hint: None,
        });
    }

    graph.register_part(modeled_part("xl/styles.xml", CT_STYLES))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_STYLES.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/styles.xml".to_string(),
        },
        identity_hint: imported_relationship_identity_hint(
            options.package_fidelity.as_ref(),
            &PackageOwner::Workbook,
            REL_STYLES,
            "xl/styles.xml",
        ),
    });

    if options.has_theme {
        let theme_part_path = options
            .theme_part_path
            .as_deref()
            .map(normalize_part_path)
            .unwrap_or_else(|| "xl/theme/theme1.xml".to_string());
        let theme_relationship_type = options
            .theme_relationship_type
            .as_deref()
            .filter(|rel_type| crate::infra::opc::is_theme_relationship_type(rel_type))
            .unwrap_or(REL_THEME);
        graph.register_part(modeled_part(&theme_part_path, CT_THEME))?;
        let identity_hint = options
            .theme_relationship_id_hint
            .as_ref()
            .map(RelationshipIdentityHint::new)
            .or_else(|| {
                imported_relationship_identity_hint(
                    options.package_fidelity.as_ref(),
                    &PackageOwner::Workbook,
                    REL_THEME,
                    &theme_part_path,
                )
            });
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: theme_relationship_type.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: theme_part_path.clone(),
            },
            identity_hint,
        });
    }

    if options.has_shared_strings {
        graph.register_part(modeled_part("xl/sharedStrings.xml", CT_SHARED_STRINGS))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: REL_SHARED_STRINGS.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "xl/sharedStrings.xml".to_string(),
            },
            identity_hint: imported_relationship_identity_hint(
                options.package_fidelity.as_ref(),
                &PackageOwner::Workbook,
                REL_SHARED_STRINGS,
                "xl/sharedStrings.xml",
            ),
        });
    }

    if options.has_core_props {
        graph.register_part(modeled_part("docProps/core.xml", CT_CORE_PROPERTIES))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Root,
            relationship_type: REL_CORE_PROPERTIES.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "docProps/core.xml".to_string(),
            },
            identity_hint: imported_relationship_identity_hint(
                options.package_fidelity.as_ref(),
                &PackageOwner::Root,
                REL_CORE_PROPERTIES,
                "docProps/core.xml",
            ),
        });
    }
    if options.has_app_props {
        graph.register_part(modeled_part("docProps/app.xml", CT_EXTENDED_PROPERTIES))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Root,
            relationship_type: REL_EXTENDED_PROPERTIES.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "docProps/app.xml".to_string(),
            },
            identity_hint: imported_relationship_identity_hint(
                options.package_fidelity.as_ref(),
                &PackageOwner::Root,
                REL_EXTENDED_PROPERTIES,
                "docProps/app.xml",
            ),
        });
    }
    if options.has_custom_props {
        graph.register_part(modeled_part("docProps/custom.xml", CT_CUSTOM_PROPERTIES))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Root,
            relationship_type: REL_CUSTOM_PROPERTIES.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "docProps/custom.xml".to_string(),
            },
            identity_hint: imported_relationship_identity_hint(
                options.package_fidelity.as_ref(),
                &PackageOwner::Root,
                REL_CUSTOM_PROPERTIES,
                "docProps/custom.xml",
            ),
        });
    }
    if options.has_metadata {
        graph.register_part(modeled_part("xl/metadata.xml", CT_METADATA))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: REL_METADATA.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "xl/metadata.xml".to_string(),
            },
            identity_hint: imported_relationship_identity_hint(
                options.package_fidelity.as_ref(),
                &PackageOwner::Workbook,
                REL_METADATA,
                "xl/metadata.xml",
            ),
        });
    }
    if options.has_persons {
        graph.register_part(modeled_part(
            "xl/persons/person.xml",
            "application/vnd.ms-excel.person+xml",
        ))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: REL_PERSON.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "xl/persons/person.xml".to_string(),
            },
            identity_hint: imported_relationship_identity_hint(
                options.package_fidelity.as_ref(),
                &PackageOwner::Workbook,
                REL_PERSON,
                "xl/persons/person.xml",
            ),
        });
    }
    if options.has_doc_metadata_label_info {
        graph.register_part(modeled_part(
            "docMetadata/LabelInfo.xml",
            CT_DOC_METADATA_LABEL_INFO,
        ))?;
    }

    Ok(())
}

pub fn modeled_part(path: &str, content_type: &str) -> PackagePart {
    PackagePart {
        path: normalize_part_path(path),
        content_type: Some(content_type.to_string()),
        default_extension: None,
        kind: PackagePartKind::Modeled,
        semantic_kind: semantic_kind_for_modeled_part(path),
        bytes: None,
    }
}

fn semantic_kind_for_modeled_part(path: &str) -> Option<XlsxPackagePartKind> {
    let path = normalize_part_path(path);
    if path == "xl/workbook.xml" {
        Some(XlsxPackagePartKind::Workbook)
    } else if path.starts_with("xl/worksheets/") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::Worksheet)
    } else if path == "xl/sharedStrings.xml" {
        Some(XlsxPackagePartKind::SharedStrings)
    } else if path == "xl/styles.xml" {
        Some(XlsxPackagePartKind::Styles)
    } else if path.starts_with("xl/theme/") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::Theme)
    } else if path == "xl/metadata.xml" {
        Some(XlsxPackagePartKind::Metadata)
    } else if path.starts_with("xl/charts/chartEx") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::ChartEx)
    } else if path.starts_with("xl/charts/chart") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::Chart)
    } else if path.starts_with("xl/charts/style") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::ChartStyle)
    } else if path.starts_with("xl/charts/color") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::ChartColorStyle)
    } else if path.starts_with("xl/drawings/") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::ChartUserShapes)
    } else if path.starts_with("xl/comments") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::Comments)
    } else if path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::ThreadedComments)
    } else if path.starts_with("xl/tables/tableSingleCells") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::TableSingleCells)
    } else if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::Table)
    } else if path.starts_with("xl/pivotTables/pivotTable") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::PivotTable)
    } else if path.starts_with("xl/pivotCache/pivotCacheDefinition") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::PivotCacheDefinition)
    } else if path.starts_with("xl/pivotCache/pivotCacheRecords") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::PivotCacheRecords)
    } else if path.starts_with("xl/slicers/slicer") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::Slicer)
    } else if path.starts_with("xl/slicerCaches/slicerCache") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::SlicerCache)
    } else if path.starts_with("xl/queryTables/queryTable") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::QueryTable)
    } else if path == "xl/connections.xml" {
        Some(XlsxPackagePartKind::Connections)
    } else if path.starts_with("xl/ctrlProps/ctrlProp") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::ControlProperties)
    } else if path.starts_with("xl/embeddings/") {
        Some(XlsxPackagePartKind::OleObject)
    } else if path.starts_with("xl/externalLinks/externalLink") && path.ends_with(".xml") {
        Some(XlsxPackagePartKind::ExternalLink)
    } else {
        None
    }
}
