use super::support::make_sheet_id;
use super::*;

#[test]
fn test_add_sheet() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);

    storage
        .add_sheet(&mut mirror, sheet_id, "MySheet", 100, 26)
        .expect("add_sheet should succeed");

    let order = storage.sheet_order();
    assert_eq!(order.len(), 1);
    assert_eq!(order[0], sheet_id);

    assert!(mirror.sheet_by_name("mysheet").is_some());

    let txn = storage.doc.transact();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    if let Some(Out::YMap(sheet_map)) = storage.sheets.get(&txn, &sheet_hex) {
        if let Some(Out::YMap(meta)) = sheet_map.get(&txn, KEY_PROPERTIES) {
            assert!(matches!(
                meta.get(&txn, KEY_NAME),
                Some(Out::Any(Any::String(_)))
            ));
        } else {
            panic!("meta map not found in sheet");
        }
        assert!(matches!(
            sheet_map.get(&txn, "rowOrder"),
            Some(Out::YArray(_))
        ));
        assert!(matches!(
            sheet_map.get(&txn, "colOrder"),
            Some(Out::YArray(_))
        ));
    } else {
        panic!("sheet map not found in yrs doc");
    }
}

#[test]
fn test_add_multiple_sheets_order_preserved() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let s1 = make_sheet_id(1);
    let s2 = make_sheet_id(2);
    let s3 = make_sheet_id(3);

    storage.add_sheet(&mut mirror, s1, "First", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s2, "Second", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s3, "Third", 10, 5).unwrap();

    let order = storage.sheet_order();
    assert_eq!(order, vec![s1, s2, s3]);
}

#[test]
fn test_remove_sheet() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let s1 = make_sheet_id(1);
    let s2 = make_sheet_id(2);

    storage.add_sheet(&mut mirror, s1, "Sheet1", 10, 5).unwrap();
    storage.add_sheet(&mut mirror, s2, "Sheet2", 10, 5).unwrap();
    assert_eq!(storage.sheet_order().len(), 2);

    storage.remove_sheet(&mut mirror, &s1);

    let order = storage.sheet_order();
    assert_eq!(order.len(), 1);
    assert_eq!(order[0], s2);

    assert!(mirror.sheet_by_name("sheet1").is_none());
    assert!(mirror.sheet_by_name("sheet2").is_some());

    let txn = storage.doc.transact();
    let s1_hex = id_to_hex(s1.as_u128());
    assert!(
        !matches!(storage.sheets.get(&txn, &s1_hex), Some(Out::YMap(_))),
        "sheet1 should be removed from yrs doc"
    );
}

#[test]
fn test_remove_nonexistent_sheet() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    storage.remove_sheet(&mut mirror, &make_sheet_id(999));
    assert_eq!(storage.sheet_order().len(), 0);
}

#[test]
fn test_add_sheet_creates_all_domain_maps() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    let txn = storage.doc.transact();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match storage.sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet map not found"),
    };

    for key in [
        "cells",
        "cellProperties",
        "rowHeights",
        "colWidths",
        "schemas",
        "pivotTables",
        "merges",
        "hiddenRows",
        "hiddenCols",
        "rowFormats",
        "colFormats",
        "comments",
        "filters",
        "sparklines",
        "conditionalFormat",
        "bindings",
        "grouping",
        "sorting",
        "floatingObjects",
        "floatingObjectGroups",
    ] {
        assert!(
            sheet_map.get(&txn, key).is_some(),
            "sheet should have '{}' map",
            key
        );
    }
    assert!(
        matches!(sheet_map.get(&txn, "rowOrder"), Some(Out::YArray(_))),
        "sheet should have 'rowOrder' YArray"
    );
    assert!(
        matches!(sheet_map.get(&txn, "colOrder"), Some(Out::YArray(_))),
        "sheet should have 'colOrder' YArray"
    );
}

pub(super) fn assert_from_snapshot_creates_all_sheet_domain_maps(storage: &YrsStorage) {
    let txn = storage.doc.transact();
    let order = storage.sheet_order();
    let sheet_hex = id_to_hex(order[0].as_u128());
    let sheet_map = match storage.sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet map not found"),
    };

    for key in [
        "merges",
        "mergeBackups",
        "hiddenRows",
        "hiddenCols",
        "rowFormats",
        "colFormats",
        "comments",
        "filters",
        "sparklines",
        "conditionalFormat",
        "bindings",
        "grouping",
        "sorting",
    ] {
        assert!(
            sheet_map.get(&txn, key).is_some(),
            "sheet should have '{}' map after from_snapshot",
            key
        );
    }
    assert!(
        matches!(sheet_map.get(&txn, "rowOrder"), Some(Out::YArray(_))),
        "sheet should have 'rowOrder' YArray after from_snapshot"
    );
    assert!(
        matches!(sheet_map.get(&txn, "colOrder"), Some(Out::YArray(_))),
        "sheet should have 'colOrder' YArray after from_snapshot"
    );
}
