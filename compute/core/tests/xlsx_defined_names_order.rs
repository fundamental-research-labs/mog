//! names.add after loading an Excel-shaped workbook must emit definedNames
//! in CT_Workbook order (#332).

use compute_core::storage::engine::ComputeEngine;
use domain_types::DefinedNameInput;
use xlsx_parser::write::ZipWriter;
use xlsx_parser::zip::XlsxArchive;

fn excel_shaped_fixture() -> Vec<u8> {
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
      <workbookPr/>
      <bookViews><workbookView/></bookViews>
      <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
      <calcPr calcId="191029" fullCalcOnLoad="1"/>
      <extLst><ext uri="{140A7094-0E35-4892-8432-C4D2E57EDEB7}" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"><x15:workbookPr chartTrackingRefBase="1"/></ext></extLst>
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
    zip.finish().expect("excel-shaped fixture")
}

#[test]
fn names_add_on_loaded_workbook_emits_defined_names_before_calc_pr() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&excel_shaped_fixture()).unwrap();
    engine
        .create_named_range(DefinedNameInput {
            name: "Repro_Name".into(),
            refers_to: "=Sheet1!$A$1:$A$10".into(),
            scope: None,
            comment: None,
        })
        .unwrap();
    let exported = engine.export_to_xlsx_bytes().expect("export");
    let xml = String::from_utf8(
        XlsxArchive::new(&exported)
            .unwrap()
            .read_file("xl/workbook.xml")
            .unwrap(),
    )
    .unwrap();
    let names = xml.find("<definedNames>").expect(&xml);
    let calc = xml.find("<calcPr").expect(&xml);
    let ext = xml.find("<extLst").unwrap_or(xml.len());
    assert!(
        names < calc && names < ext,
        "definedNames must precede calcPr/extLst: {xml}"
    );
    assert!(xml.contains("Repro_Name"), "{xml}");
}
