//! Control anchor parsing and unit conversion.
//!
//! Modern worksheet `<controlPr><anchor>` offsets are EMUs. Legacy VML
//! `<x:Anchor>` offsets are pixels. Writers use this module to preserve VML
//! offsets directly and convert modern EMU offsets when emitting VML fallback
//! shapes.

use super::types::{AnchorSource, ControlAnchor, ModernAnchorResult};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::parse_bool_attr;

const EMUS_PER_PIXEL: i64 = 9_525;

/// Parse anchor from VML anchor string (8 comma-separated values).
///
/// Format: fromCol, fromColOff, fromRow, fromRowOff, toCol, toColOff, toRow,
/// toRowOff. VML offsets are pixels.
pub fn parse_vml_anchor(anchor: &str) -> Option<ControlAnchor> {
    let parts: Vec<&str> = anchor.split(',').collect();
    if parts.len() >= 8 {
        Some(ControlAnchor {
            from_col: parts[0].trim().parse().unwrap_or(0),
            from_col_offset: parts[1].trim().parse().unwrap_or(0),
            from_row: parts[2].trim().parse().unwrap_or(0),
            from_row_offset: parts[3].trim().parse().unwrap_or(0),
            to_col: parts[4].trim().parse().unwrap_or(0),
            to_col_offset: parts[5].trim().parse().unwrap_or(0),
            to_row: parts[6].trim().parse().unwrap_or(0),
            to_row_offset: parts[7].trim().parse().unwrap_or(0),
            anchor_source: AnchorSource::Vml,
        })
    } else {
        None
    }
}

/// Parse anchor from modern Office 2010+ XML format.
///
/// Offsets are EMU values (`a:ST_Coordinate` = `xsd:long`), and policy flags
/// come from the `<anchor>` element attributes.
// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub fn parse_modern_anchor(xml: &[u8]) -> Option<ModernAnchorResult> {
    let anchor_start = find_tag_simd(xml, b"anchor", 0)?;
    let anchor_end = find_closing_tag(xml, b"anchor", anchor_start)?;
    let anchor_xml = &xml[anchor_start..anchor_end];

    let element_end = find_gt_simd(anchor_xml, 0)
        .map(|p| p + 1)
        .unwrap_or(anchor_xml.len());
    let element = &anchor_xml[..element_end];
    let move_with_cells = parse_bool_attr(element, b"moveWithCells=\"");
    let size_with_cells = parse_bool_attr(element, b"sizeWithCells=\"");

    let from_start = find_tag_simd(anchor_xml, b"from", 0)?;
    let from_end = find_closing_tag(anchor_xml, b"from", from_start)?;
    let from_xml = &anchor_xml[from_start..from_end];

    let from_col = parse_child_element_u32(from_xml, b"col").unwrap_or(0);
    let from_col_offset = parse_child_element_i64(from_xml, b"colOff").unwrap_or(0);
    let from_row = parse_child_element_u32(from_xml, b"row").unwrap_or(0);
    let from_row_offset = parse_child_element_i64(from_xml, b"rowOff").unwrap_or(0);

    let to_start = find_tag_simd(anchor_xml, b"to", 0)?;
    let to_end = find_closing_tag(anchor_xml, b"to", to_start)?;
    let to_xml = &anchor_xml[to_start..to_end];

    let to_col = parse_child_element_u32(to_xml, b"col").unwrap_or(0);
    let to_col_offset = parse_child_element_i64(to_xml, b"colOff").unwrap_or(0);
    let to_row = parse_child_element_u32(to_xml, b"row").unwrap_or(0);
    let to_row_offset = parse_child_element_i64(to_xml, b"rowOff").unwrap_or(0);

    Some(ModernAnchorResult {
        anchor: ControlAnchor {
            from_col,
            from_col_offset,
            from_row,
            from_row_offset,
            to_col,
            to_col_offset,
            to_row,
            to_row_offset,
            anchor_source: AnchorSource::Modern,
        },
        move_with_cells,
        size_with_cells,
    })
}

/// Convert an anchor offset to VML pixel units.
///
/// VML-sourced offsets are already pixels. Modern offsets are EMUs.
pub fn vml_offset(offset: i64, source: &AnchorSource) -> i64 {
    match source {
        AnchorSource::Vml => offset,
        AnchorSource::Modern => offset / EMUS_PER_PIXEL,
    }
}

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub(crate) fn parse_child_element_u32(xml: &[u8], tag: &[u8]) -> Option<u32> {
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

    let text = String::from_utf8_lossy(&xml[content_start..end]);
    text.trim().parse().ok()
}

// Slices use offsets from ASCII XML tag delimiters.
#[allow(clippy::string_slice)]
pub(crate) fn parse_child_element_i64(xml: &[u8], tag: &[u8]) -> Option<i64> {
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

    let text = String::from_utf8_lossy(&xml[content_start..end]);
    text.trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vml_anchor_offsets_are_pixels() {
        let anchor = parse_vml_anchor("1,15,0,10,3,22,1,4").unwrap();
        assert_eq!(anchor.from_col, 1);
        assert_eq!(anchor.from_col_offset, 15);
        assert_eq!(anchor.from_row, 0);
        assert_eq!(anchor.from_row_offset, 10);
        assert_eq!(anchor.to_col, 3);
        assert_eq!(anchor.to_col_offset, 22);
        assert_eq!(anchor.to_row, 1);
        assert_eq!(anchor.to_row_offset, 4);
        assert_eq!(anchor.anchor_source, AnchorSource::Vml);
    }

    #[test]
    fn vml_anchor_rejects_too_few_parts() {
        assert!(parse_vml_anchor("1,2,3").is_none());
    }

    #[test]
    fn modern_anchor_preserves_negative_emu_offsets_and_flags() {
        let xml = br#"<controlPr>
            <anchor moveWithCells="1" sizeWithCells="0">
                <from><col>1</col><colOff>-9525</colOff><row>2</row><rowOff>19050</rowOff></from>
                <to><col>3</col><colOff>28575</colOff><row>4</row><rowOff>-38100</rowOff></to>
            </anchor>
        </controlPr>"#;

        let parsed = parse_modern_anchor(xml).unwrap();
        assert!(parsed.move_with_cells);
        assert!(!parsed.size_with_cells);
        assert_eq!(parsed.anchor.anchor_source, AnchorSource::Modern);
        assert_eq!(parsed.anchor.from_col_offset, -9525);
        assert_eq!(parsed.anchor.to_row_offset, -38100);
    }

    #[test]
    fn modern_to_vml_offset_converts_emu_to_pixels() {
        assert_eq!(vml_offset(19_050, &AnchorSource::Modern), 2);
        assert_eq!(vml_offset(-19_050, &AnchorSource::Modern), -2);
        assert_eq!(vml_offset(27, &AnchorSource::Vml), 27);
    }
}
