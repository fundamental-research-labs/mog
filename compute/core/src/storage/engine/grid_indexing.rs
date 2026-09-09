use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::snapshot::SheetSnapshot;
use cell_types::{CellId, SheetId};

pub(in crate::storage::engine) fn build_grid_from_native_sheet(
    mirror: &CellMirror,
    sheet_id: SheetId,
    snapshot: &SheetSnapshot,
    allocator: std::sync::Arc<cell_types::IdAllocator>,
) -> Result<GridIndex, value_types::ComputeError> {
    let mut grid = if let Some(sheet) = mirror.get_sheet(&sheet_id)
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
    for cell in &snapshot.cells {
        let id = CellId::from_uuid_str(&cell.cell_id)?;
        grid.register_cell(id, cell.row, cell.col);
    }
    for identity in &snapshot.identities {
        if grid.cell_id_at(identity.row, identity.col).is_none() {
            grid.register_cell(identity.cell_id, identity.row, identity.col);
        }
    }
    if let Some(sheet) = mirror.get_sheet(&sheet_id) {
        for (&id, &pos) in &sheet.id_to_pos {
            if grid.cell_id_at(pos.row(), pos.col()).is_none() {
                grid.register_cell(id, pos.row(), pos.col());
            }
        }
    }
    Ok(grid)
}
