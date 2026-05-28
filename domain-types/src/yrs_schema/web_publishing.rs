//! Yrs schema for [`WorkbookWebPublishing`] — flat Y.Map.

use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::workbook::WorkbookWebPublishing;

pub const KEY_CSS: &str = "css";
pub const KEY_THICKET: &str = "thicket";
pub const KEY_LONG_FILE_NAMES: &str = "longFileNames";
pub const KEY_VML: &str = "vml";
pub const KEY_ALLOW_PNG: &str = "allowPng";
pub const KEY_TARGET_SCREEN_SIZE: &str = "targetScreenSize";
pub const KEY_DPI: &str = "dpi";
pub const KEY_CODE_PAGE: &str = "codePage";
pub const KEY_CHARACTER_SET: &str = "characterSet";

pub fn to_yrs_prelim(web: &WorkbookWebPublishing) -> Vec<(&str, Any)> {
    let mut entries = Vec::new();
    if let Some(value) = web.css {
        entries.push((KEY_CSS, Any::Bool(value)));
    }
    if let Some(value) = web.thicket {
        entries.push((KEY_THICKET, Any::Bool(value)));
    }
    if let Some(value) = web.long_file_names {
        entries.push((KEY_LONG_FILE_NAMES, Any::Bool(value)));
    }
    if let Some(value) = web.vml {
        entries.push((KEY_VML, Any::Bool(value)));
    }
    if let Some(value) = web.allow_png {
        entries.push((KEY_ALLOW_PNG, Any::Bool(value)));
    }
    if let Some(value) = web.target_screen_size {
        entries.push((
            KEY_TARGET_SCREEN_SIZE,
            Any::String(Arc::from(value.to_ooxml())),
        ));
    }
    if let Some(value) = web.dpi {
        entries.push((KEY_DPI, Any::Number(value as f64)));
    }
    if let Some(value) = web.code_page {
        entries.push((KEY_CODE_PAGE, Any::Number(value as f64)));
    }
    if let Some(value) = web.character_set.as_ref() {
        entries.push((KEY_CHARACTER_SET, Any::String(Arc::from(value.as_str()))));
    }
    entries
}

pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> WorkbookWebPublishing {
    WorkbookWebPublishing {
        css: read_bool(map, txn, KEY_CSS),
        thicket: read_bool(map, txn, KEY_THICKET),
        long_file_names: read_bool(map, txn, KEY_LONG_FILE_NAMES),
        vml: read_bool(map, txn, KEY_VML),
        allow_png: read_bool(map, txn, KEY_ALLOW_PNG),
        target_screen_size: read_string(map, txn, KEY_TARGET_SCREEN_SIZE)
            .map(|value| ooxml_types::web_publish::TargetScreenSize::from_ooxml(&value)),
        dpi: read_u32(map, txn, KEY_DPI),
        code_page: read_u32(map, txn, KEY_CODE_PAGE),
        character_set: read_string(map, txn, KEY_CHARACTER_SET),
    }
}

pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}
