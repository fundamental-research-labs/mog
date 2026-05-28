use super::xml::{
    checked_xml_text, decode_xml_entities, extract_attr_value_in_range,
    find_element_end_simple,
};
use crate::infra::scanner::find_tag_simd;
use crate::zip::constants::MAX_RELATIONSHIPS_PER_PART;

/// Parse workbook.xml.rels to map relationship IDs to worksheet paths.
///
/// Returns a vector of (relationship_id, target_path) pairs.
/// Only includes relationships of type "worksheet".
pub fn parse_workbook_rels(xml: &[u8]) -> Vec<(String, String)> {
    let mut relationships = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        let rel_pos = match find_tag_simd(xml, b"Relationship", pos) {
            Some(p) => p,
            None => break,
        };

        let element_end = find_element_end_simple(xml, rel_pos).unwrap_or(xml.len());
        let element = &xml[rel_pos..element_end.min(xml.len())];
        let type_value = extract_attr_value_in_range(element, b"Type=\"");
        let is_worksheet = type_value
            .map(|t| memchr::memmem::find(t, b"worksheet").is_some())
            .unwrap_or(false);

        if is_worksheet {
            let id = extract_attr_value_in_range(element, b"Id=\"")
                .map(checked_xml_text)
                .unwrap_or_default();
            let target = extract_attr_value_in_range(element, b"Target=\"")
                .map(checked_xml_text)
                .unwrap_or_default();

            if !id.is_empty() && !target.is_empty() {
                relationships.push((id, target));
                if relationships.len() >= MAX_RELATIONSHIPS_PER_PART {
                    break;
                }
            }
        }

        pos = element_end + 1;
    }

    relationships
}

/// Parse all relationships from any `.rels` file, preserving IDs, types,
/// targets, and order.
///
/// This is generic OPC relationship parsing that remains exposed from workbook
/// read for legacy compatibility.
pub fn parse_all_rels(xml: &[u8]) -> Vec<ooxml_types::shared::OpcRelationship> {
    let mut relationships = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        let rel_pos = match find_tag_simd(xml, b"Relationship", pos) {
            Some(p) => p,
            None => break,
        };

        let after = rel_pos + b"<Relationship".len();
        if after < xml.len() && xml[after] == b's' {
            pos = after;
            continue;
        }

        let element_end = find_element_end_simple(xml, rel_pos).unwrap_or(xml.len());
        let element = &xml[rel_pos..element_end.min(xml.len())];

        let id = extract_attr_value_in_range(element, b"Id=\"")
            .map(checked_xml_text)
            .unwrap_or_default();
        let rel_type = extract_attr_value_in_range(element, b"Type=\"")
            .map(checked_xml_text)
            .unwrap_or_default();
        let target = extract_attr_value_in_range(element, b"Target=\"")
            .map(decode_xml_entities)
            .unwrap_or_default();
        let target_mode =
            extract_attr_value_in_range(element, b"TargetMode=\"").map(checked_xml_text);

        if !id.is_empty() && !rel_type.is_empty() {
            relationships.push(ooxml_types::shared::OpcRelationship {
                id,
                rel_type,
                target,
                target_mode,
            });
            if relationships.len() >= MAX_RELATIONSHIPS_PER_PART {
                break;
            }
        }

        pos = element_end + 1;
    }

    relationships
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
}
