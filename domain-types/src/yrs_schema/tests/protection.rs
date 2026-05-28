use crate::domain::protection::SheetProtection;
use crate::domain::workbook::{HashAlgorithm, WorkbookProtection};
use crate::yrs_schema::protection;

use super::support::roundtrip_map;

#[test]
fn sheet_protection_round_trips_hashes_and_permissions() {
    let original = SheetProtection {
        is_protected: true,
        password_hash: Some("ABC123".to_string()),
        hash_value: Some("HASH456".to_string()),
        algorithm_name: Some("SHA-512".to_string()),
        salt_value: Some("base64salt==".to_string()),
        spin_count: Some(100000),
        select_locked: false,
        select_unlocked: true,
        format_cells: true,
        format_columns: true,
        format_rows: false,
        insert_columns: true,
        insert_rows: true,
        insert_hyperlinks: false,
        delete_columns: false,
        delete_rows: true,
        sort: true,
        auto_filter: false,
        pivot_tables: true,
        objects: true,
        scenarios: false,
    };

    assert_eq!(
        original,
        roundtrip_map(protection::sheet_to_yrs_prelim(&original), |map, txn| {
            protection::sheet_from_yrs_map(map, txn)
        },)
    );
}

#[test]
fn workbook_protection_round_trips_modern_and_legacy_metadata() {
    let original = WorkbookProtection {
        lock_structure: true,
        lock_windows: true,
        lock_revision: false,
        workbook_hash_value: Some("XYZ789".to_string()),
        workbook_algorithm_name: HashAlgorithm::Sha256,
        workbook_salt_value: Some("saltyvalue==".to_string()),
        workbook_spin_count: Some(50000),
        revisions_hash_value: Some("REVHASH".to_string()),
        revisions_algorithm_name: HashAlgorithm::Sha512,
        revisions_salt_value: Some("revisionsSalt==".to_string()),
        revisions_spin_count: Some(75000),
        workbook_password: Some("ABCD".to_string()),
        workbook_password_character_set: Some("UTF-16".to_string()),
        revisions_password: Some("DCBA".to_string()),
        revisions_password_character_set: Some("UTF-16".to_string()),
    };

    assert_eq!(
        original,
        roundtrip_map(protection::workbook_to_yrs_prelim(&original), |map, txn| {
            protection::workbook_from_yrs_map(map, txn)
        },)
    );
}
