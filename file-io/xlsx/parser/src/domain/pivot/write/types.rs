//! Type definitions for pivot tables and pivot caches.
//!
//! This module contains all the type definitions used for pivot tables including
//! enums, shared items, field definitions, and style settings.

use crate::write::xml_writer::XmlWriter;
use domain_types::domain::pivot::PivotRawXmlAttribute;

// ============================================================================
// Enums
// ============================================================================

/// Pivot field axis
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, xml_derive::XmlEnum)]
pub enum PivotAxis {
    /// Row axis
    #[default]
    #[xml("axisRow")]
    AxisRow,
    /// Column axis
    #[xml("axisCol")]
    AxisCol,
    /// Page (filter) axis
    #[xml("axisPage")]
    AxisPage,
    /// Values axis
    #[xml("axisValues")]
    AxisValues,
}

/// Aggregation function for data fields
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, xml_derive::XmlEnum)]
pub enum DataFieldFunction {
    /// Sum function (default)
    #[default]
    #[xml("sum")]
    Sum,
    /// Count function
    #[xml("count")]
    Count,
    /// Average function
    #[xml("average")]
    Average,
    /// Maximum function
    #[xml("max")]
    Max,
    /// Minimum function
    #[xml("min")]
    Min,
    /// Product function
    #[xml("product")]
    Product,
    /// Count numbers function
    #[xml("countNums")]
    CountNums,
    /// Standard deviation function
    #[xml("stdDev")]
    StdDev,
    /// Standard deviation (population) function
    #[xml("stdDevp")]
    StdDevP,
    /// Variance function
    #[xml("var")]
    Var,
    /// Variance (population) function
    #[xml("varp")]
    VarP,
}

/// Pivot item type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, xml_derive::XmlEnum)]
pub enum PivotItemType {
    /// Regular data item
    #[default]
    #[xml("data")]
    Data,
    /// Default (automatic) item
    #[xml("default")]
    Default,
    /// Sum subtotal
    #[xml("sum")]
    Sum,
    /// Count A subtotal
    #[xml("countA")]
    CountA,
    /// Average subtotal
    #[xml("avg")]
    Avg,
    /// Maximum subtotal
    #[xml("max")]
    Max,
    /// Minimum subtotal
    #[xml("min")]
    Min,
    /// Product subtotal
    #[xml("product")]
    Product,
    /// Count subtotal
    #[xml("count")]
    Count,
    /// Standard deviation subtotal
    #[xml("stdDev")]
    StdDev,
    /// Standard deviation (population) subtotal
    #[xml("stdDevP")]
    StdDevP,
    /// Variance subtotal
    #[xml("var")]
    Var,
    /// Variance (population) subtotal
    #[xml("varP")]
    VarP,
    /// Grand total
    #[xml("grand")]
    Grand,
    /// Blank item
    #[xml("blank")]
    Blank,
}

/// Cache source type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, xml_derive::XmlEnum)]
pub enum CacheSourceType {
    /// Worksheet range (default)
    #[default]
    #[xml("worksheet")]
    Worksheet,
    /// External data source
    #[xml("external")]
    External,
    /// Consolidation of multiple ranges
    #[xml("consolidation")]
    Consolidation,
    /// Scenario
    #[xml("scenario")]
    Scenario,
}

// ============================================================================
// Shared Item
// ============================================================================

/// Shared item values in cache field (and cache records)
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
    /// Missing/blank value
    Missing,
    /// Index into shared items (used in cache records: `<x v="N"/>`)
    Index(u32),
    /// Date/time value (ISO 8601 format, used in cache records: `<d v="..."/>`)
    DateTime(String),
}

impl Default for SharedItem {
    fn default() -> Self {
        SharedItem::Missing
    }
}

impl SharedItem {
    /// Write the shared item to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        match self {
            SharedItem::String(s) => {
                w.empty_element("s", &[("v", s)]);
            }
            SharedItem::Number(n) => {
                let n_str = format_number(*n);
                w.empty_element("n", &[("v", &n_str)]);
            }
            SharedItem::Boolean(b) => {
                w.empty_element("b", &[("v", if *b { "1" } else { "0" })]);
            }
            SharedItem::Error(e) => {
                w.empty_element("e", &[("v", e)]);
            }
            SharedItem::Missing => {
                w.empty_element("m", &[]);
            }
            SharedItem::Index(i) => {
                let i_str = i.to_string();
                w.empty_element("x", &[("v", &i_str)]);
            }
            SharedItem::DateTime(d) => {
                w.empty_element("d", &[("v", d)]);
            }
        }
    }
}

// ============================================================================
// Pivot Field Item
// ============================================================================

/// Pivot field item (for row/column fields)
#[derive(Debug, Clone, Default)]
pub struct PivotFieldItem {
    /// Item type
    pub item_type: PivotItemType,
    /// Index into shared items (for data items)
    pub value: Option<u32>,
    /// Whether this item is hidden
    pub hidden: bool,
    /// Whether children are expanded (`sd` attribute). Defaults to true.
    pub show_details: bool,
    /// Calculated item string/formula (s attribute)
    pub s: Option<String>,
    /// Unmodeled item attributes preserved from imported OOXML.
    pub preserved_attributes: Vec<PivotRawXmlAttribute>,
}

impl PivotFieldItem {
    /// Create a new data item with the given index
    pub fn data(index: u32) -> Self {
        Self {
            item_type: PivotItemType::Data,
            value: Some(index),
            hidden: false,
            show_details: true,
            s: None,
            preserved_attributes: Vec::new(),
        }
    }

    /// Create a default item
    pub fn default_item() -> Self {
        Self {
            item_type: PivotItemType::Default,
            value: None,
            hidden: false,
            show_details: true,
            s: None,
            preserved_attributes: Vec::new(),
        }
    }

    /// Create a grand total item
    pub fn grand() -> Self {
        Self {
            item_type: PivotItemType::Grand,
            value: None,
            hidden: false,
            show_details: true,
            s: None,
            preserved_attributes: Vec::new(),
        }
    }

    /// Write the item to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("item");

        // Only write type if not data (data is default)
        if self.item_type != PivotItemType::Data {
            w.attr("t", self.item_type.as_str());
        }

        if let Some(x) = self.value {
            w.attr_num("x", x);
        }

        if self.hidden {
            w.attr_bool("h", true);
        }

        if !self.show_details {
            w.attr_bool("sd", false);
        }

        if let Some(ref s) = self.s {
            w.attr("s", s);
        }

        write_preserved_attrs(w, &self.preserved_attributes, &["t", "x", "h", "sd", "s"]);

        w.self_close();
    }
}

// ============================================================================
// Pivot Field Definition
// ============================================================================

/// Pivot field definition
#[derive(Debug, Clone, Default)]
pub struct PivotFieldDef {
    /// Field name (optional, may come from cache)
    pub name: Option<String>,
    /// Axis where this field is used
    pub axis: Option<PivotAxis>,
    /// Is this used as a data/values field?
    pub data_field: bool,
    /// Compact display
    pub compact: bool,
    /// Outline display
    pub outline: bool,
    /// Whether to show all items
    pub show_all: Option<bool>,
    /// Sort type for this field (ascending, descending, or none/manual)
    pub sort_type: Option<String>,
    /// Data field index for value-based sorting (autoSortScope). When present,
    /// the field is sorted by the aggregated values of this data field.
    pub auto_sort_data_field: Option<u32>,
    /// Whether subtotals appear at top (true) or bottom (false) of group
    pub subtotal_top: bool,
    /// Whether the default subtotal is shown
    pub default_subtotal: bool,
    /// Subtotals for this field
    pub subtotals: Vec<DataFieldFunction>,
    /// Items in this field
    pub items: Vec<PivotFieldItem>,
    /// Unmodeled pivotField attributes preserved from imported OOXML.
    pub preserved_attributes: Vec<PivotRawXmlAttribute>,
    /// Unmodeled pivotField child XML preserved from imported OOXML.
    pub preserved_children: Vec<domain_types::domain::pivot::PivotRawXmlBlock>,
}

impl PivotFieldDef {
    /// Write the pivot field to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("pivotField");

        if let Some(ref name) = self.name {
            w.attr("name", name);
        }

        if let Some(axis) = self.axis {
            w.attr("axis", axis.as_str());
        }

        if self.data_field {
            w.attr_bool("dataField", true);
        }

        // Only write compact/outline if they differ from default (true)
        if !self.compact {
            w.attr_bool("compact", false);
        }

        if !self.outline {
            w.attr_bool("outline", false);
        }

        if let Some(ref sort) = self.sort_type {
            w.attr("sortType", sort);
        }

        // subtotalTop — default is true, only write if false
        if !self.subtotal_top {
            w.attr_bool("subtotalTop", false);
        }

        // defaultSubtotal — default is true, only write if false
        if !self.default_subtotal {
            w.attr_bool("defaultSubtotal", false);
        }

        if let Some(show_all) = self.show_all {
            w.attr_bool("showAll", show_all);
        }

        // Write subtotals as attributes if present
        for subtotal in &self.subtotals {
            match subtotal {
                DataFieldFunction::Sum => w.attr_bool("sumSubtotal", true),
                DataFieldFunction::Count => w.attr_bool("countSubtotal", true),
                DataFieldFunction::Average => w.attr_bool("avgSubtotal", true),
                DataFieldFunction::Max => w.attr_bool("maxSubtotal", true),
                DataFieldFunction::Min => w.attr_bool("minSubtotal", true),
                DataFieldFunction::Product => w.attr_bool("productSubtotal", true),
                DataFieldFunction::CountNums => w.attr_bool("countASubtotal", true),
                DataFieldFunction::StdDev => w.attr_bool("stdDevSubtotal", true),
                DataFieldFunction::StdDevP => w.attr_bool("stdDevPSubtotal", true),
                DataFieldFunction::Var => w.attr_bool("varSubtotal", true),
                DataFieldFunction::VarP => w.attr_bool("varPSubtotal", true),
            };
        }

        write_preserved_attrs(
            w,
            &self.preserved_attributes,
            &[
                "name",
                "axis",
                "dataField",
                "compact",
                "outline",
                "sortType",
                "subtotalTop",
                "defaultSubtotal",
                "showAll",
                "sumSubtotal",
                "countSubtotal",
                "avgSubtotal",
                "maxSubtotal",
                "minSubtotal",
                "productSubtotal",
                "countASubtotal",
                "stdDevSubtotal",
                "stdDevPSubtotal",
                "varSubtotal",
                "varPSubtotal",
            ],
        );

        if self.items.is_empty() && self.preserved_children.is_empty() {
            w.self_close();
        } else {
            w.end_attrs();

            if !self.items.is_empty() {
                w.start_element("items")
                    .attr_num("count", self.items.len())
                    .end_attrs();

                for item in &self.items {
                    item.write_xml(w);
                }

                w.end_element("items");
            }

            // Write autoSortScope if this field uses value-based sorting
            let has_preserved_auto_sort = self
                .preserved_children
                .iter()
                .any(|child| child.local_name == "autoSortScope");
            let mut wrote_preserved_auto_sort = false;
            if let Some(data_field_idx) = self.auto_sort_data_field {
                if has_preserved_auto_sort {
                    for child in &self.preserved_children {
                        if child.local_name == "autoSortScope" {
                            w.raw_str(&child.xml);
                            wrote_preserved_auto_sort = true;
                        }
                    }
                } else {
                    w.start_element("autoSortScope").end_attrs();
                    w.start_element("pivotArea")
                        .attr_bool("dataOnly", false)
                        .attr_bool("outline", false)
                        .attr_num("fieldPosition", 0u32)
                        .end_attrs();
                    w.start_element("references")
                        .attr_num("count", 1u32)
                        .end_attrs();
                    // field="4294967294" is the data-fields sentinel (0xFFFFFFFE)
                    w.start_element("reference")
                        .attr_num("field", 4294967294u32)
                        .attr_num("count", 1u32)
                        .attr_bool("selected", false)
                        .end_attrs();
                    w.start_element("x")
                        .attr_num("v", data_field_idx)
                        .self_close();
                    w.end_element("reference");
                    w.end_element("references");
                    w.end_element("pivotArea");
                    w.end_element("autoSortScope");
                }
            }

            for child in &self.preserved_children {
                if child.local_name != "autoSortScope" || !wrote_preserved_auto_sort {
                    w.raw_str(&child.xml);
                }
            }

            w.end_element("pivotField");
        }
    }
}

// ============================================================================
// Data Field Definition
// ============================================================================

/// Data field (Values area)
#[derive(Debug, Clone, Default)]
pub struct DataFieldDef {
    /// Display name like "Sum of Sales"
    pub name: String,
    /// Index into cacheFields
    pub field_index: u32,
    /// Aggregation function
    pub function: DataFieldFunction,
    /// Number format (optional)
    pub number_format: Option<String>,
    /// Number format ID (optional)
    pub num_fmt_id: Option<u32>,
    /// Base field index for calculated data fields (e.g., % of parent)
    pub base_field: Option<i32>,
    /// Base item index for calculated data fields
    pub base_item: Option<u32>,
    /// Show data as transformation.
    pub show_data_as: Option<String>,
}

impl DataFieldDef {
    /// Create a new data field with sum function
    pub fn sum(name: &str, field_index: u32) -> Self {
        Self {
            name: name.to_string(),
            field_index,
            function: DataFieldFunction::Sum,
            number_format: None,
            num_fmt_id: None,
            base_field: None,
            base_item: None,
            show_data_as: None,
        }
    }

    /// Create a new data field with count function
    pub fn count(name: &str, field_index: u32) -> Self {
        Self {
            name: name.to_string(),
            field_index,
            function: DataFieldFunction::Count,
            number_format: None,
            num_fmt_id: None,
            base_field: None,
            base_item: None,
            show_data_as: None,
        }
    }

    /// Write the data field to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("dataField")
            .attr("name", &self.name)
            .attr_num("fld", self.field_index)
            .attr("subtotal", self.function.as_str());

        if let Some(num_fmt_id) = self.num_fmt_id {
            w.attr_num("numFmtId", num_fmt_id);
        }

        if let Some(base_field) = self.base_field {
            w.attr_num("baseField", base_field);
        }

        if let Some(base_item) = self.base_item {
            w.attr_num("baseItem", base_item);
        }
        if let Some(ref show_data_as) = self.show_data_as {
            w.attr("showDataAs", show_data_as);
        }

        w.self_close();
    }
}

// ============================================================================
// Page Field Definition
// ============================================================================

/// Page (filter) field definition
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PageFieldDef {
    /// Field index into the pivot fields
    pub field_index: i32,
    /// Selected item index (None = "All")
    pub item: Option<u32>,
    /// OLAP hierarchy index
    pub hierarchy: Option<i32>,
    /// Field name (OLAP)
    pub name: Option<String>,
    /// Display caption
    pub caption: Option<String>,
}

impl PageFieldDef {
    /// Write the page field to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("pageField")
            .attr_num("fld", self.field_index);

        if let Some(item) = self.item {
            w.attr_num("item", item);
        }
        if let Some(hier) = self.hierarchy {
            w.attr_num("hier", hier);
        }
        if let Some(ref name) = self.name {
            w.attr("name", name);
        }
        if let Some(ref caption) = self.caption {
            w.attr("cap", caption);
        }

        w.self_close();
    }
}

// ============================================================================
// Cache Field Definition
// ============================================================================

/// Pivot cache field
#[derive(Debug, Clone, Default)]
pub struct CacheFieldDef {
    /// Field name
    pub name: String,
    /// Shared items (unique values)
    pub shared_items: Vec<SharedItem>,
    /// Number format (optional)
    pub number_format: Option<String>,
    /// Number format ID
    pub num_fmt_id: Option<u32>,
    /// SQL data type (for external data sources)
    pub sql_type: Option<i32>,
    /// Display caption (different from name)
    pub caption: Option<String>,
}

impl CacheFieldDef {
    /// Create a new cache field
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            shared_items: Vec::new(),
            number_format: None,
            num_fmt_id: None,
            sql_type: None,
            caption: None,
        }
    }

    /// Write the cache field to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("cacheField")
            .attr("name", &self.name)
            .attr_num("numFmtId", self.num_fmt_id.unwrap_or(0));

        if let Some(ref caption) = self.caption {
            w.attr("caption", caption);
        }

        if let Some(sql_type) = self.sql_type {
            w.attr_num("sqlType", sql_type);
        }

        w.end_attrs();

        // Analyze shared items to determine attributes
        let mut contains_string = false;
        let mut contains_number = false;
        let mut contains_integer = true;
        let mut contains_blank = false;
        let mut min_value: Option<f64> = None;
        let mut max_value: Option<f64> = None;

        for item in &self.shared_items {
            match item {
                SharedItem::String(_) => contains_string = true,
                SharedItem::Number(n) => {
                    contains_number = true;
                    if n.fract() != 0.0 {
                        contains_integer = false;
                    }
                    min_value = Some(min_value.map_or(*n, |m: f64| m.min(*n)));
                    max_value = Some(max_value.map_or(*n, |m: f64| m.max(*n)));
                }
                SharedItem::Boolean(_) => {}
                SharedItem::Error(_) => {}
                SharedItem::Missing => contains_blank = true,
                SharedItem::Index(_) => {} // Index items are references, not values
                SharedItem::DateTime(_) => {} // DateTime items tracked separately
            }
        }

        // If no numbers, contains_integer should be false
        if !contains_number {
            contains_integer = false;
        }

        // Write sharedItems element
        w.start_element("sharedItems");

        if !self.shared_items.is_empty() {
            w.attr_num("count", self.shared_items.len());
        }

        // Write type indicators for numeric fields
        if contains_number && !contains_string {
            w.attr_bool("containsSemiMixedTypes", false);
            w.attr_bool("containsString", false);
            w.attr_bool("containsNumber", true);
            if contains_integer {
                w.attr_bool("containsInteger", true);
            }
            if let Some(min) = min_value {
                w.attr_num("minValue", min);
            }
            if let Some(max) = max_value {
                w.attr_num("maxValue", max);
            }
        }

        if contains_blank {
            w.attr_bool("containsBlank", true);
        }

        if self.shared_items.is_empty() {
            w.self_close();
        } else {
            w.end_attrs();

            for item in &self.shared_items {
                item.write_xml(w);
            }

            w.end_element("sharedItems");
        }

        w.end_element("cacheField");
    }
}

// ============================================================================
// Cache Source
// ============================================================================

/// Worksheet source for pivot cache
#[derive(Debug, Clone, Default)]
pub struct WorksheetSource {
    /// Sheet name
    pub sheet_name: Option<String>,
    /// Named range/table source
    pub source_name: Option<String>,
    /// Range reference (e.g., "A1:D100" or "Sheet1!$A$1:$D$100")
    pub range_ref: String,
    /// Relationship ID for external sources
    pub r_id: Option<String>,
}

/// Pivot cache source
#[derive(Debug, Clone, Default)]
pub struct CacheSource {
    /// Source type
    pub source_type: CacheSourceType,
    /// Worksheet source (if source_type is Worksheet)
    pub worksheet_source: Option<WorksheetSource>,
}

impl CacheSource {
    /// Create a worksheet source
    pub fn worksheet(sheet: &str, range: &str) -> Self {
        Self {
            source_type: CacheSourceType::Worksheet,
            worksheet_source: Some(WorksheetSource {
                sheet_name: Some(sheet.to_string()),
                source_name: None,
                range_ref: range.to_string(),
                r_id: None,
            }),
        }
    }

    /// Write the cache source to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("cacheSource")
            .attr("type", self.source_type.as_str())
            .end_attrs();

        if let Some(ref ws) = self.worksheet_source {
            w.start_element("worksheetSource");

            if !ws.range_ref.is_empty() {
                w.attr("ref", &ws.range_ref);
            }

            if let Some(ref name) = ws.source_name {
                w.attr("name", name);
            }

            if let Some(ref sheet) = ws.sheet_name {
                w.attr("sheet", sheet);
            }

            if let Some(ref r_id) = ws.r_id {
                w.attr("r:id", r_id);
            }

            w.self_close();
        }

        w.end_element("cacheSource");
    }
}

// ============================================================================
// Pivot Location
// ============================================================================

/// Pivot table location
#[derive(Debug, Clone, Default)]
pub struct PivotLocation {
    /// Reference range (e.g., "A3:D20")
    pub ref_range: String,
    /// First header row (1-indexed within the pivot table)
    pub first_header_row: u32,
    /// First data row (1-indexed within the pivot table)
    pub first_data_row: u32,
    /// First data column (0-indexed within the pivot table)
    pub first_data_col: u32,
    /// Rows per page (for page wrap)
    pub rows_per_page: Option<u32>,
    /// Columns per page (for page wrap)
    pub cols_per_page: Option<u32>,
}

impl PivotLocation {
    /// Create a new pivot location
    pub fn new(ref_range: &str) -> Self {
        Self {
            ref_range: ref_range.to_string(),
            first_header_row: 1,
            first_data_row: 2,
            first_data_col: 1,
            rows_per_page: None,
            cols_per_page: None,
        }
    }

    /// Write the location to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("location")
            .attr("ref", &self.ref_range)
            .attr_num("firstHeaderRow", self.first_header_row)
            .attr_num("firstDataRow", self.first_data_row)
            .attr_num("firstDataCol", self.first_data_col);

        if let Some(rows) = self.rows_per_page {
            w.attr_num("rowPageCount", rows);
        }

        if let Some(cols) = self.cols_per_page {
            w.attr_num("colPageCount", cols);
        }

        w.self_close();
    }
}

// ============================================================================
// Pivot Style
// ============================================================================

/// Pivot table style
#[derive(Debug, Clone)]
pub struct PivotStyle {
    /// Style name (e.g., "PivotStyleMedium9")
    pub name: String,
    /// Show row headers
    pub show_row_headers: bool,
    /// Show column headers
    pub show_col_headers: bool,
    /// Show row stripes
    pub show_row_stripes: bool,
    /// Show column stripes
    pub show_col_stripes: bool,
    /// Show last column
    pub show_last_column: bool,
}

impl Default for PivotStyle {
    fn default() -> Self {
        Self {
            name: "PivotStyleMedium9".to_string(),
            show_row_headers: true,
            show_col_headers: true,
            show_row_stripes: false,
            show_col_stripes: false,
            show_last_column: false,
        }
    }
}

impl PivotStyle {
    /// Create a new pivot style
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            ..Default::default()
        }
    }

    /// Write the style info to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("pivotTableStyleInfo")
            .attr("name", &self.name)
            .attr_bool("showRowHeaders", self.show_row_headers)
            .attr_bool("showColHeaders", self.show_col_headers)
            .attr_bool("showRowStripes", self.show_row_stripes)
            .attr_bool("showColStripes", self.show_col_stripes)
            .attr_bool("showLastColumn", self.show_last_column)
            .self_close();
    }
}

// ============================================================================
// Row/Column Item for pivot table output
// ============================================================================

/// Row or column item for pivot table layout
#[derive(Debug, Clone, Default)]
pub struct RowColItem {
    /// Item type (default is "data")
    pub item_type: Option<PivotItemType>,
    /// Field references (x values)
    pub x_values: Vec<Option<u32>>,
    /// Unmodeled row/column item attributes preserved from imported OOXML.
    pub preserved_attributes: Vec<PivotRawXmlAttribute>,
}

impl RowColItem {
    /// Create a data item with field references
    pub fn data(x_values: Vec<Option<u32>>) -> Self {
        Self {
            item_type: None,
            x_values,
            preserved_attributes: Vec::new(),
        }
    }

    /// Create a grand total item
    pub fn grand() -> Self {
        Self {
            item_type: Some(PivotItemType::Grand),
            x_values: vec![None],
            preserved_attributes: Vec::new(),
        }
    }

    /// Write to XML
    pub(crate) fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("i");

        if let Some(ref t) = self.item_type {
            w.attr("t", t.as_str());
        }
        write_preserved_attrs(w, &self.preserved_attributes, &["t"]);

        w.end_attrs();

        for x in &self.x_values {
            if let Some(v) = x {
                let v_str = v.to_string();
                w.empty_element("x", &[("v", &v_str)]);
            } else {
                w.empty_element("x", &[]);
            }
        }

        w.end_element("i");
    }
}

fn write_preserved_attrs(
    w: &mut XmlWriter,
    attrs: &[PivotRawXmlAttribute],
    typed_local_names: &[&str],
) {
    for attr in attrs {
        let local = attr
            .name
            .rsplit_once(':')
            .map(|(_, local)| local)
            .unwrap_or(attr.name.as_str());
        if !typed_local_names.contains(&local) {
            w.attr(&attr.name, &attr.value);
        }
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Format a number for XML output, avoiding unnecessary decimals
pub(crate) fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}
