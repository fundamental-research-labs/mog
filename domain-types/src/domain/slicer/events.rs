use serde::{Deserialize, Serialize};

/// Internal reason code for slicer cache invalidation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlicerInvalidationReason {
    /// Underlying data cells changed.
    DataChanged,
    /// A filter was applied/removed.
    FilterChanged,
    /// Table/pivot structure changed.
    StructureChanged,
}

/// Contract event reason code for cache invalidation (for IPC/events).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CacheInvalidationEventReason {
    /// Cells changed.
    CellsChanged,
    /// Filter applied.
    FilterApplied,
    /// Table structure changed.
    TableStructureChanged,
    /// Pivot table updated.
    PivotUpdated,
}

/// Internal reason code for slicer disconnection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlicerDisconnectionReason {
    /// Source column was deleted.
    ColumnDeleted,
    /// Source table was deleted.
    TableDeleted,
    /// Source pivot table was deleted.
    PivotDeleted,
}

/// Contract event reason code for disconnection (for IPC/events).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DisconnectionEventReason {
    /// Column was deleted.
    ColumnDeleted,
    /// Table was deleted.
    TableDeleted,
    /// Pivot table was deleted.
    PivotDeleted,
}
