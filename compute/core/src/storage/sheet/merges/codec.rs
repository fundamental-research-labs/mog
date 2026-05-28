use std::sync::Arc;

use domain_types::domain::merge::IdentityMergedRegion;
use domain_types::yrs_schema::merge::{
    KEY_BOTTOM_RIGHT_ID, KEY_END_COL, KEY_END_ROW, KEY_ORDER, KEY_START_COL, KEY_START_ROW,
    KEY_TOP_LEFT_ID,
};
use yrs::{Any, MapRef};

/// Y.Map value format for stored merges. Wraps identity with ordering metadata.
/// This is a storage type, not a domain type.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMerge {
    pub top_left_id: String,
    pub bottom_right_id: String,
    /// Original file order index (for XLSX round-trip). None for user-created merges.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ord: Option<u32>,
    /// Resolved positions so export doesn't need Yrs idToPos.
    pub sr: u32,
    pub sc: u32,
    pub er: u32,
    pub ec: u32,
}

impl StoredMerge {
    pub fn to_identity(&self) -> IdentityMergedRegion {
        IdentityMergedRegion {
            top_left_id: self.top_left_id.clone(),
            bottom_right_id: self.bottom_right_id.clone(),
        }
    }
}

/// Serialize a `StoredMerge` to a JSON string (retained for test backward-compat).
#[cfg(test)]
pub(super) fn serialize_merge(merge: &StoredMerge) -> String {
    serde_json::to_string(merge).expect("StoredMerge serialization should not fail")
}

/// Convert a [`StoredMerge`] to Yrs prelim entries for structured Y.Map storage.
pub fn stored_merge_to_yrs_prelim(stored: &StoredMerge) -> Vec<(&str, Any)> {
    let mut entries = vec![
        (KEY_START_ROW, Any::Number(stored.sr as f64)),
        (KEY_START_COL, Any::Number(stored.sc as f64)),
        (KEY_END_ROW, Any::Number(stored.er as f64)),
        (KEY_END_COL, Any::Number(stored.ec as f64)),
        (
            KEY_TOP_LEFT_ID,
            Any::String(Arc::from(stored.top_left_id.as_str())),
        ),
        (
            KEY_BOTTOM_RIGHT_ID,
            Any::String(Arc::from(stored.bottom_right_id.as_str())),
        ),
    ];
    if let Some(ord) = stored.ord {
        entries.push((KEY_ORDER, Any::Number(ord as f64)));
    }
    entries
}

/// Read a [`StoredMerge`] from a Y.Map that contains structured merge data
/// (including cell identity fields `tl` and `br`).
pub(super) fn stored_merge_from_yrs_map<T: yrs::ReadTxn>(
    map: &MapRef,
    txn: &T,
) -> Option<StoredMerge> {
    use domain_types::yrs_schema::helpers::{read_string, read_u32};
    Some(StoredMerge {
        sr: read_u32(map, txn, KEY_START_ROW)?,
        sc: read_u32(map, txn, KEY_START_COL)?,
        er: read_u32(map, txn, KEY_END_ROW)?,
        ec: read_u32(map, txn, KEY_END_COL)?,
        top_left_id: read_string(map, txn, KEY_TOP_LEFT_ID).unwrap_or_default(),
        bottom_right_id: read_string(map, txn, KEY_BOTTOM_RIGHT_ID).unwrap_or_default(),
        ord: read_u32(map, txn, KEY_ORDER),
    })
}
