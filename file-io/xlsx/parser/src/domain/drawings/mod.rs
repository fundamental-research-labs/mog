//! Drawing object parser for XLSX files
//!
//! This module parses drawingN.xml files to extract images, shapes, text boxes,
//! connectors, and group shapes with their anchor positions.
//!
//! # XLSX Drawing Structure
//!
//! Drawing files are located at `xl/drawings/drawingN.xml` and contain:
//! - `<xdr:twoCellAnchor>` - Objects anchored between two cells
//! - `<xdr:oneCellAnchor>` - Objects anchored to one cell with extent
//! - `<xdr:absoluteAnchor>` - Objects with absolute positioning
//!
//! Each anchor contains drawing content like pictures, shapes, or groups.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices XML
//! tag / attribute content at byte offsets produced by ASCII-only XML
//! syntax (`<`, `>`, `/`, `"`, `=`). Char-boundary by construction.
//! File-scope allow documented here.

#![allow(clippy::string_slice)]

mod anchors;
mod helpers;
mod images;
mod shapes;
mod text;
pub(crate) mod three_d;
mod transforms;
pub(crate) mod types;
pub mod write;

#[cfg(test)]
mod tests;

// Re-export all public types
pub use types::*;

// Re-export parsing functions that may be needed externally
pub use helpers::{decode_xml_entities, decode_xml_entities_string};
pub use images::parse_blip_fill;
pub use shapes::{parse_nv_props, parse_shape, parse_shape_preset};
pub use text::parse_text_body;
pub use transforms::{
    parse_color, parse_dash_style, parse_effect_list, parse_fill, parse_outline,
    parse_shape_properties, parse_shape_style, parse_transform_2d, scheme_name_to_index,
};

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use anchors::{parse_absolute_anchor, parse_one_cell_anchor, parse_two_cell_anchor};

// ============================================================================
// Main Parsing Function
// ============================================================================

/// Parse a drawing XML file
///
/// # Arguments
/// * `xml` - Raw bytes of the drawingN.xml file
///
/// # Returns
/// A `Drawing` struct containing all parsed anchors
pub fn parse_drawing(xml: &[u8]) -> Drawing {
    let mut drawing = Drawing::default();

    // Extract namespace declarations from the root element for round-trip fidelity.
    drawing.root_namespace_attrs = parse_root_namespace_attrs(xml);

    let mut pos = 0;

    while pos < xml.len() {
        // Find the nearest anchor of each type from the current position
        let two = find_tag_simd(xml, b"twoCellAnchor", pos);
        let one = find_tag_simd(xml, b"oneCellAnchor", pos);
        let abs = find_tag_simd(xml, b"absoluteAnchor", pos);
        let mc = find_tag_simd(xml, b"AlternateContent", pos);

        // Pick whichever anchor appears first in document order
        let nearest = [two, one, abs].iter().filter_map(|x| *x).min();

        // If mc:AlternateContent comes before the next anchor, the anchor
        // is wrapped — capture the entire block as raw XML for verbatim round-trip.
        if let Some(mc_pos) = mc {
            if nearest.map_or(true, |n| mc_pos < n) {
                if let Some(mc_raw) = extract_mc_alternate_content_raw(xml, mc_pos) {
                    // Parse the anchor inside mc:Choice for metadata extraction,
                    // but store the raw XML for verbatim round-trip.
                    if let Some(nearest_pos) = nearest {
                        match nearest {
                            _ if two == Some(nearest_pos) => {
                                if let Some(mut anchor) = parse_two_cell_anchor(xml, nearest_pos) {
                                    anchor.mc_alternate_content =
                                        Some(McAlternateContent { raw_xml: mc_raw.0 });
                                    drawing.anchors.push(Anchor::TwoCell(anchor));
                                }
                                pos = mc_raw.1; // skip past the entire mc:AlternateContent
                                continue;
                            }
                            _ => {
                                // mc:AlternateContent wrapping non-two-cell anchors —
                                // skip for now, fall through to normal parsing.
                            }
                        }
                    }
                }
            }
        }

        match nearest {
            None => break,
            Some(p) if two == Some(p) => {
                if let Some(mut anchor) = parse_two_cell_anchor(xml, p) {
                    // If the anchor content is mc:AlternateContent (e.g., ChartEx inside
                    // the anchor), store the entire twoCellAnchor as raw XML for verbatim
                    // round-trip. This preserves the mc:AlternateContent structure, original
                    // relationship IDs, and fallback content exactly as in the original file.
                    if matches!(&anchor.content, DrawingContent::GraphicFrame(gf)
                        if gf.graphic_xml.as_ref().map_or(false, |x| x.contains("AlternateContent")))
                    {
                        if let Some(tc_end) = find_closing_tag(xml, b"twoCellAnchor", p) {
                            let tc_gt = find_gt_simd(xml, tc_end).map(|g| g + 1).unwrap_or(tc_end);
                            if let Ok(raw) = std::str::from_utf8(&xml[p..tc_gt]) {
                                anchor.mc_alternate_content = Some(McAlternateContent {
                                    raw_xml: raw.to_string(),
                                });
                            }
                        }
                    }
                    drawing.anchors.push(Anchor::TwoCell(anchor));
                }
                pos = p + 1;
            }
            Some(p) if one == Some(p) => {
                if let Some(mut anchor) = parse_one_cell_anchor(xml, p) {
                    // If the anchor content is mc:AlternateContent (e.g., slicer/timeslicer
                    // graphicFrame inside the anchor), store the entire oneCellAnchor as raw
                    // XML for verbatim round-trip.
                    if matches!(&anchor.content, DrawingContent::GraphicFrame(gf)
                        if gf.graphic_xml.as_ref().map_or(false, |x| x.contains("AlternateContent")))
                    {
                        if let Some(oc_end) = find_closing_tag(xml, b"oneCellAnchor", p) {
                            let oc_gt = find_gt_simd(xml, oc_end).map(|g| g + 1).unwrap_or(oc_end);
                            if let Ok(raw) = std::str::from_utf8(&xml[p..oc_gt]) {
                                anchor.mc_alternate_content = Some(McAlternateContent {
                                    raw_xml: raw.to_string(),
                                });
                            }
                        }
                    }
                    drawing.anchors.push(Anchor::OneCell(anchor));
                }
                pos = p + 1;
            }
            Some(p) => {
                // Must be absoluteAnchor
                if let Some(anchor) = parse_absolute_anchor(xml, p) {
                    drawing.anchors.push(Anchor::Absolute(anchor));
                }
                pos = p + 1;
            }
        }
    }

    drawing
}

/// Extract the raw XML of an `mc:AlternateContent` element starting at `mc_pos`.
///
/// Returns `Some((raw_xml_string, end_position))` where end_position is just past
/// the closing `</mc:AlternateContent>` tag.
fn extract_mc_alternate_content_raw(xml: &[u8], mc_pos: usize) -> Option<(String, usize)> {
    let mc_close_lt = find_closing_tag(xml, b"AlternateContent", mc_pos)?;
    // Find the '>' that ends the closing tag
    let mc_end = find_gt_simd(xml, mc_close_lt)
        .map(|g| g + 1)
        .unwrap_or(mc_close_lt);
    let raw = std::str::from_utf8(&xml[mc_pos..mc_end]).ok()?;
    Some((raw.to_string(), mc_end))
}

/// Extract namespace declarations (xmlns:prefix="uri" and xmlns="uri") from the
/// root element of a drawing XML file. Returns (attr_name, attr_value) pairs in
/// the order they appear, preserving original prefixes.
fn parse_root_namespace_attrs(xml: &[u8]) -> Vec<(String, String)> {
    // Find the first '<' that starts the root element (skip XML declaration).
    let xml_str = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    // Skip XML declaration if present.
    let start = if let Some(decl_end) = xml_str.find("?>") {
        decl_end + 2
    } else {
        0
    };

    // Find the opening '<' of the root element.
    let root_start = match xml_str[start..].find('<') {
        Some(p) => start + p,
        None => return Vec::new(),
    };

    // Find the end of the opening tag ('>' or '/>').
    let root_end = match xml_str[root_start..].find('>') {
        Some(p) => root_start + p,
        None => return Vec::new(),
    };

    let root_tag = &xml_str[root_start..=root_end];

    // Parse all xmlns declarations.
    let mut attrs = Vec::new();
    let mut pos = 0;
    while let Some(xmlns_pos) = root_tag[pos..].find("xmlns") {
        let abs_pos = pos + xmlns_pos;
        let after = &root_tag[abs_pos..];

        // Determine the full attribute name (xmlns or xmlns:prefix).
        let (attr_name, rest) = if after.len() > 5 && after.as_bytes()[5] == b':' {
            // xmlns:prefix="..."
            let after_colon = &after[6..];
            let end = after_colon
                .find(|c: char| c == '=' || c.is_whitespace())
                .unwrap_or(after_colon.len());
            let prefix = &after_colon[..end];
            (format!("xmlns:{}", prefix), &after[6 + end..])
        } else if after.len() > 5
            && (after.as_bytes()[5] == b'=' || after.as_bytes()[5].is_ascii_whitespace())
        {
            // xmlns="..."
            ("xmlns".to_string(), &after[5..])
        } else {
            pos = abs_pos + 5;
            continue;
        };

        // Find '=' and then the quoted value.
        if let Some(eq_pos) = rest.find('=') {
            let after_eq = rest[eq_pos + 1..].trim_start();
            if let Some(quote) = after_eq.chars().next() {
                if quote == '"' || quote == '\'' {
                    let value_start = &after_eq[1..];
                    if let Some(end_quote) = value_start.find(quote) {
                        let uri = &value_start[..end_quote];
                        attrs.push((attr_name, uri.to_string()));
                    }
                }
            }
        }

        pos = abs_pos + 5;
    }

    attrs
}
