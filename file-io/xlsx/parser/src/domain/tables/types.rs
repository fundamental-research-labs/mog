//! Core table type definitions for Excel Tables.
//!
//! This module contains the fundamental types for representing Excel Tables
//! according to ECMA-376 Part 1, specifically CT_Table and CT_TableColumn.
//!
//! Enum types (`TotalsRowFunction`, `TableType`, `SortOrder`) are re-exported
//! from the canonical `ooxml_types::tables` module.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr_opt, parse_bytes_attr, parse_element_content, parse_string_attr, parse_u32_attr,
};

use super::filter::AutoFilter;
use super::style::{TableStyleInfo, parse_table_style_info};

// Re-export canonical enum types from ooxml_types.
pub use ooxml_types::tables::{SortOrder, TableFormula, TableType, TotalsRowFunction, XmlColumnPr};

// Typed range refs: custom serde serializer for `Option<compute_parser::RangeRef>`.
//
// The upstream `compute_parser::RangeRef` deliberately does not derive
// Serialize (its identity-shaped counterpart in `formula-types` does, but the
// AST-shaped form with absoluteness flags is a parser-internal type). Tables
// are serialized as debug/diagnostic JSON in a handful of tests and trace
// paths; canonicalizing to A1 at the edge is the `to_a1_string` contract the
// plan's W2 introduces.
fn serialize_range_ref_a1<S: serde::Serializer>(
    rr: &Option<compute_parser::RangeRef>,
    ser: S,
) -> Result<S::Ok, S::Error> {
    match rr {
        Some(r) => ser.serialize_some(&r.to_a1_string()),
        None => ser.serialize_none(),
    }
}

// ============================================================================
// Table Column
// ============================================================================

/// Table column definition (CT_TableColumn)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct TableColumn {
    /// Column ID (unique within table)
    pub id: u32,
    /// Unique column name (displayed in header)
    pub name: String,
    /// Unique name (uniqueName attribute, used by query tables)
    pub unique_name: Option<String>,
    /// Totals row function (if totals row is shown)
    pub totals_row_function: TotalsRowFunction,
    /// Totals row label (alternative to function)
    pub totals_row_label: Option<String>,
    /// Query table field ID
    pub query_table_field_id: Option<u32>,
    /// Header row differential format ID
    pub header_row_dxf_id: Option<u32>,
    /// Data body differential format ID
    pub data_dxf_id: Option<u32>,
    /// Totals row differential format ID
    pub totals_row_dxf_id: Option<u32>,
    /// Header row cell style
    pub header_row_cell_style: Option<String>,
    /// Data cell style
    pub data_cell_style: Option<String>,
    /// Totals row cell style
    pub totals_row_cell_style: Option<String>,
    /// Calculated column formula (for computed columns)
    pub calculated_column_formula: Option<TableFormula>,
    /// Totals row formula (for custom totals)
    pub totals_row_formula: Option<TableFormula>,
    /// XML column properties for XML-mapped tables.
    pub xml_column_pr: Option<XmlColumnPr>,
    /// Extension UID for revision tracking (xr3:uid)
    pub xr3_uid: Option<String>,
}

impl TableColumn {
    /// Parse a tableColumn element
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        let mut col = TableColumn {
            id: parse_u32_attr(tag, b"id=\"").unwrap_or(0),
            name: parse_string_attr(tag, b"name=\"").unwrap_or_default(),
            unique_name: parse_string_attr(tag, b"uniqueName=\""),
            totals_row_function: parse_bytes_attr(tag, b"totalsRowFunction=\"")
                .map(TotalsRowFunction::from_bytes)
                .unwrap_or_default(),
            totals_row_label: parse_string_attr(tag, b"totalsRowLabel=\""),
            query_table_field_id: parse_u32_attr(tag, b"queryTableFieldId=\""),
            header_row_dxf_id: parse_u32_attr(tag, b"headerRowDxfId=\""),
            data_dxf_id: parse_u32_attr(tag, b"dataDxfId=\""),
            totals_row_dxf_id: parse_u32_attr(tag, b"totalsRowDxfId=\""),
            header_row_cell_style: parse_string_attr(tag, b"headerRowCellStyle=\""),
            data_cell_style: parse_string_attr(tag, b"dataCellStyle=\""),
            totals_row_cell_style: parse_string_attr(tag, b"totalsRowCellStyle=\""),
            calculated_column_formula: None,
            totals_row_formula: None,
            xml_column_pr: None,
            xr3_uid: parse_string_attr(tag, b"xr3:uid=\""),
        };

        // Check for self-closing tag
        if tag.len() > 1 && tag[tag.len() - 1] == b'/' {
            return Some(col);
        }

        // Find end of tableColumn element
        let col_end = find_closing_tag(xml, b"tableColumn", tag_end).unwrap_or(xml.len());
        let content = &xml[tag_end + 1..col_end];

        // Parse calculatedColumnFormula (with optional array="1" attribute)
        if let Some(formula) = parse_element_content(content, b"calculatedColumnFormula") {
            let is_array = find_tag_simd(content, b"calculatedColumnFormula", 0)
                .and_then(|start| find_gt_simd(content, start).map(|end| &content[start..end]))
                .and_then(|tag| parse_bool_attr_opt(tag, b"array=\""))
                .unwrap_or(false);
            col.calculated_column_formula = Some(if is_array {
                TableFormula::new_array(formula)
            } else {
                TableFormula::new(formula)
            });
        }

        // Parse totalsRowFormula (with optional array="1" attribute)
        if let Some(formula) = parse_element_content(content, b"totalsRowFormula") {
            let is_array = find_tag_simd(content, b"totalsRowFormula", 0)
                .and_then(|start| find_gt_simd(content, start).map(|end| &content[start..end]))
                .and_then(|tag| parse_bool_attr_opt(tag, b"array=\""))
                .unwrap_or(false);
            col.totals_row_formula = Some(if is_array {
                TableFormula::new_array(formula)
            } else {
                TableFormula::new(formula)
            });
        }

        if let Some(xml_column_pr) = parse_xml_column_pr(content) {
            col.xml_column_pr = Some(xml_column_pr);
        }

        Some(col)
    }
}

fn parse_xml_column_pr(content: &[u8]) -> Option<XmlColumnPr> {
    let start = find_tag_simd(content, b"xmlColumnPr", 0)?;
    let tag_end = find_gt_simd(content, start)?;
    let tag = &content[start..tag_end];
    let end = if tag.len() > 1 && tag[tag.len() - 1] == b'/' {
        tag_end + 1
    } else {
        find_closing_tag(content, b"xmlColumnPr", tag_end)
            .and_then(|p| find_gt_simd(content, p).map(|g| g + 1))
            .unwrap_or(tag_end + 1)
    };
    let element = &content[start..end.min(content.len())];

    Some(XmlColumnPr {
        map_id: parse_u32_attr(tag, b"mapId=\"").unwrap_or(0),
        xpath: parse_string_attr(tag, b"xpath=\"").unwrap_or_default(),
        denormalized: parse_bool_attr_opt(tag, b"denormalized=\"").unwrap_or(false),
        xml_data_type: parse_string_attr(tag, b"xmlDataType=\"").unwrap_or_default(),
        ext_lst_xml: extract_ext_lst(element),
    })
}

fn extract_ext_lst(xml: &[u8]) -> Option<String> {
    let start = find_tag_simd(xml, b"extLst", 0)?;
    let open_end = find_gt_simd(xml, start)? + 1;
    let end = if open_end >= 2 && xml[open_end - 2] == b'/' {
        open_end
    } else {
        find_closing_tag(xml, b"extLst", start).and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))?
    };
    String::from_utf8(xml[start..end].to_vec()).ok()
}

// ============================================================================
// Main Table Structure
// ============================================================================

/// Complete Excel Table definition (CT_Table)
///
/// Represents a structured table in an Excel worksheet with columns,
/// optional header and totals rows, auto-filter capabilities, and styling.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Table {
    /// Unique table ID
    pub id: u32,
    /// Internal name (used for references)
    pub name: String,
    /// Display name shown to users
    pub display_name: String,
    /// Reference range (e.g., `A1:E10`) as a typed [`compute_parser::RangeRef`].
    ///
    /// **Typed range refs: — typed boundary 1.10.** Replaces the prior
    /// `ref_range: String` which obscured the A1 grammar. Parsed once at XLSX
    /// read time via [`compute_parser::parse_a1_range`]; writers canonicalize
    /// via `RangeRef::to_a1_string`.
    ///
    /// `None` when the XLSX `ref` attribute is absent or fails to parse as a
    /// valid A1 range; downstream consumers treat this the same as the empty-
    /// string case the previous String field used.
    ///
    /// Serde: serialized as the canonical A1 string (the `Table` struct itself
    /// is not deserialized; its round-trip path is XML → `Table` → `ParsedTable`
    /// via `convert_table_to_parsed`).
    #[serde(serialize_with = "serialize_range_ref_a1")]
    pub ref_range: Option<compute_parser::RangeRef>,
    /// Table type
    pub table_type: TableType,
    /// Number of header rows (typically 0 or 1)
    pub header_row_count: u32,
    /// Insert row showing
    pub insert_row: bool,
    /// Insert row shift
    pub insert_row_shift: bool,
    /// Number of totals rows (typically 0 or 1)
    pub totals_row_count: u32,
    /// Whether totals row is shown (None = attribute absent, OOXML default is true)
    pub totals_row_shown: Option<bool>,
    /// Whether the table is published
    pub published: bool,
    /// Header row format ID
    pub header_row_dxf_id: Option<u32>,
    /// Data format ID
    pub data_dxf_id: Option<u32>,
    /// Totals row format ID
    pub totals_row_dxf_id: Option<u32>,
    /// Header row border format ID
    pub header_row_border_dxf_id: Option<u32>,
    /// Table border format ID
    pub table_border_dxf_id: Option<u32>,
    /// Totals row border format ID
    pub totals_row_border_dxf_id: Option<u32>,
    /// Header row cell style
    pub header_row_cell_style: Option<String>,
    /// Data cell style
    pub data_cell_style: Option<String>,
    /// Totals row cell style
    pub totals_row_cell_style: Option<String>,
    /// Connection ID for external data
    pub connection_id: Option<u32>,
    /// Comment
    pub comment: Option<String>,
    /// Extension UID for revision tracking (xr:uid), triggers mc:Ignorable output.
    pub xr_uid: Option<String>,
    /// Table columns
    pub columns: Vec<TableColumn>,
    /// AutoFilter settings
    pub auto_filter: Option<AutoFilter>,
    /// Table-level sort state (sibling of autoFilter, not inside it)
    pub sort_state: Option<super::sort::SortState>,
    /// Table style information
    pub table_style_info: Option<TableStyleInfo>,
}

impl Table {
    /// Parse a table definition from XML bytes.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the table XML file (xl/tables/table*.xml)
    ///
    /// # Returns
    /// Parsed Table struct, or None if parsing fails
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let table_start = find_tag_simd(xml, b"table", 0)?;
        let table_tag_end = find_gt_simd(xml, table_start)?;
        let table_tag = &xml[table_start..table_tag_end];

        // Typed range refs: parse the `ref` attribute into a typed RangeRef at
        // XLSX read time. The grammar (A1 range) is resolved here so no
        // downstream consumer re-parses the string.
        let ref_range = parse_string_attr(table_tag, b"ref=\"")
            .filter(|s| !s.is_empty())
            .and_then(|s| compute_parser::parse_a1_range(&s));

        let mut table = Table {
            id: parse_u32_attr(table_tag, b"id=\"").unwrap_or(0),
            name: parse_string_attr(table_tag, b"name=\"").unwrap_or_default(),
            display_name: parse_string_attr(table_tag, b"displayName=\"").unwrap_or_default(),
            ref_range,
            table_type: parse_bytes_attr(table_tag, b"tableType=\"")
                .map(TableType::from_bytes)
                .unwrap_or_default(),
            header_row_count: parse_u32_attr(table_tag, b"headerRowCount=\"").unwrap_or(1),
            insert_row: parse_bool_attr_opt(table_tag, b"insertRow=\"").unwrap_or(false),
            insert_row_shift: parse_bool_attr_opt(table_tag, b"insertRowShift=\"").unwrap_or(false),
            totals_row_count: parse_u32_attr(table_tag, b"totalsRowCount=\"").unwrap_or(0),
            totals_row_shown: parse_bool_attr_opt(table_tag, b"totalsRowShown=\""),
            published: parse_bool_attr_opt(table_tag, b"published=\"").unwrap_or(false),
            header_row_dxf_id: parse_u32_attr(table_tag, b"headerRowDxfId=\""),
            data_dxf_id: parse_u32_attr(table_tag, b"dataDxfId=\""),
            totals_row_dxf_id: parse_u32_attr(table_tag, b"totalsRowDxfId=\""),
            header_row_border_dxf_id: parse_u32_attr(table_tag, b"headerRowBorderDxfId=\""),
            table_border_dxf_id: parse_u32_attr(table_tag, b"tableBorderDxfId=\""),
            totals_row_border_dxf_id: parse_u32_attr(table_tag, b"totalsRowBorderDxfId=\""),
            header_row_cell_style: parse_string_attr(table_tag, b"headerRowCellStyle=\""),
            data_cell_style: parse_string_attr(table_tag, b"dataCellStyle=\""),
            totals_row_cell_style: parse_string_attr(table_tag, b"totalsRowCellStyle=\""),
            connection_id: parse_u32_attr(table_tag, b"connectionId=\""),
            comment: parse_string_attr(table_tag, b"comment=\""),
            xr_uid: parse_string_attr(table_tag, b"xr:uid=\""),
            columns: Vec::new(),
            auto_filter: None,
            sort_state: None,
            table_style_info: None,
        };

        // Find the end of the table element
        let table_end = find_closing_tag(xml, b"table", table_tag_end).unwrap_or(xml.len());
        let content = &xml[table_tag_end + 1..table_end];

        // Parse autoFilter
        table.auto_filter = AutoFilter::parse(content);

        // Parse table-level sortState (sibling of autoFilter, not inside it).
        // In OOXML, sortState can be a child of either autoFilter or table.
        // We parse it at the table level to catch both cases. If autoFilter
        // already parsed it (inside its own content), skip the table-level one.
        if table
            .auto_filter
            .as_ref()
            .map_or(true, |af| af.sort_state.is_none())
        {
            if let Some(ss_start) = find_tag_simd(content, b"sortState", 0) {
                let ss_end = find_closing_tag(content, b"sortState", ss_start)
                    .and_then(|p| find_gt_simd(content, p).map(|g| g + 1))
                    .unwrap_or(content.len());
                table.sort_state = super::sort::SortState::parse(&content[ss_start..ss_end]);
            }
        }

        // Parse tableColumns
        if let Some(tc_start) = find_tag_simd(content, b"tableColumns", 0) {
            let tc_end =
                find_closing_tag(content, b"tableColumns", tc_start).unwrap_or(content.len());
            let columns_section = &content[tc_start..tc_end];

            let mut pos = 0;
            while let Some(col_start) = find_tag_simd(columns_section, b"tableColumn", pos) {
                // Avoid matching tableColumns again
                if col_start + 12 < columns_section.len() && columns_section[col_start + 12] == b's'
                {
                    pos = col_start + 1;
                    continue;
                }

                // First find the end of the opening tag
                let tag_end =
                    find_gt_simd(columns_section, col_start).unwrap_or(columns_section.len());

                // Check if it's a self-closing tag (ends with />)
                let is_self_closing = tag_end > 0 && columns_section[tag_end - 1] == b'/';

                let col_end = if is_self_closing {
                    // Self-closing tag: element ends at the >
                    tag_end + 1
                } else {
                    // Has closing tag: find </tableColumn>
                    find_closing_tag(columns_section, b"tableColumn", tag_end)
                        .and_then(|p| find_gt_simd(columns_section, p).map(|g| g + 1))
                        .unwrap_or(columns_section.len())
                };

                if let Some(col) = TableColumn::parse(&columns_section[col_start..col_end]) {
                    table.columns.push(col);
                }
                pos = col_end;
            }
        }

        // Parse tableStyleInfo
        table.table_style_info = parse_table_style_info(content);

        Some(table)
    }

    /// Get the number of data rows (excluding header and totals)
    pub fn data_row_count(&self) -> u32 {
        // Parse ref range to get total rows
        // For simplicity, this would need range parsing
        // Returning 0 as placeholder - real implementation would parse ref_range
        0
    }

    /// Check if the table has a header row
    pub fn has_header(&self) -> bool {
        self.header_row_count > 0
    }

    /// Check if the table has a totals row
    pub fn has_totals(&self) -> bool {
        self.totals_row_count > 0 || self.totals_row_shown.unwrap_or(false)
    }
}
