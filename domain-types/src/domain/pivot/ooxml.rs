use serde::{Deserialize, Serialize};

/// Full pivot table definition — enough to reconstruct pivotTable{N}.xml.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableDef {
    pub data_on_rows: bool,
    #[serde(default)]
    pub data_caption: String,
    pub location: PivotLocationDef,
    pub fields: Vec<PivotFieldDef>,
    pub row_fields: Vec<i32>,
    pub col_fields: Vec<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub page_fields: Vec<PivotPageFieldDef>,
    pub data_fields: Vec<PivotDataFieldDef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_items: Vec<PivotRowColItem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub col_items: Vec<PivotRowColItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<PivotStyleDef>,
    /// Custom label for grand total rows/columns (OOXML `grandTotalCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grand_total_caption: Option<String>,
    /// Custom label for the row header area (OOXML `rowHeaderCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_header_caption: Option<String>,
    /// Custom label for the column header area (OOXML `colHeaderCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col_header_caption: Option<String>,
    /// Show row grand totals. Default: true (OOXML `rowGrandTotals`).
    #[serde(default = "default_true")]
    pub row_grand_totals: bool,
    /// Show column grand totals. Default: true (OOXML `colGrandTotals`).
    #[serde(default = "default_true")]
    pub col_grand_totals: bool,
    /// Classic pivot layout with grid drop zones (OOXML `gridDropZones`).
    #[serde(default)]
    pub grid_drop_zones: bool,
    /// Caption for error values (OOXML `errorCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_caption: Option<String>,
    /// Whether to show error caption (OOXML `showError`).
    #[serde(default)]
    pub show_error: bool,
    /// Caption for missing/empty values (OOXML `missingCaption`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_caption: Option<String>,
    /// Whether to show missing caption (OOXML `showMissing`). Default: true.
    #[serde(default = "default_true")]
    pub show_missing: bool,
}

/// Pivot table output location within the sheet.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotLocationDef {
    pub ref_range: String,
    pub first_header_row: u32,
    pub first_data_row: u32,
    pub first_data_col: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_per_page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols_per_page: Option<u32>,
}

/// A field in the pivot table (one per cache field).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFieldDef {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<PivotAxis>,
    #[serde(default)]
    pub data_field: bool,
    #[serde(default = "default_true")]
    pub compact: bool,
    #[serde(default = "default_true")]
    pub outline: bool,
    #[serde(default)]
    pub show_all: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_type: Option<String>,
    /// When present, the field is sorted by the aggregated values of the data field
    /// at this index (0-based into `data_fields`), not by label. Corresponds to
    /// OOXML `autoSortScope` with `field="0xFFFFFFFE"` and `<x v="N"/>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_sort_data_field: Option<u32>,
    #[serde(default = "default_true")]
    pub subtotal_top: bool,
    #[serde(default = "default_true")]
    pub default_subtotal: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subtotals: Vec<PivotFieldFunction>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<PivotFieldItem>,
}

fn default_true() -> bool {
    true
}

/// An item within a pivot field (shared item reference, subtotal, grand total, etc.).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotFieldItem {
    #[serde(default)]
    pub item_type: PivotItemType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<u32>,
    #[serde(default)]
    pub hidden: bool,
    /// Whether children are expanded (OOXML `sd` attribute). Defaults to true.
    #[serde(default = "default_true")]
    pub show_details: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s: Option<String>,
}

/// Data field — represents a value in the "Values" area.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotDataFieldDef {
    pub name: String,
    pub field_index: u32,
    #[serde(default)]
    pub function: PivotFieldFunction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_fmt_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_field: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_item: Option<u32>,
}

/// Page (filter) field definition.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotPageFieldDef {
    pub field_index: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hierarchy: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
}

/// Row or column item for pivot table layout.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotRowColItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_type: Option<PivotItemType>,
    pub x_values: Vec<Option<u32>>,
}

/// Pivot table style configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotStyleDef {
    pub name: String,
    #[serde(default)]
    pub show_row_headers: bool,
    #[serde(default)]
    pub show_col_headers: bool,
    #[serde(default)]
    pub show_row_stripes: bool,
    #[serde(default)]
    pub show_col_stripes: bool,
    #[serde(default)]
    pub show_last_column: bool,
}

/// Pivot cache source metadata — tells the writer where to read data from.
/// The actual cache data is regenerated at export time.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCacheSourceDef {
    pub cache_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sheet: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_range: Option<String>,
    /// Field (column) names from the cache definition header row.
    /// These are source metadata, not derived data.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_names: Vec<String>,
    /// Per-field shared items from the cache definition (unique values per column).
    /// Used to resolve PivotFieldItem.value indices to actual CellValues for filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_items: Vec<Vec<value_types::CellValue>>,
}

/// A parsed pivot table: unified compute + OOXML config.
///
/// This is the unit stored in `ParseOutput.pivot_tables` and Yrs sheet-level storage.
/// The compute engine reads only compute-relevant fields of `config`; the XLSX
/// writer reads both compute and OOXML fields off the same config.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPivotTable {
    /// Unified pivot table configuration (fields, placements, filters, layout,
    /// style, and OOXML attributes).
    pub config: super::config::PivotTableConfig,
    /// Initial expansion state built from OOXML `sd` (show_details) attributes.
    ///
    /// When present, this captures which row/column items were expanded vs
    /// collapsed in the source XLSX file. The TypeScript side should pass
    /// this to `pivotMaterialize()` / `pivotComputeFromSource()` on initial
    /// render so that the pivot matches the file's collapsed state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_expansion_state: Option<super::expansion::PivotExpansionState>,
}

// ============================================================================
// Enums
// ============================================================================

/// Pivot field axis placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotAxis {
    Row,
    Col,
    Page,
    Values,
}

/// Aggregation function for pivot fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotFieldFunction {
    #[default]
    Sum,
    Count,
    Average,
    Max,
    Min,
    Product,
    CountNums,
    StdDev,
    StdDevP,
    Var,
    VarP,
}

/// Pivot field item type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PivotItemType {
    #[default]
    Data,
    Default,
    Sum,
    CountA,
    Avg,
    Max,
    Min,
    Product,
    Count,
    StdDev,
    StdDevP,
    Var,
    VarP,
    Grand,
    Blank,
}
