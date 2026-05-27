use cell_types::SheetId;
use yrs::{Doc, MapRef};

use super::queries::get_groups;
use super::types::{GroupAxis, GroupDefinition, OutlineLevel};
use super::yrs_io::get_sheet_grouping_config;

pub fn get_row_outline_levels(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Vec<OutlineLevel> {
    let groups = get_groups(doc, sheets, sheet_id, GroupAxis::Row);
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let sb = config.summary_rows_below;
    let mut result = Vec::new();
    for row in start_row..=end_row {
        let containing: Vec<&GroupDefinition> = groups
            .iter()
            .filter(|g| row >= g.start && row <= g.end)
            .collect();
        let level = containing.iter().map(|g| g.level).max().unwrap_or(0);
        let visible = !containing.iter().any(|g| {
            if !g.collapsed {
                return false;
            }
            let is_sum = if sb { row == g.end } else { row == g.start };
            !is_sum
        });
        let is_summary = containing
            .iter()
            .any(|g| if sb { row == g.end } else { row == g.start });
        let mut sc = containing;
        sc.sort_by(|a, b| b.level.cmp(&a.level));
        let group_ids = sc.iter().map(|g| g.id.clone()).collect();
        result.push(OutlineLevel {
            index: row,
            level,
            visible,
            is_summary,
            group_ids,
        });
    }
    result
}

pub fn get_column_outline_levels(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<OutlineLevel> {
    let groups = get_groups(doc, sheets, sheet_id, GroupAxis::Column);
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let sr = config.summary_columns_right;
    let mut result = Vec::new();
    for col in start_col..=end_col {
        let containing: Vec<&GroupDefinition> = groups
            .iter()
            .filter(|g| col >= g.start && col <= g.end)
            .collect();
        let level = containing.iter().map(|g| g.level).max().unwrap_or(0);
        let visible = !containing.iter().any(|g| {
            if !g.collapsed {
                return false;
            }
            let is_sum = if sr { col == g.end } else { col == g.start };
            !is_sum
        });
        let is_summary = containing
            .iter()
            .any(|g| if sr { col == g.end } else { col == g.start });
        let mut sc = containing;
        sc.sort_by(|a, b| b.level.cmp(&a.level));
        let group_ids = sc.iter().map(|g| g.id.clone()).collect();
        result.push(OutlineLevel {
            index: col,
            level,
            visible,
            is_summary,
            group_ids,
        });
    }
    result
}

pub fn is_row_visible_by_groups(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, row: u32) -> bool {
    get_row_outline_levels(doc, sheets, sheet_id, row, row)
        .first()
        .map(|l| l.visible)
        .unwrap_or(true)
}

pub fn is_column_visible_by_groups(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    get_column_outline_levels(doc, sheets, sheet_id, col, col)
        .first()
        .map(|l| l.visible)
        .unwrap_or(true)
}

// =============================================================================
// Settings
// =============================================================================
