use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::CellRange;
use super::codec::read_sparkline_from_out;
use super::groups::remove_sparkline_from_group_if_present;
use super::keys::idx_key;
use super::yrs_io::get_sheet_sparklines_map;

pub fn clear_sparklines_in_range(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    range: &CellRange,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };

    let mut to_delete: Vec<String> = Vec::new();
    for row in range.start_row()..=range.end_row() {
        for col in range.start_col()..=range.end_col() {
            let ikey = idx_key(row, col);
            if let Some(Out::Any(Any::String(sid))) = sp_map.get(&txn, &ikey) {
                let sid = sid.to_string();
                if !to_delete.contains(&sid) {
                    to_delete.push(sid);
                }
            }
        }
    }

    for sparkline_id in &to_delete {
        if let Some(out) = sp_map.get(&txn, sparkline_id.as_str())
            && let Some(sparkline) = read_sparkline_from_out(&out, &txn)
        {
            let ikey = idx_key(sparkline.cell.row, sparkline.cell.col);
            sp_map.remove(&mut txn, &ikey);
            sp_map.remove(&mut txn, sparkline_id.as_str());
            remove_sparkline_from_group_if_present(
                &sp_map,
                &mut txn,
                sparkline.group_id.as_deref(),
                sparkline_id,
            );
        }
    }
}

pub fn clear_sparklines_for_sheet(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };

    let keys: Vec<String> = sp_map.iter(&txn).map(|(k, _)| k.to_string()).collect();
    for key in &keys {
        sp_map.remove(&mut txn, key.as_str());
    }
}
