use super::*;

/// Statistics about the parse operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseStats {
    /// Total number of cells parsed across all sheets
    pub total_cells: u32,
    /// Total number of sheets in the workbook
    pub total_sheets: u32,
    /// Parse duration in microseconds (placeholder - timing done on JS side)
    pub parse_time_us: u32,
}
