//! Atomic inverses for moving stable identities, including overlapping moves.
use std::sync::Arc;

use cell_types::{CellId, PayloadEncoding, RangeId, SheetId, SheetPos};
use rustc_hash::FxHashSet;
use value_types::CellValue;

use super::{HistoryEffects, HistoryPatch, structure::SheetExtentPatch};
use crate::mirror::{CellEntry, CellMirror};
use crate::storage::engine::stores::EngineStores;

#[derive(Debug)]
struct CellState {
    id: CellId,
    owner: Option<SheetId>,
    position: Option<SheetPos>,
    positional_owner: bool,
    grid: Option<(SheetId, u32, u32)>,
    entry: Option<CellEntry>,
    formula: Option<String>,
    cse: Option<(u32, u32)>,
}
impl CellState {
    fn read(stores: &EngineStores, mirror: &CellMirror, sheets: &[SheetId], id: CellId) -> Self {
        let owner = mirror.sheet_for_cell(&id);
        let source = owner.and_then(|sid| mirror.get_sheet(&sid));
        let position = source.and_then(|sheet| sheet.id_to_pos.get(&id)).copied();
        let grid = sheets.iter().find_map(|sid| {
            stores
                .grid_indexes
                .get(sid)
                .and_then(|grid| grid.cell_position(&id))
                .map(|(row, col)| (*sid, row, col))
        });
        let cse = mirror.cse_anchors.contains(&id).then(|| {
            mirror
                .projection_registry
                .get(&id)
                .map(|p| (p.rows, p.cols))
                .unwrap_or((1, 1))
        });
        let positional_owner = source
            .zip(position)
            .is_some_and(|(sheet, pos)| sheet.pos_to_id.get(&pos) == Some(&id));
        Self {
            id,
            owner,
            position,
            positional_owner,
            grid,
            entry: source.and_then(|sheet| sheet.cells.get(&id)).cloned(),
            formula: owner.and_then(|_| stores.compute.get_formula(&id).map(str::to_owned)),
            cse,
        }
    }
    fn changed(&self, current: &Self) -> bool {
        self.owner != current.owner
            || self.positional_owner != current.positional_owner
            || self.position != current.position
            || self.grid != current.grid
            || self.formula != current.formula
            || self.cse != current.cse
            || self.entry.as_ref().map(|entry| &entry.formula)
                != current.entry.as_ref().map(|entry| &entry.formula)
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
    pub(crate) fn is_changed(&self, stores: &EngineStores, mirror: &CellMirror) -> bool {
        self.cells
            .iter()
            .any(|cell| cell.changed(&CellState::read(stores, mirror, &self.sheets, cell.id)))
    }

    pub(crate) fn swap(
        &mut self,
        stores: &mut EngineStores,
        mirror: &mut CellMirror,
        effects: &mut HistoryEffects,
    ) {
        // Capture all mappings before any registration can displace an overlapping identity.
        let mut current: Vec<_> = self
            .cells
            .iter()
            .map(|cell| CellState::read(stores, mirror, &self.sheets, cell.id))
            .collect();
        for cell in &mut current {
            if let Some(text) = effects.formula_texts.get(&cell.id) {
                cell.formula = text.clone();
            }
        }
        for payload in &mut self.payloads {
            if let Some(range) = mirror
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
            mirror.remove_cell(&cell.id);
            mirror.cse_anchors.remove(&cell.id);
            mirror.cse_single_cell.remove(&cell.id);
            if let Some(projection) = mirror.projection_registry.remove(&cell.id) {
                effects.projections.push((cell.id, projection));
            }
            for sid in &self.sheets {
                if let Some(grid) = stores.grid_indexes.get_mut(sid) {
                    grid.remove_cell(&cell.id);
                }
            }
        }
        for extent in &mut self.extents {
            extent.swap(stores, mirror, effects);
        }
        for cell in &mut self.cells {
            if let (Some(sid), Some(position)) = (cell.owner, cell.position) {
                if let Some(entry) = cell.entry.take() {
                    mirror.insert_cell(&sid, cell.id, position, entry);
                } else {
                    mirror.register_identity_position(sid, position, cell.id);
                }
                if cell.positional_owner {
                    effects
                        .cells
                        .insert(cell.id, (sid, position.row(), position.col()));
                }
                if let Some((rows, cols)) = cell.cse {
                    mirror.cse_anchors.insert(cell.id);
                    if rows == 1 && cols == 1 {
                        mirror.cse_single_cell.insert(cell.id);
                    }
                    mirror.projection_registry.register(
                        cell.id,
                        sid,
                        position.row(),
                        position.col(),
                        rows,
                        cols,
                    );
                }
            }
            if let Some((sid, row, col)) = cell.grid {
                if let Some(grid) = stores.grid_indexes.get_mut(&sid) {
                    grid.register_cell(cell.id, row, col);
                }
            }
            effects.formula_texts.insert(cell.id, cell.formula.clone());
        }
        // Displaced cells can retain a Null identity entry at the same position
        // as a moved cell. Preserve its identity without letting replay order
        // replace the actual position owner with that dormant entry.
        for cell in &self.cells {
            if let (Some(sid), Some(pos)) = (cell.owner, cell.position)
                && !cell.positional_owner
                && let Some(sheet) = mirror.get_sheet_mut(&sid)
                && sheet.pos_to_id.get(&pos) == Some(&cell.id)
            {
                sheet.pos_to_id.remove(&pos);
            }
        }
        for cell in &self.cells {
            if let (Some(sid), Some(pos)) = (cell.owner, cell.position)
                && cell.positional_owner
                && let Some(sheet) = mirror.get_sheet_mut(&sid)
            {
                sheet.pos_to_id.insert(pos, cell.id);
            }
        }
        for sid in &self.sheets {
            mirror.history_rebuild_sheet(*sid);
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
    mirror: &CellMirror,
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
    let Some(source_grid) = stores.grid_indexes.get(&source) else {
        return;
    };
    let Some(target_grid) = stores.grid_indexes.get(&target) else {
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
            .map(|id| CellState::read(stores, mirror, &sheets, id))
            .collect();
        let mut payloads = Vec::new();
        if let Some(sheet) = mirror.get_sheet(&target) {
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
                        slots.insert(*row as usize * range.payload_cols as usize + *col as usize);
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
            .map(|sid| SheetExtentPatch::capture(mirror, *sid))
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
