//! Owner-scoped OOXML preservation helpers for pivot table definitions.

use crate::domain::pivot::reader::elements::{ElementSpan, element_span_at};
use crate::infra::scanner::{
    find_any_simd, find_closing_tag, find_gt_simd, find_lt_simd, skip_whitespace_simd,
};
use crate::infra::xml::decode_xml_entities_string;
use domain_types::domain::pivot::{
    PivotFieldOoxmlPreservation, PivotRawXmlAttribute, PivotRawXmlBlock,
    PivotTableOoxmlPreservation,
};

pub(crate) const ROOT_TYPED_ATTRS: &[&str] = &[
    "name",
    "cacheId",
    "dataOnRows",
    "grandTotalCaption",
    "rowHeaderCaption",
    "colHeaderCaption",
    "errorCaption",
    "showError",
    "missingCaption",
    "gridDropZones",
    "rowGrandTotals",
    "colGrandTotals",
    "showMissing",
];

pub(crate) const FIELD_TYPED_ATTRS: &[&str] = &[
    "name",
    "axis",
    "subtotalTop",
    "showAll",
    "sortType",
    "dataField",
    "defaultSubtotal",
    "compact",
    "outline",
    "sumSubtotal",
    "countASubtotal",
    "avgSubtotal",
    "maxSubtotal",
    "minSubtotal",
    "productSubtotal",
    "countSubtotal",
    "stdDevSubtotal",
    "stdDevPSubtotal",
    "varSubtotal",
    "varPSubtotal",
];

pub(crate) const ITEM_TYPED_ATTRS: &[&str] = &["t", "x", "h", "sd", "s"];
pub(crate) const ROW_COL_ITEM_TYPED_ATTRS: &[&str] = &["t"];

const TYPED_ROOT_CHILDREN: &[&str] = &[
    "location",
    "pivotFields",
    "rowFields",
    "rowItems",
    "colFields",
    "colItems",
    "pageFields",
    "dataFields",
    "pivotTableStyleInfo",
];

pub(crate) fn capture_root_preservation(
    xml: &[u8],
    root: ElementSpan,
) -> PivotTableOoxmlPreservation {
    let root_tag = &xml[root.start..root.tag_end];
    let mut preservation = PivotTableOoxmlPreservation {
        root_namespace_declarations: collect_attrs(root_tag, &[], true),
        root_attributes: collect_attrs(root_tag, ROOT_TYPED_ATTRS, false),
        children: collect_direct_children(xml, root, TYPED_ROOT_CHILDREN),
        ..Default::default()
    };
    preservation.fields = collect_field_preservation(xml, root);
    preservation.row_item_attributes = collect_row_col_item_attrs(xml, root, b"rowItems");
    preservation.col_item_attributes = collect_row_col_item_attrs(xml, root, b"colItems");
    preservation
}

pub(crate) fn collect_attrs(
    tag: &[u8],
    typed_local_names: &[&str],
    namespace_only: bool,
) -> Vec<PivotRawXmlAttribute> {
    let mut attrs = Vec::new();
    let mut pos = match find_any_simd(tag, 0, b" \t\r\n") {
        Some((p, _)) => p,
        None => return attrs,
    };
    while pos < tag.len() {
        pos = skip_whitespace_simd(tag, pos);
        if pos >= tag.len() || matches!(tag[pos], b'/' | b'>') {
            break;
        }
        let name_start = pos;
        while pos < tag.len()
            && !matches!(tag[pos], b'=' | b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'>')
        {
            pos += 1;
        }
        let name_end = pos;
        pos = skip_whitespace_simd(tag, pos);
        if pos >= tag.len() || tag[pos] != b'=' {
            continue;
        }
        pos = skip_whitespace_simd(tag, pos + 1);
        if pos >= tag.len() || !matches!(tag[pos], b'"' | b'\'') {
            continue;
        }
        let quote = tag[pos];
        let value_start = pos + 1;
        let Some(value_end_rel) = tag[value_start..].iter().position(|b| *b == quote) else {
            break;
        };
        let value_end = value_start + value_end_rel;
        let name = String::from_utf8_lossy(&tag[name_start..name_end]).to_string();
        let local = local_name(&name);
        let is_ns = name == "xmlns" || name.starts_with("xmlns:");
        let keep = if namespace_only {
            is_ns && name != "xmlns"
        } else {
            !is_ns && !typed_local_names.contains(&local)
        };
        if keep {
            let raw_value = String::from_utf8_lossy(&tag[value_start..value_end]);
            attrs.push(PivotRawXmlAttribute {
                name,
                value: decode_xml_entities_string(&raw_value),
            });
        }
        pos = value_end + 1;
    }
    attrs
}

pub(crate) fn local_name(name: &str) -> &str {
    name.rsplit_once(':')
        .map(|(_, local)| local)
        .unwrap_or(name)
}

fn collect_direct_children(
    xml: &[u8],
    parent: ElementSpan,
    typed_children: &[&str],
) -> Vec<PivotRawXmlBlock> {
    let mut blocks = Vec::new();
    let mut pos = parent.tag_end;
    while let Some(lt) = find_lt_simd(xml, pos) {
        if lt >= parent.end || xml.get(lt + 1) == Some(&b'/') {
            break;
        }
        if matches!(xml.get(lt + 1), Some(b'!') | Some(b'?')) {
            pos = find_gt_simd(xml, lt).map(|p| p + 1).unwrap_or(parent.end);
            continue;
        }
        let Some(name) = element_name_at(xml, lt) else {
            break;
        };
        let local = local_name(&name).to_string();
        let Some(span) = element_span_for_name(xml, name.as_bytes(), lt) else {
            break;
        };
        if !typed_children.contains(&local.as_str()) {
            blocks.push(PivotRawXmlBlock {
                local_name: local,
                xml: String::from_utf8_lossy(&xml[span.start..span.end]).to_string(),
            });
        }
        pos = span.end;
    }
    blocks
}

fn collect_field_preservation(xml: &[u8], root: ElementSpan) -> Vec<PivotFieldOoxmlPreservation> {
    let Some(fields_span) = find_child_span(xml, root, b"pivotFields") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut pos = fields_span.tag_end;
    while let Some(start) = find_child_start(xml, fields_span, b"pivotField", pos) {
        let Some(span) = element_span_at(xml, b"pivotField", start) else {
            break;
        };
        let tag = &xml[span.start..span.tag_end];
        let children = if span.self_closing {
            Vec::new()
        } else {
            collect_direct_children(xml, span, &["items"])
        };
        out.push(PivotFieldOoxmlPreservation {
            attributes: collect_attrs(tag, FIELD_TYPED_ATTRS, false),
            children,
            item_attributes: collect_item_attrs(xml, span),
        });
        pos = span.end;
    }
    out
}

fn collect_item_attrs(xml: &[u8], field: ElementSpan) -> Vec<Vec<PivotRawXmlAttribute>> {
    let Some(items_span) = find_child_span(xml, field, b"items") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut pos = items_span.tag_end;
    while let Some(start) = find_child_start(xml, items_span, b"item", pos) {
        let Some(tag_end) = find_gt_simd(xml, start) else {
            break;
        };
        out.push(collect_attrs(
            &xml[start..tag_end + 1],
            ITEM_TYPED_ATTRS,
            false,
        ));
        pos = tag_end + 1;
    }
    out
}

fn collect_row_col_item_attrs(
    xml: &[u8],
    root: ElementSpan,
    container_name: &[u8],
) -> Vec<Vec<PivotRawXmlAttribute>> {
    let Some(items_span) = find_child_span(xml, root, container_name) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut pos = items_span.tag_end;
    while let Some(start) = find_child_start(xml, items_span, b"i", pos) {
        let Some(tag_end) = find_gt_simd(xml, start) else {
            break;
        };
        out.push(collect_attrs(
            &xml[start..tag_end + 1],
            ROW_COL_ITEM_TYPED_ATTRS,
            false,
        ));
        pos = find_closing_tag(xml, b"i", start)
            .unwrap_or(tag_end + 1)
            .saturating_add(1);
    }
    out
}

fn find_child_span(xml: &[u8], parent: ElementSpan, name: &[u8]) -> Option<ElementSpan> {
    let start = find_child_start(xml, parent, name, parent.tag_end)?;
    element_span_at(xml, name, start)
}

fn find_child_start(xml: &[u8], parent: ElementSpan, name: &[u8], pos: usize) -> Option<usize> {
    if let Some(start) = crate::infra::scanner::find_tag_simd(xml, name, pos) {
        return (start < parent.end).then_some(start);
    }
    None
}

fn element_name_at(xml: &[u8], lt: usize) -> Option<String> {
    let mut pos = lt + 1;
    if pos >= xml.len() {
        return None;
    }
    let start = pos;
    while pos < xml.len() && !matches!(xml[pos], b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'>') {
        pos += 1;
    }
    (pos > start).then(|| String::from_utf8_lossy(&xml[start..pos]).to_string())
}

fn element_span_for_name(xml: &[u8], name: &[u8], start: usize) -> Option<ElementSpan> {
    let tag_end = find_gt_simd(xml, start)?;
    let self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');
    let end = if self_closing {
        tag_end + 1
    } else {
        find_closing_tag(xml, name, start)
            .and_then(|closing_start| find_gt_simd(xml, closing_start).map(|gt| gt + 1))
            .unwrap_or(xml.len())
    };
    Some(ElementSpan {
        start,
        tag_end: tag_end + 1,
        end,
        self_closing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::reader::elements::first_element_span;

    #[test]
    fn preserved_child_blocks_include_closing_tag() {
        let xml = br#"<pivotTableDefinition><pivotFields><pivotField><extLst><ext uri="u"/></extLst></pivotField></pivotFields></pivotTableDefinition>"#;
        let root = first_element_span(xml, b"pivotTableDefinition", 0).unwrap();

        let preservation = capture_root_preservation(xml, root);

        assert_eq!(preservation.fields.len(), 1);
        assert_eq!(preservation.fields[0].children.len(), 1);
        assert_eq!(
            preservation.fields[0].children[0].xml,
            r#"<extLst><ext uri="u"/></extLst>"#
        );
    }

    #[test]
    fn preserved_nested_auto_sort_scope_is_well_formed() {
        let xml = br#"<pivotTableDefinition><pivotFields><pivotField><autoSortScope><pivotArea><references><reference field="4294967294"><x v="0"/></reference></references></pivotArea></autoSortScope></pivotField></pivotFields></pivotTableDefinition>"#;
        let root = first_element_span(xml, b"pivotTableDefinition", 0).unwrap();

        let preservation = capture_root_preservation(xml, root);

        assert_eq!(
            preservation.fields[0].children[0].xml,
            r#"<autoSortScope><pivotArea><references><reference field="4294967294"><x v="0"/></reference></references></pivotArea></autoSortScope>"#
        );
    }
}
