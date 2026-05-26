//! WorkbookHistory — Undo/redo operations and undo grouping.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use snapshot_types::{MutationResult, UndoState};

/// Undo/redo operations for the workbook.
pub struct WorkbookHistory {
    dispatch: Dispatch,
}

impl WorkbookHistory {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Undo the last user edit.
    ///
    /// Returns the mutation result (viewport patches are stripped).
    pub fn undo(&self) -> Result<MutationResult, ComputeApiError> {
        self.dispatch.call_engine(move |e| e.undo()).and_then(|r| {
            r.map(|(_vp, mutation)| mutation)
                .map_err(ComputeApiError::from)
        })
    }

    /// Redo the last undone edit.
    ///
    /// Returns the mutation result (viewport patches are stripped).
    pub fn redo(&self) -> Result<MutationResult, ComputeApiError> {
        self.dispatch.call_engine(move |e| e.redo()).and_then(|r| {
            r.map(|(_vp, mutation)| mutation)
                .map_err(ComputeApiError::from)
        })
    }

    /// Check whether undo is available.
    pub fn can_undo(&self) -> Result<bool, ComputeApiError> {
        self.dispatch.query_engine(|e| e.can_undo())
    }

    /// Check whether redo is available.
    pub fn can_redo(&self) -> Result<bool, ComputeApiError> {
        self.dispatch.query_engine(|e| e.can_redo())
    }

    /// Get a snapshot of the undo/redo state (availability + stack depths).
    pub fn get_undo_state(&self) -> Result<UndoState, ComputeApiError> {
        self.dispatch.query_engine(|e| e.get_undo_state())
    }

    /// Begin an undo group — all mutations until `end_undo_group` are
    /// collapsed into a single undo step. Supports nesting.
    pub fn begin_undo_group(&self) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.begin_undo_group().map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// End an undo group. After this, mutations become individual undo steps again.
    pub fn end_undo_group(&self) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.end_undo_group().map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
