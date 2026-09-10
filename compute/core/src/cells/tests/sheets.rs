use crate::cells::test_helpers::{make_sheet_id, simple_snapshot, store_with_grid};
use crate::cells::{CellStore, SheetStore};
use cell_types::SheetId;

#[test]
fn test_remove_sheet() {
    let (mut cell_store, sheet_id) = store_with_grid();
    let grid = compute_document::identity::GridIndex::new(
        sheet_id,
        10,
        5,
        std::sync::Arc::new(cell_types::IdAllocator::new()),
    );
    cell_store.install_sheet_axes(sheet_id, grid.row_axis(), grid.col_axis());
    let row = cell_store
        .get_sheet(&sheet_id)
        .unwrap()
        .row_id_at(0)
        .unwrap();
    let col = cell_store
        .get_sheet(&sheet_id)
        .unwrap()
        .col_id_at(0)
        .unwrap();
    cell_store.remove_sheet(&sheet_id);

    assert!(cell_store.get_sheet(&sheet_id).is_none());
    assert!(cell_store.sheet_by_name("Grid").is_none());
    assert_eq!(cell_store.row_index_lookup(&row), None);
    assert_eq!(cell_store.col_index_lookup(&col), None);
    assert!(cell_store.row_to_sheet.is_empty());
    assert!(cell_store.col_to_sheet.is_empty());
    assert!(cell_store.row_run_sheets.is_empty());
    assert!(cell_store.col_run_sheets.is_empty());
}
#[test]
fn test_rename_sheet() {
    let (mut cell_store, sheet_id) = store_with_grid();
    cell_store.rename_sheet(&sheet_id, "Renamed");

    assert!(cell_store.sheet_by_name("Grid").is_none());
    assert_eq!(cell_store.sheet_by_name("renamed").unwrap(), sheet_id);
    assert_eq!(cell_store.get_sheet(&sheet_id).unwrap().name, "Renamed");
}
#[test]
fn test_sheet_name_case_insensitive() {
    let (cell_store, sheet_id) = store_with_grid();
    assert_eq!(cell_store.sheet_by_name("grid"), Some(sheet_id));
    assert_eq!(cell_store.sheet_by_name("GRID"), Some(sheet_id));
    assert_eq!(cell_store.sheet_by_name("Grid"), Some(sheet_id));
    assert_eq!(cell_store.sheet_by_name("gRiD"), Some(sheet_id));
}
#[test]
fn test_sheet_ids_iterator() {
    let snap = simple_snapshot();
    let cell_store = CellStore::from_snapshot(snap).unwrap();
    let ids: Vec<&SheetId> = cell_store.sheet_ids().collect();
    assert_eq!(ids.len(), 1);
}
#[test]
fn test_remove_nonexistent_sheet() {
    let (mut cell_store, _) = store_with_grid();
    // Should not panic
    cell_store.remove_sheet(&make_sheet_id(999));
}
#[test]
fn test_rename_nonexistent_sheet() {
    let mut cell_store = CellStore::new();
    // Should not panic
    cell_store.rename_sheet(&make_sheet_id(999), "NewName");
}
#[test]
fn test_sheet_name_nfc_nfd_normalization() {
    // "cafe\u{0301}" is NFD (e + combining acute), "caf\u{00e9}" is NFC (precomposed e-acute).
    // Both should resolve to the same sheet.
    let nfc_name = "caf\u{00e9}"; // NFC: é = U+00E9
    let nfd_name = "cafe\u{0301}"; // NFD: e + combining acute U+0301

    // Verify they are indeed different byte sequences
    assert_ne!(nfc_name, nfd_name);

    let sheet_id = make_sheet_id(42);
    let mut cell_store = CellStore::new();
    let sheet_store = SheetStore::new(sheet_id, nfc_name.to_string(), 10, 5);
    cell_store.add_sheet_store(sheet_id, nfc_name.to_string(), sheet_store);

    // Look up with NFC name (same encoding as stored)
    assert_eq!(cell_store.sheet_by_name(nfc_name), Some(sheet_id));
    // Look up with NFD name (different encoding)
    assert_eq!(cell_store.sheet_by_name(nfd_name), Some(sheet_id));
    // Case-insensitive + NFC: uppercase NFD should also work
    let upper_nfd = "CAFE\u{0301}";
    assert_eq!(cell_store.sheet_by_name(upper_nfd), Some(sheet_id));
}
#[test]
fn test_sheet_name_nfc_hebrew() {
    // Hebrew with nikud (vowel points) — NFC vs NFD can differ
    // U+05E9 (shin) + U+05C1 (shin dot) = NFC shin-with-dot U+FB2A
    let nfc_name = "\u{FB2A}"; // Precomposed: shin with shin dot
    let nfd_name = "\u{05E9}\u{05C1}"; // Decomposed: shin + shin dot

    let sheet_id = make_sheet_id(43);
    let mut cell_store = CellStore::new();
    let sheet_store = SheetStore::new(sheet_id, nfc_name.to_string(), 10, 5);
    cell_store.add_sheet_store(sheet_id, nfc_name.to_string(), sheet_store);

    assert_eq!(cell_store.sheet_by_name(nfc_name), Some(sheet_id));
    assert_eq!(cell_store.sheet_by_name(nfd_name), Some(sheet_id));
}
#[test]
fn test_rename_sheet_nfc_normalization() {
    let nfc_name = "caf\u{00e9}";
    let nfd_name = "cafe\u{0301}";

    let sheet_id = make_sheet_id(44);
    let mut cell_store = CellStore::new();
    let sheet_store = SheetStore::new(sheet_id, "OldName".to_string(), 10, 5);
    cell_store.add_sheet_store(sheet_id, "OldName".to_string(), sheet_store);

    // Rename to NFC name
    cell_store.rename_sheet(&sheet_id, nfc_name);
    // Should be findable via NFD name
    assert_eq!(cell_store.sheet_by_name(nfd_name), Some(sheet_id));
    // Old name should be gone
    assert!(cell_store.sheet_by_name("OldName").is_none());
}
#[test]
fn test_remove_sheet_nfc_normalization() {
    let nfc_name = "caf\u{00e9}";
    let nfd_name = "cafe\u{0301}";

    let sheet_id = make_sheet_id(45);
    let mut cell_store = CellStore::new();
    let sheet_store = SheetStore::new(sheet_id, nfc_name.to_string(), 10, 5);
    cell_store.add_sheet_store(sheet_id, nfc_name.to_string(), sheet_store);

    // Verify it exists
    assert_eq!(cell_store.sheet_by_name(nfd_name), Some(sheet_id));

    // Remove it
    cell_store.remove_sheet(&sheet_id);

    // Should be gone for both encodings
    assert!(cell_store.sheet_by_name(nfc_name).is_none());
    assert!(cell_store.sheet_by_name(nfd_name).is_none());
}
