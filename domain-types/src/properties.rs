use serde::{Deserialize, Serialize};

/// Core document properties (Dublin Core + Office-specific).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProperties {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub description: Option<String>,
    pub subject: Option<String>,
    /// ISO 8601 timestamp.
    pub created: Option<String>,
    /// ISO 8601 timestamp.
    pub modified: Option<String>,
    pub last_modified_by: Option<String>,
    pub category: Option<String>,
    pub keywords: Option<String>,
    pub custom: Vec<(String, String)>,
}
