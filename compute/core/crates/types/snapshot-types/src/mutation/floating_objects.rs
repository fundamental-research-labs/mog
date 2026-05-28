use serde::{Deserialize, Serialize};

use super::primitives::FloatingObjectChangeKind;
use domain_types::domain::floating_object::{FloatingObject, FloatingObjectKind};
use value_types::FiniteF64;

/// Absolute pixel coordinates in sheet space, computed from LayoutIndex (Fenwick tree).
/// Not to be confused with SerializedFloatingObject.x/y which are anchor-relative offsets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingObjectBounds {
    pub x: FiniteF64,
    pub y: FiniteF64,
    pub width: FiniteF64,
    pub height: FiniteF64,
    pub rotation: FiniteF64,
}

/// A floating object change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingObjectChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Object ID (or group ID).
    pub object_id: String,
    /// How the floating object changed — created, updated (with changed fields), or removed.
    pub kind: FloatingObjectChangeKind,
    /// The type of the floating object (e.g. "shape", "picture", "chart").
    /// Always populated so that deletion events carry the correct type even
    /// when `data` is `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_type: Option<FloatingObjectKind>,
    /// Full floating object payload (when available).
    /// Allows the TS consumer to update stores directly without
    /// a re-read round-trip back to Rust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<FloatingObject>,
    /// Pre-computed pixel bounds from LayoutIndex. Present when the mutation
    /// affects object position/size and the layout is available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<FloatingObjectBounds>,
}
