use super::*;

/// Parsed cell range with 0-based coordinates.
///
/// Matches the TypeScript `CellRange` interface:
/// `{ startRow: number, startCol: number, endRow: number, endCol: number }`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCellRange {
    /// Start row (0-based)
    pub start_row: u32,
    /// Start column (0-based)
    pub start_col: u32,
    /// End row (0-based, inclusive)
    pub end_row: u32,
    /// End column (0-based, inclusive)
    pub end_col: u32,
}

/// Parsed table column.
///
/// Matches the TypeScript `TableColumn` interface (subset):
/// `{ id: number, name: string }`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTableColumn {
    /// Column ID
    pub id: u32,
    /// Column display name
    pub name: String,
    /// Header row DXF ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_dxf_id: Option<u32>,
    /// Data body DXF ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dxf_id: Option<u32>,
    /// Totals row DXF ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_dxf_id: Option<u32>,
    /// Header row cell style name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_cell_style: Option<String>,
    /// Data cell style name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_cell_style: Option<String>,
    /// Totals row cell style name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_cell_style: Option<String>,
    /// Calculated column formula
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculated_column_formula: Option<String>,
    /// Whether calculated column formula is an array formula
    #[serde(default, skip_serializing_if = "is_false")]
    pub calculated_column_formula_array: bool,
    /// Totals row formula
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_formula: Option<String>,
    /// Whether totals row formula is an array formula
    #[serde(default, skip_serializing_if = "is_false")]
    pub totals_row_formula_array: bool,
    /// Totals row label
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_label: Option<String>,
    /// Totals row function name (e.g., "sum", "count")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_function: Option<String>,
    /// Unique name for the column (uniqueName attribute, used by query tables)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unique_name: Option<String>,
    /// Query table field ID (queryTableFieldId attribute)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_table_field_id: Option<u32>,
    /// XML column properties for XML-mapped table columns
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xml_column_pr: Option<ooxml_types::tables::XmlColumnPr>,
    /// Extension UID for revision tracking (xr3:uid)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xr3_uid: Option<String>,
}

/// A fully parsed Excel Table (ListObject).
///
/// Matches the TypeScript `Table` interface with structured fields
/// instead of raw JSON strings. The `range` field provides parsed
/// 0-based coordinates from the `ref` string (e.g., "A1:Q34").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTable {
    /// Table ID
    pub id: u32,
    /// Internal table name
    pub name: String,
    /// Display name shown to users
    pub display_name: String,
    /// Reference range string (e.g., "A1:Q34")
    #[serde(rename = "ref")]
    pub ref_range: String,
    /// Parsed range with 0-based coordinates
    pub range: ParsedCellRange,
    /// Table columns
    pub columns: Vec<ParsedTableColumn>,
    /// Whether the table has a header row
    pub has_headers: bool,
    /// Whether the table has a totals row
    pub has_totals: bool,
    /// Style preset name (e.g., "TableStyleMedium2")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_name: Option<String>,
    /// Show first column emphasis
    pub show_first_column: bool,
    /// Show last column emphasis
    pub show_last_column: bool,
    /// Show row stripes
    pub show_row_stripes: bool,
    /// Show column stripes
    pub show_column_stripes: bool,
    // DXF formatting IDs for table regions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_border_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_border_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_border_dxf_id: Option<u32>,
    // Named cell styles
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_cell_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_cell_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_cell_style: Option<String>,
    /// Auto-filter reference range
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_filter_ref: Option<String>,
    /// Auto-filter xr:uid for revision tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_filter_xr_uid: Option<String>,
    /// Raw direct-child `<extLst>` owned by the table autoFilter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter_ext_lst_raw: Option<String>,
    /// Table type (e.g., "queryTable", "xml"). None means default "worksheet".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_type: Option<String>,
    /// Whether totals row is shown (totalsRowShown attribute).
    /// None = attribute absent (OOXML default is true).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_shown: Option<bool>,
    /// Connection ID for external data sources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<u32>,
    /// Table comment attribute.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Whether to insert a blank row below table.
    #[serde(skip_serializing_if = "is_false")]
    pub insert_row: bool,
    /// Whether insert row shifts existing rows.
    #[serde(skip_serializing_if = "is_false")]
    pub insert_row_shift: bool,
    /// Whether the table is published.
    #[serde(skip_serializing_if = "is_false")]
    pub published: bool,
    /// Extension UID for revision tracking (xr:uid).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
    /// Table-level sort state (sortState element at table level, outside autoFilter).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<ParsedTableSortState>,
    /// Auto-filter column definitions (active filter criteria).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter_columns: Vec<domain_types::FilterColumnSpec>,
    /// Table-owned query table definition, when this table is backed by an
    /// external workbook connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query_table: Option<domain_types::domain::connections::QueryTable>,
    /// Imported worksheet relationship id that pointed at this table part.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_relationship_id_hint: Option<String>,
    /// Resolved imported package path for this table part.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_part_path_hint: Option<String>,
    /// Original worksheet relationship target spelling for this table part.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_relationship_target_hint: Option<String>,
}

/// Sort state for a table (simplified representation for round-trip).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTableSortState {
    /// Reference range for the sort
    pub ref_range: String,
    /// Whether the sort operates column-wise rather than row-wise.
    #[serde(default, skip_serializing_if = "is_false")]
    pub column_sort: bool,
    /// Whether sort is case sensitive
    #[serde(default, skip_serializing_if = "is_false")]
    pub case_sensitive: bool,
    /// CJK sort method.
    #[serde(default)]
    pub sort_method: domain_types::SortMethod,
    /// Sort conditions
    pub conditions: Vec<ParsedTableSortCondition>,
    /// Raw direct-child `<extLst>` owned by this sortState.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_raw: Option<String>,
}

/// A single sort condition within a table sort state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTableSortCondition {
    /// Reference range for this sort condition
    pub ref_range: String,
    /// Whether this condition sorts descending
    #[serde(default, skip_serializing_if = "is_false")]
    pub descending: bool,
    /// What to sort on: value, cell color, font color, or icon.
    #[serde(default)]
    pub sort_by: domain_types::SortConditionBy,
    /// Custom sort list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_list: Option<String>,
    /// Differential format ID for color sorts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf_id: Option<u32>,
    /// Conditional-formatting icon set for icon sorts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_set: Option<ooxml_types::cond_format::IconSetType>,
    /// Zero-based icon ID for icon sorts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_id: Option<u32>,
}

// =============================================================================
// Typed output structs (replace JSON blob strings)
// =============================================================================

/// Conditional formatting summary for parse output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfSummary {
    pub sqref: String,
    pub pivot: bool,
    pub rules_count: usize,
}

/// Data validation summary for parse output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DvSummary {
    pub sqref: String,
    #[serde(rename = "type")]
    pub validation_type: String,
    pub operator: String,
    pub allow_blank: bool,
    /// First formula/value for validation criteria
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula1: Option<String>,
    /// Second formula (for between/notBetween operators)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula2: Option<String>,
    /// Whether to show the dropdown for list validations (inverted OOXML: showDropDown="1" hides it)
    #[serde(default = "default_true")]
    pub show_dropdown: bool,
    /// Error style: "stop", "warning", or "information"
    #[serde(default)]
    pub error_style: String,
    /// Whether to show error alert
    #[serde(default)]
    pub show_error: bool,
    /// Error alert title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_title: Option<String>,
    /// Error alert message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Whether to show input prompt
    #[serde(default)]
    pub show_input: bool,
    /// Input prompt title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_title: Option<String>,
    /// Input prompt message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_message: Option<String>,
    /// IME mode for Asian locales (OOXML `imeMode`). Empty string means the
    /// attribute was absent (equivalent to the default `noControl`).
    #[serde(default)]
    pub ime_mode: String,
    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
}

fn default_true() -> bool {
    true
}
