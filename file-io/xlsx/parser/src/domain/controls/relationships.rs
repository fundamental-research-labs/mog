//! Controls relationship resolution.
//!
//! This module keeps controls-specific relationship intent named at the
//! controls boundary while delegating path normalization and relationship type
//! parsing to the shared OPC infrastructure.

use crate::infra::opc::{
    OoxmlRelationshipType, OwnedRelationship, PackageOwner, VmlDrawingRelationships,
    WorksheetRelationships, parse_owned_relationships,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OleEmbeddingKind {
    OleBinary,
    EmbeddedPackage,
}

impl OleEmbeddingKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::OleBinary => "oleObject",
            Self::EmbeddedPackage => "embeddedPackage",
        }
    }
}

pub(crate) fn parse_worksheet_relationships(
    sheet_num: usize,
    rels_xml: &[u8],
) -> Vec<OwnedRelationship> {
    parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        rels_xml,
    )
}

pub(crate) fn ctrl_prop_target<'a>(
    relationships: &'a [OwnedRelationship],
    r_id: &str,
) -> Option<&'a str> {
    typed_worksheet_target(relationships, r_id, OoxmlRelationshipType::CtrlProp)
}

pub(crate) fn ole_embedding_target<'a>(
    relationships: &'a [OwnedRelationship],
    r_id: &str,
) -> Option<(&'a str, OleEmbeddingKind)> {
    WorksheetRelationships::new(relationships)
        .by_id(r_id)
        .and_then(|rel| match rel.rel_type {
            OoxmlRelationshipType::OleObject => rel
                .target
                .path()
                .map(|path| (path, OleEmbeddingKind::OleBinary)),
            OoxmlRelationshipType::EmbeddedPackage => rel
                .target
                .path()
                .map(|path| (path, OleEmbeddingKind::EmbeddedPackage)),
            _ => None,
        })
}

pub(crate) fn legacy_vml_drawing_targets(
    relationships: &[OwnedRelationship],
) -> impl Iterator<Item = &str> {
    WorksheetRelationships::new(relationships)
        .legacy_vml_drawings()
        .into_iter()
        .filter_map(|rel| rel.target.path())
}

pub(crate) fn parse_vml_drawing_relationships(
    vml_path: &str,
    rels_xml: &[u8],
) -> Vec<OwnedRelationship> {
    parse_owned_relationships(
        PackageOwner::VmlDrawing {
            path: vml_path.to_string(),
        },
        rels_xml,
    )
}

pub(crate) fn vml_image_target<'a>(
    relationships: &'a [OwnedRelationship],
    r_id: &str,
) -> Option<&'a str> {
    VmlDrawingRelationships::new(relationships)
        .by_id(r_id)
        .filter(|rel| rel.rel_type == OoxmlRelationshipType::Image)
        .and_then(|rel| rel.target.path())
}

fn typed_worksheet_target<'a>(
    relationships: &'a [OwnedRelationship],
    r_id: &str,
    rel_type: OoxmlRelationshipType,
) -> Option<&'a str> {
    WorksheetRelationships::new(relationships)
        .by_id(r_id)
        .filter(|rel| rel.rel_type == rel_type)
        .and_then(|rel| rel.target.path())
}
