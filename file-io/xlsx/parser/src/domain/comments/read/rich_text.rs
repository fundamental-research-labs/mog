use crate::domain::comments::types::{CommentFont, CommentRun};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{decode_xml_entities, parse_f64_attr, parse_string_attr, parse_u32_attr};

pub(super) fn parse_rich_text(xml: &[u8]) -> Vec<CommentRun> {
    let mut runs = Vec::new();
    let mut pos = 0;

    let has_runs = find_tag_simd(xml, b"r", 0).is_some();

    if !has_runs {
        if let Some(t_start) = find_tag_simd(xml, b"t", 0) {
            let gt_pos = find_gt_simd(xml, t_start).unwrap_or(xml.len());
            let content_start = if gt_pos < xml.len() {
                gt_pos + 1
            } else {
                xml.len()
            };
            let t_end = find_closing_tag(xml, b"t", t_start).unwrap_or(xml.len());
            let tag_bytes = &xml[t_start..gt_pos.min(xml.len())];
            let preserve_space = tag_bytes.windows(9).any(|w| w == b"xml:space");

            if content_start < t_end {
                runs.push(CommentRun {
                    text: decode_xml_entities(&xml[content_start..t_end]),
                    font: None,
                    preserve_space,
                });
            }
        }
        return runs;
    }

    while let Some(r_start) = find_tag_simd(xml, b"r", pos) {
        let r_end = find_closing_tag(xml, b"r", r_start).unwrap_or(xml.len());

        let run_xml = &xml[r_start..r_end];
        let mut run = CommentRun::default();

        if let Some(rpr_start) = find_tag_simd(run_xml, b"rPr", 0) {
            let rpr_end = find_closing_tag(run_xml, b"rPr", rpr_start).unwrap_or(run_xml.len());
            run.font = Some(parse_comment_font(&run_xml[rpr_start..rpr_end]));
        }

        if let Some(t_start) = find_tag_simd(run_xml, b"t", 0) {
            let gt_pos = find_gt_simd(run_xml, t_start).unwrap_or(run_xml.len());
            let content_start = if gt_pos < run_xml.len() {
                gt_pos + 1
            } else {
                run_xml.len()
            };
            let t_end = find_closing_tag(run_xml, b"t", t_start).unwrap_or(run_xml.len());
            let tag_bytes = &run_xml[t_start..gt_pos.min(run_xml.len())];
            run.preserve_space = tag_bytes.windows(9).any(|w| w == b"xml:space");

            if content_start < t_end {
                run.text = decode_xml_entities(&run_xml[content_start..t_end]);
            }
        }

        if !run.text.is_empty() {
            runs.push(run);
        }

        pos = r_end + 1;
    }

    runs
}

fn parse_comment_font(xml: &[u8]) -> CommentFont {
    let mut font = CommentFont::default();

    if let Some(name_start) = find_tag_simd(xml, b"rFont", 0) {
        let tag_end = find_gt_simd(xml, name_start).unwrap_or(xml.len());
        let element = &xml[name_start..tag_end + 1];
        font.name = parse_string_attr(element, b"val=\"");
    }

    if let Some(sz_start) = find_tag_simd(xml, b"sz", 0) {
        let tag_end = find_gt_simd(xml, sz_start).unwrap_or(xml.len());
        let element = &xml[sz_start..tag_end + 1];
        font.size = parse_f64_attr(element, b"val=\"");
    }

    font.bold = find_tag_simd(xml, b"b", 0).is_some();
    font.italic = find_tag_simd(xml, b"i", 0).is_some();
    font.underline = find_tag_simd(xml, b"u", 0).is_some();
    font.strike = find_tag_simd(xml, b"strike", 0).is_some();

    if let Some(color_start) = find_tag_simd(xml, b"color", 0) {
        let tag_end = find_gt_simd(xml, color_start).unwrap_or(xml.len());
        let element = &xml[color_start..tag_end + 1];
        font.color = parse_string_attr(element, b"rgb=\"");
        font.color_indexed = parse_u32_attr(element, b"indexed=\"");
        font.color_theme = parse_u32_attr(element, b"theme=\"");
        font.color_tint = parse_f64_attr(element, b"tint=\"");
    }

    if let Some(family_start) = find_tag_simd(xml, b"family", 0) {
        let tag_end = find_gt_simd(xml, family_start).unwrap_or(xml.len());
        let element = &xml[family_start..tag_end + 1];
        font.family = parse_u32_attr(element, b"val=\"");
    }

    if let Some(scheme_start) = find_tag_simd(xml, b"scheme", 0) {
        let tag_end = find_gt_simd(xml, scheme_start).unwrap_or(xml.len());
        let element = &xml[scheme_start..tag_end + 1];
        font.scheme = parse_string_attr(element, b"val=\"");
    }

    if let Some(charset_start) = find_tag_simd(xml, b"charset", 0) {
        let tag_end = find_gt_simd(xml, charset_start).unwrap_or(xml.len());
        let element = &xml[charset_start..tag_end + 1];
        font.charset = parse_u32_attr(element, b"val=\"");
    }

    font
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::xml::decode_xml_entities;

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
    }

    #[test]
    fn test_decode_xml_entities_numeric() {
        assert_eq!(decode_xml_entities(b"&#65;"), "A");
        assert_eq!(decode_xml_entities(b"&#x41;"), "A");
        assert_eq!(decode_xml_entities(b"&#10;"), "\n");
    }

    #[test]
    fn test_parse_comment_font() {
        let xml = br#"<rPr>
            <rFont val="Arial"/>
            <sz val="12"/>
            <b/>
            <i/>
            <u/>
            <strike/>
            <color rgb="FF0000"/>
        </rPr>"#;

        let font = parse_comment_font(xml);
        assert_eq!(font.name, Some("Arial".to_string()));
        assert_eq!(font.size, Some(12.0));
        assert!(font.bold);
        assert!(font.italic);
        assert!(font.underline);
        assert!(font.strike);
        assert_eq!(font.color, Some("FF0000".to_string()));
    }
}
