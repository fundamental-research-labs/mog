//! Excel Table writer for XLSX files (xl/tables/table*.xml).
//!
//! This module generates Excel Table definitions according to ECMA-376 Part 1,
//! specifically CT_Table and related complex types from the SpreadsheetML schema.
//!
//! # Overview
//!
//! Excel Tables (also known as "List Objects") are structured ranges of data with:
//! - A header row with column names
//! - Optional totals row with aggregate functions
//! - AutoFilter capabilities
//! - Structured references for formulas
//! - Styling via TableStyleInfo
//!
//! # File Location
//!
//! Table definitions are stored in `xl/tables/table{N}.xml` where N is the table ID.
//! Each table file is referenced from a worksheet's relationships file.
//!
//! # Usage
//!
//! ```ignore
//! use xlsx_parser::write::tables_writer::{TableWriter, TotalsRowFunction, TableStyleInfo};
//!
//! let mut writer = TableWriter::new(1, "Table1", "A1:D10");
//! writer
//!     .add_column("Name")
//!     .add_column("Value")
//!     .add_column_with_totals("Amount", TotalsRowFunction::Sum)
//!     .add_calculated_column("Total", "[@Value]*[@Amount]")
//!     .with_totals_row()
//!     .enable_auto_filter()
//!     .set_style_name("TableStyleMedium9");
//!
//! let xml = writer.to_xml();
//! ```
//!
//! # ECMA-376 References
//!
//! - CT_Table: Part 1, Section 18.5.1
//! - CT_AutoFilter: Part 1, Section 18.3.1.2
//! - CT_TableColumn: Part 1, Section 18.5.1.3
//! - CT_TableStyleInfo: Part 1, Section 18.5.1.5

use crate::write::xml_writer::XmlWriter;

// Re-export canonical types from ooxml_types.
use ooxml_types::cond_format::IconSetType;
pub use ooxml_types::tables::{
    DynamicFilterType, FilterOperator, SortBy, TableFormula, TableStyleInfo, TotalsRowFunction,
};

/// SpreadsheetML namespace URI
const SPREADSHEETML_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

// ============================================================================
// Table Column
// ============================================================================

/// Table column definition (CT_TableColumn)
#[derive(Debug, Clone, Default)]
pub struct TableColumn {
    /// Column ID (unique within table)
    pub id: u32,
    /// Unique column name (displayed in header)
    pub name: String,
    /// Unique name (uniqueName attribute, used by query tables)
    pub unique_name: Option<String>,
    /// Totals row label (alternative to function)
    pub totals_row_label: Option<String>,
    /// Totals row function (if totals row is shown)
    pub totals_row_function: Option<TotalsRowFunction>,
    /// Calculated column formula (for computed columns)
    pub calculated_column_formula: Option<TableFormula>,
    /// Totals row formula (for custom totals)
    pub totals_row_formula: Option<TableFormula>,
    /// Data format ID (differential format) — legacy alias, prefer `data_dxf_id`
    pub data_format_id: Option<u32>,
    // Per-column DXF IDs
    pub header_row_dxf_id: Option<u32>,
    pub totals_row_dxf_id: Option<u32>,
    // Per-column cell styles
    pub header_row_cell_style: Option<String>,
    pub data_cell_style: Option<String>,
    pub totals_row_cell_style: Option<String>,
    /// Query table field ID (queryTableFieldId attribute)
    pub query_table_field_id: Option<u32>,
    /// Extension UID for revision tracking (xr3:uid)
    pub xr3_uid: Option<String>,
}

impl TableColumn {
    /// Create a new table column
    pub fn new(id: u32, name: &str) -> Self {
        Self {
            id,
            name: name.to_string(),
            unique_name: None,
            totals_row_label: None,
            totals_row_function: None,
            calculated_column_formula: None,
            totals_row_formula: None,
            data_format_id: None,
            header_row_dxf_id: None,
            totals_row_dxf_id: None,
            header_row_cell_style: None,
            data_cell_style: None,
            totals_row_cell_style: None,
            query_table_field_id: None,
            xr3_uid: None,
        }
    }
}

// ============================================================================
// Filter Structures
// ============================================================================

/// A single custom filter criterion (CT_CustomFilter)
#[derive(Debug, Clone)]
pub struct CustomFilter {
    /// The filter operator
    pub operator: FilterOperator,
    /// The filter value
    pub value: String,
}

impl CustomFilter {
    /// Create a new custom filter
    pub fn new(operator: FilterOperator, value: &str) -> Self {
        Self {
            operator,
            value: value.to_string(),
        }
    }
}

/// Filter type for a filter column
#[derive(Debug, Clone)]
pub enum FilterType {
    /// Discrete values filter
    Filters {
        values: Vec<String>,
        blank: bool,
    },
    /// Custom filters (1 or 2 conditions)
    CustomFilters {
        filters: Vec<CustomFilter>,
        and: bool,
    },
    /// Top 10 filter
    Top10 {
        /// Filter top (true) or bottom (false)
        top: bool,
        /// Value is percentage (true) or count (false)
        percent: bool,
        /// The filter value
        val: f64,
        /// Application-computed filter threshold
        filter_val: Option<f64>,
    },
    /// Dynamic filter
    DynamicFilter {
        /// The dynamic filter type
        kind: DynamicFilterType,
        /// Optional value for range-based dynamic filters
        val: Option<f64>,
        /// Optional max value for range-based dynamic filters
        max_val: Option<f64>,
        /// Optional ISO datetime value
        val_iso: Option<String>,
        /// Optional ISO datetime max value
        max_val_iso: Option<String>,
    },
    /// Color filter
    ColorFilter {
        /// Whether to filter by cell color instead of font color
        cell_color: bool,
        /// Differential format ID
        dxf_id: Option<u32>,
    },
    /// Icon filter
    IconFilter {
        /// Icon set identifier
        icon_set: String,
        /// Icon ID within the set
        icon_id: Option<u32>,
    },
}

/// Filter column definition (CT_FilterColumn)
#[derive(Debug, Clone)]
pub struct FilterColumn {
    /// Column index (0-based from table start)
    pub col_id: u32,
    /// Hide the filter dropdown in the UI.
    pub hidden_button: bool,
    /// Show the filter dropdown in the UI.
    pub show_button: bool,
    /// The filter type and settings
    pub filter: FilterType,
}

impl FilterColumn {
    /// Create a new filter column with discrete values
    pub fn with_values(col_id: u32, values: Vec<String>) -> Self {
        Self {
            col_id,
            hidden_button: false,
            show_button: true,
            filter: FilterType::Filters {
                values,
                blank: false,
            },
        }
    }

    /// Create a new filter column with custom filters
    pub fn with_custom_filters(col_id: u32, filters: Vec<CustomFilter>) -> Self {
        Self {
            col_id,
            hidden_button: false,
            show_button: true,
            filter: FilterType::CustomFilters {
                filters,
                and: false,
            },
        }
    }

    /// Create a new filter column with top 10 filter
    pub fn with_top10(col_id: u32, top: bool, percent: bool, val: f64) -> Self {
        Self {
            col_id,
            hidden_button: false,
            show_button: true,
            filter: FilterType::Top10 {
                top,
                percent,
                val,
                filter_val: None,
            },
        }
    }

    /// Create a new filter column with dynamic filter
    pub fn with_dynamic_filter(col_id: u32, kind: DynamicFilterType) -> Self {
        Self {
            col_id,
            hidden_button: false,
            show_button: true,
            filter: FilterType::DynamicFilter {
                kind,
                val: None,
                max_val: None,
                val_iso: None,
                max_val_iso: None,
            },
        }
    }

    /// Write the filter column to XML
    fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("filterColumn")
            .attr_num("colId", self.col_id);
        if self.hidden_button {
            w.attr("hiddenButton", "1");
        }
        if !self.show_button {
            w.attr("showButton", "0");
        }
        w.end_attrs();

        match &self.filter {
            FilterType::Filters { values, blank } => {
                w.start_element("filters");
                if *blank {
                    w.attr("blank", "1");
                }
                w.end_attrs();
                for val in values {
                    w.empty_element("filter", &[("val", val)]);
                }
                w.end_element("filters");
            }
            FilterType::CustomFilters { filters, and } => {
                w.start_element("customFilters");
                if *and {
                    w.attr("and", "1");
                }
                w.end_attrs();
                for filter in filters {
                    w.empty_element(
                        "customFilter",
                        &[
                            ("operator", filter.operator.as_str()),
                            ("val", &filter.value),
                        ],
                    );
                }
                w.end_element("customFilters");
            }
            FilterType::Top10 {
                top,
                percent,
                val,
                filter_val,
            } => {
                w.start_element("top10")
                    .attr_bool("top", *top)
                    .attr_bool("percent", *percent)
                    .attr_num("val", *val);
                if let Some(fv) = filter_val {
                    w.attr_num("filterVal", *fv);
                }
                w.self_close();
            }
            FilterType::DynamicFilter {
                kind,
                val,
                max_val,
                val_iso,
                max_val_iso,
            } => {
                w.start_element("dynamicFilter").attr("type", kind.as_str());
                if let Some(v) = val {
                    w.attr_num("val", *v);
                }
                if let Some(v) = max_val {
                    w.attr_num("maxVal", *v);
                }
                if let Some(v) = val_iso {
                    w.attr("valIso", v);
                }
                if let Some(v) = max_val_iso {
                    w.attr("maxValIso", v);
                }
                w.self_close();
            }
            FilterType::ColorFilter { cell_color, dxf_id } => {
                w.start_element("colorFilter");
                if let Some(id) = dxf_id {
                    w.attr_num("dxfId", *id);
                }
                if !cell_color {
                    w.attr("cellColor", "0");
                }
                w.self_close();
            }
            FilterType::IconFilter { icon_set, icon_id } => {
                w.start_element("iconFilter").attr("iconSet", icon_set);
                if let Some(id) = icon_id {
                    w.attr_num("iconId", *id);
                }
                w.self_close();
            }
        }

        w.end_element("filterColumn");
    }
}

/// Auto-filter definition (CT_AutoFilter)
#[derive(Debug, Clone, Default)]
pub struct AutoFilterDef {
    /// Reference range for the filter (e.g., "A1:E10")
    pub range: String,
    /// Filter columns
    pub filter_columns: Vec<FilterColumn>,
    /// Extension UID for revision tracking (xr:uid)
    pub xr_uid: Option<String>,
}

impl AutoFilterDef {
    /// Create a new auto-filter with the specified range
    pub fn new(range: &str) -> Self {
        Self {
            range: range.to_string(),
            filter_columns: Vec::new(),
            xr_uid: None,
        }
    }

    /// Add a filter column
    pub fn add_filter_column(&mut self, filter_column: FilterColumn) -> &mut Self {
        self.filter_columns.push(filter_column);
        self
    }

    /// Write the auto-filter to XML
    fn write_xml(&self, w: &mut XmlWriter) {
        if self.filter_columns.is_empty() && self.xr_uid.is_none() {
            w.empty_element("autoFilter", &[("ref", &self.range)]);
        } else if self.filter_columns.is_empty() {
            // Has xr:uid but no filter columns
            let uid = self.xr_uid.as_deref().unwrap();
            w.empty_element("autoFilter", &[("ref", &self.range), ("xr:uid", uid)]);
        } else {
            w.start_element("autoFilter").attr("ref", &self.range);
            if let Some(ref uid) = self.xr_uid {
                w.attr("xr:uid", uid);
            }
            w.end_attrs();

            for fc in &self.filter_columns {
                fc.write_xml(w);
            }

            w.end_element("autoFilter");
        }
    }
}

// ============================================================================
// Sort Structures
// ============================================================================

/// Sort condition (CT_SortCondition)
#[derive(Debug, Clone)]
pub struct SortCondition {
    /// Reference for the sort column (e.g., "A:A" or "A1:A10")
    pub col_ref: String,
    /// Whether to sort descending
    pub descending: bool,
    /// Sort by type
    pub sort_by: Option<SortBy>,
    /// Custom sort list
    pub custom_list: Option<String>,
    /// Differential format ID for color sorts
    pub dxf_id: Option<u32>,
    /// Icon set name for icon sorts
    pub icon_set: Option<IconSetType>,
    /// Icon ID for icon sorts
    pub icon_id: Option<u32>,
}

impl SortCondition {
    /// Create a new sort condition
    pub fn new(col_ref: &str) -> Self {
        Self {
            col_ref: col_ref.to_string(),
            descending: false,
            sort_by: None,
            custom_list: None,
            dxf_id: None,
            icon_set: None,
            icon_id: None,
        }
    }

    /// Create a descending sort condition
    pub fn descending(col_ref: &str) -> Self {
        Self {
            col_ref: col_ref.to_string(),
            descending: true,
            sort_by: None,
            custom_list: None,
            dxf_id: None,
            icon_set: None,
            icon_id: None,
        }
    }

    /// Write the sort condition to XML
    fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("sortCondition");

        if self.descending {
            w.attr_bool("descending", true);
        }

        if let Some(sort_by) = self.sort_by {
            if sort_by != SortBy::Value {
                w.attr("sortBy", sort_by.as_str());
            }
        }

        if let Some(ref icon_set) = self.icon_set {
            w.attr("iconSet", icon_set.to_ooxml());
        }
        if let Some(icon_id) = self.icon_id {
            w.attr_num("iconId", icon_id);
        }
        if let Some(ref custom_list) = self.custom_list {
            w.attr("customList", custom_list);
        }
        if let Some(dxf_id) = self.dxf_id {
            w.attr_num("dxfId", dxf_id);
        }

        w.attr("ref", &self.col_ref).self_close();
    }
}

/// Sort state (CT_SortState)
#[derive(Debug, Clone, Default)]
pub struct SortState {
    /// Reference range for the sort (e.g., "A2:D10" - excludes header)
    pub range: String,
    /// Case sensitive sort
    pub case_sensitive: bool,
    /// Whether to sort by columns.
    pub column_sort: bool,
    /// CJK sort method.
    pub sort_method: domain_types::SortMethod,
    /// Sort conditions
    pub conditions: Vec<SortCondition>,
}

impl SortState {
    /// Create a new sort state
    pub fn new(range: &str) -> Self {
        Self {
            range: range.to_string(),
            case_sensitive: false,
            column_sort: false,
            sort_method: domain_types::SortMethod::None,
            conditions: Vec::new(),
        }
    }

    /// Add a sort condition
    pub fn add_condition(&mut self, condition: SortCondition) -> &mut Self {
        self.conditions.push(condition);
        self
    }

    /// Write the sort state to XML
    fn write_xml(&self, w: &mut XmlWriter) {
        w.start_element("sortState").attr("ref", &self.range);

        if self.case_sensitive {
            w.attr_bool("caseSensitive", true);
        }
        if self.column_sort {
            w.attr_bool("columnSort", true);
        }
        if self.sort_method != domain_types::SortMethod::None {
            w.attr("sortMethod", self.sort_method.to_ooxml_token());
        }

        w.end_attrs();

        for condition in &self.conditions {
            condition.write_xml(w);
        }

        w.end_element("sortState");
    }
}

// ============================================================================
// Table Style - write helpers
// ============================================================================

/// Write a `TableStyleInfo` to XML.
fn write_table_style_info_xml(style: &TableStyleInfo, w: &mut XmlWriter) {
    let elem = w.start_element("tableStyleInfo");
    if let Some(name) = &style.name {
        elem.attr("name", name);
    }
    elem.attr_bool("showFirstColumn", style.show_first_column)
        .attr_bool("showLastColumn", style.show_last_column)
        .attr_bool("showRowStripes", style.show_row_stripes)
        .attr_bool("showColumnStripes", style.show_column_stripes)
        .self_close();
}

/// Create a default `TableStyleInfo` for the write path (uses "TableStyleMedium2").
pub fn default_table_style_info() -> TableStyleInfo {
    TableStyleInfo::new("TableStyleMedium2")
}

// ============================================================================
// Table Writer
// ============================================================================

/// Table writer for generating xl/tables/table{n}.xml
#[derive(Debug, Clone)]
pub struct TableWriter {
    /// Unique table ID
    pub id: u32,
    /// Internal name (used for references)
    pub name: String,
    /// Display name shown to users
    pub display_name: String,
    /// Reference range (e.g., "A1:D10")
    pub range: String,
    /// Number of totals rows (typically 0 or 1)
    pub totals_row_count: u32,
    /// Number of header rows (typically 1)
    pub header_row_count: u32,
    /// Table columns
    pub columns: Vec<TableColumn>,
    /// AutoFilter settings
    pub auto_filter: Option<AutoFilterDef>,
    /// Sort state
    pub sort_state: Option<SortState>,
    /// Table style information
    pub style_info: Option<TableStyleInfo>,
    /// Next column ID (for auto-incrementing)
    next_column_id: u32,
    // DXF formatting IDs for table regions
    pub header_row_dxf_id: Option<u32>,
    pub data_dxf_id: Option<u32>,
    pub totals_row_dxf_id: Option<u32>,
    pub header_row_border_dxf_id: Option<u32>,
    pub table_border_dxf_id: Option<u32>,
    pub totals_row_border_dxf_id: Option<u32>,
    // Named cell styles for table regions
    pub header_row_cell_style: Option<String>,
    pub data_cell_style: Option<String>,
    pub totals_row_cell_style: Option<String>,
    /// Table type (queryTable, xml). None means default "worksheet".
    pub table_type: Option<String>,
    /// Whether totals row is shown (totalsRowShown attribute).
    /// None = attribute absent (OOXML default is true).
    pub totals_row_shown: Option<bool>,
    /// Connection ID for external data sources.
    pub connection_id: Option<u32>,
    /// Whether to insert a blank row below table.
    pub insert_row: bool,
    /// Whether insert row shifts existing rows.
    pub insert_row_shift: bool,
    /// Whether the table is published.
    pub published: bool,
    /// Extension UID for revision tracking (xr:uid).
    /// When present, triggers mc:Ignorable="xr xr3" and xmlns:xr/xr3 declarations.
    pub xr_uid: Option<String>,
}

impl TableWriter {
    /// Create a new table writer
    ///
    /// # Arguments
    /// * `id` - Unique table ID
    /// * `name` - Table name (used for references and display)
    /// * `range` - Table range (e.g., "A1:D10")
    pub fn new(id: u32, name: &str, range: &str) -> Self {
        Self {
            id,
            name: name.to_string(),
            display_name: name.to_string(),
            range: range.to_string(),
            totals_row_count: 0,
            header_row_count: 1,
            columns: Vec::new(),
            auto_filter: None,
            sort_state: None,
            style_info: None,
            next_column_id: 1,
            header_row_dxf_id: None,
            data_dxf_id: None,
            totals_row_dxf_id: None,
            header_row_border_dxf_id: None,
            table_border_dxf_id: None,
            totals_row_border_dxf_id: None,
            header_row_cell_style: None,
            data_cell_style: None,
            totals_row_cell_style: None,
            table_type: None,
            totals_row_shown: None,
            connection_id: None,
            insert_row: false,
            insert_row_shift: false,
            published: false,
            xr_uid: None,
        }
    }

    /// Add a column to the table
    ///
    /// # Arguments
    /// * `name` - Column name (displayed in header)
    pub fn add_column(&mut self, name: &str) -> &mut Self {
        let col = TableColumn::new(self.next_column_id, name);
        self.columns.push(col);
        self.next_column_id += 1;
        self
    }

    /// Add a column with a totals row function
    ///
    /// # Arguments
    /// * `name` - Column name (displayed in header)
    /// * `function` - Totals row function
    pub fn add_column_with_totals(&mut self, name: &str, function: TotalsRowFunction) -> &mut Self {
        let mut col = TableColumn::new(self.next_column_id, name);
        col.totals_row_function = Some(function);
        self.columns.push(col);
        self.next_column_id += 1;
        self
    }

    /// Add a calculated column with a formula
    ///
    /// # Arguments
    /// * `name` - Column name (displayed in header)
    /// * `formula` - Column formula using structured references (e.g., "[@Value]*2")
    pub fn add_calculated_column(&mut self, name: &str, formula: &str) -> &mut Self {
        let mut col = TableColumn::new(self.next_column_id, name);
        col.calculated_column_formula = Some(TableFormula::new(formula));
        self.columns.push(col);
        self.next_column_id += 1;
        self
    }

    /// Enable the totals row
    pub fn with_totals_row(&mut self) -> &mut Self {
        self.totals_row_count = 1;
        self
    }

    /// Set the auto-filter definition
    ///
    /// # Arguments
    /// * `auto_filter` - Auto-filter definition
    pub fn set_auto_filter(&mut self, auto_filter: AutoFilterDef) -> &mut Self {
        self.auto_filter = Some(auto_filter);
        self
    }

    /// Enable auto-filter for the entire table range
    pub fn enable_auto_filter(&mut self) -> &mut Self {
        self.auto_filter = Some(AutoFilterDef::new(&self.range));
        self
    }

    /// Set the sort state
    ///
    /// # Arguments
    /// * `sort_state` - Sort state definition
    pub fn set_sort_state(&mut self, sort_state: SortState) -> &mut Self {
        self.sort_state = Some(sort_state);
        self
    }

    /// Set the table style
    ///
    /// # Arguments
    /// * `style` - Table style information
    pub fn set_style(&mut self, style: TableStyleInfo) -> &mut Self {
        self.style_info = Some(style);
        self
    }

    /// Set the table style by name with default options
    ///
    /// # Arguments
    /// * `name` - Style name (e.g., "TableStyleMedium9")
    pub fn set_style_name(&mut self, name: &str) -> &mut Self {
        self.style_info = Some(TableStyleInfo::new(name));
        self
    }

    /// Generate the table XML
    ///
    /// Returns the complete XML content for xl/tables/table{n}.xml
    pub fn to_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.write_declaration();

        // Start table element — attribute order follows Excel's canonical output
        w.start_element("table").attr("xmlns", SPREADSHEETML_NS);

        // When xr:uid is present, emit mc:Ignorable namespace declarations.
        // Excel emits these for revision tracking: xmlns:mc, mc:Ignorable, xmlns:xr, xmlns:xr3.
        if self.xr_uid.is_some() {
            w.attr(
                "xmlns:mc",
                "http://schemas.openxmlformats.org/markup-compatibility/2006",
            );
            w.attr("mc:Ignorable", "xr xr3");
            w.attr(
                "xmlns:xr",
                "http://schemas.microsoft.com/office/spreadsheetml/2014/revision",
            );
            w.attr(
                "xmlns:xr3",
                "http://schemas.microsoft.com/office/spreadsheetml/2016/revision3",
            );
        }

        // Emit tableType before id (Excel ordering)
        if let Some(ref tt) = self.table_type {
            w.attr("tableType", tt);
        }
        w.attr_num("id", self.id);
        // Emit xr:uid right after id (Excel ordering)
        if let Some(ref uid) = self.xr_uid {
            w.attr("xr:uid", uid);
        }
        w.attr_xstring("name", &self.name)
            .attr_xstring("displayName", &self.display_name)
            .attr("ref", &self.range);
        // Only emit totalsRowCount when non-default (default is 0)
        if self.totals_row_count > 0 {
            w.attr_num("totalsRowCount", self.totals_row_count);
        }
        // Only emit headerRowCount when non-default (default is 1 per OOXML spec)
        if self.header_row_count != 1 {
            w.attr_num("headerRowCount", self.header_row_count);
        }
        // Emit totalsRowShown only when explicitly present in the original.
        // OOXML default is "1" (true), so absent means shown.
        if let Some(shown) = self.totals_row_shown {
            w.attr("totalsRowShown", if shown { "1" } else { "0" });
        }
        if self.insert_row {
            w.attr("insertRow", "1");
        }
        if self.insert_row_shift {
            w.attr("insertRowShift", "1");
        }
        if self.published {
            w.attr("published", "1");
        }
        if let Some(conn_id) = self.connection_id {
            w.attr_num("connectionId", conn_id);
        }
        if let Some(dxf) = self.header_row_dxf_id {
            w.attr_num("headerRowDxfId", dxf);
        }
        if let Some(dxf) = self.data_dxf_id {
            w.attr_num("dataDxfId", dxf);
        }
        if let Some(dxf) = self.totals_row_dxf_id {
            w.attr_num("totalsRowDxfId", dxf);
        }
        if let Some(dxf) = self.header_row_border_dxf_id {
            w.attr_num("headerRowBorderDxfId", dxf);
        }
        if let Some(dxf) = self.table_border_dxf_id {
            w.attr_num("tableBorderDxfId", dxf);
        }
        if let Some(dxf) = self.totals_row_border_dxf_id {
            w.attr_num("totalsRowBorderDxfId", dxf);
        }
        if let Some(ref s) = self.header_row_cell_style {
            w.attr("headerRowCellStyle", s);
        }
        if let Some(ref s) = self.data_cell_style {
            w.attr("dataCellStyle", s);
        }
        if let Some(ref s) = self.totals_row_cell_style {
            w.attr("totalsRowCellStyle", s);
        }
        w.end_attrs();

        // Write auto-filter
        if let Some(ref af) = self.auto_filter {
            af.write_xml(&mut w);
        }

        // Write sort state (can be outside autoFilter at table level)
        if let Some(ref ss) = self.sort_state {
            ss.write_xml(&mut w);
        }

        // Write table columns
        if !self.columns.is_empty() {
            w.start_element("tableColumns")
                .attr_num("count", self.columns.len())
                .end_attrs();

            for col in &self.columns {
                self.write_column(&mut w, col);
            }

            w.end_element("tableColumns");
        }

        // Write table style info
        if let Some(ref style) = self.style_info {
            write_table_style_info_xml(style, &mut w);
        }

        w.end_element("table");

        w.finish()
    }

    /// Write a single column to XML (helper method to avoid borrowing issues)
    fn write_column(&self, w: &mut XmlWriter, col: &TableColumn) {
        w.start_element("tableColumn").attr_num("id", col.id);

        // xr3:uid comes right after id in Excel's canonical output
        if let Some(ref uid) = col.xr3_uid {
            w.attr("xr3:uid", uid);
        }

        if let Some(ref un) = col.unique_name {
            w.attr_xstring("uniqueName", un);
        }

        w.attr_xstring("name", &col.name);

        if let Some(qfid) = col.query_table_field_id {
            w.attr_num("queryTableFieldId", qfid);
        }

        if let Some(ref label) = col.totals_row_label {
            w.attr_xstring("totalsRowLabel", label);
        }

        if let Some(func) = col.totals_row_function {
            if func != TotalsRowFunction::None {
                w.attr("totalsRowFunction", func.as_str());
            }
        }

        if let Some(dxf_id) = col.header_row_dxf_id {
            w.attr_num("headerRowDxfId", dxf_id);
        }
        if let Some(dxf_id) = col.data_format_id {
            w.attr_num("dataDxfId", dxf_id);
        }
        if let Some(dxf_id) = col.totals_row_dxf_id {
            w.attr_num("totalsRowDxfId", dxf_id);
        }
        if let Some(ref s) = col.header_row_cell_style {
            w.attr("headerRowCellStyle", s);
        }
        if let Some(ref s) = col.data_cell_style {
            w.attr("dataCellStyle", s);
        }
        if let Some(ref s) = col.totals_row_cell_style {
            w.attr("totalsRowCellStyle", s);
        }

        // Check if we need child elements
        if col.calculated_column_formula.is_some() || col.totals_row_formula.is_some() {
            w.end_attrs();

            if let Some(ref formula) = col.calculated_column_formula {
                if formula.array {
                    w.start_element("calculatedColumnFormula")
                        .attr("array", "1")
                        .end_attrs();
                    w.text(&formula.text);
                    w.end_element("calculatedColumnFormula");
                } else {
                    w.element_with_text("calculatedColumnFormula", &formula.text);
                }
            }

            if let Some(ref formula) = col.totals_row_formula {
                if formula.array {
                    w.start_element("totalsRowFormula")
                        .attr("array", "1")
                        .end_attrs();
                    w.text(&formula.text);
                    w.end_element("totalsRowFormula");
                } else {
                    w.element_with_text("totalsRowFormula", &formula.text);
                }
            }

            w.end_element("tableColumn");
        } else {
            w.self_close();
        }
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Enum tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_totals_row_function_as_str() {
        assert_eq!(TotalsRowFunction::None.as_str(), "none");
        assert_eq!(TotalsRowFunction::Sum.as_str(), "sum");
        assert_eq!(TotalsRowFunction::Min.as_str(), "min");
        assert_eq!(TotalsRowFunction::Max.as_str(), "max");
        assert_eq!(TotalsRowFunction::Average.as_str(), "average");
        assert_eq!(TotalsRowFunction::Count.as_str(), "count");
        assert_eq!(TotalsRowFunction::CountNums.as_str(), "countNums");
        assert_eq!(TotalsRowFunction::StdDev.as_str(), "stdDev");
        assert_eq!(TotalsRowFunction::Var.as_str(), "var");
        assert_eq!(TotalsRowFunction::Custom.as_str(), "custom");
    }

    #[test]
    fn test_filter_operator_as_str() {
        assert_eq!(FilterOperator::Equal.as_str(), "equal");
        assert_eq!(FilterOperator::NotEqual.as_str(), "notEqual");
        assert_eq!(FilterOperator::GreaterThan.as_str(), "greaterThan");
        assert_eq!(
            FilterOperator::GreaterThanOrEqual.as_str(),
            "greaterThanOrEqual"
        );
        assert_eq!(FilterOperator::LessThan.as_str(), "lessThan");
        assert_eq!(FilterOperator::LessThanOrEqual.as_str(), "lessThanOrEqual");
    }

    #[test]
    fn test_dynamic_filter_type_as_str() {
        assert_eq!(DynamicFilterType::AboveAverage.as_str(), "aboveAverage");
        assert_eq!(DynamicFilterType::BelowAverage.as_str(), "belowAverage");
        assert_eq!(DynamicFilterType::Today.as_str(), "today");
        assert_eq!(DynamicFilterType::Tomorrow.as_str(), "tomorrow");
        assert_eq!(DynamicFilterType::Yesterday.as_str(), "yesterday");
        assert_eq!(DynamicFilterType::ThisWeek.as_str(), "thisWeek");
        assert_eq!(DynamicFilterType::ThisMonth.as_str(), "thisMonth");
        assert_eq!(DynamicFilterType::ThisYear.as_str(), "thisYear");
        assert_eq!(DynamicFilterType::YearToDate.as_str(), "yearToDate");
        assert_eq!(DynamicFilterType::Q1.as_str(), "Q1");
        assert_eq!(DynamicFilterType::M12.as_str(), "M12");
    }

    #[test]
    fn test_sort_by_as_str() {
        assert_eq!(SortBy::Value.as_str(), "value");
        assert_eq!(SortBy::CellColor.as_str(), "cellColor");
        assert_eq!(SortBy::FontColor.as_str(), "fontColor");
        assert_eq!(SortBy::Icon.as_str(), "icon");
    }

    // -------------------------------------------------------------------------
    // TableColumn tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_table_column_new() {
        let col = TableColumn::new(1, "TestColumn");
        assert_eq!(col.id, 1);
        assert_eq!(col.name, "TestColumn");
        assert!(col.totals_row_label.is_none());
        assert!(col.totals_row_function.is_none());
        assert!(col.calculated_column_formula.is_none());
    }

    #[test]
    fn test_table_column_xstring_attribute_escaping() {
        let mut writer = TableWriter::new(1, "Table1", "A1:B2");
        writer
            .add_column("Total Compensation\n(Annualized)")
            .add_column("Literal _x000a_ marker");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("name=\"Total Compensation_x000a_(Annualized)\""));
        assert!(xml.contains("name=\"Literal _x005f_x000a_ marker\""));
    }

    // -------------------------------------------------------------------------
    // FilterColumn tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_filter_column_with_values() {
        let fc = FilterColumn::with_values(0, vec!["Value1".to_string(), "Value2".to_string()]);
        assert_eq!(fc.col_id, 0);
        if let FilterType::Filters { values, blank } = fc.filter {
            assert_eq!(values.len(), 2);
            assert_eq!(values[0], "Value1");
            assert_eq!(values[1], "Value2");
            assert!(!blank);
        } else {
            panic!("Expected Filters variant");
        }
    }

    #[test]
    fn test_filter_column_with_custom_filters() {
        let filters = vec![
            CustomFilter::new(FilterOperator::GreaterThan, "100"),
            CustomFilter::new(FilterOperator::LessThan, "500"),
        ];
        let fc = FilterColumn::with_custom_filters(1, filters);
        assert_eq!(fc.col_id, 1);
        if let FilterType::CustomFilters { filters: cf, and } = fc.filter {
            assert_eq!(cf.len(), 2);
            assert_eq!(cf[0].operator, FilterOperator::GreaterThan);
            assert_eq!(cf[0].value, "100");
            assert!(!and);
        } else {
            panic!("Expected CustomFilters variant");
        }
    }

    #[test]
    fn test_filter_column_with_top10() {
        let fc = FilterColumn::with_top10(2, true, false, 10.0);
        assert_eq!(fc.col_id, 2);
        if let FilterType::Top10 {
            top,
            percent,
            val,
            filter_val,
        } = fc.filter
        {
            assert!(top);
            assert!(!percent);
            assert!((val - 10.0).abs() < 0.001);
            assert!(filter_val.is_none());
        } else {
            panic!("Expected Top10 variant");
        }
    }

    #[test]
    fn test_filter_column_with_dynamic_filter() {
        let fc = FilterColumn::with_dynamic_filter(3, DynamicFilterType::ThisMonth);
        assert_eq!(fc.col_id, 3);
        if let FilterType::DynamicFilter {
            kind,
            val,
            max_val,
            val_iso,
            max_val_iso,
        } = fc.filter
        {
            assert_eq!(kind, DynamicFilterType::ThisMonth);
            assert!(val.is_none());
            assert!(max_val.is_none());
            assert!(val_iso.is_none());
            assert!(max_val_iso.is_none());
        } else {
            panic!("Expected DynamicFilter variant");
        }
    }

    // -------------------------------------------------------------------------
    // AutoFilterDef tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_auto_filter_def_new() {
        let af = AutoFilterDef::new("A1:D10");
        assert_eq!(af.range, "A1:D10");
        assert!(af.filter_columns.is_empty());
    }

    #[test]
    fn test_auto_filter_def_add_filter_column() {
        let mut af = AutoFilterDef::new("A1:D10");
        af.add_filter_column(FilterColumn::with_values(0, vec!["Active".to_string()]));
        assert_eq!(af.filter_columns.len(), 1);
    }

    // -------------------------------------------------------------------------
    // SortCondition tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sort_condition_new() {
        let sc = SortCondition::new("B:B");
        assert_eq!(sc.col_ref, "B:B");
        assert!(!sc.descending);
        assert!(sc.sort_by.is_none());
    }

    #[test]
    fn test_sort_condition_descending() {
        let sc = SortCondition::descending("C:C");
        assert_eq!(sc.col_ref, "C:C");
        assert!(sc.descending);
    }

    // -------------------------------------------------------------------------
    // SortState tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sort_state_new() {
        let ss = SortState::new("A2:D10");
        assert_eq!(ss.range, "A2:D10");
        assert!(!ss.case_sensitive);
        assert!(ss.conditions.is_empty());
    }

    #[test]
    fn test_sort_state_add_condition() {
        let mut ss = SortState::new("A2:D10");
        ss.add_condition(SortCondition::new("B:B"))
            .add_condition(SortCondition::descending("C:C"));
        assert_eq!(ss.conditions.len(), 2);
        assert!(!ss.conditions[0].descending);
        assert!(ss.conditions[1].descending);
    }

    // -------------------------------------------------------------------------
    // TableStyleInfo tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_table_style_info_new() {
        let style = TableStyleInfo::new("TableStyleMedium9");
        assert_eq!(style.name, Some("TableStyleMedium9".to_string()));
        assert!(!style.show_first_column);
        assert!(!style.show_last_column);
        assert!(style.show_row_stripes);
        assert!(!style.show_column_stripes);
    }

    #[test]
    fn test_table_style_info_default() {
        let style = default_table_style_info();
        assert_eq!(style.name, Some("TableStyleMedium2".to_string()));
    }

    // -------------------------------------------------------------------------
    // TableWriter tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_table_writer_new() {
        let writer = TableWriter::new(1, "Table1", "A1:D10");
        assert_eq!(writer.id, 1);
        assert_eq!(writer.name, "Table1");
        assert_eq!(writer.display_name, "Table1");
        assert_eq!(writer.range, "A1:D10");
        assert_eq!(writer.totals_row_count, 0);
        assert_eq!(writer.header_row_count, 1);
        assert!(writer.columns.is_empty());
    }

    #[test]
    fn test_table_writer_add_column() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer.add_column("Name").add_column("Value");
        assert_eq!(writer.columns.len(), 2);
        assert_eq!(writer.columns[0].id, 1);
        assert_eq!(writer.columns[0].name, "Name");
        assert_eq!(writer.columns[1].id, 2);
        assert_eq!(writer.columns[1].name, "Value");
    }

    #[test]
    fn test_table_writer_add_column_with_totals() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer.add_column_with_totals("Amount", TotalsRowFunction::Sum);
        assert_eq!(writer.columns.len(), 1);
        assert_eq!(
            writer.columns[0].totals_row_function,
            Some(TotalsRowFunction::Sum)
        );
    }

    #[test]
    fn test_table_writer_add_calculated_column() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer.add_calculated_column("Total", "[@Value]*2");
        assert_eq!(writer.columns.len(), 1);
        assert_eq!(
            writer.columns[0].calculated_column_formula,
            Some(TableFormula::new("[@Value]*2"))
        );
    }

    #[test]
    fn test_table_writer_with_totals_row() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer.with_totals_row();
        assert_eq!(writer.totals_row_count, 1);
    }

    #[test]
    fn test_table_writer_enable_auto_filter() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer.enable_auto_filter();
        assert!(writer.auto_filter.is_some());
        assert_eq!(writer.auto_filter.as_ref().unwrap().range, "A1:D10");
    }

    #[test]
    fn test_table_writer_set_style_name() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer.set_style_name("TableStyleMedium9");
        assert!(writer.style_info.is_some());
        assert_eq!(
            writer.style_info.as_ref().unwrap().name,
            Some("TableStyleMedium9".to_string())
        );
    }

    // -------------------------------------------------------------------------
    // XML output tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_basic_table_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:C10");
        writer
            .add_column("Name")
            .add_column("Age")
            .add_column("City");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<?xml version=\"1.0\""));
        assert!(xml_str.contains("<table xmlns="));
        assert!(xml_str.contains("id=\"1\""));
        assert!(xml_str.contains("name=\"Table1\""));
        assert!(xml_str.contains("displayName=\"Table1\""));
        assert!(xml_str.contains("ref=\"A1:C10\""));
        assert!(xml_str.contains("<tableColumns count=\"3\""));
        assert!(xml_str.contains("name=\"Name\""));
        assert!(xml_str.contains("name=\"Age\""));
        assert!(xml_str.contains("name=\"City\""));
        assert!(xml_str.contains("</table>"));
    }

    #[test]
    fn test_table_with_totals_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:B10");
        writer
            .add_column("Name")
            .add_column_with_totals("Amount", TotalsRowFunction::Sum)
            .with_totals_row();

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("totalsRowCount=\"1\""));
        assert!(xml_str.contains("totalsRowFunction=\"sum\""));
    }

    #[test]
    fn test_table_with_calculated_column_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:C10");
        writer
            .add_column("Value")
            .add_calculated_column("Double", "[Value]*2");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<calculatedColumnFormula>[Value]*2</calculatedColumnFormula>"));
    }

    #[test]
    fn test_table_with_auto_filter_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer
            .add_column("Status")
            .add_column("Name")
            .add_column("Amount")
            .add_column("Date")
            .enable_auto_filter();

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<autoFilter ref=\"A1:D10\"/>"));
    }

    #[test]
    fn test_table_with_filter_columns_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer
            .add_column("Status")
            .add_column("Name")
            .add_column("Amount")
            .add_column("Date");

        let mut af = AutoFilterDef::new("A1:D10");
        af.add_filter_column(FilterColumn::with_values(
            0,
            vec!["Active".to_string(), "Pending".to_string()],
        ));
        af.add_filter_column(FilterColumn::with_custom_filters(
            2,
            vec![CustomFilter::new(FilterOperator::GreaterThan, "100")],
        ));
        writer.set_auto_filter(af);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<autoFilter ref=\"A1:D10\">"));
        assert!(xml_str.contains("<filterColumn colId=\"0\">"));
        assert!(xml_str.contains("<filters>"));
        assert!(xml_str.contains("<filter val=\"Active\"/>"));
        assert!(xml_str.contains("<filter val=\"Pending\"/>"));
        assert!(xml_str.contains("<filterColumn colId=\"2\">"));
        assert!(xml_str.contains("<customFilters>"));
        assert!(xml_str.contains("operator=\"greaterThan\""));
        assert!(xml_str.contains("val=\"100\""));
    }

    #[test]
    fn test_table_filter_columns_preserve_rich_ooxml_attrs() {
        let mut writer = TableWriter::new(1, "Table1", "A1:F10");
        writer.add_column("A");

        let mut af = AutoFilterDef::new("A1:F10");
        af.add_filter_column(FilterColumn {
            col_id: 0,
            hidden_button: true,
            show_button: false,
            filter: FilterType::Filters {
                values: vec!["Open".to_string()],
                blank: true,
            },
        });
        af.add_filter_column(FilterColumn {
            col_id: 1,
            hidden_button: false,
            show_button: true,
            filter: FilterType::CustomFilters {
                filters: vec![CustomFilter::new(FilterOperator::GreaterThan, "5")],
                and: true,
            },
        });
        af.add_filter_column(FilterColumn {
            col_id: 2,
            hidden_button: false,
            show_button: true,
            filter: FilterType::Top10 {
                top: false,
                percent: true,
                val: 10.0,
                filter_val: Some(42.0),
            },
        });
        af.add_filter_column(FilterColumn {
            col_id: 3,
            hidden_button: false,
            show_button: true,
            filter: FilterType::DynamicFilter {
                kind: DynamicFilterType::ThisMonth,
                val: Some(1.0),
                max_val: Some(2.0),
                val_iso: Some("2026-05-01T00:00:00Z".to_string()),
                max_val_iso: Some("2026-05-31T00:00:00Z".to_string()),
            },
        });
        af.add_filter_column(FilterColumn {
            col_id: 4,
            hidden_button: false,
            show_button: true,
            filter: FilterType::ColorFilter {
                dxf_id: Some(7),
                cell_color: false,
            },
        });
        af.add_filter_column(FilterColumn {
            col_id: 5,
            hidden_button: false,
            show_button: true,
            filter: FilterType::IconFilter {
                icon_set: "3TrafficLights1".to_string(),
                icon_id: Some(2),
            },
        });
        writer.set_auto_filter(af);

        let xml_str = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml_str.contains(r#"<filterColumn colId="0" hiddenButton="1" showButton="0">"#));
        assert!(xml_str.contains(r#"<filters blank="1">"#));
        assert!(xml_str.contains(r#"<customFilters and="1">"#));
        assert!(xml_str.contains(r#"<top10 top="0" percent="1" val="10" filterVal="42"/>"#));
        assert!(xml_str.contains(r#"<dynamicFilter type="thisMonth" val="1" maxVal="2" valIso="2026-05-01T00:00:00Z" maxValIso="2026-05-31T00:00:00Z"/>"#));
        assert!(xml_str.contains(r#"<colorFilter dxfId="7" cellColor="0"/>"#));
        assert!(xml_str.contains(r#"<iconFilter iconSet="3TrafficLights1" iconId="2"/>"#));
    }

    #[test]
    fn test_table_with_sort_state_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer.add_column("Name").add_column("Value");

        let mut ss = SortState::new("A2:D10");
        ss.column_sort = true;
        ss.sort_method = domain_types::SortMethod::PinYin;
        ss.add_condition(SortCondition::new("B:B"))
            .add_condition(SortCondition::descending("C:C"));
        let mut icon_condition = SortCondition::new("D:D");
        icon_condition.sort_by = Some(SortBy::Icon);
        icon_condition.icon_set = Some(IconSetType::ThreeTrafficLights1);
        icon_condition.icon_id = Some(1);
        icon_condition.custom_list = Some("High,Medium,Low".to_string());
        icon_condition.dxf_id = Some(4);
        ss.add_condition(icon_condition);
        writer.set_sort_state(ss);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<sortState ref=\"A2:D10\" columnSort=\"1\" sortMethod=\"pinYin\">"));
        assert!(xml_str.contains("<sortCondition ref=\"B:B\"/>"));
        assert!(xml_str.contains("descending=\"1\""));
        assert!(xml_str.contains("ref=\"C:C\""));
        assert!(xml_str.contains("sortBy=\"icon\""));
        assert!(xml_str.contains("iconSet=\"3TrafficLights1\""));
        assert!(xml_str.contains("iconId=\"1\""));
        assert!(xml_str.contains("customList=\"High,Medium,Low\""));
        assert!(xml_str.contains("dxfId=\"4\""));
    }

    #[test]
    fn test_table_with_style_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer
            .add_column("Name")
            .set_style_name("TableStyleMedium9");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<tableStyleInfo"));
        assert!(xml_str.contains("name=\"TableStyleMedium9\""));
        assert!(xml_str.contains("showFirstColumn=\"0\""));
        assert!(xml_str.contains("showLastColumn=\"0\""));
        assert!(xml_str.contains("showRowStripes=\"1\""));
        assert!(xml_str.contains("showColumnStripes=\"0\""));
    }

    #[test]
    fn test_complete_table_xml() {
        let mut writer = TableWriter::new(1, "SalesData", "A1:F11");
        writer
            .add_column("ID")
            .add_column("Category")
            .add_column("Product")
            .add_column_with_totals("Quantity", TotalsRowFunction::Sum)
            .add_column("Date")
            .add_calculated_column("Revenue", "[@Quantity]*[@Price]")
            .with_totals_row()
            .enable_auto_filter()
            .set_style_name("TableStyleMedium9");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Verify structure
        assert!(xml_str.contains("<?xml version=\"1.0\""));
        assert!(xml_str.contains("<table xmlns="));
        assert!(xml_str.contains("id=\"1\""));
        assert!(xml_str.contains("name=\"SalesData\""));
        assert!(xml_str.contains("ref=\"A1:F11\""));
        assert!(xml_str.contains("totalsRowCount=\"1\""));
        // headerRowCount=1 is the default and should NOT be emitted
        assert!(!xml_str.contains("headerRowCount="));
        assert!(xml_str.contains("<autoFilter ref=\"A1:F11\"/>"));
        assert!(xml_str.contains("<tableColumns count=\"6\""));
        assert!(xml_str.contains("totalsRowFunction=\"sum\""));
        assert!(
            xml_str.contains(
                "<calculatedColumnFormula>[@Quantity]*[@Price]</calculatedColumnFormula>"
            )
        );
        assert!(xml_str.contains("<tableStyleInfo"));
        assert!(xml_str.contains("</table>"));
    }

    #[test]
    fn test_top10_filter_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:B10");
        writer.add_column("Name").add_column("Value");

        let mut af = AutoFilterDef::new("A1:B10");
        af.add_filter_column(FilterColumn::with_top10(1, true, false, 10.0));
        writer.set_auto_filter(af);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<top10"));
        assert!(xml_str.contains("top=\"1\""));
        assert!(xml_str.contains("percent=\"0\""));
        assert!(xml_str.contains("val=\"10\""));
    }

    #[test]
    fn test_dynamic_filter_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:B10");
        writer.add_column("Date").add_column("Value");

        let mut af = AutoFilterDef::new("A1:B10");
        af.add_filter_column(FilterColumn::with_dynamic_filter(
            0,
            DynamicFilterType::ThisMonth,
        ));
        writer.set_auto_filter(af);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<dynamicFilter"));
        assert!(xml_str.contains("type=\"thisMonth\""));
    }

    #[test]
    fn test_structured_reference_formula() {
        let mut writer = TableWriter::new(1, "Table1", "A1:D10");
        writer
            .add_column("Quantity")
            .add_column("Price")
            .add_calculated_column("Total", "[@Quantity]*[@Price]")
            .add_calculated_column("Doubled", "[Quantity]*2");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Verify structured references are preserved
        assert!(xml_str.contains("[@Quantity]*[@Price]"));
        assert!(xml_str.contains("[Quantity]*2"));
    }

    #[test]
    fn test_empty_table_xml() {
        let writer = TableWriter::new(1, "EmptyTable", "A1:A1");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<table xmlns="));
        assert!(xml_str.contains("id=\"1\""));
        assert!(xml_str.contains("name=\"EmptyTable\""));
        assert!(xml_str.contains("ref=\"A1:A1\""));
        // No tableColumns element when there are no columns
        assert!(!xml_str.contains("<tableColumns"));
    }

    #[test]
    fn test_multi_column_sort_xml() {
        let mut writer = TableWriter::new(1, "Table1", "A1:C10");
        writer
            .add_column("Category")
            .add_column("Name")
            .add_column("Value");

        let mut ss = SortState::new("A2:C10");
        ss.case_sensitive = true;
        ss.add_condition(SortCondition::new("A:A"))
            .add_condition(SortCondition::descending("C:C"));
        writer.set_sort_state(ss);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<sortState ref=\"A2:C10\" caseSensitive=\"1\">"));
        assert!(xml_str.contains("<sortCondition ref=\"A:A\"/>"));
        assert!(xml_str.contains("<sortCondition descending=\"1\" ref=\"C:C\"/>"));
    }
}

// ============================================================================
// Domain bridge: domain_types::TableSpec → TableWriter
// ============================================================================

/// Convert a `domain_types::TableSpec` into a fully configured `TableWriter`.
///
/// The caller is responsible for calling `.to_xml()` on the returned writer.
/// This keeps serialization in one place (the writer) and conversion separate.
pub fn table_writer_from_domain(global_id: u32, table: &domain_types::TableSpec) -> TableWriter {
    let mut tw = TableWriter::new(global_id, &table.name, &table.range_ref);
    tw.display_name = table.display_name.clone();

    // Header/totals row settings
    tw.header_row_count = if table.has_headers { 1 } else { 0 };
    tw.totals_row_count = if table.has_totals { 1 } else { 0 };

    // Table-level metadata
    tw.table_type = table.table_type.clone();
    tw.totals_row_shown = table.totals_row_shown;
    tw.connection_id = table.connection_id;
    tw.insert_row = table.insert_row;
    tw.insert_row_shift = table.insert_row_shift;
    tw.published = table.published;
    tw.xr_uid = table.xr_uid.clone();

    // DXF formatting IDs
    tw.header_row_dxf_id = table.header_row_dxf_id;
    tw.data_dxf_id = table.data_dxf_id;
    tw.totals_row_dxf_id = table.totals_row_dxf_id;
    tw.header_row_border_dxf_id = table.header_row_border_dxf_id;
    tw.table_border_dxf_id = table.table_border_dxf_id;
    tw.totals_row_border_dxf_id = table.totals_row_border_dxf_id;
    tw.header_row_cell_style = table.header_row_cell_style.clone();
    tw.data_cell_style = table.data_cell_style.clone();
    tw.totals_row_cell_style = table.totals_row_cell_style.clone();

    // Auto-filter
    if let Some(ref af_ref) = table.auto_filter_ref {
        let mut af = AutoFilterDef::new(af_ref);
        af.xr_uid = table.auto_filter_xr_uid.clone();
        // Convert domain filter column specs to writer filter columns
        for fc_spec in &table.filter_columns {
            if let Some(fc) = convert_filter_column_spec_to_writer(fc_spec) {
                af.filter_columns.push(fc);
            }
        }
        tw.auto_filter = Some(af);
    } else if table.has_headers {
        tw.auto_filter = Some(AutoFilterDef::new(&table.range_ref));
    }

    // Table columns
    for col in &table.columns {
        let mut tc = TableColumn::new(col.id, &col.name);
        tc.unique_name = col.unique_name.clone();
        tc.query_table_field_id = col.query_table_field_id;
        if let Some(ref label) = col.totals_label {
            tc.totals_row_label = Some(label.clone());
        }
        if let Some(func) = &col.totals_function {
            tc.totals_row_function = Some(TotalsRowFunction::from_ooxml(func.to_ooxml_str()));
        }
        if let Some(ref formula) = col.calculated_formula {
            tc.calculated_column_formula = Some(if col.calculated_formula_array {
                TableFormula::new_array(formula)
            } else {
                TableFormula::new(formula)
            });
        }
        if let Some(ref formula) = col.totals_row_formula {
            tc.totals_row_formula = Some(if col.totals_row_formula_array {
                TableFormula::new_array(formula)
            } else {
                TableFormula::new(formula)
            });
        }
        tc.data_format_id = col.data_dxf_id;
        tc.header_row_dxf_id = col.header_row_dxf_id;
        tc.totals_row_dxf_id = col.totals_row_dxf_id;
        tc.header_row_cell_style = col.header_row_cell_style.clone();
        tc.data_cell_style = col.data_cell_style.clone();
        tc.totals_row_cell_style = col.totals_row_cell_style.clone();
        tc.xr3_uid = col.xr3_uid.clone();
        tw.columns.push(tc);
    }

    // Sort state (table-level)
    if let Some(ref ss) = table.sort_state {
        let mut sort = SortState::new(&ss.ref_range);
        sort.column_sort = ss.column_sort;
        sort.case_sensitive = ss.case_sensitive;
        sort.sort_method = ss.sort_method;
        for sc in &ss.conditions {
            let mut cond = SortCondition::new(&sc.ref_range);
            cond.descending = sc.descending;
            cond.sort_by = Some(match sc.sort_by {
                domain_types::SortConditionBy::Value => SortBy::Value,
                domain_types::SortConditionBy::CellColor => SortBy::CellColor,
                domain_types::SortConditionBy::FontColor => SortBy::FontColor,
                domain_types::SortConditionBy::Icon => SortBy::Icon,
            });
            cond.custom_list = sc.custom_list.clone();
            cond.dxf_id = sc.dxf_id;
            cond.icon_set = sc.icon_set;
            cond.icon_id = sc.icon_id;
            sort.add_condition(cond);
        }
        tw.sort_state = Some(sort);
    }

    // Table style
    tw.style_info = Some(TableStyleInfo {
        name: table.style_name.clone(),
        show_first_column: table.first_col_highlight,
        show_last_column: table.last_col_highlight,
        show_row_stripes: table.row_stripes,
        show_column_stripes: table.col_stripes,
    });

    tw
}

/// Convert a domain FilterColumnSpec to a writer FilterColumn.
fn convert_filter_column_spec_to_writer(
    spec: &domain_types::FilterColumnSpec,
) -> Option<FilterColumn> {
    let filter = match &spec.filter {
        domain_types::FilterSpec::Values { values, blank } => FilterType::Filters {
            values: values.clone(),
            blank: *blank,
        },
        domain_types::FilterSpec::Custom { filters, and } => FilterType::CustomFilters {
            filters: filters
                .iter()
                .map(|f| CustomFilter::new(FilterOperator::from_ooxml(&f.operator), &f.val))
                .collect(),
            and: *and,
        },
        domain_types::FilterSpec::Top10 {
            top,
            percent,
            val,
            filter_val,
        } => FilterType::Top10 {
            top: *top,
            percent: *percent,
            val: *val,
            filter_val: *filter_val,
        },
        domain_types::FilterSpec::Dynamic {
            kind,
            val,
            max_val,
            val_iso,
            max_val_iso,
        } => FilterType::DynamicFilter {
            kind: DynamicFilterType::from_ooxml(kind),
            val: *val,
            max_val: *max_val,
            val_iso: val_iso.clone(),
            max_val_iso: max_val_iso.clone(),
        },
        domain_types::FilterSpec::Color { dxf_id, cell_color } => FilterType::ColorFilter {
            cell_color: *cell_color,
            dxf_id: *dxf_id,
        },
        domain_types::FilterSpec::Icon { icon_set, icon_id } => FilterType::IconFilter {
            icon_set: icon_set.clone(),
            icon_id: *icon_id,
        },
    };
    Some(FilterColumn {
        col_id: spec.col_id,
        hidden_button: spec.hidden_button,
        show_button: spec.show_button,
        filter,
    })
}
