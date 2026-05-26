//! Yrs schema for [`FileSharing`] — flat Y.Map.

use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::workbook::FileSharing;

// ─── Key constants ──────────────────────────────────────────────────────────

pub const KEY_READ_ONLY_RECOMMENDED: &str = "readOnlyRecommended";
pub const KEY_USER_NAME: &str = "userName";
pub const KEY_RESERVATION_PASSWORD: &str = "reservationPassword";
pub const KEY_ALGORITHM_NAME: &str = "algorithmName";
pub const KEY_HASH_VALUE: &str = "hashValue";
pub const KEY_SALT_VALUE: &str = "saltValue";
pub const KEY_SPIN_COUNT: &str = "spinCount";

// ─── to_yrs_prelim ─────────────────────────────────────────────────────────

/// Convert a [`FileSharing`] to Yrs prelim entries for initial hydration.
pub fn to_yrs_prelim(fs: &FileSharing) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (
            KEY_READ_ONLY_RECOMMENDED,
            Any::Bool(fs.read_only_recommended),
        ),
        (KEY_USER_NAME, option_string(&fs.user_name)),
        (
            KEY_RESERVATION_PASSWORD,
            option_string(&fs.reservation_password),
        ),
        (KEY_ALGORITHM_NAME, option_string(&fs.algorithm_name)),
        (KEY_HASH_VALUE, option_string(&fs.hash_value)),
        (KEY_SALT_VALUE, option_string(&fs.salt_value)),
    ];
    if let Some(sc) = fs.spin_count {
        entries.push((KEY_SPIN_COUNT, Any::Number(sc as f64)));
    }
    entries
}

// ─── from_yrs_map ───────────────────────────────────────────────────────────

/// Read a [`FileSharing`] from a Y.Map.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> FileSharing {
    FileSharing {
        read_only_recommended: read_bool(map, txn, KEY_READ_ONLY_RECOMMENDED).unwrap_or(false),
        user_name: read_string(map, txn, KEY_USER_NAME),
        reservation_password: read_string(map, txn, KEY_RESERVATION_PASSWORD),
        algorithm_name: read_string(map, txn, KEY_ALGORITHM_NAME),
        hash_value: read_string(map, txn, KEY_HASH_VALUE),
        salt_value: read_string(map, txn, KEY_SALT_VALUE),
        spin_count: read_u32(map, txn, KEY_SPIN_COUNT),
    }
}

/// Update a single field on an existing file sharing Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}
