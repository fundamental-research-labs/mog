use cell_types::CellId;
use value_types::CellValue;

/// How a range's row/column extent should be interpreted.
///
/// Normal ranges use their bounds literally. Full-column (`A:C`) and
/// full-row (`1:3`) ranges scan for actual data to determine the
/// effective bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeSpan {
    /// Use the range bounds as-is.
    Exact,
    /// The range spans full columns — discover the row extent from data.
    FullColumns,
    /// The range spans full rows — discover the column extent from data.
    FullRows,
}

/// Result of a cell relocation operation.
#[derive(Debug, Clone)]
pub struct RelocationResult {
    /// CellIds that were moved to new positions.
    pub moved_cell_ids: Vec<CellId>,
    /// `(row, col)` on the source sheet for each moved CellId, in the same
    /// order as `moved_cell_ids`. Required so the mutation handler can emit
    /// Null patches for the vacated source positions — without this, the
    /// viewport buffer keeps showing stale values until a full refresh.
    pub source_positions_vacated: Vec<(u32, u32)>,
    /// CellIds that were cleared at target (not part of the move).
    pub target_cells_cleared: Vec<CellId>,
    /// Whether the operation succeeded.
    pub success: bool,
    /// Error message if operation failed.
    pub error: Option<String>,
}

/// Cell data for iteration callbacks.
#[derive(Debug, Clone)]
pub struct IterCellData {
    pub cell_id: CellId,
    #[allow(dead_code)] // Populated for callers; engine queries serialize to JSON
    pub row: u32,
    #[allow(dead_code)] // Populated for callers; engine queries serialize to JSON
    pub col: u32,
    pub value: Option<CellValue>,
    pub formula: Option<String>,
}
