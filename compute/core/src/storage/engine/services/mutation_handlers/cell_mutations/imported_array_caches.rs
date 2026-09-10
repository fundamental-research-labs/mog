//! Imported dynamic-array cache retirement around a scheduler mutation.
//!
//! Package cache children must be absent from the live cell store while a direct
//! replacement of their anchor is scheduled. The persistent sidecar remains
//! authoritative until scheduling succeeds so rejected mutations can restore
//! the exact imported state.

use cell_types::{SheetId, SheetPos};

use crate::cells::CellStore;
use crate::storage::engine::stores::EngineStores;

pub(super) fn retire_for_positions(
    cell_store: &mut CellStore,
    positions: impl IntoIterator<Item = (SheetId, u32, u32)>,
) {
    cell_store.invalidate_imported_array_caches_at(
        positions
            .into_iter()
            .map(|(sheet_id, row, col)| (sheet_id, SheetPos::new(row, col))),
    );
}

pub(super) fn commit(stores: &mut EngineStores, cell_store: &mut CellStore) {
    let invalidated = cell_store.take_imported_array_cache_invalidations();
    stores
        .storage
        .invalidate_imported_array_caches_at(invalidated);
}

pub(super) fn restore_after_rejection(stores: &EngineStores, cell_store: &mut CellStore) {
    cell_store.install_imported_array_caches(&stores.storage.imported_array_caches);
}
