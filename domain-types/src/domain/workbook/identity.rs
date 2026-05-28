//! Mog workbook identity metadata.

use serde::{Deserialize, Serialize};

// ============================================================================
// Mog Workbook Identity Metadata
// ============================================================================

pub const MOG_WORKBOOK_ID_CUSTOM_PROPERTY: &str = "MogWorkbookId";
pub const MOG_WORKBOOK_ID_CUSTOM_XML_SCHEMA: &str = "https://schemas.mog.com/workbook-identity/1";
pub const MOG_WORKBOOK_ID_CUSTOM_XML_REL_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookLineage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicated_from: Option<WorkbookId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copied_from: Option<WorkbookId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MogWorkbookIdentityMetadata {
    pub schema: String,
    pub version: u32,
    pub workbook_id: WorkbookId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lineage: Option<WorkbookLineage>,
}

impl MogWorkbookIdentityMetadata {
    pub fn new(workbook_id: WorkbookId) -> Self {
        Self {
            schema: MOG_WORKBOOK_ID_CUSTOM_XML_SCHEMA.to_string(),
            version: 1,
            workbook_id,
            created_at: None,
            lineage: None,
        }
    }
}
