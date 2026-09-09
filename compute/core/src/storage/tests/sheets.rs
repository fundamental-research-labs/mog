use super::support::make_sheet_id;
use super::*;

#[test]
fn test_add_sheet() {
    let mut storage = WorkbookStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);

    storage
        .add_sheet(&mut mirror, sheet_id, "MySheet", 100, 26)
        .expect("add_sheet should succeed");

    let order = storage.sheet_order();
    assert_eq!(order.len(), 1);
    assert_eq!(order[0], sheet_id);

    assert!(mirror.sheet_by_name("mysheet").is_some());

    assert_eq!(storage.sheet_metadata[&sheet_id].name, "MySheet");
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.grid_rows, 100);
    assert_eq!(sheet.grid_cols, 26);
}

#[test]
fn test_add_multiple_sheets_order_preserved() {
    let mut storage = WorkbookStorage::new();
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
    let mut storage = WorkbookStorage::new();
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

    assert!(!storage.sheet_metadata.contains_key(&s1));
}

#[test]
fn test_remove_nonexistent_sheet() {
    let mut storage = WorkbookStorage::new();
    let mut mirror = CellMirror::new();
    storage.remove_sheet(&mut mirror, &make_sheet_id(999));
    assert_eq!(storage.sheet_order().len(), 0);
}
