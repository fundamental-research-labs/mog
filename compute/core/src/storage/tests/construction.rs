use super::support::simple_snapshot;
use super::*;

#[test]
fn test_new_is_empty() {
    let storage = WorkbookStorage::new();
    assert!(storage.sheet_order().is_empty());
    assert!(storage.sheet_metadata.is_empty());
    assert!(storage.cell_metadata.is_empty());
}

#[test]
fn test_default_trait() {
    assert!(WorkbookStorage::default().sheet_order().is_empty());
}

#[test]
fn snapshot_initializes_native_sheet_metadata() {
    let snapshot = simple_snapshot();
    let storage = WorkbookStorage::from_snapshot(snapshot.clone()).unwrap();
    assert_eq!(storage.sheet_order().len(), snapshot.sheets.len());
    for (id, sheet) in storage.sheet_order().iter().zip(&snapshot.sheets) {
        assert_eq!(storage.sheet_metadata[id].name, sheet.name);
    }
}
