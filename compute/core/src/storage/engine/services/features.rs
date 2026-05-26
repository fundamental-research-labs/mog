//! Extracted feature service functions (sorting, slicers, sparklines, grouping,
//! cell ops).
//!
//! Each function takes explicit references to the engine sub-structs it needs
//! instead of `&self`.  The original bridge methods in `features.rs` delegate
//! to these with one-line calls.

use crate::mirror::CellMirror;
use crate::snapshot::{
    Axis, CellPosition, ChangeKind, GroupingChange, MutationResult, SlicerChange, SlicerChangeKind,
    SlicerSourceType, SparklineChange,
};
use crate::storage::cells::data_ops as cell_ops;
use crate::storage::sheet::{dimensions, grouping, sorting, sparklines};
use crate::storage::workbook::slicers;
use crate::table::types::{Slicer, SlicerCache, TableColumn};
use cell_types::{SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_SLICERS;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::slicer::{
    SlicerSelectionChangeType, SlicerSource, StoredSlicer, StoredSlicerUpdate,
};
use domain_types::yrs_schema::slicer as slicer_yrs;
use value_types::{CellValue, ComputeError};
use yrs::{Map, MapPrelim, Origin, Transact};

use crate::storage::engine::stores::EngineStores;

// -------------------------------------------------------------------
// Grouping — simple CRUD (no flush)
// -------------------------------------------------------------------

fn group_bounds(groups: &[grouping::GroupDefinition]) -> Option<(u32, u32)> {
    groups.iter().fold(None, |acc, group| match acc {
        Some((start, end)) => Some((start.min(group.start), end.max(group.end))),
        None => Some((group.start, group.end)),
    })
}

fn row_containing_group_bounds(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Option<(u32, u32)> {
    let (start, end) = if start_row > end_row {
        (end_row, start_row)
    } else {
        (start_row, end_row)
    };
    let mut containing: Vec<_> = grouping::get_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        grouping::GroupAxis::Row,
    )
    .into_iter()
    .filter(|group| group.start <= start && group.end >= end)
    .collect();
    containing.sort_by(|a, b| b.level.cmp(&a.level));
    containing.first().map(|group| (group.start, group.end))
}

fn column_containing_group_bounds(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Option<(u32, u32)> {
    let (start, end) = if start_col > end_col {
        (end_col, start_col)
    } else {
        (start_col, end_col)
    };
    let mut containing: Vec<_> = grouping::get_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        grouping::GroupAxis::Column,
    )
    .into_iter()
    .filter(|group| group.start <= start && group.end >= end)
    .collect();
    containing.sort_by(|a, b| b.level.cmp(&a.level));
    containing.first().map(|group| (group.start, group.end))
}

fn grouped_axis_bounds(
    stores: &EngineStores,
    sheet_id: &SheetId,
    axis: grouping::GroupAxis,
) -> Option<(u32, u32)> {
    let groups = grouping::get_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        axis,
    );
    group_bounds(&groups)
}

fn grouped_axis_bounds_at_or_above_level(
    stores: &EngineStores,
    sheet_id: &SheetId,
    axis: grouping::GroupAxis,
    level: u32,
) -> Option<(u32, u32)> {
    let groups: Vec<_> = grouping::get_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        axis,
    )
    .into_iter()
    .filter(|group| group.level >= level)
    .collect();
    group_bounds(&groups)
}

fn overlapping_group_bounds(
    stores: &EngineStores,
    sheet_id: &SheetId,
    axis: grouping::GroupAxis,
    start: u32,
    end: u32,
) -> Option<(u32, u32)> {
    let (start, end) = if start > end {
        (end, start)
    } else {
        (start, end)
    };
    let groups: Vec<_> = grouping::get_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        axis,
    )
    .into_iter()
    .filter(|group| !(group.end < start || group.start > end))
    .collect();
    group_bounds(&groups)
}

fn clamp_axis_range(start: u32, end: u32, count: usize) -> Option<(u32, u32)> {
    if count == 0 {
        return None;
    }
    let max_index = u32::try_from(count.saturating_sub(1)).unwrap_or(u32::MAX);
    let start = start.min(max_index);
    let end = end.min(max_index);
    if start > end {
        None
    } else {
        Some((start, end))
    }
}

fn sync_row_layout_range(stores: &mut EngineStores, sheet_id: &SheetId, start: u32, end: u32) {
    let row_count = match stores.layout_indexes.get(sheet_id) {
        Some(layout) => layout.row_count(),
        None => return,
    };
    let Some((start, end)) = clamp_axis_range(start, end, row_count) else {
        return;
    };

    let states: Vec<(u32, bool)> = {
        let doc = stores.storage.doc();
        let sheets = stores.storage.sheets();
        (start..=end)
            .map(|row| {
                let hidden = dimensions::is_row_hidden(doc, sheets, sheet_id, row)
                    || !grouping::is_row_visible_by_groups(doc, sheets, sheet_id, row);
                (row, hidden)
            })
            .collect()
    };

    if let Some(layout) = stores.layout_indexes.get_mut(sheet_id) {
        for (row, hidden) in states {
            if hidden {
                layout.hide_row(row as usize);
            } else {
                layout.unhide_row(row as usize);
            }
        }
    }
}

fn sync_column_layout_range(stores: &mut EngineStores, sheet_id: &SheetId, start: u32, end: u32) {
    let col_count = match stores.layout_indexes.get(sheet_id) {
        Some(layout) => layout.col_count(),
        None => return,
    };
    let Some((start, end)) = clamp_axis_range(start, end, col_count) else {
        return;
    };

    let states: Vec<(u32, bool)> = {
        let doc = stores.storage.doc();
        let sheets = stores.storage.sheets();
        (start..=end)
            .map(|col| {
                let hidden = dimensions::is_column_hidden(doc, sheets, sheet_id, col)
                    || !grouping::is_column_visible_by_groups(doc, sheets, sheet_id, col);
                (col, hidden)
            })
            .collect()
    };

    if let Some(layout) = stores.layout_indexes.get_mut(sheet_id) {
        for (col, hidden) in states {
            if hidden {
                layout.hide_col(col as usize);
            } else {
                layout.unhide_col(col as usize);
            }
        }
    }
}

pub(in crate::storage::engine) fn group_rows(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<MutationResult, ComputeError> {
    let group_def = grouping::group_rows(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        start_row,
        end_row,
    )
    .map_err(|e| ComputeError::Eval { message: e })?;
    let mut result = MutationResult::empty();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sheet_id.to_uuid_string(),
        axis: Axis::Row,
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&group_def)?)
}

pub(in crate::storage::engine) fn ungroup_rows(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<MutationResult, ComputeError> {
    let affected = row_containing_group_bounds(stores, sheet_id, start_row, end_row);
    grouping::ungroup_rows(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        start_row,
        end_row,
    );
    if let Some((start, end)) = affected {
        sync_row_layout_range(stores, sheet_id, start, end);
    }
    let mut result = MutationResult::empty();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sheet_id.to_uuid_string(),
        axis: Axis::Row,
        kind: ChangeKind::Removed,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn group_columns(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let group_def = grouping::group_columns(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        start_col,
        end_col,
    )
    .map_err(|e| ComputeError::Eval { message: e })?;
    let mut result = MutationResult::empty();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sheet_id.to_uuid_string(),
        axis: Axis::Col,
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&group_def)?)
}

pub(in crate::storage::engine) fn ungroup_columns(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let affected = column_containing_group_bounds(stores, sheet_id, start_col, end_col);
    grouping::ungroup_columns(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        start_col,
        end_col,
    );
    if let Some((start, end)) = affected {
        sync_column_layout_range(stores, sheet_id, start, end);
    }
    let mut result = MutationResult::empty();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sheet_id.to_uuid_string(),
        axis: Axis::Col,
        kind: ChangeKind::Removed,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn set_group_collapsed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
    collapsed: bool,
) -> Result<MutationResult, ComputeError> {
    let affected = grouping::get_group_in_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    )
    .map(|group| (group.axis, group.start, group.end));
    grouping::set_group_collapsed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
        collapsed,
    );
    if let Some((axis, start, end)) = affected {
        match axis {
            grouping::GroupAxis::Row => sync_row_layout_range(stores, sheet_id, start, end),
            grouping::GroupAxis::Column => sync_column_layout_range(stores, sheet_id, start, end),
        }
    }
    let mut result = MutationResult::empty();
    let sid = sheet_id.to_uuid_string();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sid.clone(),
        axis: Axis::Row,
        kind: ChangeKind::Set,
    });
    result.grouping_changes.push(GroupingChange {
        sheet_id: sid,
        axis: Axis::Col,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn toggle_group_collapsed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Result<MutationResult, ComputeError> {
    let affected = grouping::get_group_in_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    )
    .map(|group| (group.axis, group.start, group.end));
    let toggled = grouping::toggle_group_collapsed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    );
    if let Some((axis, start, end)) = affected {
        match axis {
            grouping::GroupAxis::Row => sync_row_layout_range(stores, sheet_id, start, end),
            grouping::GroupAxis::Column => sync_column_layout_range(stores, sheet_id, start, end),
        }
    }
    let mut result = MutationResult::empty();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sheet_id.to_uuid_string(),
        axis: Axis::Row,
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&toggled)?)
}

pub(in crate::storage::engine) fn expand_all_groups(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let row_bounds = grouped_axis_bounds(stores, sheet_id, grouping::GroupAxis::Row);
    let col_bounds = grouped_axis_bounds(stores, sheet_id, grouping::GroupAxis::Column);
    grouping::expand_all(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        None,
    );
    if let Some((start, end)) = row_bounds {
        sync_row_layout_range(stores, sheet_id, start, end);
    }
    if let Some((start, end)) = col_bounds {
        sync_column_layout_range(stores, sheet_id, start, end);
    }
    let mut result = MutationResult::empty();
    let sid = sheet_id.to_uuid_string();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sid.clone(),
        axis: Axis::Row,
        kind: ChangeKind::Set,
    });
    result.grouping_changes.push(GroupingChange {
        sheet_id: sid,
        axis: Axis::Col,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn collapse_all_groups(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let row_bounds = grouped_axis_bounds(stores, sheet_id, grouping::GroupAxis::Row);
    let col_bounds = grouped_axis_bounds(stores, sheet_id, grouping::GroupAxis::Column);
    grouping::collapse_all(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        None,
    );
    if let Some((start, end)) = row_bounds {
        sync_row_layout_range(stores, sheet_id, start, end);
    }
    if let Some((start, end)) = col_bounds {
        sync_column_layout_range(stores, sheet_id, start, end);
    }
    let mut result = MutationResult::empty();
    let sid = sheet_id.to_uuid_string();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sid.clone(),
        axis: Axis::Row,
        kind: ChangeKind::Set,
    });
    result.grouping_changes.push(GroupingChange {
        sheet_id: sid,
        axis: Axis::Col,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_sheet_grouping_config(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> grouping::SheetGroupingConfig {
    grouping::get_sheet_grouping_config(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_groups(
    stores: &EngineStores,
    sheet_id: &SheetId,
    axis: &str,
) -> Vec<grouping::GroupDefinition> {
    let group_axis = match axis {
        "column" | "columns" | "col" => grouping::GroupAxis::Column,
        _ => grouping::GroupAxis::Row,
    };
    grouping::get_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_axis,
    )
}

pub(in crate::storage::engine) fn get_group_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<grouping::GroupDefinition> {
    grouping::get_group_in_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    )
}

pub(in crate::storage::engine) fn get_row_outline_levels(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Vec<grouping::OutlineLevel> {
    grouping::get_row_outline_levels(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        start_row,
        end_row,
    )
}

pub(in crate::storage::engine) fn get_column_outline_levels(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<grouping::OutlineLevel> {
    grouping::get_column_outline_levels(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        start_col,
        end_col,
    )
}

pub(in crate::storage::engine) fn get_max_outline_level(
    stores: &EngineStores,
    sheet_id: &SheetId,
    axis: &str,
) -> u32 {
    let group_axis = match axis {
        "column" | "columns" | "col" => grouping::GroupAxis::Column,
        _ => grouping::GroupAxis::Row,
    };
    grouping::get_max_outline_level(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_axis,
    )
}

pub(in crate::storage::engine) fn get_outline_gutter_dimensions(
    stores: &EngineStores,
    sheet_id: &SheetId,
    level_width: u32,
    level_height: u32,
) -> Result<serde_json::Value, ComputeError> {
    let (w, h) = grouping::get_outline_gutter_dimensions(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        level_width,
        level_height,
    );
    Ok(serde_json::json!({ "width": w, "height": h }))
}

pub(in crate::storage::engine) fn get_outline_level_buttons(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<grouping::OutlineLevelButton> {
    grouping::get_outline_level_buttons(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_outline_render_data(
    stores: &EngineStores,
    sheet_id: &SheetId,
    viewport: &grouping::Viewport,
) -> grouping::OutlineRenderData {
    grouping::get_outline_render_data(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        viewport,
    )
}

pub(in crate::storage::engine) fn get_outline_symbols(
    stores: &EngineStores,
    sheet_id: &SheetId,
    viewport: &grouping::Viewport,
) -> Vec<grouping::OutlineSymbol> {
    grouping::get_outline_symbols(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        viewport,
    )
}

pub(in crate::storage::engine) fn should_render_outlines(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> bool {
    grouping::should_render_outlines(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn get_affected_rows_by_group(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    grouping::get_affected_rows_by_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    )
}

pub(in crate::storage::engine) fn get_affected_columns_by_group(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    grouping::get_affected_columns_by_group(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_id,
    )
}

pub(in crate::storage::engine) fn is_row_visible_by_groups(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> bool {
    grouping::is_row_visible_by_groups(stores.storage.doc(), stores.storage.sheets(), sheet_id, row)
}

pub(in crate::storage::engine) fn is_column_visible_by_groups(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    grouping::is_column_visible_by_groups(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col,
    )
}

pub(in crate::storage::engine) fn set_level_collapsed(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    axis: &str,
    level: u32,
    collapsed: bool,
) -> Result<MutationResult, ComputeError> {
    let group_axis = match axis {
        "column" | "columns" | "col" => grouping::GroupAxis::Column,
        _ => grouping::GroupAxis::Row,
    };
    let affected = grouped_axis_bounds_at_or_above_level(stores, sheet_id, group_axis, level);
    grouping::set_level_collapsed(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        group_axis,
        level,
        collapsed,
    );
    if let Some((start, end)) = affected {
        match group_axis {
            grouping::GroupAxis::Row => sync_row_layout_range(stores, sheet_id, start, end),
            grouping::GroupAxis::Column => sync_column_layout_range(stores, sheet_id, start, end),
        }
    }
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn set_outline_settings(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    settings: &grouping::OutlineSettingsUpdate,
) -> Result<MutationResult, ComputeError> {
    let row_bounds = grouped_axis_bounds(stores, sheet_id, grouping::GroupAxis::Row);
    let col_bounds = grouped_axis_bounds(stores, sheet_id, grouping::GroupAxis::Column);
    grouping::set_outline_settings(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        settings,
    );
    if let Some((start, end)) = row_bounds {
        sync_row_layout_range(stores, sheet_id, start, end);
    }
    if let Some((start, end)) = col_bounds {
        sync_column_layout_range(stores, sheet_id, start, end);
    }
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn clear_row_grouping(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<MutationResult, ComputeError> {
    let affected = overlapping_group_bounds(
        stores,
        sheet_id,
        grouping::GroupAxis::Row,
        start_row,
        end_row,
    );
    grouping::clear_row_grouping(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        start_row,
        end_row,
    );
    if let Some((start, end)) = affected {
        sync_row_layout_range(stores, sheet_id, start, end);
    }
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn clear_column_grouping(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let affected = overlapping_group_bounds(
        stores,
        sheet_id,
        grouping::GroupAxis::Column,
        start_col,
        end_col,
    );
    grouping::clear_column_grouping(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        start_col,
        end_col,
    );
    if let Some((start, end)) = affected {
        sync_column_layout_range(stores, sheet_id, start, end);
    }
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn clear_all_grouping(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let row_bounds = grouped_axis_bounds(stores, sheet_id, grouping::GroupAxis::Row);
    let col_bounds = grouped_axis_bounds(stores, sheet_id, grouping::GroupAxis::Column);
    grouping::clear_all_grouping(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    if let Some((start, end)) = row_bounds {
        sync_row_layout_range(stores, sheet_id, start, end);
    }
    if let Some((start, end)) = col_bounds {
        sync_column_layout_range(stores, sheet_id, start, end);
    }
    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// Sparklines
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn add_sparkline(
    stores: &EngineStores,
    sheet_id: &SheetId,
    sparkline: &sparklines::Sparkline,
) -> Result<MutationResult, ComputeError> {
    sparklines::add_sparkline(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        sparkline,
    );
    let mut result = MutationResult::empty();
    push_sparkline_change(
        stores,
        &mut result,
        sheet_id,
        sparkline.cell.row,
        sparkline.cell.col,
        ChangeKind::Set,
    );
    Ok(result)
}

pub(in crate::storage::engine) fn update_sparkline(
    stores: &EngineStores,
    sheet_id: &SheetId,
    sparkline_id: &str,
    updates: &sparklines::SparklineUpdate,
) -> Result<MutationResult, ComputeError> {
    let before = sparklines::get_sparkline(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        sparkline_id,
    );

    let updated = sparklines::update_sparkline(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        sparkline_id,
        updates,
    );
    if !updated {
        return Ok(MutationResult::empty());
    }

    let after = sparklines::get_sparkline(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        sparkline_id,
    );

    let mut result = MutationResult::empty();
    match (before, after) {
        (Some(old), Some(new)) if old.cell.row == new.cell.row && old.cell.col == new.cell.col => {
            push_sparkline_change(
                stores,
                &mut result,
                sheet_id,
                new.cell.row,
                new.cell.col,
                ChangeKind::Set,
            );
        }
        (Some(old), Some(new)) => {
            push_sparkline_change(
                stores,
                &mut result,
                sheet_id,
                old.cell.row,
                old.cell.col,
                ChangeKind::Removed,
            );
            push_sparkline_change(
                stores,
                &mut result,
                sheet_id,
                new.cell.row,
                new.cell.col,
                ChangeKind::Set,
            );
        }
        (None, Some(new)) => {
            push_sparkline_change(
                stores,
                &mut result,
                sheet_id,
                new.cell.row,
                new.cell.col,
                ChangeKind::Set,
            );
        }
        _ => {}
    }
    Ok(result)
}

pub(in crate::storage::engine) fn delete_sparkline(
    stores: &EngineStores,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Result<MutationResult, ComputeError> {
    let before = sparklines::get_sparkline(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        sparkline_id,
    );
    let deleted = sparklines::delete_sparkline(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        sparkline_id,
    );
    let mut result = MutationResult::empty();
    if deleted && let Some(old) = before {
        push_sparkline_change(
            stores,
            &mut result,
            sheet_id,
            old.cell.row,
            old.cell.col,
            ChangeKind::Removed,
        );
    }
    Ok(result)
}

pub(in crate::storage::engine) fn get_sparklines_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<sparklines::Sparkline> {
    sparklines::get_sparklines_in_sheet(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn get_sparkline(
    stores: &EngineStores,
    sheet_id: &SheetId,
    sparkline_id: &str,
) -> Option<sparklines::Sparkline> {
    sparklines::get_sparkline(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        sparkline_id,
    )
}

pub(in crate::storage::engine) fn get_sparkline_at_cell(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<sparklines::Sparkline> {
    sparklines::get_sparkline_at_cell(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        row,
        col,
    )
}

pub(in crate::storage::engine) fn add_sparkline_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group: &sparklines::SparklineGroup,
) -> Result<MutationResult, ComputeError> {
    sparklines::add_sparkline_group(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        group,
    );
    let mut result = MutationResult::empty();
    for sparkline_id in &group.sparkline_ids {
        if let Some(sparkline) = sparklines::get_sparkline(
            stores.storage.doc(),
            &stores.storage.sheets_ref(),
            sheet_id,
            sparkline_id,
        ) {
            push_sparkline_change(
                stores,
                &mut result,
                sheet_id,
                sparkline.cell.row,
                sparkline.cell.col,
                ChangeKind::Set,
            );
        }
    }
    Ok(result)
}

pub(in crate::storage::engine) fn get_sparkline_group(
    stores: &EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<sparklines::SparklineGroup> {
    sparklines::get_sparkline_group(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        group_id,
    )
}

pub(in crate::storage::engine) fn get_sparkline_groups_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<sparklines::SparklineGroup> {
    sparklines::get_sparkline_groups_in_sheet(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn delete_sparkline_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    group_id: &str,
    delete_sparklines: bool,
) -> Result<MutationResult, ComputeError> {
    let before_group = sparklines::get_sparkline_group(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        group_id,
    );
    let before_sparklines: Vec<sparklines::Sparkline> = before_group
        .as_ref()
        .map(|group| {
            group
                .sparkline_ids
                .iter()
                .filter_map(|sparkline_id| {
                    sparklines::get_sparkline(
                        stores.storage.doc(),
                        &stores.storage.sheets_ref(),
                        sheet_id,
                        sparkline_id,
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    let deleted = sparklines::delete_sparkline_group(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        group_id,
        delete_sparklines,
    );
    let mut result = MutationResult::empty();
    if deleted {
        let kind = if delete_sparklines {
            ChangeKind::Removed
        } else {
            ChangeKind::Set
        };
        for sparkline in before_sparklines {
            push_sparkline_change(
                stores,
                &mut result,
                sheet_id,
                sparkline.cell.row,
                sparkline.cell.col,
                kind,
            );
        }
    }
    Ok(result)
}

pub(in crate::storage::engine) fn clear_sparklines_in_range(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let range = sparklines::CellRange::new(start_row, start_col, end_row, end_col);
    let before: Vec<sparklines::Sparkline> = sparklines::get_sparklines_in_sheet(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
    )
    .into_iter()
    .filter(|sparkline| {
        sparkline.cell.row >= start_row
            && sparkline.cell.row <= end_row
            && sparkline.cell.col >= start_col
            && sparkline.cell.col <= end_col
    })
    .collect();

    sparklines::clear_sparklines_in_range(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        &range,
    );
    let mut result = MutationResult::empty();
    for sparkline in before {
        push_sparkline_change(
            stores,
            &mut result,
            sheet_id,
            sparkline.cell.row,
            sparkline.cell.col,
            ChangeKind::Removed,
        );
    }
    Ok(result)
}

pub(in crate::storage::engine) fn clear_sparklines_for_sheet(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let before = sparklines::get_sparklines_in_sheet(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
    );
    sparklines::clear_sparklines_for_sheet(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
    );
    let mut result = MutationResult::empty();
    for sparkline in before {
        push_sparkline_change(
            stores,
            &mut result,
            sheet_id,
            sparkline.cell.row,
            sparkline.cell.col,
            ChangeKind::Removed,
        );
    }
    Ok(result)
}

fn push_sparkline_change(
    stores: &EngineStores,
    result: &mut MutationResult,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    kind: ChangeKind,
) {
    let cell_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
        .map(|cell_id| id_to_hex(cell_id.as_u128()).to_string())
        .unwrap_or_default();

    result.sparkline_changes.push(SparklineChange {
        sheet_id: sheet_id.to_uuid_string(),
        cell_id,
        position: Some(CellPosition { row, col }),
        kind,
    });
}

pub(in crate::storage::engine) fn has_sparkline(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    sparklines::has_sparkline(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        row,
        col,
    )
}

// -------------------------------------------------------------------
// Slicer helpers (pure — from storage/slicers.rs)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn map_slicer_invalidation_reason(
    reason: &str,
) -> Result<slicers::CacheInvalidationEventReason, ComputeError> {
    let internal: slicers::SlicerInvalidationReason =
        serde_json::from_value(serde_json::Value::String(reason.to_string())).map_err(|e| {
            ComputeError::Eval {
                message: format!("Invalid invalidation reason '{}': {}", reason, e),
            }
        })?;
    Ok(slicers::map_invalidation_reason(internal))
}

pub(in crate::storage::engine) fn map_slicer_disconnection_reason(
    reason: &str,
) -> Result<slicers::DisconnectionEventReason, ComputeError> {
    let internal: slicers::SlicerDisconnectionReason =
        serde_json::from_value(serde_json::Value::String(reason.to_string())).map_err(|e| {
            ComputeError::Eval {
                message: format!("Invalid disconnection reason '{}': {}", reason, e),
            }
        })?;
    Ok(slicers::map_disconnection_reason(internal))
}

pub(in crate::storage::engine) fn get_slicer_items_from_cache(
    cache: SlicerCache,
) -> Vec<slicers::SlicerItem> {
    slicers::cache_to_slicer_items(&cache)
}

pub(in crate::storage::engine) fn is_slicer_column_connected(
    source_column_id: &str,
    table_columns: &[TableColumn],
) -> bool {
    slicers::is_slicer_column_connected(source_column_id, table_columns)
}

pub(in crate::storage::engine) fn find_slicers_for_table(
    slicer_list: &[Slicer],
    table_id: &str,
) -> Vec<usize> {
    slicers::find_slicers_for_table(slicer_list, table_id)
}

pub(in crate::storage::engine) fn find_disconnected_slicers(
    slicer_list: &[Slicer],
    existing_table_ids: &[String],
) -> Vec<usize> {
    let id_refs: Vec<&str> = existing_table_ids.iter().map(|s| s.as_str()).collect();
    slicers::find_disconnected_slicers(slicer_list, &id_refs)
}

// -------------------------------------------------------------------
// Sorting
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn check_sort_range_merges(
    stores: &EngineStores,
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> serde_json::Value {
    let range = sorting::CellRange::new(start_row, start_col, end_row, end_col);
    let (has_merges, message) = match stores.grid_indexes.get(&sheet_id) {
        Some(grid) => sorting::check_sort_range_merges(&stores.storage, sheet_id, grid, &range),
        None => (false, None),
    };
    serde_json::json!({
        "hasMerges": has_merges,
        "message": message,
    })
}

// -------------------------------------------------------------------
// Cell Operations
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn preview_text_to_columns(
    stores: &EngineStores,
    sheet_id: SheetId,
    source_start_row: u32,
    source_end_row: u32,
    source_col: u32,
    options: &cell_ops::TextToColumnsOptions,
    max_preview_rows: u32,
) -> Vec<Vec<String>> {
    let grid = match stores.grid_indexes.get(&sheet_id) {
        Some(g) => g,
        None => return vec![],
    };
    cell_ops::preview_text_to_columns(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        grid,
        source_start_row,
        source_end_row,
        source_col,
        options,
        max_preview_rows,
    )
}

// -------------------------------------------------------------------
// Slicers — CRDT operations
// -------------------------------------------------------------------

fn slicer_source_metadata(source: &SlicerSource) -> (SlicerSourceType, String) {
    match source {
        SlicerSource::Table { table_id, .. } => (SlicerSourceType::Table, table_id.clone()),
        SlicerSource::Pivot { pivot_id, .. } => (SlicerSourceType::Pivot, pivot_id.clone()),
    }
}

fn slicer_change(
    slicer: &StoredSlicer,
    kind: SlicerChangeKind,
    updated_fields: Vec<String>,
    selected_values: Option<Vec<CellValue>>,
    selection_change_type: Option<SlicerSelectionChangeType>,
) -> SlicerChange {
    let (source_type, source_id) = slicer_source_metadata(&slicer.source);
    SlicerChange {
        sheet_id: slicer.sheet_id.clone(),
        slicer_id: slicer.id.clone(),
        kind,
        source_type: Some(source_type),
        source_id: Some(source_id),
        updated_fields,
        selected_values,
        selection_change_type,
        data: Some(slicer.clone()),
    }
}

fn changed_slicer_update_fields(update: &StoredSlicerUpdate) -> Vec<String> {
    let mut fields = Vec::new();
    if update.caption.is_some() {
        fields.push("caption".to_string());
    }
    if update.name.is_some() {
        fields.push("name".to_string());
    }
    if update.style.is_some() {
        fields.push("style".to_string());
    }
    if update.position.is_some() {
        fields.push("position".to_string());
    }
    if update.z_index.is_some() {
        fields.push("zIndex".to_string());
    }
    if update.locked.is_some() {
        fields.push("locked".to_string());
    }
    if update.show_header.is_some() {
        fields.push("showHeader".to_string());
    }
    if update.start_item.is_some() {
        fields.push("startItem".to_string());
    }
    if update.multi_select.is_some() {
        fields.push("multiSelect".to_string());
    }
    if update.selected_values.is_some() {
        fields.push("selectedValues".to_string());
    }
    fields
}

pub(in crate::storage::engine) fn create_slicer(
    stores: &EngineStores,
    sheet_id: &SheetId,
    config: StoredSlicer,
) -> Result<MutationResult, ComputeError> {
    let mut slicer = config;

    // Generate UUID if id is empty
    if slicer.id.is_empty() {
        slicer.id = uuid::Uuid::from_u128(stores.grid_id_alloc.next_u128()).to_string();
    }

    // Set sheet_id from parameter
    slicer.sheet_id = format!("{:032x}", sheet_id.as_u128());

    let slicer_id = slicer.id.clone();

    {
        let workbook = stores.storage.workbook_map().clone();
        let mut txn = stores
            .storage
            .doc()
            .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
        // Lazy-create the `slicers` sub-map. Pre-fix this site silently
        // skipped the write when the sub-map didn't yet exist, leaving the
        // undo stack empty (same family as tables — see plan 07).
        let slicers_map =
            crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
        slicers_map.remove(&mut txn, &slicer_id);
        let entries = slicer_yrs::to_yrs_prelim(&slicer);
        let nested: MapPrelim = entries.into_iter().collect();
        slicers_map.insert(&mut txn, &*slicer_id, nested);
    }

    let mut result = MutationResult::empty().with_data(&slicer)?;
    result.slicer_changes.push(slicer_change(
        &slicer,
        SlicerChangeKind::Created,
        Vec::new(),
        None,
        None,
    ));
    Ok(result)
}

pub(in crate::storage::engine) fn delete_slicer(
    stores: &EngineStores,
    slicer_id: &str,
) -> Result<MutationResult, ComputeError> {
    let existing = get_slicer_state(stores, slicer_id);
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
    slicers_map.remove(&mut txn, slicer_id);
    let mut result = MutationResult::empty();
    if let Some(slicer) = existing {
        result.slicer_changes.push(slicer_change(
            &slicer,
            SlicerChangeKind::Deleted,
            Vec::new(),
            None,
            None,
        ));
    }
    Ok(result)
}

pub(in crate::storage::engine) fn update_slicer_config(
    stores: &EngineStores,
    slicer_id: &str,
    update: &StoredSlicerUpdate,
) -> Result<MutationResult, ComputeError> {
    let updated_fields = changed_slicer_update_fields(update);
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
    let slicer_opt = match slicers_map.get(&txn, slicer_id) {
        Some(yrs::Out::YMap(nested)) => slicer_yrs::from_yrs_map(&nested, &txn),
        _ => None,
    };
    let mut result = MutationResult::empty();
    if let Some(mut slicer) = slicer_opt {
        slicer.apply_update(update);
        slicers_map.remove(&mut txn, slicer_id);
        let entries = slicer_yrs::to_yrs_prelim(&slicer);
        let nested: MapPrelim = entries.into_iter().collect();
        slicers_map.insert(&mut txn, slicer_id, nested);
        if update.selected_values.is_some() {
            let selection_change_type = if slicer.selected_values.is_empty() {
                SlicerSelectionChangeType::Clear
            } else {
                SlicerSelectionChangeType::Select
            };
            result.slicer_changes.push(slicer_change(
                &slicer,
                SlicerChangeKind::SelectionChanged,
                Vec::new(),
                Some(slicer.selected_values.clone()),
                Some(selection_change_type),
            ));
        } else if !updated_fields.is_empty() {
            result.slicer_changes.push(slicer_change(
                &slicer,
                SlicerChangeKind::Updated,
                updated_fields,
                None,
                None,
            ));
        }
    }
    Ok(result)
}

pub(in crate::storage::engine) fn get_all_slicers(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<StoredSlicer> {
    let sheet_hex = format!("{:032x}", sheet_id.as_u128());
    let workbook = stores.storage.workbook_map();
    let txn = stores.storage.doc().transact();
    let mut results = Vec::new();
    if let Some(yrs::Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
        for (_key, value) in slicers_map.iter(&txn) {
            let slicer_opt = match value {
                yrs::Out::YMap(nested) => slicer_yrs::from_yrs_map(&nested, &txn),
                _ => None,
            };
            if let Some(slicer) = slicer_opt
                && slicer.sheet_id == sheet_hex
            {
                results.push(slicer);
            }
        }
    }
    results
}

/// Get all slicers across all sheets in the workbook (no sheet filter).
pub(in crate::storage::engine) fn get_all_slicers_workbook(
    stores: &EngineStores,
) -> Vec<StoredSlicer> {
    let workbook = stores.storage.workbook_map();
    let txn = stores.storage.doc().transact();
    let mut results = Vec::new();
    if let Some(yrs::Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
        for (_key, value) in slicers_map.iter(&txn) {
            let slicer_opt = match value {
                yrs::Out::YMap(nested) => slicer_yrs::from_yrs_map(&nested, &txn),
                _ => None,
            };
            if let Some(slicer) = slicer_opt {
                results.push(slicer);
            }
        }
    }
    results
}

pub(in crate::storage::engine) fn get_slicer_state(
    stores: &EngineStores,
    slicer_id: &str,
) -> Option<StoredSlicer> {
    let workbook = stores.storage.workbook_map();
    let txn = stores.storage.doc().transact();
    if let Some(yrs::Out::YMap(slicers_map)) = workbook.get(&txn, KEY_SLICERS) {
        let slicer_opt = match slicers_map.get(&txn, slicer_id) {
            Some(yrs::Out::YMap(nested)) => slicer_yrs::from_yrs_map(&nested, &txn),
            _ => None,
        };
        return slicer_opt;
    }
    None
}

pub(in crate::storage::engine) fn toggle_slicer_item(
    stores: &EngineStores,
    slicer_id: &str,
    value: &CellValue,
) -> Result<MutationResult, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
    let slicer_opt = match slicers_map.get(&txn, slicer_id) {
        Some(yrs::Out::YMap(nested)) => slicer_yrs::from_yrs_map(&nested, &txn),
        _ => None,
    };
    let mut result = MutationResult::empty();
    if let Some(mut slicer) = slicer_opt {
        if let Some(pos) = slicer.selected_values.iter().position(|v| v == value) {
            slicer.selected_values.remove(pos);
        } else {
            slicer.selected_values.push(value.clone());
        }
        slicers_map.remove(&mut txn, slicer_id);
        let entries = slicer_yrs::to_yrs_prelim(&slicer);
        let nested: MapPrelim = entries.into_iter().collect();
        slicers_map.insert(&mut txn, slicer_id, nested);
        result.slicer_changes.push(slicer_change(
            &slicer,
            SlicerChangeKind::SelectionChanged,
            Vec::new(),
            Some(slicer.selected_values.clone()),
            Some(SlicerSelectionChangeType::Toggle),
        ));
    }
    Ok(result)
}

pub(in crate::storage::engine) fn clear_slicer_selection(
    stores: &EngineStores,
    slicer_id: &str,
) -> Result<MutationResult, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let slicers_map = crate::storage::ensure_workbook_child_map(&workbook, &mut txn, KEY_SLICERS);
    let slicer_opt = match slicers_map.get(&txn, slicer_id) {
        Some(yrs::Out::YMap(nested)) => slicer_yrs::from_yrs_map(&nested, &txn),
        _ => None,
    };
    let mut result = MutationResult::empty();
    if let Some(mut slicer) = slicer_opt {
        slicer.selected_values.clear();
        slicers_map.remove(&mut txn, slicer_id);
        let entries = slicer_yrs::to_yrs_prelim(&slicer);
        let nested: MapPrelim = entries.into_iter().collect();
        slicers_map.insert(&mut txn, slicer_id, nested);
        result.slicer_changes.push(slicer_change(
            &slicer,
            SlicerChangeKind::SelectionChanged,
            Vec::new(),
            Some(Vec::new()),
            Some(SlicerSelectionChangeType::Clear),
        ));
    }
    Ok(result)
}

// -------------------------------------------------------------------
// Text to Columns — option parsing + execution
// -------------------------------------------------------------------

/// Split a single source row's text into one or more output cell inputs.
///
/// Tokens with **significant leading zeros** (e.g. `"00123"`, `"007"`) are
/// emitted as `CellInput::Literal` so the storage layer never coerces them
/// to numbers — matching Excel's General-format behaviour on the destination.
///
/// When `dest_is_numeric_formatted` is true (the destination column carries
/// an explicit Number/Currency/Accounting/Percentage/Scientific/Fraction
/// format), the user has signalled "treat this column as numbers" — so
/// leading-zero tokens *do* coerce, mirroring Excel's behaviour when a
/// Number format is applied to the destination column in the Text Wizard.
fn build_text_to_columns_inputs(
    tokens: &[String],
    dest_is_numeric_formatted: bool,
) -> Vec<crate::storage::engine::mutation::CellInput> {
    use crate::storage::engine::mutation::CellInput;
    tokens
        .iter()
        .map(|tok| {
            let trimmed = tok.trim();
            if trimmed.is_empty() {
                CellInput::Clear
            } else if !dest_is_numeric_formatted && cell_ops::has_significant_leading_zero(trimmed)
            {
                CellInput::Literal {
                    text: trimmed.to_string(),
                }
            } else {
                CellInput::Parse {
                    text: trimmed.to_string(),
                }
            }
        })
        .collect()
}

/// Check whether a column-level number format signals "treat as numbers" —
/// a Number, Currency, Accounting, Percentage, Scientific, or Fraction format.
/// General/Text/Date formats return false (leading zeros must be preserved).
fn col_format_is_numeric(format: Option<&domain_types::CellFormat>) -> bool {
    let Some(code) = format.and_then(|f| f.number_format.as_deref()) else {
        return false;
    };
    matches!(
        compute_formats::detect_format_type(code),
        compute_formats::FormatType::Number
            | compute_formats::FormatType::Currency
            | compute_formats::FormatType::Accounting
            | compute_formats::FormatType::Percentage
            | compute_formats::FormatType::Scientific
            | compute_formats::FormatType::Fraction
    )
}

#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn text_to_columns(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation_coord: &mut crate::storage::engine::mutation_coordinator::MutationCoordinator,
    sheet_id: SheetId,
    start_row: u32,
    end_row: u32,
    source_col: u32,
    dest_row: u32,
    dest_col: u32,
    options: serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let split_type = match options["splitType"].as_str() {
        Some("fixedWidth") | Some("FixedWidth") => cell_ops::TextToColumnsSplitType::FixedWidth,
        _ => cell_ops::TextToColumnsSplitType::Delimited,
    };
    let delimiters = cell_ops::Delimiters {
        tab: options["delimiters"]["tab"].as_bool().unwrap_or(false),
        semicolon: options["delimiters"]["semicolon"]
            .as_bool()
            .unwrap_or(false),
        comma: options["delimiters"]["comma"].as_bool().unwrap_or(true),
        space: options["delimiters"]["space"].as_bool().unwrap_or(false),
        other: options["delimiters"]["other"]
            .as_str()
            .map(|s| s.to_string()),
    };
    let treat_consecutive_as_one = options["treatConsecutiveAsOne"].as_bool().unwrap_or(false);
    let text_qualifier = match options["textQualifier"].as_str() {
        Some("singleQuote") | Some("SingleQuote") | Some("'") => {
            cell_ops::TextQualifier::SingleQuote
        }
        Some("none") | Some("None") => cell_ops::TextQualifier::None,
        _ => cell_ops::TextQualifier::DoubleQuote,
    };
    let fixed_width_breaks = options["fixedWidthBreaks"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_u64().map(|n| n as usize))
                .collect()
        })
        .unwrap_or_default();

    let opts = cell_ops::TextToColumnsOptions {
        split_type,
        delimiters,
        treat_consecutive_as_one,
        text_qualifier,
        fixed_width_breaks,
    };

    // 1. Read source values from the mirror as strings — text cells preserve
    //    leading zeros, numeric cells render to canonical strings.
    let source_values: Vec<String> = (start_row..=end_row)
        .map(|row| {
            let pos = SheetPos::new(row, source_col);
            match mirror.get_cell_value_at(&sheet_id, pos) {
                Some(CellValue::Text(s)) => s.to_string(),
                Some(CellValue::Number(n)) => value_types::format_number(n.get()),
                Some(CellValue::Boolean(true)) => "TRUE".to_string(),
                Some(CellValue::Boolean(false)) => "FALSE".to_string(),
                Some(CellValue::Error(e, _)) => e.as_str().to_string(),
                _ => String::new(),
            }
        })
        .collect();

    // 2. Split — preserves leading-zero tokens as strings via build_text_to_columns_inputs.
    let split_rows = cell_ops::split_all_values(&source_values, &opts);
    let max_cols = split_rows.iter().map(|r| r.len()).max().unwrap_or(1).max(1) as u32;

    // 3. For each destination column, look up its column-level number format
    //    once. A pre-applied numeric format ("treat this column as numbers")
    //    overrides the default leading-zero preservation, matching Excel's
    //    Text Wizard.
    let dest_col_is_numeric: Vec<bool> = (0..max_cols)
        .map(|offset| {
            let col = dest_col + offset;
            let col_fmt = crate::storage::properties::get_col_format(
                &stores.storage,
                &sheet_id,
                col,
                stores.grid_indexes.get(&sheet_id),
            );
            col_format_is_numeric(col_fmt.as_ref())
        })
        .collect();

    // 4. Build position-keyed edits. Pads short rows with `Clear` so trailing
    //    cells in the destination block (left over from a previous run) are
    //    cleared rather than orphaned.
    use crate::storage::engine::mutation::CellInput;
    let mut edits: Vec<(SheetId, u32, u32, CellInput)> =
        Vec::with_capacity((source_values.len() * max_cols as usize).max(1));
    for (row_offset, tokens) in split_rows.iter().enumerate() {
        let row = dest_row + row_offset as u32;
        for col_offset in 0..max_cols {
            let col = dest_col + col_offset;
            let dest_numeric = dest_col_is_numeric
                .get(col_offset as usize)
                .copied()
                .unwrap_or(false);
            // Build a single-column input slice to keep the helper stateless.
            let token_slice: Vec<String> = tokens
                .get(col_offset as usize)
                .cloned()
                .map(|t| vec![t])
                .unwrap_or_default();
            let input = build_text_to_columns_inputs(&token_slice, dest_numeric)
                .into_iter()
                .next()
                .unwrap_or(CellInput::Clear);
            edits.push((sheet_id, row, col, input));
        }
    }

    // 5. Route through the standard mutation pipeline so the mirror, viewport
    //    buffer, and undo journal all stay in sync. Skip per-edge cycle
    //    detection — a structural split can't introduce a formula cycle, and
    //    bulk routing keeps the path consistent with other batch writes.
    let should_group_undo = !edits.is_empty();
    if should_group_undo {
        mutation_coord.undo_manager.begin_undo_group();
    }
    let recalc_result = super::mutation_handlers::mutation_set_cells_by_position(
        stores,
        mirror,
        mutation_coord,
        edits,
        true,
    );
    if should_group_undo {
        mutation_coord.undo_manager.end_undo_group();
    }
    let recalc = recalc_result?;
    Ok(
        MutationResult::from_recalc(recalc).with_data(&serde_json::json!({
            "rowsProcessed": source_values.len(),
            "columnsCreated": max_cols,
        }))?,
    )
}
