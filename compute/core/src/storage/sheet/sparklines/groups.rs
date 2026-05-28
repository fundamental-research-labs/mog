use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Doc, Map, MapRef, Origin, Transact};

use super::SparklineGroup;
use super::codec::{read_group_from_out, read_sparkline_from_out, write_group, write_sparkline};
use super::keys::{GROUP_PREFIX, group_key, idx_key};
use super::yrs_io::get_sheet_sparklines_map;

pub fn add_sparkline_group(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, group: &SparklineGroup) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };

    let gkey = group_key(&group.id);
    write_group(&sp_map, &mut txn, &gkey, group);

    for sparkline_id in &group.sparkline_ids {
        if let Some(out) = sp_map.get(&txn, sparkline_id.as_str())
            && let Some(mut sparkline) = read_sparkline_from_out(&out, &txn)
        {
            sparkline.group_id = Some(group.id.clone());
            write_sparkline(&sp_map, &mut txn, sparkline_id.as_str(), &sparkline);
        }
    }
}

pub fn get_sparkline_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<SparklineGroup> {
    let txn = doc.transact();
    let sp_map = get_sheet_sparklines_map(&txn, sheets, sheet_id)?;
    let gkey = group_key(group_id);
    let out = sp_map.get(&txn, &gkey)?;
    read_group_from_out(&out, &txn)
}

pub fn get_sparkline_groups_in_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<SparklineGroup> {
    let txn = doc.transact();
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in sp_map.iter(&txn) {
        if key.starts_with(GROUP_PREFIX)
            && let Some(group) = read_group_from_out(&value, &txn)
        {
            result.push(group);
        }
    }
    result
}

pub fn delete_sparkline_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
    delete_sparklines_flag: bool,
) -> bool {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let sp_map = match get_sheet_sparklines_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return false,
    };

    let gkey = group_key(group_id);
    let group = match sp_map.get(&txn, &gkey) {
        Some(out) => match read_group_from_out(&out, &txn) {
            Some(g) => g,
            None => return false,
        },
        None => return false,
    };

    if delete_sparklines_flag {
        for sparkline_id in &group.sparkline_ids {
            if let Some(out) = sp_map.get(&txn, sparkline_id.as_str())
                && let Some(sparkline) = read_sparkline_from_out(&out, &txn)
            {
                let ikey = idx_key(sparkline.cell.row, sparkline.cell.col);
                sp_map.remove(&mut txn, &ikey);
            }
            sp_map.remove(&mut txn, sparkline_id.as_str());
        }
    } else {
        for sparkline_id in &group.sparkline_ids {
            if let Some(out) = sp_map.get(&txn, sparkline_id.as_str())
                && let Some(mut sparkline) = read_sparkline_from_out(&out, &txn)
            {
                sparkline.group_id = None;
                write_sparkline(&sp_map, &mut txn, sparkline_id.as_str(), &sparkline);
            }
        }
    }

    sp_map.remove(&mut txn, &gkey);

    true
}

pub(super) fn remove_sparkline_from_group_if_present(
    sp_map: &MapRef,
    txn: &mut yrs::TransactionMut,
    group_id: Option<&str>,
    sparkline_id: &str,
) {
    let Some(group_id) = group_id else {
        return;
    };
    let gkey = group_key(group_id);
    if let Some(out) = sp_map.get(txn, &gkey)
        && let Some(mut group) = read_group_from_out(&out, txn)
    {
        group.sparkline_ids.retain(|id| id != sparkline_id);
        if group.sparkline_ids.is_empty() {
            sp_map.remove(txn, &gkey);
        } else {
            write_group(sp_map, txn, &gkey, &group);
        }
    }
}
