//! Workbook web publishing settings.

use serde::{Deserialize, Serialize};

// ============================================================================
// Web Publishing
// ============================================================================

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookWebPublishing {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thicket: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_file_names: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vml: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_png: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_screen_size: Option<ooxml_types::web_publish::TargetScreenSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dpi: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub character_set: Option<String>,
}
