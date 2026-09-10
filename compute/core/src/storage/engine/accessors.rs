use super::ComputeEngine;
use crate::cells::CellStore;
use crate::identity::GridIndex;
use crate::scheduler::ComputeCore;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use compute_layout_index::PixelLayout;

impl ComputeEngine {
    // -------------------------------------------------------------------
    // Accessors
    // -------------------------------------------------------------------

    pub fn storage(&self) -> &WorkbookStorage {
        &self.stores.storage
    }
    pub fn cell_store(&self) -> &CellStore {
        &self.cell_store
    }
    #[cfg(test)]
    pub(crate) fn storage_mut(&mut self) -> &mut WorkbookStorage {
        self.stores
            .pixel_layouts
            .get_mut()
            .expect("pixel layout cache poisoned")
            .clear();
        &mut self.stores.storage
    }
    pub fn grid_index(&self, sheet_id: &SheetId) -> Option<&GridIndex> {
        self.stores.grid_indexes.get(sheet_id)
    }
    /// Get lazily derived pixel geometry for a sheet.
    pub fn pixel_layout(&self, sheet_id: &SheetId) -> Option<std::sync::Arc<PixelLayout>> {
        self.stores.pixel_layout(sheet_id)
    }

    pub fn compute(&self) -> &ComputeCore {
        &self.stores.compute
    }
    #[allow(dead_code)] // Bridge-ready: mutable engine access for bridge callers
    pub(crate) fn compute_mut(&mut self) -> &mut ComputeCore {
        &mut self.stores.compute
    }

    /// Run a closure with mutable access to the engine's internal stores,
    /// and cell store. Test-only — used by in-crate unit
    /// tests that need to call `pub(in crate::storage::engine)` helpers
    /// (e.g. `mutation_set_cells_raw`) directly without going through the
    /// `apply_mutation` dispatch.
    #[cfg(test)]
    pub(crate) fn with_internals_for_test<F, R>(&mut self, f: F) -> R
    where
        F: FnOnce(&mut crate::storage::engine::stores::EngineStores, &mut CellStore) -> R,
    {
        f(&mut self.stores, &mut self.cell_store)
    }

    #[cfg(test)]
    pub(crate) fn with_storage_and_store_for_test<F, R>(&mut self, f: F) -> R
    where
        F: FnOnce(&mut WorkbookStorage, &mut CellStore) -> R,
    {
        f(&mut self.stores.storage, &mut self.cell_store)
    }
}
