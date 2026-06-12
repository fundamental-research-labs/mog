use serde::{Deserialize, Serialize};

use super::primitives::{Axis, ChangeKind};
use cell_types::RangeId;
use domain_types::domain::slicer::{SlicerSelectionChangeType, StoredSlicer};
use value_types::CellValue;

/// Runtime operation diagnostic emitted by mutation commands that preserved
/// workbook state but could not apply the operation exactly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOperationDiagnostic {
    pub id: String,
    pub sequence: String,
    pub code: String,
    pub severity: String,
    pub recoverability: String,
    pub operation: String,
    pub sheet_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<serde_json::Value>,
}

/// Options for querying retained runtime operation diagnostics.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnosticsOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since_sequence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

/// Bounded page of runtime operation diagnostics retained by the engine.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnosticsPage {
    pub diagnostics: Vec<RuntimeOperationDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_sequence: Option<String>,
    pub truncated: bool,
}

/// A filter change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Filter ID that changed.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub filter_id: String,
    /// Filter kind (`autoFilter`, `tableFilter`, or `advancedFilter`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_kind: Option<String>,
    /// Table ID for table-owned filter changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_id: Option<String>,
    /// Capability of the filter shell when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability: Option<String>,
    /// Unsupported feature reasons when the filter shell is lossless-preserved.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unsupported_reasons: Vec<String>,
    /// Whether the filter has active runtime or lossless criteria.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_active_filter: Option<bool>,
    /// Whether the filter can be cleared through the public filter command path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clearable: Option<bool>,
    /// Runtime diagnostics associated with this filter operation.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<RuntimeOperationDiagnostic>,
    /// Semantic action (`created`, `updated`, `applied`, `cleared`, `deleted`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// Hidden row count after the operation, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden_row_count: Option<u32>,
    /// Visible row count after the operation, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_row_count: Option<u32>,
    /// Whether the filter was set or removed.
    pub kind: ChangeKind,
}

/// A table change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableChange {
    /// Table name.
    pub name: String,
    /// Stable Mog table ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_id: Option<String>,
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether the table was created/updated or removed.
    pub kind: ChangeKind,
}

/// Slicer mutation category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlicerChangeKind {
    Created,
    Updated,
    Deleted,
    SelectionChanged,
}

/// Slicer source kind projected for public event payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlicerSourceType {
    Table,
    Pivot,
}

/// A slicer lifecycle/config/selection change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerChange {
    pub sheet_id: String,
    pub slicer_id: String,
    pub kind: SlicerChangeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_type: Option<SlicerSourceType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub updated_fields: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_values: Option<Vec<CellValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_change_type: Option<SlicerSelectionChangeType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<StoredSlicer>,
}
/// A conditional format rule change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether the rule was set or removed.
    pub kind: ChangeKind,
    /// Rule ID or index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
}

/// A named range change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedRangeChange {
    /// Named range name.
    pub name: String,
    /// Whether the named range was set or removed.
    pub kind: ChangeKind,
}

/// A pivot table change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Pivot table ID.
    pub pivot_id: String,
    /// Whether the pivot table was set or removed.
    pub kind: ChangeKind,
}

/// A grouping change (row/col outline groups).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupingChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether this change applies to rows or columns.
    pub axis: Axis,
    /// Whether the grouping was set or removed.
    pub kind: ChangeKind,
}
/// The type of structural change (insert/delete rows/cols).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StructureChangeType {
    InsertRows,
    DeleteRows,
    InsertCols,
    DeleteCols,
}

/// A structural change result (row/col insert or delete).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureChangeResult {
    pub sheet_id: String,
    pub change_type: StructureChangeType,
    pub at: u32,
    pub count: u32,
}

/// A sorting change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortingChange {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Whether the sort was applied or removed.
    pub kind: ChangeKind,
    /// First row of the sorted range.
    pub start_row: u32,
    /// First column of the sorted range.
    pub start_col: u32,
    /// Last row of the sorted range.
    pub end_row: u32,
    /// Last column of the sorted range.
    pub end_col: u32,
    /// Number of rows that were repositioned.
    pub rows_moved: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum RangeChangeKind {
    Created,
    Removed,
    Replaced,
    Reformatted,
    Bound,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeChange {
    pub sheet_id: String,
    pub range_id: RangeId,
    pub kind: RangeChangeKind,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
}
