// ============================================================================
// XmlColumnPr -- CT_XmlColumnPr
// ============================================================================

use super::{TableFormula, TotalsRowFunction};

/// XML column properties for XML-mapped table columns (CT_XmlColumnPr).
///
/// Used when a table column is mapped to an XML data source.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct XmlColumnPr {
    /// XPath expression for the XML mapping.
    pub map_id: u32,
    /// XPath string to the mapped XML element/attribute.
    pub xpath: String,
    /// Whether this column's data is denormalized. Default: `false`.
    pub denormalized: bool,
    /// XML data type string.
    pub xml_data_type: String,
    /// Unsupported extension-list payload owned by this XML-column mapping.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

// --- TableColumn ---

/// A single column within a table (CT_TableColumn).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TableColumn {
    /// Unique column ID within the table (required)
    pub id: u32,
    /// Optional unique name for query-table columns
    pub unique_name: Option<String>,
    /// Display name / header text (required)
    pub name: String,
    /// Function for the totals row
    pub totals_row_function: TotalsRowFunction,
    /// Label for the totals row (alternative to function)
    pub totals_row_label: Option<String>,
    /// Query table field ID
    pub query_table_field_id: Option<u32>,
    /// DXF ID for the header row cell
    pub header_row_dxf_id: Option<u32>,
    /// DXF ID for data cells
    pub data_dxf_id: Option<u32>,
    /// DXF ID for the totals row cell
    pub totals_row_dxf_id: Option<u32>,
    /// Cell style for the header row
    pub header_row_cell_style: Option<String>,
    /// Cell style for data cells
    pub data_cell_style: Option<String>,
    /// Cell style for the totals row
    pub totals_row_cell_style: Option<String>,
    /// Calculated column formula
    pub calculated_column_formula: Option<TableFormula>,
    /// Totals row formula
    pub totals_row_formula: Option<TableFormula>,
    /// XML column properties for XML-mapped tables (optional).
    pub xml_column_pr: Option<XmlColumnPr>,
    /// Extension UID for revision tracking (xr3:uid attribute).
    pub xr3_uid: Option<String>,
}

impl Default for TableColumn {
    fn default() -> Self {
        Self {
            id: 0,
            unique_name: None,
            name: String::new(),
            totals_row_function: TotalsRowFunction::None,
            totals_row_label: None,
            query_table_field_id: None,
            header_row_dxf_id: None,
            data_dxf_id: None,
            totals_row_dxf_id: None,
            header_row_cell_style: None,
            data_cell_style: None,
            totals_row_cell_style: None,
            calculated_column_formula: None,
            totals_row_formula: None,
            xml_column_pr: None,
            xr3_uid: None,
        }
    }
}
