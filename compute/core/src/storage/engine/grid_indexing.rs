use crate::cells::CellStore;
use crate::identity::GridIndex;
use crate::snapshot::SheetSnapshot;
use cell_types::SheetId;

pub(in crate::storage::engine) fn build_grid_from_native_sheet(
    cell_store: &CellStore,
    sheet_id: SheetId,
    snapshot: &SheetSnapshot,
    allocator: std::sync::Arc<cell_types::IdAllocator>,
) -> Result<GridIndex, value_types::ComputeError> {
    let grid = if let Some(sheet) = cell_store.get_sheet(&sheet_id)
        && (sheet.row_axis.len() != 0 || snapshot.rows == 0)
        && (sheet.col_axis.len() != 0 || snapshot.cols == 0)
    {
        GridIndex::from_shared_axes(
            sheet_id,
            sheet.row_axis.clone(),
            sheet.col_axis.clone(),
            allocator,
        )
    } else if let (Some(rows), Some(cols)) = (&snapshot.row_axis, &snapshot.col_axis) {
        GridIndex::from_axis_stores(sheet_id, rows.clone(), cols.clone(), allocator)
    } else {
        GridIndex::new(sheet_id, snapshot.rows, snapshot.cols, allocator)
    };
    Ok(grid)
}
