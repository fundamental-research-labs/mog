use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_string_attr, parse_string_attr_single_quote};

use super::super::types::*;
use super::support::parse_color_ref;

/// Parse a border side element (e.g., <left style="thin"><color rgb="FF000000"/></left>)
pub(super) fn parse_border_side(xml: &[u8], tag: &[u8]) -> Option<BorderSideDef> {
    let tag_start = find_tag_simd(xml, tag, 0)?;

    let open_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());

    let tag_el = &xml[tag_start..open_end];

    // Parse style attribute
    let style_str = parse_string_attr(tag_el, b"style=\"")
        .or_else(|| parse_string_attr_single_quote(tag_el, b"style='"));

    // Check for self-closing tag
    let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

    // No style attribute means the element is present but unstyled (e.g. <diagonal/>).
    // Return Some(default) so the writer can emit the element — None means absent entirely.
    // Strict parse: unknown tokens log and fall back to BorderStyle::None.
    let style = style_str
        .map(|s| {
            BorderStyle::from_ooxml_token(&s).unwrap_or_else(|| {
                tracing::warn!(token = %s, "unknown BorderStyle OOXML token in XLSX; using None");
                BorderStyle::None
            })
        })
        .unwrap_or(BorderStyle::None);

    // Parse color (if not self-closing)
    let color = if !is_self_closing {
        let close = find_closing_tag(xml, tag, tag_start).unwrap_or(xml.len());
        let content = &xml[open_end..close];
        parse_color_ref(content)
    } else {
        None
    };

    Some(BorderSideDef { style, color })
}

/// Parse the <borders> section
pub(super) fn parse_borders(out: &mut Vec<BorderDef>, xml: &[u8]) {
    let mut pos = 0;

    // Find each <border> element
    while let Some(border_start) = find_tag_simd(xml, b"border", pos) {
        let border_end = find_closing_tag(xml, b"border", border_start).unwrap_or(xml.len());

        let open_end = find_gt_simd(xml, border_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            out.push(BorderDef::default());
            pos = open_end;
            continue;
        }

        let open_tag = &xml[border_start..open_end];
        let border_content = &xml[open_end..border_end];

        let border_def = BorderDef {
            left: parse_border_side(border_content, b"left"),
            right: parse_border_side(border_content, b"right"),
            top: parse_border_side(border_content, b"top"),
            bottom: parse_border_side(border_content, b"bottom"),
            diagonal: parse_border_side(border_content, b"diagonal"),
            diagonal_up: parse_bool_attr_opt(open_tag, b"diagonalUp=\""),
            diagonal_down: parse_bool_attr_opt(open_tag, b"diagonalDown=\""),
            horizontal: parse_border_side(border_content, b"horizontal"),
            vertical: parse_border_side(border_content, b"vertical"),
            start: parse_border_side(border_content, b"start"),
            end: parse_border_side(border_content, b"end"),
            outline: parse_bool_attr_opt(open_tag, b"outline=\""),
        };

        out.push(border_def);

        let close_end = find_gt_simd(xml, border_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
}

/// Parse a single <border>...</border> block into a BorderDef (for use inside <dxf>).
pub(super) fn parse_single_border(xml: &[u8]) -> BorderDef {
    let open_end = find_gt_simd(xml, 0).map(|p| p + 1).unwrap_or(xml.len());

    let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';
    if is_self_closing {
        return BorderDef::default();
    }

    let open_tag = &xml[0..open_end];
    let border_end = find_closing_tag(xml, b"border", 0).unwrap_or(xml.len());
    let border_content = &xml[open_end..border_end];

    BorderDef {
        left: parse_border_side(border_content, b"left"),
        right: parse_border_side(border_content, b"right"),
        top: parse_border_side(border_content, b"top"),
        bottom: parse_border_side(border_content, b"bottom"),
        diagonal: parse_border_side(border_content, b"diagonal"),
        diagonal_up: parse_bool_attr_opt(open_tag, b"diagonalUp=\""),
        diagonal_down: parse_bool_attr_opt(open_tag, b"diagonalDown=\""),
        horizontal: parse_border_side(border_content, b"horizontal"),
        vertical: parse_border_side(border_content, b"vertical"),
        start: parse_border_side(border_content, b"start"),
        end: parse_border_side(border_content, b"end"),
        outline: parse_bool_attr_opt(open_tag, b"outline=\""),
    }
}
