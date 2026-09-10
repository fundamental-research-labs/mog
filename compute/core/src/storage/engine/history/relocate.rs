//! Atomic inverses for moving stable identities, including overlapping moves.
use std::sync::Arc;

use cell_types::{CellId, PayloadEncoding, RangeId, SheetId, SheetPos};
use rustc_hash::FxHashSet;
use value_types::CellValue;

use super::{HistoryEffects, HistoryPatch, structure::SheetExtentPatch};
use crate::cells::{CellEntry, CellStore};
use crate::storage::engine::stores::EngineStores;

#[derive(Debug)]
struct CellState {
    id: CellId,
    owner: Option<SheetId>,
    position: Option<SheetPos>,
    identity_formula: Option<formula_types::IdentityFormula>,
    entry: Option<CellEntry>,
    formula: Option<String>,
    cse: Option<(u32, u32)>,
}
impl CellState {
    fn read(stores: &EngineStores, cell_store: &CellStore, id: CellId) -> Self {
        let owner = cell_store.sheet_for_cell(&id);
        let source = owner.and_then(|sid| cell_store.get_sheet(&sid));
        let position = source.and_then(|sheet| sheet.position_of(&id));
        let cse = cell_store.cse_anchors.contains(&id).then(|| {
            cell_store
                .projection_registry
                .get(&id)
                .map(|p| (p.rows, p.cols))
                .unwrap_or((1, 1))
        });
        Self {
            id,
            owner,
            position,
            identity_formula: cell_store.formulas.get(&id).cloned(),
            entry: cell_store.cells.get(&id).cloned(),
            formula: owner.and_then(|_| stores.compute.get_formula(&id).map(str::to_owned)),
            cse,
        }
    }
    fn changed(&self, current: &Self) -> bool {
        self.owner != current.owner
            || self.position != current.position
            || self.formula != current.formula
            || self.cse != current.cse
            || self.identity_formula != current.identity_formula
            || (self.formula.is_none() && self.entry != current.entry)
    }
}

#[derive(Debug)]
struct PayloadSlots {
    sheet: SheetId,
    range: RangeId,
    encoding: PayloadEncoding,
    slots: Vec<(usize, CellValue)>,
}

#[derive(Debug)]
pub(crate) struct RelocatePatch {
    sheets: Vec<SheetId>,
    extents: Vec<SheetExtentPatch>,
    cells: Vec<CellState>,
    payloads: Vec<PayloadSlots>,
    rectangles: Vec<(SheetId, u32, u32, u32, u32)>,
}

impl RelocatePatch {
    pub(crate) fn is_changed(&self, stores: &EngineStores, cell_store: &CellStore) -> bool {
        self.cells
            .iter()
            .any(|cell| cell.changed(&CellState::read(stores, cell_store, cell.id)))
    }

    pub(crate) fn swap(
        &mut self,
        stores: &mut EngineStores,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    ) {
        // Capture all mappings before any registration can displace an overlapping identity.
        let mut current: Vec<_> = self
            .cells
            .iter()
            .map(|cell| CellState::read(stores, cell_store, cell.id))
            .collect();
        for cell in &mut current {
            if let Some(text) = effects.formula_texts.get(&cell.id) {
                cell.formula = text.clone();
            }
        }
        for payload in &mut self.payloads {
            if let Some(range) = cell_store
                .get_sheet_mut(&payload.sheet)
                .and_then(|sheet| sheet.range_views.get_mut(&payload.range))
            {
                std::mem::swap(&mut payload.encoding, &mut range.encoding);
                let values = Arc::make_mut(&mut range.values);
                for (index, value) in &mut payload.slots {
                    std::mem::swap(value, &mut values[*index]);
                }
            }
        }
        for cell in &self.cells {
            cell_store.remove_cell(&cell.id);
            cell_store.cse_anchors.remove(&cell.id);
            cell_store.cse_single_cell.remove(&cell.id);
            if let Some(projection) = cell_store.projection_registry.remove(&cell.id) {
                effects.projections.push((cell.id, projection));
            }
        }
        for extent in &mut self.extents {
            extent.swap(stores, cell_store, effects);
        }
        for cell in &mut self.cells {
            if let (Some(sid), Some(position)) = (cell.owner, cell.position) {
                if let Some(entry) = cell.entry.take() {
                    cell_store.apply_edit(
                        &sid,
                        cell.id,
                        position,
                        entry.value,
                        cell.identity_formula.take(),
                    );
                } else {
                    cell_store.register_identity_position(sid, position, cell.id);
                }
                {
                    effects
                        .cells
                        .insert(cell.id, (sid, position.row(), position.col()));
                }
                if let Some((rows, cols)) = cell.cse {
                    cell_store.cse_anchors.insert(cell.id);
                    if rows == 1 && cols == 1 {
                        cell_store.cse_single_cell.insert(cell.id);
                    }
                    cell_store.projection_registry.register(
                        cell.id,
                        sid,
                        position.row(),
                        position.col(),
                        rows,
                        cols,
                    );
                }
            }
            effects.formula_texts.insert(cell.id, cell.formula.clone());
        }
        for sid in &self.sheets {
            cell_store.history_rebuild_sheet(*sid);
            effects.sheets.insert(*sid);
        }
        effects.format_rects.extend(self.rectangles.iter().copied());
        effects.recalc = true;
        effects.topology = true;
        self.cells = current;
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn capture_relocation(
    stores: &EngineStores,
    cell_store: &CellStore,
    source: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    target: SheetId,
    target_row: u32,
    target_col: u32,
) {
    let capture = &stores.storage.history;
    if !capture.is_active() {
        return;
    }
    let Some(source_grid) = cell_store.get_sheet(&source) else {
        return;
    };
    let Some(target_grid) = cell_store.get_sheet(&target) else {
        return;
    };
    let moving: Vec<_> = source_grid
        .cells_in_range(start_row, start_col, end_row, end_col)
        .collect();
    if moving.is_empty() {
        return;
    }
    let target_end_row = target_row.saturating_add(end_row.saturating_sub(start_row));
    let target_end_col = target_col.saturating_add(end_col.saturating_sub(start_col));
    let ids: FxHashSet<_> = moving
        .iter()
        .map(|(id, _, _)| *id)
        .chain(
            target_grid
                .cells_in_range(target_row, target_col, target_end_row, target_end_col)
                .map(|(id, _, _)| id),
        )
        .collect();
    let sheets = if source == target {
        vec![source]
    } else {
        vec![source, target]
    };
    capture.record(|| {
        let cells = ids
            .into_iter()
            .map(|id| CellState::read(stores, cell_store, id))
            .collect();
        let mut payloads = Vec::new();
        if let Some(sheet) = cell_store.get_sheet(&target) {
            for range in sheet.range_views.values() {
                let mut slots = FxHashSet::default();
                for &(_, row, col) in &moving {
                    let row = target_row + row - start_row;
                    let col = target_col + col - start_col;
                    if let (Some(row), Some(col)) = (sheet.row_id_at(row), sheet.col_id_at(col))
                        && let (Some(row), Some(col)) = (
                            range.row_offset_by_id.get(&row),
                            range.col_offset_by_id.get(&col),
                        )
                    {
                        slots.insert(row as usize * range.payload_cols as usize + col as usize);
                    }
                }
                if !slots.is_empty() {
                    payloads.push(PayloadSlots {
                        sheet: target,
                        range: range.range_id,
                        encoding: range.encoding,
                        slots: slots
                            .into_iter()
                            .filter_map(|index| {
                                range.values.get(index).map(|value| (index, value.clone()))
                            })
                            .collect(),
                    });
                }
            }
        }
        let extents = sheets
            .iter()
            .map(|sid| SheetExtentPatch::capture(cell_store, *sid))
            .collect();
        HistoryPatch::Relocate(RelocatePatch {
            sheets,
            extents,
            cells,
            payloads,
            rectangles: vec![
                (source, start_row, start_col, end_row, end_col),
                (
                    target,
                    target_row,
                    target_col,
                    target_end_row,
                    target_end_col,
                ),
            ],
        })
    });
}
