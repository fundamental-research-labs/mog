//! Shared native axis order and its derived lookup index.

use cell_types::{AxisIdentityId, AxisIdentityStore, SheetId};
use rustc_hash::FxHashMap;
use std::ops::Deref;

/// Native axis order shared by the grid and formula lookup store.
/// Compact axes resolve identities directly; explicit axes use one reverse index.
#[derive(Debug, Clone)]
pub struct AxisIndex<Id> {
    store: AxisIdentityStore<Id>,
    positions: FxHashMap<Id, u32>,
}

impl<Id: AxisIdentityId + std::hash::Hash> AxisIndex<Id> {
    /// Build an index without expanding compact runs.
    pub fn new(store: AxisIdentityStore<Id>) -> Self {
        let positions = match &store {
            AxisIdentityStore::Explicit(ids) => ids
                .iter()
                .enumerate()
                .map(|(pos, id)| (*id, pos as u32))
                .collect(),
            AxisIdentityStore::Runs(_) => FxHashMap::default(),
        };
        Self { store, positions }
    }

    /// Borrow the serializable native axis order.
    pub fn store(&self) -> &AxisIdentityStore<Id> {
        &self.store
    }

    /// Resolve an identity in constant time for explicit axes, or by compact run.
    pub fn position_of(&self, sheet: SheetId, id: Id) -> Option<u32> {
        match &self.store {
            AxisIdentityStore::Explicit(_) => self.positions.get(&id).copied(),
            AxisIdentityStore::Runs(_) => self.store.position_of(sheet, id),
        }
    }

    /// Remove an interval and rebuild only the explicit reverse index.
    pub fn delete_range(&mut self, at: u32, count: u32) {
        self.store.delete_range(at, count);
        self.reindex();
    }

    /// Insert existing identities into their new physical positions.
    pub fn insert_explicit(&mut self, sheet: SheetId, at: u32, ids: impl IntoIterator<Item = Id>) {
        let at = at.min(self.store.len()) as usize;
        match &mut self.store {
            AxisIdentityStore::Explicit(existing) => {
                existing.splice(at..at, ids);
            }
            store => {
                let mut existing: Vec<Id> = store.identities_in(sheet, 0, store.len()).collect();
                existing.splice(at..at, ids);
                *store = AxisIdentityStore::Explicit(existing);
            }
        }
        self.reindex();
    }

    /// Insert a generated run without expanding a compact axis.
    pub fn insert_run(&mut self, sheet: SheetId, at: u32, run: cell_types::AxisIdentityRun) {
        self.store.insert_run(sheet, at, run);
        self.reindex();
    }

    /// Reorder selected positions while retaining unaffected compact runs.
    pub fn reorder_positions(&mut self, permutation: &[(u32, u32)]) {
        self.store.reorder_positions(permutation);
        self.reindex();
    }

    fn reindex(&mut self) {
        self.positions.clear();
        if let AxisIdentityStore::Explicit(ids) = &self.store {
            self.positions
                .extend(ids.iter().enumerate().map(|(pos, id)| (*id, pos as u32)));
        }
    }
}

impl<Id> Deref for AxisIndex<Id> {
    type Target = AxisIdentityStore<Id>;
    fn deref(&self) -> &Self::Target {
        &self.store
    }
}
