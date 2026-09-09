//! Imported dynamic-array cache retirement around a scheduler mutation.
//!
//! Package cache children must be absent from the live mirror while a direct
//! replacement of their anchor is scheduled. The persistent sidecar remains
//! authoritative until scheduling succeeds so rejected mutations can restore
//! the exact imported state.

use cell_types::{SheetId, SheetPos};

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

pub(super) fn retire_for_positions(
    mirror: &mut CellMirror,
    positions: impl IntoIterator<Item = (SheetId, u32, u32)>,
) {
    mirror.invalidate_imported_array_caches_at(
        positions
            .into_iter()
            .map(|(sheet_id, row, col)| (sheet_id, SheetPos::new(row, col))),
    );
}

pub(super) fn commit(stores: &mut EngineStores, mirror: &mut CellMirror) {
    let invalidated = mirror.take_imported_array_cache_invalidations();
    stores
        .storage
        .invalidate_imported_array_caches_at(invalidated);
}

pub(super) fn restore_after_rejection(stores: &EngineStores, mirror: &mut CellMirror) {
    mirror.install_imported_array_caches(&stores.storage.imported_array_caches);
}
