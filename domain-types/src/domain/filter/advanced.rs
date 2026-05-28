use serde::{Deserialize, Serialize};

/// CellId-backed criteria range for an in-place Advanced Filter.
///
/// The three fields are deliberately grouped so the durable filter contract
/// cannot carry partial criteria metadata. `None` means no criteria range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterCriteriaRange {
    pub sheet_id: String,
    pub start_cell_id: String,
    pub end_cell_id: String,
}

/// Advanced Filter metadata stored on canonical filter-state records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub criteria_range: Option<AdvancedFilterCriteriaRange>,
    #[serde(default)]
    pub unique_records_only: bool,
}

/// User-facing Advanced Filter mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdvancedFilterMode {
    InPlace,
    CopyTo,
}

/// Bridge/API request for Rust-backed Advanced Filter application.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterRequest {
    pub list_range: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criteria_range: Option<String>,
    pub mode: AdvancedFilterMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy_to_range: Option<String>,
    #[serde(default)]
    pub unique_records_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_id: Option<String>,
}

/// Receipt stored in `MutationResult.data` for Advanced Filter writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedFilterResult {
    pub mode: AdvancedFilterMode,
    pub list_range: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criteria_range: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_id: Option<String>,
    pub rows_matched: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_hidden: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_copied: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns_copied: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination_range: Option<String>,
}
