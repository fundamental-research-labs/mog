use super::{SheetCodeName, VBA_RELATIONSHIP_TYPE, VbaRelationship};
use crate::domain::vba::constants::workbook_rels_path;
use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_tag_simd};
use crate::zip::XlsxArchive;

pub fn detect_vba_relationship(archive: &XlsxArchive) -> Option<VbaRelationship> {
    let rels_data = archive.read_file(workbook_rels_path()).ok()?;
    parse_vba_relationship(&rels_data)
}

fn parse_vba_relationship(xml: &[u8]) -> Option<VbaRelationship> {
    let mut pos = 0;

    while let Some(rel_pos) = find_tag_simd(xml, b"Relationship", pos) {
        if let Some(type_pos) = find_attr_simd(xml, b"Type=\"", rel_pos) {
            let type_start = type_pos + 6;
            if let Some((start, end)) = extract_quoted_value(xml, type_start) {
                let rel_type = String::from_utf8_lossy(&xml[start..end]);

                if rel_type == VBA_RELATIONSHIP_TYPE {
                    let mut relationship = VbaRelationship {
                        rel_type: rel_type.into_owned(),
                        ..Default::default()
                    };

                    if let Some(id_pos) = find_attr_simd(xml, b"Id=\"", rel_pos) {
                        let id_start = id_pos + 4;
                        if let Some((s, e)) = extract_quoted_value(xml, id_start) {
                            relationship.id = String::from_utf8_lossy(&xml[s..e]).into_owned();
                        }
                    }

                    if let Some(target_pos) = find_attr_simd(xml, b"Target=\"", rel_pos) {
                        let target_start = target_pos + 8;
                        if let Some((s, e)) = extract_quoted_value(xml, target_start) {
                            relationship.target = String::from_utf8_lossy(&xml[s..e]).into_owned();
                        }
                    }

                    return Some(relationship);
                }
            }
        }

        pos = rel_pos + 1;
    }

    None
}

pub fn extract_sheet_code_names(archive: &XlsxArchive) -> Vec<SheetCodeName> {
    let mut code_names = Vec::new();

    let workbook_xml = match archive.read_file("xl/workbook.xml") {
        Ok(xml) => xml,
        Err(_) => return code_names,
    };

    parse_sheet_code_names(&workbook_xml, &mut code_names);

    code_names
}

fn parse_sheet_code_names(xml: &[u8], code_names: &mut Vec<SheetCodeName>) {
    let mut pos = 0;
    let mut index = 0u32;

    while let Some(sheet_pos) = find_tag_simd(xml, b"sheet", pos) {
        index += 1;

        let mut sheet_code = SheetCodeName {
            sheet_index: index,
            ..Default::default()
        };

        if let Some(name_pos) = find_attr_simd(xml, b"name=\"", sheet_pos) {
            let name_start = name_pos + 6;
            if let Some((s, e)) = extract_quoted_value(xml, name_start) {
                sheet_code.sheet_name = String::from_utf8_lossy(&xml[s..e]).into_owned();
            }
        }

        if let Some(code_pos) = find_attr_simd(xml, b"codeName=\"", sheet_pos) {
            let code_start = code_pos + 10;
            if let Some((s, e)) = extract_quoted_value(xml, code_start) {
                sheet_code.code_name = String::from_utf8_lossy(&xml[s..e]).into_owned();
            }
        } else {
            sheet_code.code_name = format!("Sheet{}", index);
        }

        code_names.push(sheet_code);
        pos = sheet_pos + 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_vba_relationship() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>
</Relationships>"#;

        let rel = parse_vba_relationship(xml).unwrap();
        assert_eq!(rel.id, "rId2");
        assert_eq!(rel.target, "vbaProject.bin");
        assert_eq!(rel.rel_type, VBA_RELATIONSHIP_TYPE);
    }

    #[test]
    fn test_parse_vba_relationship_rejects_type_near_miss() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.example.invalid/relationships/vbaProject" Target="vbaProject.bin"/>
</Relationships>"#;

        assert!(parse_vba_relationship(xml).is_none());
    }

    #[test]
    fn test_parse_vba_relationship_not_found() {
        let xml = br#"<?xml version="1.0"?>
<Relationships>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;

        assert!(parse_vba_relationship(xml).is_none());
    }

    #[test]
    fn test_parse_vba_relationship_empty_and_malformed() {
        assert!(parse_vba_relationship(b"").is_none());
        assert!(parse_vba_relationship(b"<not valid xml").is_none());
    }

    #[test]
    fn test_parse_vba_relationship_missing_id_and_target() {
        let xml = br#"<Relationships><Relationship Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject"/></Relationships>"#;
        let rel = parse_vba_relationship(xml).unwrap();
        assert!(rel.id.is_empty());
        assert!(rel.target.is_empty());
        assert_eq!(rel.rel_type, VBA_RELATIONSHIP_TYPE);
    }

    #[test]
    fn test_parse_sheet_code_names() {
        let xml = br#"<?xml version="1.0"?>
<workbook>
  <sheets>
    <sheet name="Sales Data" sheetId="1" codeName="Sheet1"/>
    <sheet name="Summary" sheetId="2" codeName="SummarySheet"/>
    <sheet name="Raw" sheetId="3"/>
  </sheets>
</workbook>"#;

        let mut code_names = Vec::new();
        parse_sheet_code_names(xml, &mut code_names);

        assert_eq!(code_names.len(), 3);
        assert_eq!(code_names[0].sheet_name, "Sales Data");
        assert_eq!(code_names[0].code_name, "Sheet1");
        assert_eq!(code_names[0].sheet_index, 1);
        assert_eq!(code_names[1].sheet_name, "Summary");
        assert_eq!(code_names[1].code_name, "SummarySheet");
        assert_eq!(code_names[2].sheet_name, "Raw");
        assert_eq!(code_names[2].code_name, "Sheet3");
    }

    #[test]
    fn test_sheet_missing_name_with_code_name() {
        let xml =
            br#"<workbook><sheets><sheet sheetId="1" codeName="DataCode"/></sheets></workbook>"#;
        let mut code_names = Vec::new();
        parse_sheet_code_names(xml, &mut code_names);

        assert_eq!(code_names.len(), 1);
        assert!(code_names[0].sheet_name.is_empty());
        assert_eq!(code_names[0].code_name, "DataCode");
        assert_eq!(code_names[0].sheet_index, 1);
    }

    #[test]
    fn test_sheet_code_names_empty_xml() {
        let mut code_names = Vec::new();
        parse_sheet_code_names(b"", &mut code_names);
        assert!(code_names.is_empty());
    }
}
