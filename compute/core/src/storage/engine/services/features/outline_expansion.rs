use std::collections::BTreeSet;

use crate::storage::engine::history::metadata::{capture_column, capture_row};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::dimensions;
use cell_types::SheetId;

pub(super) fn unhide_expanded_row_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start: u32,
    end: u32,
) {
    let zero_height_rows = (start..=end)
        .filter(|row| {
            dimensions::get_row_height_stored(
                &stores.storage,
                sheet_id,
                *row,
                stores.grid_indexes.get(sheet_id),
            )
            .0
            .abs()
                < f64::EPSILON
        })
        .collect::<BTreeSet<_>>();

    clear_expanded_row_group_metadata(stores, sheet_id, start, end, &zero_height_rows);

    for row in &zero_height_rows {
        let _ = dimensions::set_row_height(
            &mut stores.storage,
            sheet_id,
            *row,
            dimensions::DEFAULT_ROW_HEIGHT,
            stores.grid_indexes.get(sheet_id),
        );
    }

    stores.invalidate_pixel_layout(sheet_id);
}

fn clear_expanded_row_group_metadata(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start: u32,
    end: u32,
    zero_height_rows: &BTreeSet<u32>,
) {
    if stores.storage.history.is_active()
        && let (Some(meta), Some(grid)) = (
            stores.storage.sheet_metadata.get(sheet_id),
            stores.grid_indexes.get(sheet_id),
        )
    {
        for id in meta.dimensions.rows.keys() {
            if grid.row_index(id).is_some_and(|row| {
                (row >= start && row <= end.saturating_add(1)) || zero_height_rows.contains(&row)
            }) {
                capture_row(&stores.storage, *sheet_id, *id);
            }
        }
    }
    let (Some(meta), Some(grid)) = (
        stores.storage.sheet_metadata.get_mut(sheet_id),
        stores.grid_indexes.get(sheet_id),
    ) else {
        return;
    };
    for (id, record) in &mut meta.dimensions.rows {
        let Some(row) = grid.row_index(id) else {
            continue;
        };
        if row >= start && row <= end.saturating_add(1) {
            record.collapsed = None;
        }
        if row >= start && row <= end {
            record.explicit_hidden = false;
        }
        if zero_height_rows.contains(&row) {
            record.custom_height = false;
        }
    }
}

pub(super) fn unhide_expanded_column_group(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start: u32,
    end: u32,
) {
    clear_expanded_column_group_collapsed_markers(stores, sheet_id, start, end);

    let cols: Vec<u32> = (start..=end).collect();
    dimensions::unhide_columns(
        &mut stores.storage,
        sheet_id,
        &cols,
        stores.grid_indexes.get(sheet_id),
    );
}

fn clear_expanded_column_group_collapsed_markers(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    start: u32,
    end: u32,
) {
    if stores.storage.history.is_active()
        && let (Some(meta), Some(grid)) = (
            stores.storage.sheet_metadata.get(sheet_id),
            stores.grid_indexes.get(sheet_id),
        )
    {
        for id in meta.dimensions.columns.keys() {
            if grid
                .col_index(id)
                .is_some_and(|col| col >= start && col <= end.saturating_add(1))
            {
                capture_column(&stores.storage, *sheet_id, *id);
            }
        }
    }
    let (Some(meta), Some(grid)) = (
        stores.storage.sheet_metadata.get_mut(sheet_id),
        stores.grid_indexes.get(sheet_id),
    ) else {
        return;
    };
    for (id, record) in &mut meta.dimensions.columns {
        if grid
            .col_index(id)
            .is_some_and(|col| col >= start && col <= end.saturating_add(1))
        {
            record.collapsed = false;
            record.collapsed_attr = None;
        }
    }
}
