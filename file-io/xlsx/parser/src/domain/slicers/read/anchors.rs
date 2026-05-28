#![allow(clippy::string_slice)]

use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_u32_attr};

use super::super::types::SlicerAnchor;
use ooxml_types::drawings::CellAnchor;

/// Parse slicer anchors from drawing XML.
pub fn parse_slicer_anchors_from_drawing(drawing_xml: &[u8]) -> Vec<SlicerAnchor> {
    let mut anchors = Vec::new();
    let mut pos = 0;

    while let Some(ac_start) = find_tag_simd(drawing_xml, b"mc:AlternateContent", pos) {
        let ac_close = find_closing_tag(drawing_xml, b"mc:AlternateContent", ac_start)
            .unwrap_or(drawing_xml.len());
        let ac_end = find_gt_simd(drawing_xml, ac_close)
            .map(|p| p + 1)
            .unwrap_or(ac_close);
        let ac_block = &drawing_xml[ac_start..ac_end];

        if let Some(choice_start) = find_tag_simd(ac_block, b"mc:Choice", 0) {
            let choice_elem_end = find_gt_simd(ac_block, choice_start)
                .map(|p| p + 1)
                .unwrap_or(ac_block.len());
            let choice_elem = &ac_block[choice_start..choice_elem_end];

            if find_attr_simd(choice_elem, b"Requires=\"", 0).is_some() {
                let requires = parse_string_attr(choice_elem, b"Requires=\"");
                if requires.as_deref() == Some("a14") || requires.as_deref() == Some("sle") {
                    if let Some(slicer_name) = extract_slicer_name_from_block(ac_block) {
                        let object_id = extract_slicer_object_id_from_block(ac_block);
                        if let Some(mut anchor) =
                            extract_two_cell_anchor_for_slicer(drawing_xml, ac_start, &slicer_name)
                        {
                            anchor.object_id = object_id;
                            anchors.push(anchor);
                        }
                    }
                }
            }
        }

        pos = ac_end;
    }

    anchors
}

fn extract_slicer_name_from_block(block: &[u8]) -> Option<String> {
    let slicer_tag = find_tag_simd(block, b"sle:slicer", 0).or_else(|| {
        let mut p = 0;
        loop {
            let found = find_tag_simd(block, b"slicer", p)?;
            let elem_end = find_gt_simd(block, found).unwrap_or(block.len());
            let tag = &block[found..elem_end.min(found + 20)];
            if tag.starts_with(b"<slicer")
                && tag.len() > 7
                && (tag[7] == b' ' || tag[7] == b'/' || tag[7] == b'>')
            {
                return Some(found);
            }
            p = elem_end;
        }
    })?;

    let slicer_elem_end = find_gt_simd(block, slicer_tag)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    let slicer_elem = &block[slicer_tag..slicer_elem_end];

    parse_string_attr(slicer_elem, b"name=\"")
}

fn extract_slicer_object_id_from_block(block: &[u8]) -> Option<u32> {
    let c_nv_pr = find_tag_simd(block, b"cNvPr", 0)?;
    let elem_end = find_gt_simd(block, c_nv_pr)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    parse_u32_attr(&block[c_nv_pr..elem_end], b"id=\"")
}

fn extract_two_cell_anchor_for_slicer(
    drawing_xml: &[u8],
    ac_start: usize,
    slicer_name: &str,
) -> Option<SlicerAnchor> {
    let two_cell_start = find_enclosing_two_cell_anchor(drawing_xml, ac_start)?;
    let two_cell_close = find_closing_tag(drawing_xml, b"twoCellAnchor", two_cell_start)
        .unwrap_or(drawing_xml.len());
    let two_cell_end = find_gt_simd(drawing_xml, two_cell_close)
        .map(|p| p + 1)
        .unwrap_or(two_cell_close);
    let two_cell_block = &drawing_xml[two_cell_start..two_cell_end];

    Some(SlicerAnchor {
        slicer_name: slicer_name.to_string(),
        object_id: None,
        from: parse_cell_anchor_element(two_cell_block, b"from")?,
        to: parse_cell_anchor_element(two_cell_block, b"to")?,
    })
}

fn find_enclosing_two_cell_anchor(xml: &[u8], before_pos: usize) -> Option<usize> {
    let mut last_found = None;
    let mut pos = 0;

    while pos < before_pos {
        if let Some(found) = find_tag_simd(xml, b"twoCellAnchor", pos) {
            if found < before_pos {
                last_found = Some(found);
                let end = find_gt_simd(xml, found).map(|p| p + 1).unwrap_or(found + 1);
                pos = end;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    last_found
}

fn parse_cell_anchor_element(block: &[u8], tag_name: &[u8]) -> Option<CellAnchor> {
    let tag_start = find_from_to_tag(block, tag_name)?;
    let tag_elem_end = find_gt_simd(block, tag_start)
        .map(|p| p + 1)
        .unwrap_or(block.len());

    let tag_close = find_closing_tag(block, tag_name, tag_start).unwrap_or(block.len());
    let inner = &block[tag_elem_end..tag_close];

    Some(CellAnchor {
        col: parse_element_text_u32(inner, b"col")?,
        col_off: parse_element_text_i64(inner, b"colOff").unwrap_or(0),
        row: parse_element_text_u32(inner, b"row")?,
        row_off: parse_element_text_i64(inner, b"rowOff").unwrap_or(0),
    })
}

fn find_from_to_tag(block: &[u8], tag_name: &[u8]) -> Option<usize> {
    let mut prefixed_tag = b"xdr:".to_vec();
    prefixed_tag.extend_from_slice(tag_name);

    find_tag_simd(block, &prefixed_tag, 0).or_else(|| find_tag_simd(block, tag_name, 0))
}

fn parse_element_text_u32(xml: &[u8], tag_name: &[u8]) -> Option<u32> {
    let mut prefixed = b"xdr:".to_vec();
    prefixed.extend_from_slice(tag_name);

    let tag_start = find_tag_simd(xml, &prefixed, 0).or_else(|| find_tag_simd(xml, tag_name, 0))?;
    let content_start = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());

    let mut result: u32 = 0;
    let mut pos = content_start;
    let mut found_digit = false;

    while pos < xml.len() && xml[pos] != b'<' {
        if xml[pos].is_ascii_digit() {
            result = result
                .saturating_mul(10)
                .saturating_add((xml[pos] - b'0') as u32);
            found_digit = true;
        }
        pos += 1;
    }

    if found_digit { Some(result) } else { None }
}

fn parse_element_text_i64(xml: &[u8], tag_name: &[u8]) -> Option<i64> {
    let mut prefixed = b"xdr:".to_vec();
    prefixed.extend_from_slice(tag_name);

    let tag_start = find_tag_simd(xml, &prefixed, 0).or_else(|| find_tag_simd(xml, tag_name, 0))?;
    let content_start = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());

    let mut pos = content_start;
    while pos < xml.len() && xml[pos] != b'<' {
        pos += 1;
    }

    let text = &xml[content_start..pos];
    std::str::from_utf8(text).ok()?.trim().parse::<i64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drawing_xml(requires: &str, slicer_element: &str, c_nv_pr: &str) -> Vec<u8> {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
          xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"
          xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer">
  <xdr:twoCellAnchor>
    <xdr:from>
      <xdr:col>5</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>1</xdr:row>
      <xdr:rowOff>12700</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>8</xdr:col>
      <xdr:colOff>304800</xdr:colOff>
      <xdr:row>15</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <mc:AlternateContent>
      <mc:Choice Requires="{requires}">
        <xdr:graphicFrame>
          <xdr:nvGraphicFramePr>{c_nv_pr}</xdr:nvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer">
              {slicer_element}
            </a:graphicData>
          </a:graphic>
        </xdr:graphicFrame>
      </mc:Choice>
    </mc:AlternateContent>
  </xdr:twoCellAnchor>
</xdr:wsDr>"#
        )
        .into_bytes()
    }

    #[test]
    fn parses_slicer_anchor_from_drawing() {
        let drawing_xml = drawing_xml(
            "a14",
            r#"<sle:slicer name="Slicer_Region"/>"#,
            r#"<xdr:cNvPr id="2" name="Region"/>"#,
        );

        let anchors = parse_slicer_anchors_from_drawing(&drawing_xml);
        assert_eq!(anchors.len(), 1);

        let a = &anchors[0];
        assert_eq!(a.slicer_name, "Slicer_Region");
        assert_eq!(a.object_id, Some(2));
        assert_eq!(a.from.col, 5);
        assert_eq!(a.from.col_off, 0);
        assert_eq!(a.from.row, 1);
        assert_eq!(a.from.row_off, 12700);
        assert_eq!(a.to.col, 8);
        assert_eq!(a.to.col_off, 304800);
        assert_eq!(a.to.row, 15);
        assert_eq!(a.to.row_off, 0);
    }

    #[test]
    fn parses_unprefixed_slicer_name_and_sle_requires() {
        let drawing_xml = drawing_xml("sle", r#"<slicer name="Plain"/>"#, "");
        let anchors = parse_slicer_anchors_from_drawing(&drawing_xml);
        assert_eq!(anchors.len(), 1);
        assert_eq!(anchors[0].slicer_name, "Plain");
        assert_eq!(anchors[0].object_id, None);
    }

    #[test]
    fn ignores_malformed_object_id() {
        let drawing_xml = drawing_xml(
            "a14",
            r#"<sle:slicer name="Slicer_Region"/>"#,
            r#"<xdr:cNvPr id="not-number" name="Region"/>"#,
        );
        let anchors = parse_slicer_anchors_from_drawing(&drawing_xml);
        assert_eq!(anchors.len(), 1);
        assert_eq!(anchors[0].object_id, None);
    }
}
