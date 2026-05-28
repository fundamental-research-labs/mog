use cell_types::{CellId, SheetId};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::identity::GridIndex;
use domain_types::domain::hyperlink::Hyperlink;
use yrs::{Doc, Map, MapRef, Out, Transact};

use crate::range_manager::pos_to_a1;
use crate::storage::infra::grid_helpers::get_cells_map;

use super::codec::{decode_full_hyperlink, decode_sheet_hyperlink, read_hyperlink_url};

/// Get the hyperlink URL for a cell at the given position.
///
/// Returns `None` if no cell exists at the position or the cell has no hyperlink.
pub fn get_hyperlink(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
) -> Option<String> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cell_id = grid.cell_id_at(row, col)?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex)?;
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    read_hyperlink_url(&txn, &cell_map)
}

/// Get the full hyperlink metadata for a cell at the given position.
///
/// Returns `None` if no cell exists at the position or the cell has no hyperlink
/// primary key. The `cell_ref` field is left empty because the caller owns point
/// position context.
#[allow(dead_code)]
pub fn get_hyperlink_full(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
) -> Option<Hyperlink> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cell_id = grid.cell_id_at(row, col)?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex)?;
    let cell_map = match cells_map.get(&txn, &cell_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };

    decode_full_hyperlink(&txn, &cell_map, String::new())
}

/// Batch-read all cell-level hyperlinks for a sheet in a single transaction.
pub fn get_all_hyperlinks(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &GridIndex,
) -> Vec<Hyperlink> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let cells_map = match get_cells_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (cell_hex, cell_out) in cells_map.iter(&txn) {
        let cell_map = match cell_out {
            Out::YMap(m) => m,
            _ => continue,
        };

        let cell_ref = hex_to_id(cell_hex)
            .and_then(|raw| {
                let cid = CellId::from_raw(raw);
                grid.cell_position(&cid)
            })
            .map(|(row, col)| pos_to_a1(row, col))
            .unwrap_or_default();

        if let Some(link) = decode_sheet_hyperlink(&txn, &cell_map, cell_ref) {
            result.push(link);
        }
    }

    result.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cell_ref.cmp(&b.1.cell_ref)));
    result.into_iter().map(|(_, h)| h).collect()
}
