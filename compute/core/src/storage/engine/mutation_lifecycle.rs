use value_types::ComputeError;

use crate::snapshot::{MutationResult, SheetLifecycleRuntimeHint};

use super::mutation_coordinator::SheetLifecycleHistoryHint;
use super::YrsComputeEngine;

impl YrsComputeEngine {
    pub(super) fn attach_sheet_lifecycle_runtime_hint(
        result: &mut MutationResult,
        hint: SheetLifecycleRuntimeHint,
    ) {
        result.sheet_lifecycle_runtime_hint = Some(hint);
    }

    pub(in crate::storage::engine) fn record_sheet_lifecycle_history_hint(
        &mut self,
        undo_depth_after: usize,
        hint: SheetLifecycleHistoryHint,
    ) {
        self.mutation
            .sheet_lifecycle_history
            .record_forward(undo_depth_after, hint);
    }

    pub(super) fn with_undo_group_if<T>(
        &mut self,
        enabled: bool,
        f: impl FnOnce(&mut Self) -> Result<T, ComputeError>,
    ) -> Result<T, ComputeError> {
        if enabled {
            self.mutation.undo_manager.begin_undo_group();
        }
        let result = f(self);
        if enabled {
            self.mutation.undo_manager.end_undo_group();
        }
        result
    }
}
