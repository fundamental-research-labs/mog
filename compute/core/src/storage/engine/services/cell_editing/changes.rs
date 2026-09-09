use cell_types::{SheetId, SheetPos};
use rustc_hash::FxHashSet;
use value_types::CellValue;

use crate::cells::CellStore;
use crate::snapshot::{CellChange, CellPosition, RecalcResult};
use crate::storage::engine::stores::EngineStores;

/// Include final values for positions changed structurally but not recalculated.
/// Existing formula changes retain their before/after and validation data.
pub(in crate::storage::engine) fn append_position_changes(
    stores: &EngineStores,
    cell_store: &CellStore,
    recalc: &mut RecalcResult,
    positions: impl IntoIterator<Item = (SheetId, u32, u32)>,
) {
    let mut emitted: FxHashSet<_> = recalc
        .changed_cells
        .iter()
        .filter_map(|change| {
            change
                .position
                .as_ref()
                .map(|pos| (change.sheet_id.clone(), pos.row, pos.col))
        })
        .collect();
    for (sheet_id, row, col) in positions {
        let sheet_text = sheet_id.to_uuid_string();
        if !emitted.insert((sheet_text.clone(), row, col)) {
            continue;
        }
        let pos = SheetPos::new(row, col);
        let id = cell_store.resolve_cell_id(&sheet_id, pos);
        let value = id
            .and_then(|id| stores.compute.get_cell_value(cell_store, &id))
            .or_else(|| cell_store.get_cell_value_at(&sheet_id, pos))
            .cloned()
            .unwrap_or(CellValue::Null);
        recalc.changed_cells.push(CellChange {
            cell_id: id.map(|id| id.to_uuid_string()).unwrap_or_default(),
            sheet_id: sheet_text,
            position: Some(CellPosition { row, col }),
            value,
            new_formula: id.and_then(|id| stores.compute.get_formula(&id).map(str::to_owned)),
            display_text: None,
            old_display_text: None,
            old_formula: None,
            number_format: None,
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        });
    }
}
