use serde::{Deserialize, Serialize};

use value_types::CellValue;

/// State of a slicer item in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlicerItemState {
    /// Item is selected (filter active, this value included).
    Selected,
    /// Item is available but not selected.
    Available,
    /// Item has no matching data (hidden by other filters).
    Unavailable,
    /// Item has no data at all (e.g. column is empty or slicer is disconnected).
    #[serde(rename = "noData")]
    NoData,
}

/// A slicer item for UI display.
///
/// This maps from `SlicerCacheItem` (table-engine) to the UI representation
/// used by the slicer component.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerItem {
    /// The cell value.
    pub value: CellValue,
    /// Display text for the item.
    pub display_text: String,
    /// Current state of the item.
    pub state: SlicerItemState,
    /// Number of matching rows (absent when state is `NoData`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}

/// Type of slicer selection change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SlicerSelectionChangeType {
    /// Values were selected.
    Select,
    /// A single value was toggled.
    Toggle,
    /// Selection was cleared (show all).
    Clear,
    /// Selection was synchronized from another source.
    Sync,
}
