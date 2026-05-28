use bridge_types::DescribeSchema;
use serde::{Deserialize, Serialize};

use cell_types::SheetId;
use value_types::CellValue;

/// Parameters for Data Table calculation.
#[derive(Debug, Clone, Serialize, Deserialize, DescribeSchema)]
pub struct DataTableParams {
    /// CellId of the formula cell to evaluate.
    pub formula_cell: String,
    /// CellId of the row input cell (None for column-only tables).
    pub row_input_cell: Option<String>,
    /// CellId of the column input cell (None for row-only tables).
    pub col_input_cell: Option<String>,
    /// Input values for each row.
    pub row_values: Vec<CellValue>,
    /// Input values for each column.
    pub col_values: Vec<CellValue>,
}

/// Result of Data Table calculation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataTableResult {
    /// 2D grid of computed values. results[row][col].
    pub results: Vec<Vec<CellValue>>,
    /// Total cells computed.
    pub cell_count: u32,
    /// Whether the calculation was cancelled (reserved for future async support).
    pub cancelled: bool,
}

/// Rust bridge input for creating a persistent Data Table region.
#[derive(Debug, Clone, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDataTableInput {
    pub sheet_id: SheetId,
    /// Full anchor-inclusive user selection, including formula/header cells.
    pub table_range: String,
    /// Excel-labeled row input cell: consumes top-row values.
    #[serde(default)]
    pub row_input_cell: Option<String>,
    /// Excel-labeled column input cell: consumes left-column values.
    #[serde(default)]
    pub col_input_cell: Option<String>,
}

/// Result returned from the persistent Data Table creation mutation.
#[derive(Debug, Clone, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDataTableResult {
    pub region_id: String,
    pub table_range: String,
    pub body_range: String,
    pub row_input_cell: Option<String>,
    pub col_input_cell: Option<String>,
    pub rows_computed: u32,
    pub cols_computed: u32,
    pub cell_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DataTableLayout {
    OneVariableRow,
    OneVariableColumn,
    TwoVariable,
}
