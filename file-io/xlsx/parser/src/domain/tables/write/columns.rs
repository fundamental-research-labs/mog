use crate::write::xml_writer::XmlWriter;

use super::{TableFormula, TotalsRowFunction};

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
    /// Data format ID (differential format) - legacy alias, prefer `data_dxf_id`
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

pub(crate) fn write_table_column_xml(w: &mut XmlWriter, col: &TableColumn) {
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
