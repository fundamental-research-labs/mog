//! Typed, entity-sized metadata inverses. No serialized document is retained.

use std::fmt::Debug;

use cell_types::{CellId, ColId, RowId, SheetId};

use crate::{
    cells::{CellStore, SheetStore},
    storage::WorkbookStorage,
};

use super::{HistoryEffects, HistoryKey, HistoryPatch};

mod catalogs;
mod cells;
mod dimensions;
mod events;
mod fields;
mod formats;
mod imports;

pub(crate) use catalogs::*;
pub(crate) use cells::*;
pub(crate) use dimensions::*;
pub(crate) use events::{MetadataEvents, emit_events};
pub(crate) use fields::*;
pub(crate) use formats::*;
pub(crate) use imports::*;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum MetadataKey {
    Catalog(CatalogKey),
    Cell(CellId),
    CellProperties(SheetId, CellId),
    CellAnnotation(SheetId, CellId),
    Row(SheetId, RowId),
    Column(SheetId, ColId),
    ColumnSchema(SheetId, ColId),
    HiddenRow(SheetId, RowId),
    HiddenColumn(SheetId, ColId),
    FilterHiddenRows(SheetId, String),
    SheetField(SheetId, &'static str),
    SheetEntry(SheetId, &'static str, String),
    WorkbookField(&'static str),
    WorkbookEntry(&'static str, String),
    FormatRange(SheetId, cell_types::RangeId, bool),
}

impl MetadataKey {
    fn sheet_id(&self) -> Option<SheetId> {
        match self {
            Self::CellProperties(s, _)
            | Self::CellAnnotation(s, _)
            | Self::Row(s, _)
            | Self::Column(s, _)
            | Self::ColumnSchema(s, _)
            | Self::HiddenRow(s, _)
            | Self::HiddenColumn(s, _)
            | Self::FilterHiddenRows(s, _)
            | Self::SheetField(s, _)
            | Self::SheetEntry(s, _, _)
            | Self::FormatRange(s, _, _) => Some(*s),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum MetadataImpact {
    Sheet(SheetId),
    SheetCalculation(SheetId),
    Workbook,
    Settings,
    Names,
}

impl MetadataImpact {
    fn mark(self, cell_store: &CellStore, effects: &mut HistoryEffects) {
        match self {
            Self::Sheet(sheet) => {
                effects.sheets.insert(sheet);
            }
            Self::SheetCalculation(sheet) => {
                effects.sheets.insert(sheet);
                effects.recalc = true;
            }
            Self::Workbook | Self::Settings | Self::Names => {
                effects.sheets.extend(cell_store.sheet_ids().copied());
                match self {
                    Self::Settings => {
                        effects.settings = true;
                        effects.recalc = true;
                    }
                    Self::Names => {
                        effects.named_ranges = true;
                        effects.recalc = true;
                    }
                    _ => {}
                }
            }
        }
    }
}

trait MetadataSwap: Debug + Send + Sync {
    fn is_changed(&self, storage: &WorkbookStorage, cell_store: &CellStore) -> bool;
    fn rebase_ui_format(
        &mut self,
        _storage: &WorkbookStorage,
        _store: &CellStore,
        _sheet: SheetId,
        _ranges: &[(u32, u32, u32, u32)],
        _format: &domain_types::CellFormat,
    ) {
    }
    fn swap(
        &mut self,
        storage: &mut WorkbookStorage,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    );
}

/// One old native value and statically typed accessors to its canonical slot.
/// Type erasure only keeps the action vector compact; values remain their Rust types.
#[derive(Debug)]
pub(crate) struct MetadataPatch(Box<dyn MetadataSwap>);

impl MetadataPatch {
    pub(crate) fn rebase_ui_format(
        &mut self,
        storage: &WorkbookStorage,
        cell_store: &CellStore,
        sheet: SheetId,
        ranges: &[(u32, u32, u32, u32)],
        format: &domain_types::CellFormat,
    ) {
        self.0
            .rebase_ui_format(storage, cell_store, sheet, ranges, format);
    }

    pub(crate) fn is_changed(&self, storage: &WorkbookStorage, cell_store: &CellStore) -> bool {
        self.0.is_changed(storage, cell_store)
    }

    pub(crate) fn swap(
        &mut self,
        storage: &mut WorkbookStorage,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    ) {
        self.0.swap(storage, cell_store, effects);
    }
}

type StorageRead<T> = for<'a> fn(&'a WorkbookStorage, &MetadataKey) -> Option<&'a T>;
type StorageSwap<T> = fn(&mut WorkbookStorage, &MetadataKey, &mut Option<T>);

#[derive(Debug)]
struct StoredValue<T> {
    key: MetadataKey,
    old: Option<T>,
    read: StorageRead<T>,
    swap_value: StorageSwap<T>,
    impact: MetadataImpact,
}

impl<T: Debug + PartialEq + Send + Sync + 'static> MetadataSwap for StoredValue<T> {
    fn is_changed(&self, storage: &WorkbookStorage, _: &CellStore) -> bool {
        (self.read)(storage, &self.key) != self.old.as_ref()
    }

    fn swap(
        &mut self,
        storage: &mut WorkbookStorage,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    ) {
        effects
            .metadata_events
            .record(&self.key, storage, cell_store);
        (self.swap_value)(storage, &self.key, &mut self.old);
        if let MetadataKey::SheetEntry(sheet, "sparklines.items" | "sparklines.groups", _) =
            &self.key
        {
            effects.sparkline_sheets.insert(*sheet);
        }
        self.impact.mark(cell_store, effects);
    }
}

pub(crate) fn capture_value<T: Debug + Clone + PartialEq + Send + Sync + 'static>(
    storage: &WorkbookStorage,
    key: MetadataKey,
    read: StorageRead<T>,
    swap_value: StorageSwap<T>,
    impact: MetadataImpact,
) {
    if !storage.history.is_active()
        || key
            .sheet_id()
            .is_some_and(|sheet| storage.history.owns_sheet(sheet))
    {
        return;
    }
    storage
        .history
        .record_once(HistoryKey::Metadata(key.clone()), || {
            HistoryPatch::Metadata(MetadataPatch(Box::new(StoredValue {
                old: read(storage, &key).cloned(),
                key,
                read,
                swap_value,
                impact,
            })))
        });
}

#[derive(Debug)]
struct VectorEntry<T> {
    key: MetadataKey,
    old: Option<(VectorPosition, T)>,
    read: for<'a> fn(&'a WorkbookStorage, &MetadataKey) -> Option<&'a Vec<T>>,
    write: for<'a> fn(&'a mut WorkbookStorage, &MetadataKey) -> Option<&'a mut Vec<T>>,
    matches: fn(&T, &MetadataKey) -> bool,
    identity: fn(&T) -> String,
    impact: MetadataImpact,
}
impl<T: Debug + PartialEq + Send + Sync + 'static> MetadataSwap for VectorEntry<T> {
    fn is_changed(&self, storage: &WorkbookStorage, _: &CellStore) -> bool {
        let current = (self.read)(storage, &self.key)
            .and_then(|values| values.iter().find(|value| (self.matches)(value, &self.key)));
        current != self.old.as_ref().map(|(_, value)| value)
    }
    fn swap(
        &mut self,
        storage: &mut WorkbookStorage,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    ) {
        effects
            .metadata_events
            .record(&self.key, storage, cell_store);
        if let Some(values) = (self.write)(storage, &self.key) {
            let current = values
                .iter()
                .position(|value| (self.matches)(value, &self.key))
                .map(|index| {
                    (
                        VectorPosition::capture(values, index, self.identity),
                        values.remove(index),
                    )
                });
            if let Some((position, value)) = self.old.take() {
                let index = position.resolve(values, self.identity);
                values.insert(index, value);
            }
            self.old = current;
        }
        self.impact.mark(cell_store, effects);
    }
}
pub(crate) fn capture_vector_entry<T: Debug + Clone + PartialEq + Send + Sync + 'static>(
    storage: &WorkbookStorage,
    key: MetadataKey,
    read: for<'a> fn(&'a WorkbookStorage, &MetadataKey) -> Option<&'a Vec<T>>,
    write: for<'a> fn(&'a mut WorkbookStorage, &MetadataKey) -> Option<&'a mut Vec<T>>,
    matches: fn(&T, &MetadataKey) -> bool,
    identity: fn(&T) -> String,
    impact: MetadataImpact,
) {
    if !storage.history.is_active()
        || key
            .sheet_id()
            .is_some_and(|sheet| storage.history.owns_sheet(sheet))
    {
        return;
    }
    storage
        .history
        .record_once(HistoryKey::Metadata(key.clone()), || {
            let old = read(storage, &key).and_then(|values| {
                values
                    .iter()
                    .enumerate()
                    .find(|(_, value)| matches(value, &key))
                    .map(|(index, value)| {
                        (
                            VectorPosition::capture(values, index, identity),
                            value.clone(),
                        )
                    })
            });
            HistoryPatch::Metadata(MetadataPatch(Box::new(VectorEntry {
                key,
                old,
                read,
                write,
                matches,
                identity,
                impact,
            })))
        });
}

#[derive(Debug)]
pub(crate) struct VectorPosition<K = String> {
    index: usize,
    previous: Option<K>,
    next: Option<K>,
}
impl<K> VectorPosition<K> {
    pub(crate) fn capture<T>(values: &[T], index: usize, identity: fn(&T) -> K) -> Self {
        Self {
            index,
            previous: index
                .checked_sub(1)
                .and_then(|i| values.get(i))
                .map(identity),
            next: values.get(index + 1).map(identity),
        }
    }
    pub(crate) fn resolve<T>(&self, values: &[T], identity: fn(&T) -> K) -> usize
    where
        K: PartialEq,
    {
        self.next
            .as_ref()
            .and_then(|id| values.iter().position(|value| identity(value) == *id))
            .or_else(|| {
                self.previous.as_ref().and_then(|id| {
                    values
                        .iter()
                        .position(|value| identity(value) == *id)
                        .map(|i| i + 1)
                })
            })
            .unwrap_or(self.index.min(values.len()))
    }
}

#[cfg(test)]
mod tests;
