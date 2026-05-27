//! # Document Observer
//!
//! Bridges yrs document changes to the compute engine's recalculation system.
//!
//! The `DocumentObserver` watches ALL yrs sub-maps (cells, properties, merges,
//! dimensions, visibility, comments, filters, grouping, sparklines, conditional
//! formats, floating objects, pivot tables, tables, etc.) and produces a unified
//! `DocumentChanges` struct containing typed change entries for each domain.
//!
//! This replaces the previous `StorageObserver` (cells only) and `PivotObserver`
//! (pivot tables only) with a single, comprehensive observer.
//!
//! # Origin filtering
//!
//! Changes originating from formula result writes (`ORIGIN_FORMULA_RESULT`) are
//! excluded to prevent infinite recalc loops: user edits trigger recalc, which
//! writes formula results, which should NOT trigger another recalc.
//!
//! # Usage
//!
//! ```ignore
//! use compute_document::observe::DocumentObserver;
//!
//! let doc = yrs::Doc::new();
//! let sheets = doc.get_or_insert_map("sheets");
//! let workbook = doc.get_or_insert_map("workbook");
//! let observer = DocumentObserver::new(&sheets, &workbook);
//!
//! // ... perform edits via transactions ...
//!
//! let changes = observer.drain_all_changes();
//! // feed `changes` to the appropriate handlers
//! ```

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use yrs::types::Events;
use yrs::{DeepObservable, MapRef, Subscription, TransactionMut};

use crate::undo::ORIGIN_FORMULA_RESULT;

mod changes;
mod helpers;
mod sheets;
mod workbook;

#[cfg(test)]
mod tests;

pub use changes::*;

// ---------------------------------------------------------------------------
// DocumentObserver
// ---------------------------------------------------------------------------

/// Observes changes to the yrs "sheets" and "workbook" maps, producing a
/// unified [`DocumentChanges`] containing typed change entries for every domain.
///
/// This replaces both `StorageObserver` and `PivotObserver` with a single
/// observer that watches all sub-maps.
///
/// Call [`drain_all_changes`](DocumentObserver::drain_all_changes) to retrieve
/// all accumulated changes, or [`drain_changes`](DocumentObserver::drain_changes)
/// for backward-compatible cell-only changes.
pub struct DocumentObserver {
    /// Accumulated changes from yrs callbacks.
    changes: Arc<Mutex<DocumentChanges>>,

    /// Suppression depth counter. When > 0, observe_deep callbacks return
    /// immediately without processing events or allocating. Supports nesting:
    /// `set_suppressed(true)` increments, `set_suppressed(false)` decrements.
    /// Used during forward mutations where the caller already constructs side
    /// effects directly and would immediately discard observer output.
    suppress_depth: Arc<AtomicU32>,

    /// Subscription handle for the sheets map -- kept alive so the callback
    /// remains active.
    _sheets_subscription: Subscription,

    /// Subscription handle for the workbook map.
    _workbook_subscription: Subscription,
}

impl DocumentObserver {
    /// Create a new `DocumentObserver` attached to the given "sheets" and
    /// "workbook" `MapRef`s.
    ///
    /// The observer registers `observe_deep` callbacks on both maps. When
    /// any sub-map within either map changes, the observer records typed
    /// change entries that can be retrieved via
    /// [`drain_all_changes`](DocumentObserver::drain_all_changes).
    pub fn new(sheets_map: &MapRef, workbook_map: &MapRef) -> Self {
        let changes: Arc<Mutex<DocumentChanges>> = Arc::new(Mutex::new(DocumentChanges::default()));
        let suppress_depth: Arc<AtomicU32> = Arc::new(AtomicU32::new(0));

        // --- Sheets map subscription ---
        let sheets_changes = changes.clone();
        let sheets_suppress = suppress_depth.clone();
        let sheets_subscription =
            sheets_map.observe_deep(move |txn: &TransactionMut, events: &Events| {
                // Fast exit when suppressed — no event iteration, no allocation.
                if sheets_suppress.load(Ordering::Relaxed) > 0 {
                    return;
                }

                // Check origin -- skip formula-result writes to prevent recalc loops.
                if let Some(origin) = txn.origin()
                    && origin.as_ref() == ORIGIN_FORMULA_RESULT
                {
                    return;
                }

                let mut buffer = sheets_changes.lock().expect("observer lock poisoned");
                sheets::observe_sheets_events(&mut buffer, txn, events);
            });

        // --- Workbook map subscription ---
        let workbook_changes = changes.clone();
        let workbook_suppress = suppress_depth.clone();
        let workbook_subscription =
            workbook_map.observe_deep(move |txn: &TransactionMut, events: &Events| {
                // Fast exit when suppressed — no event iteration, no allocation.
                if workbook_suppress.load(Ordering::Relaxed) > 0 {
                    return;
                }

                if let Some(origin) = txn.origin()
                    && origin.as_ref() == ORIGIN_FORMULA_RESULT
                {
                    return;
                }

                let mut buffer = workbook_changes.lock().expect("observer lock poisoned");
                workbook::observe_workbook_events(&mut buffer, txn, events);
            });

        Self {
            changes,
            suppress_depth,
            _sheets_subscription: sheets_subscription,
            _workbook_subscription: workbook_subscription,
        }
    }
}

impl DocumentObserver {
    /// Suppress or unsuppress the observer. Supports nesting: each
    /// `set_suppressed(true)` increments a depth counter, each
    /// `set_suppressed(false)` decrements it. The observer is active only
    /// when the depth is 0.
    ///
    /// When suppressed, the `observe_deep` callbacks return immediately without
    /// iterating events, parsing keys, or allocating `DocumentChanges`. This
    /// eliminates wasted work during forward mutations where the caller already
    /// constructs side effects directly and would otherwise discard the observer
    /// output via `drain_changes()`.
    ///
    /// **IMPORTANT**: Only suppress during forward mutation yrs writes. Never
    /// suppress during undo/redo/sync — those paths rely on the observer to
    /// detect what changed.
    pub fn set_suppressed(&self, suppress: bool) {
        if suppress {
            self.suppress_depth.fetch_add(1, Ordering::Relaxed);
        } else {
            let prev = self.suppress_depth.fetch_sub(1, Ordering::Relaxed);
            debug_assert!(
                prev > 0,
                "set_suppressed(false) called more times than set_suppressed(true)"
            );
        }
    }

    /// Returns true if the observer is currently suppressed.
    pub fn is_suppressed(&self) -> bool {
        self.suppress_depth.load(Ordering::Relaxed) > 0
    }

    /// Drain all accumulated changes, returning them and clearing the buffer.
    ///
    /// This is the primary API for retrieving the full set of domain-specific
    /// changes detected since the last drain.
    pub fn drain_all_changes(&self) -> DocumentChanges {
        let mut buffer = self.changes.lock().expect("observer lock poisoned");
        std::mem::take(&mut *buffer)
    }

    /// Drain only cell changes (backward-compatible convenience wrapper).
    ///
    /// During migration, callers that only need cell changes can use this
    /// method. Non-cell changes are discarded.
    pub fn drain_changes(&self) -> Vec<CellChange> {
        let all = self.drain_all_changes();
        all.cells
    }

    /// Drain pivot changes, converting to the legacy `PivotChange` format.
    ///
    /// Backward-compatible wrapper for code that previously used `PivotObserver`.
    pub fn drain_pivot_changes(&self) -> Vec<PivotChange> {
        let mut buffer = self.changes.lock().expect("observer lock poisoned");
        let pivot_changes: Vec<PivotCellChange> = std::mem::take(&mut buffer.pivot_tables);
        pivot_changes
            .into_iter()
            .map(|pc| PivotChange {
                sheet_id: pc.sheet_id,
                pivot_id: pc.pivot_id,
                kind: match pc.kind {
                    CellChangeKind::Modified => PivotChangeKind::Set,
                    CellChangeKind::Removed => PivotChangeKind::Removed,
                },
            })
            .collect()
    }

    /// Check whether there are any pending changes without draining them.
    pub fn has_changes(&self) -> bool {
        let buffer = self.changes.lock().expect("observer lock poisoned");
        !buffer.is_empty()
    }

    /// Peek at the number of pending cell changes.
    pub fn pending_count(&self) -> usize {
        let buffer = self.changes.lock().expect("observer lock poisoned");
        buffer.cells.len()
    }
}

impl std::fmt::Debug for DocumentObserver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let count = self.pending_count();
        f.debug_struct("DocumentObserver")
            .field("pending_changes", &count)
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Backward-compatible type aliases
// ---------------------------------------------------------------------------

/// Type alias for backward compatibility. Use [`DocumentObserver`] directly.
pub type StorageObserver = DocumentObserver;

/// Deprecated: Use [`DocumentObserver`] directly.
/// This struct is kept only as a type alias for backward compatibility.
pub type PivotObserver = DocumentObserver;
