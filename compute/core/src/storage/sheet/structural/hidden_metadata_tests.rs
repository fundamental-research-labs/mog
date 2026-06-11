use std::sync::Arc;

use super::StructuralOps;
use crate::identity::GridIndex;
use crate::mirror::{CellMirror, SheetMirror};
use cell_types::{IdAllocator, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::schema::{
    KEY_CELLS, KEY_COL_ORDER, KEY_HIDDEN_COLS, KEY_HIDDEN_ROWS, KEY_ROW_ORDER,
};
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Array, ArrayPrelim, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

fn setup(rows: u32, cols: u32) -> (Doc, MapRef, GridIndex, CellMirror, SheetId) {
    let sheet_id = SheetId::from_raw(1);
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let doc = Doc::new();
    let sheets = doc.get_or_insert_map("sheets");
    let grid = GridIndex::new(sheet_id, rows, cols, Arc::new(IdAllocator::new()));

    {
        let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        let sheet = sheets.insert(
            &mut txn,
            &*sheet_hex,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
        sheet.insert(&mut txn, KEY_CELLS, MapPrelim::from([] as [(&str, Any); 0]));
        sheet.insert(
            &mut txn,
            KEY_HIDDEN_ROWS,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
        sheet.insert(
            &mut txn,
            KEY_HIDDEN_COLS,
            MapPrelim::from([] as [(&str, Any); 0]),
        );

        let row_order = sheet.insert(&mut txn, KEY_ROW_ORDER, ArrayPrelim::default());
        for row in 0..rows {
            let row_id = grid.row_id(row).expect("row id");
            let hex = id_to_hex(row_id.as_u128());
            row_order.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
        }

        let col_order = sheet.insert(&mut txn, KEY_COL_ORDER, ArrayPrelim::default());
        for col in 0..cols {
            let col_id = grid.col_id(col).expect("col id");
            let hex = id_to_hex(col_id.as_u128());
            col_order.push_back(&mut txn, Any::String(Arc::from(hex.as_str())));
        }
    }

    let mut mirror = CellMirror::new();
    mirror.add_sheet_mirror(
        sheet_id,
        "Sheet1".to_string(),
        SheetMirror::new(sheet_id, "Sheet1".to_string(), rows, cols),
    );

    (doc, sheets, grid, mirror, sheet_id)
}

fn set_hidden(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, key: &str, positions: &[u32]) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let Some(Out::YMap(sheet)) = sheets.get(&txn, &sheet_hex) else {
        return;
    };
    let Some(Out::YMap(hidden)) = sheet.get(&txn, key) else {
        return;
    };
    for pos in positions {
        hidden.insert(&mut txn, &*pos.to_string(), Any::Bool(true));
    }
}

fn hidden(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, key: &str) -> Vec<u32> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let Some(Out::YMap(sheet)) = sheets.get(&txn, &sheet_hex) else {
        return vec![];
    };
    let Some(Out::YMap(hidden)) = sheet.get(&txn, key) else {
        return vec![];
    };

    let mut positions = hidden
        .iter(&txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                key.parse::<u32>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    positions.sort_unstable();
    positions
}

#[test]
fn insert_columns_shifts_position_keyed_hidden_column_cache() {
    let (doc, sheets, mut grid, mut mirror, sheet_id) = setup(8, 8);
    set_hidden(&doc, &sheets, &sheet_id, KEY_HIDDEN_COLS, &[1, 2, 4]);

    StructuralOps::insert_cols(&doc, &sheets, &mut grid, &mut mirror, &sheet_id, 2, 2)
        .expect("insert cols");

    assert_eq!(
        hidden(&doc, &sheets, &sheet_id, KEY_HIDDEN_COLS),
        vec![1, 4, 6]
    );
}

#[test]
fn delete_columns_removes_and_shifts_position_keyed_hidden_column_cache() {
    let (doc, sheets, mut grid, mut mirror, sheet_id) = setup(8, 8);
    set_hidden(&doc, &sheets, &sheet_id, KEY_HIDDEN_COLS, &[1, 2, 4, 6]);

    StructuralOps::delete_cols(&doc, &sheets, &mut grid, &mut mirror, &sheet_id, 2, 2)
        .expect("delete cols");

    assert_eq!(
        hidden(&doc, &sheets, &sheet_id, KEY_HIDDEN_COLS),
        vec![1, 2, 4]
    );
}

#[test]
fn insert_rows_shifts_position_keyed_hidden_row_cache() {
    let (doc, sheets, mut grid, mut mirror, sheet_id) = setup(8, 8);
    set_hidden(&doc, &sheets, &sheet_id, KEY_HIDDEN_ROWS, &[0, 1, 3]);

    StructuralOps::insert_rows(&doc, &sheets, &mut grid, &mut mirror, &sheet_id, 1, 1)
        .expect("insert rows");

    assert_eq!(
        hidden(&doc, &sheets, &sheet_id, KEY_HIDDEN_ROWS),
        vec![0, 2, 4]
    );
}

#[test]
fn delete_rows_removes_and_shifts_position_keyed_hidden_row_cache() {
    let (doc, sheets, mut grid, mut mirror, sheet_id) = setup(8, 8);
    set_hidden(&doc, &sheets, &sheet_id, KEY_HIDDEN_ROWS, &[0, 1, 3, 5]);

    StructuralOps::delete_rows(&doc, &sheets, &mut grid, &mut mirror, &sheet_id, 1, 2)
        .expect("delete rows");

    assert_eq!(
        hidden(&doc, &sheets, &sheet_id, KEY_HIDDEN_ROWS),
        vec![0, 1, 3]
    );
}
