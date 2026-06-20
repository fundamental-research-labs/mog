//! Pivot table computation — stateless, no engine instance needed.

// Re-export the types consumers need
pub use compute_core::CellValue;
pub use compute_core::pivot::types::{
    PivotError, PivotExpansionState, PivotField, PivotTableResult,
};
pub use domain_types::domain::pivot::PivotTableConfig;

/// Compute a pivot table from the given configuration and data.
pub fn compute(
    config: PivotTableConfig,
    data: Vec<Vec<CellValue>>,
    expansion_state: Option<PivotExpansionState>,
) -> Result<PivotTableResult, PivotError> {
    compute_core::bridge_pure::PivotBridge::pivot_compute(config, data, expansion_state)
}

/// Compute a pivot table with ShowValuesAs post-processing.
pub fn compute_with_show_values_as(
    config: PivotTableConfig,
    data: Vec<Vec<CellValue>>,
    expansion_state: Option<PivotExpansionState>,
) -> Result<PivotTableResult, PivotError> {
    compute_core::bridge_pure::PivotBridge::pivot_compute_with_show_values_as(
        config,
        data,
        expansion_state,
    )
}

/// Detect field metadata from source data (first row = headers).
pub fn detect_fields(data: Vec<Vec<CellValue>>) -> Vec<PivotField> {
    compute_core::bridge_pure::PivotBridge::pivot_detect_fields(data)
}

/// Validate a pivot config and return error messages.
pub fn validate_config(config: PivotTableConfig) -> Vec<String> {
    compute_core::bridge_pure::PivotBridge::pivot_validate_config(config)
}

/// Drill down into a specific pivot cell to get source row indices.
pub fn drill_down(
    config: PivotTableConfig,
    data: Vec<Vec<CellValue>>,
    row_key: &str,
    column_key: &str,
) -> Result<Vec<u32>, PivotError> {
    compute_core::bridge_pure::PivotBridge::pivot_drill_down(config, data, row_key, column_key)
}
