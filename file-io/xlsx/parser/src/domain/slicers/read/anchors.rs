#![allow(clippy::string_slice)]

use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr, parse_u32_attr};

use super::super::types::SlicerAnchor;
use ooxml_types::drawings::{CellAnchor, DrawingAnchorMetadata, Extent};
use ooxml_types::slicers::SlicerAnchorMode;

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
                            extract_anchor_for_slicer(drawing_xml, ac_start, &slicer_name)
                        {
                            anchor.object_id = object_id;
                            anchor.macro_name = extract_graphic_frame_macro(ac_block);
                            anchor.nv_ext_lst = extract_cnvpr_ext_lst(ac_block);
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

fn extract_graphic_frame_macro(block: &[u8]) -> Option<String> {
    let start = find_tag_simd(block, b"graphicFrame", 0)?;
    let end = find_gt_simd(block, start)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    parse_string_attr(&block[start..end], b"macro=\"")
}

fn extract_cnvpr_ext_lst(block: &[u8]) -> Option<String> {
    let cnv_start = find_tag_simd(block, b"cNvPr", 0)?;
    let cnv_close = find_closing_tag(block, b"cNvPr", cnv_start)?;
    let cnv_end = find_gt_simd(block, cnv_close).map(|p| p + 1)?;
    extract_ext_lst(&block[cnv_start..cnv_end])
}

fn extract_ext_lst(xml: &[u8]) -> Option<String> {
    let start = find_tag_simd(xml, b"extLst", 0)?;
    let close = find_closing_tag(xml, b"extLst", start)?;
    let end = find_gt_simd(xml, close).map(|p| p + 1).unwrap_or(close);
    std::str::from_utf8(&xml[start..end])
        .ok()
        .map(str::to_string)
}

fn extract_anchor_for_slicer(
    drawing_xml: &[u8],
    ac_start: usize,
    slicer_name: &str,
) -> Option<SlicerAnchor> {
    extract_two_cell_anchor_for_slicer(drawing_xml, ac_start, slicer_name)
        .or_else(|| extract_one_cell_anchor_for_slicer(drawing_xml, ac_start, slicer_name))
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
        anchor_mode: Some(SlicerAnchorMode::TwoCell),
        extent: None,
        macro_name: None,
        nv_ext_lst: None,
        drawing: DrawingAnchorMetadata {
            anchor_index: drawing_anchor_index(drawing_xml, two_cell_start),
        },
    })
}

fn extract_one_cell_anchor_for_slicer(
    drawing_xml: &[u8],
    ac_start: usize,
    slicer_name: &str,
) -> Option<SlicerAnchor> {
    let one_cell_start = find_enclosing_one_cell_anchor(drawing_xml, ac_start)?;
    let one_cell_close = find_closing_tag(drawing_xml, b"oneCellAnchor", one_cell_start)
        .unwrap_or(drawing_xml.len());
    let one_cell_end = find_gt_simd(drawing_xml, one_cell_close)
        .map(|p| p + 1)
        .unwrap_or(one_cell_close);
    let one_cell_block = &drawing_xml[one_cell_start..one_cell_end];
    let from = parse_cell_anchor_element(one_cell_block, b"from")?;

    Some(SlicerAnchor {
        slicer_name: slicer_name.to_string(),
        object_id: None,
        from: from.clone(),
        to: from,
        anchor_mode: Some(SlicerAnchorMode::OneCell),
        extent: parse_extent_element(one_cell_block),
        macro_name: None,
        nv_ext_lst: None,
        drawing: DrawingAnchorMetadata {
            anchor_index: drawing_anchor_index(drawing_xml, one_cell_start),
        },
    })
}

fn drawing_anchor_index(xml: &[u8], anchor_start: usize) -> Option<usize> {
    let mut anchors = Vec::new();
    collect_anchor_starts(xml, b"twoCellAnchor", &mut anchors);
    collect_anchor_starts(xml, b"oneCellAnchor", &mut anchors);
    collect_anchor_starts(xml, b"absoluteAnchor", &mut anchors);
    anchors.sort_unstable();
    anchors.iter().position(|&start| start == anchor_start)
}

fn collect_anchor_starts(xml: &[u8], tag_name: &[u8], anchors: &mut Vec<usize>) {
    let mut pos = 0;
    while let Some(found) = find_tag_simd(xml, tag_name, pos) {
        anchors.push(found);
        pos = find_gt_simd(xml, found).map(|p| p + 1).unwrap_or(found + 1);
    }
}

fn find_enclosing_two_cell_anchor(xml: &[u8], before_pos: usize) -> Option<usize> {
    find_enclosing_anchor(xml, b"twoCellAnchor", before_pos)
}

fn find_enclosing_one_cell_anchor(xml: &[u8], before_pos: usize) -> Option<usize> {
    find_enclosing_anchor(xml, b"oneCellAnchor", before_pos)
}

fn find_enclosing_anchor(xml: &[u8], tag_name: &[u8], before_pos: usize) -> Option<usize> {
    let mut last_found = None;
    let mut pos = 0;

    while pos < before_pos {
        if let Some(found) = find_tag_simd(xml, tag_name, pos) {
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

fn parse_extent_element(block: &[u8]) -> Option<Extent> {
    let tag_start =
        find_tag_simd(block, b"xdr:ext", 0).or_else(|| find_tag_simd(block, b"ext", 0))?;
    let tag_end = find_gt_simd(block, tag_start)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    let elem = &block[tag_start..tag_end];

    Some(Extent {
        cx: parse_i64_attr(elem, b"cx=\"")?,
        cy: parse_i64_attr(elem, b"cy=\"")?,
    })
}

fn parse_i64_attr(elem: &[u8], attr: &[u8]) -> Option<i64> {
    let start = find_attr_simd(elem, attr, 0)? + attr.len();
    let mut end = start;
    while end < elem.len() && elem[end] != b'"' {
        end += 1;
    }
    std::str::from_utf8(&elem[start..end])
        .ok()?
        .parse::<i64>()
        .ok()
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
        assert_eq!(a.anchor_mode, Some(SlicerAnchorMode::TwoCell));
        assert_eq!(a.extent, None);
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

    #[test]
    fn parses_one_cell_slicer_anchor_from_drawing() {
        let drawing_xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
          xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
          xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"
          xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer">
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>2</xdr:col>
      <xdr:colOff>38100</xdr:colOff>
      <xdr:row>4</xdr:row>
      <xdr:rowOff>76200</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="1234567" cy="7654321"/>
    <mc:AlternateContent>
      <mc:Choice Requires="a14">
        <xdr:graphicFrame>
          <xdr:nvGraphicFramePr><xdr:cNvPr id="9" name="Region 1"/></xdr:nvGraphicFramePr>
          <a:graphic>
            <a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer">
              <sle:slicer name="Region 1"/>
            </a:graphicData>
          </a:graphic>
        </xdr:graphicFrame>
      </mc:Choice>
    </mc:AlternateContent>
  </xdr:oneCellAnchor>
</xdr:wsDr>"#;

        let anchors = parse_slicer_anchors_from_drawing(drawing_xml);
        assert_eq!(anchors.len(), 1);

        let a = &anchors[0];
        assert_eq!(a.slicer_name, "Region 1");
        assert_eq!(a.object_id, Some(9));
        assert_eq!(a.anchor_mode, Some(SlicerAnchorMode::OneCell));
        assert_eq!(a.from.col, 2);
        assert_eq!(a.from.row, 4);
        assert_eq!(
            a.extent.as_ref().map(|ext| (ext.cx, ext.cy)),
            Some((1234567, 7654321))
        );
    }
}
