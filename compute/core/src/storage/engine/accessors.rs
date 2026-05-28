use super::YrsComputeEngine;
use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::scheduler::ComputeCore;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use compute_document::observe::DocumentObserver;
use compute_document::undo::UndoRedoManager;
use compute_layout_index::LayoutIndex;

impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Accessors
    // -------------------------------------------------------------------

    pub fn storage(&self) -> &YrsStorage {
        &self.stores.storage
    }
    /// Access the security state (R2.3). Not a `#[bridge::*]` method —
    /// consumed only by internal engine primitives (R3.1) and by
    /// `ComputeService::new` to grab the shared `active` handle.
    pub fn security(&self) -> &crate::storage::security_state::SecurityState {
        &self.security
    }
    pub fn mirror(&self) -> &CellMirror {
        &self.mirror
    }
    #[allow(dead_code)] // Bridge-ready: mutable engine access for bridge callers
    pub(crate) fn storage_mut(&mut self) -> &mut YrsStorage {
        &mut self.stores.storage
    }
    pub fn grid_index(&self, sheet_id: &SheetId) -> Option<&GridIndex> {
        self.stores.grid_indexes.get(sheet_id)
    }
    pub fn layout_index(&self, sheet_id: &SheetId) -> Option<&LayoutIndex> {
        self.stores.layout_indexes.get(sheet_id)
    }
    pub fn layout_index_mut(&mut self, sheet_id: &SheetId) -> Option<&mut LayoutIndex> {
        self.stores.layout_indexes.get_mut(sheet_id)
    }
    pub fn compute(&self) -> &ComputeCore {
        &self.stores.compute
    }
    #[allow(dead_code)] // Bridge-ready: mutable engine access for bridge callers
    pub(crate) fn compute_mut(&mut self) -> &mut ComputeCore {
        &mut self.stores.compute
    }
    pub fn undo_manager(&self) -> &UndoRedoManager {
        &self.mutation.undo_manager
    }
    pub fn observer(&self) -> &DocumentObserver {
        &self.mutation.observer
    }

    /// Run a closure with mutable access to the engine's internal stores,
    /// mirror, and mutation coordinator. Test-only — used by in-crate unit
    /// tests that need to call `pub(in crate::storage::engine)` helpers
    /// (e.g. `mutation_set_cells_raw`) directly without going through the
    /// `apply_mutation` dispatch.
    #[cfg(test)]
    pub(crate) fn with_internals_for_test<F, R>(&mut self, f: F) -> R
    where
        F: FnOnce(
            &mut crate::storage::engine::stores::EngineStores,
            &mut CellMirror,
            &mut crate::storage::engine::mutation_coordinator::MutationCoordinator,
        ) -> R,
    {
        f(&mut self.stores, &mut self.mirror, &mut self.mutation)
    }
}
