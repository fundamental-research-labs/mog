//! Read-side pivot table and cache domain model.

/// A complete pivot table definition
#[derive(Debug, Clone)]
pub struct PivotTable {
    /// Name of the pivot table
    pub name: String,
    /// Cache ID linking to the pivot cache
    pub cache_id: u32,
    /// Whether data fields are on rows (true) or columns (false)
    pub data_on_rows: bool,
    /// Location of the pivot table in the worksheet
    pub location: PivotLocation,
    /// Row fields in the pivot table
    pub row_fields: Vec<PivotFieldRef>,
    /// Column fields in the pivot table
    pub col_fields: Vec<PivotFieldRef>,
    /// Data (value) fields in the pivot table
    pub data_fields: Vec<DataField>,
    /// Page (filter) fields in the pivot table
    pub page_fields: Vec<PageField>,
    /// Row items describing rendered pivot layout.
    pub row_items: Vec<PivotRowColItem>,
    /// Column items describing rendered pivot layout.
    pub col_items: Vec<PivotRowColItem>,
    /// Pivot field definitions
    pub pivot_fields: Vec<PivotField>,
    /// Style information
    pub style_info: Option<PivotStyleInfo>,
    /// Custom label for grand total rows/columns (OOXML `grandTotalCaption`).
    pub grand_total_caption: Option<String>,
    /// Custom label for the row header area (OOXML `rowHeaderCaption`).
    pub row_header_caption: Option<String>,
    /// Custom label for the column header area (OOXML `colHeaderCaption`).
    pub col_header_caption: Option<String>,
    /// Show row grand totals (OOXML `rowGrandTotals`). Default: true.
    pub row_grand_totals: bool,
    /// Show column grand totals (OOXML `colGrandTotals`). Default: true.
    pub col_grand_totals: bool,
    /// Classic pivot layout with grid drop zones (OOXML `gridDropZones`).
    pub grid_drop_zones: bool,
    /// Caption for error values (OOXML `errorCaption`).
    pub error_caption: Option<String>,
    /// Whether to show error caption (OOXML `showError`).
    pub show_error: bool,
    /// Caption for missing values (OOXML `missingCaption`).
    pub missing_caption: Option<String>,
    /// Whether to show missing caption (OOXML `showMissing`). Default: true.
    pub show_missing: bool,
    /// Writer-only OOXML preservation state for imported pivot table details.
    pub ooxml_preservation: domain_types::domain::pivot::PivotTableOoxmlPreservation,
}

impl Default for PivotTable {
    fn default() -> Self {
        Self {
            name: String::new(),
            cache_id: 0,
            data_on_rows: false,
            location: PivotLocation::default(),
            row_fields: Vec::new(),
            col_fields: Vec::new(),
            data_fields: Vec::new(),
            page_fields: Vec::new(),
            row_items: Vec::new(),
            col_items: Vec::new(),
            pivot_fields: Vec::new(),
            style_info: None,
            grand_total_caption: None,
            row_header_caption: None,
            col_header_caption: None,
            row_grand_totals: true,
            col_grand_totals: true,
            grid_drop_zones: false,
            error_caption: None,
            show_error: false,
            missing_caption: None,
            show_missing: true,
            ooxml_preservation: Default::default(),
        }
    }
}

/// Location of the pivot table in the worksheet
#[derive(Debug, Clone, Default)]
pub struct PivotLocation {
    /// Cell reference range as a typed [`compute_parser::RangeRef`].
    pub ref_: Option<compute_parser::RangeRef>,
    /// First row of the header
    pub first_header_row: u32,
    /// First row of data
    pub first_data_row: u32,
    /// First column of data
    pub first_data_col: u32,
    /// Number of rows per page (for page wrap)
    pub rows_per_page: u32,
    /// Number of columns per page (for page wrap)
    pub cols_per_page: u32,
}

/// Reference to a field in the pivot table
#[derive(Debug, Clone, Default)]
pub struct PivotFieldRef {
    /// Field index (-2 means data field placeholder)
    pub x: i32,
}

/// Pivot field definition
#[derive(Debug, Clone, Default)]
pub struct PivotField {
    /// Field index
    pub index: u32,
    /// Field name (optional, may come from cache)
    pub name: Option<String>,
    /// Axis where this field is used
    pub axis: Option<PivotAxis>,
    /// Items in this field
    pub items: Vec<PivotItem>,
    /// Whether subtotals appear at top
    pub subtotal_top: bool,
    /// Whether to show all items
    pub show_all: Option<bool>,
    /// Sort type
    pub sort_type: Option<SortType>,
    /// When present, sort is by aggregated values of this data field index.
    pub auto_sort_data_field: Option<u32>,
    /// Column field index from autoSortScope second reference.
    pub auto_sort_column_field: Option<u32>,
    /// Column item index from autoSortScope second reference.
    pub auto_sort_column_item: Option<u32>,
    /// Whether this field is a data field
    pub data_field: bool,
    /// Default subtotal function
    pub default_subtotal: bool,
    /// Compact display
    pub compact: bool,
    /// Outline display
    pub outline: bool,
    /// Explicit subtotal functions represented by pivotField subtotal attributes.
    pub subtotals: Vec<Subtotal>,
}

/// Axis types for pivot fields
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PivotAxis {
    /// Row axis
    Row,
    /// Column axis
    Col,
    /// Page (filter) axis
    Page,
    /// Values axis
    Values,
}

/// Sort types for pivot fields
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortType {
    /// No sorting
    Manual,
    /// Ascending sort
    Ascending,
    /// Descending sort
    Descending,
}

/// Item within a pivot field
#[derive(Debug, Clone, Default)]
pub struct PivotItem {
    /// Item type
    pub item_type: PivotItemType,
    /// Index into shared items (for data items)
    pub x: Option<u32>,
    /// Whether this item is hidden
    pub hidden: bool,
    /// Whether to show details (expand children). Defaults to true when absent.
    pub show_details: bool,
    /// String value for calculated items
    pub s: Option<String>,
}

/// Types of pivot items
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PivotItemType {
    /// Regular data item
    #[default]
    Data,
    /// Default (automatic) item
    Default,
    /// Sum subtotal
    Sum,
    /// Count A subtotal
    CountA,
    /// Average subtotal
    Avg,
    /// Max subtotal
    Max,
    /// Min subtotal
    Min,
    /// Product subtotal
    Product,
    /// Count subtotal
    Count,
    /// Standard deviation subtotal
    Stddev,
    /// Standard deviation P subtotal
    StddevP,
    /// Variance subtotal
    Var,
    /// Variance P subtotal
    VarP,
    /// Grand total
    Grand,
    /// Blank item
    Blank,
}

/// Data field in a pivot table
#[derive(Debug, Clone, Default)]
pub struct DataField {
    /// Display name for the data field
    pub name: Option<String>,
    /// Index of the source field
    pub field_index: u32,
    /// Subtotal function
    pub subtotal: Subtotal,
    /// Number format ID
    pub num_fmt_id: Option<u32>,
    /// Base field for calculations
    pub base_field: Option<i32>,
    /// Base item for calculations
    pub base_item: Option<u32>,
    /// Show data as transformation (e.g. "percentOfTotal", "difference")
    pub show_data_as: Option<String>,
}

/// Subtotal/aggregation functions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Subtotal {
    /// Sum of values
    #[default]
    Sum,
    /// Count of values
    Count,
    /// Average of values
    Average,
    /// Maximum value
    Max,
    /// Minimum value
    Min,
    /// Product of values
    Product,
    /// Count of numbers
    CountNums,
    /// Standard deviation
    StdDev,
    /// Standard deviation (population)
    StdDevP,
    /// Variance
    Var,
    /// Variance (population)
    VarP,
}

/// Page (filter) field
#[derive(Debug, Clone, Default)]
pub struct PageField {
    /// Field index
    pub field_index: i32,
    /// Selected item index (None means "All")
    pub item: Option<u32>,
    /// Hierarchy index for OLAP
    pub hierarchy: Option<i32>,
    /// Name (for OLAP)
    pub name: Option<String>,
    /// Caption (display name)
    pub caption: Option<String>,
}

/// Row or column layout item in the rendered pivot table.
#[derive(Debug, Clone, Default)]
pub struct PivotRowColItem {
    /// Optional item type.
    pub item_type: Option<PivotItemType>,
    /// Field/item references (`<x>` children); `None` means a default `<x/>`.
    pub x_values: Vec<Option<u32>>,
}

/// Style information for pivot table
#[derive(Debug, Clone, Default)]
pub struct PivotStyleInfo {
    /// Style name
    pub name: Option<String>,
    /// Whether to show row headers
    pub show_row_headers: bool,
    /// Whether to show column headers
    pub show_col_headers: bool,
    /// Whether to show row stripes
    pub show_row_stripes: bool,
    /// Whether to show column stripes
    pub show_col_stripes: bool,
    /// Whether to show last column
    pub show_last_column: bool,
}

/// Pivot cache definition
#[derive(Debug, Clone, Default)]
pub struct PivotCache {
    /// Cache ID
    pub id: u32,
    /// Source type for the cache
    pub source_type: CacheSourceType,
    /// Source reference (worksheet range)
    pub source_ref: Option<String>,
    /// Source worksheet name
    pub source_sheet: Option<String>,
    /// Named range/table source
    pub source_name: Option<String>,
    /// Relationship ID for external worksheet sources.
    pub source_r_id: Option<String>,
    /// Field definitions in the cache
    pub fields: Vec<CacheField>,
    /// Cached records
    pub records: Vec<CacheRecord>,
    /// Record count
    pub record_count: Option<u32>,
    /// Whether the cache is refreshed on load
    pub refresh_on_load: bool,
}

/// Source types for pivot cache
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CacheSourceType {
    /// Worksheet range
    #[default]
    Worksheet,
    /// External data source
    External,
    /// Consolidation of multiple ranges
    Consolidation,
    /// Scenario
    Scenario,
}

/// Field definition in pivot cache
#[derive(Debug, Clone, Default)]
pub struct CacheField {
    /// Field name
    pub name: String,
    /// Shared items (unique values)
    pub shared_items: Vec<SharedItem>,
    /// Number format ID
    pub num_fmt_id: Option<u32>,
    /// SQL data type
    pub sql_type: Option<i32>,
    /// Whether field contains dates
    pub contains_date: bool,
    /// Whether field contains numbers
    pub contains_number: bool,
    /// Whether field contains integers
    pub contains_integer: bool,
    /// Whether field contains blank values
    pub contains_blank: bool,
    /// Whether field contains mixed types
    pub contains_mixed_types: bool,
    /// Caption (display name)
    pub caption: Option<String>,
}

/// Shared item values in cache field
#[derive(Debug, Clone, PartialEq)]
pub enum SharedItem {
    /// String value
    String(String),
    /// Numeric value
    Number(f64),
    /// Boolean value
    Boolean(bool),
    /// Error value
    Error(String),
    /// Date/time value (ISO 8601 format)
    DateTime(String),
    /// Missing/blank value
    Missing,
}

impl Default for SharedItem {
    fn default() -> Self {
        SharedItem::Missing
    }
}

/// Cache record (row of cached data)
#[derive(Debug, Clone, Default)]
pub struct CacheRecord {
    /// Values in this record (indices into shared items or inline values)
    pub values: Vec<CacheRecordValue>,
}

/// Value in a cache record
#[derive(Debug, Clone, PartialEq)]
pub enum CacheRecordValue {
    /// Index into shared items
    Index(u32),
    /// Inline number
    Number(f64),
    /// Inline string
    String(String),
    /// Inline boolean
    Boolean(bool),
    /// Inline error
    Error(String),
    /// Inline date
    DateTime(String),
    /// Missing value
    Missing,
}

impl Default for CacheRecordValue {
    fn default() -> Self {
        CacheRecordValue::Missing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_table_default_preserves_read_contract() {
        let pivot = PivotTable::default();

        assert!(pivot.name.is_empty());
        assert_eq!(pivot.cache_id, 0);
        assert!(!pivot.data_on_rows);
        assert!(pivot.row_grand_totals);
        assert!(pivot.col_grand_totals);
        assert!(!pivot.grid_drop_zones);
        assert!(!pivot.show_error);
        assert!(pivot.show_missing);
        assert!(pivot.grand_total_caption.is_none());
        assert!(pivot.row_header_caption.is_none());
        assert!(pivot.col_header_caption.is_none());
        assert!(pivot.error_caption.is_none());
        assert!(pivot.missing_caption.is_none());
    }

    #[test]
    fn pivot_location_default_has_no_typed_ref() {
        let loc = PivotLocation::default();

        assert!(loc.ref_.is_none());
        assert_eq!(loc.first_header_row, 0);
        assert_eq!(loc.first_data_row, 0);
        assert_eq!(loc.first_data_col, 0);
    }

    #[test]
    fn enum_defaults_match_legacy_read_surface() {
        assert_eq!(Subtotal::default(), Subtotal::Sum);
        assert_eq!(PivotItemType::default(), PivotItemType::Data);
        assert_eq!(CacheSourceType::default(), CacheSourceType::Worksheet);
        assert_eq!(SharedItem::default(), SharedItem::Missing);
        assert_eq!(CacheRecordValue::default(), CacheRecordValue::Missing);
    }

    #[test]
    fn shared_item_variants_are_distinct() {
        assert!(matches!(
            SharedItem::String("test".to_string()),
            SharedItem::String(_)
        ));
        assert!(matches!(SharedItem::Number(42.0), SharedItem::Number(_)));
        assert!(matches!(SharedItem::Missing, SharedItem::Missing));
    }
}
