use super::clock::{MERGE_TIMEOUT, UndoClock};
use super::origin::include_tracked_origins;
use super::poll::poll_once;
use crate::DocumentError;
use std::collections::HashSet;
use std::sync::Arc;
use yrs::sync::Clock;
use yrs::undo::UndoManager;
use yrs::{Doc, MapRef};

/// Wrapper around `yrs::undo::UndoManager` that provides a spreadsheet-aware
/// undo/redo API with origin-based scoping.
///
/// Only changes made with `ORIGIN_USER_EDIT` or `ORIGIN_STRUCTURAL` origins
/// are recorded in the undo stack. UI/view state, formula results, and remote
/// changes are excluded.
pub struct UndoRedoManager {
    undo_manager: UndoManager<()>,
    clock: Arc<UndoClock>,
    group_depth: u32,
}

impl UndoRedoManager {
    /// Create a new `UndoRedoManager` tracking the given scope within the document.
    ///
    /// The scope must be a shared collection reference (e.g. `MapRef` from
    /// `doc.get_or_insert_map()`). Only changes to this scope (and any scopes
    /// added via `expand_scope`) are tracked.
    ///
    /// By default, the manager tracks changes with `ORIGIN_USER_EDIT` and
    /// `ORIGIN_STRUCTURAL` origins, and excludes all other origins.
    pub fn new(doc: &Doc, scope: &MapRef) -> Self {
        // Construct Options explicitly instead of using Options::default() because
        // yrs gates Default behind #[cfg(not(target_family = "wasm"))] (SystemClock
        // uses std::time::SystemTime which doesn't exist on WASM).
        //
        // The UndoClock controls whether transactions merge (batch mode) or stay
        // separate (normal mode). In normal mode the clock jumps by 2*MERGE_TIMEOUT,
        // exceeding capture_timeout_millis, so each transaction is a separate step.
        let clock = Arc::new(UndoClock::new());
        let options = yrs::undo::Options {
            capture_timeout_millis: MERGE_TIMEOUT,
            tracked_origins: HashSet::new(),
            capture_transaction: None,
            timestamp: Arc::clone(&clock) as Arc<dyn Clock>,
        };
        let mut undo_manager = UndoManager::with_scope_and_options(doc, scope, options);
        include_tracked_origins(&mut undo_manager);
        Self {
            undo_manager,
            clock,
            group_depth: 0,
        }
    }

    /// Check if undo is available.
    pub fn can_undo(&self) -> bool {
        self.undo_manager.can_undo()
    }

    /// Check if redo is available.
    pub fn can_redo(&self) -> bool {
        self.undo_manager.can_redo()
    }

    /// Perform undo. Returns `true` if an undo was performed.
    ///
    /// **Important**: No other yrs transaction should be active when calling
    /// this method, because undo internally creates a transaction.
    pub fn undo(&mut self) -> Result<bool, DocumentError> {
        poll_once(self.undo_manager.undo())
    }

    /// Perform redo. Returns `true` if a redo was performed.
    ///
    /// **Important**: No other yrs transaction should be active when calling
    /// this method, because redo internally creates a transaction.
    pub fn redo(&mut self) -> Result<bool, DocumentError> {
        poll_once(self.undo_manager.redo())
    }

    /// Get the number of items in the undo stack.
    pub fn undo_depth(&self) -> usize {
        self.undo_manager.undo_stack().len()
    }

    /// Get the number of items in the redo stack.
    pub fn redo_depth(&self) -> usize {
        self.undo_manager.redo_stack().len()
    }

    /// Clear all undo/redo history.
    pub fn clear(&mut self) {
        self.undo_manager.clear();
    }

    /// Begin an undo group. All mutations until the matching `end_undo_group()`
    /// will merge into a single undo step.
    ///
    /// Supports nesting: only the outermost begin/end pair has effect.
    pub fn begin_undo_group(&mut self) {
        if self.group_depth == 0 {
            // Reset the undo manager's last_change to break any connection
            // with previous undo steps, then switch clock to batch mode.
            self.undo_manager.reset();
            self.clock.enter_batch();
        }
        self.group_depth += 1;
    }

    /// End an undo group. When the outermost group closes, switches back
    /// to normal mode where each mutation is a separate undo step.
    pub fn end_undo_group(&mut self) {
        if self.group_depth == 0 {
            // Mismatched end_undo_group: warn but don't panic.
            #[cfg(debug_assertions)]
            eprintln!("WARN: end_undo_group() called without matching begin_undo_group()");
            return;
        }
        self.group_depth -= 1;
        if self.group_depth == 0 {
            self.clock.exit_batch();
            self.undo_manager.reset();
        }
    }

    /// Get the current undo group nesting depth. 0 means not in a group.
    pub fn undo_group_depth(&self) -> u32 {
        self.group_depth
    }

    /// Access the underlying `yrs::undo::UndoManager` for advanced operations
    /// such as scope expansion or event observation.
    pub fn inner(&self) -> &UndoManager<()> {
        &self.undo_manager
    }

    /// Expand the undo manager's scope to track additional shared types.
    ///
    /// By default, only changes to the scope passed to [`new`](Self::new) are
    /// tracked. Call this method to also track changes to other shared
    /// collections (e.g. the workbook map for named ranges / tables).
    pub fn expand_scope(&mut self, scope: &MapRef) {
        self.undo_manager.expand_scope(scope);
    }

    /// Mutable access to the underlying `yrs::undo::UndoManager`.
    pub fn inner_mut(&mut self) -> &mut UndoManager<()> {
        &mut self.undo_manager
    }
}
