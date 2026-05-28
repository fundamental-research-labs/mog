use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::yrs_access::{
    effective_hidden_by_row_id, get_sheet_submap, map_has_true, row_id_key,
    write_effective_hidden_cache,
};
use crate::identity::GridIndex;
use cell_types::SheetId;
use compute_document::schema::{KEY_FILTER_HIDDEN_ROWS, KEY_HIDDEN_ROWS, KEY_MANUAL_HIDDEN_ROWS};
use compute_document::undo::ORIGIN_USER_EDIT;

/// Hide rows for manual/user ownership.
pub fn hide_manual_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    rows: &[u32],
    grid_index: Option<&GridIndex>,
) {
    if rows.is_empty() {
        return;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return,
    };
    let manual_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);

    for &row in rows {
        if let (Some(owner_map), Some(row_id)) =
            (&manual_hidden_rows_map, row_id_key(grid_index, row))
        {
            owner_map.insert(&mut txn, &*row_id, Any::Bool(true));
        }
        write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, true);
    }
}

/// Test wrapper for callers without a GridIndex.
#[cfg(test)]
pub fn hide_rows(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, rows: &[u32]) {
    hide_manual_rows(doc, sheets, sheet_id, rows, None);
}

/// Unhide rows for manual/user ownership.
pub fn unhide_manual_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    rows: &[u32],
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    if rows.is_empty() {
        return transitions;
    }

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return transitions,
    };
    let manual_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);
    let filter_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS);

    for &row in rows {
        let before = map_has_true(&hidden_rows_map, &txn, &row.to_string());
        let Some(row_id) = row_id_key(grid_index, row) else {
            write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, false);
            if before {
                transitions.push((row, false));
            }
            continue;
        };
        if let Some(owner_map) = &manual_hidden_rows_map {
            owner_map.remove(&mut txn, &row_id);
        }
        let effective = effective_hidden_by_row_id(
            manual_hidden_rows_map.as_ref(),
            filter_hidden_rows_map.as_ref(),
            &txn,
            &row_id,
        );
        write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, effective);
        if before != effective {
            transitions.push((row, effective));
        }
    }

    transitions
}

/// Test wrapper for callers without a GridIndex.
#[cfg(test)]
pub fn unhide_rows(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, rows: &[u32]) {
    let _ = unhide_manual_rows(doc, sheets, sheet_id, rows, None);
}

/// Replace one filter's row-hidden ownership over a known affected set.
pub fn set_filter_hidden_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    rows_to_hide: &[u32],
    rows_to_release: &[u32],
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return transitions,
    };
    let manual_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);
    let filter_hidden_rows_map =
        match get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS) {
            Some(m) => m,
            None => return transitions,
        };
    if filter_hidden_rows_map.get(&txn, filter_id).is_none() {
        filter_hidden_rows_map.insert(
            &mut txn,
            filter_id,
            yrs::MapPrelim::from([] as [(&str, Any); 0]),
        );
    }
    let owner_map = match filter_hidden_rows_map.get(&txn, filter_id) {
        Some(Out::YMap(m)) => m,
        _ => return transitions,
    };

    let mut affected: Vec<u32> = rows_to_hide
        .iter()
        .chain(rows_to_release.iter())
        .copied()
        .collect();
    affected.sort_unstable();
    affected.dedup();

    for &row in rows_to_hide {
        if let Some(row_id) = row_id_key(grid_index, row) {
            owner_map.insert(&mut txn, &*row_id, Any::Bool(true));
        }
    }
    for &row in rows_to_release {
        if let Some(row_id) = row_id_key(grid_index, row) {
            owner_map.remove(&mut txn, &row_id);
        }
    }

    for row in affected {
        let before = map_has_true(&hidden_rows_map, &txn, &row.to_string());
        let effective = row_id_key(grid_index, row).is_some_and(|row_id| {
            effective_hidden_by_row_id(
                manual_hidden_rows_map.as_ref(),
                Some(&filter_hidden_rows_map),
                &txn,
                &row_id,
            )
        });
        write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, effective);
        if before != effective {
            transitions.push((row, effective));
        }
    }

    transitions
}

/// Clear a filter's row-hidden ownership and recompute affected effective rows.
pub fn clear_filter_hidden_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return transitions,
    };
    let manual_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);
    let filter_hidden_rows_map =
        match get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS) {
            Some(m) => m,
            None => return transitions,
        };
    let owner_map = match filter_hidden_rows_map.get(&txn, filter_id) {
        Some(Out::YMap(m)) => m,
        _ => return transitions,
    };
    let row_ids: Vec<String> = owner_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                Some(key.to_string())
            } else {
                None
            }
        })
        .collect();
    filter_hidden_rows_map.remove(&mut txn, filter_id);

    for row_id in row_ids {
        let Some(row) = grid_index.and_then(|gi| gi.row_index_from_hex(&row_id)) else {
            continue;
        };
        let before = map_has_true(&hidden_rows_map, &txn, &row.to_string());
        let effective = effective_hidden_by_row_id(
            manual_hidden_rows_map.as_ref(),
            Some(&filter_hidden_rows_map),
            &txn,
            &row_id,
        );
        write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, effective);
        if before != effective {
            transitions.push((row, effective));
        }
    }

    transitions
}

/// Check if a row is hidden.
pub fn is_row_hidden(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, row: u32) -> bool {
    let txn = doc.transact();
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return false,
    };

    let key = row.to_string();
    matches!(
        hidden_rows_map.get(&txn, &key),
        Some(Out::Any(Any::Bool(true)))
    )
}

/// Get all hidden rows for a sheet, sorted.
pub fn get_hidden_rows(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<u32> {
    let txn = doc.transact();
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result: Vec<u32> = hidden_rows_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                key.parse::<u32>().ok()
            } else {
                None
            }
        })
        .collect();

    result.sort_unstable();
    result
}
