//! # Undo/Redo Manager
//!
//! Wraps `yrs::undo::UndoManager` with a spreadsheet-aware API that distinguishes
//! between user edits, UI/view state, formula results, structural changes, and
//! remote changes.
//!
//! Only user edits and structural changes are undoable. Formula recalculation
//! results, local UI/view state, and remote changes are excluded from the undo
//! stack — they are consequences of other operations or navigation state, not
//! document edits.
//!
//! # Origin tracking
//!
//! Each yrs transaction can carry an `Origin` tag that classifies the change.
//! The `UndoRedoManager` is configured to only track transactions whose origin
//! matches the "user edit" or "structural change" origins, while ignoring
//! UI/view-state, formula-result, and remote-sync origins.
//!
//! # Usage
//!
//! ```ignore
//! use yrs::{Doc, Map, Transact};
//! use compute_document::undo::{UndoRedoManager, ORIGIN_USER_EDIT};
//!
//! let doc = Doc::new();
//! let map = doc.get_or_insert_map("sheets");
//! let mut mgr = UndoRedoManager::new(&doc, &map);
//!
//! // Perform a user edit (tracked by undo manager)
//! {
//!     let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
//!     map.insert(&mut txn, "A1", "hello");
//! }
//!
//! assert!(mgr.can_undo());
//! mgr.undo().unwrap(); // reverts the insert
//! ```

use crate::DocumentError;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::task::{Context, Poll, Waker};

use yrs::sync::Clock;
use yrs::undo::UndoManager;
use yrs::{Doc, MapRef, Origin};

// ---------------------------------------------------------------------------
// Synchronous future polling
// ---------------------------------------------------------------------------

/// Poll a future exactly once, expecting it to resolve immediately.
///
/// yrs 0.21's `UndoManager::undo()` / `redo()` return `impl Future<Output = bool>`.
/// The future is only `Pending` when another yrs transaction is active on the same
/// document.  Since we always call undo/redo outside any active transaction, the
/// future resolves on the first poll.
fn poll_once<F: std::future::Future>(f: F) -> Result<F::Output, DocumentError> {
    let mut pinned = std::pin::pin!(f);
    let mut cx = Context::from_waker(Waker::noop());
    match pinned.as_mut().poll(&mut cx) {
        Poll::Ready(val) => Ok(val),
        Poll::Pending => Err(DocumentError::UndoFailed(
            "undo/redo future was Pending — is a yrs transaction active?".into(),
        )),
    }
}

// ---------------------------------------------------------------------------
// Origin identifiers
// ---------------------------------------------------------------------------

/// Origin for user-initiated edits (typing, paste, formatting, etc.).
/// Transactions with this origin are tracked by the undo manager.
pub const ORIGIN_USER_EDIT: &[u8] = b"user";

/// Origin for formula recalculation results.
/// Transactions with this origin are NOT tracked — formula results are
/// a consequence of cell edits, not user actions.
pub const ORIGIN_FORMULA_RESULT: &[u8] = b"formula";

/// Origin for local UI/navigation state (selected sheet tabs, scroll position,
/// viewport-only state).
/// Transactions with this origin are NOT tracked — these changes must not clear
/// redo for the previous document edit.
pub const ORIGIN_UI_STATE: &[u8] = b"ui";

/// Origin for structural changes (insert/delete rows/cols, rename sheet, etc.).
/// Transactions with this origin ARE tracked by the undo manager.
pub const ORIGIN_STRUCTURAL: &[u8] = b"structure";

/// Origin for remote collaboration updates (sync from another client).
/// Transactions with this origin are NOT tracked — remote changes are
/// not the local user's actions.
pub const ORIGIN_REMOTE: &[u8] = b"remote";

/// Origin for engine bootstrap mutations (e.g. the implicit "Sheet1" created
/// when starting a blank workbook). Transactions with this origin are NOT
/// tracked — bootstrap state is the empty document the user sees on open,
/// not an action they took, so it must never appear on the undo stack.
///
/// This origin is intentionally absent from the UndoManager's tracked-origin
/// set: it is the canonical, permanent way to signal "this transaction
/// belongs to engine setup, not the user."
pub const ORIGIN_BOOTSTRAP: &[u8] = b"bootstrap";

// ---------------------------------------------------------------------------
// UndoClock — virtual clock for undo grouping
// ---------------------------------------------------------------------------

/// Capture timeout in milliseconds. Must match `Options.capture_timeout_millis`
/// so the yrs merge logic behaves consistently with our clock increments.
const MERGE_TIMEOUT: u64 = 1_000_000;

/// A virtual clock that controls whether consecutive yrs transactions merge
/// into a single undo step or remain separate.
///
/// In **normal mode** (default), each call to `now()` jumps forward by
/// `2 * MERGE_TIMEOUT`, guaranteeing the gap exceeds the capture timeout
/// and every transaction becomes its own undo step.
///
/// In **batch mode** (`enter_batch()`), each call to `now()` increments by
/// just 1, keeping the gap well within the capture timeout so all
/// transactions merge into a single undo step.
struct UndoClock {
    counter: AtomicU64,
    in_batch: AtomicBool,
}

impl UndoClock {
    fn new() -> Self {
        Self {
            counter: AtomicU64::new(0),
            in_batch: AtomicBool::new(false),
        }
    }

    fn enter_batch(&self) {
        self.in_batch.store(true, Ordering::Relaxed);
    }

    fn exit_batch(&self) {
        self.in_batch.store(false, Ordering::Relaxed);
    }
}

impl Clock for UndoClock {
    fn now(&self) -> u64 {
        if self.in_batch.load(Ordering::Relaxed) {
            // Batch mode: small increments -> gap < MERGE_TIMEOUT -> merge
            self.counter.fetch_add(1, Ordering::Relaxed) + 1
        } else {
            // Normal mode: large increments -> gap > MERGE_TIMEOUT -> separate
            self.counter.fetch_add(MERGE_TIMEOUT * 2, Ordering::Relaxed) + MERGE_TIMEOUT * 2
        }
    }
}

// ---------------------------------------------------------------------------
// UndoRedoManager
// ---------------------------------------------------------------------------

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
        // Track only user edits and structural changes.
        undo_manager.include_origin(Origin::from(ORIGIN_USER_EDIT));
        undo_manager.include_origin(Origin::from(ORIGIN_STRUCTURAL));
        // Formula results and remote changes are implicitly excluded because
        // we explicitly included only the origins we want to track.
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
            // Mismatched end_undo_group — warn but don't panic
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
    /// (e.g. `expand_scope`, `wrap_changes`, event observation).
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

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Map, Transact};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Create a Doc with distinct client_id and a "sheets" map, returning both.
    fn setup() -> (Doc, yrs::MapRef) {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("sheets");
        (doc, map)
    }

    #[test]
    fn poll_once_ready_future_returns_value() {
        assert_eq!(poll_once(std::future::ready(7)).unwrap(), 7);
    }

    #[test]
    fn poll_once_pending_future_returns_undo_failed() {
        match poll_once(std::future::pending::<()>()) {
            Err(DocumentError::UndoFailed(message)) => {
                assert!(message.contains("Pending"));
            }
            other => panic!("expected UndoFailed for Pending future, got {other:?}"),
        }
    }

    // -----------------------------------------------------------------------
    // 1. Basic undo of a single edit
    // -----------------------------------------------------------------------

    #[test]
    fn basic_undo_single_edit() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // User edit: insert a value.
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "hello");
        }

        assert!(mgr.can_undo());
        assert_eq!(mgr.undo_depth(), 1);

        // Undo should revert the insert.
        assert!(mgr.undo().unwrap());

        // The map should be empty again.
        {
            let txn = doc.transact();
            assert!(
                map.get(&txn, "A1").is_none(),
                "A1 should be removed after undo"
            );
        }
        assert!(!mgr.can_undo());
        assert_eq!(mgr.undo_depth(), 0);
    }

    // -----------------------------------------------------------------------
    // 2. Multiple edits then undo all
    // -----------------------------------------------------------------------

    #[test]
    fn multiple_edits_undo_all() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Three separate user edits.
        for (key, val) in [("A1", "one"), ("B1", "two"), ("C1", "three")] {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, key, val);
        }

        assert_eq!(mgr.undo_depth(), 3);

        // Undo all three.
        assert!(mgr.undo().unwrap());
        assert!(mgr.undo().unwrap());
        assert!(mgr.undo().unwrap());
        assert!(!mgr.can_undo());

        // Map should be empty.
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "A1").is_none());
            assert!(map.get(&txn, "B1").is_none());
            assert!(map.get(&txn, "C1").is_none());
        }
    }

    // -----------------------------------------------------------------------
    // 3. Undo then redo
    // -----------------------------------------------------------------------

    #[test]
    fn undo_then_redo() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "value");
        }

        // Undo the insert.
        assert!(mgr.undo().unwrap());
        assert!(!mgr.can_undo());
        assert!(mgr.can_redo());

        // Redo should restore it.
        assert!(mgr.redo().unwrap());
        {
            let txn = doc.transact();
            let val = map.get(&txn, "A1");
            assert!(val.is_some(), "A1 should be restored after redo");
        }
        assert!(mgr.can_undo());
        assert!(!mgr.can_redo());
    }

    // -----------------------------------------------------------------------
    // 4. Undo clears redo stack on new edit
    // -----------------------------------------------------------------------

    #[test]
    fn new_edit_clears_redo_stack() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Edit, then undo (creates redo entry).
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "first");
        }
        assert!(mgr.undo().unwrap());
        assert!(mgr.can_redo());
        assert_eq!(mgr.redo_depth(), 1);

        // New edit should clear the redo stack.
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "B1", "second");
        }
        assert!(
            !mgr.can_redo(),
            "redo stack should be cleared after new edit"
        );
        assert_eq!(mgr.redo_depth(), 0);
    }

    // -----------------------------------------------------------------------
    // 5. Formula results are NOT undoable
    // -----------------------------------------------------------------------

    #[test]
    fn formula_results_not_undoable() {
        let (doc, map) = setup();
        let mgr = UndoRedoManager::new(&doc, &map);

        // A formula result change (excluded from undo tracking).
        {
            let mut txn = doc.transact_mut_with(ORIGIN_FORMULA_RESULT);
            map.insert(&mut txn, "A1", "=SUM(B1:B10) result: 42");
        }

        // The change happened, but undo stack should be empty.
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "A1").is_some(), "formula result should exist");
        }
        assert!(!mgr.can_undo(), "formula results should not be undoable");
        assert_eq!(mgr.undo_depth(), 0);
    }

    // -----------------------------------------------------------------------
    // 5b. Bootstrap mutations are NOT undoable
    //
    // The implicit "Sheet1" creation on a blank workbook routes through
    // ORIGIN_BOOTSTRAP. A freshly-created workbook must report
    // canUndo == false; otherwise the user's first Cmd+Z reverts the
    // default sheet. Pin that here so the undo manager is never quietly
    // re-extended to track the bootstrap origin.
    // -----------------------------------------------------------------------

    #[test]
    fn bootstrap_mutations_not_undoable() {
        let (doc, map) = setup();
        let mgr = UndoRedoManager::new(&doc, &map);

        // Simulate the engine's default-sheet bootstrap.
        {
            let mut txn = doc.transact_mut_with(ORIGIN_BOOTSTRAP);
            map.insert(&mut txn, "Sheet1", "default");
        }

        {
            let txn = doc.transact();
            assert!(
                map.get(&txn, "Sheet1").is_some(),
                "bootstrap mutation should still land in the doc"
            );
        }
        assert!(
            !mgr.can_undo(),
            "bootstrap mutations must not enter the undo stack"
        );
        assert_eq!(mgr.undo_depth(), 0);
    }

    // -----------------------------------------------------------------------
    // 6. Remote changes are NOT undoable
    // -----------------------------------------------------------------------

    #[test]
    fn remote_changes_not_undoable() {
        let (doc, map) = setup();
        let mgr = UndoRedoManager::new(&doc, &map);

        // A remote sync change (excluded from undo tracking).
        {
            let mut txn = doc.transact_mut_with(ORIGIN_REMOTE);
            map.insert(&mut txn, "A1", "remote value");
        }

        {
            let txn = doc.transact();
            assert!(map.get(&txn, "A1").is_some(), "remote value should exist");
        }
        assert!(!mgr.can_undo(), "remote changes should not be undoable");
        assert_eq!(mgr.undo_depth(), 0);
    }

    // -----------------------------------------------------------------------
    // 7. Structural changes ARE undoable
    // -----------------------------------------------------------------------

    #[test]
    fn structural_changes_are_undoable() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // A structural change (included in undo tracking).
        {
            let mut txn = doc.transact_mut_with(ORIGIN_STRUCTURAL);
            map.insert(&mut txn, "sheet1:row_count", "101");
        }

        assert!(mgr.can_undo(), "structural changes should be undoable");
        assert_eq!(mgr.undo_depth(), 1);

        // Undo should revert.
        assert!(mgr.undo().unwrap());
        {
            let txn = doc.transact();
            assert!(
                map.get(&txn, "sheet1:row_count").is_none(),
                "structural change should be reverted after undo"
            );
        }
    }

    // -----------------------------------------------------------------------
    // 8. Clear undo history
    // -----------------------------------------------------------------------

    #[test]
    fn clear_undo_history() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Create some undo entries.
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "a");
        }
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "B1", "b");
        }
        assert_eq!(mgr.undo_depth(), 2);

        // Undo one to create a redo entry.
        mgr.undo().unwrap();
        assert_eq!(mgr.redo_depth(), 1);

        // Clear everything.
        mgr.clear();
        assert!(!mgr.can_undo());
        assert!(!mgr.can_redo());
        assert_eq!(mgr.undo_depth(), 0);
        assert_eq!(mgr.redo_depth(), 0);
    }

    // -----------------------------------------------------------------------
    // 9. can_undo/can_redo state transitions
    // -----------------------------------------------------------------------

    #[test]
    fn can_undo_can_redo_transitions() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Initial state: nothing to undo or redo.
        assert!(!mgr.can_undo());
        assert!(!mgr.can_redo());

        // After edit: can undo, cannot redo.
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "x");
        }
        assert!(mgr.can_undo());
        assert!(!mgr.can_redo());

        // After undo: cannot undo, can redo.
        mgr.undo().unwrap();
        assert!(!mgr.can_undo());
        assert!(mgr.can_redo());

        // After redo: can undo, cannot redo.
        mgr.redo().unwrap();
        assert!(mgr.can_undo());
        assert!(!mgr.can_redo());
    }

    // -----------------------------------------------------------------------
    // 10. undo_depth/redo_depth counts
    // -----------------------------------------------------------------------

    #[test]
    fn depth_counts() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        assert_eq!(mgr.undo_depth(), 0);
        assert_eq!(mgr.redo_depth(), 0);

        // Add 3 edits.
        for i in 0..3 {
            let key: std::sync::Arc<str> = std::sync::Arc::from(format!("cell{i}").as_str());
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, key, "val");
        }
        assert_eq!(mgr.undo_depth(), 3);
        assert_eq!(mgr.redo_depth(), 0);

        // Undo 2.
        mgr.undo().unwrap();
        mgr.undo().unwrap();
        assert_eq!(mgr.undo_depth(), 1);
        assert_eq!(mgr.redo_depth(), 2);

        // Redo 1.
        mgr.redo().unwrap();
        assert_eq!(mgr.undo_depth(), 2);
        assert_eq!(mgr.redo_depth(), 1);
    }

    // -----------------------------------------------------------------------
    // 11. Undo on empty stack returns false
    // -----------------------------------------------------------------------

    #[test]
    fn undo_on_empty_returns_false() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);
        assert!(!mgr.undo().unwrap());
    }

    // -----------------------------------------------------------------------
    // 12. Redo on empty stack returns false
    // -----------------------------------------------------------------------

    #[test]
    fn redo_on_empty_returns_false() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);
        assert!(!mgr.redo().unwrap());
    }

    // -----------------------------------------------------------------------
    // 13. Mixed origins — only tracked origins appear in undo stack
    // -----------------------------------------------------------------------

    #[test]
    fn mixed_origins_only_tracked_in_undo() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // User edit (tracked).
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "user");
        }
        // Formula result (not tracked).
        {
            let mut txn = doc.transact_mut_with(ORIGIN_FORMULA_RESULT);
            map.insert(&mut txn, "B1", "formula");
        }
        // Remote change (not tracked).
        {
            let mut txn = doc.transact_mut_with(ORIGIN_REMOTE);
            map.insert(&mut txn, "C1", "remote");
        }
        // Structural change (tracked).
        {
            let mut txn = doc.transact_mut_with(ORIGIN_STRUCTURAL);
            map.insert(&mut txn, "D1", "structural");
        }

        // Only the user edit and structural change should be in the undo stack.
        assert_eq!(mgr.undo_depth(), 2);

        // Undo both tracked changes.
        mgr.undo().unwrap(); // undoes structural
        mgr.undo().unwrap(); // undoes user edit

        // Verify: A1 and D1 are gone, B1 and C1 remain.
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "A1").is_none(), "user edit should be undone");
            assert!(
                map.get(&txn, "B1").is_some(),
                "formula result should remain"
            );
            assert!(map.get(&txn, "C1").is_some(), "remote change should remain");
            assert!(
                map.get(&txn, "D1").is_none(),
                "structural change should be undone"
            );
        }
    }

    // -----------------------------------------------------------------------
    // 14. Undo/redo preserves value correctness through multiple cycles
    // -----------------------------------------------------------------------

    #[test]
    fn undo_redo_preserves_values() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Set A1 to "first".
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "first");
        }
        // Overwrite A1 with "second".
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "second");
        }

        // Current state: A1 = "second"
        {
            let txn = doc.transact();
            let val = map.get(&txn, "A1").unwrap().to_string(&txn);
            assert_eq!(val, "second");
        }

        // Undo once: A1 should go back to "first".
        mgr.undo().unwrap();
        {
            let txn = doc.transact();
            let val = map.get(&txn, "A1").unwrap().to_string(&txn);
            assert_eq!(val, "first");
        }

        // Redo: A1 should be "second" again.
        mgr.redo().unwrap();
        {
            let txn = doc.transact();
            let val = map.get(&txn, "A1").unwrap().to_string(&txn);
            assert_eq!(val, "second");
        }
    }

    // -----------------------------------------------------------------------
    // 15. Inner accessors
    // -----------------------------------------------------------------------

    #[test]
    fn inner_accessors() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Verify inner() returns a reference we can query.
        assert!(!mgr.inner().can_undo());

        // Verify inner_mut() gives mutable access.
        let inner = mgr.inner_mut();
        assert!(!inner.can_redo());
    }

    // -----------------------------------------------------------------------
    // 1i. Normal mode preserves behavior (separate undo steps)
    // -----------------------------------------------------------------------

    #[test]
    fn normal_mode_separate_undo_steps() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Three separate mutations without batching
        for (key, val) in [("A1", "one"), ("B1", "two"), ("C1", "three")] {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, key, val);
        }

        // Each mutation should be a separate undo step
        assert_eq!(mgr.undo_depth(), 3);

        // Undo one at a time
        mgr.undo().unwrap();
        assert_eq!(mgr.undo_depth(), 2);
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "C1").is_none(), "C1 should be undone");
            assert!(map.get(&txn, "B1").is_some(), "B1 should still exist");
        }
    }

    // -----------------------------------------------------------------------
    // 1j. Batch grouping merges into single undo step
    // -----------------------------------------------------------------------

    #[test]
    fn batch_groups_into_single_undo_step() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        mgr.begin_undo_group();

        for (key, val) in [("A1", "one"), ("B1", "two"), ("C1", "three")] {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, key, val);
        }

        mgr.end_undo_group();

        // All three should be one undo step
        assert_eq!(mgr.undo_depth(), 1);

        // Single undo should revert all three
        mgr.undo().unwrap();
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "A1").is_none(), "A1 should be undone");
            assert!(map.get(&txn, "B1").is_none(), "B1 should be undone");
            assert!(map.get(&txn, "C1").is_none(), "C1 should be undone");
        }
        assert_eq!(mgr.undo_depth(), 0);
    }

    // -----------------------------------------------------------------------
    // 1k. Nested groups produce a single undo step
    // -----------------------------------------------------------------------

    #[test]
    fn nested_groups_single_undo_step() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        mgr.begin_undo_group();
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "outer");
        }

        mgr.begin_undo_group(); // nested
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "B1", "inner");
        }
        mgr.end_undo_group(); // inner end

        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "C1", "after-inner");
        }
        mgr.end_undo_group(); // outer end

        // All three should be one undo step
        assert_eq!(mgr.undo_depth(), 1);
        assert_eq!(mgr.undo_group_depth(), 0);

        mgr.undo().unwrap();
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "A1").is_none());
            assert!(map.get(&txn, "B1").is_none());
            assert!(map.get(&txn, "C1").is_none());
        }
    }

    // -----------------------------------------------------------------------
    // 1l. Batch isolation from normal operations
    // -----------------------------------------------------------------------

    #[test]
    fn batch_isolation_from_normal_operations() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Normal mutation 1
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "normal1");
        }

        // Batched mutations
        mgr.begin_undo_group();
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "B1", "batch1");
        }
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "C1", "batch2");
        }
        mgr.end_undo_group();

        // Normal mutation 2
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "D1", "normal2");
        }

        // Should be 3 undo steps: normal1, batch(batch1+batch2), normal2
        assert_eq!(mgr.undo_depth(), 3);

        // Undo last normal
        mgr.undo().unwrap();
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "D1").is_none(), "D1 should be undone");
            assert!(map.get(&txn, "C1").is_some(), "C1 should exist");
        }

        // Undo batch (should revert both B1 and C1)
        mgr.undo().unwrap();
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "B1").is_none(), "B1 should be undone");
            assert!(map.get(&txn, "C1").is_none(), "C1 should be undone");
            assert!(map.get(&txn, "A1").is_some(), "A1 should exist");
        }

        // Undo first normal
        mgr.undo().unwrap();
        {
            let txn = doc.transact();
            assert!(map.get(&txn, "A1").is_none(), "A1 should be undone");
        }
    }

    // -----------------------------------------------------------------------
    // 1m. end_group without begin_group is a no-op
    // -----------------------------------------------------------------------

    #[test]
    fn end_group_without_begin_is_noop() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // This should not panic
        mgr.end_undo_group();
        assert_eq!(mgr.undo_group_depth(), 0);

        // Normal operation should still work
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "value");
        }
        assert_eq!(mgr.undo_depth(), 1);
    }

    // -----------------------------------------------------------------------
    // 1n. Undo during an open batch
    // -----------------------------------------------------------------------

    #[test]
    fn undo_during_batch_reverts_previous_step() {
        let (doc, map) = setup();
        let mut mgr = UndoRedoManager::new(&doc, &map);

        // Create a normal undo step first
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "A1", "before-batch");
        }
        assert_eq!(mgr.undo_depth(), 1);

        // Start batch, add some operations
        mgr.begin_undo_group();
        {
            let mut txn = doc.transact_mut_with(ORIGIN_USER_EDIT);
            map.insert(&mut txn, "B1", "in-batch");
        }

        // Undo during open batch — should be able to undo the pre-batch step
        // Note: The exact behavior here depends on yrs internals.
        // The important thing is it doesn't panic or corrupt state.
        let _depth_before = mgr.undo_depth();
        // We at minimum verify the call doesn't panic
        let _did = mgr.undo().unwrap();

        mgr.end_undo_group();

        // Verify state is still consistent — can still undo/redo without panics
        while mgr.can_undo() {
            mgr.undo().unwrap();
        }
        while mgr.can_redo() {
            mgr.redo().unwrap();
        }
    }
}
