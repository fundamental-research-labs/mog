use crate::zip::constants::MAX_RELATIONSHIPS_PER_PART;
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::{Namespace, ResolveResult};
use quick_xml::reader::NsReader;

const RELATIONSHIPS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

/// Parse workbook.xml.rels to map relationship IDs to worksheet paths.
///
/// Returns a vector of (relationship_id, target_path) pairs.
/// Only includes relationships of type "worksheet".
pub fn parse_workbook_rels(xml: &[u8]) -> Vec<(String, String)> {
    parse_all_rels(xml)
        .into_iter()
        .filter(|rel| rel.rel_type.contains("worksheet"))
        .filter_map(|rel| {
            (!rel.id.is_empty() && !rel.target.is_empty()).then_some((rel.id, rel.target))
        })
        .take(MAX_RELATIONSHIPS_PER_PART)
        .collect()
}

/// Parse all relationships from any `.rels` file, preserving IDs, types,
/// targets, and order.
///
/// This is generic OPC relationship parsing that remains exposed from workbook
/// read for legacy compatibility.
pub fn parse_all_rels(xml: &[u8]) -> Vec<ooxml_types::shared::OpcRelationship> {
    let mut relationships = Vec::new();
    let mut reader = NsReader::from_reader(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().expand_empty_elements = false;
    let mut buf = Vec::new();

    loop {
        let Ok((ns, event)) = reader.read_resolved_event_into(&mut buf) else {
            break;
        };
        match event {
            Event::Start(start) | Event::Empty(start) => {
                if start.local_name().as_ref() == b"Relationship"
                    && is_opc_relationships_ns(&ns)
                    && let Some(rel) = parse_relationship_element(&start)
                {
                    relationships.push(rel);
                    if relationships.len() >= MAX_RELATIONSHIPS_PER_PART {
                        break;
                    }
                }
            }
            Event::Eof => break,
            Event::End(_)
            | Event::Text(_)
            | Event::CData(_)
            | Event::Comment(_)
            | Event::Decl(_)
            | Event::PI(_)
            | Event::DocType(_) => {}
        }
        buf.clear();
    }

    relationships
}

fn parse_relationship_element(
    start: &BytesStart<'_>,
) -> Option<ooxml_types::shared::OpcRelationship> {
    let id = attr_value(start, b"Id").unwrap_or_default();
    let rel_type = attr_value(start, b"Type").unwrap_or_default();
    let target = attr_value(start, b"Target").unwrap_or_default();
    let target_mode = attr_value(start, b"TargetMode");
    (!id.is_empty() && !rel_type.is_empty()).then_some(ooxml_types::shared::OpcRelationship {
        id,
        rel_type,
        target,
        target_mode,
    })
}

fn attr_value(start: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    for attr in start.attributes().flatten() {
        if attr.key.local_name().as_ref() == name {
            return attr.unescape_value().ok().map(|v| v.into_owned());
        }
    }
    None
}

fn is_opc_relationships_ns(ns: &ResolveResult<'_>) -> bool {
    match ns {
        ResolveResult::Bound(Namespace(uri)) => *uri == RELATIONSHIPS_NS.as_bytes(),
        ResolveResult::Unbound => true,
        ResolveResult::Unknown(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_workbook_rels_single() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].0, "rId1");
        assert_eq!(rels[0].1, "worksheets/sheet1.xml");
    }

    #[test]
    fn test_parse_workbook_rels_multiple() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 3);
        assert_eq!(rels[0].0, "rId1");
        assert_eq!(rels[0].1, "worksheets/sheet1.xml");
        assert_eq!(rels[1].0, "rId2");
        assert_eq!(rels[1].1, "worksheets/sheet2.xml");
        assert_eq!(rels[2].0, "rId3");
        assert_eq!(rels[2].1, "worksheets/sheet3.xml");
    }

    #[test]
    fn test_parse_workbook_rels_filters_non_worksheet() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 2);
        assert_eq!(rels[0].0, "rId1");
        assert_eq!(rels[0].1, "worksheets/sheet1.xml");
        assert_eq!(rels[1].0, "rId4");
        assert_eq!(rels[1].1, "worksheets/sheet2.xml");
    }

    #[test]
    fn test_parse_workbook_rels_empty() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 0);
    }

    #[test]
    fn test_parse_workbook_rels_different_attribute_order() {
        let xml = br#"<Relationships>
  <Relationship Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Id="rId1"/>
</Relationships>"#;

        let rels = parse_workbook_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].0, "rId1");
        assert_eq!(rels[0].1, "worksheets/sheet1.xml");
    }

    #[test]
    fn test_parse_all_rels_preserves_all_types() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>"#;

        let rels = parse_all_rels(xml);
        assert_eq!(rels.len(), 3);
        assert_eq!(rels[0].id, "rId3");
        assert!(rels[0].rel_type.contains("worksheet"));
        assert_eq!(rels[1].id, "rId1");
        assert!(rels[1].rel_type.contains("styles"));
        assert_eq!(rels[2].id, "rId5");
        assert!(rels[2].rel_type.contains("theme"));
    }

    #[test]
    fn test_parse_all_rels_external() {
        let xml = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>"#;

        let rels = parse_all_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].target, "https://example.com");
        assert_eq!(rels[0].target_mode, Some("External".to_string()));
    }

    #[test]
    fn parse_all_rels_skips_container_and_preserves_external_mode() {
        let xml = br#"<Relationships>
  <Relationship Id="rId1" Type="hyperlink" Target="https://example.com?a=1&amp;b=2" TargetMode="External"/>
</Relationships>"#;

        let rels = parse_all_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].target, "https://example.com?a=1&b=2");
        assert_eq!(rels[0].target_mode, Some("External".to_string()));
    }

    #[test]
    fn parse_all_rels_keeps_empty_target_when_id_and_type_exist() {
        let xml = br#"<Relationships>
  <Relationship Id="rId1" Type="http://example.test/type"/>
</Relationships>"#;

        let rels = parse_all_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].rel_type, "http://example.test/type");
        assert_eq!(rels[0].target, "");
        assert_eq!(rels[0].target_mode, None);
    }

    #[test]
    fn parse_all_rels_accepts_prefixed_single_quoted_relationships() {
        let xml = br#"<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships">
  <r:Relationship TargetMode='External' Target='https://example.com?a=1&amp;b=2' Type='hyperlink' Id='rId1'/>
</r:Relationships>"#;

        let rels = parse_all_rels(xml);
        assert_eq!(rels.len(), 1);
        assert_eq!(rels[0].id, "rId1");
        assert_eq!(rels[0].target, "https://example.com?a=1&b=2");
        assert_eq!(rels[0].target_mode, Some("External".to_string()));
    }
}
