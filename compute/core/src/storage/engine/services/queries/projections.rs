use super::*;

// -------------------------------------------------------------------
// Projection Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn is_projection_source(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    cell_store
        .projection_registry
        .source_at(sheet_id, row, col)
        .is_some()
}

pub(in crate::storage::engine) fn is_projected_position(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    if let Some((_source, er, ec)) = cell_store.projection_registry.resolve(sheet_id, row, col) {
        return er != 0 || ec != 0;
    }
    false
}

pub(in crate::storage::engine) fn get_projection_range(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<RectBounds> {
    if let Some(source) = cell_store.projection_registry.source_at(sheet_id, row, col)
        && let Some(proj) = cell_store.projection_registry.get(&source)
    {
        return Some(RectBounds {
            start_row: proj.origin_row,
            start_col: proj.origin_col,
            end_row: proj.origin_row + proj.rows - 1,
            end_col: proj.origin_col + proj.cols - 1,
        });
    }
    None
}

pub(in crate::storage::engine) fn get_projection_source(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<SheetPos> {
    if let Some((source, er, ec)) = cell_store.projection_registry.resolve(sheet_id, row, col)
        && (er != 0 || ec != 0)
        && let Some(proj) = cell_store.projection_registry.get(&source)
    {
        return Some(SheetPos::new(proj.origin_row, proj.origin_col));
    }
    None
}

pub(in crate::storage::engine) fn get_viewport_projection_data(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<ProjectionData> {
    let registry = &cell_store.projection_registry;
    let projections =
        registry.projections_in_range(sheet_id, start_row, start_col, end_row + 1, end_col + 1);

    projections
        .into_iter()
        .map(|proj| ProjectionData {
            origin_row: proj.origin_row,
            origin_col: proj.origin_col,
            rows: proj.rows,
            cols: proj.cols,
        })
        .collect()
}
