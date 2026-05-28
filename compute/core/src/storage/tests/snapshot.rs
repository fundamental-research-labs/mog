use super::support::simple_snapshot;
use super::*;

#[test]
fn test_populate_from_snapshot() {
    let snap = simple_snapshot();
    let storage = YrsStorage::from_snapshot(snap.clone()).expect("from_snapshot should succeed");
    let mirror = CellMirror::from_snapshot(snap).unwrap();

    let order = storage.sheet_order();
    assert_eq!(order.len(), 1);
    let sheet_id = order[0];
    assert_eq!(
        sheet_id,
        SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    );

    let cell1 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").unwrap();
    assert_eq!(
        *mirror.get_cell_value(&cell1).unwrap(),
        CellValue::Number(FiniteF64::must(42.0))
    );

    let cell2 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").unwrap();
    assert_eq!(
        *mirror.get_cell_value(&cell2).unwrap(),
        CellValue::Text("Hello".into())
    );

    let cell3 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap();
    assert!(mirror.get_formula(&cell3).is_none());

    let (yrs_val, yrs_formula, _) = storage
        .read_cell_from_yrs(&sheet_id, &cell3)
        .expect("cell3 should be in yrs");
    assert_eq!(yrs_val, CellValue::Number(FiniteF64::must(100.0)));
    assert_eq!(yrs_formula, Some("=A1*2+16".to_string()));
}

#[test]
fn test_named_ranges_from_snapshot() {
    let snap = simple_snapshot();
    let mirror = CellMirror::from_snapshot(snap).unwrap();

    assert!(mirror.get_named_range("revenue").is_some());
    let nr = mirror.get_named_range("revenue").unwrap();
    assert_eq!(nr.refers_to.refs.len(), 1);
}

#[test]
fn test_tables_from_snapshot() {
    let snap = simple_snapshot();
    let mirror = CellMirror::from_snapshot(snap).unwrap();

    assert!(mirror.get_table("Sales").is_some());
    let t = mirror.get_table("Sales").unwrap();
    assert_eq!(t.columns.len(), 3);
    assert!(t.has_header_row);
}
