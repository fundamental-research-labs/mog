//! Yrs schema for [`SheetProtection`] and [`WorkbookProtection`] — flat Y.Maps.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::protection::SheetProtection;
use crate::domain::workbook::{HashAlgorithm, WorkbookProtection};

// ─── SheetProtection keys ───────────────────────────────────────────────────

pub const KEY_IS_PROTECTED: &str = "isProtected";
pub const KEY_PASSWORD_HASH: &str = "passwordHash";
pub const KEY_HASH_VALUE: &str = "hashValue";
pub const KEY_ALGORITHM_NAME: &str = "algorithmName";
pub const KEY_SALT_VALUE: &str = "saltValue";
pub const KEY_SPIN_COUNT: &str = "spinCount";
// Keys match the camelCase field names of SheetProtectionOptions (the bridge type)
// so that TS `set_sheet_setting` keys pass through without mapping.
pub const KEY_SELECT_LOCKED: &str = "selectLockedCells";
pub const KEY_SELECT_UNLOCKED: &str = "selectUnlockedCells";
pub const KEY_FORMAT_CELLS: &str = "formatCells";
pub const KEY_FORMAT_COLUMNS: &str = "formatColumns";
pub const KEY_FORMAT_ROWS: &str = "formatRows";
pub const KEY_INSERT_COLUMNS: &str = "insertColumns";
pub const KEY_INSERT_ROWS: &str = "insertRows";
pub const KEY_INSERT_HYPERLINKS: &str = "insertHyperlinks";
pub const KEY_DELETE_COLUMNS: &str = "deleteColumns";
pub const KEY_DELETE_ROWS: &str = "deleteRows";
pub const KEY_SORT: &str = "sort";
pub const KEY_AUTO_FILTER: &str = "useAutoFilter";
pub const KEY_PIVOT_TABLES: &str = "usePivotTableReports";
pub const KEY_OBJECTS: &str = "editObjects";
pub const KEY_SCENARIOS: &str = "editScenarios";

// ─── WorkbookProtection keys ────────────────────────────────────────────────

pub const KEY_WB_IS_PROTECTED: &str = "isProtected";
pub const KEY_LOCK_STRUCTURE: &str = "lockStructure";
pub const KEY_LOCK_WINDOWS: &str = "lockWindows";
pub const KEY_LOCK_REVISION: &str = "lockRevision";
pub const KEY_WB_ALGORITHM_NAME: &str = "workbookAlgorithmName";
pub const KEY_WB_HASH_VALUE: &str = "workbookHashValue";
pub const KEY_WB_SALT_VALUE: &str = "workbookSaltValue";
pub const KEY_WB_SPIN_COUNT: &str = "workbookSpinCount";
pub const KEY_REV_ALGORITHM_NAME: &str = "revisionsAlgorithmName";
pub const KEY_REV_HASH_VALUE: &str = "revisionsHashValue";
pub const KEY_REV_SALT_VALUE: &str = "revisionsSaltValue";
pub const KEY_REV_SPIN_COUNT: &str = "revisionsSpinCount";
pub const KEY_WB_PASSWORD: &str = "workbookPassword";
pub const KEY_WB_PASSWORD_CHARSET: &str = "workbookPasswordCharacterSet";
pub const KEY_REV_PASSWORD: &str = "revisionsPassword";
pub const KEY_REV_PASSWORD_CHARSET: &str = "revisionsPasswordCharacterSet";

// ─── SheetProtection ────────────────────────────────────────────────────────

/// Convert a [`SheetProtection`] to Yrs prelim entries for initial hydration.
pub fn sheet_to_yrs_prelim(prot: &SheetProtection) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_IS_PROTECTED, Any::Bool(prot.is_protected)),
        (KEY_SELECT_LOCKED, Any::Bool(prot.select_locked)),
        (KEY_SELECT_UNLOCKED, Any::Bool(prot.select_unlocked)),
        (KEY_FORMAT_CELLS, Any::Bool(prot.format_cells)),
        (KEY_FORMAT_COLUMNS, Any::Bool(prot.format_columns)),
        (KEY_FORMAT_ROWS, Any::Bool(prot.format_rows)),
        (KEY_INSERT_COLUMNS, Any::Bool(prot.insert_columns)),
        (KEY_INSERT_ROWS, Any::Bool(prot.insert_rows)),
        (KEY_INSERT_HYPERLINKS, Any::Bool(prot.insert_hyperlinks)),
        (KEY_DELETE_COLUMNS, Any::Bool(prot.delete_columns)),
        (KEY_DELETE_ROWS, Any::Bool(prot.delete_rows)),
        (KEY_SORT, Any::Bool(prot.sort)),
        (KEY_AUTO_FILTER, Any::Bool(prot.auto_filter)),
        (KEY_PIVOT_TABLES, Any::Bool(prot.pivot_tables)),
        (KEY_OBJECTS, Any::Bool(prot.objects)),
        (KEY_SCENARIOS, Any::Bool(prot.scenarios)),
    ];
    if let Some(hash) = &prot.password_hash {
        entries.push((KEY_PASSWORD_HASH, Any::String(Arc::from(hash.as_str()))));
    }
    if let Some(hash) = &prot.hash_value {
        entries.push((KEY_HASH_VALUE, Any::String(Arc::from(hash.as_str()))));
    }
    if let Some(alg) = &prot.algorithm_name {
        entries.push((KEY_ALGORITHM_NAME, Any::String(Arc::from(alg.as_str()))));
    }
    if let Some(salt) = &prot.salt_value {
        entries.push((KEY_SALT_VALUE, Any::String(Arc::from(salt.as_str()))));
    }
    if let Some(sc) = prot.spin_count {
        entries.push((KEY_SPIN_COUNT, Any::Number(sc as f64)));
    }
    entries
}

/// Read a [`SheetProtection`] from a Y.Map.
pub fn sheet_from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<SheetProtection> {
    Some(SheetProtection {
        is_protected: read_bool(map, txn, KEY_IS_PROTECTED).unwrap_or(false),
        password_hash: read_string(map, txn, KEY_PASSWORD_HASH),
        hash_value: read_string(map, txn, KEY_HASH_VALUE),
        algorithm_name: read_string(map, txn, KEY_ALGORITHM_NAME),
        salt_value: read_string(map, txn, KEY_SALT_VALUE),
        spin_count: read_u32(map, txn, KEY_SPIN_COUNT),
        select_locked: read_bool(map, txn, KEY_SELECT_LOCKED).unwrap_or(true),
        select_unlocked: read_bool(map, txn, KEY_SELECT_UNLOCKED).unwrap_or(true),
        format_cells: read_bool(map, txn, KEY_FORMAT_CELLS).unwrap_or(false),
        format_columns: read_bool(map, txn, KEY_FORMAT_COLUMNS).unwrap_or(false),
        format_rows: read_bool(map, txn, KEY_FORMAT_ROWS).unwrap_or(false),
        insert_columns: read_bool(map, txn, KEY_INSERT_COLUMNS).unwrap_or(false),
        insert_rows: read_bool(map, txn, KEY_INSERT_ROWS).unwrap_or(false),
        insert_hyperlinks: read_bool(map, txn, KEY_INSERT_HYPERLINKS).unwrap_or(false),
        delete_columns: read_bool(map, txn, KEY_DELETE_COLUMNS).unwrap_or(false),
        delete_rows: read_bool(map, txn, KEY_DELETE_ROWS).unwrap_or(false),
        sort: read_bool(map, txn, KEY_SORT).unwrap_or(false),
        auto_filter: read_bool(map, txn, KEY_AUTO_FILTER).unwrap_or(false),
        pivot_tables: read_bool(map, txn, KEY_PIVOT_TABLES).unwrap_or(false),
        objects: read_bool(map, txn, KEY_OBJECTS).unwrap_or(false),
        scenarios: read_bool(map, txn, KEY_SCENARIOS).unwrap_or(false),
    })
}

// ─── WorkbookProtection ─────────────────────────────────────────────────────

/// Convert a [`WorkbookProtection`] to Yrs prelim entries for initial hydration.
pub fn workbook_to_yrs_prelim(prot: &WorkbookProtection) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_LOCK_STRUCTURE, Any::Bool(prot.lock_structure)),
        (KEY_LOCK_WINDOWS, Any::Bool(prot.lock_windows)),
        (KEY_LOCK_REVISION, Any::Bool(prot.lock_revision)),
    ];
    // Modern workbook password (SHA-based)
    let alg_str = prot.workbook_algorithm_name.as_str();
    if !alg_str.is_empty() {
        entries.push((KEY_WB_ALGORITHM_NAME, Any::String(Arc::from(alg_str))));
    }
    if let Some(hash) = &prot.workbook_hash_value {
        entries.push((KEY_WB_HASH_VALUE, Any::String(Arc::from(hash.as_str()))));
    }
    if let Some(salt) = &prot.workbook_salt_value {
        entries.push((KEY_WB_SALT_VALUE, Any::String(Arc::from(salt.as_str()))));
    }
    if let Some(sc) = prot.workbook_spin_count {
        entries.push((KEY_WB_SPIN_COUNT, Any::Number(sc as f64)));
    }
    // Modern revisions password (SHA-based)
    let rev_alg_str = prot.revisions_algorithm_name.as_str();
    if !rev_alg_str.is_empty() {
        entries.push((KEY_REV_ALGORITHM_NAME, Any::String(Arc::from(rev_alg_str))));
    }
    if let Some(hash) = &prot.revisions_hash_value {
        entries.push((KEY_REV_HASH_VALUE, Any::String(Arc::from(hash.as_str()))));
    }
    if let Some(salt) = &prot.revisions_salt_value {
        entries.push((KEY_REV_SALT_VALUE, Any::String(Arc::from(salt.as_str()))));
    }
    if let Some(sc) = prot.revisions_spin_count {
        entries.push((KEY_REV_SPIN_COUNT, Any::Number(sc as f64)));
    }
    // Legacy passwords (pre-2007)
    if let Some(pw) = &prot.workbook_password {
        entries.push((KEY_WB_PASSWORD, Any::String(Arc::from(pw.as_str()))));
    }
    if let Some(cs) = &prot.workbook_password_character_set {
        entries.push((KEY_WB_PASSWORD_CHARSET, Any::String(Arc::from(cs.as_str()))));
    }
    if let Some(pw) = &prot.revisions_password {
        entries.push((KEY_REV_PASSWORD, Any::String(Arc::from(pw.as_str()))));
    }
    if let Some(cs) = &prot.revisions_password_character_set {
        entries.push((
            KEY_REV_PASSWORD_CHARSET,
            Any::String(Arc::from(cs.as_str())),
        ));
    }
    entries
}

/// Read a [`WorkbookProtection`] from a Y.Map.
pub fn workbook_from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<WorkbookProtection> {
    Some(WorkbookProtection {
        lock_structure: read_bool(map, txn, KEY_LOCK_STRUCTURE).unwrap_or(false),
        lock_windows: read_bool(map, txn, KEY_LOCK_WINDOWS).unwrap_or(false),
        lock_revision: read_bool(map, txn, KEY_LOCK_REVISION).unwrap_or(false),
        workbook_algorithm_name: read_string(map, txn, KEY_WB_ALGORITHM_NAME)
            .map(|s| HashAlgorithm::from_bytes(s.as_bytes()))
            .unwrap_or(HashAlgorithm::None),
        workbook_hash_value: read_string(map, txn, KEY_WB_HASH_VALUE),
        workbook_salt_value: read_string(map, txn, KEY_WB_SALT_VALUE),
        workbook_spin_count: read_u32(map, txn, KEY_WB_SPIN_COUNT),
        revisions_algorithm_name: read_string(map, txn, KEY_REV_ALGORITHM_NAME)
            .map(|s| HashAlgorithm::from_bytes(s.as_bytes()))
            .unwrap_or(HashAlgorithm::None),
        revisions_hash_value: read_string(map, txn, KEY_REV_HASH_VALUE),
        revisions_salt_value: read_string(map, txn, KEY_REV_SALT_VALUE),
        revisions_spin_count: read_u32(map, txn, KEY_REV_SPIN_COUNT),
        workbook_password: read_string(map, txn, KEY_WB_PASSWORD),
        workbook_password_character_set: read_string(map, txn, KEY_WB_PASSWORD_CHARSET),
        revisions_password: read_string(map, txn, KEY_REV_PASSWORD),
        revisions_password_character_set: read_string(map, txn, KEY_REV_PASSWORD_CHARSET),
    })
}

/// Update a single field on an existing protection Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::Transact;

    #[test]
    fn sheet_modern_hash_fields_roundtrip_through_yrs_map() {
        let original = SheetProtection {
            is_protected: true,
            password_hash: Some("CC2A".to_string()),
            hash_value: Some("modernHash==".to_string()),
            algorithm_name: Some("SHA-512".to_string()),
            salt_value: Some("modernSalt==".to_string()),
            spin_count: Some(100000),
            select_locked: false,
            select_unlocked: true,
            format_cells: true,
            format_columns: false,
            format_rows: true,
            insert_columns: false,
            insert_rows: true,
            insert_hyperlinks: false,
            delete_columns: true,
            delete_rows: false,
            sort: true,
            auto_filter: false,
            pivot_tables: true,
            objects: true,
            scenarios: false,
        };

        let doc = yrs::Doc::new();
        let map = doc.get_or_insert_map("protection");
        let mut txn = doc.transact_mut();
        for (key, value) in sheet_to_yrs_prelim(&original) {
            map.insert(&mut txn, key, value);
        }
        drop(txn);

        let txn = doc.transact();
        let restored = sheet_from_yrs_map(&map, &txn).expect("protection should hydrate");

        assert_eq!(restored, original);
    }
}
