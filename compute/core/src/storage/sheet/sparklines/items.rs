use std::sync::Arc;

use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::codec::{read_sparkline_from_out, write_sparkline};
use super::groups::remove_sparkline_from_group_if_present;
use super::keys::{GROUP_PREFIX, IDX_PREFIX, idx_key};
use super::yrs_io::get_sheet_sparklines_map;
use super::{Sparkline, SparklineUpdate};

pub fn add_sparkline(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, sparkline: &Sparkline) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };

    write_sparkline(&sp_map, &mut txn, &sparkline.id, sparkline);
    sp_map.insert(
        &mut txn,
        &*idx_key(sparkline.cell.row, sparkline.cell.col),
        Any::String(Arc::from(sparkline.id.as_str())),
    );
}

pub fn get_sparkline(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Option<Sparkline> {
    let txn = doc.transact();
    let sp_map = get_sheet_sparklines_map(&txn, sheets, sheet_id)?;
    let out = sp_map.get(&txn, sparkline_id)?;
    read_sparkline_from_out(&out, &txn)
}

pub fn get_sparkline_at_cell(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<Sparkline> {
    let txn = doc.transact();
    let sp_map = get_sheet_sparklines_map(&txn, sheets, sheet_id)?;
    let key = idx_key(row, col);
    let sparkline_id = match sp_map.get(&txn, &key) {
        Some(Out::Any(Any::String(s))) => s.to_string(),
        _ => return None,
    };
    let out = sp_map.get(&txn, &sparkline_id)?;
    read_sparkline_from_out(&out, &txn)
}

pub fn get_sparklines_in_sheet(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<Sparkline> {
    let txn = doc.transact();
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in sp_map.iter(&txn) {
        if key.starts_with(GROUP_PREFIX) || key.starts_with(IDX_PREFIX) {
            continue;
        }
        if let Some(sparkline) = read_sparkline_from_out(&value, &txn) {
            result.push(sparkline);
        }
    }
    result
}

pub fn update_sparkline(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    sparkline_id: &str,
    updates: &SparklineUpdate,
) -> bool {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return false,
    };

    let mut existing = match sp_map.get(&txn, sparkline_id) {
        Some(out) => match read_sparkline_from_out(&out, &txn) {
            Some(s) => s,
            None => return false,
        },
        None => return false,
    };

    let old_idx = idx_key(existing.cell.row, existing.cell.col);
    existing.apply_update(updates);

    let new_idx = idx_key(existing.cell.row, existing.cell.col);
    if old_idx != new_idx {
        sp_map.remove(&mut txn, &old_idx);
        sp_map.insert(&mut txn, &*new_idx, Any::String(Arc::from(sparkline_id)));
    }

    write_sparkline(&sp_map, &mut txn, sparkline_id, &existing);

    true
}

pub fn delete_sparkline(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> bool {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return false,
    };

    let existing = match sp_map.get(&txn, sparkline_id) {
        Some(out) => match read_sparkline_from_out(&out, &txn) {
            Some(s) => s,
            None => return false,
        },
        None => return false,
    };

    let key = idx_key(existing.cell.row, existing.cell.col);
    sp_map.remove(&mut txn, &key);
    sp_map.remove(&mut txn, sparkline_id);
    remove_sparkline_from_group_if_present(
        &sp_map,
        &mut txn,
        existing.group_id.as_deref(),
        sparkline_id,
    );

    true
}

/// Check if a cell has a sparkline via index presence only.
pub fn has_sparkline(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, row: u32, col: u32) -> bool {
    let txn = doc.transact();
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return false,
    };
    let key = idx_key(row, col);
    sp_map.get(&txn, &key).is_some()
}
