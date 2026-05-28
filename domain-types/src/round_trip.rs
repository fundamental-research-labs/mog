//! Round-trip preservation types.
//!
//! Field ownership and deprecation policy is recorded in
//! `round_trip_field_inventory.md` next to this module.

use serde::{Deserialize, Serialize};

/// Opaque XLSX preservation data for import/export round-tripping.
///
/// Hard invariant: this context is only for OOXML/package data that the Mog
/// engine cannot interpret or mutate. If Mog has a domain type for a concept,
/// import must lower it into that domain type and export must regenerate the
/// OOXML/package graph from domain state.
///
/// This context must never be the source of truth for engine-mutated workbook
/// semantics, modeled XML parts, content types, or relationships. Preserved
/// blobs are valid only for opaque subgraphs whose owner parts are also outside
/// Mog's mutation surface.
///
/// Relationship IDs, part names, and ordering from imported XLSX files may be
/// kept as non-authoritative hints only. They must not decide whether modeled
/// parts exist in the exported package.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundTripContext {
    pub sheets: Vec<SheetRoundTripContext>,

    /// Explicit clean opaque package subgraphs that may be emitted verbatim.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opaque_package_subgraphs: Vec<OpaquePackageSubgraph>,

    /// Namespace declarations from the `<workbook>` root element.
    /// Each entry is (prefix, uri). Used to reconstruct `mc:Ignorable` and
    /// other extension namespace attrs for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_namespace_attrs: Vec<(String, String)>,
    /// Preserved unknown XML elements from `workbook.xml` as raw XML strings.
    /// Each entry is (position_key, raw_xml) where position_key encodes
    /// the insertion point (e.g., "first:workbook", "after:workbook:fileVersion").
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workbook_preserved_elements: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetRoundTripContext {
    /// Worksheet relationship metadata used only by owner-specific import
    /// lowering for clean opaque subgraphs.
    ///
    /// Sheet relationships must not be replayed as package authority. Export
    /// derives relationships from modeled parts plus explicit clean
    /// `opaque_package_subgraphs`; this list may only identify the original
    /// target of an owned opaque package part while constructing those
    /// subgraphs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_opc_rels: Vec<OpcRelationship>,
    /// Compatibility input only. Comment VML and header/footer image VML may
    /// seed modeled/owned outputs, but stale raw VML must not emit by itself.
    #[serde(default)]
    pub raw_vml_drawings: Vec<VmlDrawingPart>,
    pub legacy_drawing_r_id: Option<String>,
    pub legacy_drawing_hf_r_id: Option<String>,
    #[serde(default)]
    pub comments_root_namespace_attrs: Vec<(String, String)>,
    /// Original comment author list from the parsed comments XML.
    /// Preserved for round-trip fidelity — the reconstruction from domain types
    /// only includes authors referenced by actual comments, dropping unused authors.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comment_authors: Vec<String>,
    /// Raw `<extLst>...</extLst>` XML from the worksheet.
    /// Unknown worksheet extensions only. Known modeled extension owners such
    /// as x14 data validations, conditional formatting, and sparklines are not
    /// replayed from this raw sidecar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
    /// Preserved namespace declarations from the `<worksheet>` root element.
    /// Each entry is (prefix, uri). Used to reconstruct `mc:Ignorable` and
    /// other non-standard namespace attrs for round-trip fidelity.
    #[serde(default)]
    pub preserved_namespace_attrs: Vec<(String, String)>,
    /// Immediate parse-output sidecar for worksheet-level custom property refs.
    ///
    /// These refs are not semantic workbook state and must not be persisted in
    /// document round-trip sidecars. The XLSX parser may populate this for the
    /// same import/export operation; serialized documents drop it.
    #[serde(skip)]
    pub custom_properties_xml: Option<String>,
    /// Preserved unknown XML elements from the worksheet as raw XML strings.
    /// Each entry is (position_key, raw_xml) — same format as `workbook_preserved_elements`.
    /// Captures elements like `<sheetPr>` with `<tabColor>` that the parser doesn't model.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_preserved_elements: Vec<(String, String)>,
    /// Raw XML of drawing anchors with content-level `mc:AlternateContent` (e.g., ChartEx).
    /// Each entry is (original_anchor_index, raw_xml) where the index is the position within
    /// the original drawing's anchor list. Used to preserve anchor ordering during round-trip.
    /// The raw_xml is the entire `<xdr:twoCellAnchor>...</xdr:twoCellAnchor>` element.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_anchor_passthroughs: Vec<(usize, String)>,
    /// Clean-imported DrawingML package part and optional relationship sidecar.
    ///
    /// Relationship topology alone is not enough: preserving the sheet
    /// relationship requires preserving or regenerating the target drawing part
    /// as well.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_drawing: Option<ImportedDrawingPart>,
    /// Original drawing root namespace declarations from `<xdr:wsDr>`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_root_namespace_attrs: Vec<(String, String)>,
    /// Original drawing ZIP path when the worksheet relationship identifies it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_drawing_path: Option<String>,
    /// Original OPC relationships from the drawing .rels file.
    /// Used with `add_with_id` to preserve original relationship IDs for chart/chartEx references.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub drawing_opc_rels: Vec<OpcRelationship>,
    /// Whether a drawing .rels file existed in the original archive (even if empty).
    /// Some XLSX files contain empty `<Relationships/>` rels files that must be preserved.
    #[serde(default)]
    pub has_drawing_rels_file: bool,
}

/// A named binary blob part (path + bytes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlobPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaquePackageOwner {
    #[default]
    Root,
    Workbook,
    Worksheet {
        index: usize,
        path: String,
    },
    Part {
        path: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaquePackageOwnership {
    #[default]
    CleanImported,
    DirtyImported,
    Generated,
    Deleted,
    OrphanCleanPackageData,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpaqueRelationshipTarget {
    InternalPart { path: String },
    InternalPath { target: String },
    External { target: String },
}

impl Default for OpaqueRelationshipTarget {
    fn default() -> Self {
        Self::InternalPath {
            target: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackageRelationship {
    pub owner: OpaquePackageOwner,
    pub relationship_type: String,
    pub target: OpaqueRelationshipTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackagePart {
    pub part: BlobPart,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_extension: Option<(String, String)>,
    #[serde(default)]
    pub ownership: OpaquePackageOwnership,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaquePackageSubgraph {
    pub owner: OpaquePackageOwner,
    pub owner_relationship: OpaquePackageRelationship,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<OpaquePackagePart>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<OpaquePackageRelationship>,
    #[serde(default)]
    pub ownership: OpaquePackageOwnership,
}

/// A clean-imported worksheet DrawingML part with its optional `.rels` sidecar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportedDrawingPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rels: Option<BlobPart>,
}

/// VML drawing part with optional relationships file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VmlDrawingPart {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
    pub rels: Option<VmlRels>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VmlRels {
    pub path: String,
    #[serde(with = "bytes_serde")]
    pub data: Vec<u8>,
}

/// OPC relationship entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpcRelationship {
    pub id: String,
    pub rel_type: String,
    pub target: String,
    pub target_mode: Option<String>,
}

// WorkbookView has moved to domain::workbook (strongly-typed, with From<BookView>).

// Helper modules for Vec<u8> serialization as base64
mod bytes_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(bytes: &Vec<u8>, s: S) -> Result<S::Ok, S::Error> {
        // Serialize as array of numbers for JSON compatibility
        bytes.serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        Vec::<u8>::deserialize(d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_round_trip_context_omits_optional_fields() {
        let json = serde_json::to_value(RoundTripContext {
            sheets: vec![SheetRoundTripContext::default()],
            ..Default::default()
        })
        .unwrap();

        let object = json.as_object().unwrap();
        assert!(!object.contains_key("workbookNamespaceAttrs"));
        assert!(!object.contains_key("workbookPreservedElements"));
        let sheet = object["sheets"].as_array().unwrap()[0].as_object().unwrap();
        assert!(!sheet.contains_key("sheetOpcRels"));
    }
}
