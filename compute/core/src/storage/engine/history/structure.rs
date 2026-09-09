//! Structural inverses retain changed topology and only values removed by an edit.
//! A partial compact-range deletion never retains its entire value allocation.

use std::sync::Arc;

use cell_types::{CellId, ColId, PayloadEncoding, RangeAnchor, RangeId, RowId, SheetId, SheetPos};
use compute_document::identity::{AxisIndex, GridIndex};
use formula_types::StructureChange;
use rustc_hash::{FxHashMap, FxHashSet};
use value_types::CellValue;

use crate::cells::{CellEntry, CellStore, SheetStore, range_view::RangeView};
use crate::storage::{CellMetadataMap, sheet::SheetMetadata};

use super::super::stores::EngineStores;
use super::{HistoryEffects, HistoryKey, HistoryPatch};

#[derive(Debug)]
pub(crate) struct SheetExtentPatch {
    sheet_id: SheetId,
    rows: Arc<AxisIndex<RowId>>,
    cols: Arc<AxisIndex<ColId>>,
    extents: [u32; 6],
}

impl SheetExtentPatch {
    pub(super) fn capture(cell_store: &CellStore, sheet_id: SheetId) -> Self {
        let sheet = cell_store
            .get_sheet(&sheet_id)
            .expect("history sheet exists");
        Self {
            sheet_id,
            rows: sheet.row_axis.clone(),
            cols: sheet.col_axis.clone(),
            extents: extents(sheet),
        }
    }

    pub(crate) fn is_changed(&self, _: &EngineStores, cell_store: &CellStore) -> bool {
        cell_store.get_sheet(&self.sheet_id).is_none_or(|sheet| {
            self.extents != extents(sheet)
                || self.rows.store() != sheet.row_axis.store()
                || self.cols.store() != sheet.col_axis.store()
        })
    }

    fn swap_axes(&mut self, sheet: &mut SheetStore) {
        std::mem::swap(&mut self.rows, &mut sheet.row_axis);
        std::mem::swap(&mut self.cols, &mut sheet.col_axis);
        let previous = std::mem::replace(&mut self.extents, extents(sheet));
        [
            sheet.rows,
            sheet.cols,
            sheet.grid_rows,
            sheet.grid_cols,
            sheet.identity_rows,
            sheet.identity_cols,
        ] = previous;
    }

    pub(crate) fn swap(
        &mut self,
        stores: &mut EngineStores,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    ) {
        let needed = required_metadata_extent(
            stores,
            cell_store,
            self.sheet_id,
            self.rows.len(),
            self.cols.len(),
        );
        let Some(sheet) = cell_store.get_sheet_mut(&self.sheet_id) else {
            return;
        };
        self.swap_axes(sheet);
        // Untracked UI metadata may own a tail identity created after the
        // authored action. Keep that exact native tail rather than mint IDs or
        // truncate the metadata's existing anchors when undo removes a value.
        if needed.0 > sheet.row_axis.len() {
            sheet.row_axis = retained_axis_tail(&self.rows, needed.0);
            sheet.identity_rows = sheet.identity_rows.max(needed.0);
            sheet.grid_rows = sheet.grid_rows.max(needed.0);
        }
        if needed.1 > sheet.col_axis.len() {
            sheet.col_axis = retained_axis_tail(&self.cols, needed.1);
            sheet.identity_cols = sheet.identity_cols.max(needed.1);
            sheet.grid_cols = sheet.grid_cols.max(needed.1);
        }
        if let Some(grid) = stores.grid_indexes.get_mut(&self.sheet_id) {
            grid.restore_shared_axes(sheet.row_axis.clone(), sheet.col_axis.clone());
        }
        cell_store.history_refresh_axis_ownership(self.sheet_id);
        effects.sheets.insert(self.sheet_id);
    }
}

fn retained_axis_tail<Id: cell_types::AxisIdentityId + std::hash::Hash>(
    current: &Arc<AxisIndex<Id>>,
    needed: u32,
) -> Arc<AxisIndex<Id>> {
    let mut axis = current.clone();
    if needed < axis.len() {
        let count = axis.len() - needed;
        Arc::make_mut(&mut axis).delete_range(needed, count);
    }
    axis
}

/// Examine sparse metadata, never the authored value store, when deciding
/// whether implicit growth can shrink. Ordinary value-only history stays O(1).
fn required_metadata_extent(
    stores: &EngineStores,
    cell_store: &CellStore,
    sid: SheetId,
    target_rows: u32,
    target_cols: u32,
) -> (u32, u32) {
    let Some(sheet) = cell_store.get_sheet(&sid) else {
        return (0, 0);
    };
    if target_rows >= sheet.row_axis.len() && target_cols >= sheet.col_axis.len() {
        return (0, 0);
    }
    let mut rows = 0;
    let mut cols = 0;
    let mut observe_cell = |id: &CellId| {
        if let Some(pos) = sheet.position_of(id) {
            rows = rows.max(pos.row().saturating_add(1));
            cols = cols.max(pos.col().saturating_add(1));
        }
    };
    if let Some(meta) = stores.storage.sheet_metadata.get(&sid) {
        for id in meta
            .cell_properties
            .keys()
            .chain(meta.cell_annotations.keys())
        {
            observe_cell(id);
        }
        for id in meta
            .comments
            .iter()
            .filter_map(|comment| comment.cell_ref.cell())
        {
            observe_cell(&id);
        }
        for link in &meta.hyperlinks {
            observe_cell(&link.start_id);
            if let Some(id) = link.end_id {
                observe_cell(&id);
            }
        }
        for merge in &meta.merges {
            observe_cell(&merge.top_left_id);
            observe_cell(&merge.bottom_right_id);
        }
    }
    for id in stores.storage.cell_metadata.keys() {
        observe_cell(id);
    }
    for id in stores.storage.history.retained_identities(sid) {
        observe_cell(&id);
    }
    if let Some(meta) = stores.storage.sheet_metadata.get(&sid) {
        for id in meta
            .dimensions
            .rows
            .keys()
            .chain(meta.dimensions.manual_hidden_rows.iter())
            .chain(
                meta.dimensions
                    .filter_hidden_rows
                    .values()
                    .flat_map(|ids| ids.iter()),
            )
        {
            if let Some(row) = sheet.row_axis.position_of(sid, *id) {
                rows = rows.max(row.saturating_add(1));
            }
        }
        for id in meta
            .dimensions
            .columns
            .keys()
            .chain(meta.dimensions.hidden_columns.iter())
            .chain(meta.column_schemas.keys())
        {
            if let Some(col) = sheet.col_axis.position_of(sid, *id) {
                cols = cols.max(col.saturating_add(1));
            }
        }
    }
    for range in &sheet.format_ranges {
        rows = rows.max(range.end_row.saturating_add(1).min(sheet.row_axis.len()));
        cols = cols.max(range.end_col.saturating_add(1).min(sheet.col_axis.len()));
    }
    for range in &sheet.col_format_ranges {
        cols = cols.max(range.end_col.saturating_add(1).min(sheet.col_axis.len()));
    }
    (rows, cols)
}

fn extents(sheet: &SheetStore) -> [u32; 6] {
    [
        sheet.rows,
        sheet.cols,
        sheet.grid_rows,
        sheet.grid_cols,
        sheet.identity_rows,
        sheet.identity_cols,
    ]
}

pub(crate) fn capture_sheet_extent(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: SheetId,
) {
    let capture = &stores.storage.history;
    if !capture.is_active()
        || capture.owns_sheet(sheet_id)
        || cell_store.get_sheet(&sheet_id).is_none()
    {
        return;
    }
    capture.record_once(HistoryKey::SheetExtent(sheet_id), || {
        HistoryPatch::SheetExtent(SheetExtentPatch::capture(cell_store, sheet_id))
    });
}

#[derive(Debug)]
struct RemovedCell {
    id: CellId,
    pos: SheetPos,
    entry: Option<CellEntry>,
    identity_formula: Option<formula_types::IdentityFormula>,
    cse: bool,
    cse_single: bool,
    formula_text: Option<String>,
}

#[derive(Debug)]
enum RangePatch {
    Anchor {
        id: RangeId,
        previous: RangeAnchor,
    },
    Whole {
        id: RangeId,
        previous: Option<RangeView>,
    },
    Slots {
        id: RangeId,
        anchor: RangeAnchor,
        encoding: PayloadEncoding,
        rows: Vec<(RowId, Option<u32>)>,
        cols: Vec<(ColId, Option<u32>)>,
        values: Vec<(usize, CellValue)>,
    },
}

impl RangePatch {
    fn capture(
        range: &RangeView,
        deleted_rows: &FxHashSet<RowId>,
        deleted_cols: &FxHashSet<ColId>,
    ) -> Option<Self> {
        let rows: Vec<_> = deleted_rows
            .iter()
            .filter_map(|id| {
                range
                    .row_offset_by_id
                    .get(id)
                    .map(|offset| (*id, Some(offset)))
            })
            .collect();
        let cols: Vec<_> = deleted_cols
            .iter()
            .filter_map(|id| {
                range
                    .col_offset_by_id
                    .get(id)
                    .map(|offset| (*id, Some(offset)))
            })
            .collect();
        if rows.is_empty() && cols.is_empty() {
            return None;
        }
        if rows.len() == range.row_offset_by_id.len() || cols.len() == range.col_offset_by_id.len()
        {
            return Some(Self::Whole {
                id: range.range_id,
                previous: Some(range.clone()),
            });
        }
        let mut slots = FxHashSet::default();
        let width = range.payload_cols as usize;
        for &(_, offset) in &rows {
            let start = offset.unwrap() as usize * width;
            slots.extend(start..(start + width).min(range.values.len()));
        }
        if width != 0 {
            for &(_, offset) in &cols {
                slots.extend((offset.unwrap() as usize..range.values.len()).step_by(width));
            }
        }
        let values = slots
            .into_iter()
            .filter_map(|slot| range.values.get(slot).map(|value| (slot, value.clone())))
            .collect();
        Some(Self::Slots {
            id: range.range_id,
            anchor: range.anchor.clone(),
            encoding: range.encoding,
            rows,
            cols,
            values,
        })
    }

    fn swap(&mut self, sheet: &mut SheetStore) {
        match self {
            Self::Anchor { id, previous } => {
                if let Some(range) = sheet.range_views.get_mut(id) {
                    std::mem::swap(previous, &mut range.anchor);
                }
            }
            Self::Whole { id, previous } => {
                let current = sheet.range_views.remove(id);
                if let Some(range) = previous.take() {
                    sheet.range_views.insert(*id, range);
                }
                *previous = current;
            }
            Self::Slots {
                id,
                anchor,
                encoding,
                rows,
                cols,
                values,
            } => {
                let range = sheet
                    .range_views
                    .get_mut(id)
                    .expect("partial history range exists");
                std::mem::swap(anchor, &mut range.anchor);
                std::mem::swap(encoding, &mut range.encoding);
                for (id, previous) in rows {
                    let current = range.row_offset_by_id.remove(id);
                    if let Some(offset) = previous.take() {
                        range.row_offset_by_id.insert(*id, offset);
                    }
                    *previous = current;
                }
                for (id, previous) in cols {
                    let current = range.col_offset_by_id.remove(id);
                    if let Some(offset) = previous.take() {
                        range.col_offset_by_id.insert(*id, offset);
                    }
                    *previous = current;
                }
                if !values.is_empty() {
                    let payload = Arc::make_mut(&mut range.values);
                    for (slot, value) in values {
                        std::mem::swap(value, &mut payload[*slot]);
                    }
                }
            }
        }
    }
}

#[derive(Debug)]
struct PositionPatch {
    id: CellId,
    axes: Option<(RowId, ColId)>,
}

#[derive(Debug)]
pub(crate) struct StructurePatch {
    extent: SheetExtentPatch,
    removed: Vec<RemovedCell>,
    ranges: Vec<RangePatch>,
    positions: Vec<PositionPatch>,
    event: Option<crate::snapshot::StructureChangeResult>,
}

impl StructurePatch {
    fn capture(
        stores: &EngineStores,
        cell_store: &CellStore,
        sheet_id: SheetId,
        deletion: Option<(u32, u32, bool)>,
        positions: impl IntoIterator<Item = CellId>,
    ) -> Self {
        let sheet = cell_store
            .get_sheet(&sheet_id)
            .expect("structural history sheet exists");
        let in_band = |pos: SheetPos| {
            deletion.is_some_and(|(at, count, rows)| {
                let offset = if rows { pos.row() } else { pos.col() };
                offset >= at && offset < at.saturating_add(count)
            })
        };
        let removed = capture_removed(stores, cell_store, sheet_id, in_band);
        let mut deleted_rows = FxHashSet::default();
        let mut deleted_cols = FxHashSet::default();
        if let Some((at, count, rows)) = deletion {
            if rows {
                deleted_rows.extend(sheet.row_axis.identities_in(sheet_id, at, count));
            } else {
                deleted_cols.extend(sheet.col_axis.identities_in(sheet_id, at, count));
            }
        }
        let ranges = sheet
            .range_views
            .values()
            .filter_map(|range| RangePatch::capture(range, &deleted_rows, &deleted_cols))
            .collect();
        let positions = positions
            .into_iter()
            .map(|id| PositionPatch {
                id,
                axes: sheet.axes_by_cell.get(&id).copied(),
            })
            .collect();
        Self {
            extent: SheetExtentPatch::capture(cell_store, sheet_id),
            removed,
            ranges,
            positions,
            event: None,
        }
    }

    pub(crate) fn is_changed(&self, stores: &EngineStores, cell_store: &CellStore) -> bool {
        self.extent.is_changed(stores, cell_store)
            || self.positions.iter().any(|position| {
                cell_store
                    .get_sheet(&self.extent.sheet_id)
                    .and_then(|sheet| sheet.axes_by_cell.get(&position.id))
                    .copied()
                    != position.axes
            })
    }

    pub(crate) fn swap(
        &mut self,
        stores: &mut EngineStores,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    ) {
        let sid = self.extent.sheet_id;
        let Some(sheet) = cell_store.get_sheet(&sid) else {
            return;
        };
        let current_rows = sheet.row_axis.clone();
        let current_cols = sheet.col_axis.clone();
        let remap = |pos: SheetPos| -> Option<SheetPos> {
            let row = current_rows.identity_at(sid, pos.row())?;
            let col = current_cols.identity_at(sid, pos.col())?;
            Some(SheetPos::new(
                self.extent.rows.position_of(sid, row)?,
                self.extent.cols.position_of(sid, col)?,
            ))
        };
        let mut current_removed =
            capture_removed(stores, cell_store, sid, |pos| remap(pos).is_none());
        for cell in &mut current_removed {
            if let Some(text) = effects.formula_texts.get(&cell.id) {
                cell.formula_text = text.clone();
            }
        }
        {
            let sheet = cell_store.get_sheet_mut(&sid).unwrap();
            for cell in &current_removed {
                sheet.remove_cell_identity(&cell.id);
                sheet.cells.remove(&cell.id);
                sheet.formulas.remove(&cell.id);
            }
            let current_positions: Vec<_> = self
                .positions
                .iter()
                .map(|patch| sheet.axes_by_cell.get(&patch.id).copied())
                .collect();
            for patch in &self.positions {
                sheet.remove_cell_identity(&patch.id);
            }
            self.extent.swap_axes(sheet);
            for (patch, current) in self.positions.iter_mut().zip(current_positions) {
                if let Some((row, col)) = std::mem::replace(&mut patch.axes, current)
                    && let (Some(row), Some(col)) =
                        (sheet.row_index_of(&row), sheet.col_index_of(&col))
                {
                    sheet.register_cell(patch.id, row, col);
                    effects.cells.insert(patch.id, (sid, row, col));
                }
            }
            for cell in &self.removed {
                if let Some(entry) = &cell.entry {
                    sheet.cells.insert(cell.id, entry.clone());
                }
                if let Some(formula) = &cell.identity_formula {
                    sheet.formulas.insert(cell.id, formula.clone());
                }
                sheet.register_cell(cell.id, cell.pos.row(), cell.pos.col());
            }
            for range in &mut self.ranges {
                range.swap(sheet);
            }
        }
        for cell in &current_removed {
            cell_store.cse_anchors.remove(&cell.id);
            cell_store.cse_single_cell.remove(&cell.id);
            effects.formula_texts.insert(cell.id, None);
        }
        for cell in &self.removed {
            effects
                .cells
                .insert(cell.id, (sid, cell.pos.row(), cell.pos.col()));
            if cell.cse {
                cell_store.cse_anchors.insert(cell.id);
            }
            if cell.cse_single {
                cell_store.cse_single_cell.insert(cell.id);
            }
            effects
                .formula_texts
                .insert(cell.id, cell.formula_text.clone());
        }
        self.removed = current_removed;
        rebuild_grid(stores, cell_store, sid);
        cell_store.history_rebuild_sheet(sid);
        effects.sheets.insert(sid);
        effects.recalc = true;
        effects.topology = true;
        if let Some(event) = &mut self.event {
            use crate::snapshot::StructureChangeType::*;
            event.change_type = match event.change_type {
                InsertRows => DeleteRows,
                DeleteRows => InsertRows,
                InsertCols => DeleteCols,
                DeleteCols => InsertCols,
            };
            effects.result.structure_changes.push(event.clone());
        }
    }
}

fn capture_removed(
    stores: &EngineStores,
    cell_store: &CellStore,
    sid: SheetId,
    predicate: impl Fn(SheetPos) -> bool,
) -> Vec<RemovedCell> {
    let sheet = cell_store.get_sheet(&sid).expect("history sheet exists");
    let ids = sheet.cells().filter_map(|(id, row, col)| {
        let pos = SheetPos::new(row, col);
        predicate(pos).then_some((id, pos))
    });
    ids.into_iter()
        .map(|(id, pos)| RemovedCell {
            id,
            pos,
            entry: sheet.cells.get(&id).cloned(),
            identity_formula: sheet.formula(&id).cloned(),
            cse: cell_store.cse_anchors.contains(&id),
            cse_single: cell_store.cse_single_cell.contains(&id),
            formula_text: stores.compute.get_formula(&id).map(str::to_owned),
        })
        .collect()
}

fn rebuild_grid(stores: &mut EngineStores, cell_store: &CellStore, sid: SheetId) {
    let Some(sheet) = cell_store.get_sheet(&sid) else {
        stores.grid_indexes.remove(&sid);
        return;
    };
    stores.grid_indexes.insert(
        sid,
        GridIndex::from_shared_axes(
            sid,
            sheet.row_axis.clone(),
            sheet.col_axis.clone(),
            stores.grid_id_alloc.clone(),
        ),
    );
}

pub(crate) fn capture_structure(
    stores: &EngineStores,
    cell_store: &CellStore,
    sid: SheetId,
    change: &StructureChange,
) {
    let capture = &stores.storage.history;
    if !capture.is_active() || capture.owns_sheet(sid) || cell_store.get_sheet(&sid).is_none() {
        return;
    }
    let deletion = match change {
        StructureChange::DeleteRows { at, count, .. } => Some((*at, *count, true)),
        StructureChange::DeleteCols { at, count, .. } => Some((*at, *count, false)),
        _ => None,
    };
    let positions: Vec<_> = match change {
        StructureChange::RemapPositions { updates } => {
            updates.iter().map(|(id, _, _)| *id).collect()
        }
        _ => Vec::new(),
    };
    capture.record(|| {
        let mut patch = StructurePatch::capture(stores, cell_store, sid, deletion, positions);
        patch.event =
            super::super::services::structural::build_structure_change_result(&sid, change);
        HistoryPatch::Structure(patch)
    });
}

pub(crate) fn capture_sort(
    stores: &EngineStores,
    cell_store: &CellStore,
    sid: SheetId,
    permutation: &[(u32, u32)],
    reorders_axes: bool,
) {
    let capture = &stores.storage.history;
    if !capture.is_active() || capture.owns_sheet(sid) {
        return;
    }
    let rows: FxHashSet<_> = permutation.iter().map(|(row, _)| *row).collect();
    let positions: FxHashSet<_> = if reorders_axes {
        FxHashSet::default()
    } else {
        cell_store
            .cells(&sid)
            .filter(|(_, row, _)| rows.contains(row))
            .map(|(id, _, _)| id)
            .collect()
    };
    capture.record(|| {
        let mut patch = StructurePatch::capture(stores, cell_store, sid, None, positions);
        if reorders_axes {
            patch.ranges.extend(
                cell_store
                    .get_sheet(&sid)
                    .into_iter()
                    .flat_map(|sheet| sheet.range_views.values())
                    .filter(|range| matches!(range.anchor, RangeAnchor::Elastic { .. }))
                    .map(|range| RangePatch::Anchor {
                        id: range.range_id,
                        previous: range.anchor.clone(),
                    }),
            );
        }
        HistoryPatch::Structure(patch)
    });
}

#[derive(Debug)]
pub(crate) struct SheetPatch {
    sheet_id: SheetId,
    sheet: Option<SheetStore>,
    metadata: Option<SheetMetadata>,
    cell_metadata: CellMetadataMap,
    cse: FxHashSet<CellId>,
    cse_single: FxHashSet<CellId>,
    formula_texts: FxHashMap<CellId, Option<String>>,
}

impl SheetPatch {
    fn capture(
        stores: &EngineStores,
        cell_store: &CellStore,
        sid: SheetId,
        absent: bool,
        clone_sheet: bool,
    ) -> Self {
        if absent {
            return Self {
                sheet_id: sid,
                sheet: None,
                metadata: None,
                cell_metadata: Default::default(),
                cse: Default::default(),
                cse_single: Default::default(),
                formula_texts: Default::default(),
            };
        }
        let belongs = |id: &CellId| cell_store.sheet_for_cell(id) == Some(sid);
        Self {
            sheet_id: sid,
            sheet: if clone_sheet {
                cell_store.get_sheet(&sid).cloned()
            } else {
                None
            },
            metadata: stores.storage.sheet_metadata.get(&sid).cloned(),
            cell_metadata: stores
                .storage
                .cell_metadata
                .iter()
                .filter(|(id, _)| belongs(id))
                .map(|(id, metadata)| (*id, metadata.clone()))
                .collect(),
            cse: cell_store
                .cse_anchors
                .iter()
                .filter(|id| belongs(id))
                .copied()
                .collect(),
            cse_single: cell_store
                .cse_single_cell
                .iter()
                .filter(|id| belongs(id))
                .copied()
                .collect(),
            formula_texts: cell_store
                .get_sheet(&sid)
                .into_iter()
                .flat_map(|sheet| sheet.cells.keys())
                .map(|id| (*id, stores.compute.get_formula(id).map(str::to_owned)))
                .collect(),
        }
    }

    pub(crate) fn is_changed(&self, _: &EngineStores, cell_store: &CellStore) -> bool {
        self.sheet.is_some() != cell_store.get_sheet(&self.sheet_id).is_some()
    }

    pub(crate) fn swap(
        &mut self,
        stores: &mut EngineStores,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    ) {
        let sid = self.sheet_id;
        effects
            .lifecycle
            .entry(sid)
            .or_insert_with(|| cell_store.get_sheet(&sid).map(|sheet| sheet.name.clone()));
        let current = Self::capture(stores, cell_store, sid, false, false);
        // Move the live sheet into history instead of retaining two value owners.
        let mut previous = self.sheet.take();
        cell_store.history_swap_sheet(sid, &mut previous);
        let mut current = current;
        for (cell, text) in &mut current.formula_texts {
            if let Some(source) = effects.formula_texts.get(cell) {
                *text = source.clone();
            }
        }
        current.sheet = previous;
        stores.storage.sheet_metadata.remove(&sid);
        if let Some(metadata) = self.metadata.take() {
            stores.storage.sheet_metadata.insert(sid, metadata);
        }
        for id in current.cell_metadata.keys() {
            stores.storage.cell_metadata.remove(id);
        }
        stores
            .storage
            .cell_metadata
            .extend(std::mem::take(&mut self.cell_metadata));
        for id in &current.cse {
            cell_store.cse_anchors.remove(id);
        }
        for id in &current.cse_single {
            cell_store.cse_single_cell.remove(id);
        }
        cell_store.cse_anchors.extend(self.cse.iter().copied());
        cell_store
            .cse_single_cell
            .extend(self.cse_single.iter().copied());
        effects
            .formula_texts
            .extend(current.formula_texts.keys().map(|id| (*id, None)));
        effects.formula_texts.extend(
            self.formula_texts
                .iter()
                .map(|(id, text)| (*id, text.clone())),
        );
        rebuild_grid(stores, cell_store, sid);
        effects.sheets.insert(sid);
        effects.recalc = true;
        effects.topology = true;
        *self = current;
    }
}

pub(crate) fn capture_sheet(
    stores: &EngineStores,
    cell_store: &CellStore,
    sid: SheetId,
    absent: bool,
) {
    let capture = &stores.storage.history;
    if !capture.is_active() || capture.owns_sheet(sid) {
        return;
    }
    capture
        .record(|| HistoryPatch::Sheet(SheetPatch::capture(stores, cell_store, sid, absent, true)));
    capture.mark_sheet_owned(sid);
}

/// Record absence before any child values or metadata for a new sheet are installed.
pub(crate) fn capture_new_sheet(storage: &crate::storage::WorkbookStorage, sid: SheetId) {
    let capture = &storage.history;
    if !capture.is_active() || capture.owns_sheet(sid) {
        return;
    }
    capture.record(|| {
        HistoryPatch::Sheet(SheetPatch {
            sheet_id: sid,
            sheet: None,
            metadata: None,
            cell_metadata: Default::default(),
            cse: Default::default(),
            cse_single: Default::default(),
            formula_texts: Default::default(),
        })
    });
    capture.mark_sheet_owned(sid);
}

/// Lifecycle notifications are built from the final restored state, after every
/// patch in a grouped action has run and layout/merge indexes have been rebuilt.
pub(crate) fn emit_lifecycle(
    stores: &EngineStores,
    cell_store: &CellStore,
    effects: &mut HistoryEffects,
) {
    use crate::snapshot::{ChangeKind, SheetChange, SheetChangeField, SheetLifecycleRuntimeHint};
    let mut changes: Vec<_> = std::mem::take(&mut effects.lifecycle).into_iter().collect();
    changes.sort_unstable_by_key(|(sid, _)| sid.as_u128());
    for (sid, previous_name) in changes {
        match (previous_name, cell_store.get_sheet(&sid)) {
            (None, Some(_)) => {
                super::super::services::mutation_handlers::build_sheet_hydration_changes(
                    stores,
                    cell_store,
                    &sid,
                    None,
                    &mut effects.result,
                );
                effects.result.sheet_lifecycle_runtime_hint =
                    Some(SheetLifecycleRuntimeHint::focus(sid));
            }
            (Some(name), None) => {
                effects.result.sheet_changes.push(SheetChange {
                    sheet_id: sid.to_uuid_string(),
                    kind: ChangeKind::Removed,
                    field: SheetChangeField::Sheet,
                    name: Some(name),
                    old_name: None,
                    index: None,
                    old_index: None,
                    hidden: None,
                    source_sheet_id: None,
                    frozen_rows: None,
                    old_frozen_rows: None,
                    frozen_cols: None,
                    old_frozen_cols: None,
                    color: None,
                    old_color: None,
                });
                effects.result.sheet_lifecycle_runtime_hint =
                    Some(SheetLifecycleRuntimeHint::reconcile());
            }
            _ => {}
        }
    }
}
