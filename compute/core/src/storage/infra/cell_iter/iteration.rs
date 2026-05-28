use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use yrs::{Doc, MapRef, Transact};

use super::super::grid_helpers::get_cells_map;
use super::read::{read_cell_formula, read_cell_value};
use super::types::IterCellData;
use cell_types::{CellId, RangePos, SheetId};

/// Iterate over all cells in a sheet.
///
/// The callback receives `(row, col, &IterCellData)` for each cell
/// registered in the GridIndex. Values/formulas are read from the yrs
/// `cells` map by cell-hex.
pub(crate) fn for_each_cell<F>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    mut callback: F,
) where
    F: FnMut(u32, u32, &IterCellData),
{
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) else {
        return;
    };

    // Collect first to decouple from the grid's internal iterator lifetime.
    let cells: Vec<(CellId, u32, u32)> = grid.cells().collect();
    for (cell_id, row, col) in cells {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let value = read_cell_value(&txn, &cells_map, &cell_hex);
        let formula = read_cell_formula(&txn, &cells_map, &cell_hex);

        let data = IterCellData {
            cell_id,
            row,
            col,
            value,
            formula,
        };
        callback(row, col, &data);
    }
}

/// Iterate over cells in a specific range.
///
/// The callback receives `(row, col, Option<&IterCellData>)` for each
/// position in the range. If there is no cell at a position, the data is
/// `None`.
pub(crate) fn for_each_cell_in_range<F>(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    range: &RangePos,
    mut callback: F,
) where
    F: FnMut(u32, u32, Option<&IterCellData>),
{
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex);

    for row in range.start_row()..=range.end_row() {
        for col in range.start_col()..=range.end_col() {
            let data_opt = grid.cell_id_at(row, col).and_then(|cell_id| {
                let cells_map = cells_map.as_ref()?;
                let cell_hex = id_to_hex(cell_id.as_u128());
                let value = read_cell_value(&txn, cells_map, &cell_hex);
                let formula = read_cell_formula(&txn, cells_map, &cell_hex);
                Some(IterCellData {
                    cell_id,
                    row,
                    col,
                    value,
                    formula,
                })
            });
            callback(row, col, data_opt.as_ref());
        }
    }
}
