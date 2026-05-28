//! # Undo/Redo Manager
//!
//! Wraps `yrs::undo::UndoManager` with a spreadsheet-aware API that distinguishes
//! between user edits, UI/view state, formula results, structural changes, and
//! remote changes.
//!
//! Only user edits and structural changes are undoable. Formula recalculation
//! results, local UI/view state, and remote changes are excluded from the undo
//! stack because they are consequences of other operations or navigation state,
//! not document edits.
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

mod clock;
mod manager;
mod origin;
mod poll;

#[cfg(test)]
mod tests;

pub use manager::UndoRedoManager;
pub use origin::{
    ORIGIN_BOOTSTRAP, ORIGIN_FORMULA_RESULT, ORIGIN_REMOTE, ORIGIN_STRUCTURAL, ORIGIN_UI_STATE,
    ORIGIN_USER_EDIT,
};
