//! Pivot table field parsing.

use crate::domain::pivot::model::{
    DataField, PageField, PivotField, PivotFieldRef, PivotItem, PivotRowColItem, Subtotal,
};
use crate::domain::pivot::reader::attrs::{
    parse_axis_attr, parse_data_field_sentinel, parse_item_type_attr, parse_sort_attr,
    parse_subtotal_attr,
};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_opt, parse_bool_attr_with_default, parse_i32_attr,
    parse_string_attr, parse_u32_attr,
};

pub(crate) fn parse_pivot_fields(xml: &[u8]) -> Vec<PivotField> {
    let mut fields = Vec::new();
    let mut pos = 0;
    let mut index = 0u32;

    while let Some(field_start) = find_tag_simd(xml, b"pivotField", pos) {
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let is_self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');
        let element = &xml[field_start..tag_end + 1];

        let mut field = PivotField {
            index,
            name: parse_string_attr(element, b"name=\""),
            axis: parse_axis_attr(element),
            subtotal_top: parse_bool_attr_with_default(element, b"subtotalTop=\"", true),
            show_all: parse_bool_attr_opt(element, b"showAll=\""),
            sort_type: parse_sort_attr(element),
            data_field: parse_bool_attr(element, b"dataField=\""),
            default_subtotal: parse_bool_attr_with_default(element, b"defaultSubtotal=\"", true),
            compact: parse_bool_attr_with_default(element, b"compact=\"", true),
            outline: parse_bool_attr_with_default(element, b"outline=\"", true),
            subtotals: parse_field_subtotals(element),
            ..Default::default()
        };

        if !is_self_closing {
            let field_end = find_closing_tag(xml, b"pivotField", field_start).unwrap_or(xml.len());

            if let Some(items_start) = find_tag_simd(&xml[field_start..field_end], b"items", 0) {
                let items_abs_start = field_start + items_start;
                let items_end =
                    find_closing_tag(xml, b"items", items_abs_start).unwrap_or(field_end);
                field.items = parse_pivot_items(&xml[items_abs_start..items_end]);
            }

            parse_auto_sort_scope(&mut field, &xml[field_start..field_end]);
            pos = field_end + 1;
        } else {
            pos = tag_end + 1;
        }

        fields.push(field);
        index += 1;
    }

    fields
}

fn parse_field_subtotals(element: &[u8]) -> Vec<Subtotal> {
    let mut subtotals = Vec::new();
    let subtotal_attrs = [
        (b"sumSubtotal=\"" as &[u8], Subtotal::Sum),
        (b"countASubtotal=\"" as &[u8], Subtotal::CountNums),
        (b"avgSubtotal=\"" as &[u8], Subtotal::Average),
        (b"maxSubtotal=\"" as &[u8], Subtotal::Max),
        (b"minSubtotal=\"" as &[u8], Subtotal::Min),
        (b"productSubtotal=\"" as &[u8], Subtotal::Product),
        (b"countSubtotal=\"" as &[u8], Subtotal::Count),
        (b"stdDevSubtotal=\"" as &[u8], Subtotal::StdDev),
        (b"stdDevPSubtotal=\"" as &[u8], Subtotal::StdDevP),
        (b"varSubtotal=\"" as &[u8], Subtotal::Var),
        (b"varPSubtotal=\"" as &[u8], Subtotal::VarP),
    ];
    for (attr, subtotal) in subtotal_attrs {
        if parse_bool_attr(element, attr) {
            subtotals.push(subtotal);
        }
    }
    subtotals
}

fn parse_auto_sort_scope(field: &mut PivotField, field_body: &[u8]) {
    let Some(auto_sort_start) = find_tag_simd(field_body, b"autoSortScope", 0) else {
        return;
    };
    let auto_sort_end =
        find_closing_tag(field_body, b"autoSortScope", auto_sort_start).unwrap_or(field_body.len());
    let scope = &field_body[auto_sort_start..auto_sort_end];

    if let Some(ref_start) = find_tag_simd(scope, b"reference", 0) {
        let ref_tag_end = find_gt_simd(scope, ref_start).unwrap_or(scope.len());
        let ref_element = &scope[ref_start..ref_tag_end + 1];
        if parse_data_field_sentinel(ref_element) {
            if let Some(x_start) = find_tag_simd(scope, b"x", ref_start) {
                let x_end = find_gt_simd(scope, x_start).unwrap_or(scope.len());
                field.auto_sort_data_field = parse_u32_attr(&scope[x_start..x_end + 1], b"v=\"");
            }
        }

        let ref1_end = find_closing_tag(scope, b"reference", ref_start).unwrap_or(ref_tag_end + 1);
        if let Some(ref2_start) = find_tag_simd(scope, b"reference", ref1_end) {
            let ref2_tag_end = find_gt_simd(scope, ref2_start).unwrap_or(scope.len());
            field.auto_sort_column_field =
                parse_u32_attr(&scope[ref2_start..ref2_tag_end + 1], b"field=\"");
            let ref2_close =
                find_closing_tag(scope, b"reference", ref2_start).unwrap_or(scope.len());
            if let Some(x2_start) = find_tag_simd(&scope[ref2_start..ref2_close], b"x", 0) {
                let x2_abs = ref2_start + x2_start;
                let x2_end = find_gt_simd(scope, x2_abs).unwrap_or(scope.len());
                field.auto_sort_column_item = parse_u32_attr(&scope[x2_abs..x2_end + 1], b"v=\"");
            }
        }
    }
}

pub(crate) fn parse_pivot_items(xml: &[u8]) -> Vec<PivotItem> {
    let mut items = Vec::new();
    let mut pos = 0;

    while let Some(item_start) = find_tag_simd(xml, b"item", pos) {
        let tag_end = find_gt_simd(xml, item_start).unwrap_or(xml.len());
        let element = &xml[item_start..tag_end + 1];

        items.push(PivotItem {
            item_type: parse_item_type_attr(element),
            x: parse_u32_attr(element, b"x=\""),
            hidden: parse_bool_attr(element, b"h=\""),
            show_details: parse_bool_attr_with_default(element, b"sd=\"", true),
            s: parse_string_attr(element, b"s=\""),
        });

        pos = tag_end + 1;
    }

    items
}

pub(crate) fn parse_field_refs(xml: &[u8]) -> Vec<PivotFieldRef> {
    let mut refs = Vec::new();
    let mut pos = 0;

    while let Some(field_start) = find_tag_simd(xml, b"field", pos) {
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let element = &xml[field_start..tag_end + 1];
        refs.push(PivotFieldRef {
            x: parse_i32_attr(element, b"x=\"").unwrap_or(0),
        });
        pos = tag_end + 1;
    }

    refs
}

pub(crate) fn parse_data_fields(xml: &[u8]) -> Vec<DataField> {
    let mut fields = Vec::new();
    let mut pos = 0;

    while let Some(field_start) = find_tag_simd(xml, b"dataField", pos) {
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let element = &xml[field_start..tag_end + 1];
        let subtotal = parse_subtotal_attr(element);
        let mut show_data_as = parse_string_attr(element, b"showDataAs=\"");

        if tag_end > 0 && xml[tag_end - 1] != b'/' {
            if let Some(close) = find_closing_tag(xml, b"dataField", field_start) {
                if show_data_as.is_none() {
                    show_data_as = parse_string_attr(&xml[tag_end + 1..close], b"pivotShowAs=\"");
                }
                fields.push(data_field_from_element(element, subtotal, show_data_as));
                pos = close;
                continue;
            }
        }

        fields.push(data_field_from_element(element, subtotal, show_data_as));
        pos = tag_end + 1;
    }

    fields
}

fn data_field_from_element(
    element: &[u8],
    subtotal: crate::domain::pivot::model::Subtotal,
    show_data_as: Option<String>,
) -> DataField {
    DataField {
        name: parse_string_attr(element, b"name=\""),
        field_index: parse_u32_attr(element, b"fld=\"").unwrap_or(0),
        subtotal,
        num_fmt_id: parse_u32_attr(element, b"numFmtId=\""),
        base_field: parse_i32_attr(element, b"baseField=\""),
        base_item: parse_u32_attr(element, b"baseItem=\""),
        show_data_as,
    }
}

pub(crate) fn parse_page_fields(xml: &[u8]) -> Vec<PageField> {
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

pub(crate) fn parse_row_col_items(xml: &[u8]) -> Vec<PivotRowColItem> {
    let mut items = Vec::new();
    let mut pos = 0;

    while let Some(item_start) = find_tag_simd(xml, b"i", pos) {
        let tag_end = find_gt_simd(xml, item_start).unwrap_or(xml.len());
        let element = &xml[item_start..tag_end + 1];
        let item_end = find_closing_tag(xml, b"i", item_start).unwrap_or(tag_end);
        let body = if item_end > tag_end {
            &xml[tag_end + 1..item_end]
        } else {
            &[][..]
        };

        items.push(PivotRowColItem {
            item_type: parse_string_attr(element, b"t=\"").map(|_| parse_item_type_attr(element)),
            x_values: parse_x_values(body),
        });

        pos = item_end.saturating_add(1);
    }

    items
}

fn parse_x_values(xml: &[u8]) -> Vec<Option<u32>> {
    let mut values = Vec::new();
    let mut pos = 0;

    while let Some(x_start) = find_tag_simd(xml, b"x", pos) {
        let tag_end = find_gt_simd(xml, x_start).unwrap_or(xml.len());
        let element = &xml[x_start..tag_end + 1];
        values.push(parse_u32_attr(element, b"v=\""));
        pos = tag_end.saturating_add(1);
    }

    values
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::model::{PivotAxis, PivotItemType, Subtotal};

    #[test]
    fn parses_pivot_items_and_item_flags() {
        let xml = br#"<items count="4">
            <item x="0"/>
            <item x="1" h="1"/>
            <item t="default"/>
            <item t="grand"/>
        </items>"#;

        let items = parse_pivot_items(xml);

        assert_eq!(items.len(), 4);
        assert_eq!(items[0].x, Some(0));
        assert!(items[1].hidden);
        assert_eq!(items[2].item_type, PivotItemType::Default);
        assert_eq!(items[3].item_type, PivotItemType::Grand);
    }

    #[test]
    fn parses_data_fields_and_subtotals() {
        let xml = br#"<dataFields count="2">
            <dataField name="Sum of Sales" fld="3" subtotal="sum"/>
            <dataField name="Count of Items" fld="4" subtotal="count"/>
        </dataFields>"#;

        let fields = parse_data_fields(xml);

        assert_eq!(fields.len(), 2);
        assert_eq!(fields[0].name, Some("Sum of Sales".to_string()));
        assert_eq!(fields[0].field_index, 3);
        assert_eq!(fields[0].subtotal, Subtotal::Sum);
        assert_eq!(fields[1].name, Some("Count of Items".to_string()));
        assert_eq!(fields[1].subtotal, Subtotal::Count);
    }

    #[test]
    fn non_self_closing_data_field_uses_child_pivot_show_as_when_attribute_absent() {
        let xml = br#"<dataFields count="1">
            <dataField name="Percent" fld="4" subtotal="sum">
                <pivotShowAs pivotShowAs="percentOfTotal"/>
            </dataField>
        </dataFields>"#;

        let fields = parse_data_fields(xml);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].show_data_as, Some("percentOfTotal".to_string()));
    }

    #[test]
    fn data_field_show_data_as_attribute_wins_over_child_pivot_show_as() {
        let xml = br#"<dataFields count="1">
            <dataField name="Percent" fld="4" subtotal="sum" showDataAs="difference">
                <pivotShowAs pivotShowAs="percentOfTotal"/>
            </dataField>
        </dataFields>"#;

        let fields = parse_data_fields(xml);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].show_data_as, Some("difference".to_string()));
    }

    #[test]
    fn auto_sort_scope_reads_data_field_sentinel_and_second_reference() {
        let xml = br#"<pivotFields count="1">
            <pivotField axis="axisRow" sortType="descending">
                <autoSortScope>
                    <pivotArea>
                        <references count="2">
                            <reference field="4294967294"><x v="2"/></reference>
                            <reference field="3"><x v="7"/></reference>
                        </references>
                    </pivotArea>
                </autoSortScope>
            </pivotField>
        </pivotFields>"#;

        let fields = parse_pivot_fields(xml);

        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].axis, Some(PivotAxis::Row));
        assert_eq!(fields[0].auto_sort_data_field, Some(2));
        assert_eq!(fields[0].auto_sort_column_field, Some(3));
        assert_eq!(fields[0].auto_sort_column_item, Some(7));
    }

    #[test]
    fn auto_sort_scope_handles_missing_second_reference_malformed_x_and_absent_scope() {
        let missing_second = parse_pivot_fields(
            br#"<pivotField><autoSortScope><reference field="4294967294"><x v="5"/></reference></autoSortScope></pivotField>"#,
        );
        assert_eq!(missing_second[0].auto_sort_data_field, Some(5));
        assert_eq!(missing_second[0].auto_sort_column_field, None);
        assert_eq!(missing_second[0].auto_sort_column_item, None);

        let malformed_x = parse_pivot_fields(
            br#"<pivotField><autoSortScope><reference field="4294967294"><x v="bad"/></reference><reference field="4"><x v="also-bad"/></reference></autoSortScope></pivotField>"#,
        );
        assert_eq!(malformed_x[0].auto_sort_data_field, None);
        assert_eq!(malformed_x[0].auto_sort_column_field, Some(4));
        assert_eq!(malformed_x[0].auto_sort_column_item, None);

        let no_scope = parse_pivot_fields(br#"<pivotField axis="axisCol"/>"#);
        assert_eq!(no_scope[0].auto_sort_data_field, None);
        assert_eq!(no_scope[0].auto_sort_column_field, None);
        assert_eq!(no_scope[0].auto_sort_column_item, None);
    }
}
