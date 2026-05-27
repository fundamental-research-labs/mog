//! Writer-side OPC package graph construction.
//!
//! The graph records emitted parts and relationships before XML writers render
//! relationship IDs. Existing ZIP assembly can consume the resolved graph while
//! feature writers migrate off ad-hoc relationship/content-type construction.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::relationships::{Relationship, RelationshipManager};
use super::write_error::{PackageIntegrityIssue, WriteError};
use super::{
    CONTENT_TYPE_CTRL_PROP, CT_CHART, CT_COMMENTS, CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES,
    CT_DRAWING, CT_EMF, CT_EXTENDED_PROPERTIES, CT_GIF, CT_JPEG, CT_METADATA, CT_PIVOT_CACHE,
    CT_PIVOT_TABLE, CT_PNG, CT_SHARED_STRINGS, CT_STYLES, CT_TABLE, CT_THEME, CT_WMF, CT_WORKBOOK,
    CT_WORKSHEET, REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CORE_PROPERTIES, REL_CTRL_PROP,
    REL_CUSTOM_PROPERTIES, REL_DRAWING, REL_EXTENDED_PROPERTIES, REL_EXTERNAL_LINK, REL_HYPERLINK,
    REL_METADATA, REL_OFFICE_DOCUMENT, REL_PIVOT_CACHE, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS,
    REL_SHARED_STRINGS, REL_STYLES, REL_TABLE, REL_THEME, REL_THREADED_COMMENT, REL_VML_DRAWING,
    REL_WORKSHEET,
};
use crate::domain::content_types::write::{
    CT_CHART_COLOR_STYLE, CT_CHART_STYLE, ContentTypesManager,
};
use domain_types::{
    OpaquePackageOwner, OpaquePackageOwnership, OpaquePackageSubgraph, OpaqueRelationshipTarget,
    RoundTripContext,
};

pub type PackagePartPath = String;
pub type RelationshipOwnerPath = String;

const CT_PIVOT_CACHE_RECORDS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml";
const REL_PIVOT_CACHE_RECORDS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords";
const REL_PIVOT_CACHE_DEFINITION: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition";
const CT_THREADED_COMMENTS: &str = "application/vnd.ms-excel.threadedcomments+xml";
const CT_VML_DRAWING: &str = "application/vnd.openxmlformats-officedocument.vmlDrawing";
const CT_DOC_METADATA_LABEL_INFO: &str = "application/vnd.ms-office.classificationlabels+xml";
const CT_CHART_EX: &str = "application/vnd.ms-office.chartex+xml";
const REL_IMAGE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const CT_WORKSHEET_CUSTOM_PROPERTY: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty+xml";
const REL_WORKSHEET_CUSTOM_PROPERTY: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty";

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PackageOwner {
    Root,
    Workbook,
    Worksheet { index: usize, path: String },
    Part { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackagePartKind {
    Modeled,
    OpaqueClean,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpaquePackageOwnershipState {
    Clean,
    Dirty,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackagePart {
    pub path: String,
    pub content_type: Option<String>,
    pub default_extension: Option<(String, String)>,
    pub kind: PackagePartKind,
    pub bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageRelationshipTarget {
    InternalPart { path: PackagePartPath },
    InternalPath { target: String },
    External { target: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationshipIdentityHint {
    pub id: String,
}

impl RelationshipIdentityHint {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageRelationship {
    pub owner: PackageOwner,
    pub relationship_type: String,
    pub target: PackageRelationshipTarget,
    pub identity_hint: Option<RelationshipIdentityHint>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPackageRelationship {
    pub owner_rels_path: String,
    pub id: String,
    pub relationship_type: String,
    pub target: String,
    pub target_mode: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedPackageGraph {
    parts: BTreeMap<String, PackagePart>,
    relationships: Vec<ResolvedPackageRelationship>,
}

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
            if matches!(part.kind, PackagePartKind::OpaqueClean) && part.bytes.is_none() {
                errors.push(PackageIntegrityIssue::MissingOpaquePartBytes {
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
        for part in self.parts.values() {
            if let Some((extension, content_type)) = &part.default_extension {
                content_types.add_default(extension, content_type);
            }
            if let Some(content_type) = &part.content_type {
                content_types.add_override(&part.path, content_type);
            }
        }
    }

    pub fn contains_part(&self, path: &str) -> bool {
        self.parts.contains_key(&normalize_part_path(path))
    }

    pub fn raw_opaque_parts(&self) -> impl Iterator<Item = (&str, &[u8])> {
        self.parts.values().filter_map(|part| {
            if matches!(part.kind, PackagePartKind::OpaqueClean) {
                part.bytes
                    .as_deref()
                    .map(|bytes| (part.path.as_str(), bytes))
            } else {
                None
            }
        })
    }

    pub fn opaque_relationship_parts(&self) -> Vec<(String, Vec<u8>)> {
        let opaque_owner_rels_paths: HashSet<_> = self
            .parts
            .values()
            .filter(|part| matches!(part.kind, PackagePartKind::OpaqueClean))
            .map(|part| {
                owner_rels_path(&PackageOwner::Part {
                    path: part.path.clone(),
                })
            })
            .collect();
        let mut rels_paths: Vec<_> = self
            .relationships
            .iter()
            .filter(|rel| opaque_owner_rels_paths.contains(&rel.owner_rels_path))
            .map(|rel| rel.owner_rels_path.clone())
            .collect();
        rels_paths.sort();
        rels_paths.dedup();

        rels_paths
            .into_iter()
            .map(|rels_path| {
                let relationships: Vec<_> = self
                    .relationships
                    .iter()
                    .filter(|rel| rel.owner_rels_path == rels_path)
                    .map(|rel| Relationship {
                        id: rel.id.clone(),
                        rel_type: rel.relationship_type.clone(),
                        target: rel.target.clone(),
                        target_mode: rel.target_mode.clone(),
                    })
                    .collect();
                (
                    rels_path,
                    RelationshipManager::from_relationships(relationships).to_xml(),
                )
            })
            .collect()
    }
}

pub fn part_relationships_path(part_path: &str) -> String {
    owner_rels_path(&PackageOwner::Part {
        path: normalize_part_path(part_path),
    })
}

#[derive(Debug, Default)]
pub struct PackageGraphBuilder {
    parts: BTreeMap<String, PackagePart>,
    relationships: Vec<PackageRelationship>,
}

#[derive(Debug, Clone, Copy)]
pub struct ModeledWorkbookGraphOptions {
    pub sheet_count: usize,
    pub has_theme: bool,
    pub has_shared_strings: bool,
    pub has_core_props: bool,
    pub has_app_props: bool,
    pub has_custom_props: bool,
    pub has_metadata: bool,
    pub has_persons: bool,
    pub has_doc_metadata_label_info: bool,
}

impl PackageGraphBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_part(&mut self, part: PackagePart) -> Result<(), WriteError> {
        if matches!(part.kind, PackagePartKind::OpaqueClean) {
            return Err(WriteError::PackageIntegrity(
                "opaque package parts must be registered with explicit ownership state".to_string(),
            ));
        }
        self.register_part_inner(part)
    }

    pub fn register_opaque_part(
        &mut self,
        mut part: PackagePart,
        ownership: OpaquePackageOwnershipState,
    ) -> Result<(), WriteError> {
        if !matches!(ownership, OpaquePackageOwnershipState::Clean) {
            return Err(WriteError::PackageIntegrity(format!(
                "dirty opaque package part cannot be emitted without modeling: {}",
                part.path
            )));
        }
        part.kind = PackagePartKind::OpaqueClean;
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

    pub fn add_opaque_relationship(
        &mut self,
        relationship: PackageRelationship,
        ownership: OpaquePackageOwnershipState,
    ) -> Result<(), WriteError> {
        if !matches!(ownership, OpaquePackageOwnershipState::Clean) {
            return Err(WriteError::PackageIntegrity(
                "dirty opaque package relationship cannot be emitted without modeling".to_string(),
            ));
        }
        self.add_relationship(relationship);
        Ok(())
    }

    pub fn register_opaque_subgraph(
        &mut self,
        subgraph: &OpaquePackageSubgraph,
    ) -> Result<(), WriteError> {
        if !emits_opaque_ownership(subgraph.ownership) {
            return Ok(());
        }

        if subgraph.ownership == OpaquePackageOwnership::CleanImported {
            self.add_opaque_relationship(
                package_relationship_from_opaque(&subgraph.owner_relationship),
                OpaquePackageOwnershipState::Clean,
            )?;
        }
        for part in &subgraph.parts {
            if !emits_opaque_ownership(part.ownership) {
                continue;
            }
            self.register_opaque_part(
                PackagePart {
                    path: normalize_part_path(&part.part.path),
                    content_type: part.content_type.clone(),
                    default_extension: part.default_extension.clone(),
                    kind: PackagePartKind::OpaqueClean,
                    bytes: Some(part.part.data.clone()),
                },
                OpaquePackageOwnershipState::Clean,
            )?;
        }
        if matches!(
            subgraph.ownership,
            OpaquePackageOwnership::CleanImported | OpaquePackageOwnership::OrphanCleanPackageData
        ) {
            for relationship in &subgraph.relationships {
                self.add_opaque_relationship(
                    package_relationship_from_opaque(relationship),
                    OpaquePackageOwnershipState::Clean,
                )?;
            }
        }
        Ok(())
    }

    pub fn resolve(self) -> Result<ResolvedPackageGraph, WriteError> {
        let mut used_ids_by_owner: HashMap<String, HashSet<String>> = HashMap::new();
        let mut next_id_by_owner: HashMap<String, u32> = HashMap::new();
        let mut relationships = Vec::with_capacity(self.relationships.len());

        for relationship in &self.relationships {
            validate_internal_target_is_registered(relationship, &self.parts)?;
            let owner_rels_path = owner_rels_path(&relationship.owner);
            let id = allocate_relationship_id(
                &owner_rels_path,
                relationship
                    .identity_hint
                    .as_ref()
                    .map(|hint| hint.id.as_str()),
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
        })
    }
}

pub fn build_modeled_workbook_graph_builder(
    options: ModeledWorkbookGraphOptions,
    round_trip_ctx: Option<&RoundTripContext>,
) -> Result<PackageGraphBuilder, WriteError> {
    let mut graph = PackageGraphBuilder::new();

    register_modeled_workbook_graph(&mut graph, options, round_trip_ctx)?;
    Ok(graph)
}

pub fn build_modeled_workbook_graph(
    options: ModeledWorkbookGraphOptions,
    round_trip_ctx: Option<&RoundTripContext>,
) -> Result<ResolvedPackageGraph, WriteError> {
    let mut graph = PackageGraphBuilder::new();

    register_modeled_workbook_graph(&mut graph, options, round_trip_ctx)?;

    graph.resolve()
}

fn register_modeled_workbook_graph(
    graph: &mut PackageGraphBuilder,
    options: ModeledWorkbookGraphOptions,
    round_trip_ctx: Option<&RoundTripContext>,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part("xl/workbook.xml", CT_WORKBOOK))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Root,
        relationship_type: REL_OFFICE_DOCUMENT.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/workbook.xml".to_string(),
        },
        identity_hint: root_relationship_hint(
            round_trip_ctx,
            REL_OFFICE_DOCUMENT,
            "/xl/workbook.xml",
        ),
    });

    for sheet_idx in 0..options.sheet_count {
        let path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
        graph.register_part(modeled_part(&path, CT_WORKSHEET))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: REL_WORKSHEET.to_string(),
            target: PackageRelationshipTarget::InternalPart { path },
            identity_hint: sheet_relationship_hint(round_trip_ctx, options.sheet_count, sheet_idx),
        });
    }

    graph.register_part(modeled_part("xl/styles.xml", CT_STYLES))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_STYLES.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/styles.xml".to_string(),
        },
        identity_hint: workbook_relationship_hint(round_trip_ctx, REL_STYLES, "styles.xml"),
    });

    if options.has_theme {
        graph.register_part(modeled_part("xl/theme/theme1.xml", CT_THEME))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: REL_THEME.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "xl/theme/theme1.xml".to_string(),
            },
            identity_hint: workbook_relationship_hint(
                round_trip_ctx,
                REL_THEME,
                "theme/theme1.xml",
            ),
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
            identity_hint: workbook_relationship_hint(
                round_trip_ctx,
                REL_SHARED_STRINGS,
                "sharedStrings.xml",
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
            identity_hint: root_relationship_hint(
                round_trip_ctx,
                REL_CORE_PROPERTIES,
                "/docProps/core.xml",
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
            identity_hint: root_relationship_hint(
                round_trip_ctx,
                REL_EXTENDED_PROPERTIES,
                "/docProps/app.xml",
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
            identity_hint: root_relationship_hint(
                round_trip_ctx,
                REL_CUSTOM_PROPERTIES,
                "/docProps/custom.xml",
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
            identity_hint: workbook_relationship_hint(round_trip_ctx, REL_METADATA, "metadata.xml"),
        });
    }
    if options.has_persons {
        graph.register_part(modeled_part(
            "xl/persons/person.xml",
            "application/vnd.ms-excel.person+xml",
        ))?;
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: super::REL_PERSON.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "xl/persons/person.xml".to_string(),
            },
            identity_hint: workbook_relationship_hint(
                round_trip_ctx,
                super::REL_PERSON,
                "persons/person.xml",
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
        bytes: None,
    }
}

pub fn register_workbook_external_link(
    graph: &mut PackageGraphBuilder,
    part_name: &str,
    identity_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = normalize_external_link_part_path(part_name);
    graph.register_part(modeled_part(
        &path,
        crate::domain::external::write::CT_EXTERNAL_LINK,
    ))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_EXTERNAL_LINK.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: identity_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_external_link_relationship(
    graph: &mut PackageGraphBuilder,
    part_name: &str,
    relationship_type: &str,
    target: &str,
    identity_hint: Option<&str>,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_external_link_part_path(part_name),
        },
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::External {
            target: target.to_string(),
        },
        identity_hint: identity_hint.map(RelationshipIdentityHint::new),
    });
}

pub fn register_generated_pivot_cache(
    graph: &mut PackageGraphBuilder,
    global_idx: usize,
) -> Result<(), WriteError> {
    let definition_path = format!("xl/pivotCache/pivotCacheDefinition{global_idx}.xml");
    let records_path = format!("xl/pivotCache/pivotCacheRecords{global_idx}.xml");
    graph.register_part(modeled_part(&definition_path, CT_PIVOT_CACHE))?;
    graph.register_part(modeled_part(&records_path, CT_PIVOT_CACHE_RECORDS))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_PIVOT_CACHE.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: definition_path.clone(),
        },
        identity_hint: None,
    });
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: definition_path,
        },
        relationship_type: REL_PIVOT_CACHE_RECORDS.to_string(),
        target: PackageRelationshipTarget::InternalPart { path: records_path },
        identity_hint: None,
    });
    Ok(())
}

pub fn register_worksheet_table(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    global_idx: usize,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = format!("xl/tables/table{global_idx}.xml");
    graph.register_part(modeled_part(&path, CT_TABLE))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        },
        relationship_type: REL_TABLE.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_worksheet_drawing(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    drawing_path: &str,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(drawing_path, CT_DRAWING))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_DRAWING.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: drawing_path.to_string(),
        },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_chart(
    graph: &mut PackageGraphBuilder,
    global_idx: usize,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(
        &format!("xl/charts/chart{global_idx}.xml"),
        CT_CHART,
    ))
}

pub fn register_chart_ex(
    graph: &mut PackageGraphBuilder,
    global_idx: usize,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(
        &format!("xl/charts/chartEx{global_idx}.xml"),
        CT_CHART_EX,
    ))
}

pub fn register_chart_auxiliary_part(
    graph: &mut PackageGraphBuilder,
    path: &str,
) -> Result<(), WriteError> {
    let Some(content_type) = chart_auxiliary_content_type(path) else {
        return Ok(());
    };
    graph.register_part(modeled_part(path, content_type))
}

pub fn is_supported_chart_auxiliary_part(path: &str) -> bool {
    chart_auxiliary_content_type(path).is_some()
}

fn chart_auxiliary_content_type(path: &str) -> Option<&'static str> {
    if path.contains("style") {
        Some(CT_CHART_STYLE)
    } else if path.contains("colors") || path.contains("color") {
        Some(CT_CHART_COLOR_STYLE)
    } else {
        None
    }
}

pub fn register_chart_auxiliary_relationship(
    graph: &mut PackageGraphBuilder,
    chart_path: &str,
    relationship_type: &str,
    target_path: &str,
    relationship_id_hint: &str,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_part_path(chart_path),
        },
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(target_path),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

pub fn register_media_part(graph: &mut PackageGraphBuilder, path: &str) -> Result<(), WriteError> {
    let extension = path
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_else(|| "png".to_string());
    let content_type = match extension.as_str() {
        "png" => CT_PNG.to_string(),
        "jpg" | "jpeg" => CT_JPEG.to_string(),
        "gif" => CT_GIF.to_string(),
        "bmp" => "image/bmp".to_string(),
        "tif" | "tiff" => "image/tiff".to_string(),
        "emf" => CT_EMF.to_string(),
        "wmf" => CT_WMF.to_string(),
        other => format!("image/{other}"),
    };
    graph.register_part(PackagePart {
        path: normalize_part_path(path),
        content_type: None,
        default_extension: Some((extension, content_type)),
        kind: PackagePartKind::Modeled,
        bytes: None,
    })
}

pub fn register_drawing_chart_relationship(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    chart_path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    register_drawing_relationship(
        graph,
        drawing_path,
        REL_CHART,
        chart_path,
        relationship_id_hint,
    )
}

pub fn register_drawing_chart_ex_relationship(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    chart_ex_path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    register_drawing_relationship(
        graph,
        drawing_path,
        REL_CHART_EX,
        chart_ex_path,
        relationship_id_hint,
    )
}

pub fn register_drawing_image_relationship(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    image_path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    register_drawing_relationship(
        graph,
        drawing_path,
        REL_IMAGE,
        image_path,
        relationship_id_hint,
    )
}

pub fn register_part_image_relationship(
    graph: &mut PackageGraphBuilder,
    owner_path: &str,
    image_path: &str,
    relationship_id_hint: &str,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_part_path(owner_path),
        },
        relationship_type: REL_IMAGE.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(image_path),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

fn register_drawing_relationship(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    relationship_type: &str,
    target_path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_part_path(drawing_path),
        },
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(target_path),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
    Ok(())
}

pub fn register_worksheet_hyperlink(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    target: &str,
    relationship_id_hint: &str,
) {
    let target = if target.starts_with('#') {
        PackageRelationshipTarget::InternalPath {
            target: target.to_string(),
        }
    } else {
        PackageRelationshipTarget::External {
            target: target.to_string(),
        }
    };
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_HYPERLINK.to_string(),
        target,
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

pub fn register_worksheet_control_property(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    global_idx: usize,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    let path = format!("xl/ctrlProps/ctrlProp{global_idx}.xml");
    graph.register_part(modeled_part(&path, CONTENT_TYPE_CTRL_PROP))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_CTRL_PROP.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
    Ok(())
}

pub fn register_worksheet_custom_property(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(path, CT_WORKSHEET_CUSTOM_PROPERTY))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_WORKSHEET_CUSTOM_PROPERTY.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(path),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
    Ok(())
}

pub fn register_worksheet_printer_settings(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    path: &str,
    relationship_id_hint: &str,
) {
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_PRINTER_SETTINGS.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: path.to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

pub fn register_worksheet_comments(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    comments_path: &str,
    comments_relationship_id_hint: Option<&str>,
    vml_path: &str,
    vml_relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(comments_path, CT_COMMENTS))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_COMMENTS.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: comments_path.to_string(),
        },
        identity_hint: comments_relationship_id_hint.map(RelationshipIdentityHint::new),
    });

    graph.register_part(PackagePart {
        path: normalize_part_path(vml_path),
        content_type: None,
        default_extension: Some(("vml".to_string(), CT_VML_DRAWING.to_string())),
        kind: PackagePartKind::Modeled,
        bytes: None,
    })?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_VML_DRAWING.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: vml_path.to_string(),
        },
        identity_hint: vml_relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_worksheet_vml_drawing(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    vml_path: &str,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(PackagePart {
        path: normalize_part_path(vml_path),
        content_type: None,
        default_extension: Some(("vml".to_string(), CT_VML_DRAWING.to_string())),
        kind: PackagePartKind::Modeled,
        bytes: None,
    })?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_VML_DRAWING.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: vml_path.to_string(),
        },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_worksheet_threaded_comments(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    threaded_comments_path: &str,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(threaded_comments_path, CT_THREADED_COMMENTS))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_THREADED_COMMENT.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: threaded_comments_path.to_string(),
        },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_generated_worksheet_pivot_table(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    global_idx: usize,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = format!("xl/pivotTables/pivotTable{global_idx}.xml");
    graph.register_part(modeled_part(&path, CT_PIVOT_TABLE))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_PIVOT_TABLE.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_generated_pivot_table_cache_relationship(
    graph: &mut PackageGraphBuilder,
    pivot_table_global_idx: usize,
    cache_definition_global_idx: usize,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: format!("xl/pivotTables/pivotTable{pivot_table_global_idx}.xml"),
        },
        relationship_type: REL_PIVOT_CACHE_DEFINITION.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: format!("xl/pivotCache/pivotCacheDefinition{cache_definition_global_idx}.xml"),
        },
        identity_hint: Some(RelationshipIdentityHint::new("rId1")),
    });
}

pub fn register_preserved_worksheet_pivot_table(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    relationship_target: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_PIVOT_TABLE.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_worksheet_child_target(sheet_idx, relationship_target)?,
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
    Ok(())
}

pub fn register_preserved_workbook_pivot_cache(
    graph: &mut PackageGraphBuilder,
    relationship_target: &str,
    relationship_id_hint: &str,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_PIVOT_CACHE.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_workbook_child_target(relationship_target),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

fn worksheet_owner(sheet_idx: usize) -> PackageOwner {
    PackageOwner::Worksheet {
        index: sheet_idx,
        path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
    }
}

fn normalize_external_link_part_path(part_name: &str) -> String {
    let trimmed = normalize_part_path(part_name);
    if trimmed.starts_with("xl/") {
        trimmed
    } else {
        format!("xl/{trimmed}")
    }
}

fn normalize_worksheet_child_target(sheet_idx: usize, target: &str) -> Result<String, WriteError> {
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
    crate::infra::opc::resolve_relationship_target(Some(&owner_path), target)
        .map(|path| normalize_part_path(&path))
        .map_err(|err| {
            WriteError::PackageIntegrity(format!(
                "invalid worksheet relationship target for sheet {}: {} ({:?})",
                sheet_idx + 1,
                target,
                err
            ))
        })
}

fn normalize_workbook_child_target(target: &str) -> String {
    let trimmed = normalize_part_path(target);
    if trimmed.starts_with("xl/") {
        trimmed
    } else {
        format!("xl/{trimmed}")
    }
}

fn root_relationship_hint(
    round_trip_ctx: Option<&RoundTripContext>,
    relationship_type: &str,
    target: &str,
) -> Option<RelationshipIdentityHint> {
    round_trip_ctx
        .and_then(|ctx| {
            ctx.root_relationships.iter().find(|rel| {
                rel.rel_type == relationship_type
                    && rel.target_mode.is_none()
                    && relationship_target_matches(None, &rel.target, target)
            })
        })
        .map(|rel| RelationshipIdentityHint::new(&rel.id))
}

fn workbook_relationship_hint(
    round_trip_ctx: Option<&RoundTripContext>,
    relationship_type: &str,
    target: &str,
) -> Option<RelationshipIdentityHint> {
    round_trip_ctx
        .and_then(|ctx| {
            ctx.workbook_relationships.iter().find(|rel| {
                rel.rel_type == relationship_type
                    && rel.target_mode.is_none()
                    && relationship_target_matches(Some("xl/workbook.xml"), &rel.target, target)
            })
        })
        .map(|rel| RelationshipIdentityHint::new(&rel.id))
}

fn sheet_relationship_hint(
    round_trip_ctx: Option<&RoundTripContext>,
    sheet_count: usize,
    sheet_idx: usize,
) -> Option<RelationshipIdentityHint> {
    round_trip_ctx
        .filter(|ctx| ctx.sheet_workbook_r_ids.len() == sheet_count)
        .and_then(|ctx| {
            let r_id = ctx.sheet_workbook_r_ids.get(sheet_idx)?;
            let generated_target = format!("worksheets/sheet{}.xml", sheet_idx + 1);
            ctx.workbook_relationships.iter().find(|rel| {
                rel.id == *r_id
                    && rel.rel_type == REL_WORKSHEET
                    && rel.target_mode.is_none()
                    && relationship_target_matches(
                        Some("xl/workbook.xml"),
                        &rel.target,
                        &generated_target,
                    )
            })
        })
        .map(|rel| RelationshipIdentityHint::new(&rel.id))
}

fn relationship_target_matches(owner_path: Option<&str>, original: &str, generated: &str) -> bool {
    original == generated
        || normalize_relationship_target(owner_path, original)
            == normalize_relationship_target(owner_path, generated)
}

fn normalize_relationship_target(owner_path: Option<&str>, target: &str) -> Option<String> {
    let part = target.split_once('#').map_or(target, |(part, _)| part);
    crate::infra::opc::resolve_relationship_target(owner_path, part).ok()
}

fn allocate_relationship_id(
    owner_rels_path: &str,
    hinted_id: Option<&str>,
    used_ids_by_owner: &mut HashMap<String, HashSet<String>>,
    next_id_by_owner: &mut HashMap<String, u32>,
) -> String {
    let used = used_ids_by_owner
        .entry(owner_rels_path.to_string())
        .or_default();
    let next_id = next_id_by_owner
        .entry(owner_rels_path.to_string())
        .or_insert(1);

    if let Some(hinted_id) = hinted_id
        && used.insert(hinted_id.to_string())
    {
        bump_next_id(next_id, hinted_id);
        return hinted_id.to_string();
    }

    loop {
        let id = format!("rId{}", *next_id);
        *next_id += 1;
        if used.insert(id.clone()) {
            return id;
        }
    }
}

fn bump_next_id(next_id: &mut u32, id: &str) {
    if let Some(num_str) = id.strip_prefix("rId")
        && let Ok(num) = num_str.parse::<u32>()
        && num >= *next_id
    {
        *next_id = num + 1;
    }
}

fn resolve_target(
    owner: &PackageOwner,
    target: &PackageRelationshipTarget,
) -> Result<(String, Option<String>), WriteError> {
    match target {
        PackageRelationshipTarget::InternalPath { target } => Ok((target.clone(), None)),
        PackageRelationshipTarget::External { target } => {
            Ok((target.clone(), Some("External".to_string())))
        }
        PackageRelationshipTarget::InternalPart { path } => {
            let target = match owner {
                PackageOwner::Root => format!("/{}", normalize_part_path(path)),
                PackageOwner::Workbook => relative_target("xl/workbook.xml", path)?,
                PackageOwner::Worksheet {
                    path: owner_path, ..
                }
                | PackageOwner::Part { path: owner_path } => relative_target(owner_path, path)?,
            };
            Ok((target, None))
        }
    }
}

fn relative_target(owner_path: &str, target_path: &str) -> Result<String, WriteError> {
    let owner_path = normalize_part_path(owner_path);
    let target_path = normalize_part_path(target_path);
    let owner_dir = owner_path.rsplit_once('/').map_or("", |(dir, _)| dir);
    Ok(relative_path(owner_dir, &target_path))
}

fn relative_path(from_dir: &str, to_path: &str) -> String {
    let from_components: Vec<_> = from_dir
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let to_components: Vec<_> = to_path.split('/').filter(|part| !part.is_empty()).collect();
    let common = from_components
        .iter()
        .zip(&to_components)
        .take_while(|(a, b)| a == b)
        .count();
    let mut result = vec![".."; from_components.len() - common];
    result.extend(to_components[common..].iter().copied());
    result.join("/")
}

fn owner_rels_path(owner: &PackageOwner) -> RelationshipOwnerPath {
    match owner {
        PackageOwner::Root => "_rels/.rels".to_string(),
        PackageOwner::Workbook => "xl/_rels/workbook.xml.rels".to_string(),
        PackageOwner::Worksheet { path, .. } | PackageOwner::Part { path } => {
            let path = normalize_part_path(path);
            if let Some((dir, file)) = path.rsplit_once('/') {
                format!("{}/_rels/{}.rels", dir, file)
            } else {
                format!("_rels/{}.rels", path)
            }
        }
    }
}

fn normalize_part_path(path: &str) -> String {
    path.trim_start_matches('/').to_string()
}

fn emits_opaque_ownership(ownership: OpaquePackageOwnership) -> bool {
    matches!(
        ownership,
        OpaquePackageOwnership::CleanImported | OpaquePackageOwnership::OrphanCleanPackageData
    )
}

fn package_owner_from_opaque(owner: &OpaquePackageOwner) -> PackageOwner {
    match owner {
        OpaquePackageOwner::Root => PackageOwner::Root,
        OpaquePackageOwner::Workbook => PackageOwner::Workbook,
        OpaquePackageOwner::Worksheet { index, path } => PackageOwner::Worksheet {
            index: *index,
            path: normalize_part_path(path),
        },
        OpaquePackageOwner::Part { path } => PackageOwner::Part {
            path: normalize_part_path(path),
        },
    }
}

fn package_relationship_from_opaque(
    relationship: &domain_types::OpaquePackageRelationship,
) -> PackageRelationship {
    PackageRelationship {
        owner: package_owner_from_opaque(&relationship.owner),
        relationship_type: relationship.relationship_type.clone(),
        target: match &relationship.target {
            OpaqueRelationshipTarget::InternalPart { path } => {
                PackageRelationshipTarget::InternalPart {
                    path: normalize_part_path(path),
                }
            }
            OpaqueRelationshipTarget::InternalPath { target } => {
                PackageRelationshipTarget::InternalPath {
                    target: target.clone(),
                }
            }
            OpaqueRelationshipTarget::External { target } => PackageRelationshipTarget::External {
                target: target.clone(),
            },
        },
        identity_hint: relationship
            .relationship_id_hint
            .as_ref()
            .map(RelationshipIdentityHint::new),
    }
}

fn validate_internal_target_is_registered(
    relationship: &PackageRelationship,
    parts: &BTreeMap<String, PackagePart>,
) -> Result<(), WriteError> {
    if let PackageRelationshipTarget::InternalPart { path } = &relationship.target {
        let normalized = normalize_part_path(path);
        if !parts.contains_key(&normalized) {
            return Err(WriteError::PackageIntegrity(format!(
                "relationship target is not an emitted package part: {}",
                normalized
            )));
        }
    }
    Ok(())
}

fn validate_required_content_type(part: &PackagePart, errors: &mut Vec<PackageIntegrityIssue>) {
    let Some(expected) = required_content_type_for_modeled_part(&part.path) else {
        return;
    };
    if part.content_type.as_deref() != Some(expected) {
        errors.push(PackageIntegrityIssue::MissingRequiredContentType {
            part_path: part.path.clone(),
            expected_content_type: expected.to_string(),
        });
    }
}

fn validate_modeled_part_owner_relationship(
    part: &PackagePart,
    relationships: &[ResolvedPackageRelationship],
    errors: &mut Vec<PackageIntegrityIssue>,
) {
    if !matches!(part.kind, PackagePartKind::Modeled) {
        return;
    }
    let Some(required) = required_owner_relationship_for_modeled_part(&part.path) else {
        return;
    };
    let found = relationships.iter().any(|rel| {
        required
            .rels_path
            .as_deref()
            .is_none_or(|rels_path| rel.owner_rels_path == rels_path)
            && rel.relationship_type == required.relationship_type
            && rel.target_mode.as_deref() != Some("External")
            && relationship_target_part_path(&rel.owner_rels_path, &rel.target)
                .ok()
                .flatten()
                .as_deref()
                == Some(part.path.as_str())
    });
    if !found {
        errors.push(PackageIntegrityIssue::MissingRequiredRelationship {
            rels_path: required.rels_path.unwrap_or_else(|| "*".to_string()),
            relationship_type: required.relationship_type.to_string(),
            target_path: part.path.clone(),
        });
    }
}

struct RequiredRelationship {
    rels_path: Option<String>,
    relationship_type: &'static str,
}

fn required_owner_relationship_for_modeled_part(path: &str) -> Option<RequiredRelationship> {
    let workbook_rels = "xl/_rels/workbook.xml.rels";

    if path == "xl/workbook.xml" {
        return Some(RequiredRelationship {
            rels_path: Some("_rels/.rels".to_string()),
            relationship_type: REL_OFFICE_DOCUMENT,
        });
    }
    if path == "docProps/core.xml" {
        return Some(RequiredRelationship {
            rels_path: Some("_rels/.rels".to_string()),
            relationship_type: REL_CORE_PROPERTIES,
        });
    }
    if path == "docProps/app.xml" {
        return Some(RequiredRelationship {
            rels_path: Some("_rels/.rels".to_string()),
            relationship_type: REL_EXTENDED_PROPERTIES,
        });
    }
    if path == "docProps/custom.xml" {
        return Some(RequiredRelationship {
            rels_path: Some("_rels/.rels".to_string()),
            relationship_type: REL_CUSTOM_PROPERTIES,
        });
    }
    if path.starts_with("xl/worksheets/sheet") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_WORKSHEET,
        });
    }
    if path == "xl/sharedStrings.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_SHARED_STRINGS,
        });
    }
    if path == "xl/styles.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_STYLES,
        });
    }
    if path == "xl/theme/theme1.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_THEME,
        });
    }
    if path == "xl/metadata.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_METADATA,
        });
    }
    if path == "xl/persons/person.xml" {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: super::REL_PERSON,
        });
    }
    if path.starts_with("xl/externalLinks/externalLink") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_EXTERNAL_LINK,
        });
    }
    if path.starts_with("xl/pivotCache/pivotCacheDefinition") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: Some(workbook_rels.to_string()),
            relationship_type: REL_PIVOT_CACHE,
        });
    }
    if let Some(relationship_type) = relationship_type_for_worksheet_child(path) {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type,
        });
    }
    if path.starts_with("xl/charts/chartEx") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: REL_CHART_EX,
        });
    }
    if path.starts_with("xl/charts/chart") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: REL_CHART,
        });
    }
    if path.starts_with("xl/charts/style") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: "http://schemas.microsoft.com/office/2011/relationships/chartStyle",
        });
    }
    if path.starts_with("xl/charts/color") && path.ends_with(".xml") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle",
        });
    }
    if path.starts_with("xl/media/") {
        return Some(RequiredRelationship {
            rels_path: None,
            relationship_type: REL_IMAGE,
        });
    }
    if path.starts_with("xl/pivotCache/pivotCacheRecords") && path.ends_with(".xml") {
        let idx = path
            .trim_start_matches("xl/pivotCache/pivotCacheRecords")
            .trim_end_matches(".xml");
        return Some(RequiredRelationship {
            rels_path: Some(format!(
                "xl/pivotCache/_rels/pivotCacheDefinition{idx}.xml.rels"
            )),
            relationship_type: REL_PIVOT_CACHE_RECORDS,
        });
    }

    None
}

fn required_content_type_for_modeled_part(path: &str) -> Option<&'static str> {
    if path == "xl/workbook.xml" {
        Some(CT_WORKBOOK)
    } else if path.starts_with("xl/worksheets/sheet") && path.ends_with(".xml") {
        Some(CT_WORKSHEET)
    } else if path == "xl/sharedStrings.xml" {
        Some(CT_SHARED_STRINGS)
    } else if path == "xl/styles.xml" {
        Some(CT_STYLES)
    } else if path == "xl/theme/theme1.xml" {
        Some(CT_THEME)
    } else if path == "docProps/core.xml" {
        Some(CT_CORE_PROPERTIES)
    } else if path == "docProps/app.xml" {
        Some(CT_EXTENDED_PROPERTIES)
    } else if path == "docProps/custom.xml" {
        Some(CT_CUSTOM_PROPERTIES)
    } else if path == "xl/metadata.xml" {
        Some(CT_METADATA)
    } else if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(CT_TABLE)
    } else if path.starts_with("xl/comments") && path.ends_with(".xml") {
        Some(CT_COMMENTS)
    } else if path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml") {
        Some(CT_THREADED_COMMENTS)
    } else if path.starts_with("xl/customProperty/") && path.ends_with(".xml") {
        Some(CT_WORKSHEET_CUSTOM_PROPERTY)
    } else if path.starts_with("xl/drawings/drawing") && path.ends_with(".xml") {
        Some(CT_DRAWING)
    } else if path.starts_with("xl/charts/chartEx") && path.ends_with(".xml") {
        Some(CT_CHART_EX)
    } else if path.starts_with("xl/charts/chart") && path.ends_with(".xml") {
        Some(CT_CHART)
    } else if path.starts_with("xl/charts/style") && path.ends_with(".xml") {
        Some(CT_CHART_STYLE)
    } else if path.starts_with("xl/charts/color") && path.ends_with(".xml") {
        Some(CT_CHART_COLOR_STYLE)
    } else if path.starts_with("xl/ctrlProps/ctrlProp") && path.ends_with(".xml") {
        Some(CONTENT_TYPE_CTRL_PROP)
    } else if path.starts_with("xl/pivotTables/pivotTable") && path.ends_with(".xml") {
        Some(CT_PIVOT_TABLE)
    } else if path.starts_with("xl/pivotCache/pivotCacheDefinition") && path.ends_with(".xml") {
        Some(CT_PIVOT_CACHE)
    } else if path.starts_with("xl/pivotCache/pivotCacheRecords") && path.ends_with(".xml") {
        Some(CT_PIVOT_CACHE_RECORDS)
    } else if path == "docMetadata/LabelInfo.xml" {
        Some(CT_DOC_METADATA_LABEL_INFO)
    } else {
        None
    }
}

fn relationship_type_for_worksheet_child(path: &str) -> Option<&'static str> {
    if path.starts_with("xl/tables/table") && path.ends_with(".xml") {
        Some(REL_TABLE)
    } else if path.starts_with("xl/comments") && path.ends_with(".xml") {
        Some(REL_COMMENTS)
    } else if path.starts_with("xl/threadedComments/threadedComment") && path.ends_with(".xml") {
        Some(REL_THREADED_COMMENT)
    } else if path.starts_with("xl/customProperty/") && path.ends_with(".xml") {
        Some(REL_WORKSHEET_CUSTOM_PROPERTY)
    } else if path.starts_with("xl/drawings/drawing") && path.ends_with(".xml") {
        Some(REL_DRAWING)
    } else if path.starts_with("xl/ctrlProps/ctrlProp") && path.ends_with(".xml") {
        Some(REL_CTRL_PROP)
    } else if path.starts_with("xl/pivotTables/pivotTable") && path.ends_with(".xml") {
        Some(REL_PIVOT_TABLE)
    } else if path.starts_with("xl/printerSettings/printerSettings") && path.ends_with(".bin") {
        Some(REL_PRINTER_SETTINGS)
    } else if path.starts_with("xl/drawings/vmlDrawing") && path.ends_with(".vml") {
        Some(REL_VML_DRAWING)
    } else {
        None
    }
}

fn relationship_target_part_path(
    owner_rels_path: &str,
    target: &str,
) -> Result<Option<String>, String> {
    if target.starts_with('#') {
        return Ok(None);
    }
    let target_part = target.split_once('#').map_or(target, |(part, _)| part);
    if target_part.is_empty() {
        return Ok(None);
    }
    let owner_part = owner_part_path_from_rels_path(owner_rels_path)
        .ok_or_else(|| format!("invalid relationship owner path {owner_rels_path}"))?;
    crate::infra::opc::resolve_relationship_target(owner_part.as_deref(), target_part)
        .map_err(|err| format!("{err:?}"))
        .map(|path| normalize_part_path(&path))
        .map(Some)
}

fn owner_part_path_from_rels_path(owner_rels_path: &str) -> Option<Option<String>> {
    if owner_rels_path == "_rels/.rels" {
        return Some(None);
    }
    let (dir, file) = owner_rels_path.rsplit_once("/_rels/")?;
    let owner_file = file.strip_suffix(".rels")?;
    Some(Some(if dir.is_empty() {
        owner_file.to_string()
    } else {
        format!("{dir}/{owner_file}")
    }))
}

#[cfg(test)]
#[path = "package_graph_tests.rs"]
mod tests;
