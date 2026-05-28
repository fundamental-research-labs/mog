use cell_types::{SheetId, SheetPos};
use snapshot_types::CellChange;
use value_types::CellValue;

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

pub(in crate::storage::engine::viewport) fn build_comment_changed_cells(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cells: &[(u32, u32)],
    has_comment: bool,
) -> Vec<CellChange> {
    let sheet_id_str = sheet_id.to_uuid_string();
    let extra_flags = if has_comment {
        compute_wire::flags::HAS_COMMENT
    } else {
        0
    };

    cells
        .iter()
        .map(|&(row, col)| {
            let pos = SheetPos::new(row, col);
            let value = mirror
                .get_cell_value_at(sheet_id, pos)
                .cloned()
                .unwrap_or(CellValue::Null);

            let cell_id_str = stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_id_at(row, col))
                .map(|cid| cid.to_uuid_string())
                .unwrap_or_default();

            CellChange {
                cell_id: cell_id_str,
                sheet_id: sheet_id_str.clone(),
                position: Some(snapshot_types::CellPosition { row, col }),
                value,
                display_text: None,
                format_idx: None,
                extra_flags,
                old_value: None,
            }
        })
        .collect()
}

/// Build the changed cells for sparkline viewport patches.
///
/// Sparkline mutations affect only metadata flags. The cell value comes from
/// the current mirror state and `HAS_SPARKLINE` is derived from post-mutation
/// storage state so add/update/delete all serialize the correct bit.
pub(in crate::storage::engine::viewport) fn build_sparkline_changed_cells(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cells: &[(u32, u32)],
) -> Vec<CellChange> {
    let sheet_id_str = sheet_id.to_uuid_string();

    cells
        .iter()
        .map(|&(row, col)| {
            let pos = SheetPos::new(row, col);
            let value = mirror
                .get_cell_value_at(sheet_id, pos)
                .cloned()
                .unwrap_or(CellValue::Null);

            let cell_id_str = stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_id_at(row, col))
                .map(|cid| cid.to_uuid_string())
                .unwrap_or_default();

            let extra_flags = if crate::storage::sheet::sparklines::has_sparkline(
                stores.storage.doc(),
                &stores.storage.sheets_ref(),
                sheet_id,
                row,
                col,
            ) {
                compute_wire::flags::HAS_SPARKLINE
            } else {
                0
            };

            CellChange {
                cell_id: cell_id_str,
                sheet_id: sheet_id_str.clone(),
                position: Some(snapshot_types::CellPosition { row, col }),
                value,
                display_text: None,
                format_idx: None,
                extra_flags,
                old_value: None,
            }
        })
        .collect()
}
