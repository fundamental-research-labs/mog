//! Pivot table parser for XLSX files
//!
//! This module parses pivot table definitions from XLSX files, including:
//! - Pivot table definitions (pivotTable*.xml)
//! - Pivot cache definitions (pivotCacheDefinition*.xml)
//! - Pivot cache records (pivotCacheRecords*.xml)
//!
//! # XLSX Pivot Table Structure
//!
//! Pivot tables in XLSX consist of three main parts:
//! 1. `xl/pivotTables/pivotTable*.xml` - The pivot table definition
//! 2. `xl/pivotCache/pivotCacheDefinition*.xml` - Cache structure and source
//! 3. `xl/pivotCache/pivotCacheRecords*.xml` - Cached data records
//!
//! # Example Usage
//!
//! ```ignore
//! use xlsx_parser::pivot::{parse_pivot_table, parse_pivot_cache_definition};
//!
//! let pivot_xml = archive.read_file("xl/pivotTables/pivotTable1.xml")?;
//! let pivot_table = parse_pivot_table(&pivot_xml);
//!
//! let cache_xml = archive.read_file("xl/pivotCache/pivotCacheDefinition1.xml")?;
//! let cache = parse_pivot_cache_definition(&cache_xml);
//! ```
//!
//! UTF-8 boundary guard: the single `&s[n..]` slice in this file splits an
//! XML attribute string at an ASCII-only delimiter. Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::infra::opc::{
    OoxmlRelationshipType, PackageOwner, WorkbookRelationships, WorksheetRelationships,
    parse_owned_relationships,
};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_with_default, parse_f64_attr, parse_i32_attr,
    parse_string_attr, parse_u32_attr,
};

pub type PivotCacheMap = std::collections::HashMap<u32, super::types::ParsedPivotCache>;
pub type PivotCachePathList = Vec<(u32, String, Option<String>)>;
pub type ParsedPivotCaches = (PivotCacheMap, PivotCachePathList);

// ============================================================================
// Core Data Structures
// ============================================================================

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
    /// Pivot field definitions
    pub pivot_fields: Vec<PivotField>,
    /// Style information
    pub style_info: Option<PivotStyleInfo>,
    /// Raw XML of the entire pivotTableDefinition element for opaque passthrough.
    /// When set, the structured writer can use this to produce byte-faithful output
    /// instead of reconstructing from individual fields.
    pub raw_xml: Option<Vec<u8>>,
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
            pivot_fields: Vec::new(),
            style_info: None,
            raw_xml: None,
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
        }
    }
}

/// Location of the pivot table in the worksheet
#[derive(Debug, Clone, Default)]
pub struct PivotLocation {
    /// Cell reference range (e.g., `A3:D10`) as a typed
    /// [`compute_parser::RangeRef`].
    ///
    /// **Typed range refs: — typed boundary.** Replaces the prior `ref_: String`
    /// which obscured the A1 grammar. Parsed once at read time via
    /// [`compute_parser::parse_a1_range`]; writers canonicalize via
    /// `RangeRef::to_a1_string`.
    ///
    /// `None` when the XML `ref` attribute is absent or fails to parse as a
    /// valid A1 range; downstream consumers treat this the same as the empty-
    /// string case the previous String field used.
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
    pub show_all: bool,
    /// Sort type
    pub sort_type: Option<SortType>,
    /// When present, sort is by aggregated values of this data field index (autoSortScope).
    pub auto_sort_data_field: Option<u32>,
    /// Column field index from autoSortScope second reference (for multi-column sort-by-value).
    pub auto_sort_column_field: Option<u32>,
    /// Column item index from autoSortScope second reference (for multi-column sort-by-value).
    pub auto_sort_column_item: Option<u32>,
    /// Whether this field is a data field
    pub data_field: bool,
    /// Default subtotal function
    pub default_subtotal: bool,
    /// Compact display
    pub compact: bool,
    /// Outline display
    pub outline: bool,
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
    /// When false (`sd="0"` in XLSX), the group is collapsed.
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

// ============================================================================
// Pivot Cache Structures
// ============================================================================

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
    /// Field definitions in the cache
    pub fields: Vec<CacheField>,
    /// Cached records
    pub records: Vec<CacheRecord>,
    /// Record count
    pub record_count: Option<u32>,
    /// Whether the cache is refreshed on load
    pub refresh_on_load: bool,
    /// Raw XML of the entire pivotCacheDefinition file for opaque passthrough.
    pub raw_definition_xml: Option<Vec<u8>>,
    /// Raw XML of the pivotCacheRecords file for opaque passthrough.
    pub raw_records_xml: Option<Vec<u8>>,
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

// ============================================================================
// Parsing Functions
// ============================================================================

/// Parse a pivot table definition from pivotTable*.xml
///
/// # Arguments
/// * `xml` - Raw bytes of the pivotTable XML file
///
/// # Returns
/// Parsed PivotTable structure
pub fn parse_pivot_table(xml: &[u8]) -> PivotTable {
    let mut pivot = PivotTable::default();

    // Find the pivotTableDefinition element
    let pivot_start = match find_tag_simd(xml, b"pivotTableDefinition", 0) {
        Some(pos) => pos,
        None => return pivot,
    };

    // Parse attributes from the root element
    if let Some(end) = find_gt_simd(xml, pivot_start) {
        let element = &xml[pivot_start..end + 1];

        pivot.name = parse_string_attr(element, b"name=\"").unwrap_or_default();
        pivot.cache_id = parse_u32_attr(element, b"cacheId=\"").unwrap_or(0);
        pivot.data_on_rows = parse_bool_attr(element, b"dataOnRows=\"");
        pivot.grand_total_caption = parse_string_attr(element, b"grandTotalCaption=\"");
        pivot.row_header_caption = parse_string_attr(element, b"rowHeaderCaption=\"");
        pivot.col_header_caption = parse_string_attr(element, b"colHeaderCaption=\"");
        pivot.error_caption = parse_string_attr(element, b"errorCaption=\"");
        pivot.show_error = parse_bool_attr(element, b"showError=\"");
        pivot.missing_caption = parse_string_attr(element, b"missingCaption=\"");
        pivot.grid_drop_zones = parse_bool_attr(element, b"gridDropZones=\"");
        // These default to true in OOXML — use parse_bool_attr_with_default
        pivot.row_grand_totals = parse_bool_attr_with_default(element, b"rowGrandTotals=\"", true);
        pivot.col_grand_totals = parse_bool_attr_with_default(element, b"colGrandTotals=\"", true);
        pivot.show_missing = parse_bool_attr_with_default(element, b"showMissing=\"", true);
    }

    // Parse location
    if let Some(loc_start) = find_tag_simd(xml, b"location", pivot_start) {
        if let Some(loc_end) = find_gt_simd(xml, loc_start) {
            let loc_element = &xml[loc_start..loc_end + 1];
            pivot.location = parse_location(loc_element);
        }
    }

    // Parse pivot fields
    if let Some(fields_start) = find_tag_simd(xml, b"pivotFields", pivot_start) {
        let fields_end = find_closing_tag(xml, b"pivotFields", fields_start).unwrap_or(xml.len());
        pivot.pivot_fields = parse_pivot_fields(&xml[fields_start..fields_end]);
    }

    // Parse row fields
    if let Some(row_start) = find_tag_simd(xml, b"rowFields", pivot_start) {
        let row_end = find_closing_tag(xml, b"rowFields", row_start).unwrap_or(xml.len());
        pivot.row_fields = parse_field_refs(&xml[row_start..row_end]);
    }

    // Parse column fields
    if let Some(col_start) = find_tag_simd(xml, b"colFields", pivot_start) {
        let col_end = find_closing_tag(xml, b"colFields", col_start).unwrap_or(xml.len());
        pivot.col_fields = parse_field_refs(&xml[col_start..col_end]);
    }

    // Parse data fields
    if let Some(data_start) = find_tag_simd(xml, b"dataFields", pivot_start) {
        let data_end = find_closing_tag(xml, b"dataFields", data_start).unwrap_or(xml.len());
        pivot.data_fields = parse_data_fields(&xml[data_start..data_end]);
    }

    // Parse page fields
    if let Some(page_start) = find_tag_simd(xml, b"pageFields", pivot_start) {
        let page_end = find_closing_tag(xml, b"pageFields", page_start).unwrap_or(xml.len());
        pivot.page_fields = parse_page_fields(&xml[page_start..page_end]);
    }

    // Parse style info
    if let Some(style_start) = find_tag_simd(xml, b"pivotTableStyleInfo", pivot_start) {
        if let Some(style_end) = find_gt_simd(xml, style_start) {
            let style_element = &xml[style_start..style_end + 1];
            pivot.style_info = Some(parse_style_info(style_element));
        }
    }

    pivot
}

/// Parse a pivot cache definition from pivotCacheDefinition*.xml
///
/// # Arguments
/// * `xml` - Raw bytes of the pivotCacheDefinition XML file
///
/// # Returns
/// Parsed PivotCache structure (without records)
pub fn parse_pivot_cache_definition(xml: &[u8]) -> PivotCache {
    let mut cache = PivotCache::default();

    // Find pivotCacheDefinition element
    let cache_start = match find_tag_simd(xml, b"pivotCacheDefinition", 0) {
        Some(pos) => pos,
        None => return cache,
    };

    // Parse attributes
    if let Some(end) = find_gt_simd(xml, cache_start) {
        let element = &xml[cache_start..end + 1];
        cache.id = parse_u32_attr(element, b"r:id=\"").unwrap_or(0);
        cache.refresh_on_load = parse_bool_attr(element, b"refreshOnLoad=\"");
        cache.record_count = parse_u32_attr(element, b"recordCount=\"");
    }

    // Parse cache source
    if let Some(source_start) = find_tag_simd(xml, b"cacheSource", cache_start) {
        if let Some(source_end) = find_gt_simd(xml, source_start) {
            let source_element = &xml[source_start..source_end + 1];

            // Parse source type
            if let Some(type_str) = parse_string_attr(source_element, b"type=\"") {
                cache.source_type = match type_str.as_str() {
                    "worksheet" => CacheSourceType::Worksheet,
                    "external" => CacheSourceType::External,
                    "consolidation" => CacheSourceType::Consolidation,
                    "scenario" => CacheSourceType::Scenario,
                    _ => CacheSourceType::Worksheet,
                };
            }
        }

        // Parse worksheet source
        if let Some(ws_start) = find_tag_simd(xml, b"worksheetSource", source_start) {
            if let Some(ws_end) = find_gt_simd(xml, ws_start) {
                let ws_element = &xml[ws_start..ws_end + 1];
                cache.source_ref = parse_string_attr(ws_element, b"ref=\"");
                cache.source_sheet = parse_string_attr(ws_element, b"sheet=\"");
            }
        }
    }

    // Parse cache fields
    if let Some(fields_start) = find_tag_simd(xml, b"cacheFields", cache_start) {
        let fields_end = find_closing_tag(xml, b"cacheFields", fields_start).unwrap_or(xml.len());
        cache.fields = parse_cache_fields(&xml[fields_start..fields_end]);
    }

    cache
}

/// Parse pivot cache records from pivotCacheRecords*.xml
///
/// # Arguments
/// * `xml` - Raw bytes of the pivotCacheRecords XML file
///
/// # Returns
/// Vector of CacheRecord
pub fn parse_pivot_cache_records(xml: &[u8]) -> Vec<CacheRecord> {
    let mut records = Vec::new();

    // Find pivotCacheRecords element
    let records_start = match find_tag_simd(xml, b"pivotCacheRecords", 0) {
        Some(pos) => pos,
        None => return records,
    };

    let records_end =
        find_closing_tag(xml, b"pivotCacheRecords", records_start).unwrap_or(xml.len());

    // Parse each <r> element (record)
    let mut pos = records_start;
    while pos < records_end {
        let r_start = match find_tag_simd(&xml[..records_end], b"r", pos) {
            Some(p) if p < records_end => p,
            _ => break,
        };

        // Make sure this is <r> not </r> or part of another tag
        if r_start + 2 < xml.len() {
            let after = xml.get(r_start + 2);
            if after == Some(&b' ') || after == Some(&b'>') || after == Some(&b'/') {
                let r_end = find_closing_tag(xml, b"r", r_start).unwrap_or(records_end);

                // Check for self-closing tag
                let tag_end = find_gt_simd(xml, r_start).unwrap_or(r_end);
                let is_self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');

                if !is_self_closing && r_end > r_start {
                    records.push(parse_cache_record(&xml[r_start..r_end]));
                }

                pos = if is_self_closing {
                    tag_end + 1
                } else {
                    r_end + 1
                };
                continue;
            }
        }

        pos = r_start + 1;
    }

    records
}

// ============================================================================
// Helper Parsing Functions
// ============================================================================

fn parse_location(xml: &[u8]) -> PivotLocation {
    // Typed range refs: — parse the `ref` attribute once at read time into a
    // typed `RangeRef`. Attribute is stored as a raw string in the XML; the
    // grammar (A1 range, possibly sheet-qualified) is resolved here so no
    // downstream consumer re-parses.
    let ref_ = parse_string_attr(xml, b"ref=\"")
        .filter(|s| !s.is_empty())
        .and_then(|s| compute_parser::parse_a1_range(&s));
    PivotLocation {
        ref_,
        first_header_row: parse_u32_attr(xml, b"firstHeaderRow=\"").unwrap_or(0),
        first_data_row: parse_u32_attr(xml, b"firstDataRow=\"").unwrap_or(0),
        first_data_col: parse_u32_attr(xml, b"firstDataCol=\"").unwrap_or(0),
        rows_per_page: parse_u32_attr(xml, b"rowPageCount=\"").unwrap_or(0),
        cols_per_page: parse_u32_attr(xml, b"colPageCount=\"").unwrap_or(0),
    }
}

fn parse_pivot_fields(xml: &[u8]) -> Vec<PivotField> {
    let mut fields = Vec::new();
    let mut pos = 0;
    let mut index = 0u32;

    while let Some(field_start) = find_tag_simd(xml, b"pivotField", pos) {
        // Find the end of the opening tag
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let is_self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');

        let element = &xml[field_start..tag_end + 1];

        let mut field = PivotField {
            index,
            name: parse_string_attr(element, b"name=\""),
            axis: parse_axis_attr(element),
            subtotal_top: parse_bool_attr_with_default(element, b"subtotalTop=\"", true),
            show_all: parse_bool_attr(element, b"showAll=\""),
            sort_type: parse_sort_attr(element),
            data_field: parse_bool_attr(element, b"dataField=\""),
            default_subtotal: parse_bool_attr_with_default(element, b"defaultSubtotal=\"", true),
            compact: parse_bool_attr_with_default(element, b"compact=\"", true),
            outline: parse_bool_attr_with_default(element, b"outline=\"", true),
            ..Default::default()
        };

        // Parse items and autoSortScope within the field (if not self-closing)
        if !is_self_closing {
            let field_end = find_closing_tag(xml, b"pivotField", field_start).unwrap_or(xml.len());

            if let Some(items_start) = find_tag_simd(&xml[field_start..field_end], b"items", 0) {
                let items_abs_start = field_start + items_start;
                let items_end =
                    find_closing_tag(xml, b"items", items_abs_start).unwrap_or(field_end);
                field.items = parse_pivot_items(&xml[items_abs_start..items_end]);
            }

            // Parse autoSortScope — extract the data field index for value-based sorting.
            // XML shape: <autoSortScope><pivotArea ...><references ...>
            //   <reference field="4294967294" ...><x v="N"/></reference>
            // </references></pivotArea></autoSortScope>
            // field="4294967294" (0xFFFFFFFE) is the data-fields sentinel.
            let field_body = &xml[field_start..field_end];
            if let Some(auto_sort_start) = find_tag_simd(field_body, b"autoSortScope", 0) {
                let auto_sort_end = find_closing_tag(field_body, b"autoSortScope", auto_sort_start)
                    .unwrap_or(field_body.len());
                let scope = &field_body[auto_sort_start..auto_sort_end];
                // Look for <reference field="4294967294" ...> then <x v="N"/>
                if let Some(ref_start) = find_tag_simd(scope, b"reference", 0) {
                    let ref_tag_end = find_gt_simd(scope, ref_start).unwrap_or(scope.len());
                    let ref_element = &scope[ref_start..ref_tag_end + 1];
                    let field_val = parse_u32_attr(ref_element, b"field=\"");
                    if field_val == Some(4294967294) {
                        // Find <x v="N"/> inside the reference scope
                        if let Some(x_start) = find_tag_simd(scope, b"x", ref_start) {
                            let x_end = find_gt_simd(scope, x_start).unwrap_or(scope.len());
                            let x_element = &scope[x_start..x_end + 1];
                            field.auto_sort_data_field = parse_u32_attr(x_element, b"v=\"");
                        }
                    }

                    // Look for a second <reference> (column field for sort-by-value).
                    let ref1_end =
                        find_closing_tag(scope, b"reference", ref_start).unwrap_or(ref_tag_end + 1);
                    if let Some(ref2_start) = find_tag_simd(scope, b"reference", ref1_end) {
                        let ref2_tag_end = find_gt_simd(scope, ref2_start).unwrap_or(scope.len());
                        let ref2_element = &scope[ref2_start..ref2_tag_end + 1];
                        field.auto_sort_column_field = parse_u32_attr(ref2_element, b"field=\"");
                        // Find <x v="N"/> inside the second reference
                        let ref2_close = find_closing_tag(scope, b"reference", ref2_start)
                            .unwrap_or(scope.len());
                        if let Some(x2_start) =
                            find_tag_simd(&scope[ref2_start..ref2_close], b"x", 0)
                        {
                            let x2_abs = ref2_start + x2_start;
                            let x2_end = find_gt_simd(scope, x2_abs).unwrap_or(scope.len());
                            let x2_element = &scope[x2_abs..x2_end + 1];
                            field.auto_sort_column_item = parse_u32_attr(x2_element, b"v=\"");
                        }
                    }
                }
            }

            pos = field_end + 1;
        } else {
            pos = tag_end + 1;
        }

        fields.push(field);
        index += 1;
    }

    fields
}

fn parse_pivot_items(xml: &[u8]) -> Vec<PivotItem> {
    let mut items = Vec::new();
    let mut pos = 0;

    while let Some(item_start) = find_tag_simd(xml, b"item", pos) {
        let tag_end = find_gt_simd(xml, item_start).unwrap_or(xml.len());
        let element = &xml[item_start..tag_end + 1];

        let item_type = parse_item_type_attr(element);
        let x = parse_u32_attr(element, b"x=\"");
        let hidden = parse_bool_attr(element, b"h=\"");
        let show_details = parse_bool_attr_with_default(element, b"sd=\"", true);
        let s = parse_string_attr(element, b"s=\"");

        items.push(PivotItem {
            item_type,
            x,
            hidden,
            show_details,
            s,
        });

        pos = tag_end + 1;
    }

    items
}

fn parse_field_refs(xml: &[u8]) -> Vec<PivotFieldRef> {
    let mut refs = Vec::new();
    let mut pos = 0;

    while let Some(field_start) = find_tag_simd(xml, b"field", pos) {
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let element = &xml[field_start..tag_end + 1];

        let x = parse_i32_attr(element, b"x=\"").unwrap_or(0);
        refs.push(PivotFieldRef { x });

        pos = tag_end + 1;
    }

    refs
}

fn parse_data_fields(xml: &[u8]) -> Vec<DataField> {
    let mut fields = Vec::new();
    let mut pos = 0;

    while let Some(field_start) = find_tag_simd(xml, b"dataField", pos) {
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let element = &xml[field_start..tag_end + 1];

        let subtotal = parse_subtotal_attr(element);
        let show_data_as = parse_string_attr(element, b"showDataAs=\"");

        // If the tag is NOT self-closing, check for x14 extension pivotShowAs
        // inside the child content, then skip past </dataField>.
        let mut ext_show_data_as = show_data_as;
        if tag_end > 0 && xml[tag_end - 1] != b'/' {
            if let Some(close) = find_closing_tag(xml, b"dataField", field_start) {
                if ext_show_data_as.is_none() {
                    let inner = &xml[tag_end + 1..close];
                    ext_show_data_as = parse_string_attr(inner, b"pivotShowAs=\"");
                }
                fields.push(DataField {
                    name: parse_string_attr(element, b"name=\""),
                    field_index: parse_u32_attr(element, b"fld=\"").unwrap_or(0),
                    subtotal,
                    num_fmt_id: parse_u32_attr(element, b"numFmtId=\""),
                    base_field: parse_i32_attr(element, b"baseField=\""),
                    base_item: parse_u32_attr(element, b"baseItem=\""),
                    show_data_as: ext_show_data_as,
                });
                pos = close;
                continue;
            }
        }

        fields.push(DataField {
            name: parse_string_attr(element, b"name=\""),
            field_index: parse_u32_attr(element, b"fld=\"").unwrap_or(0),
            subtotal,
            num_fmt_id: parse_u32_attr(element, b"numFmtId=\""),
            base_field: parse_i32_attr(element, b"baseField=\""),
            base_item: parse_u32_attr(element, b"baseItem=\""),
            show_data_as: ext_show_data_as,
        });
        pos = tag_end + 1;
    }

    fields
}

fn parse_page_fields(xml: &[u8]) -> Vec<PageField> {
    let mut fields = Vec::new();
    let mut pos = 0;

    while let Some(field_start) = find_tag_simd(xml, b"pageField", pos) {
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let element = &xml[field_start..tag_end + 1];

        fields.push(PageField {
            field_index: parse_i32_attr(element, b"fld=\"").unwrap_or(0),
            item: parse_u32_attr(element, b"item=\""),
            hierarchy: parse_i32_attr(element, b"hier=\""),
            name: parse_string_attr(element, b"name=\""),
            caption: parse_string_attr(element, b"cap=\""),
        });

        pos = tag_end + 1;
    }

    fields
}

fn parse_style_info(xml: &[u8]) -> PivotStyleInfo {
    PivotStyleInfo {
        name: parse_string_attr(xml, b"name=\""),
        show_row_headers: parse_bool_attr(xml, b"showRowHeaders=\""),
        show_col_headers: parse_bool_attr(xml, b"showColHeaders=\""),
        show_row_stripes: parse_bool_attr(xml, b"showRowStripes=\""),
        show_col_stripes: parse_bool_attr(xml, b"showColStripes=\""),
        show_last_column: parse_bool_attr(xml, b"showLastColumn=\""),
    }
}

fn parse_cache_fields(xml: &[u8]) -> Vec<CacheField> {
    let mut fields = Vec::new();
    let mut pos = 0;

    while let Some(field_start) = find_tag_simd(xml, b"cacheField", pos) {
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let is_self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');
        let element = &xml[field_start..tag_end + 1];

        let mut field = CacheField {
            name: parse_string_attr(element, b"name=\"").unwrap_or_default(),
            num_fmt_id: parse_u32_attr(element, b"numFmtId=\""),
            sql_type: parse_i32_attr(element, b"sqlType=\""),
            caption: parse_string_attr(element, b"caption=\""),
            ..Default::default()
        };

        // Parse shared items
        if !is_self_closing {
            let field_end = find_closing_tag(xml, b"cacheField", field_start).unwrap_or(xml.len());

            if let Some(items_start) =
                find_tag_simd(&xml[field_start..field_end], b"sharedItems", 0)
            {
                let items_abs_start = field_start + items_start;
                let items_tag_end = find_gt_simd(xml, items_abs_start).unwrap_or(field_end);
                let items_element = &xml[items_abs_start..items_tag_end + 1];

                // Parse containsXXX attributes
                field.contains_date = parse_bool_attr(items_element, b"containsDate=\"");
                field.contains_number = parse_bool_attr(items_element, b"containsNumber=\"");
                field.contains_integer = parse_bool_attr(items_element, b"containsInteger=\"");
                field.contains_blank = parse_bool_attr(items_element, b"containsBlank=\"");
                field.contains_mixed_types =
                    parse_bool_attr(items_element, b"containsMixedTypes=\"");

                let items_end =
                    find_closing_tag(xml, b"sharedItems", items_abs_start).unwrap_or(field_end);
                field.shared_items = parse_shared_items(&xml[items_abs_start..items_end]);
            }

            pos = field_end + 1;
        } else {
            pos = tag_end + 1;
        }

        fields.push(field);
    }

    fields
}

fn parse_shared_items(xml: &[u8]) -> Vec<SharedItem> {
    let mut items = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        // Find next < character
        let lt_pos = match memchr::memchr(b'<', &xml[pos..]) {
            Some(p) => pos + p,
            None => break,
        };

        // Skip closing tags
        if lt_pos + 1 < xml.len() && xml[lt_pos + 1] == b'/' {
            pos = lt_pos + 1;
            continue;
        }

        // Identify the tag type
        if lt_pos + 2 < xml.len() {
            let tag_start = lt_pos;
            let tag_end = find_gt_simd(xml, tag_start).unwrap_or(xml.len());
            let element = &xml[tag_start..tag_end + 1];

            let tag_byte = xml[lt_pos + 1];

            match tag_byte {
                b's' => {
                    // <s v="..."/> - string
                    if let Some(v) = parse_string_attr(element, b"v=\"") {
                        items.push(SharedItem::String(v));
                    }
                }
                b'n' => {
                    // <n v="..."/> - number
                    if let Some(v) = parse_f64_attr(element, b"v=\"") {
                        items.push(SharedItem::Number(v));
                    }
                }
                b'b' => {
                    // <b v="..."/> - boolean
                    let v = parse_bool_attr(element, b"v=\"");
                    items.push(SharedItem::Boolean(v));
                }
                b'e' => {
                    // <e v="..."/> - error
                    if let Some(v) = parse_string_attr(element, b"v=\"") {
                        items.push(SharedItem::Error(v));
                    }
                }
                b'd' => {
                    // <d v="..."/> - date
                    if let Some(v) = parse_string_attr(element, b"v=\"") {
                        items.push(SharedItem::DateTime(v));
                    }
                }
                b'm' => {
                    // <m/> - missing
                    items.push(SharedItem::Missing);
                }
                _ => {}
            }

            pos = tag_end + 1;
        } else {
            break;
        }
    }

    items
}

fn parse_cache_record(xml: &[u8]) -> CacheRecord {
    let mut record = CacheRecord::default();
    let mut pos = 0;

    while pos < xml.len() {
        let lt_pos = match memchr::memchr(b'<', &xml[pos..]) {
            Some(p) => pos + p,
            None => break,
        };

        // Skip closing tags
        if lt_pos + 1 < xml.len() && xml[lt_pos + 1] == b'/' {
            pos = lt_pos + 1;
            continue;
        }

        if lt_pos + 2 < xml.len() {
            let tag_start = lt_pos;
            let tag_end = find_gt_simd(xml, tag_start).unwrap_or(xml.len());
            let element = &xml[tag_start..tag_end + 1];

            let tag_byte = xml[lt_pos + 1];

            match tag_byte {
                b'x' => {
                    // <x v="..."/> - index into shared items
                    if let Some(v) = parse_u32_attr(element, b"v=\"") {
                        record.values.push(CacheRecordValue::Index(v));
                    }
                }
                b's' => {
                    // <s v="..."/> - inline string
                    if let Some(v) = parse_string_attr(element, b"v=\"") {
                        record.values.push(CacheRecordValue::String(v));
                    }
                }
                b'n' => {
                    // <n v="..."/> - inline number
                    if let Some(v) = parse_f64_attr(element, b"v=\"") {
                        record.values.push(CacheRecordValue::Number(v));
                    }
                }
                b'b' => {
                    // <b v="..."/> - inline boolean
                    let v = parse_bool_attr(element, b"v=\"");
                    record.values.push(CacheRecordValue::Boolean(v));
                }
                b'e' => {
                    // <e v="..."/> - inline error
                    if let Some(v) = parse_string_attr(element, b"v=\"") {
                        record.values.push(CacheRecordValue::Error(v));
                    }
                }
                b'd' => {
                    // <d v="..."/> - inline date
                    if let Some(v) = parse_string_attr(element, b"v=\"") {
                        record.values.push(CacheRecordValue::DateTime(v));
                    }
                }
                b'm' => {
                    // <m/> - missing
                    record.values.push(CacheRecordValue::Missing);
                }
                _ => {}
            }

            pos = tag_end + 1;
        } else {
            break;
        }
    }

    record
}

// ============================================================================
// Module-Specific Attribute Parsing Helpers
// ============================================================================

fn parse_axis_attr(xml: &[u8]) -> Option<PivotAxis> {
    let axis_str = parse_string_attr(xml, b"axis=\"")?;
    match axis_str.as_str() {
        "axisRow" => Some(PivotAxis::Row),
        "axisCol" => Some(PivotAxis::Col),
        "axisPage" => Some(PivotAxis::Page),
        "axisValues" => Some(PivotAxis::Values),
        _ => None,
    }
}

fn parse_sort_attr(xml: &[u8]) -> Option<SortType> {
    let sort_str = parse_string_attr(xml, b"sortType=\"")?;
    match sort_str.as_str() {
        "manual" => Some(SortType::Manual),
        "ascending" => Some(SortType::Ascending),
        "descending" => Some(SortType::Descending),
        _ => None,
    }
}

fn parse_subtotal_attr(xml: &[u8]) -> Subtotal {
    if let Some(subtotal_str) = parse_string_attr(xml, b"subtotal=\"") {
        match subtotal_str.as_str() {
            "sum" => Subtotal::Sum,
            "count" => Subtotal::Count,
            "average" => Subtotal::Average,
            "max" => Subtotal::Max,
            "min" => Subtotal::Min,
            "product" => Subtotal::Product,
            "countNums" => Subtotal::CountNums,
            "stdDev" => Subtotal::StdDev,
            "stdDevp" => Subtotal::StdDevP,
            "var" => Subtotal::Var,
            "varp" => Subtotal::VarP,
            _ => Subtotal::Sum,
        }
    } else {
        Subtotal::Sum
    }
}

fn parse_item_type_attr(xml: &[u8]) -> PivotItemType {
    if let Some(type_str) = parse_string_attr(xml, b"t=\"") {
        match type_str.as_str() {
            "data" => PivotItemType::Data,
            "default" => PivotItemType::Default,
            "sum" => PivotItemType::Sum,
            "countA" => PivotItemType::CountA,
            "avg" => PivotItemType::Avg,
            "max" => PivotItemType::Max,
            "min" => PivotItemType::Min,
            "product" => PivotItemType::Product,
            "count" => PivotItemType::Count,
            "stdDev" => PivotItemType::Stddev,
            "stdDevP" => PivotItemType::StddevP,
            "var" => PivotItemType::Var,
            "varP" => PivotItemType::VarP,
            "grand" => PivotItemType::Grand,
            "blank" => PivotItemType::Blank,
            _ => PivotItemType::Data,
        }
    } else {
        PivotItemType::Data
    }
}

// ============================================================================
// Archive-level Pivot Parsing (parse_helpers migration)
// ============================================================================

/// Parse all pivot cache definitions from the workbook.
///
/// Reads `xl/workbook.xml` for `<pivotCaches>` entries (mapping cacheId to r:id),
/// and `xl/_rels/workbook.xml.rels` to resolve each r:id to a file path, then
/// parses each cache definition XML.
///
/// Parse a pivot cache definition XML into an ooxml_types PivotCacheDefinition.
///
/// Delegates to the existing `parse_pivot_cache_definition()` which does the
/// XML parsing, then maps the result to the ooxml type system.
fn pivot_cache_to_ooxml(xml: &[u8]) -> ooxml_types::pivot::PivotCacheDefinition {
    let parsed = parse_pivot_cache_definition(xml);

    let cache_source = ooxml_types::pivot::PivotCacheSource {
        r#type: match parsed.source_type {
            CacheSourceType::Worksheet => ooxml_types::pivot::PivotSourceType::Worksheet,
            CacheSourceType::External => ooxml_types::pivot::PivotSourceType::External,
            CacheSourceType::Consolidation => ooxml_types::pivot::PivotSourceType::Consolidation,
            CacheSourceType::Scenario => ooxml_types::pivot::PivotSourceType::Scenario,
        },
        worksheet_source: if parsed.source_ref.is_some() || parsed.source_sheet.is_some() {
            Some(ooxml_types::pivot::WorksheetSource {
                r#ref: parsed.source_ref,
                sheet: parsed.source_sheet,
                name: None,
                r_id: None,
            })
        } else {
            None
        },
        ..Default::default()
    };

    let cache_fields = ooxml_types::pivot::PivotCacheFields {
        count: Some(parsed.fields.len() as u32),
        items: parsed
            .fields
            .iter()
            .map(|f| {
                let shared_items = if f.shared_items.is_empty() {
                    None
                } else {
                    Some(convert_shared_items_to_ooxml(&f.shared_items, f))
                };
                ooxml_types::pivot::PivotCacheField {
                    name: f.name.clone(),
                    caption: f.caption.clone(),
                    num_fmt_id: f.num_fmt_id,
                    sql_type: f.sql_type,
                    shared_items,
                    ..Default::default()
                }
            })
            .collect(),
    };

    ooxml_types::pivot::PivotCacheDefinition {
        refresh_on_load: parsed.refresh_on_load,
        record_count: parsed.record_count,
        cache_source,
        cache_fields,
        ..Default::default()
    }
}

/// Convert parser SharedItem vec to ooxml SharedItems struct.
fn convert_shared_items_to_ooxml(
    items: &[SharedItem],
    field: &CacheField,
) -> ooxml_types::pivot::SharedItems {
    let mut ooxml_items = Vec::with_capacity(items.len());
    let mut s_vec = Vec::new();
    let mut n_vec = Vec::new();
    let mut b_vec = Vec::new();
    let mut e_vec = Vec::new();
    let mut d_vec = Vec::new();
    let mut m_vec = Vec::new();

    for item in items {
        match item {
            SharedItem::String(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::String(v.clone()));
                s_vec.push(ooxml_types::pivot::PivotCacheString {
                    v: v.clone(),
                    ..Default::default()
                });
            }
            SharedItem::Number(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::Number(*v));
                n_vec.push(ooxml_types::pivot::PivotNumber {
                    v: *v,
                    ..Default::default()
                });
            }
            SharedItem::Boolean(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::Boolean(*v));
                b_vec.push(ooxml_types::pivot::PivotBoolean {
                    v: *v,
                    ..Default::default()
                });
            }
            SharedItem::Error(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::Error(v.clone()));
                e_vec.push(ooxml_types::pivot::PivotError {
                    v: v.clone(),
                    ..Default::default()
                });
            }
            SharedItem::DateTime(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::DateTime(v.clone()));
                d_vec.push(ooxml_types::pivot::PivotDateTime {
                    v: v.clone(),
                    ..Default::default()
                });
            }
            SharedItem::Missing => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::Missing);
                m_vec.push(ooxml_types::pivot::PivotMissing::default());
            }
        }
    }

    ooxml_types::pivot::SharedItems {
        count: Some(items.len() as u32),
        contains_date: field.contains_date,
        contains_number: field.contains_number,
        contains_integer: field.contains_integer,
        contains_blank: field.contains_blank,
        contains_mixed_types: field.contains_mixed_types,
        items: ooxml_items,
        s: s_vec,
        n: n_vec,
        b: b_vec,
        e: e_vec,
        d: d_vec,
        m: m_vec,
        ..Default::default()
    }
}

/// Parse pivot cache records XML into an ooxml_types PivotCacheRecords.
///
/// TODO: Implement full parsing; currently returns a default stub.
fn pivot_cache_records_to_ooxml(xml: &[u8]) -> ooxml_types::pivot::PivotCacheRecords {
    let parsed = parse_pivot_cache_records(xml);
    let count = parsed.len() as u32;
    let records = parsed
        .into_iter()
        .map(|rec| ooxml_types::pivot::cache::PivotRecord {
            values: rec
                .values
                .into_iter()
                .map(|v| match v {
                    CacheRecordValue::Index(i) => {
                        ooxml_types::pivot::cache::PivotRecordValue::Index(i)
                    }
                    CacheRecordValue::Number(n) => {
                        ooxml_types::pivot::cache::PivotRecordValue::Number(n)
                    }
                    CacheRecordValue::String(s) => {
                        ooxml_types::pivot::cache::PivotRecordValue::String(s)
                    }
                    CacheRecordValue::Boolean(b) => {
                        ooxml_types::pivot::cache::PivotRecordValue::Boolean(b)
                    }
                    CacheRecordValue::Error(e) => {
                        ooxml_types::pivot::cache::PivotRecordValue::Error(e)
                    }
                    CacheRecordValue::DateTime(d) => {
                        ooxml_types::pivot::cache::PivotRecordValue::DateTime(d)
                    }
                    CacheRecordValue::Missing => {
                        ooxml_types::pivot::cache::PivotRecordValue::Missing
                    }
                })
                .collect(),
        })
        .collect();
    ooxml_types::pivot::PivotCacheRecords {
        count: Some(count),
        records,
        ext_lst: None,
    }
}

/// # Arguments
/// * `archive` - The XLSX archive
///
/// # Returns
/// A HashMap mapping cache IDs to parsed PivotCache structures
/// Parse all pivot caches from the workbook.
///
/// Returns:
/// - `HashMap<u32, super::types::ParsedPivotCache>` — cache_id → parsed cache definition
/// - `Vec<(u32, String, Option<String>)>` — (cache_id, definition_path, records_path) for path-faithful writing
pub fn parse_all_pivot_caches(archive: &crate::zip::XlsxArchive) -> ParsedPivotCaches {
    let mut caches = std::collections::HashMap::new();
    let mut cache_paths = Vec::new();

    // Read workbook.xml to find <pivotCaches> entries
    let workbook_xml = match archive.read_file("xl/workbook.xml") {
        Ok(xml) => xml,
        Err(_) => return (caches, cache_paths),
    };

    // Read workbook rels to resolve r:id -> target path
    let wb_rels_xml = match archive.read_file("xl/_rels/workbook.xml.rels") {
        Ok(xml) => xml,
        Err(_) => return (caches, cache_paths),
    };

    // Build r:id -> typed pivot cache definition path map from workbook rels.
    let workbook_relationships = parse_owned_relationships(PackageOwner::Workbook, &wb_rels_xml);
    let workbook_relationships = WorkbookRelationships::new(&workbook_relationships);
    let rels_map: std::collections::HashMap<String, String> = workbook_relationships
        .pivot_cache_definitions()
        .into_iter()
        .filter_map(|rel| {
            rel.target
                .path()
                .map(|path| (rel.id.clone(), path.to_string()))
        })
        .collect();

    // Parse <pivotCaches><pivotCache cacheId="X" r:id="rIdY"/></pivotCaches>
    let pivot_caches_entries = extract_pivot_cache_entries(&workbook_xml);

    for (cache_id, r_id) in pivot_caches_entries {
        if let Some(target) = rels_map.get(&r_id) {
            let def_path = target.clone();
            if let Ok(cache_xml) = archive.read_file(&def_path) {
                let definition = pivot_cache_to_ooxml(&cache_xml);
                let raw_definition_xml = Some(cache_xml);

                // Try to find the corresponding records file via the cache definition's .rels
                let cache_dir = def_path
                    .rsplit_once('/')
                    .map(|(d, _)| d)
                    .unwrap_or("xl/pivotCache");
                let cache_filename = def_path.rsplit('/').next().unwrap_or("");
                let cache_rels_path = format!("{}/_rels/{}.rels", cache_dir, cache_filename);
                let records_path = if let Ok(cache_rels_xml) = archive.read_file(&cache_rels_path) {
                    let cache_relationships = parse_owned_relationships(
                        PackageOwner::PivotCache {
                            path: def_path.clone(),
                        },
                        &cache_rels_xml,
                    );
                    cache_relationships
                        .iter()
                        .find(|rel| rel.rel_type == OoxmlRelationshipType::PivotCacheRecords)
                        .and_then(|rel| rel.target.path().map(ToOwned::to_owned))
                } else {
                    let records_guess =
                        def_path.replace("pivotCacheDefinition", "pivotCacheRecords");
                    if archive.read_file(&records_guess).is_ok() {
                        Some(records_guess)
                    } else {
                        None
                    }
                };

                let mut records = ooxml_types::pivot::PivotCacheRecords::default();
                let mut raw_records_xml = None;
                if let Some(ref rp) = records_path {
                    if let Ok(records_xml) = archive.read_file(rp) {
                        records = pivot_cache_records_to_ooxml(&records_xml);
                        raw_records_xml = Some(records_xml);
                    }
                }

                cache_paths.push((cache_id, def_path, records_path));
                caches.insert(
                    cache_id,
                    super::types::ParsedPivotCache {
                        definition,
                        records,
                        raw_definition_xml,
                        raw_records_xml,
                    },
                );
            }
        }
    }

    (caches, cache_paths)
}

/// Parse pivot tables for a specific sheet.
///
/// Parse pivot tables for a sheet and convert directly to `ParsedPivotTable`
/// (compute-ready config + OOXML sidecar).
pub fn parse_pivot_tables_for_sheet_v2(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
    sheet_name: &str,
    pivot_caches: &std::collections::HashMap<u32, super::types::ParsedPivotCache>,
) -> Vec<domain_types::domain::pivot::ParsedPivotTable> {
    let mut results = Vec::new();

    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let pivot_paths = if let Ok(rels_xml) = archive.read_file(&rels_path) {
        extract_pivot_table_paths_for_sheet(sheet_num, &rels_xml)
    } else {
        Vec::new()
    };

    for full_path in &pivot_paths {
        if let Ok(pivot_xml) = archive.read_file(full_path) {
            let pt = parse_pivot_table(&pivot_xml);
            let cache = pivot_caches
                .get(&pt.cache_id)
                .map(|pc| build_full_pivot_cache_for_converter(pc, pt.cache_id));
            if let Some(ref cache) = cache {
                let cache_records = resolve_cache_records(pivot_caches.get(&pt.cache_id));
                if let Some(parsed) =
                    crate::output::to_parse_output::pivot_convert::parsed_pivot_to_config(
                        &pt,
                        cache,
                        sheet_name,
                        &cache_records,
                    )
                {
                    results.push(parsed);
                }
            }
        }
    }

    results
}

/// Resolve cache records from a ParsedPivotCache, dereferencing shared item indices.
fn resolve_cache_records(
    parsed_cache: Option<&super::types::ParsedPivotCache>,
) -> Vec<Vec<value_types::CellValue>> {
    let pc = match parsed_cache {
        Some(pc) => pc,
        None => return Vec::new(),
    };

    let fields = &pc.definition.cache_fields.items;
    let records = &pc.records.records;

    fn shared_item_to_cell_value(item: &ooxml_types::pivot::SharedItem) -> value_types::CellValue {
        use ooxml_types::pivot::SharedItem;
        match item {
            SharedItem::Number(n) => value_types::CellValue::number(*n),
            SharedItem::String(s) => value_types::CellValue::Text(s.as_str().into()),
            SharedItem::Boolean(b) => value_types::CellValue::Boolean(*b),
            SharedItem::Error(e) => e
                .parse::<value_types::CellError>()
                .map(|e| value_types::CellValue::Error(e, None))
                .unwrap_or(value_types::CellValue::Null),
            SharedItem::DateTime(s) => value_types::CellValue::Text(s.as_str().into()),
            SharedItem::Missing => value_types::CellValue::Null,
        }
    }

    records
        .iter()
        .map(|record| {
            record
                .values
                .iter()
                .enumerate()
                .map(|(field_idx, val)| {
                    use ooxml_types::pivot::cache::PivotRecordValue;
                    match val {
                        PivotRecordValue::Number(n) => value_types::CellValue::number(*n),
                        PivotRecordValue::String(s) => {
                            value_types::CellValue::Text(s.as_str().into())
                        }
                        PivotRecordValue::Boolean(b) => value_types::CellValue::Boolean(*b),
                        PivotRecordValue::Error(e) => e
                            .parse::<value_types::CellError>()
                            .map(|e| value_types::CellValue::Error(e, None))
                            .unwrap_or(value_types::CellValue::Null),
                        PivotRecordValue::DateTime(s) => {
                            value_types::CellValue::Text(s.as_str().into())
                        }
                        PivotRecordValue::Missing => value_types::CellValue::Null,
                        PivotRecordValue::Index(idx) => fields
                            .get(field_idx)
                            .and_then(|f| f.shared_items.as_ref())
                            .and_then(|shared| shared.items.get(*idx as usize))
                            .map(shared_item_to_cell_value)
                            .unwrap_or(value_types::CellValue::Null),
                    }
                })
                .collect()
        })
        .collect()
}

/// Build a full PivotCache (read.rs type) from ParsedPivotCache for the new converter.
/// Includes shared items for filter/sort resolution.
fn build_full_pivot_cache_for_converter(
    pc: &super::types::ParsedPivotCache,
    cache_id: u32,
) -> PivotCache {
    let ws_src = pc.definition.cache_source.worksheet_source.as_ref();
    PivotCache {
        id: cache_id,
        source_ref: ws_src.and_then(|s| s.r#ref.clone()),
        source_sheet: ws_src.and_then(|s| s.sheet.clone()),
        fields: pc
            .definition
            .cache_fields
            .items
            .iter()
            .map(|f| {
                let shared_items = f
                    .shared_items
                    .as_ref()
                    .map(|si| {
                        si.items
                            .iter()
                            .map(|item| {
                                use ooxml_types::pivot::SharedItem as OoxmlSharedItem;
                                match item {
                                    OoxmlSharedItem::Number(n) => SharedItem::Number(*n),
                                    OoxmlSharedItem::String(s) => SharedItem::String(s.clone()),
                                    OoxmlSharedItem::Boolean(b) => SharedItem::Boolean(*b),
                                    OoxmlSharedItem::Error(e) => SharedItem::Error(e.clone()),
                                    OoxmlSharedItem::DateTime(s) => SharedItem::DateTime(s.clone()),
                                    OoxmlSharedItem::Missing => SharedItem::Missing,
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                CacheField {
                    name: f.name.clone(),
                    shared_items,
                    ..CacheField::default()
                }
            })
            .collect(),
        ..PivotCache::default()
    }
}

/// Extract pivot cache entries from workbook.xml.
///
/// Parses `<pivotCaches><pivotCache cacheId="X" r:id="rIdY"/></pivotCaches>`
/// and returns a Vec of (cacheId, r:id) pairs.
fn extract_pivot_cache_entries(workbook_xml: &[u8]) -> Vec<(u32, String)> {
    use crate::infra::scanner::{
        extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
    };
    let mut entries = Vec::new();

    // Find the <pivotCaches> section
    let section_start = match find_tag_simd(workbook_xml, b"pivotCaches", 0) {
        Some(pos) => pos,
        None => return entries,
    };
    let section_end =
        find_closing_tag(workbook_xml, b"pivotCaches", section_start).unwrap_or(workbook_xml.len());
    let section = &workbook_xml[section_start..section_end];

    let mut pos = 0;
    while let Some(pc_start) = find_tag_simd(section, b"pivotCache", pos) {
        let pc_end = find_gt_simd(section, pc_start)
            .map(|p| p + 1)
            .unwrap_or(section.len());
        let pc_elem = &section[pc_start..pc_end];

        let cache_id = find_attr_simd(pc_elem, b"cacheId=\"", 0).and_then(|p| {
            let vs = p + 9; // len of 'cacheId="'
            extract_quoted_value(pc_elem, vs).and_then(|(s, e)| {
                std::str::from_utf8(&pc_elem[s..e])
                    .ok()?
                    .parse::<u32>()
                    .ok()
            })
        });

        let r_id = find_attr_simd(pc_elem, b"r:id=\"", 0).and_then(|p| {
            let vs = p + 6; // len of 'r:id="'
            extract_quoted_value(pc_elem, vs).and_then(|(s, e)| {
                std::str::from_utf8(&pc_elem[s..e])
                    .ok()
                    .map(|v| v.to_string())
            })
        });

        if let (Some(cid), Some(rid)) = (cache_id, r_id) {
            entries.push((cid, rid));
        }

        pos = pc_start + 1;
    }

    entries
}

fn extract_pivot_table_paths_for_sheet(sheet_num: usize, rels_xml: &[u8]) -> Vec<String> {
    let relationships = parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        rels_xml,
    );
    WorksheetRelationships::new(&relationships)
        .pivot_tables()
        .into_iter()
        .filter_map(|rel| rel.target.path().map(ToOwned::to_owned))
        .collect()
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests;
