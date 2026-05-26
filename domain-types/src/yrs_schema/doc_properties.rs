//! Yrs schema for [`DocumentProperties`] — flat Y.Map.

use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::properties::DocumentProperties;

// ─── Key constants ──────────────────────────────────────────────────────────

pub const KEY_TITLE: &str = "title";
pub const KEY_CREATOR: &str = "creator";
pub const KEY_DESCRIPTION: &str = "description";
pub const KEY_SUBJECT: &str = "subject";
pub const KEY_CREATED: &str = "created";
pub const KEY_MODIFIED: &str = "modified";
pub const KEY_LAST_MODIFIED_BY: &str = "lastModifiedBy";
pub const KEY_CATEGORY: &str = "category";
pub const KEY_KEYWORDS: &str = "keywords";
pub const KEY_CUSTOM: &str = "custom";

// ─── to_yrs_prelim ─────────────────────────────────────────────────────────

/// Convert a [`DocumentProperties`] to Yrs prelim entries for initial hydration.
pub fn to_yrs_prelim(props: &DocumentProperties) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_TITLE, option_string(&props.title)),
        (KEY_CREATOR, option_string(&props.creator)),
        (KEY_DESCRIPTION, option_string(&props.description)),
        (KEY_SUBJECT, option_string(&props.subject)),
        (KEY_CREATED, option_string(&props.created)),
        (KEY_MODIFIED, option_string(&props.modified)),
        (KEY_LAST_MODIFIED_BY, option_string(&props.last_modified_by)),
        (KEY_CATEGORY, option_string(&props.category)),
        (KEY_KEYWORDS, option_string(&props.keywords)),
    ];
    if !props.custom.is_empty() {
        entries.push((KEY_CUSTOM, json_any(&props.custom)));
    }
    entries
}

// ─── from_yrs_map ───────────────────────────────────────────────────────────

/// Read a [`DocumentProperties`] from a Y.Map.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> DocumentProperties {
    DocumentProperties {
        title: read_string(map, txn, KEY_TITLE),
        creator: read_string(map, txn, KEY_CREATOR),
        description: read_string(map, txn, KEY_DESCRIPTION),
        subject: read_string(map, txn, KEY_SUBJECT),
        created: read_string(map, txn, KEY_CREATED),
        modified: read_string(map, txn, KEY_MODIFIED),
        last_modified_by: read_string(map, txn, KEY_LAST_MODIFIED_BY),
        category: read_string(map, txn, KEY_CATEGORY),
        keywords: read_string(map, txn, KEY_KEYWORDS),
        custom: read_json(map, txn, KEY_CUSTOM).unwrap_or_default(),
    }
}

/// Update a single field on an existing document properties Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}
