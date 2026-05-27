use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::CFStyle;
use domain_types::domain::conditional_format::{CFRule, ConditionalFormat};
use yrs::{Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::engine_types::cf::CFCellRange;
use crate::storage::YrsStorage;
use crate::storage::infra::grid_helpers::sheet_id_to_hex;

/// Ensure the `rangeBindings` sub-map exists on the sheet for tests.
pub(super) fn ensure_range_bindings_map(storage: &YrsStorage, sheet_id: &SheetId) {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sheet_map = match storage.sheets_ref().get(&txn, &*sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };
    if sheet_map
        .get(&txn, compute_document::schema::KEY_RANGE_BINDINGS)
        .is_none()
    {
        let empty = MapPrelim::from([] as [(&str, yrs::Any); 0]);
        sheet_map.insert(
            &mut txn,
            compute_document::schema::KEY_RANGE_BINDINGS,
            empty,
        );
    }
}

/// Get the `rangeBindings` Y.Map for a sheet.
pub(super) fn get_range_bindings_map(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    txn: &impl yrs::ReadTxn,
) -> MapRef {
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let sheet_map = match storage.sheets_ref().get(txn, &*sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => panic!("no sheet map"),
    };
    match sheet_map.get(txn, compute_document::schema::KEY_RANGE_BINDINGS) {
        Some(Out::YMap(m)) => m,
        _ => panic!("no bindings map — call ensure_range_bindings_map() first"),
    }
}

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

pub(super) fn default_style() -> CFStyle {
    CFStyle {
        background_color: Some("#FF0000".into()),
        bold: Some(true),
        ..Default::default()
    }
}

pub(super) fn make_rule(id: &str, priority: i32) -> CFRule {
    CFRule::CellValue {
        id: id.to_string(),
        priority,
        stop_if_true: None,
        operator: ooxml_types::cond_format::CfOperator::GreaterThan,
        value1: serde_json::json!(10),
        value2: None,
        style: default_style(),
        text: None,
    }
}

pub(super) fn make_format(
    id: &str,
    sheet_id: &SheetId,
    ranges: Vec<CFCellRange>,
    rules: Vec<CFRule>,
) -> ConditionalFormat {
    ConditionalFormat {
        id: id.to_string(),
        sheet_id: sheet_id.to_uuid_string(),
        pivot: None,
        range_identities: None,
        ranges,
        rules,
    }
}

pub(super) fn rng(sr: u32, sc: u32, er: u32, ec: u32) -> CFCellRange {
    CFCellRange::new(sr, sc, er, ec)
}
