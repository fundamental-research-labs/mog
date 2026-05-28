//! Workbook file metadata for round-trip fidelity.

use serde::{Deserialize, Serialize};

// ============================================================================
// File Metadata (round-trip)
// ============================================================================

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_edited: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lowest_edited: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rup_build: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSharing {
    pub read_only_recommended: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reservation_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub algorithm_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub salt_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spin_count: Option<u32>,
}
