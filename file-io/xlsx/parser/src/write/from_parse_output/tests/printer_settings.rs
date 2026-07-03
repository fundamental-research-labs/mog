use super::*;

const PRINTER_SETTINGS_BYTES: &[u8] = b"printer-settings-binary";

#[test]
fn imported_current_worksheet_printer_settings_roundtrips_relationship_and_bytes() {
    let imported = printer_settings_fixture(Some(PRINTER_SETTINGS_BYTES));
    let (parsed, _) = crate::parse_xlsx_to_output(&imported).expect("fixture should parse");

    let imported_settings = parsed.sheets[0]
        .print_settings
        .as_ref()
        .and_then(|settings| settings.imported_printer_settings.as_ref())
        .expect("printer settings identity should be imported");
    assert_eq!(
        imported_settings.path,
        "xl/printerSettings/printerSettings1.bin"
    );
    assert_eq!(
        imported_settings.relationship_id.as_deref(),
        Some("rIdPrinter")
    );

    let exported = write_xlsx_from_parse_output(&parsed).expect("export should succeed");
    let archive = crate::XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = crate::domain::workbook::read::parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    );

    assert!(sheet_xml.contains(r#"<pageSetup"#));
    assert!(sheet_xml.contains(r#"r:id="rIdPrinter""#));
    assert!(sheet_rels.iter().any(|rel| {
        rel.id == "rIdPrinter"
            && rel.rel_type == crate::infra::opc::REL_PRINTER_SETTINGS
            && rel.target == "../printerSettings/printerSettings1.bin"
            && rel.target_mode.is_none()
    }));
    assert_eq!(
        archive
            .read_file("xl/printerSettings/printerSettings1.bin")
            .unwrap(),
        PRINTER_SETTINGS_BYTES
    );
    crate::infra::package_integrity::validate_archive_package_integrity(&archive)
        .expect("exported package should be valid");
}

#[test]
fn missing_imported_worksheet_printer_settings_target_does_not_block_or_dangle() {
    let imported = printer_settings_fixture(None);
    let (parsed, _) = crate::parse_xlsx_to_output(&imported).expect("fixture should parse");

    assert!(
        parsed.sheets[0]
            .print_settings
            .as_ref()
            .and_then(|settings| settings.imported_printer_settings.as_ref())
            .is_some(),
        "relationship provenance should be retained even when target bytes are missing"
    );

    let exported = write_xlsx_from_parse_output(&parsed).expect("export should not fail");
    let archive = crate::XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<pageSetup"#));
    assert!(!sheet_xml.contains(r#"r:id="rIdPrinter""#));
    assert!(!archive.contains("xl/printerSettings/printerSettings1.bin"));
    if let Ok(rels_bytes) = archive.read_file("xl/worksheets/_rels/sheet1.xml.rels") {
        let sheet_rels = crate::domain::workbook::read::parse_all_rels(&rels_bytes);
        assert!(
            sheet_rels
                .iter()
                .all(|rel| rel.rel_type != crate::infra::opc::REL_PRINTER_SETTINGS),
            "missing printerSettings target must not leave a worksheet relationship"
        );
    }
    crate::infra::package_integrity::validate_archive_package_integrity(&archive)
        .expect("exported package should be valid");
}

#[test]
fn stale_imported_worksheet_printer_settings_bytes_are_preserved_inertly() {
    let imported = printer_settings_fixture(Some(PRINTER_SETTINGS_BYTES));
    let (mut parsed, _) = crate::parse_xlsx_to_output(&imported).expect("fixture should parse");
    parsed.sheets[0]
        .print_settings
        .as_mut()
        .expect("print settings should be present")
        .scale = Some(91);

    let exported = write_xlsx_from_parse_output(&parsed).expect("export should succeed");
    let archive = crate::XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"scale="91""#));
    assert!(!sheet_xml.contains(r#"r:id="rIdPrinter""#));
    assert_eq!(
        archive
            .read_file("xl/printerSettings/printerSettings1.bin")
            .unwrap(),
        PRINTER_SETTINGS_BYTES
    );
    if let Ok(rels_bytes) = archive.read_file("xl/worksheets/_rels/sheet1.xml.rels") {
        let sheet_rels = crate::domain::workbook::read::parse_all_rels(&rels_bytes);
        assert!(
            sheet_rels
                .iter()
                .all(|rel| rel.rel_type != crate::infra::opc::REL_PRINTER_SETTINGS),
            "stale printerSettings bytes must be inert, not worksheet-owned"
        );
    }
    crate::infra::package_integrity::validate_archive_package_integrity(&archive)
        .expect("exported package should be valid");
}

fn printer_settings_fixture(printer_settings: Option<&[u8]>) -> Vec<u8> {
    let mut zip = crate::write::ZipWriter::new();
    zip.add_file("[Content_Types].xml", content_types_xml().into_bytes())
        .add_file("_rels/.rels", root_rels_xml().into_bytes())
        .add_file("xl/workbook.xml", workbook_xml().into_bytes())
        .add_file(
            "xl/_rels/workbook.xml.rels",
            workbook_rels_xml().into_bytes(),
        )
        .add_file("xl/worksheets/sheet1.xml", worksheet_xml().into_bytes())
        .add_file(
            "xl/worksheets/_rels/sheet1.xml.rels",
            worksheet_rels_xml().into_bytes(),
        );
    if let Some(bytes) = printer_settings {
        zip.add_file("xl/printerSettings/printerSettings1.bin", bytes.to_vec());
    }
    zip.finish().expect("fixture ZIP should write")
}

fn content_types_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="{}"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="bin" ContentType="{}"/>
  <Override PartName="/xl/workbook.xml" ContentType="{}"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="{}"/>
</Types>"#,
        crate::write::CT_RELATIONSHIPS,
        crate::write::CT_PRINTER_SETTINGS,
        crate::write::CT_WORKBOOK,
        crate::write::CT_WORKSHEET
    )
}

fn root_rels_xml() -> String {
    rels_xml(&[(
        "rIdWorkbook",
        crate::infra::opc::REL_OFFICE_DOCUMENT,
        "xl/workbook.xml",
    )])
}

fn workbook_rels_xml() -> String {
    rels_xml(&[(
        "rIdSheet",
        crate::infra::opc::REL_WORKSHEET,
        "worksheets/sheet1.xml",
    )])
}

fn worksheet_rels_xml() -> String {
    rels_xml(&[(
        "rIdPrinter",
        crate::infra::opc::REL_PRINTER_SETTINGS,
        "../printerSettings/printerSettings1.bin",
    )])
}

fn workbook_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rIdSheet"/>
  </sheets>
</workbook>"#
        .to_string()
}

fn worksheet_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <pageSetup paperSize="9" scale="90" orientation="landscape" horizontalDpi="600" verticalDpi="600" r:id="rIdPrinter"/>
</worksheet>"#
        .to_string()
}

fn rels_xml(relationships: &[(&str, &str, &str)]) -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (id, rel_type, target) in relationships {
        xml.push_str(&format!(
            r#"<Relationship Id="{id}" Type="{rel_type}" Target="{target}"/>"#
        ));
    }
    xml.push_str("</Relationships>");
    xml
}
