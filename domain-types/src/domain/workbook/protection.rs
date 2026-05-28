//! Workbook protection settings.

use serde::{Deserialize, Serialize};

// Re-export HashAlgorithm so consumers do not need a direct ooxml_types dependency.
pub use ooxml_types::protection::HashAlgorithm;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookProtection {
    // Lock flags
    pub lock_structure: bool,
    pub lock_windows: bool,
    pub lock_revision: bool,

    // Modern workbook password (SHA-based)
    pub workbook_algorithm_name: HashAlgorithm,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_hash_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_salt_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_spin_count: Option<u32>,

    // Modern revisions password (SHA-based)
    pub revisions_algorithm_name: HashAlgorithm,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_hash_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_salt_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_spin_count: Option<u32>,

    // Legacy passwords (XOR/CRC hash, pre-2007)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_password_character_set: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_password_character_set: Option<String>,
}

impl Default for WorkbookProtection {
    fn default() -> Self {
        Self {
            lock_structure: false,
            lock_windows: false,
            lock_revision: false,
            workbook_algorithm_name: HashAlgorithm::None,
            workbook_hash_value: None,
            workbook_salt_value: None,
            workbook_spin_count: None,
            revisions_algorithm_name: HashAlgorithm::None,
            revisions_hash_value: None,
            revisions_salt_value: None,
            revisions_spin_count: None,
            workbook_password: None,
            workbook_password_character_set: None,
            revisions_password: None,
            revisions_password_character_set: None,
        }
    }
}
