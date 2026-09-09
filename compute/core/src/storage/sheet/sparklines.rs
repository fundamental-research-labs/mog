//! Typed native sparkline storage and its derived position index.

use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use std::collections::BTreeMap;

pub use crate::engine_types::sparklines::*;
pub use domain_types::domain::sparkline::*;
/// Position-only cell range used by sparkline clearing.
pub type CellRange = crate::PositionRange;

#[derive(Debug, Clone, Default)]
pub(crate) struct SparklineState {
    pub(crate) items: BTreeMap<String, Sparkline>,
    pub(crate) groups: BTreeMap<String, SparklineGroup>,
    positions: rustc_hash::FxHashMap<(u32, u32), String>,
}

impl SparklineState {
    pub(crate) fn rebuild_positions(&mut self) {
        self.positions = self
            .items
            .values()
            .map(|item| ((item.cell.row, item.cell.col), item.id.clone()))
            .collect();
    }

    pub(crate) fn from_import(
        sheet: SheetId,
        items: &[Sparkline],
        groups: &[SparklineGroup],
    ) -> Self {
        let mut state = Self::default();
        for item in items {
            let mut item = item.clone();
            item.sheet_id = sheet.to_uuid_string();
            item.cell.sheet_id = item.sheet_id.clone();
            state.insert(item);
        }
        for group in groups {
            let mut group = group.clone();
            group.sheet_id = sheet.to_uuid_string();
            state.insert_group(group);
        }
        state
    }

    pub(crate) fn remap_for_copy(&mut self, sheet: SheetId, allocator: &cell_types::IdAllocator) {
        let item_ids: BTreeMap<_, _> = self
            .items
            .keys()
            .map(|id| {
                (
                    id.clone(),
                    format!("sparkline-{:032x}", allocator.next_u128()),
                )
            })
            .collect();
        let group_ids: BTreeMap<_, _> = self
            .groups
            .keys()
            .map(|id| {
                (
                    id.clone(),
                    format!("sparkline-group-{:032x}", allocator.next_u128()),
                )
            })
            .collect();
        let items = std::mem::take(&mut self.items);
        self.positions.clear();
        for (_, mut item) in items {
            item.id = item_ids[&item.id].clone();
            item.sheet_id = sheet.to_uuid_string();
            item.cell.sheet_id = item.sheet_id.clone();
            item.group_id = item.group_id.and_then(|id| group_ids.get(&id).cloned());
            self.insert(item);
        }
        for (_, mut group) in std::mem::take(&mut self.groups) {
            group.id = group_ids[&group.id].clone();
            group.sheet_id = sheet.to_uuid_string();
            group.sparkline_ids = group
                .sparkline_ids
                .iter()
                .filter_map(|id| item_ids.get(id).cloned())
                .collect();
            self.insert_group(group);
        }
    }

    fn insert(&mut self, item: Sparkline) {
        if let Some(old) = self.items.remove(&item.id) {
            self.positions.remove(&(old.cell.row, old.cell.col));
        }
        self.positions
            .insert((item.cell.row, item.cell.col), item.id.clone());
        self.items.insert(item.id.clone(), item);
    }

    fn insert_group(&mut self, group: SparklineGroup) {
        for id in &group.sparkline_ids {
            if let Some(item) = self.items.get_mut(id) {
                item.group_id = Some(group.id.clone());
            }
        }
        self.groups.insert(group.id.clone(), group);
    }

    fn remove(&mut self, id: &str) -> bool {
        let Some(item) = self.items.remove(id) else {
            return false;
        };
        if self
            .positions
            .get(&(item.cell.row, item.cell.col))
            .is_some_and(|owner| owner == id)
        {
            self.positions.remove(&(item.cell.row, item.cell.col));
        }
        if let Some(group_id) = item.group_id {
            if let Some(group) = self.groups.get_mut(&group_id) {
                group.sparkline_ids.retain(|member| member != id);
                if group.sparkline_ids.is_empty() {
                    self.groups.remove(&group_id);
                }
            }
        }
        true
    }
}

fn state<'a>(storage: &'a WorkbookStorage, sheet: &SheetId) -> Option<&'a SparklineState> {
    Some(&storage.sheet_metadata.get(sheet)?.sparklines)
}
fn state_mut<'a>(
    storage: &'a mut WorkbookStorage,
    sheet: &SheetId,
) -> Option<&'a mut SparklineState> {
    Some(&mut storage.sheet_metadata.get_mut(sheet)?.sparklines)
}

pub fn add_sparkline(storage: &mut WorkbookStorage, sheet: &SheetId, item: &Sparkline) {
    crate::storage::engine::history::metadata::capture_sparkline(storage, *sheet, &item.id);

    if let Some(state) = state_mut(storage, sheet) {
        state.insert(item.clone());
    }
}
pub fn get_sparkline(storage: &WorkbookStorage, sheet: &SheetId, id: &str) -> Option<Sparkline> {
    state(storage, sheet)?.items.get(id).cloned()
}
pub fn get_sparkline_at_cell(
    storage: &WorkbookStorage,
    sheet: &SheetId,
    row: u32,
    col: u32,
) -> Option<Sparkline> {
    let state = state(storage, sheet)?;
    state.items.get(state.positions.get(&(row, col))?).cloned()
}
pub fn get_sparklines_in_sheet(storage: &WorkbookStorage, sheet: &SheetId) -> Vec<Sparkline> {
    state(storage, sheet)
        .map(|state| state.items.values().cloned().collect())
        .unwrap_or_default()
}
pub fn has_sparkline(storage: &WorkbookStorage, sheet: &SheetId, row: u32, col: u32) -> bool {
    state(storage, sheet).is_some_and(|state| state.positions.contains_key(&(row, col)))
}
pub fn update_sparkline(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    updates: &SparklineUpdate,
) -> bool {
    crate::storage::engine::history::metadata::capture_sparkline(storage, *sheet, id);

    let Some(state) = state_mut(storage, sheet) else {
        return false;
    };
    let Some(mut item) = state.items.get(id).cloned() else {
        return false;
    };
    item.apply_update(updates);
    state.insert(item);
    true
}
pub fn delete_sparkline(storage: &mut WorkbookStorage, sheet: &SheetId, id: &str) -> bool {
    crate::storage::engine::history::metadata::capture_sparkline(storage, *sheet, id);
    if let Some(group) = state(storage, sheet)
        .and_then(|state| state.items.get(id))
        .and_then(|item| item.group_id.as_ref())
    {
        crate::storage::engine::history::metadata::capture_sheet_entry!(
            storage,
            *sheet,
            sparklines.groups,
            group
        );
    }

    state_mut(storage, sheet).is_some_and(|state| state.remove(id))
}
pub fn add_sparkline_group(storage: &mut WorkbookStorage, sheet: &SheetId, group: &SparklineGroup) {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        sparklines.groups,
        group.id
    );
    for id in &group.sparkline_ids {
        crate::storage::engine::history::metadata::capture_sparkline(storage, *sheet, id);
    }

    if let Some(state) = state_mut(storage, sheet) {
        state.insert_group(group.clone());
    }
}
pub fn get_sparkline_group(
    storage: &WorkbookStorage,
    sheet: &SheetId,
    id: &str,
) -> Option<SparklineGroup> {
    state(storage, sheet)?.groups.get(id).cloned()
}
pub fn get_sparkline_groups_in_sheet(
    storage: &WorkbookStorage,
    sheet: &SheetId,
) -> Vec<SparklineGroup> {
    state(storage, sheet)
        .map(|state| state.groups.values().cloned().collect())
        .unwrap_or_default()
}
pub fn delete_sparkline_group(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    id: &str,
    delete_items: bool,
) -> bool {
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet,
        sparklines.groups,
        id
    );
    if let Some(group) = state(storage, sheet).and_then(|state| state.groups.get(id)) {
        for id in &group.sparkline_ids {
            crate::storage::engine::history::metadata::capture_sparkline(storage, *sheet, id);
        }
    }

    let Some(state) = state_mut(storage, sheet) else {
        return false;
    };
    let Some(group) = state.groups.remove(id) else {
        return false;
    };
    for id in group.sparkline_ids {
        if delete_items {
            state.remove(&id);
        } else if let Some(item) = state.items.get_mut(&id) {
            item.group_id = None;
        }
    }
    true
}
pub fn clear_sparklines_in_range(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    range: &CellRange,
) {
    let Some(state) = state(storage, sheet) else {
        return;
    };
    let ids: Vec<_> = state
        .items
        .values()
        .filter(|item| {
            item.cell.row >= range.start_row()
                && item.cell.row <= range.end_row()
                && item.cell.col >= range.start_col()
                && item.cell.col <= range.end_col()
        })
        .map(|item| item.id.clone())
        .collect();
    for id in ids {
        delete_sparkline(storage, sheet, &id);
    }
}
pub fn clear_sparklines_for_sheet(storage: &mut WorkbookStorage, sheet: &SheetId) {
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(sheet) {
            for (id, _value) in &meta.sparklines.groups {
                if true {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        *sheet,
                        sparklines.groups,
                        id
                    );
                }
            }
        }
    }
    if storage.history.is_active() {
        if let Some(state) = state(storage, sheet) {
            for id in state.items.keys() {
                crate::storage::engine::history::metadata::capture_sparkline(storage, *sheet, id);
            }
        }
    }

    if let Some(state) = state_mut(storage, sheet) {
        *state = SparklineState::default();
    }
}

#[cfg(test)]
mod tests;
