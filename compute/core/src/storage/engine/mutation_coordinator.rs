//! Mutation coordination layer for the compute engine.
//!
//! `MutationCoordinator` groups the observer pipeline, undo/redo manager, and
//! pending mutation results (recalc output, format patches) that together
//! orchestrate how edits flow through the engine. Splitting these into a
//! dedicated sub-struct is Phase 1b of the engine decomposition: it isolates
//! mutation lifecycle state so that service modules can borrow `EngineStores`
//! without conflicting with borrows of the observer or undo manager.

use compute_document::observe::{CellChange, DocumentObserver};
use compute_document::undo::UndoRedoManager;
use snapshot_types::SheetLifecycleRuntimeHint;
use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub(super) struct SheetLifecycleHistoryHint {
    pub undo: Option<SheetLifecycleRuntimeHint>,
    pub redo: Option<SheetLifecycleRuntimeHint>,
}

#[derive(Debug, Default)]
pub(super) struct SheetLifecycleHistory {
    undo_hints_by_depth: HashMap<usize, SheetLifecycleHistoryHint>,
    redo_hints_by_depth: HashMap<usize, SheetLifecycleRuntimeHint>,
}

impl SheetLifecycleHistory {
    pub(super) fn record_forward(
        &mut self,
        undo_depth_after: usize,
        hint: SheetLifecycleHistoryHint,
    ) {
        if undo_depth_after == 0 {
            return;
        }
        self.undo_hints_by_depth
            .retain(|depth, _| *depth <= undo_depth_after);
        self.redo_hints_by_depth.clear();
        self.undo_hints_by_depth.insert(undo_depth_after, hint);
    }

    pub(super) fn apply_undo(
        &mut self,
        undo_depth_before: usize,
        redo_depth_after: usize,
    ) -> Option<SheetLifecycleRuntimeHint> {
        let hint = self.undo_hints_by_depth.get(&undo_depth_before)?;
        if let Some(redo) = hint.redo.clone() {
            self.redo_hints_by_depth.insert(redo_depth_after, redo);
        }
        hint.undo.clone()
    }

    pub(super) fn apply_redo(
        &mut self,
        redo_depth_before: usize,
    ) -> Option<SheetLifecycleRuntimeHint> {
        self.redo_hints_by_depth.remove(&redo_depth_before)
    }
}

/// Mutation coordination layer for the compute engine.
///
/// Groups the document observer (yrs change detection), undo/redo manager
/// (origin-scoped undo stacks), and stashed mutation results that are consumed
/// asynchronously by viewport patch production.
pub(crate) struct MutationCoordinator {
    /// Change observer (bridges yrs events to recalc).
    /// Watches all yrs sub-maps (cells, properties, merges, pivots, etc.)
    /// and the workbook map (tables, namedRanges, etc.).
    pub(super) observer: DocumentObserver,

    /// Undo/redo manager (origin-scoped).
    pub(super) undo_manager: UndoRedoManager,

    /// Stashed recalc result from the last mutation, for pull-based viewport
    /// patch production. `flush_viewport_patches()` takes this and produces
    /// binary patches.
    pub(super) pending_recalc: Option<snapshot_types::RecalcResult>,

    /// Stashed format viewport patches from the last format mutation.
    /// `flush_format_viewport_patches()` takes this.
    pub(super) pending_format_patches: Option<Vec<u8>>,

    /// Runtime sheet lifecycle hints keyed by undo/redo stack depth.
    ///
    /// The yrs undo stack does not expose per-entry custom metadata, so this
    /// sidecar records only local-session runtime hints while leaving workbook
    /// state persistence in yrs.
    pub(super) sheet_lifecycle_history: SheetLifecycleHistory,
}

// ---------------------------------------------------------------------------
// SuppressGuard — RAII suppression of observer callbacks
// ---------------------------------------------------------------------------

/// RAII guard that suppresses the `DocumentObserver` for the duration of its
/// lifetime.
///
/// Created via [`MutationCoordinator::suppress_guard`]. On construction it
/// calls `observer.set_suppressed(true)` (incrementing the suppression depth
/// counter); on drop it calls `observer.set_suppressed(false)` (decrementing).
///
/// This is useful during forward mutations where the caller constructs side
/// effects directly and would immediately discard observer output.
pub(crate) struct SuppressGuard<'a> {
    observer: &'a DocumentObserver,
}

impl<'a> SuppressGuard<'a> {
    fn new(observer: &'a DocumentObserver) -> Self {
        observer.set_suppressed(true);
        Self { observer }
    }
}

impl Drop for SuppressGuard<'_> {
    fn drop(&mut self) {
        self.observer.set_suppressed(false);
    }
}

// ---------------------------------------------------------------------------
// MutationCoordinator methods
// ---------------------------------------------------------------------------

impl MutationCoordinator {
    /// Create an RAII guard that suppresses the observer for the duration of
    /// its lifetime. See [`SuppressGuard`] for details.
    pub(crate) fn suppress_guard(&self) -> SuppressGuard<'_> {
        SuppressGuard::new(&self.observer)
    }

    /// Drain accumulated cell changes from the observer.
    ///
    /// Convenience wrapper around [`DocumentObserver::drain_changes`].
    #[allow(dead_code)] // Bridge-ready: drain mutation log for external consumers
    pub(super) fn drain_changes(&self) -> Vec<CellChange> {
        self.observer.drain_changes()
    }
}
