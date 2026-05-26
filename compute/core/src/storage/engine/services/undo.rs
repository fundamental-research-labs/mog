//! Undo/redo bridge helpers extracted as free functions.
//!
//! The public `undo()` / `redo()` methods remain on `impl YrsComputeEngine`
//! because they are bridge-annotated and orchestrate multiple sub-structs.
//! This module extracts the read-only state queries.

use crate::snapshot::UndoState;
use crate::storage::engine::mutation_coordinator::MutationCoordinator;

/// Get a snapshot of the undo/redo state (availability + stack depths).
pub(in crate::storage::engine) fn get_undo_state(mutation: &MutationCoordinator) -> UndoState {
    UndoState {
        can_undo: mutation.undo_manager.can_undo(),
        can_redo: mutation.undo_manager.can_redo(),
        undo_depth: mutation.undo_manager.undo_depth(),
        redo_depth: mutation.undo_manager.redo_depth(),
    }
}

/// Check if undo is available.
pub(in crate::storage::engine) fn can_undo(mutation: &MutationCoordinator) -> bool {
    mutation.undo_manager.can_undo()
}

/// Check if redo is available.
pub(in crate::storage::engine) fn can_redo(mutation: &MutationCoordinator) -> bool {
    mutation.undo_manager.can_redo()
}
