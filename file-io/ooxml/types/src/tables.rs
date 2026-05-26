//! Table types (ECMA-376 Part 1, Sections 18.3.1 & 18.5.1 -- SpreadsheetML Tables).
//!
//! Unified superset of `xlsx-parser` read-side (`tables/types.rs`, `tables/filter.rs`,
//! `tables/sort.rs`, `tables/style.rs`) and write-side (`write/tables_writer.rs`) types.
//!
//! This module provides canonical enum types and shared structs with `from_ooxml` /
//! `to_ooxml` converters (and `from_bytes` for the read-side byte-level parser) so
//! both sides share one vocabulary.

use crate::cond_format::IconSetType;
use crate::worksheet::CalendarType;

// ============================================================================
// TotalsRowFunction -- ST_TotalsRowFunction
// ============================================================================

/// Totals row function type (ST_TotalsRowFunction).
///
/// Specifies the function to apply in the totals row of a table column.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum TotalsRowFunction {
    /// No function (default)
    #[default]
    #[xml("none")]
    None,
    /// Average function
    #[xml("average")]
    Average,
    /// Count function
    #[xml("count")]
    Count,
    /// Count numbers function
    #[xml("countNums")]
    CountNums,
    /// Maximum function
    #[xml("max")]
    Max,
    /// Minimum function
    #[xml("min")]
    Min,
    /// Standard deviation function
    #[xml("stdDev")]
    StdDev,
    /// Sum function
    #[xml("sum")]
    Sum,
    /// Variance function
    #[xml("var")]
    Var,
    /// Custom formula
    #[xml("custom")]
    Custom,
}

// ============================================================================
// FilterOperator -- ST_FilterOperator
// ============================================================================

/// Filter operator type for custom filters (ST_FilterOperator).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum FilterOperator {
    /// Equal to
    #[default]
    #[xml("equal")]
    Equal,
    /// Less than
    #[xml("lessThan")]
    LessThan,
    /// Less than or equal
    #[xml("lessThanOrEqual")]
    LessThanOrEqual,
    /// Not equal
    #[xml("notEqual")]
    NotEqual,
    /// Greater than or equal
    #[xml("greaterThanOrEqual")]
    GreaterThanOrEqual,
    /// Greater than
    #[xml("greaterThan")]
    GreaterThan,
}

// ============================================================================
// DynamicFilterType -- ST_DynamicFilterType
// ============================================================================

/// Dynamic filter type (ST_DynamicFilterType).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum DynamicFilterType {
    /// No filter / null
    #[default]
    #[xml("null")]
    Null,
    /// Above average
    #[xml("aboveAverage")]
    AboveAverage,
    /// Below average
    #[xml("belowAverage")]
    BelowAverage,
    /// Tomorrow
    #[xml("tomorrow")]
    Tomorrow,
    /// Today
    #[xml("today")]
    Today,
    /// Yesterday
    #[xml("yesterday")]
    Yesterday,
    /// Next week
    #[xml("nextWeek")]
    NextWeek,
    /// This week
    #[xml("thisWeek")]
    ThisWeek,
    /// Last week
    #[xml("lastWeek")]
    LastWeek,
    /// Next month
    #[xml("nextMonth")]
    NextMonth,
    /// This month
    #[xml("thisMonth")]
    ThisMonth,
    /// Last month
    #[xml("lastMonth")]
    LastMonth,
    /// Next quarter
    #[xml("nextQuarter")]
    NextQuarter,
    /// This quarter
    #[xml("thisQuarter")]
    ThisQuarter,
    /// Last quarter
    #[xml("lastQuarter")]
    LastQuarter,
    /// Next year
    #[xml("nextYear")]
    NextYear,
    /// This year
    #[xml("thisYear")]
    ThisYear,
    /// Last year
    #[xml("lastYear")]
    LastYear,
    /// Year to date
    #[xml("yearToDate")]
    YearToDate,
    /// Q1
    #[xml("Q1")]
    Q1,
    /// Q2
    #[xml("Q2")]
    Q2,
    /// Q3
    #[xml("Q3")]
    Q3,
    /// Q4
    #[xml("Q4")]
    Q4,
    /// M1 (January)
    #[xml("M1")]
    M1,
    /// M2 (February)
    #[xml("M2")]
    M2,
    /// M3 (March)
    #[xml("M3")]
    M3,
    /// M4 (April)
    #[xml("M4")]
    M4,
    /// M5 (May)
    #[xml("M5")]
    M5,
    /// M6 (June)
    #[xml("M6")]
    M6,
    /// M7 (July)
    #[xml("M7")]
    M7,
    /// M8 (August)
    #[xml("M8")]
    M8,
    /// M9 (September)
    #[xml("M9")]
    M9,
    /// M10 (October)
    #[xml("M10")]
    M10,
    /// M11 (November)
    #[xml("M11")]
    M11,
    /// M12 (December)
    #[xml("M12")]
    M12,
}

// ============================================================================
// TableType -- ST_TableType
// ============================================================================

/// Table type (ST_TableType).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum TableType {
    /// Worksheet table (default)
    #[default]
    #[xml("worksheet")]
    Worksheet,
    /// XML mapped table
    #[xml("xml")]
    Xml,
    /// Query table
    #[xml("queryTable")]
    QueryTable,
}

// ============================================================================
// SortOrder -- ST_SortBy (read-side sort direction)
// ============================================================================

/// Sort order for filter columns (ST_SortBy).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum SortOrder {
    /// No specific sort order
    #[default]
    #[xml("none")]
    None,
    /// Sort ascending
    #[xml("ascending", alias = "asc")]
    Ascending,
    /// Sort descending
    #[xml("descending", alias = "desc")]
    Descending,
}

// ============================================================================
// SortBy -- ST_SortBy (write-side sort-by type)
// ============================================================================

/// Sort by type (ST_SortBy).
///
/// Specifies what attribute of the cell to sort by.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum SortBy {
    /// Sort by value (default)
    #[default]
    #[xml("value")]
    Value,
    /// Sort by cell color
    #[xml("cellColor")]
    CellColor,
    /// Sort by font color
    #[xml("fontColor")]
    FontColor,
    /// Sort by icon
    #[xml("icon")]
    Icon,
}

// ============================================================================
// TableStyleInfo -- CT_TableStyleInfo
// ============================================================================

/// Table style information (CT_TableStyleInfo).
///
/// Shared by both the read and write paths.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct TableStyleInfo {
    /// Name of the table style (e.g., "TableStyleMedium9")
    pub name: Option<String>,
    /// Show first column formatting
    pub show_first_column: bool,
    /// Show last column formatting
    pub show_last_column: bool,
    /// Show row stripes
    pub show_row_stripes: bool,
    /// Show column stripes
    pub show_column_stripes: bool,
}

impl TableStyleInfo {
    /// Create a new table style with the given name and default options.
    #[must_use]
    pub fn new(name: &str) -> Self {
        Self {
            name: Some(name.to_string()),
            show_first_column: false,
            show_last_column: false,
            show_row_stripes: true,
            show_column_stripes: false,
        }
    }
}

// ============================================================================
// DateTimeGrouping -- ST_DateTimeGrouping
// ============================================================================

/// Date/time grouping granularity (ST_DateTimeGrouping).
///
/// Specifies the level of date/time grouping for date-based filters.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum DateTimeGrouping {
    /// Group by year (default)
    #[default]
    #[xml("year")]
    Year,
    /// Group by month
    #[xml("month")]
    Month,
    /// Group by day
    #[xml("day")]
    Day,
    /// Group by hour
    #[xml("hour")]
    Hour,
    /// Group by minute
    #[xml("minute")]
    Minute,
    /// Group by second
    #[xml("second")]
    Second,
}

// ============================================================================
// Composite Types -- CT_* structures
// ============================================================================

// --- Filter-related composite types ---

/// Discrete value filter (CT_Filters).
///
/// Contains a list of discrete values and/or date group items to filter by.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Filters {
    /// Whether to include blank cells
    pub blank: bool,
    /// Calendar type for date group items (calendarType attribute, default "none").
    pub calendar_type: Option<CalendarType>,
    /// Discrete string values to match
    pub filter: Vec<String>,
    /// Date group items for date-based filtering
    pub date_group_item: Vec<DateGroupItem>,
}

/// Date group item for date-based discrete filtering (CT_DateGroupItem).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DateGroupItem {
    /// Year (required)
    pub year: u16,
    /// Month (1-12)
    pub month: Option<u16>,
    /// Day (1-31)
    pub day: Option<u16>,
    /// Hour (0-23)
    pub hour: Option<u16>,
    /// Minute (0-59)
    pub minute: Option<u16>,
    /// Second (0-59)
    pub second: Option<u16>,
    /// Grouping granularity
    pub date_time_grouping: DateTimeGrouping,
}

impl Default for DateGroupItem {
    fn default() -> Self {
        Self {
            year: 0,
            month: None,
            day: None,
            hour: None,
            minute: None,
            second: None,
            date_time_grouping: DateTimeGrouping::Year,
        }
    }
}

/// Top 10 filter (CT_Top10).
///
/// Filters by top or bottom N values or percentages.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Top10Filter {
    /// If true, filter top values; if false, filter bottom values
    pub top: bool,
    /// If true, val is a percentage; if false, val is an item count
    pub percent: bool,
    /// The threshold value (count or percentage)
    pub val: f64,
    /// The actual filter value computed from the data
    pub filter_val: Option<f64>,
}

impl Default for Top10Filter {
    fn default() -> Self {
        Self {
            top: true,
            percent: false,
            val: 0.0,
            filter_val: None,
        }
    }
}

/// Custom filters container (CT_CustomFilters).
///
/// Contains one or two custom filter criteria combined with AND or OR logic.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CustomFilters {
    /// If true, criteria are combined with AND; if false, with OR
    pub and: bool,
    /// Custom filter criteria (1 or 2)
    pub custom_filter: Vec<CustomFilter>,
}

/// A single custom filter criterion (CT_CustomFilter).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomFilter {
    /// Comparison operator
    pub operator: FilterOperator,
    /// Value to compare against
    pub val: Option<String>,
}

impl Default for CustomFilter {
    fn default() -> Self {
        Self {
            operator: FilterOperator::Equal,
            val: None,
        }
    }
}

/// Dynamic filter (CT_DynamicFilter).
///
/// Filters data dynamically based on a date or value criterion.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DynamicFilter {
    /// Dynamic filter type (required)
    pub r#type: DynamicFilterType,
    /// Computed filter value
    pub val: Option<f64>,
    /// Maximum value for range-based filters
    pub max_val: Option<f64>,
    /// ISO datetime value for date-based dynamic filters (valIso attribute).
    pub val_iso: Option<String>,
    /// Maximum ISO datetime value for range-based dynamic filters (maxValIso attribute).
    pub max_val_iso: Option<String>,
}

impl Default for DynamicFilter {
    fn default() -> Self {
        Self {
            r#type: DynamicFilterType::Null,
            val: None,
            max_val: None,
            val_iso: None,
            max_val_iso: None,
        }
    }
}

/// Color filter (CT_ColorFilter).
///
/// Filters by cell or font color.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorFilter {
    /// DXF (differential formatting) record ID
    pub dxf_id: Option<u32>,
    /// If true, filter by cell color; if false, by font color
    pub cell_color: bool,
}

impl Default for ColorFilter {
    fn default() -> Self {
        Self {
            dxf_id: None,
            cell_color: true,
        }
    }
}

/// Icon filter (CT_IconFilter).
///
/// Filters by conditional formatting icon.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct IconFilter {
    /// Icon set name (required)
    pub icon_set: IconSetType,
    /// Icon index within the set
    pub icon_id: Option<u32>,
}

/// Filter type discriminator for filter columns.
///
/// A filter column can have at most one of these filter types applied.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum FilterType {
    /// Discrete value filter
    Filters(Filters),
    /// Top/bottom N filter
    Top10(Top10Filter),
    /// Custom operator-based filter
    Custom(CustomFilters),
    /// Dynamic date/value filter
    Dynamic(DynamicFilter),
    /// Color-based filter
    ColorFilter(ColorFilter),
    /// Icon-based filter
    IconFilter(IconFilter),
}

/// A single filter column within an auto-filter (CT_FilterColumn).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FilterColumn {
    /// Zero-based column index within the table
    pub col_id: u32,
    /// Whether the dropdown button is hidden
    pub hidden_button: bool,
    /// Whether the dropdown button is shown
    pub show_button: bool,
    /// The filter applied to this column
    pub filter: Option<FilterType>,
}

impl Default for FilterColumn {
    fn default() -> Self {
        Self {
            col_id: 0,
            hidden_button: false,
            show_button: true,
            filter: None,
        }
    }
}

// --- Sort-related composite types (canonical definitions in worksheet::filter) ---

pub use crate::worksheet::filter::{SortCondition, SortState};

// --- AutoFilter ---

/// Auto-filter definition (CT_AutoFilter).
///
/// Defines filtering and optional sorting for a range of cells.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct AutoFilter {
    /// Range reference for the auto-filter area
    pub r#ref: Option<String>,
    /// Per-column filter definitions
    pub filter_columns: Vec<FilterColumn>,
    /// Sort state applied within the auto-filter
    pub sort_state: Option<SortState>,
}

// ============================================================================
// TableFormula -- CT_TableFormula
// ============================================================================

/// Table formula with array flag (CT_TableFormula).
///
/// Wraps a formula string with an optional `array` attribute indicating
/// whether the formula is an array formula. Used for `calculatedColumnFormula`
/// and `totalsRowFormula` in CT_TableColumn.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct TableFormula {
    /// The formula text content.
    pub text: String,
    /// Whether this is an array formula. Default: `false`.
    pub array: bool,
}

impl TableFormula {
    /// Create a new simple (non-array) table formula.
    #[must_use]
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            array: false,
        }
    }

    /// Create a new array table formula.
    #[must_use]
    pub fn new_array(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            array: true,
        }
    }
}

// ============================================================================
// XmlColumnPr -- CT_XmlColumnPr
// ============================================================================

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

// --- Table ---

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

// ============================================================================
// TableStyleType -- ST_TableStyleType
// ============================================================================

/// Table style element type (ST_TableStyleType, ECMA-376 §18.18.73).
///
/// Identifies which region of a table a style element applies to.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum TableStyleType {
    /// Whole table style.
    #[default]
    #[xml("wholeTable")]
    WholeTable,
    /// Header row style.
    #[xml("headerRow")]
    HeaderRow,
    /// Total row style.
    #[xml("totalRow")]
    TotalRow,
    /// First column style.
    #[xml("firstColumn")]
    FirstColumn,
    /// Last column style.
    #[xml("lastColumn")]
    LastColumn,
    /// First row stripe style.
    #[xml("firstRowStripe")]
    FirstRowStripe,
    /// Second row stripe style.
    #[xml("secondRowStripe")]
    SecondRowStripe,
    /// First column stripe style.
    #[xml("firstColumnStripe")]
    FirstColumnStripe,
    /// Second column stripe style.
    #[xml("secondColumnStripe")]
    SecondColumnStripe,
    /// First header cell style.
    #[xml("firstHeaderCell")]
    FirstHeaderCell,
    /// Last header cell style.
    #[xml("lastHeaderCell")]
    LastHeaderCell,
    /// First total cell style.
    #[xml("firstTotalCell")]
    FirstTotalCell,
    /// Last total cell style.
    #[xml("lastTotalCell")]
    LastTotalCell,
    /// First subtotal column style.
    #[xml("firstSubtotalColumn")]
    FirstSubtotalColumn,
    /// Second subtotal column style.
    #[xml("secondSubtotalColumn")]
    SecondSubtotalColumn,
    /// Third subtotal column style.
    #[xml("thirdSubtotalColumn")]
    ThirdSubtotalColumn,
    /// First subtotal row style.
    #[xml("firstSubtotalRow")]
    FirstSubtotalRow,
    /// Second subtotal row style.
    #[xml("secondSubtotalRow")]
    SecondSubtotalRow,
    /// Third subtotal row style.
    #[xml("thirdSubtotalRow")]
    ThirdSubtotalRow,
    /// Blank row style.
    #[xml("blankRow")]
    BlankRow,
    /// First column subheading style.
    #[xml("firstColumnSubheading")]
    FirstColumnSubheading,
    /// Second column subheading style.
    #[xml("secondColumnSubheading")]
    SecondColumnSubheading,
    /// Third column subheading style.
    #[xml("thirdColumnSubheading")]
    ThirdColumnSubheading,
    /// First row subheading style.
    #[xml("firstRowSubheading")]
    FirstRowSubheading,
    /// Second row subheading style.
    #[xml("secondRowSubheading")]
    SecondRowSubheading,
    /// Third row subheading style.
    #[xml("thirdRowSubheading")]
    ThirdRowSubheading,
    /// Page field labels style.
    #[xml("pageFieldLabels")]
    PageFieldLabels,
    /// Page field values style.
    #[xml("pageFieldValues")]
    PageFieldValues,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- TotalsRowFunction ---

    #[test]
    fn totals_row_function_roundtrip() {
        let variants = [
            TotalsRowFunction::None,
            TotalsRowFunction::Average,
            TotalsRowFunction::Count,
            TotalsRowFunction::CountNums,
            TotalsRowFunction::Max,
            TotalsRowFunction::Min,
            TotalsRowFunction::StdDev,
            TotalsRowFunction::Sum,
            TotalsRowFunction::Var,
            TotalsRowFunction::Custom,
        ];
        for v in &variants {
            assert_eq!(TotalsRowFunction::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(TotalsRowFunction::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    #[test]
    fn totals_row_function_unknown_defaults_to_none() {
        assert_eq!(
            TotalsRowFunction::from_ooxml("bogus"),
            TotalsRowFunction::None
        );
        assert_eq!(
            TotalsRowFunction::from_bytes(b"bogus"),
            TotalsRowFunction::None
        );
    }

    // --- FilterOperator ---

    #[test]
    fn filter_operator_roundtrip() {
        let variants = [
            FilterOperator::Equal,
            FilterOperator::LessThan,
            FilterOperator::LessThanOrEqual,
            FilterOperator::NotEqual,
            FilterOperator::GreaterThanOrEqual,
            FilterOperator::GreaterThan,
        ];
        for v in &variants {
            assert_eq!(FilterOperator::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(FilterOperator::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    #[test]
    fn filter_operator_unknown_defaults_to_equal() {
        assert_eq!(FilterOperator::from_ooxml("bogus"), FilterOperator::Equal);
    }

    // --- DynamicFilterType ---

    #[test]
    fn dynamic_filter_type_roundtrip() {
        let variants = [
            DynamicFilterType::Null,
            DynamicFilterType::AboveAverage,
            DynamicFilterType::BelowAverage,
            DynamicFilterType::Today,
            DynamicFilterType::ThisMonth,
            DynamicFilterType::Q1,
            DynamicFilterType::M12,
            DynamicFilterType::YearToDate,
        ];
        for v in &variants {
            assert_eq!(DynamicFilterType::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(DynamicFilterType::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    #[test]
    fn dynamic_filter_type_unknown_defaults_to_null() {
        assert_eq!(
            DynamicFilterType::from_ooxml("bogus"),
            DynamicFilterType::Null
        );
    }

    // --- TableType ---

    #[test]
    fn table_type_roundtrip() {
        let variants = [TableType::Worksheet, TableType::Xml, TableType::QueryTable];
        for v in &variants {
            assert_eq!(TableType::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(TableType::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    // --- SortOrder ---

    #[test]
    fn sort_order_roundtrip() {
        let variants = [SortOrder::None, SortOrder::Ascending, SortOrder::Descending];
        for v in &variants {
            assert_eq!(SortOrder::from_ooxml(v.to_ooxml()), *v);
        }
    }

    #[test]
    fn sort_order_from_bytes_shorthand() {
        assert_eq!(SortOrder::from_bytes(b"asc"), SortOrder::Ascending);
        assert_eq!(SortOrder::from_bytes(b"desc"), SortOrder::Descending);
    }

    // --- SortBy ---

    #[test]
    fn sort_by_roundtrip() {
        let variants = [
            SortBy::Value,
            SortBy::CellColor,
            SortBy::FontColor,
            SortBy::Icon,
        ];
        for v in &variants {
            assert_eq!(SortBy::from_ooxml(v.to_ooxml()), *v);
        }
    }

    #[test]
    fn sort_by_from_bytes() {
        assert_eq!(SortBy::from_bytes(b"value"), SortBy::Value);
        assert_eq!(SortBy::from_bytes(b"cellColor"), SortBy::CellColor);
        assert_eq!(SortBy::from_bytes(b"fontColor"), SortBy::FontColor);
        assert_eq!(SortBy::from_bytes(b"icon"), SortBy::Icon);
        assert_eq!(SortBy::from_bytes(b"unknown"), SortBy::Value);
    }

    // --- TableStyleInfo ---

    #[test]
    fn table_style_info_new_defaults() {
        let style = TableStyleInfo::new("TableStyleMedium9");
        assert_eq!(style.name, Some("TableStyleMedium9".to_string()));
        assert!(!style.show_first_column);
        assert!(!style.show_last_column);
        assert!(style.show_row_stripes);
        assert!(!style.show_column_stripes);
    }

    #[test]
    fn table_style_info_default_trait() {
        let style = TableStyleInfo::default();
        assert_eq!(style.name, None);
        assert!(!style.show_first_column);
        assert!(!style.show_row_stripes); // Default trait gives false for all bools
    }

    // --- DateTimeGrouping ---

    #[test]
    fn date_time_grouping_roundtrip() {
        let variants = [
            DateTimeGrouping::Year,
            DateTimeGrouping::Month,
            DateTimeGrouping::Day,
            DateTimeGrouping::Hour,
            DateTimeGrouping::Minute,
            DateTimeGrouping::Second,
        ];
        for v in &variants {
            assert_eq!(DateTimeGrouping::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(DateTimeGrouping::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
        // Unknown defaults to Year
        assert_eq!(
            DateTimeGrouping::from_ooxml("bogus"),
            DateTimeGrouping::Year
        );
        assert_eq!(
            DateTimeGrouping::from_bytes(b"bogus"),
            DateTimeGrouping::Year
        );
    }

    // --- Table ---

    #[test]
    fn table_default() {
        let t = Table::default();
        assert_eq!(t.header_row_count, 1);
        assert_eq!(t.totals_row_count, 0);
        assert!(t.totals_row_shown);
        assert!(!t.insert_row);
        assert!(!t.insert_row_shift);
        assert!(!t.published);
        assert_eq!(t.table_type, TableType::Worksheet);
        assert!(t.auto_filter.is_none());
        assert!(t.sort_state.is_none());
        assert!(t.table_columns.is_empty());
        assert!(t.table_style_info.is_none());
    }

    // --- TableColumn ---

    #[test]
    fn table_column_default() {
        let col = TableColumn::default();
        assert_eq!(col.totals_row_function, TotalsRowFunction::None);
        assert_eq!(col.id, 0);
        assert_eq!(col.name, "");
        assert!(col.unique_name.is_none());
        assert!(col.totals_row_label.is_none());
        assert!(col.calculated_column_formula.is_none());
        assert!(col.totals_row_formula.is_none());
    }

    // --- AutoFilter ---

    #[test]
    fn auto_filter_default() {
        let af = AutoFilter::default();
        assert!(af.r#ref.is_none());
        assert!(af.filter_columns.is_empty());
        assert!(af.sort_state.is_none());
    }

    // --- FilterColumn ---

    #[test]
    fn filter_column_defaults() {
        let fc = FilterColumn::default();
        assert!(!fc.hidden_button);
        assert!(fc.show_button);
        assert!(fc.filter.is_none());
        assert_eq!(fc.col_id, 0);
    }

    // --- Top10Filter ---

    #[test]
    fn top10_filter_defaults() {
        let f = Top10Filter::default();
        assert!(f.top);
        assert!(!f.percent);
        assert_eq!(f.val, 0.0);
        assert!(f.filter_val.is_none());
    }

    // --- CustomFilters ---

    #[test]
    fn custom_filters_default() {
        let cf = CustomFilters::default();
        assert!(!cf.and);
        assert!(cf.custom_filter.is_empty());
    }

    // --- ColorFilter ---

    #[test]
    fn color_filter_default() {
        let cf = ColorFilter::default();
        assert!(cf.cell_color);
        assert!(cf.dxf_id.is_none());
    }

    // --- SortState ---

    #[test]
    fn sort_state_default() {
        let ss = SortState::default();
        assert!(!ss.column_sort);
        assert!(!ss.case_sensitive);
        assert_eq!(ss.sort_method, crate::worksheet::filter::SortMethod::None);
        assert_eq!(ss.ref_range, "");
        assert!(ss.sort_condition.is_empty());
    }

    // --- TableStyleType ---

    #[test]
    fn table_style_type_roundtrip() {
        let variants = [
            (TableStyleType::WholeTable, "wholeTable"),
            (TableStyleType::HeaderRow, "headerRow"),
            (TableStyleType::TotalRow, "totalRow"),
            (TableStyleType::FirstColumn, "firstColumn"),
            (TableStyleType::LastColumn, "lastColumn"),
            (TableStyleType::FirstRowStripe, "firstRowStripe"),
            (TableStyleType::SecondRowStripe, "secondRowStripe"),
            (TableStyleType::FirstColumnStripe, "firstColumnStripe"),
            (TableStyleType::SecondColumnStripe, "secondColumnStripe"),
            (TableStyleType::FirstHeaderCell, "firstHeaderCell"),
            (TableStyleType::LastHeaderCell, "lastHeaderCell"),
            (TableStyleType::FirstTotalCell, "firstTotalCell"),
            (TableStyleType::LastTotalCell, "lastTotalCell"),
            (TableStyleType::FirstSubtotalColumn, "firstSubtotalColumn"),
            (TableStyleType::SecondSubtotalColumn, "secondSubtotalColumn"),
            (TableStyleType::ThirdSubtotalColumn, "thirdSubtotalColumn"),
            (TableStyleType::FirstSubtotalRow, "firstSubtotalRow"),
            (TableStyleType::SecondSubtotalRow, "secondSubtotalRow"),
            (TableStyleType::ThirdSubtotalRow, "thirdSubtotalRow"),
            (TableStyleType::BlankRow, "blankRow"),
            (
                TableStyleType::FirstColumnSubheading,
                "firstColumnSubheading",
            ),
            (
                TableStyleType::SecondColumnSubheading,
                "secondColumnSubheading",
            ),
            (
                TableStyleType::ThirdColumnSubheading,
                "thirdColumnSubheading",
            ),
            (TableStyleType::FirstRowSubheading, "firstRowSubheading"),
            (TableStyleType::SecondRowSubheading, "secondRowSubheading"),
            (TableStyleType::ThirdRowSubheading, "thirdRowSubheading"),
            (TableStyleType::PageFieldLabels, "pageFieldLabels"),
            (TableStyleType::PageFieldValues, "pageFieldValues"),
        ];
        for (variant, s) in &variants {
            assert_eq!(TableStyleType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                TableStyleType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
        }
    }

    #[test]
    fn table_style_type_unknown_defaults_to_whole_table() {
        assert_eq!(
            TableStyleType::from_ooxml("bogus"),
            TableStyleType::WholeTable
        );
        assert_eq!(
            TableStyleType::from_bytes(b"bogus"),
            TableStyleType::WholeTable
        );
    }

    // --- SortCondition ---

    #[test]
    fn sort_condition_default() {
        let sc = SortCondition::default();
        assert!(!sc.descending);
        assert_eq!(sc.sort_by, SortBy::Value);
        assert_eq!(sc.ref_range, "");
        assert!(sc.custom_list.is_none());
        assert!(sc.dxf_id.is_none());
        assert!(sc.icon_set.is_none());
        assert!(sc.icon_id.is_none());
    }
}
