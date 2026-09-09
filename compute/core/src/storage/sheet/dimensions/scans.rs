use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::units::{CharWidth, Points};

pub fn get_all_custom_row_heights(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: Option<&GridIndex>,
) -> Vec<(usize, Points)> {
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get(sheet_id), grid) else {
        return vec![];
    };
    let mut result: Vec<_> = meta
        .dimensions
        .rows
        .iter()
        .filter_map(|(id, row)| Some((grid.row_index(id)? as usize, row.height?)))
        .collect();
    result.sort_unstable_by_key(|(index, _)| *index);
    result
}
pub fn get_all_custom_col_widths(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: Option<&GridIndex>,
) -> Vec<(usize, CharWidth)> {
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get(sheet_id), grid) else {
        return vec![];
    };
    let mut result: Vec<_> = meta
        .dimensions
        .columns
        .iter()
        .filter_map(|(id, col)| Some((grid.col_index(id)? as usize, col.width?)))
        .collect();
    result.sort_unstable_by_key(|(index, _)| *index);
    result
}
pub fn get_max_materialized_col(grid: Option<&GridIndex>) -> Option<u32> {
    grid?.col_count().checked_sub(1)
}
