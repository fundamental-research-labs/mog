use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataType {
    pub name: String,
    #[serde(default, skip_serializing_if = "crate::is_zero_u32")]
    pub min_supported_version: u32,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub copy: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_all: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_values: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub merge: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub split_first: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub row_col_shift: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub clear_formats: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub clear_comments: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub assign: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub coerce: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub cell_meta: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub ghost_row: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub ghost_col: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub edit: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub delete: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_formulas: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_formats: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_comments: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_data_validation: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_borders: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_col_widths: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub paste_number_formats: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub split_all: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub clear_all: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub clear_contents: bool,
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub adjust: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FutureMetadataBlock {
    pub raw_xml: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FutureMetadataGroup {
    pub name: String,
    pub blocks: Vec<FutureMetadataBlock>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellMetadataRecord {
    pub t: u32,
    pub v: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellMetadataBlock {
    pub records: Vec<CellMetadataRecord>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueMetadataBlock {
    pub records: Vec<CellMetadataRecord>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichDataPart {
    pub path: String,
    pub content_type: String,
    pub data: Vec<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<ooxml_types::shared::OpcRelationship>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichDataRelatedPart {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookRichData {
    pub parts: Vec<RichDataPart>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related_parts: Vec<RichDataRelatedPart>,
}

impl WorkbookRichData {
    pub fn is_empty(&self) -> bool {
        self.parts.is_empty() && self.related_parts.is_empty()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataCellReference {
    pub sheet_index: u32,
    pub row: u32,
    pub col: u32,
    pub index: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMetadataXml {
    pub bytes: Vec<u8>,
    pub generated_at_import: Vec<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cell_metadata_refs: Vec<MetadataCellReference>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub value_metadata_refs: Vec<MetadataCellReference>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookMetadata {
    pub metadata_types: Vec<MetadataType>,
    pub future_metadata: Vec<FutureMetadataGroup>,
    pub cell_metadata: Vec<CellMetadataBlock>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub value_metadata: Vec<ValueMetadataBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_data: Option<WorkbookRichData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_metadata_xml: Option<ImportedMetadataXml>,
    #[serde(
        default,
        skip_serializing_if = "crate::WorkbookFeatureProperties::is_empty"
    )]
    pub feature_properties: crate::WorkbookFeatureProperties,
}

impl WorkbookMetadata {
    pub fn is_empty(&self) -> bool {
        self.metadata_types.is_empty()
            && self.future_metadata.is_empty()
            && self.cell_metadata.is_empty()
            && self.value_metadata.is_empty()
            && self
                .rich_data
                .as_ref()
                .is_none_or(WorkbookRichData::is_empty)
            && self.imported_metadata_xml.is_none()
            && self.feature_properties.is_empty()
    }
}
