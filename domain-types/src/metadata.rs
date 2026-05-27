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
pub struct WorkbookMetadata {
    pub metadata_types: Vec<MetadataType>,
    pub future_metadata: Vec<FutureMetadataGroup>,
    pub cell_metadata: Vec<CellMetadataBlock>,
}

impl WorkbookMetadata {
    pub fn is_empty(&self) -> bool {
        self.metadata_types.is_empty()
            && self.future_metadata.is_empty()
            && self.cell_metadata.is_empty()
    }
}
