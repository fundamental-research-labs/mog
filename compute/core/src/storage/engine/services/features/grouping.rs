use crate::snapshot::{Axis, ChangeKind, GroupingChange, MutationResult};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{dimensions, grouping};
use cell_types::SheetId;
use value_types::ComputeError;

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
