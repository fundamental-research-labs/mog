//! Data binding domain types.
//!
//! Pure data contracts — no Yrs, no storage internals.

use serde::{Deserialize, Serialize};

/// A single column mapping within a sheet data binding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    /// The column index (0-based) where data will be written.
    pub column_index: u32,
    /// The data path to extract from the source data (e.g., "name", "items[0].value").
    pub data_path: String,
    /// Optional header text to display in the header row.
    pub header_text: Option<String>,
}

/// A sheet-level data binding configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetDataBinding {
    /// Unique binding ID (format: `sdb-<uuid>`).
    pub id: String,
    /// The sheet this binding belongs to.
    pub sheet_id: String,
    /// The connection ID that provides the data.
    pub connection_id: String,
    /// Column mappings defining where data goes.
    pub column_mappings: Vec<ColumnMapping>,
    /// Whether to automatically insert/delete rows to match data count.
    pub auto_generate_rows: bool,
    /// The row index for column headers (-1 to disable).
    pub header_row: i32,
    /// The row index where data starts.
    pub data_start_row: i32,
    /// Whether to preserve formatting in the header row on refresh.
    pub preserve_header_formatting: bool,
    /// Timestamp of the last refresh (epoch millis), if any.
    pub last_refresh: Option<i64>,
    /// Number of data rows written in the last refresh, if any.
    pub last_row_count: Option<u32>,
}

/// Options for creating a new binding (all fields optional, with defaults).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBindingOptions {
    /// Whether to automatically insert/delete rows. Default: `true`.
    pub auto_generate_rows: Option<bool>,
    /// The row index for column headers. Default: `0`.
    pub header_row: Option<i32>,
    /// The row index where data starts. Default: `1`.
    pub data_start_row: Option<i32>,
    /// Whether to preserve header formatting on refresh. Default: `true`.
    pub preserve_header_formatting: Option<bool>,
}

/// Full input for creating a new binding via the bridge API.
///
/// Combines connection/column info with optional configuration.
/// Used by the bridge layer; the storage layer uses separate params.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBindingInput {
    /// The connection ID that provides the data.
    pub connection_id: String,
    /// Column mappings defining where data goes.
    #[serde(default)]
    pub column_mappings: Vec<ColumnMapping>,
    /// Whether to automatically insert/delete rows. Default: `true`.
    pub auto_generate_rows: Option<bool>,
    /// The row index for column headers. Default: `0`.
    pub header_row: Option<i32>,
    /// The row index where data starts. Default: `1`.
    pub data_start_row: Option<i32>,
    /// Whether to preserve header formatting on refresh. Default: `true`.
    pub preserve_header_formatting: Option<bool>,
}

/// Partial updates for an existing binding.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBindingFields {
    /// Update connection ID.
    pub connection_id: Option<String>,
    /// Update column mappings.
    pub column_mappings: Option<Vec<ColumnMapping>>,
    /// Update auto-generate-rows flag.
    pub auto_generate_rows: Option<bool>,
    /// Update header row index.
    pub header_row: Option<i32>,
    /// Update data start row index.
    pub data_start_row: Option<i32>,
    /// Update preserve-header-formatting flag.
    pub preserve_header_formatting: Option<bool>,
}
