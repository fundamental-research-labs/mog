use crate::storage::WorkbookStorage;
use cell_types::SheetId;

use super::queries::get_groups;
use super::store::{get_sheet_grouping_config, set_sheet_grouping_config};
use super::types::GroupAxis;

pub fn set_group_collapsed(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    group_id: &str,
    collapsed: bool,
) {
    let mut config = get_sheet_grouping_config(storage, sheet_id);
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
        set_sheet_grouping_config(storage, sheet_id, &config);
    }
}

pub fn toggle_group_collapsed(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<bool> {
    let config = get_sheet_grouping_config(storage, sheet_id);
    let current = config
        .row_groups
        .iter()
        .chain(config.column_groups.iter())
        .find(|g| g.id == group_id)?;
    let effective_collapsed = current.collapsed || current.hidden;
    let new_state = !effective_collapsed;
    set_group_collapsed(storage, sheet_id, group_id, new_state);
    Some(new_state)
}

pub fn set_level_collapsed(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    axis: GroupAxis,
    level: u32,
    collapsed: bool,
) {
    let groups = get_groups(storage, sheet_id, axis);
    for group in &groups {
        if group.level >= level {
            set_group_collapsed(storage, sheet_id, &group.id, collapsed);
        }
    }
}

pub fn expand_all(storage: &mut WorkbookStorage, sheet_id: &SheetId, axis: Option<GroupAxis>) {
    let axes = match axis {
        Some(a) => vec![a],
        None => vec![GroupAxis::Row, GroupAxis::Column],
    };
    for ax in axes {
        for group in &get_groups(storage, sheet_id, ax) {
            if group.collapsed || group.hidden {
                set_group_collapsed(storage, sheet_id, &group.id, false);
            }
        }
    }
}

pub fn collapse_all(storage: &mut WorkbookStorage, sheet_id: &SheetId, axis: Option<GroupAxis>) {
    let axes = match axis {
        Some(a) => vec![a],
        None => vec![GroupAxis::Row, GroupAxis::Column],
    };
    for ax in axes {
        let mut groups = get_groups(storage, sheet_id, ax);
        groups.sort_by_key(|g| g.level);
        for group in &groups {
            if !group.collapsed {
                set_group_collapsed(storage, sheet_id, &group.id, true);
            }
        }
    }
}

// =============================================================================
// Outline Levels
// =============================================================================
