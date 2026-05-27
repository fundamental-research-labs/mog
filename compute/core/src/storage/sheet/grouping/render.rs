use cell_types::SheetId;
use yrs::{Doc, MapRef};

use super::outline::{get_column_outline_levels, get_row_outline_levels};
use super::queries::{get_groups, get_max_outline_level};
use super::types::{GroupAxis, OutlineLevelButton, OutlineRenderData, OutlineSymbol, Viewport};
use super::yrs_io::get_sheet_grouping_config;

pub fn get_outline_symbols(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    viewport: &Viewport,
) -> Vec<OutlineSymbol> {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    let mut symbols = Vec::new();
    for group in &get_groups(doc, sheets, sheet_id, GroupAxis::Row) {
        let idx = if config.summary_rows_below {
            group.end
        } else {
            group.start
        };
        if idx >= viewport.start_row && idx <= viewport.end_row {
            symbols.push(OutlineSymbol {
                id: group.id.clone(),
                axis: GroupAxis::Row,
                index: idx,
                level: group.level,
                collapsed: group.collapsed,
                group_id: group.id.clone(),
            });
        }
    }
    for group in &get_groups(doc, sheets, sheet_id, GroupAxis::Column) {
        let idx = if config.summary_columns_right {
            group.end
        } else {
            group.start
        };
        if idx >= viewport.start_col && idx <= viewport.end_col {
            symbols.push(OutlineSymbol {
                id: group.id.clone(),
                axis: GroupAxis::Column,
                index: idx,
                level: group.level,
                collapsed: group.collapsed,
                group_id: group.id.clone(),
            });
        }
    }
    symbols
}

pub fn get_outline_level_buttons(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<OutlineLevelButton> {
    let mut buttons = Vec::new();
    let max_row = get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Row);
    let max_col = get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Column);
    if max_row > 0 {
        for level in 1..=max_row + 1 {
            buttons.push(OutlineLevelButton {
                level,
                axis: GroupAxis::Row,
            });
        }
    }
    if max_col > 0 {
        for level in 1..=max_col + 1 {
            buttons.push(OutlineLevelButton {
                level,
                axis: GroupAxis::Column,
            });
        }
    }
    buttons
}

pub fn get_outline_render_data(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    viewport: &Viewport,
) -> OutlineRenderData {
    OutlineRenderData {
        config: get_sheet_grouping_config(doc, sheets, sheet_id),
        row_groups: get_groups(doc, sheets, sheet_id, GroupAxis::Row),
        column_groups: get_groups(doc, sheets, sheet_id, GroupAxis::Column),
        max_row_level: get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Row),
        max_col_level: get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Column),
        row_outline_levels: get_row_outline_levels(
            doc,
            sheets,
            sheet_id,
            viewport.start_row,
            viewport.end_row,
        ),
        column_outline_levels: get_column_outline_levels(
            doc,
            sheets,
            sheet_id,
            viewport.start_col,
            viewport.end_col,
        ),
        outline_symbols: get_outline_symbols(doc, sheets, sheet_id, viewport),
        level_buttons: get_outline_level_buttons(doc, sheets, sheet_id),
    }
}

pub fn should_render_outlines(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> bool {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    if !config.show_outline_symbols {
        return false;
    }
    get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Row) > 0
        || get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Column) > 0
}

pub fn get_outline_gutter_dimensions(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    level_width: u32,
    level_height: u32,
) -> (u32, u32) {
    let config = get_sheet_grouping_config(doc, sheets, sheet_id);
    if !config.show_outline_symbols {
        return (0, 0);
    }
    let mr = get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Row);
    let mc = get_max_outline_level(doc, sheets, sheet_id, GroupAxis::Column);
    (
        if mr > 0 { mr * level_width } else { 0 },
        if mc > 0 { mc * level_height } else { 0 },
    )
}

// =============================================================================
// Auto-Outline
// =============================================================================
