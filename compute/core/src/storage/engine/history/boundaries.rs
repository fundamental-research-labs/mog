use bridge_core as bridge;
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};

use super::Action;
use crate::storage::engine::ComputeEngine;

impl ComputeEngine {
    /// One public user action, including any nested engine mutations.
    pub(crate) fn with_history<R>(&mut self, operation: impl FnOnce(&mut Self) -> R) -> R {
        if self.history.replaying || self.history.suppressed != 0 {
            return operation(self);
        }
        let outer = self.history.action_depth == 0;
        if outer {
            self.bind_history_capture();
            self.stores.storage.history.begin();
        }
        self.history.action_depth += 1;
        let outcome = catch_unwind(AssertUnwindSafe(|| operation(self)));
        self.history.action_depth -= 1;
        if outer {
            crate::storage::engine::cell_metadata::refresh(
                &self.stores.storage,
                &mut self.cell_store,
                self.stores.layout_metrics,
            );
            super::super::services::cell_editing::sync_grid_axes(
                &mut self.stores,
                &self.cell_store,
            );
            let patches = self
                .stores
                .storage
                .history
                .finish()
                .into_iter()
                .filter(|patch| patch.is_changed(&self.stores, &self.cell_store))
                .collect::<Vec<_>>();
            if !patches.is_empty() {
                self.history.redo.clear();
                if self.history.group_depth != 0 {
                    self.history.group.patches.extend(patches);
                } else {
                    self.history.undo.push(Action { patches });
                }
            }
        }
        match outcome {
            Ok(value) => value,
            Err(panic) => resume_unwind(panic),
        }
    }

    /// Apply bootstrap, calculated, or session state without disturbing history.
    pub(crate) fn without_history<R>(&mut self, operation: impl FnOnce(&mut Self) -> R) -> R {
        let capture = self.stores.storage.history.share();
        let was_active = capture
            .0
            .active
            .swap(false, std::sync::atomic::Ordering::Relaxed);
        self.history.suppressed += 1;
        let outcome = catch_unwind(AssertUnwindSafe(|| operation(self)));
        self.history.suppressed -= 1;
        if self.history.suppressed == 0 {
            super::super::services::cell_editing::sync_grid_axes(
                &mut self.stores,
                &self.cell_store,
            );
        }
        capture
            .0
            .active
            .store(was_active, std::sync::atomic::Ordering::Relaxed);
        match outcome {
            Ok(value) => value,
            Err(panic) => resume_unwind(panic),
        }
    }

    pub(crate) fn bind_history_capture(&mut self) {
        if !std::sync::Arc::ptr_eq(&self.stores.storage.history.0, &self.cell_store.history.0) {
            self.cell_store
                .bind_history_capture(self.stores.storage.history.share());
        }
    }

    fn finish_open_history_action(&mut self) {
        if !self.history.group.patches.is_empty() {
            self.history
                .undo
                .push(std::mem::take(&mut self.history.group));
        }
    }

    pub(crate) fn clear_history(&mut self) {
        self.history.undo.clear();
        self.history.redo.clear();
        self.history.group.patches.clear();
    }
}

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "core_undo",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    #[bridge::read]
    pub fn can_undo(&self) -> bool {
        !self.history.undo.is_empty() || !self.history.group.patches.is_empty()
    }

    #[bridge::read]
    pub fn can_redo(&self) -> bool {
        !self.history.redo.is_empty()
    }

    #[bridge::read]
    pub fn get_undo_state(&self) -> crate::snapshot::UndoState {
        crate::snapshot::UndoState {
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
            undo_depth: self.history.undo.len()
                + usize::from(!self.history.group.patches.is_empty()),
            redo_depth: self.history.redo.len(),
        }
    }

    #[bridge::write]
    pub fn begin_undo_group(
        &mut self,
    ) -> Result<crate::snapshot::MutationResult, value_types::ComputeError> {
        self.history.group_depth += 1;
        Ok(crate::snapshot::MutationResult::empty())
    }

    #[bridge::write]
    pub fn end_undo_group(
        &mut self,
    ) -> Result<crate::snapshot::MutationResult, value_types::ComputeError> {
        if self.history.group_depth != 0 {
            self.history.group_depth -= 1;
            if self.history.group_depth == 0 {
                self.finish_open_history_action();
            }
        }
        Ok(crate::snapshot::MutationResult::empty())
    }

    #[bridge::write]
    pub fn undo(&mut self) -> Result<crate::snapshot::MutationResult, value_types::ComputeError> {
        self.finish_open_history_action();
        self.replay_history(false)
    }

    #[bridge::write]
    pub fn redo(&mut self) -> Result<crate::snapshot::MutationResult, value_types::ComputeError> {
        self.finish_open_history_action();
        self.replay_history(true)
    }
}
