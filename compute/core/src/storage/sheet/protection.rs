//! Sheet protection, stored as one structured domain model in sheet meta.

use yrs::{Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::sheet::SheetProtectionOptions;
use domain_types::yrs_schema::protection as protection_schema;

use super::yrs_helpers::{KEY_PROTECTION_DETAILS, get_meta_map};

// =========================================================================
// Protection flag + password hash
// =========================================================================

fn existing_protection_details<T: yrs::ReadTxn>(
    txn: &T,
    meta: &MapRef,
) -> Option<domain_types::domain::protection::SheetProtection> {
    match meta.get(txn, KEY_PROTECTION_DETAILS) {
        Some(Out::YMap(prot_map)) => protection_schema::sheet_from_yrs_map(&prot_map, txn),
        _ => None,
    }
}

fn protection_from_options(
    is_protected: bool,
    password_hash: Option<&str>,
    options: &SheetProtectionOptions,
) -> domain_types::domain::protection::SheetProtection {
    domain_types::domain::protection::SheetProtection {
        is_protected,
        password_hash: password_hash.map(ToOwned::to_owned),
        hash_value: None,
        algorithm_name: None,
        salt_value: None,
        spin_count: None,
        select_locked: options.select_locked_cells,
        select_unlocked: options.select_unlocked_cells,
        format_cells: options.format_cells,
        format_columns: options.format_columns,
        format_rows: options.format_rows,
        insert_columns: options.insert_columns,
        insert_rows: options.insert_rows,
        insert_hyperlinks: options.insert_hyperlinks,
        delete_columns: options.delete_columns,
        delete_rows: options.delete_rows,
        sort: options.sort,
        auto_filter: options.use_auto_filter,
        pivot_tables: options.use_pivot_table_reports,
        objects: options.edit_objects,
        scenarios: options.edit_scenarios,
    }
}

fn write_protection_details(
    txn: &mut yrs::TransactionMut,
    meta: &MapRef,
    protection: &domain_types::domain::protection::SheetProtection,
) {
    let entries = protection_schema::sheet_to_yrs_prelim(protection);
    let prelim: MapPrelim = entries.into_iter().collect();
    meta.insert(txn, KEY_PROTECTION_DETAILS, prelim);
}

/// Check if a sheet is protected.
pub(crate) fn is_sheet_protected(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> bool {
    let txn = doc.transact();
    match get_meta_map(&txn, sheets, sheet_id) {
        Some(meta) => existing_protection_details(&txn, &meta)
            .map(|protection| protection.is_protected)
            .unwrap_or(false),
        None => false,
    }
}

/// Protect a sheet with an optional password hash.
pub(crate) fn protect_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        let options = existing_protection_details(&txn, &meta)
            .as_ref()
            .map(SheetProtectionOptions::from)
            .unwrap_or_default();
        let protection = protection_from_options(true, password_hash, &options);
        write_protection_details(&mut txn, &meta, &protection);
    }
}

/// Protect a sheet and set its full protection option set atomically.
pub(crate) fn protect_sheet_with_options(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
    options: &SheetProtectionOptions,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        let protection = protection_from_options(true, password_hash, options);
        write_protection_details(&mut txn, &meta, &protection);
    }
}

/// Replace the full protection option set while preserving protection state and hashes.
pub(crate) fn set_sheet_protection_options(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    options: &SheetProtectionOptions,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        let mut protection = existing_protection_details(&txn, &meta).unwrap_or_default();
        protection.select_locked = options.select_locked_cells;
        protection.select_unlocked = options.select_unlocked_cells;
        protection.format_cells = options.format_cells;
        protection.format_columns = options.format_columns;
        protection.format_rows = options.format_rows;
        protection.insert_columns = options.insert_columns;
        protection.insert_rows = options.insert_rows;
        protection.insert_hyperlinks = options.insert_hyperlinks;
        protection.delete_columns = options.delete_columns;
        protection.delete_rows = options.delete_rows;
        protection.sort = options.sort;
        protection.auto_filter = options.use_auto_filter;
        protection.pivot_tables = options.use_pivot_table_reports;
        protection.objects = options.edit_objects;
        protection.scenarios = options.edit_scenarios;
        write_protection_details(&mut txn, &meta, &protection);
    }
}

/// Unprotect a sheet. Validates the password hash if the sheet is password-protected.
/// Returns `true` if the sheet was successfully unprotected, `false` if the password was wrong.
pub(crate) fn unprotect_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
) -> bool {
    let txn = doc.transact();
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        // Check if there is a stored password hash
        let stored_hash = existing_protection_details(&txn, &meta)
            .and_then(|protection| protection.password_hash);
        if let Some(ref stored) = stored_hash {
            // Sheet has a password — caller must provide a matching hash
            match password_hash {
                Some(provided) if provided == stored.as_str() => {} // match — proceed
                _ => return false,                                  // wrong or missing password
            }
        }
    }
    drop(txn);

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id)
        && let Some(mut protection) = existing_protection_details(&txn, &meta)
    {
        protection.is_protected = false;
        protection.password_hash = None;
        protection.hash_value = None;
        protection.algorithm_name = None;
        protection.salt_value = None;
        protection.spin_count = None;
        write_protection_details(&mut txn, &meta, &protection);
    }
    true
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use crate::storage::sheet::settings::get_sheet_settings;
    use crate::storage::sheet::test_support::setup;

    fn assert_no_top_level_protection_keys(storage: &YrsStorage, sid: &SheetId) {
        let txn = storage.doc().transact();
        let meta = get_meta_map(&txn, storage.sheets(), sid).expect("sheet meta exists");
        assert!(
            meta.get(&txn, "isProtected").is_none(),
            "isProtected must be derived from protectionDetails, not stored separately"
        );
        assert!(
            meta.get(&txn, "protectionPasswordHash").is_none(),
            "protectionPasswordHash must be derived from protectionDetails, not stored separately"
        );
    }

    #[test]
    fn test_protection() {
        let (storage, _mirror, sid) = setup();
        assert!(!is_sheet_protected(storage.doc(), storage.sheets(), &sid));

        protect_sheet(storage.doc(), storage.sheets(), &sid, Some("hash123"));
        assert!(is_sheet_protected(storage.doc(), storage.sheets(), &sid));
        assert_no_top_level_protection_keys(&storage, &sid);

        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert_eq!(
            settings.protection_password_hash,
            Some("hash123".to_string())
        );
        assert_eq!(
            settings.protection_options,
            Some(SheetProtectionOptions::default())
        );

        // Wrong password should fail
        let ok = unprotect_sheet(storage.doc(), storage.sheets(), &sid, Some("wrong"));
        assert!(!ok);
        assert!(is_sheet_protected(storage.doc(), storage.sheets(), &sid));

        // Correct password should succeed
        let ok = unprotect_sheet(storage.doc(), storage.sheets(), &sid, Some("hash123"));
        assert!(ok);
        assert!(!is_sheet_protected(storage.doc(), storage.sheets(), &sid));
        assert_no_top_level_protection_keys(&storage, &sid);
        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert!(settings.protection_password_hash.is_none());
        assert_eq!(
            settings.protection_options,
            Some(SheetProtectionOptions::default())
        );
    }

    #[test]
    fn test_protect_without_password() {
        let (storage, _mirror, sid) = setup();
        protect_sheet(storage.doc(), storage.sheets(), &sid, None);
        assert!(is_sheet_protected(storage.doc(), storage.sheets(), &sid));
        assert_no_top_level_protection_keys(&storage, &sid);
        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert!(settings.protection_password_hash.is_none());
        assert_eq!(
            settings.protection_options,
            Some(SheetProtectionOptions::default())
        );
    }

    #[test]
    fn test_protect_with_options_sets_full_protection_details() {
        let (storage, _mirror, sid) = setup();
        let options = SheetProtectionOptions {
            select_locked_cells: true,
            select_unlocked_cells: false,
            insert_rows: true,
            insert_columns: false,
            insert_hyperlinks: true,
            delete_rows: false,
            delete_columns: true,
            format_cells: true,
            format_columns: false,
            format_rows: true,
            sort: true,
            use_auto_filter: false,
            use_pivot_table_reports: true,
            edit_objects: false,
            edit_scenarios: true,
        };

        protect_sheet_with_options(
            storage.doc(),
            storage.sheets(),
            &sid,
            Some("hash456"),
            &options,
        );

        assert!(is_sheet_protected(storage.doc(), storage.sheets(), &sid));
        assert_no_top_level_protection_keys(&storage, &sid);
        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert_eq!(
            settings.protection_password_hash,
            Some("hash456".to_string())
        );
        assert_eq!(settings.protection_options, Some(options));
    }

    #[test]
    fn test_set_sheet_protection_options_preserves_password_hash() {
        let (storage, _mirror, sid) = setup();
        protect_sheet(storage.doc(), storage.sheets(), &sid, Some("hash789"));

        let options = SheetProtectionOptions {
            select_locked_cells: false,
            select_unlocked_cells: true,
            insert_rows: true,
            insert_columns: true,
            insert_hyperlinks: true,
            delete_rows: true,
            delete_columns: false,
            format_cells: true,
            format_columns: true,
            format_rows: false,
            sort: true,
            use_auto_filter: true,
            use_pivot_table_reports: false,
            edit_objects: true,
            edit_scenarios: false,
        };

        set_sheet_protection_options(storage.doc(), storage.sheets(), &sid, &options);

        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert!(settings.is_protected);
        assert_eq!(
            settings.protection_password_hash,
            Some("hash789".to_string())
        );
        assert_eq!(settings.protection_options, Some(options));
    }

    #[test]
    fn test_protect_preserves_existing_protection_options() {
        let (storage, _mirror, sid) = setup();
        let options = SheetProtectionOptions {
            select_locked_cells: false,
            select_unlocked_cells: true,
            insert_rows: true,
            insert_columns: true,
            insert_hyperlinks: true,
            delete_rows: true,
            delete_columns: false,
            format_cells: true,
            format_columns: true,
            format_rows: false,
            sort: true,
            use_auto_filter: true,
            use_pivot_table_reports: false,
            edit_objects: true,
            edit_scenarios: false,
        };

        protect_sheet_with_options(
            storage.doc(),
            storage.sheets(),
            &sid,
            Some("old-hash"),
            &options,
        );
        assert!(unprotect_sheet(
            storage.doc(),
            storage.sheets(),
            &sid,
            Some("old-hash")
        ));

        protect_sheet(storage.doc(), storage.sheets(), &sid, Some("new-hash"));

        let settings = get_sheet_settings(storage.doc(), storage.sheets(), &sid);
        assert!(settings.is_protected);
        assert_eq!(
            settings.protection_password_hash,
            Some("new-hash".to_string())
        );
        assert_eq!(settings.protection_options, Some(options));
    }
}
