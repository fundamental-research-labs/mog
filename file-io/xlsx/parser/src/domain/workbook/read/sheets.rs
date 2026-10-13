use crate::domain::workbook::types::{SheetInfo, SheetState};
use quick_xml::{NsReader, events::Event, name::ResolveResult};

/// Parse workbook.xml sheet entries with namespace-aware relationship attributes.
/// Unqualified legacy fragments remain accepted by this low-level parser.
pub fn parse_workbook(xml: &[u8]) -> Vec<SheetInfo> {
    let mut sheets = Vec::new();
    let mut reader = NsReader::from_reader(xml);
    let mut in_sheets = false;
    loop {
        let Ok((namespace, event)) = reader.read_resolved_event() else {
            break;
        };
        let workbook_namespace = match namespace {
            ResolveResult::Unbound => true,
            ResolveResult::Bound(ns) => matches!(
                ns.as_ref(),
                b"http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                    | b"http://purl.oclc.org/ooxml/spreadsheetml/main"
            ),
            _ => false,
        };
        match event {
            Event::Start(ref element)
                if workbook_namespace && element.local_name().as_ref() == b"sheets" =>
            {
                in_sheets = true
            }
            Event::End(ref element)
                if workbook_namespace && element.local_name().as_ref() == b"sheets" =>
            {
                in_sheets = false
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if in_sheets && workbook_namespace && element.local_name().as_ref() == b"sheet" =>
            {
                let mut sheet = SheetInfo {
                    name: String::new(),
                    sheet_id: 0,
                    r_id: String::new(),
                    state: SheetState::Visible,
                };
                for attr in element.attributes().filter_map(Result::ok) {
                    let Ok(value) = attr.unescape_value() else {
                        continue;
                    };
                    match attr.key.as_ref() {
                        b"name" => sheet.name = value.into_owned(),
                        b"sheetId" => sheet.sheet_id = value.parse().unwrap_or(0),
                        b"state" => sheet.state = SheetState::from_bytes(value.as_bytes()),
                        _ => {
                            let (ns, local) = reader.resolve_attribute(attr.key);
                            let relationship = match ns {
                                ResolveResult::Bound(ns) => matches!(ns.as_ref(),
                                    b"http://schemas.openxmlformats.org/officeDocument/2006/relationships" |
                                    b"http://purl.oclc.org/ooxml/officeDocument/relationships"),
                                // Preserve permissive support for legacy test fragments
                                // without namespace declarations, never a bound wrong URI.
                                ResolveResult::Unknown(_) => attr.key.as_ref() == b"r:id",
                                _ => false,
                            };
                            if relationship && local.as_ref() == b"id" {
                                sheet.r_id = value.into_owned();
                            }
                        }
                    }
                }
                if !sheet.name.is_empty() {
                    sheets.push(sheet);
                }
            }
            Event::Eof => break,
            _ => {}
        }
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

#[cfg(test)]
mod namespace_tests {
    use super::*;
    use crate::domain::workbook::read::parse_calc_settings;
    #[test]
    fn prefixed_workbook_retains_sheet_relationships_and_calculation_settings() {
        let plain = br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="manual" calcOnSave="0"/></workbook>"#;
        let prefixed = br#"<long:workbook xmlns:long="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:ns1="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><long:sheets><long:sheet name="Sheet1" sheetId="1" ns1:id="rId1"/></long:sheets><long:calcPr calcMode="manual" calcOnSave="0"/></long:workbook>"#;
        let a = parse_workbook(plain);
        let b = parse_workbook(prefixed);
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert_eq!(a[0].name, b[0].name);
        assert_eq!(a[0].sheet_id, b[0].sheet_id);
        assert_eq!(a[0].r_id, b[0].r_id);
        let a = parse_calc_settings(plain);
        let b = parse_calc_settings(prefixed);
        assert_eq!(a.calc_mode, b.calc_mode);
        assert_eq!(a.calc_on_save, b.calc_on_save);
        assert!(!b.calc_on_save);
    }
    #[test]
    fn unrelated_namespace_id_is_not_a_sheet_relationship() {
        let xml=br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="urn:unrelated"><sheets><sheet name="Sheet1" sheetId="1" r:id="bad"/></sheets></workbook>"#;
        assert_eq!(parse_workbook(xml)[0].r_id, "");
    }
}
