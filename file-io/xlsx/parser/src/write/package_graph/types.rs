use std::collections::BTreeMap;

use domain_types::PackageFidelityMetadata;

pub type PackagePartPath = String;
pub type RelationshipOwnerPath = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RegisteredRelationshipKey(pub(super) usize);

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
    Opaque,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackagePart {
    pub path: String,
    pub content_type: Option<String>,
    pub default_extension: Option<(String, String)>,
    pub kind: PackagePartKind,
    pub semantic_kind: Option<domain_types::XlsxPackagePartKind>,
    pub bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageRelationshipTarget {
    InternalPart {
        path: PackagePartPath,
    },
    InternalPath {
        target: String,
    },
    External {
        target: String,
        target_mode: Option<String>,
    },
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
    pub source_key: RegisteredRelationshipKey,
    pub owner_rels_path: String,
    pub id: String,
    pub relationship_type: String,
    pub target: String,
    pub target_mode: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedPackageGraph {
    pub(super) parts: BTreeMap<String, PackagePart>,
    pub(super) relationships: Vec<ResolvedPackageRelationship>,
    pub(super) package_fidelity: Option<PackageFidelityMetadata>,
}
