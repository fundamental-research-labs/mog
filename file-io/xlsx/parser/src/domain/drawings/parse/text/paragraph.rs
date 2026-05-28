use super::super::super::helpers::{decode_xml_entities_string, extract_attr_value_in_element};
use super::super::super::reader::elements::{
    direct_child_elements, direct_child_slice, direct_child_text, document_element_slice,
};
use super::super::super::types::{Paragraph, TextRun, TextRunContent};
use super::para_props::parse_para_props;
use super::run_props::parse_run_props;

pub(in crate::domain::drawings::parse) fn parse_paragraph(xml: &[u8]) -> Option<Paragraph> {
    let element = document_element_slice(xml)?;

    let mut para = Paragraph::default();

    for child in direct_child_elements(element) {
        let child_xml = child.full_slice(element);
        match child.local_name {
            b"pPr" => para.props = parse_para_props(child_xml),
            b"r" => {
                if let Some(run) = parse_text_run(child_xml) {
                    para.runs.push(TextRunContent::Run(run));
                }
            }
            b"br" => {
                let br_props = direct_child_slice(child_xml, b"rPr").map(parse_run_props);
                para.runs
                    .push(TextRunContent::LineBreak { props: br_props });
            }
            b"fld" => {
                let id = extract_attr_value_in_element(child_xml, b"id=\"")
                    .map(|v| String::from_utf8_lossy(v).into_owned())
                    .unwrap_or_default();
                let field_type = extract_attr_value_in_element(child_xml, b"type=\"")
                    .map(|v| String::from_utf8_lossy(v).into_owned());
                let para_props = direct_child_slice(child_xml, b"pPr").map(parse_para_props);
                let run_props = direct_child_slice(child_xml, b"rPr").map(parse_run_props);
                let text = direct_child_text(child_xml, b"t").map(|raw| {
                    let raw = String::from_utf8_lossy(raw).into_owned();
                    decode_xml_entities_string(&raw)
                });
                para.runs.push(TextRunContent::Field {
                    id,
                    field_type,
                    text,
                    run_props,
                    para_props,
                });
            }
            b"endParaRPr" => {
                para.end_para_rpr = Some(parse_run_props(child_xml));
            }
            _ => {}
        }
    }

    Some(para)
}

/// Parse a text run
pub(super) fn parse_text_run(xml: &[u8]) -> Option<TextRun> {
    let element = document_element_slice(xml)?;

    let mut run = TextRun::default();

    if let Some(rpr) = direct_child_slice(element, b"rPr") {
        run.props = parse_run_props(rpr);
    }

    if let Some(text) = direct_child_text(element, b"t") {
        let text = String::from_utf8_lossy(text).into_owned();
        run.text = decode_xml_entities_string(&text);
    }

    Some(run)
}
