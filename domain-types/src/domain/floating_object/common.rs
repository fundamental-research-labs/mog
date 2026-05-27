use serde::{Deserialize, Serialize};

use super::FloatingObjectAnchor;
use crate::ImportObjectStatus;

// ===========================================================================
// SECTION D: FloatingObjectCommon
// ===========================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FloatingObjectCommon {
    pub id: String,
    pub sheet_id: String,
    pub anchor: FloatingObjectAnchor,
    pub width: f64,
    pub height: f64,
    pub z_index: i32,
    pub rotation: f64,
    pub flip_h: bool,
    pub flip_v: bool,
    pub locked: bool,
    pub visible: bool,
    pub printable: bool,
    pub opacity: f64,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_cell_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_anchor_cell_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_aspect_ratio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_text_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_status: Option<ImportObjectStatus>,
}

impl Default for FloatingObjectCommon {
    fn default() -> Self {
        Self {
            id: String::new(),
            sheet_id: String::new(),
            anchor: FloatingObjectAnchor::default(),
            width: 0.0,
            height: 0.0,
            z_index: 0,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            locked: false,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: String::new(),
            created_at: 0,
            updated_at: 0,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            lock_aspect_ratio: None,
            alt_text_title: None,
            display_name: None,
            import_status: None,
        }
    }
}
