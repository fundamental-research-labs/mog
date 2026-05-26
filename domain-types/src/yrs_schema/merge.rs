//! Yrs schema for [`MergeRegion`] — flat Y.Map with 4 coordinate fields.

use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::MergeRegion;

pub const KEY_START_ROW: &str = "sr";
pub const KEY_START_COL: &str = "sc";
pub const KEY_END_ROW: &str = "er";
pub const KEY_END_COL: &str = "ec";
pub const KEY_ORDER: &str = "ord";
pub const KEY_TOP_LEFT_ID: &str = "tl";
pub const KEY_BOTTOM_RIGHT_ID: &str = "br";

/// Convert a [`MergeRegion`] to Yrs prelim entries for initial hydration.
///
/// Use [`to_yrs_prelim_with_order`] when preserving original file order matters
/// (e.g., XLSX round-trip).
pub fn to_yrs_prelim(region: &MergeRegion) -> Vec<(&str, Any)> {
    vec![
        (KEY_START_ROW, Any::Number(region.start_row as f64)),
        (KEY_START_COL, Any::Number(region.start_col as f64)),
        (KEY_END_ROW, Any::Number(region.end_row as f64)),
        (KEY_END_COL, Any::Number(region.end_col as f64)),
    ]
}

/// Convert a [`MergeRegion`] to Yrs prelim entries with an explicit ordering index.
///
/// The `order` field preserves the original position in the XLSX merge list
/// so that export can reproduce the exact same ordering.
pub fn to_yrs_prelim_with_order(region: &MergeRegion, order: u32) -> Vec<(&str, Any)> {
    vec![
        (KEY_START_ROW, Any::Number(region.start_row as f64)),
        (KEY_START_COL, Any::Number(region.start_col as f64)),
        (KEY_END_ROW, Any::Number(region.end_row as f64)),
        (KEY_END_COL, Any::Number(region.end_col as f64)),
        (KEY_ORDER, Any::Number(order as f64)),
    ]
}

/// Read a [`MergeRegion`] from a Y.Map. Returns `None` if any field is missing.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<MergeRegion> {
    Some(MergeRegion {
        start_row: read_u32(map, txn, KEY_START_ROW)?,
        start_col: read_u32(map, txn, KEY_START_COL)?,
        end_row: read_u32(map, txn, KEY_END_ROW)?,
        end_col: read_u32(map, txn, KEY_END_COL)?,
    })
}

/// Update a single field on an existing MergeRegion Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}
