//! `pivotTableDefinition` parsing.

use crate::domain::pivot::model::{PivotLocation, PivotStyleInfo, PivotTable};
use crate::domain::pivot::parse::table_fields::{
    parse_data_fields, parse_field_refs, parse_page_fields, parse_pivot_fields,
};
use crate::domain::pivot::reader::elements::{child_slice, first_element_span, opening_tag};
use crate::domain::pivot::reader::raw::raw_element;
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_with_default, parse_string_attr, parse_u32_attr,
};

/// Parse a pivot table definition from pivotTable*.xml.
pub fn parse_pivot_table(xml: &[u8]) -> PivotTable {
    let mut pivot = PivotTable::default();
    let Some(root) = first_element_span(xml, b"pivotTableDefinition", 0) else {
        return pivot;
    };

    pivot.raw_xml = raw_element(xml, b"pivotTableDefinition");

    let element = &xml[root.start..root.tag_end];
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
    pivot.row_grand_totals = parse_bool_attr_with_default(element, b"rowGrandTotals=\"", true);
    pivot.col_grand_totals = parse_bool_attr_with_default(element, b"colGrandTotals=\"", true);
    pivot.show_missing = parse_bool_attr_with_default(element, b"showMissing=\"", true);

    if let Some((loc_start, loc_end)) = opening_tag(&xml[root.start..root.end], b"location", 0) {
        pivot.location = parse_location(&xml[root.start + loc_start..root.start + loc_end]);
    }
    if let Some(fields) = child_slice(xml, root, b"pivotFields") {
        pivot.pivot_fields = parse_pivot_fields(fields);
    }
    if let Some(row_fields) = child_slice(xml, root, b"rowFields") {
        pivot.row_fields = parse_field_refs(row_fields);
    }
    if let Some(col_fields) = child_slice(xml, root, b"colFields") {
        pivot.col_fields = parse_field_refs(col_fields);
    }
    if let Some(data_fields) = child_slice(xml, root, b"dataFields") {
        pivot.data_fields = parse_data_fields(data_fields);
    }
    if let Some(page_fields) = child_slice(xml, root, b"pageFields") {
        pivot.page_fields = parse_page_fields(page_fields);
    }
    if let Some((style_start, style_end)) =
        opening_tag(&xml[root.start..root.end], b"pivotTableStyleInfo", 0)
    {
        pivot.style_info = Some(parse_style_info(
            &xml[root.start + style_start..root.start + style_end],
        ));
    }

    pivot
}

pub(crate) fn parse_location(xml: &[u8]) -> PivotLocation {
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

pub(crate) fn parse_style_info(xml: &[u8]) -> PivotStyleInfo {
    PivotStyleInfo {
        name: parse_string_attr(xml, b"name=\""),
        show_row_headers: parse_bool_attr(xml, b"showRowHeaders=\""),
        show_col_headers: parse_bool_attr(xml, b"showColHeaders=\""),
        show_row_stripes: parse_bool_attr(xml, b"showRowStripes=\""),
        show_col_stripes: parse_bool_attr(xml, b"showColStripes=\""),
        show_last_column: parse_bool_attr(xml, b"showLastColumn=\""),
    }
}
