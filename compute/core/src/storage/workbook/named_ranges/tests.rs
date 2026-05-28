use super::keys::{get_defined_name_key, looks_like_cell_reference, looks_like_r1c1_reference};
use super::*;
use crate::storage::YrsStorage;
use value_types::{CellError, FiniteF64};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn make_storage() -> YrsStorage {
    YrsStorage::new()
}

fn sample_input(name: &str, refers_to: &str) -> DefinedNameInput {
    DefinedNameInput {
        name: name.to_string(),
        refers_to: refers_to.to_string(),
        scope: None,
        comment: None,
    }
}

fn scoped_input(name: &str, refers_to: &str, scope: &str) -> DefinedNameInput {
    DefinedNameInput {
        name: name.to_string(),
        refers_to: refers_to.to_string(),
        scope: Some(scope.to_string()),
        comment: None,
    }
}

// ===================================================================
// Validation Tests
// ===================================================================

// -------------------------------------------------------------------
// Test 1: Validate empty name -> error
// -------------------------------------------------------------------

#[test]
fn test_validate_empty_name() {
    let storage = make_storage();
    let result = validate_name(storage.doc(), storage.workbook_map(), "", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::Empty));
}

// -------------------------------------------------------------------
// Test 2: Validate whitespace-only name -> error
// -------------------------------------------------------------------

#[test]
fn test_validate_whitespace_name() {
    let storage = make_storage();
    let result = validate_name(storage.doc(), storage.workbook_map(), "   ", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::Empty));
}

// -------------------------------------------------------------------
// Test 3: Validate too long name -> error
// -------------------------------------------------------------------

#[test]
fn test_validate_too_long_name() {
    let storage = make_storage();
    let long_name = "A".repeat(256);
    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        &long_name,
        None,
        None,
    );
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::TooLong));
}

// -------------------------------------------------------------------
// Test 4: Validate starts with digit -> error
// -------------------------------------------------------------------

#[test]
fn test_validate_starts_with_digit() {
    let storage = make_storage();
    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "1Revenue",
        None,
        None,
    );
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::InvalidFirstChar));
}

// -------------------------------------------------------------------
// Test 5: Validate cell reference (A1) -> error
// -------------------------------------------------------------------

#[test]
fn test_validate_cell_reference() {
    let storage = make_storage();

    let result = validate_name(storage.doc(), storage.workbook_map(), "A1", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::CellReference));

    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "XFD1048576",
        None,
        None,
    );
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::CellReference));

    let result = validate_name(storage.doc(), storage.workbook_map(), "AB123", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::CellReference));
}

// -------------------------------------------------------------------
// Test 6: Validate reserved (TRUE, FALSE, NULL) -> error
// -------------------------------------------------------------------

#[test]
fn test_validate_reserved_names() {
    let storage = make_storage();

    for reserved in &["TRUE", "FALSE", "NULL", "true", "false", "null"] {
        let result = validate_name(storage.doc(), storage.workbook_map(), reserved, None, None);
        assert!(!result.valid, "Expected '{}' to be invalid", reserved);
        assert_eq!(result.error, Some(NameValidationError::Reserved));
    }
}

// -------------------------------------------------------------------
// Test 7: Validate single letter A-Z -> reserved
// -------------------------------------------------------------------

#[test]
fn test_validate_single_letter_reserved() {
    let storage = make_storage();

    let result = validate_name(storage.doc(), storage.workbook_map(), "A", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::Reserved));

    let result = validate_name(storage.doc(), storage.workbook_map(), "Z", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::Reserved));
}

// -------------------------------------------------------------------
// Test 8: Validate R1C1 reference -> error
// -------------------------------------------------------------------

#[test]
fn test_validate_r1c1_reference() {
    let storage = make_storage();

    let result = validate_name(storage.doc(), storage.workbook_map(), "R1C1", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::R1C1Reference));

    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "R100C200",
        None,
        None,
    );
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::R1C1Reference));
}

// -------------------------------------------------------------------
// Test 9: Validate valid name -> success
// -------------------------------------------------------------------

#[test]
fn test_validate_valid_name() {
    let storage = make_storage();

    let result = validate_name(storage.doc(), storage.workbook_map(), "Revenue", None, None);
    assert!(result.valid);
    assert!(result.error.is_none());

    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "_private",
        None,
        None,
    );
    assert!(result.valid);

    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "\\backslash",
        None,
        None,
    );
    assert!(result.valid);

    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "Sales2024",
        None,
        None,
    );
    assert!(result.valid);

    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "tax.rate",
        None,
        None,
    );
    assert!(result.valid);
}

// -------------------------------------------------------------------
// Test 10: Validate invalid characters -> error
// -------------------------------------------------------------------

#[test]
fn test_validate_invalid_chars() {
    let storage = make_storage();

    let result = validate_name(storage.doc(), storage.workbook_map(), "my name", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::InvalidChars));

    let result = validate_name(storage.doc(), storage.workbook_map(), "name!", None, None);
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::InvalidChars));
}

// ===================================================================
// CRUD Tests
// ===================================================================

// -------------------------------------------------------------------
// Test 11: Create named range + retrieve
// -------------------------------------------------------------------

#[test]
fn test_create_and_get_named_range() {
    let storage = make_storage();
    let input = sample_input("Revenue", "=Sheet1!$A$1:$A$10");

    let created = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        input,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(created.name, "Revenue");
    assert_eq!(created.refers_to, "=Sheet1!$A$1:$A$10");
    assert!(created.scope.is_none());
    assert!(created.visible);
    assert!(!created.id.is_empty());

    // Retrieve by name
    let found = get_named_range_by_name(storage.doc(), storage.workbook_map(), "Revenue", None)
        .expect("should find by name");
    assert_eq!(found.id, created.id);

    // Case-insensitive retrieval
    let found = get_named_range_by_name(storage.doc(), storage.workbook_map(), "revenue", None)
        .expect("should find case-insensitive");
    assert_eq!(found.id, created.id);
}

// -------------------------------------------------------------------
// Test 12: Create scoped named range
// -------------------------------------------------------------------

#[test]
fn test_create_scoped_named_range() {
    let storage = make_storage();
    let input = scoped_input("LocalName", "=Sheet1!$B$1:$B$5", "sheet123");

    let created = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        input,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(created.scope, Some("sheet123".to_string()));

    // Find with correct scope
    let found = get_named_range_by_name(
        storage.doc(),
        storage.workbook_map(),
        "LocalName",
        Some("sheet123"),
    )
    .expect("should find scoped name");
    assert_eq!(found.id, created.id);

    // Should NOT find without scope
    assert!(
        get_named_range_by_name(storage.doc(), storage.workbook_map(), "LocalName", None).is_none()
    );
}

// -------------------------------------------------------------------
// Test 13: Duplicate name -> error
// -------------------------------------------------------------------

#[test]
fn test_create_duplicate_name_error() {
    let storage = make_storage();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=Sheet1!$A$1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let result = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=Sheet1!$B$1"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// Test 14: Same name different scopes -> allowed
// -------------------------------------------------------------------

#[test]
fn test_same_name_different_scopes() {
    let storage = make_storage();

    // Workbook-scoped
    let wb = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Sales", "=Sheet1!$A$1:$A$10"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Sheet-scoped with same name
    let sheet = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        scoped_input("Sales", "=Sheet1!$B$1:$B$10", "sheet1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert_ne!(wb.id, sheet.id);
    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 2);
}

// -------------------------------------------------------------------
// Test 15: Resolve with scope precedence (sheet > workbook)
// -------------------------------------------------------------------

#[test]
fn test_resolve_scope_precedence() {
    let storage = make_storage();

    // Create workbook-scoped
    let wb = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Sales", "=Sheet1!$A$1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Create sheet-scoped with same name
    let sheet = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        scoped_input("Sales", "=Sheet1!$B$1", "sheet1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Resolve with sheet context -> should get sheet-scoped
    let resolved = resolve_named_range(
        storage.doc(),
        storage.workbook_map(),
        "Sales",
        Some("sheet1"),
    )
    .expect("should resolve");
    assert_eq!(resolved.id, sheet.id);

    // Resolve without sheet context -> should get workbook-scoped
    let resolved = resolve_named_range(storage.doc(), storage.workbook_map(), "Sales", None)
        .expect("should resolve");
    assert_eq!(resolved.id, wb.id);

    // Resolve with different sheet -> should fall back to workbook
    let resolved = resolve_named_range(
        storage.doc(),
        storage.workbook_map(),
        "Sales",
        Some("other_sheet"),
    )
    .expect("should resolve");
    assert_eq!(resolved.id, wb.id);
}

// -------------------------------------------------------------------
// Test 16: Get by ID
// -------------------------------------------------------------------

#[test]
fn test_get_by_id() {
    let storage = make_storage();
    let created = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=Sheet1!$A$1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let found = get_named_range_by_id(storage.doc(), storage.workbook_map(), &created.id)
        .expect("should find by ID");
    assert_eq!(found.name, "Revenue");

    // Non-existent ID
    assert!(get_named_range_by_id(storage.doc(), storage.workbook_map(), "nonexistent").is_none());
}

// -------------------------------------------------------------------
// Test 17: Get all
// -------------------------------------------------------------------

#[test]
fn test_get_all() {
    let storage = make_storage();
    assert!(get_all_named_ranges(storage.doc(), storage.workbook_map()).is_empty());

    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Costs", "=B1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Profit", "=C1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let all = get_all_named_ranges(storage.doc(), storage.workbook_map());
    assert_eq!(all.len(), 3);
}

// -------------------------------------------------------------------
// Test 18: Get by scope
// -------------------------------------------------------------------

#[test]
fn test_get_by_scope() {
    let storage = make_storage();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("WbName", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        scoped_input("SheetName1", "=B1", "sheet1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        scoped_input("SheetName2", "=C1", "sheet1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        scoped_input("OtherSheet", "=D1", "sheet2"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Workbook scope
    let wb = get_named_ranges_by_scope(storage.doc(), storage.workbook_map(), None);
    assert_eq!(wb.len(), 1);
    assert_eq!(wb[0].name, "WbName");

    // Sheet1 scope
    let s1 = get_named_ranges_by_scope(storage.doc(), storage.workbook_map(), Some("sheet1"));
    assert_eq!(s1.len(), 2);

    // Sheet2 scope
    let s2 = get_named_ranges_by_scope(storage.doc(), storage.workbook_map(), Some("sheet2"));
    assert_eq!(s2.len(), 1);
}

// -------------------------------------------------------------------
// Test 19: Get visible only
// -------------------------------------------------------------------

#[test]
fn test_get_visible() {
    let storage = make_storage();

    // Create visible name
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Visible", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Create then hide a name
    let hidden = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Hidden", "=B1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    update_named_range(
        storage.doc(),
        storage.workbook_map(),
        &hidden.id,
        NamedRangeUpdate {
            visible: Some(false),
            ..Default::default()
        },
    )
    .unwrap();

    let visible = get_visible_named_ranges(storage.doc(), storage.workbook_map());
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].name, "Visible");
}

// -------------------------------------------------------------------
// Test 20: Update name
// -------------------------------------------------------------------

#[test]
fn test_update_name() {
    let storage = make_storage();
    let created = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("OldName", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let updated = update_named_range(
        storage.doc(),
        storage.workbook_map(),
        &created.id,
        NamedRangeUpdate {
            name: Some("NewName".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(updated.name, "NewName");
    assert_eq!(updated.id, created.id);

    // Old name should not be found
    assert!(
        get_named_range_by_name(storage.doc(), storage.workbook_map(), "OldName", None).is_none()
    );

    // New name should be found
    assert!(
        get_named_range_by_name(storage.doc(), storage.workbook_map(), "NewName", None).is_some()
    );
}

// -------------------------------------------------------------------
// Test 21: Update refers_to
// -------------------------------------------------------------------

#[test]
fn test_update_refers_to() {
    let storage = make_storage();
    let created = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=Sheet1!$A$1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let updated = update_named_range(
        storage.doc(),
        storage.workbook_map(),
        &created.id,
        NamedRangeUpdate {
            refers_to: Some("=Sheet1!$A$1:$A$100".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(updated.refers_to, "=Sheet1!$A$1:$A$100");
}

// -------------------------------------------------------------------
// Test 22: Delete by ID
// -------------------------------------------------------------------

#[test]
fn test_delete_by_id() {
    let storage = make_storage();
    let created = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 1);

    remove_named_range_by_id(storage.doc(), storage.workbook_map(), &created.id).unwrap();
    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 0);
    assert!(
        get_named_range_by_name(storage.doc(), storage.workbook_map(), "Revenue", None).is_none()
    );
}

// -------------------------------------------------------------------
// Test 23: Delete by ID not found -> error
// -------------------------------------------------------------------

#[test]
fn test_delete_by_id_not_found() {
    let storage = make_storage();
    let result = remove_named_range_by_id(storage.doc(), storage.workbook_map(), "nonexistent");
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// Test 24: Delete by scope
// -------------------------------------------------------------------

#[test]
fn test_delete_by_scope() {
    let storage = make_storage();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("WbName", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        scoped_input("Sheet1Name1", "=B1", "sheet1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        scoped_input("Sheet1Name2", "=C1", "sheet1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        scoped_input("Sheet2Name", "=D1", "sheet2"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 4);

    // Remove all sheet1-scoped names
    remove_named_ranges_by_scope(storage.doc(), storage.workbook_map(), Some("sheet1"));

    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 2);
    assert!(
        get_named_range_by_name(storage.doc(), storage.workbook_map(), "WbName", None).is_some()
    );
    assert!(
        get_named_range_by_name(
            storage.doc(),
            storage.workbook_map(),
            "Sheet2Name",
            Some("sheet2")
        )
        .is_some()
    );
    assert!(
        get_named_range_by_name(
            storage.doc(),
            storage.workbook_map(),
            "Sheet1Name1",
            Some("sheet1")
        )
        .is_none()
    );
}

// -------------------------------------------------------------------
// Test 25: Import (skips duplicates)
// -------------------------------------------------------------------

#[test]
fn test_import_skips_duplicates() {
    let storage = make_storage();

    // Create one existing
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Existing", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let names = vec![
        DefinedName {
            id: "id1".to_string(),
            name: "Existing".to_string(), // duplicate
            refers_to: "=B1".to_string(),
            raw_refers_to: None,
            scope: None,
            comment: None,
            custom_menu: None,
            description: None,
            help: None,
            status_bar: None,
            visible: true,
            xlm: false,
            function: false,
            vb_procedure: false,
            publish_to_server: false,
            workbook_parameter: false,
            xml_space_preserve: false,
            order: None,
            linked_range_id: None,
        },
        DefinedName {
            id: "id2".to_string(),
            name: "NewName".to_string(),
            refers_to: "=C1".to_string(),
            raw_refers_to: None,
            scope: None,
            comment: None,
            custom_menu: None,
            description: None,
            help: None,
            status_bar: None,
            visible: true,
            xlm: false,
            function: false,
            vb_procedure: false,
            publish_to_server: false,
            workbook_parameter: false,
            xml_space_preserve: false,
            order: None,
            linked_range_id: None,
        },
        DefinedName {
            id: "id3".to_string(),
            name: "AnotherNew".to_string(),
            refers_to: "=D1".to_string(),
            raw_refers_to: None,
            scope: None,
            comment: None,
            custom_menu: None,
            description: None,
            help: None,
            status_bar: None,
            visible: true,
            xlm: false,
            function: false,
            vb_procedure: false,
            publish_to_server: false,
            workbook_parameter: false,
            xml_space_preserve: false,
            order: None,
            linked_range_id: None,
        },
    ];

    let imported = import_named_ranges(storage.doc(), storage.workbook_map(), names);
    assert_eq!(imported, 2); // "Existing" was skipped
    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 3);
}

// -------------------------------------------------------------------
// Test 26: Count
// -------------------------------------------------------------------

#[test]
fn test_count() {
    let storage = make_storage();
    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 0);

    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("A1Name", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 1);

    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("B1Name", "=B1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 2);
}

// -------------------------------------------------------------------
// Test 27: Exists check
// -------------------------------------------------------------------

#[test]
fn test_exists() {
    let storage = make_storage();

    assert!(!named_range_exists(
        storage.doc(),
        storage.workbook_map(),
        "Revenue",
        None
    ));

    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert!(named_range_exists(
        storage.doc(),
        storage.workbook_map(),
        "Revenue",
        None
    ));
    // Case-insensitive
    assert!(named_range_exists(
        storage.doc(),
        storage.workbook_map(),
        "revenue",
        None
    ));
    assert!(named_range_exists(
        storage.doc(),
        storage.workbook_map(),
        "REVENUE",
        None
    ));
    // Different scope
    assert!(!named_range_exists(
        storage.doc(),
        storage.workbook_map(),
        "Revenue",
        Some("sheet1")
    ));
}

// ===================================================================
// Edge Case Tests
// ===================================================================

// -------------------------------------------------------------------
// Test 35: Validate duplicate with exclude_id (update case)
// -------------------------------------------------------------------

#[test]
fn test_validate_duplicate_with_exclude_id() {
    let storage = make_storage();
    let created = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Validating the same name for the same ID should succeed
    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "Revenue",
        None,
        Some(&created.id),
    );
    assert!(result.valid);

    // Validating the same name for a different ID should fail
    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "Revenue",
        None,
        Some("other-id"),
    );
    assert!(!result.valid);
    assert_eq!(result.error, Some(NameValidationError::Duplicate));
}

// -------------------------------------------------------------------
// Test 36: Update comment
// -------------------------------------------------------------------

#[test]
fn test_update_comment() {
    let storage = make_storage();
    let created = create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert!(created.comment.is_none());

    let updated = update_named_range(
        storage.doc(),
        storage.workbook_map(),
        &created.id,
        NamedRangeUpdate {
            comment: Some(Some("Annual revenue".to_string())),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(updated.comment, Some("Annual revenue".to_string()));

    // Clear comment
    let updated = update_named_range(
        storage.doc(),
        storage.workbook_map(),
        &created.id,
        NamedRangeUpdate {
            comment: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(updated.comment.is_none());
}

// -------------------------------------------------------------------
// Test 37: Update not found -> error
// -------------------------------------------------------------------

#[test]
fn test_update_not_found() {
    let storage = make_storage();
    let result = update_named_range(
        storage.doc(),
        storage.workbook_map(),
        "nonexistent",
        NamedRangeUpdate {
            name: Some("NewName".to_string()),
            ..Default::default()
        },
    );
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// Test 38: Delete by scope with no matches (no-op)
// -------------------------------------------------------------------

#[test]
fn test_delete_by_scope_no_matches() {
    let storage = make_storage();
    create_named_range(
        storage.doc(),
        storage.workbook_map(),
        sample_input("Revenue", "=A1"),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Delete by scope that has no names — should not panic or affect anything
    remove_named_ranges_by_scope(
        storage.doc(),
        storage.workbook_map(),
        Some("nonexistent_sheet"),
    );
    assert_eq!(named_range_count(storage.doc(), storage.workbook_map()), 1);
}

// -------------------------------------------------------------------
// Test 39: Import empty list
// -------------------------------------------------------------------

#[test]
fn test_import_empty_list() {
    let storage = make_storage();
    let imported = import_named_ranges(storage.doc(), storage.workbook_map(), vec![]);
    assert_eq!(imported, 0);
}

// -------------------------------------------------------------------
// Test 40: Validate name at exactly 255 chars -> valid
// -------------------------------------------------------------------

#[test]
fn test_validate_max_length_name() {
    let storage = make_storage();
    let name = format!("A{}", "x".repeat(254));
    assert_eq!(name.len(), 255);
    let result = validate_name(storage.doc(), storage.workbook_map(), &name, None, None);
    assert!(result.valid);
}

// -------------------------------------------------------------------
// Test 41: DefinedName serde roundtrip
// -------------------------------------------------------------------

#[test]
fn test_defined_name_serde_roundtrip() {
    let dn = DefinedName {
        id: "abc123".to_string(),
        name: "Revenue".to_string(),
        refers_to: "=Sheet1!$A$1:$A$10".to_string(),
        raw_refers_to: None,
        scope: Some("sheet1".to_string()),
        comment: Some("Annual revenue".to_string()),
        custom_menu: Some("Revenue menu".to_string()),
        description: Some("Revenue description".to_string()),
        help: Some("Revenue help".to_string()),
        status_bar: Some("Revenue status".to_string()),
        visible: true,
        xlm: false,
        function: false,
        vb_procedure: true,
        publish_to_server: true,
        workbook_parameter: true,
        xml_space_preserve: false,
        order: None,
        linked_range_id: None,
    };

    let json = serde_json::to_string(&dn).unwrap();
    let deserialized: DefinedName = serde_json::from_str(&json).unwrap();
    assert_eq!(dn, deserialized);
}

// -------------------------------------------------------------------
// Test 42: DefinedName serde with defaults (visible defaults to true)
// -------------------------------------------------------------------

#[test]
fn test_defined_name_serde_defaults() {
    let json = r#"{"id":"1","name":"Test","refersTo":"=A1"}"#;
    let dn: DefinedName = serde_json::from_str(json).unwrap();
    assert!(dn.visible);
    assert!(dn.scope.is_none());
    assert!(dn.comment.is_none());
}

// -------------------------------------------------------------------
// Test 43: Key generation
// -------------------------------------------------------------------

#[test]
fn test_key_generation() {
    assert_eq!(get_defined_name_key("Revenue", None), "REVENUE");
    assert_eq!(
        get_defined_name_key("Sales", Some("sheet1")),
        "SALES:sheet1"
    );
    assert_eq!(get_defined_name_key("lower", None), "LOWER");
}

// -------------------------------------------------------------------
// Test 44: Validate underscore-prefixed name -> valid
// -------------------------------------------------------------------

#[test]
fn test_validate_underscore_prefix() {
    let storage = make_storage();
    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "_internal",
        None,
        None,
    );
    assert!(result.valid);
}

// -------------------------------------------------------------------
// Test 45: Validate backslash-prefixed name -> valid
// -------------------------------------------------------------------

#[test]
fn test_validate_backslash_prefix() {
    let storage = make_storage();
    let result = validate_name(
        storage.doc(),
        storage.workbook_map(),
        "\\special",
        None,
        None,
    );
    assert!(result.valid);
}

// -------------------------------------------------------------------
// Test 46: Looks like cell reference helper
// -------------------------------------------------------------------

#[test]
fn test_looks_like_cell_reference() {
    assert!(looks_like_cell_reference("A1"));
    assert!(looks_like_cell_reference("XFD1048576"));
    assert!(looks_like_cell_reference("AB123"));
    assert!(looks_like_cell_reference("Z99"));

    assert!(!looks_like_cell_reference(""));
    assert!(!looks_like_cell_reference("ABCD1")); // 4 letters
    assert!(!looks_like_cell_reference("A")); // no digit
    assert!(!looks_like_cell_reference("123")); // no letter
    assert!(!looks_like_cell_reference("Revenue")); // no digit at end
    assert!(!looks_like_cell_reference("A1B")); // letter after digit
}

// -------------------------------------------------------------------
// Test 48: Looks like R1C1 reference helper
// -------------------------------------------------------------------

#[test]
fn test_looks_like_r1c1_reference() {
    assert!(looks_like_r1c1_reference("R1C1"));
    assert!(looks_like_r1c1_reference("R100C200"));
    assert!(looks_like_r1c1_reference("r1c1")); // case insensitive

    assert!(!looks_like_r1c1_reference("RC"));
    assert!(!looks_like_r1c1_reference("R1C"));
    assert!(!looks_like_r1c1_reference("RC1"));
    assert!(!looks_like_r1c1_reference("Revenue"));
}
