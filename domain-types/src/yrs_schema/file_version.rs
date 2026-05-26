//! Yrs schema for [`FileVersion`] — flat Y.Map.

use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::workbook::FileVersion;

// ─── Key constants ──────────────────────────────────────────────────────────

pub const KEY_APP_NAME: &str = "appName";
pub const KEY_LAST_EDITED: &str = "lastEdited";
pub const KEY_LOWEST_EDITED: &str = "lowestEdited";
pub const KEY_RUP_BUILD: &str = "rupBuild";
pub const KEY_CODE_NAME: &str = "codeName";

// ─── to_yrs_prelim ─────────────────────────────────────────────────────────

/// Convert a [`FileVersion`] to Yrs prelim entries for initial hydration.
pub fn to_yrs_prelim(fv: &FileVersion) -> Vec<(&str, Any)> {
    vec![
        (KEY_APP_NAME, option_string(&fv.app_name)),
        (KEY_LAST_EDITED, option_string(&fv.last_edited)),
        (KEY_LOWEST_EDITED, option_string(&fv.lowest_edited)),
        (KEY_RUP_BUILD, option_string(&fv.rup_build)),
        (KEY_CODE_NAME, option_string(&fv.code_name)),
    ]
}

// ─── from_yrs_map ───────────────────────────────────────────────────────────

/// Read a [`FileVersion`] from a Y.Map.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> FileVersion {
    FileVersion {
        app_name: read_string(map, txn, KEY_APP_NAME),
        last_edited: read_string(map, txn, KEY_LAST_EDITED),
        lowest_edited: read_string(map, txn, KEY_LOWEST_EDITED),
        rup_build: read_string(map, txn, KEY_RUP_BUILD),
        code_name: read_string(map, txn, KEY_CODE_NAME),
    }
}

/// Update a single field on an existing file version Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}
