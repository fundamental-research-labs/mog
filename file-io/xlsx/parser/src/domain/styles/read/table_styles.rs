use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::parse_string_attr;

use super::super::types::*;
use super::raw::{RawTableStyle, RawTableStyleElement};

/// Parse the <tableStyles> section.
///
/// Returns (styles, default_table_style, default_pivot_style).
pub(super) fn parse_table_styles(
    xml: &[u8],
) -> (Vec<TableStyleDef>, Option<String>, Option<String>) {
    // Parse container attrs from <tableStyles count="..." defaultTableStyle="..." defaultPivotStyle="...">
    let container_end = find_gt_simd(xml, 0).map(|p| p + 1).unwrap_or(xml.len());
    let container_tag = &xml[0..container_end];
    let default_table = parse_string_attr(container_tag, b"defaultTableStyle=\"");
    let default_pivot = parse_string_attr(container_tag, b"defaultPivotStyle=\"");

    let mut styles = Vec::new();
    let mut pos = container_end;

    while let Some(start) = find_tag_simd(xml, b"tableStyle", pos) {
        let open_end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());

        // Parse container attributes via derive
        let raw = RawTableStyle::xml_parse(&xml[start..open_end]);
        let (name, pivot, table, count, xr_uid) = if let Some(r) = raw {
            (
                r.name.unwrap_or_default(),
                r.pivot,
                r.table,
                r.count,
                r.xr_uid,
            )
        } else {
            (String::new(), None, None, None, None)
        };

        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            styles.push(TableStyleDef {
                name,
                pivot,
                table,
                count,
                elements: Vec::new(),
                xr_uid,
            });
            pos = open_end;
            continue;
        }

        // Find closing tag for this tableStyle
        let style_end = find_closing_tag(xml, b"tableStyle", start).unwrap_or(xml.len());
        let style_content = &xml[open_end..style_end];

        // Parse <tableStyleElement> children via derive
        let mut elements = Vec::new();
        let mut elem_pos = 0;
        while let Some(elem_start) = find_tag_simd(style_content, b"tableStyleElement", elem_pos) {
            let elem_end = find_gt_simd(style_content, elem_start)
                .map(|p| p + 1)
                .unwrap_or(style_content.len());

            if let Some(raw_elem) =
                RawTableStyleElement::xml_parse(&style_content[elem_start..elem_end])
            {
                if let Some(type_str) = &raw_elem.style_type {
                    if let Some(style_type) = TableStyleType::from_ooxml(type_str) {
                        elements.push(TableStyleElementDef {
                            style_type,
                            dxf_id: raw_elem.dxf_id,
                            size: raw_elem.size,
                        });
                    }
                }
            }
            elem_pos = elem_end;
        }

        styles.push(TableStyleDef {
            name,
            pivot,
            table,
            count,
            elements,
            xr_uid,
        });

        let close_end = find_gt_simd(xml, style_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }

    (styles, default_table, default_pivot)
}
