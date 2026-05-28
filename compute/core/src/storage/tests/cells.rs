use super::support::{make_cell_id, make_sheet_id};
use super::*;

#[test]
fn test_cell_write_and_read() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(100);

    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        None,
        None,
    );

    let val = mirror.get_cell_value(&cell_id);
    assert!(val.is_some());
    assert_eq!(*val.unwrap(), CellValue::Number(FiniteF64::must(42.0)));

    let val_at = mirror.get_cell_value_at(&sheet_id, SheetPos::new(0, 0));
    assert_eq!(*val_at.unwrap(), CellValue::Number(FiniteF64::must(42.0)));

    assert!(mirror.get_formula(&cell_id).is_none());
}

#[test]
fn test_cell_write_with_formula() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(200);

    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(100.0)),
        Some("=A1*2+16".to_string()),
        None,
    );

    assert!(mirror.get_formula(&cell_id).is_none());

    let (yrs_val, yrs_formula, _) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist in yrs");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(100.0)));
    assert_eq!(yrs_formula, Some("=A1*2+16".to_string()));
}

#[test]
fn test_remove_cell() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(300);

    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(99.0)),
        None,
        None,
    );
    assert!(mirror.get_cell_value(&cell_id).is_some());

    storage.remove_cell(&mut mirror, &sheet_id, &cell_id);

    assert!(mirror.get_cell_value(&cell_id).is_none());
    assert!(storage.read_cell_from_yrs(&sheet_id, &cell_id).is_none());
}

#[test]
fn test_cell_value_types() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    let c1 = make_cell_id(401);
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        c1,
        0,
        0,
        CellValue::Boolean(true),
        None,
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&c1).unwrap(),
        CellValue::Boolean(true)
    );

    let c2 = make_cell_id(402);
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        c2,
        0,
        1,
        CellValue::Text("world".into()),
        None,
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&c2).unwrap(),
        CellValue::Text("world".into())
    );

    let c3 = make_cell_id(403);
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        c3,
        0,
        2,
        CellValue::Error(CellError::Div0, None),
        None,
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&c3).unwrap(),
        CellValue::Error(CellError::Div0, None)
    );

    let c4 = make_cell_id(404);
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        c4,
        0,
        3,
        CellValue::Null,
        None,
        None,
    );
    assert_eq!(*mirror.get_cell_value(&c4).unwrap(), CellValue::Null);
}

#[test]
fn test_overwrite_cell() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    let cell_id = make_cell_id(500);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&cell_id).unwrap(),
        CellValue::Number(FiniteF64::must(1.0))
    );

    storage.set_cell(
        &mut mirror,
        &sheet_id,
        cell_id,
        0,
        0,
        CellValue::Number(FiniteF64::must(99.0)),
        Some("=SUM(A1:A10)".to_string()),
        None,
    );
    assert_eq!(
        *mirror.get_cell_value(&cell_id).unwrap(),
        CellValue::Number(FiniteF64::must(99.0))
    );
    assert!(mirror.get_formula(&cell_id).is_none());

    let (yrs_val, yrs_formula, _) = storage
        .read_cell_from_yrs(&sheet_id, &cell_id)
        .expect("cell should exist");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(99.0)));
    assert_eq!(yrs_formula, Some("=SUM(A1:A10)".to_string()));
}

#[test]
fn test_yrs_doc_consistency() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    for i in 0..5u128 {
        let cell_id = make_cell_id(1000 + i);
        storage.set_cell(
            &mut mirror,
            &sheet_id,
            cell_id,
            i as u32,
            0,
            CellValue::Number(FiniteF64::must(i as f64)),
            None,
            None,
        );
    }

    for i in 0..5u128 {
        let cell_id = make_cell_id(1000 + i);
        let (val, _, _) = storage
            .read_cell_from_yrs(&sheet_id, &cell_id)
            .expect("cell should exist in yrs");
        assert_eq!(val, CellValue::Number(FiniteF64::must(i as f64)));
    }
}

#[test]
fn test_remove_nonexistent_cell() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    storage.remove_cell(&mut mirror, &sheet_id, &make_cell_id(999));
}

#[test]
fn test_read_cell_from_empty_sheet() {
    let mut storage = YrsStorage::new();
    let mut mirror = CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 10, 5)
        .unwrap();

    assert!(mirror.get_cell_value(&make_cell_id(999)).is_none());
    assert!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(0, 0))
            .is_none()
    );
    assert!(mirror.get_formula(&make_cell_id(999)).is_none());
    assert!(
        storage
            .read_cell_from_yrs(&sheet_id, &make_cell_id(999))
            .is_none()
    );
}
