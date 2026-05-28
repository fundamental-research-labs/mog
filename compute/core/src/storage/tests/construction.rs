use super::support::simple_snapshot;
use super::*;

#[test]
fn test_new_creates_empty_schema() {
    let storage = YrsStorage::new();
    let mirror = CellMirror::new();

    let txn = storage.doc.transact();
    assert!(
        storage.workbook.get(&txn, KEY_SHEET_ORDER).is_none(),
        "sheetOrder should NOT be eagerly created in new()"
    );

    assert_eq!(storage.sheet_order().len(), 0);
    assert_eq!(mirror.sheet_ids().count(), 0);
}

#[test]
fn test_default_trait() {
    let storage = YrsStorage::default();
    let mirror = CellMirror::new();
    assert_eq!(storage.sheet_order().len(), 0);
    assert_eq!(mirror.sheet_ids().count(), 0);
}

#[test]
fn test_new_does_not_eagerly_create_workbook_domain_maps() {
    let storage = YrsStorage::new();
    let txn = storage.doc.transact();
    for key in [
        "workbookSettings",
        "namedRanges",
        "tables",
        "slicers",
        "powerQuery",
        "scenarios",
    ] {
        assert!(
            storage.workbook.get(&txn, key).is_none(),
            "workbook MUST NOT eagerly create '{}' map",
            key
        );
    }
}

#[test]
fn test_from_snapshot_does_not_eagerly_create_domain_maps() {
    let snap = simple_snapshot();
    let storage = YrsStorage::from_snapshot(snap).unwrap();

    let txn = storage.doc.transact();
    for key in [
        "workbookSettings",
        "namedRanges",
        "tables",
        "slicers",
        "powerQuery",
        "scenarios",
    ] {
        assert!(
            storage.workbook.get(&txn, key).is_none(),
            "workbook MUST NOT eagerly create '{}' map post-`from_snapshot` \
             (Provider Protocol fix)",
            key
        );
    }

    super::sheets::assert_from_snapshot_creates_all_sheet_domain_maps(&storage);
}
