//! Writer-side OPC package graph construction.
//!
//! The graph records emitted parts and relationships before XML writers render
//! relationship IDs. Existing ZIP assembly can consume the resolved graph while
//! feature writers migrate off ad-hoc relationship/content-type construction.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::relationships::{Relationship, RelationshipManager};
use super::write_error::WriteError;
use super::{
    CT_CORE_PROPERTIES, CT_CUSTOM_PROPERTIES, CT_EXTENDED_PROPERTIES, CT_METADATA,
    CT_SHARED_STRINGS, CT_STYLES, CT_THEME, CT_WORKBOOK, CT_WORKSHEET, REL_CORE_PROPERTIES,
    REL_CUSTOM_PROPERTIES, REL_EXTENDED_PROPERTIES, REL_METADATA, REL_OFFICE_DOCUMENT,
    REL_SHARED_STRINGS, REL_STYLES, REL_THEME, REL_WORKSHEET,
};
use crate::domain::content_types::write::ContentTypesManager;
use domain_types::RoundTripContext;

pub type PackagePartPath = String;
pub type RelationshipOwnerPath = String;

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
        RelationshipManager::from_original(
            &relationships
                .iter()
                .map(|rel| ooxml_types::shared::OpcRelationship {
                    id: rel.id.clone(),
                    rel_type: rel.rel_type.clone(),
                    target: rel.target.clone(),
                    target_mode: rel.target_mode.clone(),
                })
                .collect::<Vec<_>>(),
        )
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

    pub fn resolve(self) -> Result<ResolvedPackageGraph, WriteError> {
        let mut used_ids_by_owner: HashMap<String, HashSet<String>> = HashMap::new();
        let mut next_id_by_owner: HashMap<String, u32> = HashMap::new();
        let mut relationships = Vec::with_capacity(self.relationships.len());

        for relationship in &self.relationships {
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

pub fn build_modeled_workbook_graph(
    options: ModeledWorkbookGraphOptions,
    round_trip_ctx: Option<&RoundTripContext>,
) -> Result<ResolvedPackageGraph, WriteError> {
    let mut graph = PackageGraphBuilder::new();

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

    graph.resolve()
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

fn root_relationship_hint(
    round_trip_ctx: Option<&RoundTripContext>,
    relationship_type: &str,
    target: &str,
) -> Option<RelationshipIdentityHint> {
    round_trip_ctx
        .and_then(|ctx| {
            ctx.root_relationships.iter().find(|rel| {
                rel.rel_type == relationship_type
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::{REL_HYPERLINK, REL_STYLES, REL_WORKSHEET};

    #[test]
    fn resolves_workbook_relationship_hints_without_collision() {
        let mut graph = PackageGraphBuilder::new();
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: REL_WORKSHEET.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "xl/worksheets/sheet1.xml".to_string(),
            },
            identity_hint: Some(RelationshipIdentityHint::new("rId7")),
        });
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: REL_STYLES.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: "xl/styles.xml".to_string(),
            },
            identity_hint: Some(RelationshipIdentityHint::new("rId7")),
        });

        let resolved = graph.resolve().unwrap();
        assert_eq!(
            resolved.relationship_id(
                &PackageOwner::Workbook,
                REL_WORKSHEET,
                "worksheets/sheet1.xml"
            ),
            Some("rId7")
        );
        assert_eq!(
            resolved.relationship_id(&PackageOwner::Workbook, REL_STYLES, "styles.xml"),
            Some("rId8")
        );
    }

    #[test]
    fn rejects_duplicate_part_paths_with_different_bytes() {
        let mut graph = PackageGraphBuilder::new();
        let mut part = modeled_part("xl/workbook.xml", "application/xml");
        part.bytes = Some(vec![1]);
        graph.register_part(part).unwrap();
        let mut part = modeled_part("/xl/workbook.xml", "application/xml");
        part.bytes = Some(vec![2]);
        assert!(graph.register_part(part).is_err());
    }

    #[test]
    fn accepts_duplicate_part_paths_only_when_bytes_match() {
        let mut graph = PackageGraphBuilder::new();
        let mut part = modeled_part("xl/workbook.xml", "application/xml");
        part.bytes = Some(vec![1, 2, 3]);
        graph.register_part(part).unwrap();
        let mut part = modeled_part("/xl/workbook.xml", "application/xml");
        part.bytes = Some(vec![1, 2, 3]);
        graph.register_part(part).unwrap();
    }

    #[test]
    fn ignores_sheet_id_hint_when_original_relationship_targets_stale_part() {
        let ctx = RoundTripContext {
            workbook_relationships: vec![domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_WORKSHEET.to_string(),
                target: "worksheets/sheet9.xml".to_string(),
                target_mode: None,
            }],
            sheet_workbook_r_ids: vec!["rId99".to_string()],
            ..Default::default()
        };

        let resolved = build_modeled_workbook_graph(
            ModeledWorkbookGraphOptions {
                sheet_count: 1,
                has_theme: false,
                has_shared_strings: false,
                has_core_props: false,
                has_app_props: false,
                has_custom_props: false,
                has_metadata: false,
                has_persons: false,
            },
            Some(&ctx),
        )
        .unwrap();

        assert_eq!(
            resolved.relationship_id(
                &PackageOwner::Workbook,
                REL_WORKSHEET,
                "worksheets/sheet1.xml"
            ),
            Some("rId1")
        );
    }

    #[test]
    fn reuses_sheet_id_hint_when_original_relationship_targets_same_part() {
        let ctx = RoundTripContext {
            workbook_relationships: vec![domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            }],
            sheet_workbook_r_ids: vec!["rId99".to_string()],
            ..Default::default()
        };

        let resolved = build_modeled_workbook_graph(
            ModeledWorkbookGraphOptions {
                sheet_count: 1,
                has_theme: false,
                has_shared_strings: false,
                has_core_props: false,
                has_app_props: false,
                has_custom_props: false,
                has_metadata: false,
                has_persons: false,
            },
            Some(&ctx),
        )
        .unwrap();

        assert_eq!(
            resolved.relationship_id(
                &PackageOwner::Workbook,
                REL_WORKSHEET,
                "worksheets/sheet1.xml"
            ),
            Some("rId99")
        );
    }

    #[test]
    fn resolves_external_relationships_without_registered_parts() {
        let mut graph = PackageGraphBuilder::new();
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Worksheet {
                index: 0,
                path: "xl/worksheets/sheet1.xml".to_string(),
            },
            relationship_type: REL_HYPERLINK.to_string(),
            target: PackageRelationshipTarget::External {
                target: "https://example.com".to_string(),
            },
            identity_hint: Some(RelationshipIdentityHint::new("rId4")),
        });

        let rels =
            graph
                .resolve()
                .unwrap()
                .relationship_manager_for_owner(&PackageOwner::Worksheet {
                    index: 0,
                    path: "xl/worksheets/sheet1.xml".to_string(),
                });
        let rel = rels.get_by_id("rId4").unwrap();
        assert_eq!(rel.target, "https://example.com");
        assert_eq!(rel.target_mode.as_deref(), Some("External"));
    }

    #[test]
    fn opaque_parts_require_explicit_clean_ownership() {
        let mut graph = PackageGraphBuilder::new();
        let part = PackagePart {
            path: "xl/customXml/item1.xml".to_string(),
            content_type: Some("application/xml".to_string()),
            default_extension: None,
            kind: PackagePartKind::OpaqueClean,
            bytes: Some(b"<root/>".to_vec()),
        };
        assert!(graph.register_part(part.clone()).is_err());
        assert!(
            graph
                .register_opaque_part(part.clone(), OpaquePackageOwnershipState::Dirty)
                .is_err()
        );
        graph
            .register_opaque_part(part, OpaquePackageOwnershipState::Clean)
            .unwrap();
    }

    #[test]
    fn opaque_relationships_require_clean_ownership() {
        let mut graph = PackageGraphBuilder::new();
        let relationship = PackageRelationship {
            owner: PackageOwner::Workbook,
            relationship_type: "opaque-rel".to_string(),
            target: PackageRelationshipTarget::InternalPath {
                target: "../customXml/item1.xml".to_string(),
            },
            identity_hint: Some(RelationshipIdentityHint::new("rId5")),
        };
        assert!(
            graph
                .add_opaque_relationship(relationship.clone(), OpaquePackageOwnershipState::Dirty,)
                .is_err()
        );
        graph
            .add_opaque_relationship(relationship, OpaquePackageOwnershipState::Clean)
            .unwrap();
        assert_eq!(
            graph.resolve().unwrap().relationship_id(
                &PackageOwner::Workbook,
                "opaque-rel",
                "../customXml/item1.xml",
            ),
            Some("rId5")
        );
    }
}
