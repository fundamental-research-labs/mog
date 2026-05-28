use yrs::{Any, Map, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_CELLS, KEY_COMMENTS, KEY_GRID_ID_TO_POS, KEY_GRID_INDEX};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::comment::{Comment, RichTextRun};
use domain_types::yrs_schema::comment as comment_schema;

use crate::storage::YrsStorage;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn storage_with_sheet() -> (YrsStorage, SheetId) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");
    (storage, sheet_id)
}

pub(super) fn simple_runs(text: &str) -> Vec<RichTextRun> {
    vec![RichTextRun {
        text: text.to_string(),
        ..Default::default()
    }]
}

pub(super) fn add_cell_to_sheet(storage: &YrsStorage, sheet_id: &SheetId, cell_id_key: &str) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sheet_map = match storage.sheets_ref().get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet not found"),
    };
    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(m)) => m,
        _ => panic!("cells map not found"),
    };
    let cell_prelim = yrs::MapPrelim::from([("v", Any::Number(0.0))]);
    cells_map.insert(&mut txn, cell_id_key, cell_prelim);
}

pub(super) fn add_grid_index_cell(storage: &YrsStorage, sheet_id: &SheetId, cell_id_key: &str) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sheet_map = match storage.sheets_ref().get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet not found"),
    };
    let grid_index = match sheet_map.get(&txn, KEY_GRID_INDEX) {
        Some(Out::YMap(m)) => m,
        _ => panic!("grid index not found"),
    };
    let id_to_pos = match grid_index.get(&txn, KEY_GRID_ID_TO_POS) {
        Some(Out::YMap(m)) => m,
        _ => panic!("id_to_pos map not found"),
    };
    let cell_prelim = yrs::MapPrelim::from([("row", Any::Number(0.0)), ("col", Any::Number(0.0))]);
    id_to_pos.insert(&mut txn, cell_id_key, cell_prelim);
}

pub(super) fn insert_comment_with_key(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    key: &str,
    comment: &Comment,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sheet_map = match storage.sheets_ref().get(&txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("sheet not found"),
    };
    let comments_map = match sheet_map.get(&txn, KEY_COMMENTS) {
        Some(Out::YMap(m)) => m,
        _ => panic!("comments map not found"),
    };
    let prelim: yrs::MapPrelim = comment_schema::to_yrs_prelim(comment).into_iter().collect();
    comments_map.insert(&mut txn, key, prelim);
}
