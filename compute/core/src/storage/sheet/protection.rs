//! Native worksheet protection and password metadata.
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::sheet::SheetProtectionOptions;

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

pub(crate) fn is_sheet_protected(storage: &WorkbookStorage, sheet_id: &SheetId) -> bool {
    storage
        .sheet_metadata
        .get(sheet_id)
        .and_then(|meta| meta.protection.as_ref())
        .is_some_and(|protection| protection.is_protected)
}

pub(crate) fn protect_sheet(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, protection);
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        let options = meta
            .protection
            .as_ref()
            .map(SheetProtectionOptions::from)
            .unwrap_or_default();
        meta.protection = Some(protection_from_options(true, password_hash, &options));
    }
}

pub(crate) fn protect_sheet_with_options(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
    options: &SheetProtectionOptions,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, protection);
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.protection = Some(protection_from_options(true, password_hash, options));
    }
}

pub(crate) fn set_sheet_protection_options(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    options: &SheetProtectionOptions,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, protection);
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        let protection = meta.protection.get_or_insert_with(Default::default);
        apply_protection_options(protection, options);
    }
}

pub(super) fn apply_protection_options(
    protection: &mut domain_types::domain::protection::SheetProtection,
    options: &SheetProtectionOptions,
) {
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
}

pub(crate) fn unprotect_sheet(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, protection);
    let Some(protection) = storage
        .sheet_metadata
        .get_mut(sheet_id)
        .and_then(|meta| meta.protection.as_mut())
    else {
        return true;
    };
    if let Some(stored) = protection.password_hash.as_deref()
        && password_hash != Some(stored)
    {
        return false;
    }
    protection.is_protected = false;
    protection.password_hash = None;
    protection.hash_value = None;
    protection.algorithm_name = None;
    protection.salt_value = None;
    protection.spin_count = None;
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::settings::get_sheet_settings;
    use crate::storage::sheet::test_support::setup;

    #[test]
    fn test_protection() {
        let (mut storage, _mirror, sid) = setup();
        assert!(!is_sheet_protected(&storage, &sid));

        protect_sheet(&mut storage, &sid, Some("hash123"));
        assert!(is_sheet_protected(&storage, &sid));

        let settings = get_sheet_settings(&storage, &sid);
        assert_eq!(
            settings.protection_password_hash,
            Some("hash123".to_string())
        );
        assert_eq!(
            settings.protection_options,
            Some(SheetProtectionOptions::default())
        );

        // Wrong password should fail
        let ok = unprotect_sheet(&mut storage, &sid, Some("wrong"));
        assert!(!ok);
        assert!(is_sheet_protected(&storage, &sid));

        // Correct password should succeed
        let ok = unprotect_sheet(&mut storage, &sid, Some("hash123"));
        assert!(ok);
        assert!(!is_sheet_protected(&storage, &sid));
        let settings = get_sheet_settings(&storage, &sid);
        assert!(settings.protection_password_hash.is_none());
        assert_eq!(
            settings.protection_options,
            Some(SheetProtectionOptions::default())
        );
    }

    #[test]
    fn test_protect_without_password() {
        let (mut storage, _mirror, sid) = setup();
        protect_sheet(&mut storage, &sid, None);
        assert!(is_sheet_protected(&storage, &sid));
        let settings = get_sheet_settings(&storage, &sid);
        assert!(settings.protection_password_hash.is_none());
        assert_eq!(
            settings.protection_options,
            Some(SheetProtectionOptions::default())
        );
    }

    #[test]
    fn test_protect_with_options_sets_full_protection_details() {
        let (mut storage, _mirror, sid) = setup();
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

        protect_sheet_with_options(&mut storage, &sid, Some("hash456"), &options);

        assert!(is_sheet_protected(&storage, &sid));
        let settings = get_sheet_settings(&storage, &sid);
        assert_eq!(
            settings.protection_password_hash,
            Some("hash456".to_string())
        );
        assert_eq!(settings.protection_options, Some(options));
    }

    #[test]
    fn test_set_sheet_protection_options_preserves_password_hash() {
        let (mut storage, _mirror, sid) = setup();
        protect_sheet(&mut storage, &sid, Some("hash789"));

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

        set_sheet_protection_options(&mut storage, &sid, &options);

        let settings = get_sheet_settings(&storage, &sid);
        assert!(settings.is_protected);
        assert_eq!(
            settings.protection_password_hash,
            Some("hash789".to_string())
        );
        assert_eq!(settings.protection_options, Some(options));
    }

    #[test]
    fn test_protect_preserves_existing_protection_options() {
        let (mut storage, _mirror, sid) = setup();
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

        protect_sheet_with_options(&mut storage, &sid, Some("old-hash"), &options);
        assert!(unprotect_sheet(&mut storage, &sid, Some("old-hash")));

        protect_sheet(&mut storage, &sid, Some("new-hash"));

        let settings = get_sheet_settings(&storage, &sid);
        assert!(settings.is_protected);
        assert_eq!(
            settings.protection_password_hash,
            Some("new-hash".to_string())
        );
        assert_eq!(settings.protection_options, Some(options));
    }
}
