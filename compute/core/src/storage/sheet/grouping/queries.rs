use std::collections::BTreeSet;

use cell_types::SheetId;
use yrs::{Doc, MapRef};

use super::types::{GroupAxis, GroupDefinition};
use super::yrs_io::get_sheet_grouping_config;

pub fn get_group_in_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<GroupDefinition> {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    config
        .row_groups
        .iter()
        .chain(config.column_groups.iter())
        .find(|g| g.id == group_id)
        .cloned()
}

/// Search for a group by ID across multiple sheets.
///
/// Returns the first matching `GroupDefinition` found in any of the given sheets.
pub fn get_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_ids: &[SheetId],
    group_id: &str,
) -> Option<GroupDefinition> {
    for sid in sheet_ids {
        if let Some(g) = get_group_in_sheet(doc, sheets, sid, group_id) {
            return Some(g);
        }
    }
    None
}

pub fn get_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    axis: GroupAxis,
) -> Vec<GroupDefinition> {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    match axis {
        GroupAxis::Row => config.row_groups,
        GroupAxis::Column => config.column_groups,
    }
}

pub fn get_max_outline_level(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    axis: GroupAxis,
) -> u32 {
    get_groups(doc, sheets, sheet_id, axis)
        .iter()
        .map(|g| g.level)
        .max()
        .unwrap_or(0)
}

pub fn get_affected_rows_by_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    let group = match get_group_in_sheet(doc, sheets, sheet_id, group_id) {
        Some(g) if g.axis == GroupAxis::Row => g,
        _ => return vec![],
    };
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    (group.start..=group.end)
        .filter(|&row| {
            let is_summary = if config.summary_rows_below {
                row == group.end
            } else {
                row == group.start
            };
            !is_summary
        })
        .collect()
}

pub fn get_affected_columns_by_group(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    let group = match get_group_in_sheet(doc, sheets, sheet_id, group_id) {
        Some(g) if g.axis == GroupAxis::Column => g,
        _ => return vec![],
    };
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    (group.start..=group.end)
        .filter(|&col| {
            let is_summary = if config.summary_columns_right {
                col == group.end
            } else {
                col == group.start
            };
            !is_summary
        })
        .collect()
}

/// Rows whose effective rendered height is zero because at least one
/// collapsed row outline group contains them as a non-summary member.
pub fn get_rows_hidden_by_collapsed_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<u32> {
    let groups = get_groups(doc, sheets, sheet_id, GroupAxis::Row);
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut hidden = BTreeSet::new();

    for group in groups.iter().filter(|g| g.collapsed) {
        for row in group.start..=group.end {
            let is_summary = if config.summary_rows_below {
                row == group.end
            } else {
                row == group.start
            };
            if !is_summary {
                hidden.insert(row);
            }
        }
    }

    hidden.into_iter().collect()
}

/// Columns whose effective rendered width is zero because at least one
/// collapsed column outline group contains them as a non-summary member.
pub fn get_columns_hidden_by_collapsed_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<u32> {
    let groups = get_groups(doc, sheets, sheet_id, GroupAxis::Column);
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut hidden = BTreeSet::new();

    for group in groups.iter().filter(|g| g.collapsed) {
        for col in group.start..=group.end {
            let is_summary = if config.summary_columns_right {
                col == group.end
            } else {
                col == group.start
            };
            if !is_summary {
                hidden.insert(col);
            }
        }
    }

    hidden.into_iter().collect()
}

// =============================================================================
// Expand/Collapse
// =============================================================================
