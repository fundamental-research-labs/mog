use super::xml::{
    checked_xml_text, decode_xml_entities, extract_attr_value_in_range, find_closing_tag_simple,
    find_element_end_simple,
};
use crate::domain::workbook::types::{SheetInfo, SheetState};
use crate::infra::scanner::find_tag_simd;

/// Parse workbook.xml to extract sheet information.
///
/// Returns a vector of SheetInfo in document order.
pub fn parse_workbook(xml: &[u8]) -> Vec<SheetInfo> {
    let mut sheets = Vec::new();

    let sheets_start = match find_tag_simd(xml, b"sheets", 0) {
        Some(pos) => pos,
        None => return sheets,
    };

    let sheets_end = find_closing_tag_simple(xml, b"sheets", sheets_start).unwrap_or(xml.len());
    let mut pos = sheets_start;

    while pos < sheets_end {
        let sheet_pos = match find_tag_simd(xml, b"sheet", pos) {
            Some(p) if p < sheets_end => p,
            _ => break,
        };

        let after_tag = sheet_pos + 6;
        if after_tag < xml.len() {
            let next_byte = xml[after_tag];
            if next_byte == b's' {
                pos = sheet_pos + 7;
                continue;
            }
        }

        let element_end = find_element_end_simple(xml, sheet_pos).unwrap_or(xml.len());
        let element = &xml[sheet_pos..element_end.min(xml.len())];

        let name = extract_attr_value_in_range(element, b"name=\"")
            .map(decode_xml_entities)
            .unwrap_or_default();
        let sheet_id = extract_attr_value_in_range(element, b"sheetId=\"")
            .and_then(|s| std::str::from_utf8(s).ok())
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        let r_id = extract_attr_value_in_range(element, b"r:id=\"")
            .or_else(|| extract_attr_value_in_range(element, b":id=\""))
            .map(checked_xml_text)
            .unwrap_or_default();
        let state = extract_attr_value_in_range(element, b"state=\"")
            .map(SheetState::from_bytes)
            .unwrap_or(SheetState::Visible);

        if !name.is_empty() {
            sheets.push(SheetInfo {
                name,
                sheet_id,
                r_id,
                state,
            });
        }

        pos = element_end + 1;
    }

    sheets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_workbook_single_sheet() {
        let xml = br#"<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].name, "Sheet1");
        assert_eq!(sheets[0].sheet_id, 1);
        assert_eq!(sheets[0].r_id, "rId1");
    }

    #[test]
    fn test_parse_workbook_multiple_sheets() {
        let xml = br#"<?xml version="1.0"?>
<workbook>
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
    <sheet name="Data" sheetId="2" r:id="rId2"/>
    <sheet name="Summary" sheetId="3" r:id="rId3"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 3);
        assert_eq!(sheets[0].name, "Sheet1");
        assert_eq!(sheets[0].sheet_id, 1);
        assert_eq!(sheets[0].r_id, "rId1");
        assert_eq!(sheets[1].name, "Data");
        assert_eq!(sheets[1].sheet_id, 2);
        assert_eq!(sheets[1].r_id, "rId2");
        assert_eq!(sheets[2].name, "Summary");
        assert_eq!(sheets[2].sheet_id, 3);
        assert_eq!(sheets[2].r_id, "rId3");
    }

    #[test]
    fn test_parse_workbook_with_xml_entities() {
        let xml = br#"<workbook>
  <sheets>
    <sheet name="Q1 &amp; Q2" sheetId="1" r:id="rId1"/>
    <sheet name="Sales &lt;2024&gt;" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 2);
        assert_eq!(sheets[0].name, "Q1 & Q2");
        assert_eq!(sheets[1].name, "Sales <2024>");
    }

    #[test]
    fn test_parse_workbook_empty_sheets() {
        let xml = br#"<workbook>
  <sheets>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 0);
    }

    #[test]
    fn test_parse_workbook_no_sheets_element() {
        let xml = br#"<workbook>
  <definedNames/>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 0);
    }

    #[test]
    fn test_parse_workbook_with_state_attributes() {
        let xml = br#"<workbook>
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1" state="visible"/>
    <sheet name="Hidden" sheetId="2" r:id="rId2" state="hidden"/>
    <sheet name="VeryHidden" sheetId="3" r:id="rId3" state="veryHidden"/>
    <sheet name="Default" sheetId="4" r:id="rId4"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 4);
        assert_eq!(sheets[0].name, "Sheet1");
        assert_eq!(sheets[0].state, SheetState::Visible);
        assert_eq!(sheets[1].name, "Hidden");
        assert_eq!(sheets[1].state, SheetState::Hidden);
        assert_eq!(sheets[2].name, "VeryHidden");
        assert_eq!(sheets[2].state, SheetState::VeryHidden);
        assert_eq!(sheets[3].name, "Default");
        assert_eq!(sheets[3].state, SheetState::Visible);
    }

    #[test]
    fn test_parse_workbook_different_attribute_order() {
        let xml = br#"<workbook>
  <sheets>
    <sheet r:id="rId1" sheetId="1" name="Sheet1"/>
  </sheets>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].name, "Sheet1");
        assert_eq!(sheets[0].sheet_id, 1);
        assert_eq!(sheets[0].r_id, "rId1");
    }

    #[test]
    fn test_parse_workbook_unicode_names() {
        let xml = "<workbook>
  <sheets>
    <sheet name=\"\u{65E5}\u{672C}\u{8A9E}\" sheetId=\"1\" r:id=\"rId1\"/>
  </sheets>
</workbook>"
            .as_bytes();

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].name, "\u{65E5}\u{672C}\u{8A9E}");
    }

    #[test]
    fn test_workbook_and_rels_integration() {
        let workbook_xml = br#"<workbook>
  <sheets>
    <sheet name="First" sheetId="1" r:id="rId1"/>
    <sheet name="Second" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"#;

        let rels_xml = br#"<Relationships>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"#;

        let sheets = parse_workbook(workbook_xml);
        let rels = crate::domain::workbook::read::parse_workbook_rels(rels_xml);
        let rels_map: std::collections::HashMap<_, _> = rels.into_iter().collect();

        assert_eq!(sheets.len(), 2);
        let first_sheet = &sheets[0];
        assert_eq!(first_sheet.name, "First");
        assert_eq!(
            rels_map.get(&first_sheet.r_id),
            Some(&"worksheets/sheet1.xml".to_string())
        );
        let second_sheet = &sheets[1];
        assert_eq!(second_sheet.name, "Second");
        assert_eq!(
            rels_map.get(&second_sheet.r_id),
            Some(&"worksheets/sheet2.xml".to_string())
        );
    }

    #[test]
    fn test_realistic_workbook_xml() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27231"/>
  <workbookPr defaultThemeVersion="166925"/>
  <bookViews>
    <workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12225" activeTab="0"/>
  </bookViews>
  <sheets>
    <sheet name="Sales Data" sheetId="1" r:id="rId1"/>
    <sheet name="Q1 Report" sheetId="2" r:id="rId2"/>
    <sheet name="Charts" sheetId="3" r:id="rId3"/>
  </sheets>
  <calcPr calcId="191029"/>
</workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 3);
        assert_eq!(sheets[0].name, "Sales Data");
        assert_eq!(sheets[1].name, "Q1 Report");
        assert_eq!(sheets[2].name, "Charts");
    }

    #[test]
    fn skips_empty_sheet_names_and_defaults_missing_values() {
        let xml = br#"<workbook><sheets>
  <sheet name="" sheetId="abc"/>
  <sheet name="Visible" r:id="rId1"/>
</sheets></workbook>"#;

        let sheets = parse_workbook(xml);
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].name, "Visible");
        assert_eq!(sheets[0].sheet_id, 0);
        assert_eq!(sheets[0].r_id, "rId1");
        assert_eq!(sheets[0].state, SheetState::Visible);
    }
}
