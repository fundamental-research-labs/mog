use std::sync::Arc;

use super::*;
use crate::storage::YrsStorage;
use compute_document::schema::KEY_BINDINGS;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Any, Map, MapPrelim, Origin, Out, Transact};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/// Create a YrsStorage with one sheet and return (storage, sheet_hex).
fn storage_with_sheet() -> (YrsStorage, String) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = cell_types::SheetId::from_raw(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");
    let sheet_hex = format!("{:032x}", 1u128);
    (storage, sheet_hex)
}

/// Create a YrsStorage with two sheets and return (storage, sheet1_hex, sheet2_hex).
fn storage_with_two_sheets() -> (YrsStorage, String, String) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let s1 = cell_types::SheetId::from_raw(1);
    let s2 = cell_types::SheetId::from_raw(2);
    storage
        .add_sheet(&mut mirror, s1, "Sheet1", 100, 26)
        .unwrap();
    storage
        .add_sheet(&mut mirror, s2, "Sheet2", 100, 26)
        .unwrap();
    let hex1 = format!("{:032x}", 1u128);
    let hex2 = format!("{:032x}", 2u128);
    (storage, hex1, hex2)
}

fn sample_mappings() -> Vec<ColumnMapping> {
    vec![
        ColumnMapping {
            column_index: 0,
            data_path: "name".to_string(),
            header_text: Some("Name".to_string()),
        },
        ColumnMapping {
            column_index: 1,
            data_path: "value".to_string(),
            header_text: None,
        },
    ]
}

// -------------------------------------------------------------------
// Test 1: Create binding with default options
// -------------------------------------------------------------------

#[test]
fn test_create_binding_default_options() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let binding = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .expect("create should succeed");

    assert!(binding.id.starts_with("sdb-"));
    assert_eq!(binding.sheet_id, sheet_hex);
    assert_eq!(binding.connection_id, "conn-1");
    assert_eq!(binding.column_mappings.len(), 2);
    assert!(binding.auto_generate_rows);
    assert_eq!(binding.header_row, 0);
    assert_eq!(binding.data_start_row, 1);
    assert!(binding.preserve_header_formatting);
    assert!(binding.last_refresh.is_none());
    assert!(binding.last_row_count.is_none());
}

// -------------------------------------------------------------------
// Test 2: Create binding with custom options
// -------------------------------------------------------------------

#[test]
fn test_create_binding_custom_options() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let options = CreateBindingOptions {
        auto_generate_rows: Some(false),
        header_row: Some(-1),
        data_start_row: Some(5),
        preserve_header_formatting: Some(false),
    };

    let binding = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-2",
        sample_mappings(),
        options,
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert!(!binding.auto_generate_rows);
    assert_eq!(binding.header_row, -1);
    assert_eq!(binding.data_start_row, 5);
    assert!(!binding.preserve_header_formatting);
}

// -------------------------------------------------------------------
// Test 3: Create binding fails for invalid sheet
// -------------------------------------------------------------------

#[test]
fn test_create_binding_invalid_sheet() {
    let storage = YrsStorage::new();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let result = create_binding(
        doc,
        sheets,
        "nonexistent-sheet",
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    );

    assert!(result.is_err());
    match result.unwrap_err() {
        ComputeError::SheetNotFound { sheet_id } => {
            assert_eq!(sheet_id, "nonexistent-sheet");
        }
        other => panic!("Expected SheetNotFound, got {:?}", other),
    }
}

// -------------------------------------------------------------------
// Test 4: Get all bindings from empty sheet
// -------------------------------------------------------------------

#[test]
fn test_get_all_bindings_empty() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let bindings = get_all_bindings(doc, sheets, &sheet_hex);
    assert!(bindings.is_empty());
}

// -------------------------------------------------------------------
// Test 5: Get all bindings with one binding
// -------------------------------------------------------------------

#[test]
fn test_get_all_bindings_one() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let bindings = get_all_bindings(doc, sheets, &sheet_hex);
    assert_eq!(bindings.len(), 1);
    assert_eq!(bindings[0].connection_id, "conn-1");
}

// -------------------------------------------------------------------
// Test 6: Get all bindings with multiple bindings
// -------------------------------------------------------------------

#[test]
fn test_get_all_bindings_multiple() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    for i in 0..3 {
        create_binding(
            doc,
            sheets,
            &sheet_hex,
            &format!("conn-{}", i),
            sample_mappings(),
            CreateBindingOptions::default(),
            &crate::storage::STORAGE_ID_ALLOC,
        )
        .unwrap();
    }

    let bindings = get_all_bindings(doc, sheets, &sheet_hex);
    assert_eq!(bindings.len(), 3);
}

// -------------------------------------------------------------------
// Test 7: Get all bindings for nonexistent sheet returns empty
// -------------------------------------------------------------------

#[test]
fn test_get_all_bindings_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let bindings = get_all_bindings(doc, sheets, "no-such-sheet");
    assert!(bindings.is_empty());
}

// -------------------------------------------------------------------
// Test 8: Get specific binding (found)
// -------------------------------------------------------------------

#[test]
fn test_get_binding_found() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let created = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let binding = get_binding(doc, sheets, &sheet_hex, &created.id);
    assert!(binding.is_some());
    let binding = binding.unwrap();
    assert_eq!(binding.id, created.id);
    assert_eq!(binding.connection_id, "conn-1");
}

// -------------------------------------------------------------------
// Test 9: Get specific binding (not found)
// -------------------------------------------------------------------

#[test]
fn test_get_binding_not_found() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let binding = get_binding(doc, sheets, &sheet_hex, "nonexistent-binding");
    assert!(binding.is_none());
}

// -------------------------------------------------------------------
// Test 10: Get bindings for connection across sheets
// -------------------------------------------------------------------

#[test]
fn test_get_bindings_for_connection() {
    let (storage, hex1, hex2) = storage_with_two_sheets();
    let doc = storage.doc();
    let sheets = storage.sheets();

    // Create bindings on both sheets for the same connection
    create_binding(
        doc,
        sheets,
        &hex1,
        "shared-conn",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    create_binding(
        doc,
        sheets,
        &hex2,
        "shared-conn",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    // Also create a binding for a different connection
    create_binding(
        doc,
        sheets,
        &hex1,
        "other-conn",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let bindings = get_bindings_for_connection(doc, sheets, "shared-conn");
    assert_eq!(bindings.len(), 2);
    assert!(bindings.iter().all(|b| b.connection_id == "shared-conn"));
}

// -------------------------------------------------------------------
// Test 11: Get bindings for connection with no matches
// -------------------------------------------------------------------

#[test]
fn test_get_bindings_for_connection_none() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let bindings = get_bindings_for_connection(doc, sheets, "nonexistent-conn");
    assert!(bindings.is_empty());
}

// -------------------------------------------------------------------
// Test 12: Update binding fields
// -------------------------------------------------------------------

#[test]
fn test_update_binding() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let created = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let updated = update_binding(
        doc,
        sheets,
        &sheet_hex,
        &created.id,
        UpdateBindingFields {
            connection_id: Some("conn-2".to_string()),
            auto_generate_rows: Some(false),
            header_row: Some(3),
            ..Default::default()
        },
    );

    assert!(updated.is_some());
    let updated = updated.unwrap();
    assert_eq!(updated.id, created.id);
    assert_eq!(updated.connection_id, "conn-2");
    assert!(!updated.auto_generate_rows);
    assert_eq!(updated.header_row, 3);
    // Unchanged fields
    assert_eq!(updated.data_start_row, 1);
    assert!(updated.preserve_header_formatting);
}

// -------------------------------------------------------------------
// Test 13: Update binding column mappings
// -------------------------------------------------------------------

#[test]
fn test_update_binding_column_mappings() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let created = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();
    assert_eq!(created.column_mappings.len(), 2);

    let new_mappings = vec![ColumnMapping {
        column_index: 5,
        data_path: "total".to_string(),
        header_text: Some("Total".to_string()),
    }];

    let updated = update_binding(
        doc,
        sheets,
        &sheet_hex,
        &created.id,
        UpdateBindingFields {
            column_mappings: Some(new_mappings),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(updated.column_mappings.len(), 1);
    assert_eq!(updated.column_mappings[0].column_index, 5);
    assert_eq!(updated.column_mappings[0].data_path, "total");
}

// -------------------------------------------------------------------
// Test 14: Update binding not found
// -------------------------------------------------------------------

#[test]
fn test_update_binding_not_found() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let result = update_binding(
        doc,
        sheets,
        &sheet_hex,
        "nonexistent",
        UpdateBindingFields {
            connection_id: Some("x".to_string()),
            ..Default::default()
        },
    );

    assert!(result.is_none());
}

// -------------------------------------------------------------------
// Test 15: Update refresh metadata
// -------------------------------------------------------------------

#[test]
fn test_update_refresh_metadata() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let created = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert!(created.last_refresh.is_none());
    assert!(created.last_row_count.is_none());

    update_refresh_metadata(doc, sheets, &sheet_hex, &created.id, 1700000000000, 42);

    let binding = get_binding(doc, sheets, &sheet_hex, &created.id).unwrap();
    assert_eq!(binding.last_refresh, Some(1700000000000));
    assert_eq!(binding.last_row_count, Some(42));
}

// -------------------------------------------------------------------
// Test 16: Update refresh metadata for nonexistent binding (no-op)
// -------------------------------------------------------------------

#[test]
fn test_update_refresh_metadata_nonexistent() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    // Should not panic
    update_refresh_metadata(doc, sheets, &sheet_hex, "nonexistent", 123, 0);
}

// -------------------------------------------------------------------
// Test 17: Remove binding (found)
// -------------------------------------------------------------------

#[test]
fn test_remove_binding_found() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let created = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let removed = remove_binding(doc, sheets, &sheet_hex, &created.id);
    assert!(removed);

    // Verify it's gone
    let binding = get_binding(doc, sheets, &sheet_hex, &created.id);
    assert!(binding.is_none());
    assert!(get_all_bindings(doc, sheets, &sheet_hex).is_empty());
}

// -------------------------------------------------------------------
// Test 18: Remove binding (not found)
// -------------------------------------------------------------------

#[test]
fn test_remove_binding_not_found() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let removed = remove_binding(doc, sheets, &sheet_hex, "nonexistent");
    assert!(!removed);
}

// -------------------------------------------------------------------
// Test 19: Remove binding from nonexistent sheet
// -------------------------------------------------------------------

#[test]
fn test_remove_binding_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let removed = remove_binding(doc, sheets, "no-sheet", "no-binding");
    assert!(!removed);
}

// -------------------------------------------------------------------
// Test 20: Remove bindings for connection across sheets
// -------------------------------------------------------------------

#[test]
fn test_remove_bindings_for_connection() {
    let (storage, hex1, hex2) = storage_with_two_sheets();
    let doc = storage.doc();
    let sheets = storage.sheets();

    // Create 2 bindings for "shared-conn" and 1 for "other-conn"
    create_binding(
        doc,
        sheets,
        &hex1,
        "shared-conn",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    create_binding(
        doc,
        sheets,
        &hex2,
        "shared-conn",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    create_binding(
        doc,
        sheets,
        &hex1,
        "other-conn",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let removed_count = remove_bindings_for_connection(doc, sheets, "shared-conn");
    assert_eq!(removed_count, 2);

    // Verify shared-conn bindings are gone
    assert!(get_bindings_for_connection(doc, sheets, "shared-conn").is_empty());

    // other-conn still has its binding
    let remaining = get_all_bindings(doc, sheets, &hex1);
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].connection_id, "other-conn");
}

// -------------------------------------------------------------------
// Test 21: Remove bindings for connection with no matches
// -------------------------------------------------------------------

#[test]
fn test_remove_bindings_for_connection_none() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let removed_count = remove_bindings_for_connection(doc, sheets, "nonexistent-conn");
    assert_eq!(removed_count, 0);

    // Original binding still exists
    assert_eq!(get_all_bindings(doc, sheets, &sheet_hex).len(), 1);
}

// -------------------------------------------------------------------
// Test 22: Create binding with empty column mappings
// -------------------------------------------------------------------

#[test]
fn test_create_binding_empty_mappings() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let binding = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        vec![],
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert!(binding.column_mappings.is_empty());

    // Should still be retrievable
    let fetched = get_binding(doc, sheets, &sheet_hex, &binding.id).unwrap();
    assert!(fetched.column_mappings.is_empty());
}

// -------------------------------------------------------------------
// Test 23: Multiple bindings on same sheet have unique IDs
// -------------------------------------------------------------------

#[test]
fn test_unique_binding_ids() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let b1 = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let b2 = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-2",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert_ne!(b1.id, b2.id);
    assert!(b1.id.starts_with("sdb-"));
    assert!(b2.id.starts_with("sdb-"));
}

// -------------------------------------------------------------------
// Test 24: Binding serde roundtrip
// -------------------------------------------------------------------

#[test]
fn test_binding_serde_roundtrip() {
    let binding = SheetDataBinding {
        id: "sdb-test".to_string(),
        sheet_id: "sheet-1".to_string(),
        connection_id: "conn-1".to_string(),
        column_mappings: vec![
            ColumnMapping {
                column_index: 0,
                data_path: "name".to_string(),
                header_text: Some("Name".to_string()),
            },
            ColumnMapping {
                column_index: 1,
                data_path: "items[0].value".to_string(),
                header_text: None,
            },
        ],
        auto_generate_rows: true,
        header_row: 0,
        data_start_row: 1,
        preserve_header_formatting: true,
        last_refresh: Some(1700000000000),
        last_row_count: Some(100),
    };

    let json = serde_json::to_string(&binding).unwrap();
    let deserialized: SheetDataBinding = serde_json::from_str(&json).unwrap();
    assert_eq!(binding, deserialized);
}

// -------------------------------------------------------------------
// Test 25: ColumnMapping serde roundtrip
// -------------------------------------------------------------------

#[test]
fn test_column_mapping_serde_roundtrip() {
    let mapping = ColumnMapping {
        column_index: 5,
        data_path: "nested.path[0]".to_string(),
        header_text: Some("Header".to_string()),
    };

    let json = serde_json::to_string(&mapping).unwrap();
    let deserialized: ColumnMapping = serde_json::from_str(&json).unwrap();
    assert_eq!(mapping, deserialized);
}

// -------------------------------------------------------------------
// Test 26: Create and remove, then create again
// -------------------------------------------------------------------

#[test]
fn test_create_remove_create_again() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let b1 = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert!(remove_binding(doc, sheets, &sheet_hex, &b1.id));
    assert!(get_all_bindings(doc, sheets, &sheet_hex).is_empty());

    let b2 = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    assert_ne!(b1.id, b2.id);
    assert_eq!(get_all_bindings(doc, sheets, &sheet_hex).len(), 1);
}

// -------------------------------------------------------------------
// Test 27: Update preserves id and sheet_id
// -------------------------------------------------------------------

#[test]
fn test_update_preserves_immutable_fields() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let created = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions::default(),
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    let updated = update_binding(
        doc,
        sheets,
        &sheet_hex,
        &created.id,
        UpdateBindingFields {
            connection_id: Some("conn-99".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    // id and sheet_id should remain the same
    assert_eq!(updated.id, created.id);
    assert_eq!(updated.sheet_id, created.sheet_id);
    assert_eq!(updated.connection_id, "conn-99");
}

// -------------------------------------------------------------------
// Test 28: Update refresh metadata preserves other fields
// -------------------------------------------------------------------

#[test]
fn test_update_refresh_metadata_preserves_fields() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    let created = create_binding(
        doc,
        sheets,
        &sheet_hex,
        "conn-1",
        sample_mappings(),
        CreateBindingOptions {
            auto_generate_rows: Some(false),
            header_row: Some(5),
            data_start_row: Some(10),
            preserve_header_formatting: Some(false),
        },
        &crate::storage::STORAGE_ID_ALLOC,
    )
    .unwrap();

    update_refresh_metadata(doc, sheets, &sheet_hex, &created.id, 999, 50);

    let binding = get_binding(doc, sheets, &sheet_hex, &created.id).unwrap();
    // Refresh metadata updated
    assert_eq!(binding.last_refresh, Some(999));
    assert_eq!(binding.last_row_count, Some(50));
    // Other fields preserved
    assert!(!binding.auto_generate_rows);
    assert_eq!(binding.header_row, 5);
    assert_eq!(binding.data_start_row, 10);
    assert!(!binding.preserve_header_formatting);
    assert_eq!(binding.connection_id, "conn-1");
    assert_eq!(binding.column_mappings.len(), 2);
}

// -------------------------------------------------------------------
// Test 29: Get binding from nonexistent sheet returns None
// -------------------------------------------------------------------

#[test]
fn test_get_binding_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let binding = get_binding(doc, sheets, "no-sheet", "no-binding");
    assert!(binding.is_none());
}

// -------------------------------------------------------------------
// Test 30: Remove bindings for connection on empty storage
// -------------------------------------------------------------------

#[test]
fn test_remove_bindings_for_connection_empty_storage() {
    let storage = YrsStorage::new();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let count = remove_bindings_for_connection(doc, sheets, "some-conn");
    assert_eq!(count, 0);
}

#[test]
fn test_malformed_binding_values_are_skipped() {
    let (storage, sheet_hex) = storage_with_sheet();
    let doc = storage.doc();
    let sheets = storage.sheets();

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let sheet_map = match sheets.get(&txn, sheet_hex.as_str()).unwrap() {
            Out::YMap(m) => m,
            _ => panic!("sheet should be a map"),
        };
        let bindings_map = match sheet_map.get(&txn, KEY_BINDINGS).unwrap() {
            Out::YMap(m) => m,
            _ => panic!("bindings should be a map"),
        };

        bindings_map.insert(&mut txn, "not-a-map", Any::Bool(true));
        bindings_map.insert(
            &mut txn,
            "missing-id",
            MapPrelim::from([(
                "connectionId",
                Any::String(Arc::from("conn-with-missing-id")),
            )]),
        );
    }

    assert!(get_all_bindings(doc, sheets, &sheet_hex).is_empty());
    assert!(get_binding(doc, sheets, &sheet_hex, "not-a-map").is_none());
    assert!(get_binding(doc, sheets, &sheet_hex, "missing-id").is_none());
    assert!(get_bindings_for_connection(doc, sheets, "conn-with-missing-id").is_empty());
    assert_eq!(
        remove_bindings_for_connection(doc, sheets, "conn-with-missing-id"),
        0
    );
}

#[test]
fn test_connection_scans_skip_non_map_shapes() {
    let storage = YrsStorage::new();
    let doc = storage.doc();
    let sheets = storage.sheets();

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        sheets.insert(&mut txn, "not-a-sheet-map", Any::Bool(true));
        sheets.insert(
            &mut txn,
            "sheet-with-non-map-bindings",
            MapPrelim::from([(KEY_BINDINGS, Any::Bool(true))]),
        );
    }

    assert!(get_bindings_for_connection(doc, sheets, "conn-1").is_empty());
    assert_eq!(remove_bindings_for_connection(doc, sheets, "conn-1"), 0);
}
