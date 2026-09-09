//! Native workbook and worksheet metadata, paired with the sparse cell store.

pub mod engine;
pub mod properties;

// ---------------------------------------------------------------------------
// Sub-directories (internal organization)
// ---------------------------------------------------------------------------
mod cell_metadata;
pub mod cells;
pub(crate) mod infra;
pub mod sheet;
pub mod table_format;
pub mod workbook;
pub(crate) use cell_metadata::{CellMetadata, CellMetadataMap, FormulaMetadata};

use crate::snapshot::WorkbookSnapshot;
use std::sync::atomic::{AtomicU64, Ordering};
use value_types::ComputeError;

pub(crate) static STORAGE_ID_ALLOC: std::sync::LazyLock<cell_types::IdAllocator> =
    std::sync::LazyLock::new(cell_types::IdAllocator::new);

fn random_nonzero_runtime_partition() -> u64 {
    loop {
        let bytes = *uuid::Uuid::new_v4().as_bytes();
        let partition = u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]);
        if partition != 0 && partition != cell_types::VIRTUAL_CELL_SENTINEL {
            return partition;
        }
    }
}

pub(crate) fn new_runtime_metadata_id_allocator() -> cell_types::IdAllocator {
    cell_types::IdAllocator::with_client_partition(random_nonzero_runtime_partition())
}

/// A projection revision belongs to one native storage instance. Clones receive
/// a fresh token so a provider retained by a cloned mirror cannot mistake a
/// different storage snapshot for the state it previously observed.
#[derive(Debug)]
struct MetadataRevision(AtomicU64);

impl MetadataRevision {
    fn next() -> u64 {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        NEXT.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
            value.checked_add(1)
        })
        .expect("metadata projection revision exhausted")
    }
}

impl Default for MetadataRevision {
    fn default() -> Self {
        Self(AtomicU64::new(Self::next()))
    }
}

impl Clone for MetadataRevision {
    fn clone(&self) -> Self {
        Self::default()
    }
}

/// Owns native metadata. The engine owns cell values and identities in a sibling
/// store so metadata and cell mutations can borrow independently.
#[derive(Clone, Default)]
pub struct WorkbookStorage {
    metadata_revision: MetadataRevision,
    pub(crate) history: engine::history::HistoryCapture,
    pub(crate) cell_metadata: CellMetadataMap,
    pub(crate) metadata: Box<workbook::WorkbookMetadata>,
    pub(crate) sheet_metadata: std::collections::HashMap<cell_types::SheetId, sheet::SheetMetadata>,
}

impl WorkbookStorage {
    pub(crate) fn metadata_revision(&self) -> u64 {
        self.metadata_revision.0.load(Ordering::Relaxed)
    }

    pub(crate) fn invalidate_cell_metadata_projection(&self) {
        self.metadata_revision
            .0
            .store(MetadataRevision::next(), Ordering::Relaxed);
    }

    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_snapshot(snapshot: WorkbookSnapshot) -> Result<Self, ComputeError> {
        let mut storage = Self::new();
        storage.populate_snapshot_metadata(snapshot)?;
        Ok(storage)
    }
}

impl std::fmt::Debug for WorkbookStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkbookStorage")
            .field("sheet_order", &self.sheet_order())
            .finish()
    }
}

#[cfg(test)]
mod tests;
