//! Rich text run parsing.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{decode_xml_entities, parse_string_attr, parse_u32_attr};

use super::types::{PhoneticProperties, PhoneticRun, RunProperties, TextRun};

impl TextRun {
    /// Parse a text run from `<r>...</r>` XML bytes.
    pub fn parse(xml: &[u8]) -> Self {
        let mut run = TextRun::default();

        if find_tag_simd(xml, b"rPr", 0).is_some() {
            run.properties = Some(RunProperties::parse(xml));
        }

        run.text = parse_text_content(xml, 0).unwrap_or_default();

        run
    }
}

impl PhoneticRun {
    /// Parse a phonetic run from `<rPh>...</rPh>` XML bytes.
    pub fn parse(xml: &[u8]) -> Self {
        let mut phonetic = PhoneticRun::default();

        if let Some(sb) = parse_u32_attr(xml, b"sb=\"") {
            phonetic.start_index = sb;
        }
        if let Some(eb) = parse_u32_attr(xml, b"eb=\"") {
            phonetic.end_index = eb;
        }

        phonetic.text = parse_text_content(xml, 0).unwrap_or_default();

        phonetic
    }
}

impl PhoneticProperties {
    /// Parse phonetic properties from `<phoneticPr .../>` XML bytes.
    pub fn parse(xml: &[u8]) -> Self {
        let mut props = PhoneticProperties::default();

        if let Some(font_id) = parse_u32_attr(xml, b"fontId=\"") {
            props.font_id = Some(font_id);
        }
        if let Some(t) = parse_string_attr(xml, b"type=\"") {
            props.phonetic_type = Some(t);
        }
        if let Some(a) = parse_string_attr(xml, b"alignment=\"") {
            props.alignment = Some(a);
        }

        props
    }
}

pub(super) fn parse_text_content(xml: &[u8], start: usize) -> Option<String> {
    let t_start = find_tag_simd(xml, b"t", start)?;
    let content_start = find_gt_simd(xml, t_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let t_end = find_closing_tag(xml, b"t", content_start)?;

    if content_start < t_end {
        Some(decode_xml_entities(&xml[content_start..t_end]))
    } else {
        Some(String::new())
    }
}
