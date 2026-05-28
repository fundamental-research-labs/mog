use crate::write::xml_writer::XmlWriter;

use super::columns::write_table_column_xml;
use super::namespaces::{MARKUP_COMPATIBILITY_NS, SPREADSHEETML_NS, XR_NS, XR3_NS};
use super::style::write_table_style_info_xml;
use super::{
    AutoFilterDef, SortState, TableColumn, TableFormula, TableStyleInfo, TotalsRowFunction,
};

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
    /// Table comment attribute.
    pub comment: Option<String>,
    /// Whether to insert a blank row below table.
    pub insert_row: bool,
    /// Whether insert row shifts existing rows.
    pub insert_row_shift: bool,
    /// Whether the table is published.
    pub published: bool,
    /// Extension UID for revision tracking (xr:uid).
    /// When present, triggers mc:Ignorable="xr xr3" and xmlns:xr/xr3 declarations.
    pub xr_uid: Option<String>,
    /// Whether to suppress Transitional-only attributes.
    pub strict_ooxml: bool,
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
            comment: None,
            insert_row: false,
            insert_row_shift: false,
            published: false,
            xr_uid: None,
            strict_ooxml: false,
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

        // Start table element; attribute order follows Excel's canonical output.
        w.start_element("table").attr("xmlns", SPREADSHEETML_NS);

        if self.xr_uid.is_some() {
            w.attr("xmlns:mc", MARKUP_COMPATIBILITY_NS);
            w.attr("mc:Ignorable", "xr xr3");
            w.attr("xmlns:xr", XR_NS);
            w.attr("xmlns:xr3", XR3_NS);
        }

        if let Some(ref tt) = self.table_type {
            w.attr("tableType", tt);
        }
        w.attr_num("id", self.id);
        if let Some(ref uid) = self.xr_uid {
            w.attr("xr:uid", uid);
        }
        w.attr_xstring("name", &self.name)
            .attr_xstring("displayName", &self.display_name)
            .attr("ref", &self.range);
        if self.totals_row_count > 0 {
            w.attr_num("totalsRowCount", self.totals_row_count);
        }
        if self.header_row_count != 1 {
            w.attr_num("headerRowCount", self.header_row_count);
        }
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
        if let Some(ref comment) = self.comment {
            w.attr_xstring("comment", comment);
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

        if let Some(ref af) = self.auto_filter {
            af.write_xml_with_strict(&mut w, self.strict_ooxml);
        }

        if let Some(ref ss) = self.sort_state {
            ss.write_xml(&mut w);
        }

        if !self.columns.is_empty() {
            w.start_element("tableColumns")
                .attr_num("count", self.columns.len())
                .end_attrs();

            for col in &self.columns {
                write_table_column_xml(&mut w, col);
            }

            w.end_element("tableColumns");
        }

        if let Some(ref style) = self.style_info {
            write_table_style_info_xml(style, &mut w);
        }

        w.end_element("table");

        w.finish()
    }
}
