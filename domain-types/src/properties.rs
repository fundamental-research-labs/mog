use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCustomProperty {
    pub name: String,
    pub value: DocumentCustomPropertyValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum DocumentCustomPropertyValue {
    Lpwstr(String),
    I4(i32),
    R8(f64),
    Bool(bool),
    Filetime(String),
}

impl DocumentCustomPropertyValue {
    pub fn as_legacy_string(&self) -> String {
        match self {
            Self::Lpwstr(value) | Self::Filetime(value) => value.clone(),
            Self::I4(value) => value.to_string(),
            Self::R8(value) => value.to_string(),
            Self::Bool(value) => value.to_string(),
        }
    }
}

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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub typed_custom: Vec<DocumentCustomProperty>,
    pub custom: Vec<(String, String)>,
}
