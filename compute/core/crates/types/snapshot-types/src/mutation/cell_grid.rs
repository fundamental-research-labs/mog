use serde::{Deserialize, Serialize};

use super::primitives::{Axis, ChangeKind};
use crate::queries::CellPosition;
use value_types::FiniteF64;

/// A cell property/format change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Cell ID as UUID string.
    pub cell_id: String,
    /// Resolved cell position, or `None` if the position could not be resolved.
    /// Consumers MUST check for `None` and skip the change rather than falling
    /// back to a default position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<CellPosition>,
    /// Whether the property was set or removed.
    pub kind: ChangeKind,
    /// Full new format (None if removed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<serde_json::Value>,
}

/// A row or column dimension change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether this change applies to rows or columns.
    pub axis: Axis,
    /// Row or column index (zero-based).
    pub index: u32,
    /// Whether the dimension was set or removed.
    pub kind: ChangeKind,
    /// New height/width in pixels (None if removed/reset to default or non-finite).
    /// Wire shape: present, possibly null. Do NOT add `skip_serializing_if` —
    /// the wire shape is "present, possibly null" per nullable-boundary wire decision.
    #[serde(default)]
    pub size: Option<FiniteF64>,
}

/// A merge region change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether the merge was created or removed.
    pub kind: ChangeKind,
    /// Start row of the merge region (zero-based).
    pub start_row: u32,
    /// Start column of the merge region (zero-based).
    pub start_col: u32,
    /// End row of the merge region (zero-based, inclusive).
    pub end_row: u32,
    /// End column of the merge region (zero-based, inclusive).
    pub end_col: u32,
}

/// A row/column visibility change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibilityChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether this change applies to rows or columns.
    pub axis: Axis,
    /// Row or column index (zero-based).
    pub index: u32,
    /// Whether the row/column is now hidden.
    pub hidden: bool,
}

/// A comment change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Cell ID as UUID string.
    pub cell_id: String,
    /// Resolved cell position, or `None` if the position could not be resolved.
    /// Consumers MUST check for `None` and skip the change rather than falling
    /// back to a default position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<CellPosition>,
    /// Whether the comment was set or removed.
    pub kind: ChangeKind,
}
/// A sparkline change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Cell ID as UUID string.
    pub cell_id: String,
    /// Resolved cell position, or `None` if the position could not be resolved.
    /// Consumers MUST check for `None` and skip the change rather than falling
    /// back to a default position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<CellPosition>,
    /// Whether the sparkline was set or removed.
    pub kind: ChangeKind,
}
