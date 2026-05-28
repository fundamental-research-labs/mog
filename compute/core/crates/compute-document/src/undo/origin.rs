use yrs::Origin;
use yrs::undo::UndoManager;

/// Origin for user-initiated edits (typing, paste, formatting, etc.).
/// Transactions with this origin are tracked by the undo manager.
pub const ORIGIN_USER_EDIT: &[u8] = b"user";

/// Origin for formula recalculation results.
/// Transactions with this origin are NOT tracked because formula results are
/// a consequence of cell edits, not user actions.
pub const ORIGIN_FORMULA_RESULT: &[u8] = b"formula";

/// Origin for local UI/navigation state (selected sheet tabs, scroll position,
/// viewport-only state).
/// Transactions with this origin are NOT tracked because these changes must not
/// clear redo for the previous document edit.
pub const ORIGIN_UI_STATE: &[u8] = b"ui";

/// Origin for structural changes (insert/delete rows/cols, rename sheet, etc.).
/// Transactions with this origin ARE tracked by the undo manager.
pub const ORIGIN_STRUCTURAL: &[u8] = b"structure";

/// Origin for remote collaboration updates (sync from another client).
/// Transactions with this origin are NOT tracked because remote changes are
/// not the local user's actions.
pub const ORIGIN_REMOTE: &[u8] = b"remote";

/// Origin for engine bootstrap mutations (e.g. the implicit "Sheet1" created
/// when starting a blank workbook). Transactions with this origin are NOT
/// tracked because bootstrap state is the empty document the user sees on open,
/// not an action they took, so it must never appear on the undo stack.
///
/// This origin is intentionally absent from the UndoManager's tracked-origin
/// set: it is the canonical, permanent way to signal "this transaction
/// belongs to engine setup, not the user."
pub const ORIGIN_BOOTSTRAP: &[u8] = b"bootstrap";

pub(in crate::undo) fn include_tracked_origins(manager: &mut UndoManager<()>) {
    manager.include_origin(Origin::from(ORIGIN_USER_EDIT));
    manager.include_origin(Origin::from(ORIGIN_STRUCTURAL));
}
