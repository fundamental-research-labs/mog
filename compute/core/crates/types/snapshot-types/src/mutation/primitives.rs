use serde::{Deserialize, Serialize};

use cell_types::SheetId;

/// Row or column axis indicator.
///
/// Used in dimension, visibility, and grouping changes to indicate
/// whether the change applies to rows or columns.
///
/// # Examples
///
/// ```
/// use snapshot_types::Axis;
///
/// let axis = Axis::Row;
/// assert_eq!(serde_json::to_string(&axis).unwrap(), "\"row\"");
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    /// Row axis.
    Row,
    /// Column axis.
    Col,
}

/// Indicates how a domain entity changed.
///
/// Used by most domain change types (PropertyChange, DimensionChange, etc.).
/// For floating objects, use [`FloatingObjectChangeKind`] instead, which provides
/// create/update distinction and property-level change tracking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChangeKind {
    /// Entity was created or updated.
    Set,
    /// Entity was removed.
    Removed,
}

/// Richer change kind for floating objects — distinguishes create from update
/// and tracks which properties changed on updates.
///
/// # Serialization
///
/// Uses internally-tagged JSON via `#[serde(tag = "type")]`:
/// - `Created` → `{ "type": "Created" }`
/// - `Updated { changed_fields: vec!["fill"] }` → `{ "type": "Updated", "changedFields": ["fill"] }`
/// - `Removed` → `{ "type": "Removed" }`
///
/// # Changed Fields Convention
///
/// Field names in `changed_fields` use **camelCase** to match the TS `FloatingObject`
/// property names (e.g., `"anchorRow"`, `"zIndex"`, `"fill"`).
/// An empty vec means "unknown / assume everything changed" (used for bulk ops, undo replay).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FloatingObjectChangeKind {
    /// Object was newly created.
    Created,
    /// Object was updated. `changed_fields` lists the top-level camelCase property names
    /// that changed. Empty vec means "full invalidation" (backward compat for bulk ops).
    Updated { changed_fields: Vec<String> },
    /// Object was removed.
    Removed,
}
/// Undo/redo state snapshot.
///
/// Returned by `get_undo_state()` to let the UI know whether undo/redo
/// buttons should be enabled, and how deep the stacks are.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoState {
    /// Whether undo is available.
    pub can_undo: bool,
    /// Whether redo is available.
    pub can_redo: bool,
    /// Number of items in the undo stack.
    pub undo_depth: usize,
    /// Number of items in the redo stack.
    pub redo_depth: usize,
}
/// Runtime/session reconciliation hint emitted alongside sheet lifecycle mutations.
///
/// This does not persist active-sheet state in the workbook. It gives the
/// runtime owner enough information to reconcile local provider state after
/// Rust has committed sheet topology or visibility changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetLifecycleRuntimeHint {
    /// Preferred local/session focus after applying this mutation result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_sheet: Option<SheetId>,
    /// Whether provider-owned runtime state should be reconciled if stale.
    pub reconcile_provider_state: bool,
}

impl SheetLifecycleRuntimeHint {
    #[must_use]
    pub fn reconcile() -> Self {
        Self {
            active_sheet: None,
            reconcile_provider_state: true,
        }
    }

    #[must_use]
    pub fn focus(sheet_id: SheetId) -> Self {
        Self {
            active_sheet: Some(sheet_id),
            reconcile_provider_state: true,
        }
    }
}
