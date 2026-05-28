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
pub struct WorkbookRichData {
    pub parts: Vec<RichDataPart>,
}

impl WorkbookRichData {
    pub fn is_empty(&self) -> bool {
        self.parts.is_empty()
    }
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
    }
}
