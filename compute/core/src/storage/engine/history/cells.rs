//! Sparse cell inverses: one authored entry and only the imported payload slots it replaces.
use super::{HistoryEffects, HistoryKey, HistoryPatch};
use crate::mirror::{CellEntry, CellMirror};
use crate::storage::engine::stores::EngineStores;
use cell_types::{CellId, RangeId, SheetId, SheetPos};
use std::sync::Arc;
use value_types::CellValue;

#[derive(Debug)]
pub(crate) struct CellPatch {
    sheet: SheetId,
    cell: CellId,
    pos: SheetPos,
    entry: Option<CellEntry>,
    mirror_pos: Option<SheetPos>,
    grid_pos: Option<(u32, u32)>,
    formula: Option<String>,
    slots: Vec<(RangeId, usize, CellValue)>,
    cse: Option<(u32, u32)>,
}

pub(crate) fn capture_cell(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet: SheetId,
    cell: CellId,
    row: u32,
    col: u32,
) {
    if !stores.storage.history.is_active() {
        return;
    }
    if stores.storage.history.owns_sheet(sheet) {
        stores.storage.history.mark_cell_owned(cell);
        return;
    }
    super::structure::capture_sheet_extent(stores, mirror, sheet);
    stores
        .storage
        .history
        .record_once(HistoryKey::Cell(sheet, cell), || {
            HistoryPatch::Cell(CellPatch::read(
                stores,
                mirror,
                sheet,
                cell,
                SheetPos::new(row, col),
            ))
        });
}

impl CellPatch {
    fn read(
        stores: &EngineStores,
        mirror: &CellMirror,
        sheet: SheetId,
        cell: CellId,
        pos: SheetPos,
    ) -> Self {
        let source = mirror.get_sheet(&sheet);
        let mut slots = Vec::new();
        if let Some(source) = source
            && let Some(row_id) = source.row_id_at(pos.row())
            && let Some(col_id) = source.col_id_at(pos.col())
            && let Some(ranges) = source.range_columns.get(&pos.col())
        {
            for range_id in ranges {
                let range = &source.range_views[range_id];
                if let (Some(row), Some(col)) = (
                    range.row_offset_by_id.get(&row_id),
                    range.col_offset_by_id.get(&col_id),
                ) {
                    let index = *row as usize * range.payload_cols as usize + *col as usize;
                    if let Some(value) = range.values.get(index) {
                        slots.push((*range_id, index, value.clone()));
                    }
                }
            }
        }
        let cse =
            if mirror.sheet_for_cell(&cell) == Some(sheet) && mirror.cse_anchors.contains(&cell) {
                mirror
                    .projection_registry
                    .get(&cell)
                    .map(|p| (p.rows, p.cols))
                    .or(Some((1, 1)))
            } else {
                None
            };
        Self {
            sheet,
            cell,
            pos,
            entry: source.and_then(|s| s.cells.get(&cell)).cloned(),
            mirror_pos: source.and_then(|s| s.id_to_pos.get(&cell)).copied(),
            grid_pos: stores
                .grid_indexes
                .get(&sheet)
                .and_then(|g| g.cell_position(&cell)),
            formula: (mirror.sheet_for_cell(&cell) == Some(sheet))
                .then(|| stores.compute.get_formula(&cell).map(str::to_owned))
                .flatten(),
            slots,
            cse,
        }
    }

    pub(super) fn is_changed(&self, stores: &EngineStores, mirror: &CellMirror) -> bool {
        let current = Self::read(stores, mirror, self.sheet, self.cell, self.pos);
        let entry_changed = if self.formula.is_some() && self.formula == current.formula {
            self.entry.as_ref().map(|entry| &entry.formula)
                != current.entry.as_ref().map(|entry| &entry.formula)
        } else {
            self.entry != current.entry
        };
        self.mirror_pos != current.mirror_pos
            || self.grid_pos != current.grid_pos
            || entry_changed
            || self.formula != current.formula
            || self.slots != current.slots
            || self.cse != current.cse
    }

    pub(super) fn swap(
        &mut self,
        stores: &mut EngineStores,
        mirror: &mut CellMirror,
        effects: &mut HistoryEffects,
    ) {
        let mut current = Self::read(stores, mirror, self.sheet, self.cell, self.pos);
        if let Some(formula) = effects.formula_texts.get(&self.cell) {
            current.formula = formula.clone();
        }
        effects.old_values.entry(self.cell).or_insert_with(|| {
            mirror
                .get_cell_value_at(&self.sheet, self.pos)
                .cloned()
                .unwrap_or(CellValue::Null)
        });
        effects
            .old_formulas
            .entry(self.cell)
            .or_insert_with(|| current.formula.clone());
        if let Some(projection) = mirror.projection_registry.remove(&self.cell) {
            mirror.clear_materialization(
                &projection.sheet,
                projection.origin_row,
                projection.origin_col,
                projection.rows,
                projection.cols,
            );
            effects.projections.push((self.cell, projection));
        }
        effects
            .formula_texts
            .insert(self.cell, self.formula.clone());
        effects
            .cells
            .insert(self.cell, (self.sheet, self.pos.row(), self.pos.col()));
        effects.sheets.insert(self.sheet);
        effects.recalc = true;
        // Later UI formatting is outside history. Its surviving native metadata
        // still owns the identity even when undo removes the original cell value.
        let retained_metadata =
            stores
                .storage
                .sheet_metadata
                .get(&self.sheet)
                .is_some_and(|sheet| {
                    sheet.cell_properties.contains_key(&self.cell)
                        || sheet.cell_annotations.contains_key(&self.cell)
                });
        let target_pos = self
            .mirror_pos
            .or_else(|| retained_metadata.then_some(self.pos));
        mirror.history_restore_cell(self.sheet, self.cell, target_pos, self.entry.take());
        if let Some(grid) = stores.grid_indexes.get_mut(&self.sheet) {
            grid.remove_cell(&self.cell);
            if let Some((row, col)) = self
                .grid_pos
                .or_else(|| retained_metadata.then_some((self.pos.row(), self.pos.col())))
            {
                grid.register_cell(self.cell, row, col);
            }
        }
        if let Some(sheet) = mirror.get_sheet_mut(&self.sheet) {
            for (range, index, value) in &self.slots {
                if let Some(range) = sheet.range_views.get_mut(range)
                    && let Some(slot) = Arc::make_mut(&mut range.values).get_mut(*index)
                {
                    *slot = value.clone();
                }
            }
        }
        mirror.history_invalidate_column(self.sheet, self.pos.col());
        mirror.cse_anchors.remove(&self.cell);
        mirror.cse_single_cell.remove(&self.cell);
        mirror.projection_registry.remove(&self.cell);
        if let Some((rows, cols)) = self.cse {
            mirror.cse_anchors.insert(self.cell);
            if rows == 1 && cols == 1 {
                mirror.cse_single_cell.insert(self.cell);
            }
            mirror.projection_registry.register(
                self.cell,
                self.sheet,
                self.pos.row(),
                self.pos.col(),
                rows,
                cols,
            );
        }
        *self = current;
    }
}
