//! `pivotTableDefinition` parsing.

use crate::domain::pivot::model::{PivotLocation, PivotStyleInfo, PivotTable};
use crate::domain::pivot::parse::table_fields::{
    parse_data_fields, parse_field_refs, parse_page_fields, parse_pivot_fields, parse_row_col_items,
};
use crate::domain::pivot::preservation::capture_root_preservation;
use crate::domain::pivot::reader::elements::{child_slice, first_element_span, opening_tag};
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_with_default, parse_string_attr, parse_u32_attr,
};

/// Parse a pivot table definition from pivotTable*.xml.
pub fn parse_pivot_table(xml: &[u8]) -> PivotTable {
    let mut pivot = PivotTable::default();
    let Some(root) = first_element_span(xml, b"pivotTableDefinition", 0) else {
        return pivot;
    };

    let element = &xml[root.start..root.tag_end];
    pivot.ooxml_preservation = capture_root_preservation(xml, root);
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
    if let Some(row_items) = child_slice(xml, root, b"rowItems") {
        pivot.row_items = parse_row_col_items(row_items);
    }
    if let Some(col_fields) = child_slice(xml, root, b"colFields") {
        pivot.col_fields = parse_field_refs(col_fields);
    }
    if let Some(col_items) = child_slice(xml, root, b"colItems") {
        pivot.col_items = parse_row_col_items(col_items);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::model::PivotAxis;

    #[test]
    fn empty_input_returns_default_pivot_table() {
        let pivot = parse_pivot_table(b"<?xml version=\"1.0\"?><worksheet></worksheet>");

        assert!(pivot.name.is_empty());
        assert_eq!(pivot.cache_id, 0);
        assert!(pivot.location.ref_.is_none());
    }

    #[test]
    fn parses_root_attributes_location_and_entities() {
        let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="Sales &amp; Marketing" cacheId="1" dataOnRows="1">
    <location ref="A3:D10" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>
</pivotTableDefinition>"#;

        let pivot = parse_pivot_table(xml);

        assert_eq!(pivot.name, "Sales & Marketing");
        assert_eq!(pivot.cache_id, 1);
        assert!(pivot.data_on_rows);
        assert_eq!(
            pivot.location.ref_.as_ref().map(|r| r.to_a1_string()),
            Some("A3:D10".to_string())
        );
        assert_eq!(pivot.location.first_header_row, 1);
        assert_eq!(pivot.location.first_data_row, 2);
        assert_eq!(pivot.location.first_data_col, 1);
    }

    #[test]
    fn parses_fields_and_style_sections() {
        let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="Test" cacheId="1">
    <location ref="A1:C5"/>
    <rowFields count="2"><field x="0"/><field x="1"/></rowFields>
    <pivotFields count="2">
        <pivotField axis="axisRow" showAll="1" sortType="ascending">
            <items count="2"><item x="0"/><item x="1"/></items>
        </pivotField>
        <pivotField axis="axisCol" dataField="1"/>
    </pivotFields>
    <pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1"/>
</pivotTableDefinition>"#;

        let pivot = parse_pivot_table(xml);

        assert_eq!(pivot.row_fields.len(), 2);
        assert_eq!(pivot.row_fields[0].x, 0);
        assert_eq!(pivot.row_fields[1].x, 1);
        assert_eq!(pivot.pivot_fields.len(), 2);
        assert_eq!(pivot.pivot_fields[0].axis, Some(PivotAxis::Row));
        assert_eq!(pivot.pivot_fields[0].items.len(), 2);
        assert!(pivot.pivot_fields[1].data_field);
        let style = pivot.style_info.expect("style info should parse");
        assert_eq!(style.name, Some("PivotStyleMedium9".to_string()));
        assert!(style.show_row_headers);
        assert!(style.show_col_headers);
    }

    #[test]
    fn typed_location_refs_keep_absolute_refs_and_reject_absent_empty_or_malformed_refs() {
        let absolute = parse_location(br#"<location ref="$A$1:$D$10"/>"#);
        assert_eq!(
            absolute.ref_.as_ref().map(|r| r.to_a1_string()),
            Some("$A$1:$D$10".to_string())
        );

        assert!(
            parse_location(br#"<location firstDataRow="1"/>"#)
                .ref_
                .is_none()
        );
        assert!(parse_location(br#"<location ref=""/>"#).ref_.is_none());
        assert!(
            parse_location(b"<location ref=\"not-a-range\"/>")
                .ref_
                .is_none()
        );
    }
}
