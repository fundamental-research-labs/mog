use bridge_core as bridge;

use super::{YrsComputeEngine, services};
use crate::snapshot::{MutationResult, UndoState};
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "core_undo",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Undo / Redo
    // -------------------------------------------------------------------

    /// Undo the last user action. Returns viewport patches and mutation result
    /// from applying the undone changes.
    ///
    /// Uses the unified observer pipeline: drains ALL changes (not just cells),
    /// produces format viewport patches, and populates a complete MutationResult
    /// so the TS side sees dimension, merge, format, and other domain changes.
    #[bridge::write(scope = "workbook")]
    pub fn undo(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if !self.mutation.undo_manager.can_undo() {
            return Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ));
        }

        let undo_depth_before = self.mutation.undo_manager.undo_depth();
        let _did_undo =
            self.mutation
                .undo_manager
                .undo()
                .map_err(|e| ComputeError::InternalPanic {
                    message: e.to_string(),
                })?;

        // The undo operation modifies the yrs Doc. The observer detects ALL
        // changes across every domain. The unified pipeline handles:
        // - Cell changes → mirror sync + recalc + value viewport patches
        // - Property changes → format viewport patches + PropertyChange entries
        // - Dimension/merge/visibility/etc → MutationResult fields
        // - Table changes → sync_tables_from_yrs (inside apply_all_observer_changes)
        let (patches, mut result) = self.apply_observer_changes_with_patches()?;
        let redo_depth_after = self.mutation.undo_manager.redo_depth();
        if let Some(hint) = self
            .mutation
            .sheet_lifecycle_history
            .apply_undo(undo_depth_before, redo_depth_after)
        {
            Self::attach_sheet_lifecycle_runtime_hint(&mut result, hint);
        }
        Ok((patches, result))
    }

    /// Redo the last undone action. Returns viewport patches and mutation result
    /// from applying the redone changes.
    ///
    /// Same unified pipeline as `undo()`.
    #[bridge::write(scope = "workbook")]
    pub fn redo(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if !self.mutation.undo_manager.can_redo() {
            return Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            ));
        }

        let redo_depth_before = self.mutation.undo_manager.redo_depth();
        let _did_redo =
            self.mutation
                .undo_manager
                .redo()
                .map_err(|e| ComputeError::InternalPanic {
                    message: e.to_string(),
                })?;

        // Same as undo: the redo modifies yrs Doc, observer detects ALL changes.
        let (patches, mut result) = self.apply_observer_changes_with_patches()?;
        if let Some(hint) = self
            .mutation
            .sheet_lifecycle_history
            .apply_redo(redo_depth_before)
        {
            Self::attach_sheet_lifecycle_runtime_hint(&mut result, hint);
        }
        Ok((patches, result))
    }

    #[bridge::read(scope = "workbook")]
    pub fn can_undo(&self) -> bool {
        services::undo::can_undo(&self.mutation)
    }
    #[bridge::read(scope = "workbook")]
    pub fn can_redo(&self) -> bool {
        services::undo::can_redo(&self.mutation)
    }
    #[bridge::read(scope = "workbook")]
    pub fn get_undo_state(&self) -> UndoState {
        services::undo::get_undo_state(&self.mutation)
    }

    #[bridge::write(scope = "workbook")]
    pub fn begin_undo_group(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.begin_undo_group();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }
    #[bridge::write(scope = "workbook")]
    pub fn end_undo_group(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.end_undo_group();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }
}
