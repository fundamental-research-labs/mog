use crate::storage::YrsStorage;
use cell_types::SheetId;

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

pub(super) fn basic_object_config() -> serde_json::Value {
    serde_json::json!({
        "type": "shape",
        "shapeType": "rect",
        "anchorRow": 0,
        "anchorCol": 0,
        "anchorRowOffset": 0,
        "anchorColOffset": 0,
        "anchorMode": "oneCell",
        "width": 300.0,
        "height": 400.0,
        "visible": true,
        "printable": true,
        "flipH": false,
        "flipV": false,
        "opacity": 1.0,
        "rotation": 0.0
    })
}
