use super::*;

/// Core document properties from `docProps/core.xml`.
pub type DocPropsCore = domain_types::DocumentProperties;

/// Extended (app) document properties from `docProps/app.xml`.
pub type DocPropsApp = domain_types::ExtendedDocumentProperties;

/// Custom document properties from `docProps/custom.xml`.
pub type DocPropsCustom = Vec<domain_types::DocumentCustomProperty>;

/// A single custom property from `docProps/custom.xml`.
pub type CustomProperty = domain_types::DocumentCustomProperty;

/// Value types for custom document properties.
pub type CustomPropertyValue = domain_types::DocumentCustomPropertyValue;

// =============================================================================
// Metadata types (xl/metadata.xml)
// =============================================================================

/// A single metadata type record from `<metadataTypes>`.
///
/// Defines a metadata type with its name and behavioral flags (copy, paste, merge, etc.).
/// See ECMA-376 Part 1, Section 18.9.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataTypeOutput {
    /// Metadata type name (e.g., "XLDAPR" for dynamic arrays)
    pub name: String,
    /// Minimum supported version
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub min_supported_version: u32,
    /// Copy behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub copy: bool,
    /// Paste-all behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_all: bool,
    /// Paste-values behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_values: bool,
    /// Merge behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub merge: bool,
    /// Split-first behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub split_first: bool,
    /// Row/column shift behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub row_col_shift: bool,
    /// Clear-formats behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub clear_formats: bool,
    /// Clear-comments behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub clear_comments: bool,
    /// Assign behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub assign: bool,
    /// Coerce behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub coerce: bool,
    /// Whether this type applies to cell metadata (vs. value metadata)
    #[serde(default, skip_serializing_if = "is_false")]
    pub cell_meta: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub ghost_row: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub ghost_col: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub edit: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub delete: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_formulas: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_formats: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_comments: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_data_validation: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_borders: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_col_widths: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_number_formats: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub split_all: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub clear_all: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub clear_contents: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub adjust: bool,
}

/// A single block (`<bk>`) within `<futureMetadata>`.
///
/// Since future metadata blocks can contain arbitrary extension XML (e.g., XLDAPR
/// dynamic array properties), we store the raw inner XML of each `<bk>` element
/// to ensure faithful round-trip of unknown extensions.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FutureMetadataBlock {
    /// Raw inner XML content of the `<bk>` element (everything between `<bk>` and `</bk>`).
    pub raw_xml: String,
}

/// A future metadata group from `<futureMetadata>`.
///
/// Each group is associated with a metadata type by name and contains one or more blocks.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FutureMetadataGroup {
    /// Name of the metadata type this group corresponds to (e.g., "XLDAPR")
    pub name: String,
    /// The blocks within this future metadata group
    pub blocks: Vec<FutureMetadataBlock>,
}

/// A single record (`<rc>`) within a cell metadata block.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellMetadataRecord {
    /// Type index (`t` attribute) — 1-based index into `metadataTypes`
    pub t: u32,
    /// Value index (`v` attribute) — 0-based index into the corresponding `futureMetadata` blocks
    pub v: u32,
}

/// A single block (`<bk>`) within `<cellMetadata>`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellMetadataBlock {
    /// Records within this block
    pub records: Vec<CellMetadataRecord>,
}

/// A single block (`<bk>`) within `<valueMetadata>`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueMetadataBlock {
    /// Records within this block
    pub records: Vec<CellMetadataRecord>,
}

/// Parsed metadata from `xl/metadata.xml`.
///
/// This represents the OOXML metadata part (ECMA-376 Part 1, Section 18.9).
/// It stores metadata types, future metadata extension blocks, and cell metadata
/// records referenced by cells via the `cm` attribute.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataOutput {
    /// Metadata type definitions from `<metadataTypes>`
    pub metadata_types: Vec<MetadataTypeOutput>,
    /// Future metadata groups from `<futureMetadata>` elements
    pub future_metadata: Vec<FutureMetadataGroup>,
    /// Cell metadata blocks from `<cellMetadata>`
    pub cell_metadata: Vec<CellMetadataBlock>,
    /// Value metadata blocks from `<valueMetadata>`
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub value_metadata: Vec<ValueMetadataBlock>,
}
