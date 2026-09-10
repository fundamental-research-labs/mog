use cell_types::SheetPos;
use std::sync::Arc;
use value_types::{CellArray, CellValue};

use crate::cells::types::CellEntry;

use super::helpers::make_store;

#[test]
fn materialize_projection_skips_origin_but_touches_all_columns() {
    let (mut cell_store, sheet_id) = make_store();
    let origin = SheetPos::new(1, 1);
    let cell_id = cell_types::CellId::from_raw(800);
    cell_store.insert_cell(
        &sheet_id,
        cell_id,
        origin,
        CellEntry {
            value: CellValue::from("origin"),
        },
    );
    let before_col_1 = cell_store.col_version(&sheet_id, 1);
    let before_col_2 = cell_store.col_version(&sheet_id, 2);
    let array = CellValue::Array(Arc::new(CellArray::from_rows(vec![
        vec![CellValue::from("skip"), CellValue::from("right")],
        vec![CellValue::from("down"), CellValue::from("diag")],
    ])));

    cell_store.materialize_projection(&sheet_id, 1, 1, &array);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(
        cell_store.get_column_view(&sheet_id, 1).unwrap()[1],
        CellValue::from("origin")
    );
    assert_eq!(
        cell_store.get_column_view(&sheet_id, 2).unwrap()[1],
        CellValue::from("right")
    );
    assert_eq!(
        cell_store.get_column_view(&sheet_id, 1).unwrap()[2],
        CellValue::from("down")
    );
    assert_eq!(cell_store.col_version(&sheet_id, 1), before_col_1 + 1);
    assert_eq!(cell_store.col_version(&sheet_id, 2), before_col_2 + 1);
}

#[test]
fn empty_projection_does_not_create_column_state() {
    let (mut cell_store, sheet_id) = make_store();
    let empty = CellValue::Array(Arc::new(CellArray::new(Vec::new(), 3)));
    cell_store.materialize_projection(&sheet_id, 0, 0, &empty);
    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert!(sheet.projected_columns.is_empty());
    assert!(sheet.column_lengths.is_empty());
}

#[test]
fn projection_borrows_source_values_and_releases_them_on_clear() {
    let (mut cell_store, sheet_id) = make_store();
    let array = Arc::new(CellArray::from_rows(vec![
        vec![CellValue::from("anchor"), CellValue::from("right")],
        vec![CellValue::from("down"), CellValue::from("corner")],
    ]));
    cell_store.materialize_projection(&sheet_id, 10, 20, &CellValue::Array(array.clone()));
    assert!(std::ptr::eq(
        cell_store
            .get_cell_value_at(&sheet_id, SheetPos::new(11, 21))
            .unwrap(),
        array.get(1, 1).unwrap(),
    ));
    cell_store.clear_materialization(&sheet_id, 10, 20, 2, 2);
    assert!(
        cell_store
            .get_cell_value_at(&sheet_id, SheetPos::new(11, 21))
            .is_none()
    );
    assert_eq!(Arc::strong_count(&array), 1);
}
