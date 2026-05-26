//! Pivot table and pivot cache types (ECMA-376 Part 1, Section 18.10 — SpreadsheetML Pivot Tables).
//!
//! Types modelling pivot table definitions (`xl/pivotTables/pivotTable{N}.xml`)
//! and pivot cache definitions (`xl/pivotCache/pivotCacheDefinition{N}.xml`).
//!
//! This module is split into focused submodules:
//! - [`cache`] — cache definition types (fields, sources, shared items, grouping)
//! - [`field`] — pivot field and item types (data fields, row/col/page references)
//! - [`layout`] — layout, format, and area types (formats, conditional formats, chart formats)
//!
//! All public types are re-exported from this module so that existing consumers
//! using `ooxml_types::pivot::XYZ` continue to work without changes.

pub mod cache;
pub mod field;
pub mod layout;

// Re-export everything from submodules so external consumers keep the same paths.
pub use cache::*;
pub use field::*;
pub use layout::*;

// ============================================================================
// PivotSourceType — ST_SourceType
// ============================================================================

/// Pivot cache data source type (ST_SourceType).
///
/// Identifies the kind of data source backing a pivot cache.
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
pub enum PivotSourceType {
    /// Data sourced from a worksheet range (default).
    #[default]
    #[xml("worksheet")]
    Worksheet,
    /// Data sourced from an external connection.
    #[xml("external")]
    External,
    /// Data sourced from multiple consolidation ranges.
    #[xml("consolidation")]
    Consolidation,
    /// Data sourced from a scenario manager.
    #[xml("scenario")]
    Scenario,
}

// ============================================================================
// DataConsolidateFunction — ST_DataConsolidateFunction
// ============================================================================

/// Data consolidation function for pivot data fields (ST_DataConsolidateFunction).
///
/// Specifies the aggregation function applied to a data field.
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
pub enum DataConsolidateFunction {
    /// Average of values.
    #[xml("average")]
    Average,
    /// Count of values.
    #[xml("count")]
    Count,
    /// Count of numeric values.
    #[xml("countNums")]
    CountNums,
    /// Maximum value.
    #[xml("max")]
    Max,
    /// Minimum value.
    #[xml("min")]
    Min,
    /// Product of values.
    #[xml("product")]
    Product,
    /// Sample standard deviation.
    #[xml("stdDev")]
    StdDev,
    /// Population standard deviation.
    #[xml("stdDevp")]
    StdDevP,
    /// Sum of values (default).
    #[default]
    #[xml("sum")]
    Sum,
    /// Sample variance.
    #[xml("var")]
    Var,
    /// Population variance.
    #[xml("varp")]
    VarP,
}

// ============================================================================
// ShowDataAs — ST_ShowDataAs
// ============================================================================

/// Show data as calculation type (ST_ShowDataAs).
///
/// Controls how values in a data field are displayed relative to other values.
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
pub enum ShowDataAs {
    /// Show actual values (default).
    #[default]
    #[xml("normal")]
    Normal,
    /// Show difference from a base item.
    #[xml("difference")]
    Difference,
    /// Show as percentage of a base item.
    #[xml("percent")]
    Percent,
    /// Show as percentage difference from a base item.
    #[xml("percentDiff")]
    PercentDiff,
    /// Show as running total.
    #[xml("runTotal")]
    RunTotal,
    /// Show as percentage of the row total.
    #[xml("percentOfRow")]
    PercentOfRow,
    /// Show as percentage of the column total.
    #[xml("percentOfCol")]
    PercentOfCol,
    /// Show as percentage of the grand total.
    #[xml("percentOfTotal")]
    PercentOfTotal,
    /// Show as index.
    #[xml("index")]
    Index,
}

// ============================================================================
// GroupBy — ST_GroupBy
// ============================================================================

/// Grouping interval for pivot field grouping (ST_GroupBy, §18.18.36).
///
/// Specifies the time/range interval used when grouping pivot field items.
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
pub enum GroupBy {
    /// Group by numeric range (default).
    #[default]
    #[xml("range")]
    Range,
    /// Group by seconds.
    #[xml("seconds")]
    Seconds,
    /// Group by minutes.
    #[xml("minutes")]
    Minutes,
    /// Group by hours.
    #[xml("hours")]
    Hours,
    /// Group by days.
    #[xml("days")]
    Days,
    /// Group by months.
    #[xml("months")]
    Months,
    /// Group by quarters.
    #[xml("quarters")]
    Quarters,
    /// Group by years.
    #[xml("years")]
    Years,
}

// ============================================================================
// PivotX — CT_X
// ============================================================================

/// Simple pivot index element (CT_X).
///
/// Represents a single `<x>` element used throughout pivot table structures
/// to reference items by index.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct PivotX {
    /// The index value. Default: `0`. XSD: optional with default 0.
    pub v: Option<i32>,
}

// ============================================================================
// PivotIndex — CT_Index
// ============================================================================

/// Simple index element (CT_Index).
///
/// Represents a single `<x>` element with a required unsigned integer index value,
/// used in CT_DiscretePr and similar structures.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct PivotIndex {
    /// The index value (required).
    pub v: u32,
}

// ============================================================================
// PivotDiscretePr — CT_DiscretePr
// ============================================================================

/// Discrete grouping mappings (CT_DiscretePr).
///
/// Maps source items to group items via index values.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct PivotDiscretePr {
    /// Number of index entries (informational; derived from items.len() on write).
    pub count: Option<u32>,
    /// Index values mapping source items to group items.
    pub items: Vec<u32>,
    /// Index elements (`<x>`). XSD: CT_Index, 1..unbounded. // XSD: required
    #[serde(rename = "x")]
    pub x: Vec<PivotIndex>,
}

// ============================================================================
// Tuple — CT_Tuple
// ============================================================================

/// OLAP tuple element (CT_Tuple, §18.10.1.86).
///
/// Represents a single tuple reference used in OLAP pivot table structures.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Tuple {
    /// Field index.
    pub fld: Option<u32>,
    /// Hierarchy index.
    pub hier: Option<u32>,
    /// Item index (required).
    pub item: u32,
}

// ============================================================================
// Tuples — CT_Tuples
// ============================================================================

/// Collection of OLAP tuples (CT_Tuples, §18.10.1.87).
///
/// Container for a set of tuple references used in OLAP pivot structures.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Tuples {
    /// The tuple elements.
    pub tpl: Vec<Tuple>,
    /// Member name count.
    pub c: Option<u32>,
}

// ============================================================================
// TupleCache — CT_TupleCache
// ============================================================================

/// OLAP tuple cache (CT_TupleCache, §18.10.1.85).
///
/// Contains OLAP-specific cache entries. Stored as raw XML for now due to the
/// complexity of the OLAP hierarchy structure.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TupleCache {
    /// Entries stored as an extension list (raw XML for complex OLAP structure).
    pub entries: Option<crate::ExtensionList>,
    /// OLAP set definitions (`<sets>`, CT_Sets). Placeholder as raw string.
    pub sets: Option<String>,
    /// OLAP query cache (`<queryCache>`, CT_QueryCache). Placeholder as raw string.
    pub query_cache: Option<String>,
    /// Server format definitions (`<serverFormats>`, CT_ServerFormats). Placeholder as raw string.
    pub server_formats: Option<String>,
}

// ============================================================================
// SharedItem — unified enum for pivot cache value types
// ============================================================================

/// A single shared item value (union of m/n/b/e/s/d elements).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SharedItem {
    /// Missing value (`<m>`).
    Missing,
    /// Numeric value (`<n>`).
    Number(f64),
    /// Boolean value (`<b>`).
    Boolean(bool),
    /// Error value (`<e>`).
    Error(String),
    /// String value (`<s>`).
    String(String),
    /// Date-time value (`<d>`, ISO 8601 string).
    DateTime(String),
}

// ============================================================================
// PivotBoolean — CT_Boolean
// ============================================================================

/// Boolean shared item in a pivot cache (CT_Boolean).
///
/// Represents a boolean value with optional member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotBoolean {
    /// The boolean value.
    pub v: bool,
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Member property value indices (x elements / tpls).
    pub x: Vec<u32>,
}

// ============================================================================
// PivotDateTime — CT_DateTime
// ============================================================================

/// Date-time shared item in a pivot cache (CT_DateTime).
///
/// Represents a date-time value with optional member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotDateTime {
    /// The date-time value (ISO 8601 string).
    pub v: String,
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Member property value indices (`<x>` elements).
    pub x: Vec<PivotX>,
}

// ============================================================================
// PivotError — CT_Error
// ============================================================================

/// Error shared item in a pivot cache (CT_Error).
///
/// Represents an error value with optional formatting and member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotError {
    /// The error value string (e.g. "#REF!", "#N/A").
    pub v: String,
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Background colour index.
    pub bc: Option<u32>,
    /// Foreground colour index.
    pub fc: Option<u32>,
    /// Whether italic. Default: `false`.
    pub i: bool,
    /// Whether underline. Default: `false`.
    pub un: bool,
    /// Whether strikethrough. Default: `false`.
    pub st: bool,
    /// Whether bold. Default: `false`.
    pub b: bool,
    /// Member property field index.
    pub r#in: Option<u32>,
    /// Tuple member property indices (tpls).
    pub tpls: Vec<u32>,
    /// Member property value indices (x elements).
    pub x: Vec<u32>,
}

// ============================================================================
// PivotMissing — CT_Missing
// ============================================================================

/// Missing value shared item in a pivot cache (CT_Missing).
///
/// Represents a missing/blank value with optional formatting and member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotMissing {
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Background colour index.
    pub bc: Option<u32>,
    /// Foreground colour index.
    pub fc: Option<u32>,
    /// Whether italic. Default: `false`.
    pub i: bool,
    /// Whether underline. Default: `false`.
    pub un: bool,
    /// Whether strikethrough. Default: `false`.
    pub st: bool,
    /// Whether bold. Default: `false`.
    pub b: bool,
    /// Member property field index.
    pub r#in: Option<u32>,
    /// Tuple member property indices (tpls).
    pub tpls: Vec<Tuples>,
    /// Member property value indices (x elements).
    pub x: Vec<PivotX>,
}

// ============================================================================
// PivotNumber — CT_Number
// ============================================================================

/// Numeric shared item in a pivot cache (CT_Number).
///
/// Represents a numeric value with optional formatting and member properties.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotNumber {
    /// The numeric value.
    pub v: f64,
    /// Whether this item is unused. Default: `false`.
    pub u: bool,
    /// Whether this item has a calculated value. Default: `false`.
    pub f: bool,
    /// Caption for display.
    pub c: Option<String>,
    /// Count of member property values.
    pub cp: Option<u32>,
    /// Background colour index.
    pub bc: Option<u32>,
    /// Foreground colour index.
    pub fc: Option<u32>,
    /// Whether italic. Default: `false`.
    pub i: bool,
    /// Whether underline. Default: `false`.
    pub un: bool,
    /// Whether strikethrough. Default: `false`.
    pub st: bool,
    /// Whether bold. Default: `false`.
    pub b: bool,
    /// Member property field index.
    pub r#in: Option<u32>,
    /// Tuple member property indices (tpls).
    pub tpls: Vec<Tuples>,
    /// Member property value indices (x elements).
    pub x: Vec<PivotX>,
}

impl Default for PivotNumber {
    fn default() -> Self {
        Self {
            v: 0.0,
            u: false,
            f: false,
            c: None,
            cp: None,
            bc: None,
            fc: None,
            i: false,
            un: false,
            st: false,
            b: false,
            r#in: None,
            tpls: Vec::new(),
            x: Vec::new(),
        }
    }
}

// ============================================================================
// PivotI — CT_I
// ============================================================================

/// A single row or column item entry (CT_I).
///
/// Represents one `<i>` element within row items or column items.
/// Contains a list of `<x>` references and attributes for item type, repeat count, and index.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotI {
    /// Item type (ST_ItemType). Default: `"data"`.
    pub t: Option<String>,
    /// Repeat count of the previous item. Default: `0`.
    pub r: Option<u32>,
    /// Zero-based index. Default: `0`.
    pub i: Option<u32>,
    /// Pivot index references (`<x>` children).
    pub x: Vec<PivotX>,
}

// ============================================================================
// PivotRowItems — CT_rowItems
// ============================================================================

/// Row items collection for a pivot table (CT_rowItems).
///
/// Contains the row item entries, where each row item (`<i>`) holds a list of
/// pivot index references (`<x>` elements).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotRowItems {
    /// Rows of pivot indices. Each inner `Vec<PivotX>` represents one `<i>` element
    /// containing multiple `<x>` children.
    pub items: Vec<Vec<PivotX>>,
    /// Count of row items.
    pub count: Option<u32>,
    /// Row item elements (`<i>`). XSD: CT_I, 1..unbounded. // XSD: required
    #[serde(rename = "i")]
    pub i: Vec<PivotI>,
}

// ============================================================================
// PivotColItems — CT_colItems
// ============================================================================

/// Column items collection for a pivot table (CT_colItems).
///
/// Contains the column item entries, structured identically to row items.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotColItems {
    /// Columns of pivot indices. Each inner `Vec<PivotX>` represents one `<i>` element
    /// containing multiple `<x>` children.
    pub items: Vec<Vec<PivotX>>,
    /// Count of column items.
    pub count: Option<u32>,
    /// Column item elements (`<i>`). XSD: CT_I, 1..unbounded. // XSD: required
    #[serde(rename = "i")]
    pub i: Vec<PivotI>,
}

// ============================================================================
// PivotCacheString — CT_String
// ============================================================================

/// Pivot cache string value (ECMA-376 CT_String, §18.10.1.83).
///
/// Represents a string item in the pivot cache shared items or group items.
/// Contains optional formatting attributes that indicate how the value appeared
/// in the source data.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotCacheString {
    /// The string value (required).
    pub v: String,
    /// Whether this item is unused in the pivot table.
    pub u: Option<bool>,
    /// Whether this is a calculated item value.
    pub f: Option<bool>,
    /// Display caption (overrides `v` in the UI).
    pub c: Option<String>,
    /// Number of property values associated with this item.
    pub cp: Option<u32>,
    /// Member property field index.
    pub r#in: Option<u32>,
    /// Background color (hex ARGB string).
    pub bc: Option<String>,
    /// Foreground (font) color (hex ARGB string).
    pub fc: Option<String>,
    /// Whether the value was italic in the source.
    pub i: Option<bool>,
    /// Whether the value was underlined in the source.
    pub un: Option<bool>,
    /// Whether the value was struck through in the source.
    pub st: Option<bool>,
    /// Whether the value was bold in the source.
    pub b: Option<bool>,
    /// Tuple index values (for OLAP).
    pub tpls: Vec<Tuples>,
    /// Member property indexes.
    pub x: Vec<PivotX>,
}

// ============================================================================
// XStringElement — CT_XStringElement
// ============================================================================

/// Simple string element wrapper (ECMA-376 CT_XStringElement).
///
/// A minimal type wrapping a single string value. Used in various OOXML
/// contexts where a sequence of string elements is needed (e.g. pivot cache
/// field groups, shared string references).
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct XStringElement {
    /// The string value (required `v` attribute).
    pub v: String,
}

impl XStringElement {
    /// Create a new `XStringElement` with the given value.
    pub fn new(v: impl Into<String>) -> Self {
        Self { v: v.into() }
    }
}

// ============================================================================
// PivotTableStyleInfo — CT_PivotTableStyle
// ============================================================================

/// Pivot table style info (CT_PivotTableStyle, §18.10.1.75).
///
/// Specifies the style applied to the pivot table.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotTableStyleInfo {
    /// Name of the pivot table style.
    pub name: Option<String>,
    /// Show row header formatting.
    pub show_row_headers: Option<bool>,
    /// Show column header formatting.
    pub show_col_headers: Option<bool>,
    /// Show row stripes.
    pub show_row_stripes: Option<bool>,
    /// Show column stripes.
    pub show_col_stripes: Option<bool>,
    /// Show last column formatting.
    pub show_last_column: Option<bool>,
}

// ============================================================================
// PivotLocation — CT_Location
// ============================================================================

/// Pivot table location (CT_Location, §18.10.1.55).
///
/// Specifies the cell reference and row/column counts for the pivot table location.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotLocation {
    /// Cell reference for the upper-left cell of the pivot table.
    pub r#ref: String,
    /// First data row (zero-based, relative to ref).
    pub first_data_row: u32,
    /// First data column (zero-based, relative to ref).
    pub first_data_col: u32,
    /// First header row count. Default: `1`.
    pub first_header_row: Option<u32>,
    /// Number of row page fields. Default: `0`.
    pub row_page_count: Option<u32>,
    /// Number of column page fields. Default: `0`.
    pub col_page_count: Option<u32>,
}

// ============================================================================
// PivotTableDefinition — CT_pivotTableDefinition
// ============================================================================

/// Pivot table definition (CT_pivotTableDefinition, §18.10.1.73).
///
/// The root element of a pivot table part. Contains the full configuration
/// of a pivot table including layout, formatting, and field settings.
/// Only the most commonly used attributes are represented as typed fields;
/// less common ones can be preserved via `ext_lst`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotTableDefinition {
    /// Name of the pivot table (required).
    pub name: String,
    /// ID of the pivot cache definition (required).
    pub cache_id: u32,
    /// Whether data fields are on rows (vs columns). Default: `false`.
    pub data_on_rows: bool,
    /// Position of the data field among other fields.
    pub data_position: Option<u32>,
    /// Auto-format ID.
    pub auto_format_id: Option<u32>,
    /// Apply number formats from auto-format.
    pub apply_number_formats: Option<bool>,
    /// Apply border formats from auto-format.
    pub apply_border_formats: Option<bool>,
    /// Apply font formats from auto-format.
    pub apply_font_formats: Option<bool>,
    /// Apply pattern formats from auto-format.
    pub apply_pattern_formats: Option<bool>,
    /// Apply alignment formats from auto-format.
    pub apply_alignment_formats: Option<bool>,
    /// Apply width/height formats from auto-format.
    pub apply_width_height_formats: Option<bool>,
    /// Caption for the data field column/row (required).
    pub data_caption: String,
    /// Caption for grand total columns/rows.
    pub grand_total_caption: Option<String>,
    /// Caption to display for error values.
    pub error_caption: Option<String>,
    /// Whether to show error caption. Default: `false`.
    pub show_error: bool,
    /// Caption to display for missing values.
    pub missing_caption: Option<String>,
    /// Whether to show missing caption. Default: `true`.
    pub show_missing: bool,
    /// Page field layout style.
    pub page_style: Option<String>,
    /// Pivot table style name.
    pub pivot_table_style: Option<String>,
    /// User-defined tag.
    pub tag: Option<String>,
    /// Version of the application that last updated this pivot table.
    pub updated_version: Option<u8>,
    /// Minimum version required to refresh this pivot table.
    pub min_refreshable_version: Option<u8>,
    /// Show calculated members. Default: `true`.
    pub show_calc_members: bool,
    /// Show data field drop-downs. Default: `true`.
    pub show_data_drops: bool,
    /// Show expand/collapse drill indicators. Default: `true`.
    pub show_drill: bool,
    /// Show member property tooltips. Default: `true`.
    pub show_member_property_tips: bool,
    /// Show data tooltips. Default: `true`.
    pub show_data_tips: bool,
    /// Enable the PivotTable Wizard. Default: `true`.
    pub enable_wizard: bool,
    /// Enable drill-down. Default: `true`.
    pub enable_drill: bool,
    /// Enable field properties dialog. Default: `true`.
    pub enable_field_properties: bool,
    /// Preserve cell formatting on refresh. Default: `true`.
    pub preserve_formatting: bool,
    /// Number of page fields per column before wrapping.
    pub page_wrap: Option<u32>,
    /// Page field layout: over then down (vs down then over). Default: `false`.
    pub page_over_then_down: bool,
    /// Include hidden items in subtotals. Default: `false`.
    pub subtotal_hidden_items: bool,
    /// Show row grand totals. Default: `true`.
    pub row_grand_totals: bool,
    /// Show column grand totals. Default: `true`.
    pub col_grand_totals: bool,
    /// Compact layout. Default: `true`.
    pub compact: bool,
    /// Outline layout. Default: `false`.
    pub outline: bool,
    /// Show outline data. Default: `false`.
    pub outline_data: bool,
    /// Allow multiple filters per field. Default: `true`.
    pub multiple_field_filters: bool,
    /// Chart format counter.
    pub chart_format: Option<u32>,
    /// Caption for the row header.
    pub row_header_caption: Option<String>,
    /// Caption for the column header.
    pub col_header_caption: Option<String>,
    /// Sort field list in ascending order. Default: `false`.
    pub field_list_sort_ascending: bool,
    /// Use custom list for sorting. Default: `true`.
    pub custom_list_sort: bool,

    // --- Additional optional attributes (ECMA-376 §18.10.1.73) ---
    /// Style name for vacated cells.
    pub vacated_style: Option<String>,
    /// Whether the user is allowed to edit data in the data area. Default: `false`.
    pub edit_data: bool,
    /// Disable the field list UI. Default: `false`.
    pub disable_field_list: bool,
    /// Show calculated members of OLAP fields. Default: `true`.
    pub show_calc_mbrs: bool,
    /// Show visual totals for OLAP. Default: `true`.
    pub visual_totals: bool,
    /// Show multiple labels when a field is on multiple axes. Default: `true`.
    pub show_multiple_label: bool,
    /// Show data field drop-down filter. Default: `true`.
    pub show_data_drop_down: bool,
    /// Print drill indicators. Default: `false`.
    pub print_drill: bool,
    /// Use auto-formatting on the pivot table. Default: `false`.
    pub use_auto_formatting: bool,
    /// Print field titles on each printed page. Default: `false`.
    pub field_print_titles: bool,
    /// Print item titles on each printed page. Default: `false`.
    pub item_print_titles: bool,
    /// Merge item cells when appropriate. Default: `false`.
    pub merge_item: bool,
    /// Show drop zones in the UI. Default: `true`.
    pub show_drop_zones: bool,
    /// Version of the application that created this pivot table.
    pub created_version: Option<u8>,
    /// Indentation increment for compact axis. Default: `1`.
    pub indent: Option<u32>,
    /// Show empty rows. Default: `false`.
    pub show_empty_row: bool,
    /// Show empty columns. Default: `false`.
    pub show_empty_col: bool,
    /// Show field headers. Default: `true`.
    pub show_headers: bool,
    /// Compact data layout. Default: `true`.
    pub compact_data: bool,
    /// Whether the pivot table is published for OLAP. Default: `false`.
    pub published: bool,
    /// Show drop zones in the grid area. Default: `false`.
    pub grid_drop_zones: bool,
    /// Enable immersive experience. Default: `true`.
    pub immersive: bool,
    /// Support MDX subqueries (OLAP). Default: `false`.
    pub mdx_subqueries: bool,

    // --- Optional child elements (ECMA-376 §18.10.1.73) ---
    /// Pivot field definitions (`<pivotFields>`).
    pub pivot_fields: Option<PivotFields>,
    /// Row field references (`<rowFields>`).
    pub row_fields: Option<PivotRowFields>,
    /// Row item entries (`<rowItems>`).
    pub row_items: Option<PivotRowItems>,
    /// Column field references (`<colFields>`).
    pub col_fields: Option<PivotColFields>,
    /// Column item entries (`<colItems>`).
    pub col_items: Option<PivotColItems>,
    /// Page field definitions (`<pageFields>`).
    pub page_fields: Option<PivotPageFields>,
    /// Data field definitions (`<dataFields>`).
    pub data_fields: Option<PivotDataFields>,
    /// Pivot table format definitions (`<formats>`).
    pub formats: Option<PivotFormats>,
    /// Conditional format definitions (`<conditionalFormats>`).
    pub conditional_formats: Option<PivotConditionalFormats>,
    /// Chart format definitions (`<chartFormats>`).
    pub chart_formats: Option<PivotChartFormats>,
    /// Pivot hierarchy definitions (`<pivotHierarchies>`).
    pub pivot_hierarchies: Option<PivotHierarchies>,
    /// Pivot table style info (`<pivotTableStyleInfo>`).
    pub pivot_table_style_info: Option<PivotTableStyleInfo>,
    /// Pivot table filters (`<filters>`).
    pub filters: Option<PivotFilters>,
    /// Row hierarchy usage references (`<rowHierarchiesUsage>`).
    pub row_hierarchies_usage: Option<PivotRowHierarchiesUsage>,
    /// Column hierarchy usage references (`<colHierarchiesUsage>`).
    pub col_hierarchies_usage: Option<PivotColHierarchiesUsage>,

    /// Extension list for forward-compatible round-tripping.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotTableDefinition {
    fn default() -> Self {
        Self {
            name: String::new(),
            cache_id: 0,
            data_on_rows: false,
            data_position: None,
            auto_format_id: None,
            apply_number_formats: None,
            apply_border_formats: None,
            apply_font_formats: None,
            apply_pattern_formats: None,
            apply_alignment_formats: None,
            apply_width_height_formats: None,
            data_caption: String::new(),
            grand_total_caption: None,
            error_caption: None,
            show_error: false,
            missing_caption: None,
            show_missing: true,
            page_style: None,
            pivot_table_style: None,
            tag: None,
            updated_version: None,
            min_refreshable_version: None,
            show_calc_members: true,
            show_data_drops: true,
            show_drill: true,
            show_member_property_tips: true,
            show_data_tips: true,
            enable_wizard: true,
            enable_drill: true,
            enable_field_properties: true,
            preserve_formatting: true,
            page_wrap: None,
            page_over_then_down: false,
            subtotal_hidden_items: false,
            row_grand_totals: true,
            col_grand_totals: true,
            compact: true,
            outline: false,
            outline_data: false,
            multiple_field_filters: true,
            chart_format: None,
            row_header_caption: None,
            col_header_caption: None,
            field_list_sort_ascending: false,
            custom_list_sort: true,
            vacated_style: None,
            edit_data: false,
            disable_field_list: false,
            show_calc_mbrs: true,
            visual_totals: true,
            show_multiple_label: true,
            show_data_drop_down: true,
            print_drill: false,
            use_auto_formatting: false,
            field_print_titles: false,
            item_print_titles: false,
            merge_item: false,
            show_drop_zones: true,
            created_version: None,
            indent: None,
            show_empty_row: false,
            show_empty_col: false,
            show_headers: true,
            compact_data: true,
            published: false,
            grid_drop_zones: false,
            immersive: true,
            mdx_subqueries: false,
            pivot_fields: None,
            row_fields: None,
            row_items: None,
            col_fields: None,
            col_items: None,
            page_fields: None,
            data_fields: None,
            formats: None,
            conditional_formats: None,
            chart_formats: None,
            pivot_hierarchies: None,
            pivot_table_style_info: None,
            filters: None,
            row_hierarchies_usage: None,
            col_hierarchies_usage: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- PivotSourceType ---

    #[test]
    fn pivot_source_type_roundtrip() {
        let variants = [
            (PivotSourceType::Worksheet, "worksheet"),
            (PivotSourceType::External, "external"),
            (PivotSourceType::Consolidation, "consolidation"),
            (PivotSourceType::Scenario, "scenario"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotSourceType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotSourceType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    // --- DataConsolidateFunction ---

    #[test]
    fn data_consolidate_function_roundtrip() {
        let variants = [
            (DataConsolidateFunction::Average, "average"),
            (DataConsolidateFunction::Count, "count"),
            (DataConsolidateFunction::CountNums, "countNums"),
            (DataConsolidateFunction::Max, "max"),
            (DataConsolidateFunction::Min, "min"),
            (DataConsolidateFunction::Product, "product"),
            (DataConsolidateFunction::StdDev, "stdDev"),
            (DataConsolidateFunction::StdDevP, "stdDevp"),
            (DataConsolidateFunction::Sum, "sum"),
            (DataConsolidateFunction::Var, "var"),
            (DataConsolidateFunction::VarP, "varp"),
        ];
        for (variant, s) in &variants {
            assert_eq!(
                DataConsolidateFunction::from_ooxml(s),
                *variant,
                "from_ooxml({s})"
            );
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                DataConsolidateFunction::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    // --- PivotFormatAction ---

    #[test]
    fn pivot_format_action_roundtrip() {
        let variants = [
            (PivotFormatAction::Blank, "blank"),
            (PivotFormatAction::Formatting, "formatting"),
            (PivotFormatAction::Drill, "drill"),
            (PivotFormatAction::Formula, "formula"),
        ];
        for (variant, s) in &variants {
            assert_eq!(
                PivotFormatAction::from_ooxml(s),
                *variant,
                "from_ooxml({s})"
            );
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotFormatAction::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    // --- ShowDataAs ---

    #[test]
    fn show_data_as_roundtrip() {
        let variants = [
            (ShowDataAs::Normal, "normal"),
            (ShowDataAs::Difference, "difference"),
            (ShowDataAs::Percent, "percent"),
            (ShowDataAs::PercentDiff, "percentDiff"),
            (ShowDataAs::RunTotal, "runTotal"),
            (ShowDataAs::PercentOfRow, "percentOfRow"),
            (ShowDataAs::PercentOfCol, "percentOfCol"),
            (ShowDataAs::PercentOfTotal, "percentOfTotal"),
            (ShowDataAs::Index, "index"),
        ];
        for (variant, s) in &variants {
            assert_eq!(ShowDataAs::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                ShowDataAs::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    // --- Unknown enum defaults ---

    #[test]
    fn unknown_enum_defaults() {
        assert_eq!(
            PivotSourceType::from_ooxml("bogus"),
            PivotSourceType::Worksheet
        );
        assert_eq!(
            PivotSourceType::from_bytes(b"bogus"),
            PivotSourceType::Worksheet
        );

        assert_eq!(
            DataConsolidateFunction::from_ooxml("bogus"),
            DataConsolidateFunction::Sum
        );
        assert_eq!(
            DataConsolidateFunction::from_bytes(b"bogus"),
            DataConsolidateFunction::Sum
        );

        assert_eq!(
            PivotFormatAction::from_ooxml("bogus"),
            PivotFormatAction::Formatting
        );
        assert_eq!(
            PivotFormatAction::from_bytes(b"bogus"),
            PivotFormatAction::Formatting
        );

        assert_eq!(ShowDataAs::from_ooxml("bogus"), ShowDataAs::Normal);
        assert_eq!(ShowDataAs::from_bytes(b"bogus"), ShowDataAs::Normal);
    }

    // --- Struct defaults ---

    #[test]
    fn pivot_cache_source_default() {
        let src = PivotCacheSource::default();
        assert_eq!(src.r#type, PivotSourceType::Worksheet);
        assert_eq!(src.connection_id, Some(0));
        assert!(src.worksheet_source.is_none());
        assert!(src.consolidation.is_none());
        assert!(src.ext_lst.is_none());
    }

    #[test]
    fn pivot_cache_field_default() {
        let f = PivotCacheField::default();
        assert!(f.name.is_empty());
        assert!(f.caption.is_none());
        assert!(f.num_fmt_id.is_none());
        assert!(f.formula.is_none());
        assert_eq!(f.sql_type, Some(0));
        assert_eq!(f.hierarchy, Some(0));
        assert_eq!(f.level, Some(0));
        assert!(f.database_field);
        assert_eq!(f.unique_list, Some(true));
        assert!(!f.member_property_field);
        assert!(!f.server_field);
        assert!(f.shared_items.is_none());
        assert!(f.field_group.is_none());
        assert!(f.ext_lst.is_none());
    }

    #[test]
    fn pivot_cache_hierarchy_default() {
        let h = PivotCacheHierarchy::default();
        assert!(h.unique_name.is_empty());
        assert!(h.caption.is_none());
        assert!(!h.measure);
        assert!(!h.set);
        assert!(h.parent_set.is_none());
        assert_eq!(h.icon_set, Some(0));
        assert!(!h.attribute);
        assert!(!h.time);
        assert!(!h.key_attribute);
        assert!(h.default_member_unique_name.is_none());
        assert!(h.all_unique_name.is_none());
        assert!(h.all_caption.is_none());
        assert!(h.dimension_unique_name.is_none());
        assert!(h.display_folder.is_none());
        assert!(h.measure_group.is_none());
        assert!(!h.measures);
        assert_eq!(h.count, 0);
        assert!(!h.one_field);
        assert!(h.member_value_datatype.is_none());
        assert!(h.unbalanced.is_none());
        assert!(h.unbalanced_group.is_none());
        assert!(!h.hidden);
    }

    #[test]
    fn pivot_data_field_default() {
        let df = PivotDataField::default();
        assert!(df.name.is_none());
        assert_eq!(df.fld, 0);
        assert_eq!(df.subtotal, DataConsolidateFunction::Sum);
        assert_eq!(df.show_data_as, ShowDataAs::Normal);
        assert_eq!(df.base_field, -1);
        assert_eq!(df.base_item, 1_048_832);
        assert!(df.num_fmt_id.is_none());
        assert!(df.ext_lst.is_none());
    }

    #[test]
    fn pivot_area_default() {
        let pa = PivotArea::default();
        assert!(pa.field.is_none());
        assert!(pa.r#type.is_none());
        assert!(pa.data_only);
        assert!(!pa.label_only);
        assert!(!pa.grand_row);
        assert!(!pa.grand_col);
        assert!(!pa.cache_index);
        assert!(pa.outline);
        assert!(pa.offset.is_none());
        assert!(!pa.collection_index);
        assert!(pa.axis.is_none());
        assert!(pa.field_position.is_none());
        assert!(pa.references.is_empty());
        assert!(pa.ext_lst.is_none());
    }

    #[test]
    fn pivot_format_default() {
        let f = PivotFormat::default();
        assert_eq!(f.action, PivotFormatAction::Formatting);
        assert!(f.dxf_id.is_none());
        assert!(f.ext_lst.is_none());
    }

    #[test]
    fn pivot_calculated_member_default() {
        let cm = PivotCalculatedMember::default();
        assert!(cm.name.is_empty());
        assert!(cm.mdx.is_empty());
        assert!(cm.member_name.is_none());
        assert!(cm.hierarchy.is_none());
        assert!(cm.parent.is_none());
        assert_eq!(cm.solve_order, 0);
        assert!(!cm.set);
        assert!(cm.ext_lst.is_none());
    }

    #[test]
    fn pivot_boolean_default() {
        let b = PivotBoolean::default();
        assert!(!b.v);
        assert!(!b.u);
        assert!(!b.f);
        assert!(b.c.is_none());
        assert!(b.cp.is_none());
        assert!(b.x.is_empty());
    }

    #[test]
    fn pivot_date_time_default() {
        let dt = PivotDateTime::default();
        assert!(dt.v.is_empty());
        assert!(!dt.u);
        assert!(!dt.f);
        assert!(dt.c.is_none());
        assert!(dt.cp.is_none());
    }

    #[test]
    fn pivot_error_default() {
        let e = PivotError::default();
        assert!(e.v.is_empty());
        assert!(!e.u);
        assert!(!e.f);
        assert!(e.c.is_none());
        assert!(e.cp.is_none());
        assert!(e.bc.is_none());
        assert!(e.fc.is_none());
        assert!(!e.i);
        assert!(!e.un);
        assert!(!e.st);
        assert!(!e.b);
        assert!(e.tpls.is_empty());
        assert!(e.x.is_empty());
    }

    #[test]
    fn shared_items_default() {
        let si = SharedItems::default();
        assert!(si.contains_semi_mixed_types);
        assert!(si.contains_non_date);
        assert!(!si.contains_date);
        assert!(si.contains_string);
        assert!(!si.contains_blank);
        assert!(!si.contains_mixed_types);
        assert!(!si.contains_number);
        assert!(!si.contains_integer);
        assert!(si.min_value.is_none());
        assert!(si.max_value.is_none());
        assert!(si.min_date.is_none());
        assert!(si.max_date.is_none());
        assert!(si.count.is_none());
        assert!(!si.long_text);
        assert!(si.items.is_empty());
    }

    #[test]
    fn wrapper_types_default() {
        let cf = PivotCacheFields::default();
        assert!(cf.count.is_none());
        assert!(cf.items.is_empty());

        let ch = PivotCacheHierarchies::default();
        assert!(ch.count.is_none());
        assert!(ch.items.is_empty());

        let df = PivotDataFields::default();
        assert!(df.count.is_none());
        assert!(df.items.is_empty());

        let pf = PivotFormats::default();
        assert!(pf.count.is_none());
        assert!(pf.items.is_empty());

        let ci = PivotCalculatedItems::default();
        assert!(ci.count.is_none());
        assert!(ci.items.is_empty());

        let cm = PivotCalculatedMembers::default();
        assert!(cm.count.is_none());
        assert!(cm.items.is_empty());

        let ccf = PivotChartFormats::default();
        assert!(ccf.count.is_none());
        assert!(ccf.items.is_empty());

        let pcf = PivotConditionalFormats::default();
        assert!(pcf.count.is_none());
        assert!(pcf.items.is_empty());

        let pd = PivotDimensions::default();
        assert!(pd.count.is_none());
        assert!(pd.items.is_empty());

        let gl = PivotGroupLevels::default();
        assert!(gl.count.is_none());
        assert!(gl.items.is_empty());

        let gm = PivotGroupMembers::default();
        assert!(gm.count.is_none());
        assert!(gm.items.is_empty());

        let g = PivotGroups::default();
        assert!(g.count.is_none());
        assert!(g.items.is_empty());

        let dp = PivotDiscretePr::default();
        assert!(dp.count.is_none());
        assert!(dp.items.is_empty());

        let gi = PivotGroupItems::default();
        assert!(gi.count.is_none());
        assert!(gi.items.is_empty());

        let colfields = PivotColFields::default();
        assert!(colfields.count.is_none());
        assert!(colfields.items.is_empty());

        let fu = PivotFieldsUsage::default();
        assert!(fu.count.is_none());
        assert!(fu.items.is_empty());

        let chu = PivotColHierarchiesUsage::default();
        assert!(chu.count.is_none());
        assert!(chu.items.is_empty());
    }

    #[test]
    fn pivot_consolidation_default() {
        let c = PivotConsolidation::default();
        assert!(c.auto_page);
        assert!(c.pages.is_empty());
        assert!(c.range_sets.is_empty());
    }

    #[test]
    fn pivot_field_group_default() {
        let fg = PivotFieldGroup::default();
        assert!(fg.par.is_none());
        assert!(fg.base.is_none());
        assert!(fg.range_pr.is_none());
        assert!(fg.discrete_pr.is_none());
        assert!(fg.group_items.is_none());
    }

    #[test]
    fn pivot_deleted_field_default() {
        let df = PivotDeletedField::default();
        assert!(df.name.is_empty());
    }

    #[test]
    fn pivot_chart_format_default() {
        let cf = PivotChartFormat::default();
        assert_eq!(cf.chart, 0);
        assert_eq!(cf.format, 0);
        assert!(!cf.series);
    }

    #[test]
    fn pivot_conditional_format_default() {
        let cf = PivotConditionalFormat::default();
        assert_eq!(cf.scope, Some("selection".to_string()));
        assert!(cf.r#type.is_none());
        assert_eq!(cf.priority, 0);
        assert!(cf.pivot_areas.is_empty());
        assert!(cf.ext_lst.is_none());
    }

    // --- FieldSortType ---

    #[test]
    fn field_sort_type_roundtrip() {
        let variants = [
            (FieldSortType::Manual, "manual"),
            (FieldSortType::Ascending, "ascending"),
            (FieldSortType::Descending, "descending"),
        ];
        for (variant, s) in &variants {
            assert_eq!(FieldSortType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                FieldSortType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(FieldSortType::from_ooxml("bogus"), FieldSortType::Manual);
        assert_eq!(FieldSortType::default(), FieldSortType::Manual);
    }

    // --- GroupBy ---

    #[test]
    fn group_by_roundtrip() {
        let variants = [
            (GroupBy::Range, "range"),
            (GroupBy::Seconds, "seconds"),
            (GroupBy::Minutes, "minutes"),
            (GroupBy::Hours, "hours"),
            (GroupBy::Days, "days"),
            (GroupBy::Months, "months"),
            (GroupBy::Quarters, "quarters"),
            (GroupBy::Years, "years"),
        ];
        for (variant, s) in &variants {
            assert_eq!(GroupBy::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                GroupBy::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(GroupBy::from_ooxml("bogus"), GroupBy::Range);
        assert_eq!(GroupBy::default(), GroupBy::Range);
    }

    // --- ItemType ---

    #[test]
    fn item_type_roundtrip() {
        let variants = [
            (ItemType::Data, "data"),
            (ItemType::Default, "default"),
            (ItemType::Sum, "sum"),
            (ItemType::CountA, "countA"),
            (ItemType::Avg, "avg"),
            (ItemType::Max, "max"),
            (ItemType::Min, "min"),
            (ItemType::Product, "product"),
            (ItemType::Count, "count"),
            (ItemType::StdDev, "stdDev"),
            (ItemType::StdDevP, "stdDevP"),
            (ItemType::Var, "var"),
            (ItemType::VarP, "varP"),
            (ItemType::Grand, "grand"),
            (ItemType::Blank, "blank"),
        ];
        for (variant, s) in &variants {
            assert_eq!(ItemType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                ItemType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(ItemType::from_ooxml("bogus"), ItemType::Data);
        assert_eq!(ItemType::default(), ItemType::Data);
    }

    // --- PivotAreaType ---

    #[test]
    fn pivot_area_type_roundtrip() {
        let variants = [
            (PivotAreaType::None, "none"),
            (PivotAreaType::Normal, "normal"),
            (PivotAreaType::Data, "data"),
            (PivotAreaType::All, "all"),
            (PivotAreaType::Origin, "origin"),
            (PivotAreaType::Button, "button"),
            (PivotAreaType::TopEnd, "topEnd"),
            (PivotAreaType::TopRight, "topRight"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotAreaType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotAreaType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(PivotAreaType::from_ooxml("bogus"), PivotAreaType::None);
        assert_eq!(PivotAreaType::default(), PivotAreaType::None);
    }

    // --- PivotFilterType ---

    #[test]
    fn pivot_filter_type_roundtrip() {
        let variants = [
            (PivotFilterType::Unknown, "unknown"),
            (PivotFilterType::Count, "count"),
            (PivotFilterType::Percent, "percent"),
            (PivotFilterType::Sum, "sum"),
            (PivotFilterType::CaptionEqual, "captionEqual"),
            (PivotFilterType::CaptionNotEqual, "captionNotEqual"),
            (PivotFilterType::CaptionBeginsWith, "captionBeginsWith"),
            (
                PivotFilterType::CaptionNotBeginsWith,
                "captionNotBeginsWith",
            ),
            (PivotFilterType::CaptionEndsWith, "captionEndsWith"),
            (PivotFilterType::CaptionNotEndsWith, "captionNotEndsWith"),
            (PivotFilterType::CaptionContains, "captionContains"),
            (PivotFilterType::CaptionNotContains, "captionNotContains"),
            (PivotFilterType::CaptionGreaterThan, "captionGreaterThan"),
            (
                PivotFilterType::CaptionGreaterThanOrEqual,
                "captionGreaterThanOrEqual",
            ),
            (PivotFilterType::CaptionLessThan, "captionLessThan"),
            (
                PivotFilterType::CaptionLessThanOrEqual,
                "captionLessThanOrEqual",
            ),
            (PivotFilterType::CaptionBetween, "captionBetween"),
            (PivotFilterType::CaptionNotBetween, "captionNotBetween"),
            (PivotFilterType::ValueEqual, "valueEqual"),
            (PivotFilterType::ValueNotEqual, "valueNotEqual"),
            (PivotFilterType::ValueGreaterThan, "valueGreaterThan"),
            (
                PivotFilterType::ValueGreaterThanOrEqual,
                "valueGreaterThanOrEqual",
            ),
            (PivotFilterType::ValueLessThan, "valueLessThan"),
            (
                PivotFilterType::ValueLessThanOrEqual,
                "valueLessThanOrEqual",
            ),
            (PivotFilterType::ValueBetween, "valueBetween"),
            (PivotFilterType::ValueNotBetween, "valueNotBetween"),
            (PivotFilterType::DateEqual, "dateEqual"),
            (PivotFilterType::DateNotEqual, "dateNotEqual"),
            (PivotFilterType::DateOlderThan, "dateOlderThan"),
            (
                PivotFilterType::DateOlderThanOrEqual,
                "dateOlderThanOrEqual",
            ),
            (PivotFilterType::DateNewerThan, "dateNewerThan"),
            (
                PivotFilterType::DateNewerThanOrEqual,
                "dateNewerThanOrEqual",
            ),
            (PivotFilterType::DateBetween, "dateBetween"),
            (PivotFilterType::DateNotBetween, "dateNotBetween"),
            (PivotFilterType::Tomorrow, "tomorrow"),
            (PivotFilterType::Today, "today"),
            (PivotFilterType::Yesterday, "yesterday"),
            (PivotFilterType::ThisWeek, "thisWeek"),
            (PivotFilterType::LastWeek, "lastWeek"),
            (PivotFilterType::NextWeek, "nextWeek"),
            (PivotFilterType::ThisMonth, "thisMonth"),
            (PivotFilterType::LastMonth, "lastMonth"),
            (PivotFilterType::NextMonth, "nextMonth"),
            (PivotFilterType::ThisQuarter, "thisQuarter"),
            (PivotFilterType::LastQuarter, "lastQuarter"),
            (PivotFilterType::NextQuarter, "nextQuarter"),
            (PivotFilterType::ThisYear, "thisYear"),
            (PivotFilterType::LastYear, "lastYear"),
            (PivotFilterType::NextYear, "nextYear"),
            (PivotFilterType::YearToDate, "yearToDate"),
            (PivotFilterType::Q1, "Q1"),
            (PivotFilterType::Q2, "Q2"),
            (PivotFilterType::Q3, "Q3"),
            (PivotFilterType::Q4, "Q4"),
            (PivotFilterType::M1, "M1"),
            (PivotFilterType::M2, "M2"),
            (PivotFilterType::M3, "M3"),
            (PivotFilterType::M4, "M4"),
            (PivotFilterType::M5, "M5"),
            (PivotFilterType::M6, "M6"),
            (PivotFilterType::M7, "M7"),
            (PivotFilterType::M8, "M8"),
            (PivotFilterType::M9, "M9"),
            (PivotFilterType::M10, "M10"),
            (PivotFilterType::M11, "M11"),
            (PivotFilterType::M12, "M12"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotFilterType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotFilterType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(
            PivotFilterType::from_ooxml("bogus"),
            PivotFilterType::Unknown
        );
        assert_eq!(PivotFilterType::default(), PivotFilterType::Unknown);
    }

    // --- PivotScope ---

    #[test]
    fn pivot_scope_roundtrip() {
        let variants = [
            (PivotScope::Selection, "selection"),
            (PivotScope::Data, "data"),
            (PivotScope::Field, "field"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotScope::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotScope::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(PivotScope::from_ooxml("bogus"), PivotScope::Selection);
        assert_eq!(PivotScope::default(), PivotScope::Selection);
    }

    // --- PivotSortType ---

    #[test]
    fn pivot_sort_type_roundtrip() {
        let variants = [
            (PivotSortType::None, "none"),
            (PivotSortType::Ascending, "ascending"),
            (PivotSortType::Descending, "descending"),
            (PivotSortType::AscendingAlpha, "ascendingAlpha"),
            (PivotSortType::DescendingAlpha, "descendingAlpha"),
            (PivotSortType::AscendingNatural, "ascendingNatural"),
            (PivotSortType::DescendingNatural, "descendingNatural"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotSortType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotSortType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(PivotSortType::from_ooxml("bogus"), PivotSortType::None);
        assert_eq!(PivotSortType::default(), PivotSortType::None);
    }

    // --- PivotAxisType ---

    #[test]
    fn pivot_axis_type_roundtrip() {
        let variants = [
            (PivotAxisType::None, "none"),
            (PivotAxisType::All, "all"),
            (PivotAxisType::Row, "axisRow"),
            (PivotAxisType::Column, "axisCol"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotAxisType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotAxisType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        // Empty string also maps to None
        assert_eq!(PivotAxisType::from_ooxml(""), PivotAxisType::None);
        assert_eq!(PivotAxisType::from_ooxml("bogus"), PivotAxisType::None);
        assert_eq!(PivotAxisType::default(), PivotAxisType::None);
    }

    // --- New struct defaults ---

    #[test]
    fn pivot_x_default() {
        let x = PivotX::default();
        assert_eq!(x.v, None);
    }

    #[test]
    fn tuple_default() {
        let t = Tuple::default();
        assert!(t.fld.is_none());
        assert!(t.hier.is_none());
        assert_eq!(t.item, 0);
    }

    #[test]
    fn tuples_default() {
        let ts = Tuples::default();
        assert!(ts.tpl.is_empty());
        assert!(ts.c.is_none());
    }

    #[test]
    fn tuple_cache_default() {
        let tc = TupleCache::default();
        assert!(tc.entries.is_none());
    }

    #[test]
    fn pivot_row_items_default() {
        let ri = PivotRowItems::default();
        assert!(ri.items.is_empty());
        assert!(ri.count.is_none());
    }

    #[test]
    fn pivot_col_items_default() {
        let ci = PivotColItems::default();
        assert!(ci.items.is_empty());
        assert!(ci.count.is_none());
    }

    #[test]
    fn pivot_table_definition_default() {
        let ptd = PivotTableDefinition::default();
        assert_eq!(ptd.name, "");
        assert_eq!(ptd.cache_id, 0);
        assert!(!ptd.data_on_rows);
        assert!(ptd.data_position.is_none());
        assert_eq!(ptd.data_caption, "");
        assert!(!ptd.show_error);
        assert!(ptd.show_missing);
        assert!(ptd.show_calc_members);
        assert!(ptd.show_data_drops);
        assert!(ptd.show_drill);
        assert!(ptd.show_member_property_tips);
        assert!(ptd.show_data_tips);
        assert!(ptd.enable_wizard);
        assert!(ptd.enable_drill);
        assert!(ptd.enable_field_properties);
        assert!(ptd.preserve_formatting);
        assert!(!ptd.page_over_then_down);
        assert!(!ptd.subtotal_hidden_items);
        assert!(ptd.row_grand_totals);
        assert!(ptd.col_grand_totals);
        assert!(ptd.compact);
        assert!(!ptd.outline);
        assert!(!ptd.outline_data);
        assert!(ptd.multiple_field_filters);
        assert!(!ptd.field_list_sort_ascending);
        assert!(ptd.custom_list_sort);
        assert!(ptd.ext_lst.is_none());
    }

    #[test]
    fn pivot_table_definition_serde_roundtrip() {
        let original = PivotTableDefinition {
            name: "SalesPivot".to_string(),
            cache_id: 42,
            data_caption: "Values".to_string(),
            pivot_table_style: Some("PivotStyleMedium9".to_string()),
            row_grand_totals: false,
            ..PivotTableDefinition::default()
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: PivotTableDefinition = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    // --- PivotCacheString and XStringElement ---

    #[test]
    fn pivot_cache_string_default() {
        let s = PivotCacheString::default();
        assert_eq!(s.v, "");
        assert_eq!(s.u, None);
        assert_eq!(s.f, None);
        assert_eq!(s.c, None);
        assert_eq!(s.b, None);
        assert!(s.tpls.is_empty());
        assert!(s.x.is_empty());
    }

    #[test]
    fn pivot_cache_string_serde_roundtrip() {
        let original = PivotCacheString {
            v: "East".to_string(),
            b: Some(true),
            c: Some("Eastern Region".to_string()),
            ..PivotCacheString::default()
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: PivotCacheString = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn x_string_element_new() {
        let el = XStringElement::new("hello");
        assert_eq!(el.v, "hello");
    }

    #[test]
    fn x_string_element_default() {
        let el = XStringElement::default();
        assert_eq!(el.v, "");
    }
}
