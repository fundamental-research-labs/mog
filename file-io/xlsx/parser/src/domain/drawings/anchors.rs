//! Anchor parsing for drawings.
//!
//! This module handles parsing of anchor elements (twoCellAnchor, oneCellAnchor,
//! absoluteAnchor) from drawing XML.

use crate::infra::scanner::{find_closing_tag, find_tag_simd};

use super::helpers::{extract_attr_value_in_element, parse_edit_as, parse_i64};
use super::shapes::parse_drawing_content;
use super::types::{
    AbsoluteAnchor, CellAnchor, ClientData, Extent, OneCellAnchor, Position, TwoCellAnchor,
};

/// Parse a two-cell anchor element
pub fn parse_two_cell_anchor(xml: &[u8], start: usize) -> Option<TwoCellAnchor> {
    let end = find_closing_tag(xml, b"twoCellAnchor", start)?;
    let element = &xml[start..end];

    // Parse editAs attribute
    let edit_as =
        extract_attr_value_in_element(element, b"editAs=\"").and_then(|v| parse_edit_as(v));

    // Parse from element
    let from = parse_cell_anchor_element(element, b"from")?;

    // Parse to element
    let to = parse_cell_anchor_element(element, b"to")?;

    // Parse content
    let content = parse_drawing_content(element);

    // Parse client data
    let client_data = parse_client_data(element);

    Some(TwoCellAnchor {
        from,
        to,
        content,
        edit_as,
        client_data,
        mc_alternate_content: None,
    })
}

/// Parse a one-cell anchor element
pub fn parse_one_cell_anchor(xml: &[u8], start: usize) -> Option<OneCellAnchor> {
    let end = find_closing_tag(xml, b"oneCellAnchor", start)?;
    let element = &xml[start..end];

    // Parse from element
    let from = parse_cell_anchor_element(element, b"from")?;

    // Parse extent
    let extent = parse_extent_element(element)?;

    // Parse content
    let content = parse_drawing_content(element);

    // Parse client data
    let client_data = parse_client_data(element);

    Some(OneCellAnchor {
        from,
        extent,
        content,
        client_data,
        mc_alternate_content: None,
    })
}

/// Parse an absolute anchor element
pub fn parse_absolute_anchor(xml: &[u8], start: usize) -> Option<AbsoluteAnchor> {
    let end = find_closing_tag(xml, b"absoluteAnchor", start)?;
    let element = &xml[start..end];

    // Parse pos element
    let pos = parse_position_element(element)?;

    // Parse extent
    let extent = parse_extent_element(element)?;

    // Parse content
    let content = parse_drawing_content(element);

    // Parse client data
    let client_data = parse_client_data(element);

    Some(AbsoluteAnchor {
        pos,
        extent,
        content,
        client_data,
    })
}

/// Parse a cell anchor (from/to) element
fn parse_cell_anchor_element(xml: &[u8], tag: &[u8]) -> Option<CellAnchor> {
    let start = find_tag_simd(xml, tag, 0)?;
    let end = find_closing_tag(xml, tag, start)?;
    let element = &xml[start..end];

    let col = parse_child_element_u32(element, b"col").unwrap_or(0);
    let col_off = parse_child_element_i64(element, b"colOff").unwrap_or(0);
    let row = parse_child_element_u32(element, b"row").unwrap_or(0);
    let row_off = parse_child_element_i64(element, b"rowOff").unwrap_or(0);

    Some(CellAnchor {
        col,
        col_off,
        row,
        row_off,
    })
}

/// Parse an extent element (cx, cy)
fn parse_extent_element(xml: &[u8]) -> Option<Extent> {
    let start = find_tag_simd(xml, b"ext", 0)?;

    let cx = extract_attr_value_in_element(&xml[start..], b"cx=\"")
        .and_then(|v| parse_i64(v))
        .unwrap_or(0);

    let cy = extract_attr_value_in_element(&xml[start..], b"cy=\"")
        .and_then(|v| parse_i64(v))
        .unwrap_or(0);

    Some(Extent { cx, cy })
}

/// Parse a position element (x, y)
fn parse_position_element(xml: &[u8]) -> Option<Position> {
    let start = find_tag_simd(xml, b"pos", 0)?;

    let x = extract_attr_value_in_element(&xml[start..], b"x=\"")
        .and_then(|v| parse_i64(v))
        .unwrap_or(0);

    let y = extract_attr_value_in_element(&xml[start..], b"y=\"")
        .and_then(|v| parse_i64(v))
        .unwrap_or(0);

    Some(Position { x, y })
}

/// Parse a child element's text content as u32
fn parse_child_element_u32(xml: &[u8], tag: &[u8]) -> Option<u32> {
    let start = find_tag_simd(xml, tag, 0)?;
    let end = find_closing_tag(xml, tag, start)?;

    // Find the '>' after the opening tag
    let mut content_start = start;
    while content_start < end && xml[content_start] != b'>' {
        content_start += 1;
    }
    content_start += 1;

    if content_start >= end {
        return None;
    }

    super::helpers::parse_u32(&xml[content_start..end])
}

/// Parse a child element's text content as i64
fn parse_child_element_i64(xml: &[u8], tag: &[u8]) -> Option<i64> {
    let start = find_tag_simd(xml, tag, 0)?;
    let end = find_closing_tag(xml, tag, start)?;

    let mut content_start = start;
    while content_start < end && xml[content_start] != b'>' {
        content_start += 1;
    }
    content_start += 1;

    if content_start >= end {
        return None;
    }

    parse_i64(&xml[content_start..end])
}

/// Parse a `<xdr:clientData>` element.
///
/// Per the OOXML spec, both `fLocksWithSheet` and `fPrintsWithSheet` default
/// to `true` when the element or attributes are absent.
fn parse_client_data(xml: &[u8]) -> ClientData {
    let mut cd = ClientData::default(); // defaults both to true

    if let Some(start) = find_tag_simd(xml, b"clientData", 0) {
        let el = &xml[start..];

        // fLocksWithSheet: absent → true, "0"/"false" → false
        if let Some(val) = extract_attr_value_in_element(el, b"fLocksWithSheet=\"") {
            cd.locks_with_sheet = val != b"0" && val != b"false";
        }

        // fPrintsWithSheet: absent → true, "0"/"false" → false
        if let Some(val) = extract_attr_value_in_element(el, b"fPrintsWithSheet=\"") {
            cd.prints_with_sheet = val != b"0" && val != b"false";
        }
    }

    cd
}
