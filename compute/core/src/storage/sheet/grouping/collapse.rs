use cell_types::SheetId;
use yrs::{Doc, MapRef};

use super::queries::get_groups;
use super::types::GroupAxis;
use super::yrs_io::{get_sheet_grouping_config, set_sheet_grouping_config};

pub fn set_group_collapsed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
    collapsed: bool,
) {
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let found = config
        .row_groups
        .iter_mut()
        .chain(config.column_groups.iter_mut())
        .find(|g| g.id == group_id);
    if let Some(group) = found {
        let clear_imported_hidden = !collapsed && group.hidden;
        if group.collapsed == collapsed && !clear_imported_hidden {
            return;
        }
        group.collapsed = collapsed;
        if clear_imported_hidden {
            group.hidden = false;
        }
        set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    }
}

pub fn toggle_group_collapsed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<bool> {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let current = config
        .row_groups
        .iter()
        .chain(config.column_groups.iter())
        .find(|g| g.id == group_id)?;
    let new_state = !current.collapsed;
    set_group_collapsed(doc, sheets, sheet_id, group_id, new_state);
    Some(new_state)
}

pub fn set_level_collapsed(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    axis: GroupAxis,
    level: u32,
    collapsed: bool,
) {
    let groups = get_groups(doc, sheets, sheet_id, axis);
    for group in &groups {
        if group.level >= level {
            set_group_collapsed(doc, sheets, sheet_id, &group.id, collapsed);
        }
    }
}

pub fn expand_all(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, axis: Option<GroupAxis>) {
    let axes = match axis {
        Some(a) => vec![a],
        None => vec![GroupAxis::Row, GroupAxis::Column],
    };
    for ax in axes {
        for group in &get_groups(doc, sheets, sheet_id, ax) {
            if group.collapsed {
                set_group_collapsed(doc, sheets, sheet_id, &group.id, false);
            }
        }
    }
}

pub fn collapse_all(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, axis: Option<GroupAxis>) {
    let axes = match axis {
        Some(a) => vec![a],
        None => vec![GroupAxis::Row, GroupAxis::Column],
    };
    for ax in axes {
        let mut groups = get_groups(doc, sheets, sheet_id, ax);
        groups.sort_by_key(|g| g.level);
        for group in &groups {
            if !group.collapsed {
                set_group_collapsed(doc, sheets, sheet_id, &group.id, true);
            }
        }
    }
}

// =============================================================================
// Outline Levels
// =============================================================================
