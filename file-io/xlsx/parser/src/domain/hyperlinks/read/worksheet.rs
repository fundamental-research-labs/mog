//! Worksheet `<hyperlinks>` parsing.

use crate::domain::hyperlinks::read::support::find_element_end_simple;
use crate::domain::hyperlinks::types::{
    Hyperlink, HyperlinkRelationship, HyperlinkType, Hyperlinks,
};
use crate::infra::scanner::{find_closing_tag, find_tag_simd};
use crate::infra::xml::parse_string_attr;
use domain_types::domain::hyperlink::HyperlinkTargetKind;

impl Hyperlink {
    /// Parse a single `<hyperlink>` element.
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let mut hyperlink = Hyperlink::default();

        let tag_end = find_element_end_simple(xml, 0)?;
        let tag = &xml[..tag_end];

        hyperlink.cell_ref = parse_string_attr(tag, b"ref=\"")?;
        if hyperlink.cell_ref.is_empty() {
            return None;
        }

        hyperlink.r_id =
            parse_string_attr(tag, b"r:id=\"").or_else(|| parse_prefixed_local_attr(tag, b"id"));
        hyperlink.location = parse_string_attr(tag, b"location=\"");
        hyperlink.display = parse_string_attr(tag, b"display=\"");
        hyperlink.tooltip = parse_string_attr(tag, b"tooltip=\"");
        hyperlink.id = parse_string_attr(tag, b"id=\"");
        hyperlink.uid =
            parse_string_attr(tag, b"xr:uid=\"").or_else(|| parse_prefixed_local_attr(tag, b"uid"));

        if let Some(ref loc) = hyperlink.location {
            hyperlink.target = Some(loc.clone());
            hyperlink.link_type = HyperlinkType::Internal;
            hyperlink.target_kind = Some(HyperlinkTargetKind::InlineLocation);
        }

        Some(hyperlink)
    }
}

fn parse_prefixed_local_attr(xml: &[u8], local_name: &[u8]) -> Option<String> {
    let mut pos = 0;
    while pos < xml.len() {
        let colon = memchr::memchr(b':', &xml[pos..]).map(|offset| pos + offset)?;
        let name_start = xml[..colon]
            .iter()
            .rposition(|b| matches!(*b, b' ' | b'\t' | b'\n' | b'\r' | b'<'))
            .map_or(0, |idx| idx + 1);
        if name_start < colon
            && xml.get(colon + 1..colon + 1 + local_name.len()) == Some(local_name)
        {
            let name_end = colon + 1 + local_name.len();
            if matches!(
                xml.get(name_end),
                Some(b'=') | Some(b' ' | b'\t' | b'\n' | b'\r')
            ) {
                let attr_name = &xml[name_start..name_end];
                if let Some(value) = parse_string_attr(xml, attr_name) {
                    return Some(value);
                }
            }
        }
        pos = colon + 1;
    }
    None
}

impl Hyperlinks {
    /// Parse hyperlinks from worksheet XML.
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let hl_start = find_tag_simd(xml, b"hyperlinks", 0)?;
        let hl_end = find_closing_tag(xml, b"hyperlinks", hl_start).unwrap_or(xml.len());

        let section = &xml[hl_start..hl_end];
        let mut container = Hyperlinks::default();

        let mut pos = 0;
        while let Some(hl_pos) = find_tag_simd(section, b"hyperlink", pos) {
            let element_end = find_element_end_simple(section, hl_pos).unwrap_or(section.len());

            if let Some(hl) = Hyperlink::parse(&section[hl_pos..element_end + 1]) {
                container.hyperlinks.push(hl);
            }

            pos = element_end;
        }

        if container.hyperlinks.is_empty() {
            None
        } else {
            Some(container)
        }
    }

    /// Parse hyperlinks and resolve targets using relationship data.
    pub fn parse_with_rels(worksheet_xml: &[u8], rels_xml: &[u8]) -> Option<Self> {
        let mut container = Self::parse(worksheet_xml)?;
        let relationships = HyperlinkRelationship::parse_all(rels_xml);

        for hyperlink in &mut container.hyperlinks {
            hyperlink.resolve_target(&relationships);
        }

        Some(container)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::hyperlinks::types::TargetMode;

    #[test]
    fn test_parse_external_hyperlink() {
        let xml =
            br#"<hyperlink ref="A1" r:id="rId1" display="Click here" tooltip="Visit website"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "A1");
        assert_eq!(hl.r_id, Some("rId1".to_string()));
        assert_eq!(hl.display, Some("Click here".to_string()));
        assert_eq!(hl.tooltip, Some("Visit website".to_string()));
        assert!(hl.location.is_none());
        assert_eq!(hl.target, None);
        assert_eq!(hl.target_kind, None);
        assert_eq!(hl.target_mode, None);
    }

    #[test]
    fn test_parse_internal_hyperlink() {
        let xml = br#"<hyperlink ref="B5" location="Sheet2!A1" display="Go to Sheet2"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "B5");
        assert_eq!(hl.location, Some("Sheet2!A1".to_string()));
        assert_eq!(hl.display, Some("Go to Sheet2".to_string()));
        assert!(hl.r_id.is_none());
        assert_eq!(hl.target, Some("Sheet2!A1".to_string()));
        assert_eq!(hl.link_type, HyperlinkType::Internal);
        assert_eq!(hl.target_kind, Some(HyperlinkTargetKind::InlineLocation));
    }

    #[test]
    fn test_parse_hyperlink_with_fragment() {
        let xml = br#"<hyperlink ref="C1" r:id="rId1" location="Section1"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "C1");
        assert_eq!(hl.r_id, Some("rId1".to_string()));
        assert_eq!(hl.location, Some("Section1".to_string()));
        assert_eq!(hl.target, Some("Section1".to_string()));
        assert_eq!(hl.target_kind, Some(HyperlinkTargetKind::InlineLocation));
    }

    #[test]
    fn test_parse_hyperlink_minimal() {
        let xml = br#"<hyperlink ref="D1"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "D1");
        assert!(hl.r_id.is_none());
        assert!(hl.location.is_none());
        assert!(hl.display.is_none());
        assert!(hl.tooltip.is_none());
    }

    #[test]
    fn test_parse_hyperlink_missing_ref() {
        let xml = br#"<hyperlink r:id="rId1" display="No ref"/>"#;
        assert!(Hyperlink::parse(xml).is_none());
    }

    #[test]
    fn test_parse_hyperlink_empty_ref() {
        let xml = br#"<hyperlink ref="" r:id="rId1" display="No ref"/>"#;
        assert!(Hyperlink::parse(xml).is_none());
    }

    #[test]
    fn test_parse_hyperlink_with_xml_entities() {
        let xml = br#"<hyperlink ref="E1" display="A &amp; B &lt;test&gt;" tooltip="&quot;quoted&quot;"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.display, Some("A & B <test>".to_string()));
        assert_eq!(hl.tooltip, Some("\"quoted\"".to_string()));
    }

    #[test]
    fn test_parse_hyperlink_with_id_and_uid() {
        let xml = br#"<hyperlink ref="F1" id="12345" xr:uid="{abc}" r:id="rId1"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "F1");
        assert_eq!(hl.id, Some("12345".to_string()));
        assert_eq!(hl.uid, Some("{abc}".to_string()));
    }

    #[test]
    fn fallback_namespace_id_and_uid_are_parsed() {
        let xml = br#"<hyperlink ref="F1" ns:id="rId1" ns:uid="{abc}"/>"#;

        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.r_id, Some("rId1".to_string()));
        assert_eq!(hl.uid, Some("{abc}".to_string()));
    }

    #[test]
    fn quoted_gt_in_attribute_does_not_truncate_hyperlink() {
        let xml = br#"<worksheet><hyperlinks><hyperlink ref="A1" display="A > B" tooltip="still parsed"/></hyperlinks></worksheet>"#;

        let hls = Hyperlinks::parse(xml).unwrap();
        assert_eq!(hls.len(), 1);
        assert_eq!(hls.hyperlinks[0].display, Some("A > B".to_string()));
        assert_eq!(hls.hyperlinks[0].tooltip, Some("still parsed".to_string()));
    }

    #[test]
    fn test_parse_hyperlinks_container() {
        let xml = br#"<worksheet>
            <sheetData/>
            <hyperlinks>
                <hyperlink ref="A1" r:id="rId1" display="Link 1"/>
                <hyperlink ref="B2" location="Sheet2!A1" display="Internal"/>
                <hyperlink ref="C3" r:id="rId2" tooltip="Email"/>
            </hyperlinks>
        </worksheet>"#;

        let hls = Hyperlinks::parse(xml).unwrap();
        assert_eq!(hls.len(), 3);
        assert!(!hls.is_empty());

        assert_eq!(hls.hyperlinks[0].cell_ref, "A1");
        assert_eq!(hls.hyperlinks[1].cell_ref, "B2");
        assert_eq!(hls.hyperlinks[2].cell_ref, "C3");
    }

    #[test]
    fn test_parse_hyperlinks_empty() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(Hyperlinks::parse(xml).is_none());

        let xml = b"<worksheet><hyperlinks></hyperlinks></worksheet>";
        assert!(Hyperlinks::parse(xml).is_none());
    }

    #[test]
    fn test_parse_hyperlinks_with_rels() {
        let worksheet_xml = br#"<worksheet>
            <hyperlinks>
                <hyperlink ref="A1" r:id="rId1" display="Google"/>
                <hyperlink ref="B1" location="Sheet2!A1"/>
            </hyperlinks>
        </worksheet>"#;

        let rels_xml = br#"<Relationships>
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://google.com" TargetMode="External"/>
        </Relationships>"#;

        let hls = Hyperlinks::parse_with_rels(worksheet_xml, rels_xml).unwrap();
        assert_eq!(hls.len(), 2);

        assert_eq!(
            hls.hyperlinks[0].target,
            Some("https://google.com".to_string())
        );
        assert_eq!(hls.hyperlinks[0].link_type, HyperlinkType::Url);
        assert_eq!(
            hls.hyperlinks[0].target_kind,
            Some(HyperlinkTargetKind::Relationship)
        );
        assert_eq!(hls.hyperlinks[0].target_mode.as_deref(), Some("External"));

        assert_eq!(hls.hyperlinks[1].target, Some("Sheet2!A1".to_string()));
        assert_eq!(hls.hyperlinks[1].link_type, HyperlinkType::Internal);
        assert_eq!(
            hls.hyperlinks[1].target_kind,
            Some(HyperlinkTargetKind::InlineLocation)
        );
        assert_eq!(hls.hyperlinks[1].target_mode, None);
    }

    #[test]
    fn relationship_backed_empty_location_does_not_append_fragment() {
        let mut hl = Hyperlink {
            cell_ref: "A1".to_string(),
            r_id: Some("rId1".to_string()),
            location: Some(String::new()),
            ..Default::default()
        };
        let rels = vec![HyperlinkRelationship::new(
            "rId1".to_string(),
            "https://example.com".to_string(),
            TargetMode::External,
        )];

        hl.resolve_target(&rels);
        assert_eq!(hl.target, Some("https://example.com".to_string()));
    }

    #[test]
    fn test_relationship_backed_fragment_preserves_representation_and_target_mode() {
        let worksheet_xml = br#"<worksheet>
            <hyperlinks>
                <hyperlink ref="C17" r:id="rId1" display="Cover"/>
            </hyperlinks>
        </worksheet>"#;

        let rels_xml = br##"<Relationships>
            <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="#Cover!B2" TargetMode="External"/>
        </Relationships>"##;

        let hls = Hyperlinks::parse_with_rels(worksheet_xml, rels_xml).unwrap();
        let link = hls.get("C17").unwrap();

        assert_eq!(link.target.as_deref(), Some("#Cover!B2"));
        assert_eq!(link.location, None);
        assert_eq!(link.target_kind, Some(HyperlinkTargetKind::Relationship));
        assert_eq!(link.target_mode.as_deref(), Some("External"));
    }

    #[test]
    fn test_hyperlinks_get_and_iter() {
        let xml = br#"<worksheet>
            <hyperlinks>
                <hyperlink ref="A1" display="First"/>
                <hyperlink ref="B2" display="Second"/>
            </hyperlinks>
        </worksheet>"#;

        let hls = Hyperlinks::parse(xml).unwrap();
        assert_eq!(hls.get("A1").unwrap().display, Some("First".to_string()));
        assert_eq!(hls.get("B2").unwrap().display, Some("Second".to_string()));
        assert!(hls.get("C3").is_none());

        let refs: Vec<&str> = hls.iter().map(|h| h.cell_ref.as_str()).collect();
        assert_eq!(refs, vec!["A1", "B2"]);
    }

    #[test]
    fn test_realistic_worksheet_with_hyperlinks() {
        let worksheet_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <sheetData>
        <row r="1">
            <c r="A1"><v>Company</v></c>
            <c r="B1"><v>Website</v></c>
            <c r="C1"><v>Contact</v></c>
        </row>
    </sheetData>
    <hyperlinks>
        <hyperlink ref="B2" r:id="rId1" display="Visit Website" tooltip="Go to company website"/>
        <hyperlink ref="C2" r:id="rId2" display="Email Us"/>
        <hyperlink ref="D2" location="'Contact Sheet'!A1" display="See Details"/>
        <hyperlink ref="E2" r:id="rId3" location="pricing" display="View Pricing"/>
    </hyperlinks>
</worksheet>"#;

        let rels_xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.example.com" TargetMode="External"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:contact@example.com" TargetMode="External"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.example.com/products" TargetMode="External"/>
</Relationships>"#;

        let hls = Hyperlinks::parse_with_rels(worksheet_xml, rels_xml).unwrap();
        assert_eq!(hls.len(), 4);

        let web_link = hls.get("B2").unwrap();
        assert_eq!(web_link.target, Some("https://www.example.com".to_string()));
        assert_eq!(web_link.link_type, HyperlinkType::Url);
        assert!(web_link.is_external());

        let email_link = hls.get("C2").unwrap();
        assert_eq!(
            email_link.target,
            Some("mailto:contact@example.com".to_string())
        );
        assert_eq!(email_link.link_type, HyperlinkType::Email);

        let internal_link = hls.get("D2").unwrap();
        assert_eq!(internal_link.target, Some("'Contact Sheet'!A1".to_string()));
        assert_eq!(internal_link.link_type, HyperlinkType::Internal);
        assert!(internal_link.is_internal());
        let (sheet, cell) = internal_link.parse_location().unwrap();
        assert_eq!(sheet, "Contact Sheet");
        assert_eq!(cell, "A1");

        let pricing_link = hls.get("E2").unwrap();
        assert_eq!(
            pricing_link.target,
            Some("https://www.example.com/products#pricing".to_string())
        );
    }

    #[test]
    fn test_malformed_xml_handling() {
        let xml = b"<hyperlinks><hyperlink ref=\"A1\" r:id=\"rId1\">";
        let result = Hyperlinks::parse(xml);
        if let Some(hls) = result {
            assert!(hls.len() <= 1);
        }
    }

    #[test]
    fn test_empty_attributes() {
        let xml = br#"<hyperlink ref="A1" display="" tooltip=""/>"#;
        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.cell_ref, "A1");
        assert_eq!(hl.display, Some("".to_string()));
        assert_eq!(hl.tooltip, Some("".to_string()));
    }

    #[test]
    fn test_unicode_in_hyperlinks() {
        let xml = "<hyperlink ref=\"A1\" display=\"\u{65E5}\u{672C}\u{8A9E}\" tooltip=\"\u{4E2D}\u{6587}\"/>".as_bytes();
        let hl = Hyperlink::parse(xml).unwrap();
        assert_eq!(hl.display, Some("\u{65E5}\u{672C}\u{8A9E}".to_string()));
        assert_eq!(hl.tooltip, Some("\u{4E2D}\u{6587}".to_string()));
    }
}
