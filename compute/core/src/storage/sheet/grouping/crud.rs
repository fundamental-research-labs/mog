use cell_types::SheetId;
use yrs::{Doc, MapRef};

use super::hierarchy::{calculate_group_level, find_parent_group};
use super::ids::{generate_unique_group_id, sheet_id_to_hex};
use super::types::{GroupAxis, GroupDefinition, SheetGroupingConfig};
use super::yrs_io::{get_sheet_grouping_config, set_sheet_grouping_config};

pub fn group_rows(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<GroupDefinition, String> {
    let (start, end) = if start_row > end_row {
        (end_row, start_row)
    } else {
        (start_row, end_row)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let level = calculate_group_level(&config.row_groups, start, end)?;
    let parent_id = find_parent_group(&config.row_groups, start, end, level);
    let group = GroupDefinition {
        id: generate_unique_group_id(&config),
        sheet_id: sheet_id_to_hex(sheet_id),
        axis: GroupAxis::Row,
        start,
        end,
        level,
        collapsed: false,
        parent_id,
        hidden: false,
        collapsed_on_member: false,
    };
    config.row_groups.push(group.clone());
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    Ok(group)
}

pub fn ungroup_rows(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, start_row: u32, end_row: u32) {
    let (start, end) = if start_row > end_row {
        (end_row, start_row)
    } else {
        (start_row, end_row)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut containing: Vec<(usize, &GroupDefinition)> = config
        .row_groups
        .iter()
        .enumerate()
        .filter(|(_, g)| g.start <= start && g.end >= end)
        .collect();
    containing.sort_by(|a, b| b.1.level.cmp(&a.1.level));
    if let Some((idx, group)) = containing.first() {
        let group = (*group).clone();
        let idx = *idx;
        if group.start == start && group.end == end {
            // Exact match — remove entirely
            config.row_groups.remove(idx);
        } else if group.start == start {
            // Prefix removal — shrink group start
            config.row_groups[idx].start = end + 1;
        } else if group.end == end {
            // Suffix removal — shrink group end
            config.row_groups[idx].end = start - 1;
        } else {
            // Middle removal — split into two residual groups
            let left = GroupDefinition {
                id: generate_unique_group_id(&config),
                sheet_id: group.sheet_id.clone(),
                axis: group.axis,
                start: group.start,
                end: start - 1,
                level: group.level,
                collapsed: false,
                parent_id: group.parent_id.clone(),
                hidden: false,
                collapsed_on_member: false,
            };
            let right = GroupDefinition {
                id: generate_unique_group_id(&config),
                sheet_id: group.sheet_id.clone(),
                axis: group.axis,
                start: end + 1,
                end: group.end,
                level: group.level,
                collapsed: false,
                parent_id: group.parent_id.clone(),
                hidden: false,
                collapsed_on_member: false,
            };
            config.row_groups.remove(idx);
            config.row_groups.push(left);
            config.row_groups.push(right);
        }
        set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    }
}

pub fn clear_row_grouping(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) {
    let (start, end) = if start_row > end_row {
        (end_row, start_row)
    } else {
        (start_row, end_row)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    config.row_groups.retain(|g| g.end < start || g.start > end);
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
}

// =============================================================================
// Column Group CRUD
// =============================================================================

pub fn group_columns(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<GroupDefinition, String> {
    let (start, end) = if start_col > end_col {
        (end_col, start_col)
    } else {
        (start_col, end_col)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let level = calculate_group_level(&config.column_groups, start, end)?;
    let parent_id = find_parent_group(&config.column_groups, start, end, level);
    let group = GroupDefinition {
        id: generate_unique_group_id(&config),
        sheet_id: sheet_id_to_hex(sheet_id),
        axis: GroupAxis::Column,
        start,
        end,
        level,
        collapsed: false,
        parent_id,
        hidden: false,
        collapsed_on_member: false,
    };
    config.column_groups.push(group.clone());
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    Ok(group)
}

pub fn ungroup_columns(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) {
    let (start, end) = if start_col > end_col {
        (end_col, start_col)
    } else {
        (start_col, end_col)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut containing: Vec<(usize, &GroupDefinition)> = config
        .column_groups
        .iter()
        .enumerate()
        .filter(|(_, g)| g.start <= start && g.end >= end)
        .collect();
    containing.sort_by(|a, b| b.1.level.cmp(&a.1.level));
    if let Some((idx, group)) = containing.first() {
        let group = (*group).clone();
        let idx = *idx;
        if group.start == start && group.end == end {
            // Exact match — remove entirely
            config.column_groups.remove(idx);
        } else if group.start == start {
            // Prefix removal — shrink group start
            config.column_groups[idx].start = end + 1;
        } else if group.end == end {
            // Suffix removal — shrink group end
            config.column_groups[idx].end = start - 1;
        } else {
            // Middle removal — split into two residual groups
            let left = GroupDefinition {
                id: generate_unique_group_id(&config),
                sheet_id: group.sheet_id.clone(),
                axis: group.axis,
                start: group.start,
                end: start - 1,
                level: group.level,
                collapsed: false,
                parent_id: group.parent_id.clone(),
                hidden: false,
                collapsed_on_member: false,
            };
            let right = GroupDefinition {
                id: generate_unique_group_id(&config),
                sheet_id: group.sheet_id.clone(),
                axis: group.axis,
                start: end + 1,
                end: group.end,
                level: group.level,
                collapsed: false,
                parent_id: group.parent_id.clone(),
                hidden: false,
                collapsed_on_member: false,
            };
            config.column_groups.remove(idx);
            config.column_groups.push(left);
            config.column_groups.push(right);
        }
        set_sheet_grouping_config(doc, sheets, sheet_id, &config);
    }
}

pub fn clear_column_grouping(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) {
    let (start, end) = if start_col > end_col {
        (end_col, start_col)
    } else {
        (start_col, end_col)
    };
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    config
        .column_groups
        .retain(|g| g.end < start || g.start > end);
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
}

// =============================================================================
// Queries
// =============================================================================

pub fn clear_all_grouping(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    set_sheet_grouping_config(doc, sheets, sheet_id, &SheetGroupingConfig::default());
}
