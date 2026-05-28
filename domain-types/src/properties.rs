use serde::{Deserialize, Serialize};

pub const DEFAULT_CUSTOM_PROPERTY_FMTID: &str = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCustomProperty {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fmtid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_target: Option<String>,
    pub value: DocumentCustomPropertyValue,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum DocumentCustomPropertyValue {
    #[default]
    Empty,
    Null,
    I1(i8),
    I2(i16),
    Lpwstr(String),
    Lpstr(String),
    Bstr(String),
    I4(i32),
    I8(i64),
    Int(i32),
    Ui1(u8),
    Ui2(u16),
    Ui4(u32),
    Ui8(u64),
    Uint(u32),
    R4(f32),
    R8(f64),
    Decimal(String),
    Bool(bool),
    Date(String),
    Filetime(String),
    Cy(String),
    Error(String),
    Clsid(String),
    Blob(String),
    Oblob(String),
    Stream(String),
    Ostream(String),
    Storage(String),
    Ostorage(String),
    Vstream(String),
    Vector(DocumentCustomPropertyVector),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCustomPropertyVector {
    pub base_type: String,
    pub values: Vec<DocumentCustomPropertyValue>,
}

impl DocumentCustomPropertyValue {
    pub fn as_legacy_string(&self) -> String {
        match self {
            Self::Empty | Self::Null => String::new(),
            Self::Lpwstr(value)
            | Self::Lpstr(value)
            | Self::Bstr(value)
            | Self::Date(value)
            | Self::Filetime(value)
            | Self::Decimal(value)
            | Self::Cy(value)
            | Self::Error(value)
            | Self::Clsid(value)
            | Self::Blob(value)
            | Self::Oblob(value)
            | Self::Stream(value)
            | Self::Ostream(value)
            | Self::Storage(value)
            | Self::Ostorage(value)
            | Self::Vstream(value) => value.clone(),
            Self::I1(value) => value.to_string(),
            Self::I2(value) => value.to_string(),
            Self::I4(value) => value.to_string(),
            Self::I8(value) => value.to_string(),
            Self::Int(value) => value.to_string(),
            Self::Ui1(value) => value.to_string(),
            Self::Ui2(value) => value.to_string(),
            Self::Ui4(value) => value.to_string(),
            Self::Ui8(value) => value.to_string(),
            Self::Uint(value) => value.to_string(),
            Self::R4(value) => value.to_string(),
            Self::R8(value) => value.to_string(),
            Self::Bool(value) => value.to_string(),
            Self::Vector(vector) => vector
                .values
                .iter()
                .map(Self::as_legacy_string)
                .collect::<Vec<_>>()
                .join(","),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadingPair {
    pub name: String,
    pub count: u32,
}

/// Extended document properties (`docProps/app.xml`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtendedDocumentProperties {
    pub total_time: Option<String>,
    pub application: Option<String>,
    pub app_version: Option<String>,
    pub doc_security: Option<u32>,
    pub company: Option<String>,
    pub manager: Option<String>,
    pub template: Option<String>,
    pub pages: Option<u32>,
    pub words: Option<u32>,
    pub characters: Option<u32>,
    pub presentation_format: Option<String>,
    pub lines: Option<u32>,
    pub paragraphs: Option<u32>,
    pub slides: Option<u32>,
    pub notes: Option<u32>,
    pub hidden_slides: Option<u32>,
    pub mm_clips: Option<u32>,
    pub characters_with_spaces: Option<u32>,
    pub hyperlink_base: Option<String>,
    pub dig_sig: Option<String>,
    pub scale_crop: Option<bool>,
    pub links_up_to_date: Option<bool>,
    pub shared_doc: Option<bool>,
    pub hyperlinks_changed: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub heading_pairs: Vec<HeadingPair>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub titles_of_parts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hlinks: Vec<String>,
}

/// Core document properties (Dublin Core + Office-specific).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProperties {
    pub title: Option<String>,
    pub creator: Option<String>,
    pub description: Option<String>,
    pub identifier: Option<String>,
    pub language: Option<String>,
    pub subject: Option<String>,
    /// ISO 8601 timestamp.
    pub created: Option<String>,
    /// ISO 8601 timestamp.
    pub modified: Option<String>,
    pub last_modified_by: Option<String>,
    pub category: Option<String>,
    pub keywords: Option<String>,
    pub content_status: Option<String>,
    pub content_type: Option<String>,
    pub last_printed: Option<String>,
    pub revision: Option<String>,
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub typed_custom: Vec<DocumentCustomProperty>,
    /// Legacy string projection retained for existing callers. XLSX export uses
    /// `typed_custom` when present so pid/fmtid/value kind identity survives.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom: Vec<(String, String)>,
}
