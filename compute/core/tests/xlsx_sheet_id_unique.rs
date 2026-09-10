//! Generated sheet IDs after import must be unique and positive (#334).

use compute_core::storage::engine::ComputeEngine;
use xlsx_parser::write::ZipWriter;
use xlsx_parser::zip::XlsxArchive;

fn sparse_sheet_id_fixture() -> Vec<u8> {
    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    </Types>"#
            .to_vec(),
    );
    zip.add_file(
        "_rels/.rels",
        br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/workbook.xml",
        br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="Imported" sheetId="2" r:id="rId1"/></sheets>
    </workbook>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>"#
            .to_vec(),
    );
    zip.add_file(
        "xl/worksheets/sheet1.xml",
        br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>
    </worksheet>"#
            .to_vec(),
    );
    zip.finish().expect("sparse sheetId fixture")
}

#[test]
fn import_then_add_sheet_exports_unique_positive_sheet_ids() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&sparse_sheet_id_fixture()).unwrap();
    engine.create_sheet("Added").unwrap();
    let exported = engine.export_to_xlsx_bytes().expect("export");
    let xml = String::from_utf8(
        XlsxArchive::new(&exported)
            .unwrap()
            .read_file("xl/workbook.xml")
            .unwrap(),
    )
    .unwrap();
    let mut ids = Vec::new();
    for part in xml.split("sheetId=\"").skip(1) {
        let id = part.split('"').next().unwrap().parse::<u32>().expect(part);
        assert!(id > 0, "sheetId must be positive: {xml}");
        ids.push(id);
    }
    assert_eq!(ids.len(), 2, "{xml}");
    assert_eq!(
        ids.iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        ids.len(),
        "duplicate sheetId: {xml}"
    );
}
