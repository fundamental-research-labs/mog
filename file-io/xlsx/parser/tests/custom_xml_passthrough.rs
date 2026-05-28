use xlsx_parser::write::{ZipWriter, write_xlsx_from_parse_output};
use xlsx_parser::{XlsxArchive, parse_xlsx_to_output};

fn utf16le_xml(xml: &str) -> Vec<u8> {
    let mut bytes = vec![0xff, 0xfe];
    for unit in xml.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

fn workbook_with_utf16_custom_xml(custom_xml_parts: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>
  <Override PartName="/customXml/itemProps2.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>
</Types>"#
            .to_vec(),
    );
    zip.add_file(
        "_rels/.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/workbook.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item2.xml"/>
</Relationships>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/worksheets/sheet1.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
</worksheet>"#
            .to_vec(),
    );
    for (path, data) in custom_xml_parts {
        zip.add_file(path, data.clone());
    }
    for idx in 1..=2 {
        zip.add_file(
            &format!("customXml/itemProps{idx}.xml"),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ds:datastoreItem ds:itemID="{{11111111-1111-1111-1111-11111111111{idx}}}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>"#
            )
            .into_bytes(),
        );
        zip.add_file(
            &format!("customXml/_rels/item{idx}.xml.rels"),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps{idx}.xml"/></Relationships>"#
            )
            .into_bytes(),
        );
    }
    zip.finish().expect("build xlsx")
}

#[test]
fn utf16_custom_xml_parts_are_preserved_as_verbatim_passthrough() {
    let custom_xml_parts = vec![
        (
            "customXml/item1.xml",
            utf16le_xml(r#"<?xml version="1.0" encoding="UTF-16"?><Gemini id="one"/>"#),
        ),
        (
            "customXml/item2.xml",
            utf16le_xml(r#"<?xml version="1.0" encoding="UTF-16"?><Gemini id="two"/>"#),
        ),
    ];
    let bytes = workbook_with_utf16_custom_xml(&custom_xml_parts);

    let (parsed, round_trip_ctx, _diagnostics) =
        parse_xlsx_to_output(&bytes).expect("UTF-16 customXml should not block workbook import");
    for (path, expected) in &custom_xml_parts {
        let preserved = round_trip_ctx
            .opaque_package_subgraphs
            .iter()
            .flat_map(|subgraph| subgraph.parts.iter())
            .find(|part| part.part.path == *path)
            .expect("customXml item captured for passthrough");
        assert_eq!(&preserved.part.data, expected);
    }
    assert!(
        round_trip_ctx
            .opaque_package_subgraphs
            .iter()
            .all(|subgraph| {
                subgraph
                    .parts
                    .iter()
                    .all(|part| !part.part.path.contains("/_rels/"))
                    && !subgraph.relationships.is_empty()
            }),
        "customXml sidecar .rels should be lowered into structured opaque relationships"
    );

    let exported = write_xlsx_from_parse_output(&parsed, Some(&round_trip_ctx)).expect("export");
    let exported_archive = XlsxArchive::new(&exported).expect("exported xlsx");
    for (path, expected) in &custom_xml_parts {
        let exported_custom_xml = exported_archive
            .read_file_verbatim(path)
            .expect("read exported customXml item");
        assert_eq!(&exported_custom_xml, expected);
    }
    let item1_rels = String::from_utf8(
        exported_archive
            .read_file("customXml/_rels/item1.xml.rels")
            .expect("read exported customXml item rels"),
    )
    .unwrap();
    assert!(item1_rels.contains("Target=\"itemProps1.xml\""));
}
