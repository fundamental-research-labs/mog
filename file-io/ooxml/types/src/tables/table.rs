// --- Table ---

use super::{AutoFilter, SortState, TableColumn, TableStyleInfo, TableType};

/// Table definition (CT_Table).
///
/// Root element of `xl/tables/table{N}.xml`. Represents a structured table
/// within a worksheet, including columns, filters, sort state, and styling.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Table {
    /// Unique table ID (required)
    pub id: u32,
    /// Internal table name
    pub name: Option<String>,
    /// Display name shown in the UI (required)
    pub display_name: String,
    /// Comment / description
    pub comment: Option<String>,
    /// Cell range reference, e.g. "A1:D10" (required)
    pub r#ref: String,
    /// Table type
    pub table_type: TableType,
    /// Number of header rows (0 = no header)
    pub header_row_count: u32,
    /// Number of totals rows
    pub totals_row_count: u32,
    /// Whether the totals row is visible
    pub totals_row_shown: bool,
    /// Whether an insert row is shown
    pub insert_row: bool,
    /// Whether inserting a row shifts data down
    pub insert_row_shift: bool,
    /// Whether the table is published
    pub published: bool,
    /// DXF ID for header row formatting
    pub header_row_dxf_id: Option<u32>,
    /// DXF ID for data area formatting
    pub data_dxf_id: Option<u32>,
    /// DXF ID for totals row formatting
    pub totals_row_dxf_id: Option<u32>,
    /// DXF ID for header row border
    pub header_row_border_dxf_id: Option<u32>,
    /// DXF ID for table border
    pub table_border_dxf_id: Option<u32>,
    /// DXF ID for totals row border
    pub totals_row_border_dxf_id: Option<u32>,
    /// Cell style for the header row
    pub header_row_cell_style: Option<String>,
    /// Cell style for data cells
    pub data_cell_style: Option<String>,
    /// Cell style for the totals row
    pub totals_row_cell_style: Option<String>,
    /// Connection ID for external data
    pub connection_id: Option<u32>,
    /// Auto-filter definition
    pub auto_filter: Option<AutoFilter>,
    /// Sort state
    pub sort_state: Option<SortState>,
    /// Table columns
    pub table_columns: Vec<TableColumn>,
    /// Table style info
    pub table_style_info: Option<TableStyleInfo>,
}

impl Default for Table {
    fn default() -> Self {
        Self {
            id: 0,
            name: None,
            display_name: String::new(),
            comment: None,
            r#ref: String::new(),
            table_type: TableType::Worksheet,
            header_row_count: 1,
            totals_row_count: 0,
            totals_row_shown: true,
            insert_row: false,
            insert_row_shift: false,
            published: false,
            header_row_dxf_id: None,
            data_dxf_id: None,
            totals_row_dxf_id: None,
            header_row_border_dxf_id: None,
            table_border_dxf_id: None,
            totals_row_border_dxf_id: None,
            header_row_cell_style: None,
            data_cell_style: None,
            totals_row_cell_style: None,
            connection_id: None,
            auto_filter: None,
            sort_state: None,
            table_columns: Vec::new(),
            table_style_info: None,
        }
    }
}
