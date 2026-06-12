use std::collections::BTreeSet;

use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use super::yrs_access::{
    any_filter_hides_row, effective_hidden_by_row_id, filter_hides_row, get_sheet_submap,
    map_has_true, row_id_key, write_effective_hidden_cache,
};
use crate::identity::GridIndex;
use cell_types::SheetId;
use compute_document::schema::{KEY_FILTER_HIDDEN_ROWS, KEY_HIDDEN_ROWS, KEY_MANUAL_HIDDEN_ROWS};
use compute_document::undo::{ORIGIN_BOOTSTRAP, ORIGIN_USER_EDIT};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowVisibilityOwnership {
    pub effective_hidden: bool,
    pub manual: bool,
    pub structural: bool,
    pub cache_hidden_without_owner: bool,
    pub filter_owner_ids: BTreeSet<String>,
}

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

/// Normalize filter-owned visibility for an imported active AutoFilter.
///
/// XLSX row `hidden="1"` is ambiguous. During raw hydration those rows may
/// already be in the effective/manual maps. Once the runtime filter can be
/// evaluated, rows excluded by the criteria become filter-owned and are removed
/// from manual ownership; rows included by the criteria keep any existing
/// manual ownership.
pub fn normalize_imported_filter_hidden_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    rows_excluded_by_filter: &[u32],
    rows_included_by_filter: &[u32],
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    let structural_rows: BTreeSet<u32> =
        super::super::grouping::get_rows_hidden_by_structural_groups(doc, sheets, sheet_id)
            .into_iter()
            .collect();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_BOOTSTRAP));
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

    let mut affected: Vec<u32> = rows_excluded_by_filter
        .iter()
        .chain(rows_included_by_filter.iter())
        .copied()
        .collect();
    affected.sort_unstable();
    affected.dedup();

    for &row in rows_excluded_by_filter {
        if let Some(row_id) = row_id_key(grid_index, row) {
            if let Some(manual_map) = &manual_hidden_rows_map {
                manual_map.remove(&mut txn, &row_id);
            }
            owner_map.insert(&mut txn, &*row_id, Any::Bool(true));
        }
    }

    for &row in rows_included_by_filter {
        if let Some(row_id) = row_id_key(grid_index, row) {
            let cache_hidden = map_has_true(&hidden_rows_map, &txn, &row.to_string());
            let structural = structural_rows.contains(&row);
            owner_map.remove(&mut txn, &row_id);
            let has_filter_owner = any_filter_hides_row(&filter_hidden_rows_map, &txn, &row_id);
            if cache_hidden
                && !structural
                && !has_filter_owner
                && let Some(manual_map) = &manual_hidden_rows_map
            {
                manual_map.insert(&mut txn, &*row_id, Any::Bool(true));
            }
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

/// Assign remaining imported hidden-row cache entries to manual ownership.
///
/// Sheet AutoFilter import defers row-hidden provenance until the filter can be
/// evaluated. After supported criteria have claimed their excluded rows, any
/// remaining cache-hidden row without a filter or structural owner is a manual
/// hidden row. Structural-only rows are removed from the manual/filter cache;
/// grouping remains their rendered visibility source of truth.
pub fn finalize_imported_hidden_row_cache(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    let structural_rows: BTreeSet<u32> =
        super::super::grouping::get_rows_hidden_by_structural_groups(doc, sheets, sheet_id)
            .into_iter()
            .collect();
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_BOOTSTRAP));
    let hidden_rows_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return transitions,
    };
    let Some(manual_hidden_rows_map) =
        get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS)
    else {
        return transitions;
    };
    let filter_hidden_rows_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS);

    let rows: Vec<u32> = hidden_rows_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                key.parse::<u32>().ok()
            } else {
                None
            }
        })
        .collect();

    for row in rows {
        let before = map_has_true(&hidden_rows_map, &txn, &row.to_string());
        let Some(row_id) = row_id_key(grid_index, row) else {
            continue;
        };
        let manual = map_has_true(&manual_hidden_rows_map, &txn, &row_id);
        let filter = filter_hidden_rows_map
            .as_ref()
            .is_some_and(|m| any_filter_hides_row(m, &txn, &row_id));
        let structural = structural_rows.contains(&row);

        if !manual && !filter {
            if structural {
                write_effective_hidden_cache(&hidden_rows_map, &mut txn, row, false);
            } else {
                manual_hidden_rows_map.insert(&mut txn, &*row_id, Any::Bool(true));
            }
        }

        let effective = row_id_key(grid_index, row).is_some_and(|row_id| {
            effective_hidden_by_row_id(
                Some(&manual_hidden_rows_map),
                filter_hidden_rows_map.as_ref(),
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
pub fn clear_filter_hidden_rows_in_txn(
    txn: &mut yrs::TransactionMut,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    grid_index: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    let mut transitions = Vec::new();
    let hidden_rows_map = match get_sheet_submap(txn, sheets, sheet_id, KEY_HIDDEN_ROWS) {
        Some(m) => m,
        None => return transitions,
    };
    let manual_hidden_rows_map = get_sheet_submap(txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS);
    let filter_hidden_rows_map =
        match get_sheet_submap(txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS) {
            Some(m) => m,
            None => return transitions,
        };
    let owner_map = match filter_hidden_rows_map.get(txn, filter_id) {
        Some(Out::YMap(m)) => m,
        _ => return transitions,
    };
    let row_ids: Vec<String> = owner_map
        .iter(txn)
        .filter_map(|(key, value)| {
            if matches!(value, Out::Any(Any::Bool(true))) {
                Some(key.to_string())
            } else {
                None
            }
        })
        .collect();
    filter_hidden_rows_map.remove(txn, filter_id);

    for row_id in row_ids {
        let Some(row) = grid_index.and_then(|gi| gi.row_index_from_hex(&row_id)) else {
            continue;
        };
        let before = map_has_true(&hidden_rows_map, txn, &row.to_string());
        let effective = effective_hidden_by_row_id(
            manual_hidden_rows_map.as_ref(),
            Some(&filter_hidden_rows_map),
            txn,
            &row_id,
        );
        write_effective_hidden_cache(&hidden_rows_map, txn, row, effective);
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
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    clear_filter_hidden_rows_in_txn(&mut txn, sheets, sheet_id, filter_id, grid_index)
}

pub fn is_row_manually_hidden(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> bool {
    let txn = doc.transact();
    let Some(row_id) = row_id_key(grid_index, row) else {
        return false;
    };
    get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS)
        .is_some_and(|m| map_has_true(&m, &txn, &row_id))
}

pub fn is_row_hidden_by_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    filter_id: &str,
    grid_index: Option<&GridIndex>,
) -> bool {
    let txn = doc.transact();
    let Some(row_id) = row_id_key(grid_index, row) else {
        return false;
    };
    get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS)
        .is_some_and(|m| filter_hides_row(&m, &txn, filter_id, &row_id))
}

pub fn is_row_hidden_by_any_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> bool {
    let txn = doc.transact();
    let Some(row_id) = row_id_key(grid_index, row) else {
        return false;
    };
    get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS)
        .is_some_and(|m| any_filter_hides_row(&m, &txn, &row_id))
}

pub fn is_row_hidden_only_by_filter(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    filter_id: &str,
    grid_index: Option<&GridIndex>,
) -> bool {
    let txn = doc.transact();
    let Some(row_id) = row_id_key(grid_index, row) else {
        return false;
    };
    let manual_hidden = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS)
        .is_some_and(|m| map_has_true(&m, &txn, &row_id));
    if manual_hidden {
        return false;
    }
    let Some(filter_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS) else {
        return false;
    };
    if !filter_hides_row(&filter_map, &txn, filter_id, &row_id) {
        return false;
    }
    !filter_map.iter(&txn).any(|(other_filter_id, owner)| {
        other_filter_id != filter_id
            && matches!(owner, Out::YMap(owner_map) if map_has_true(&owner_map, &txn, &row_id))
    })
}

pub fn get_row_visibility_ownership(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> RowVisibilityOwnership {
    let structural = !super::super::grouping::is_row_visible_by_groups(doc, sheets, sheet_id, row);
    let Some(row_id) = row_id_key(grid_index, row) else {
        let cache_hidden_without_owner = is_row_hidden(doc, sheets, sheet_id, row) && !structural;
        return RowVisibilityOwnership {
            effective_hidden: structural || cache_hidden_without_owner,
            manual: false,
            structural,
            cache_hidden_without_owner,
            filter_owner_ids: BTreeSet::new(),
        };
    };

    let txn = doc.transact();
    let cache_hidden = get_sheet_submap(&txn, sheets, sheet_id, KEY_HIDDEN_ROWS)
        .is_some_and(|m| map_has_true(&m, &txn, &row.to_string()));
    let manual = get_sheet_submap(&txn, sheets, sheet_id, KEY_MANUAL_HIDDEN_ROWS)
        .is_some_and(|m| map_has_true(&m, &txn, &row_id));
    let mut filter_owner_ids = BTreeSet::new();
    if let Some(filter_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_FILTER_HIDDEN_ROWS) {
        for (filter_id, owner) in filter_map.iter(&txn) {
            if matches!(owner, Out::YMap(owner_map) if map_has_true(&owner_map, &txn, &row_id)) {
                filter_owner_ids.insert(filter_id.to_string());
            }
        }
    }

    let cache_hidden_without_owner =
        cache_hidden && !manual && !structural && filter_owner_ids.is_empty();

    RowVisibilityOwnership {
        effective_hidden: manual
            || structural
            || cache_hidden_without_owner
            || !filter_owner_ids.is_empty(),
        manual,
        structural,
        cache_hidden_without_owner,
        filter_owner_ids,
    }
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
