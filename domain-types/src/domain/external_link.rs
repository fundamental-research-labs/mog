//! External link domain types.
//!
//! Canonical types for external workbook references, DDE links, and OLE links.
//! Parsed from `xl/externalLinks/externalLinkN.xml` in XLSX files.

use serde::{Deserialize, Serialize};

/// A resolved external link from `xl/externalLinks/externalLinkN.xml`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLink {
    /// Link index (e.g., "1" for externalLink1.xml).
    pub id: String,
    /// Type of external link.
    #[serde(default)]
    pub link_type: ExternalLinkType,
    /// Primary file path/URL (resolved from .rels relationship).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// Alternate URL for the external workbook (from xxl21:alternateUrls extension).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternate_url: Option<String>,
    /// Relative URL (from xxl21:relativeUrl in alternateUrls).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative_url: Option<String>,
    /// Sheet names in the external workbook.
    #[serde(default)]
    pub sheet_names: Vec<String>,
    /// Defined names in the external workbook.
    #[serde(default)]
    pub defined_names: Vec<ExternalDefinedName>,
    /// Cached cell values from the external workbook.
    #[serde(default)]
    pub cache_values: Vec<ExternalCacheValue>,
    /// Sheet IDs in the sheetDataSet (preserves empty sheetData elements).
    #[serde(default)]
    pub sheet_data_ids: Vec<u32>,
    /// Sheet IDs that have `refreshError="1"`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refresh_error_sheet_ids: Vec<u32>,
    /// Original relationship ID order in .rels (None = default order).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rels_id_order: Option<Vec<String>>,
    /// Preserved `mc:Ignorable` value from original XML.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mc_ignorable: Option<String>,
    /// Original relationship type for file_path when non-default (e.g., "xlPathMissing").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path_rel_type: Option<String>,
    /// OneDrive/SharePoint driveId on alternateUrls element.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternate_urls_drive_id: Option<String>,
    /// OneDrive/SharePoint itemId on alternateUrls element.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternate_urls_item_id: Option<String>,
    /// Original rId for the file_path relationship (None = "rId1").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path_rid: Option<String>,
    /// Original rId for the alternate_url relationship (None = "rId2").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternate_url_rid: Option<String>,
    /// Original rId for the relative_url relationship (None = "rId3" or "rId2").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative_url_rid: Option<String>,
    /// Extra relationships not matched by standard rId references (e.g., externalLinkLongPath).
    /// Each entry is (rId, Target, Type).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_rels: Vec<ExternalLinkExtraRel>,
    /// Typed external-link-owned relationships.
    ///
    /// These records are live workbook state. Imported relationship IDs and
    /// order are provenance hints for these records, not a second source of
    /// truth for export.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<ExternalLinkRelationship>,
    /// OOXML package identity captured during import.
    ///
    /// This is the durable mapping from workbook.xml `<externalReference r:id>`
    /// order through `xl/_rels/workbook.xml.rels` to the concrete externalLink
    /// part. Formula ordinal tokens like `[1]` are defined by `excel_ordinal`,
    /// not by the `externalLinkN.xml` file number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_identity: Option<ImportedExternalLinkIdentity>,
    /// Preserved extension-list XML owned by the externalLink part.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

impl ExternalLink {
    /// Create a new empty external link.
    pub fn new(id: String) -> Self {
        Self {
            id,
            ..Default::default()
        }
    }

    /// Create an external workbook link.
    pub fn workbook(id: String, file_path: Option<String>) -> Self {
        Self {
            id,
            link_type: ExternalLinkType::Workbook,
            file_path,
            ..Default::default()
        }
    }

    /// Create a DDE link.
    pub fn dde(id: String, service: String, topic: String) -> Self {
        Self {
            id,
            link_type: ExternalLinkType::Dde {
                service,
                topic,
                items: Vec::new(),
            },
            ..Default::default()
        }
    }

    /// Create an OLE link.
    pub fn ole(id: String, prog_id: String) -> Self {
        Self {
            id,
            link_type: ExternalLinkType::Ole {
                prog_id,
                r_id: None,
                items: Vec::new(),
            },
            ..Default::default()
        }
    }
}

/// Type of external link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
#[derive(Default)]
pub enum ExternalLinkType {
    #[default]
    Workbook,
    Dde {
        service: String,
        topic: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        items: Vec<DdeItem>,
    },
    Ole {
        prog_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        r_id: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        items: Vec<OleItem>,
    },
}

/// DDE item/channel metadata and cached values.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DdeItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub ole: bool,
    #[serde(default)]
    pub advise: bool,
    #[serde(default)]
    pub prefer_pic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub values: Vec<DdeValue>,
}

/// One cached DDE value.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DdeValue {
    #[serde(default)]
    pub value_type: DdeValueType,
    #[serde(default)]
    pub value: String,
}

/// DDE cached value type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DdeValueType {
    Nil,
    Boolean,
    #[default]
    Number,
    Error,
    String,
}

/// OLE item metadata exposed by an OLE link.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OleItem {
    pub name: String,
    #[serde(default)]
    pub icon: bool,
    #[serde(default)]
    pub advise: bool,
    #[serde(default)]
    pub prefer_pic: bool,
}

/// Extra relationship not matched by standard rId references.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkExtraRel {
    pub id: String,
    pub target: String,
    pub rel_type: String,
}

/// A live relationship owned by an `externalLink*.xml` part.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkRelationship {
    /// Stable local source key used by body role bindings. This is distinct
    /// from imported or emitted `rId` values.
    pub source_key: String,
    /// Imported relationship ID, when the current record was reconstructed
    /// from an XLSX package relationship.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_id_hint: Option<String>,
    /// OOXML relationship type URI.
    pub relationship_type: String,
    /// Relationship target as live state.
    pub target: String,
    /// TargetMode from the relationship row. External workbook path
    /// relationships normally use `External`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
    /// Imported order within the owning `.rels` file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    /// Semantic body roles that refer to this relationship.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<ExternalLinkRelationshipRole>,
    /// Currentness decision for imported provenance.
    #[serde(default)]
    pub currentness: ExternalLinkRelationshipCurrentness,
}

/// Semantic use of an external-link-owned relationship.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalLinkRelationshipRole {
    ExternalBook,
    AlternateAbsoluteUrl,
    AlternateRelativeUrl,
    ExtraPath,
}

/// Whether imported provenance is still eligible for reuse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalLinkRelationshipCurrentness {
    #[default]
    Current,
    Regenerated,
    DroppedStale,
    DroppedUnsupported,
}

/// Imported OOXML external-link package identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedExternalLinkIdentity {
    /// 1-based ordinal in workbook.xml `<externalReferences>` order.
    pub excel_ordinal: u32,
    /// Relationship id used by the workbook externalReference element.
    pub workbook_rel_id: String,
    /// Part name as targeted by workbook.xml.rels, e.g.
    /// `externalLinks/externalLink3.xml`.
    pub part_name: String,
    /// r:id from `<externalBook>`, when the link is an external workbook.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_book_rid: Option<String>,
    /// Target from the workbook relationship entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// TargetMode from the workbook relationship entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
}

/// Defined name from an external workbook.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDefinedName {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refers_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<u32>,
}

impl ExternalDefinedName {
    /// Create a new external defined name.
    pub fn new(name: String) -> Self {
        Self {
            name,
            refers_to: None,
            sheet_id: None,
        }
    }

    /// Create with all fields.
    pub fn with_details(name: String, refers_to: Option<String>, sheet_id: Option<u32>) -> Self {
        Self {
            name,
            refers_to,
            sheet_id,
        }
    }
}

/// Cached cell value from an external workbook.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalCacheValue {
    pub sheet_id: u32,
    /// Row number from the `<row r="N">` wrapper.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<u32>,
    pub cell_ref: String,
    pub value: CachedValue,
    /// Raw numeric string for round-trip precision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_value: Option<String>,
    /// Whether the original `<v>` had `xml:space="preserve"`.
    #[serde(default)]
    pub preserve_space: bool,
}

impl ExternalCacheValue {
    /// Create a new cached value.
    pub fn new(sheet_id: u32, cell_ref: String, value: CachedValue) -> Self {
        Self {
            sheet_id,
            row: None,
            cell_ref,
            value,
            raw_value: None,
            preserve_space: false,
        }
    }

    /// Create a new cached value with row information.
    pub fn with_row(sheet_id: u32, row: u32, cell_ref: String, value: CachedValue) -> Self {
        Self {
            sheet_id,
            row: Some(row),
            cell_ref,
            value,
            raw_value: None,
            preserve_space: false,
        }
    }
}

/// Cached value types for external links.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "v")]
#[derive(Default)]
pub enum CachedValue {
    Number(f64),
    String(String),
    Boolean(bool),
    Error(String),
    #[default]
    Empty,
}
