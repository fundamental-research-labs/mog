use super::fixtures::ZipBuilder;
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::{REL_CUSTOM_PROPERTY, resolve_relationship_target};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

const CUSTOM_PROPERTY_PATH: &str = "xl/customProperty/item1.xml";
const CUSTOM_PROPERTY_BYTES: &[u8] = br#"<customProperty xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="MogCustom"><value>preserved</value></customProperty>"#;
const CUSTOM_PROPERTY_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty+xml";

#[test]
fn imported_worksheet_custom_property_roundtrips_payload_and_relationship() {
    let imported = worksheet_custom_property_fixture(Some(CUSTOM_PROPERTY_BYTES));
    let (parsed, diagnostics) =
        parse_xlsx_to_output(&imported).expect("custom-property fixture should parse");
    assert!(diagnostics.errors.iter().all(|error| {
        !error
            .message
            .contains("Dropped XLSX import data with no modeled ParseOutput owner")
    }));
    assert!(
        parsed.sheets[0]
            .worksheet_semantic_containers
            .custom_properties
            .as_ref()
            .is_some_and(|xml| xml.raw_xml.contains("MogCustom"))
    );

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("custom-property fixture should export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let worksheet_xml = read_utf8(&archive, "xl/worksheets/sheet1.xml");
    assert!(worksheet_xml.contains("<customProperties>"));
    assert!(worksheet_xml.contains(r#"r:id="rIdCustom""#));
    let custom_property_bytes = archive
        .read_file(CUSTOM_PROPERTY_PATH)
        .expect("custom-property part should be emitted");
    assert_eq!(custom_property_bytes.as_slice(), CUSTOM_PROPERTY_BYTES);

    let worksheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .expect("worksheet relationships should be emitted"),
    );
    let custom_property_rel = worksheet_rels
        .iter()
        .find(|rel| rel.rel_type == REL_CUSTOM_PROPERTY)
        .expect("worksheet custom-property relationship should be emitted");
    assert_eq!(custom_property_rel.id, "rIdCustom");
    assert_eq!(
        resolve_relationship_target(
            Some("xl/worksheets/sheet1.xml"),
            &custom_property_rel.target
        )
        .expect("custom-property relationship target should resolve"),
        CUSTOM_PROPERTY_PATH
    );

    let content_types = read_utf8(&archive, "[Content_Types].xml");
    assert!(content_types.contains(r#"PartName="/xl/customProperty/item1.xml""#));
    assert!(content_types.contains(CUSTOM_PROPERTY_CONTENT_TYPE));

    let (roundtripped, roundtrip_diagnostics) =
        parse_xlsx_to_output(&exported).expect("exported custom-property XLSX should parse back");
    assert!(roundtrip_diagnostics.errors.iter().all(|error| {
        !error
            .message
            .contains("Dropped XLSX import data with no modeled ParseOutput owner")
    }));
    assert!(
        roundtripped.sheets[0]
            .worksheet_semantic_containers
            .custom_properties
            .as_ref()
            .is_some_and(|xml| xml.raw_xml.contains("MogCustom"))
    );
}

#[test]
fn missing_worksheet_custom_property_payload_does_not_block_export_or_dangle() {
    let imported = worksheet_custom_property_fixture(None);
    let (parsed, _diagnostics) = parse_xlsx_to_output(&imported)
        .expect("missing custom-property payload fixture should parse");

    let exported = write_xlsx_from_parse_output(&parsed)
        .expect("missing custom-property payload should not block export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let worksheet_xml = read_utf8(&archive, "xl/worksheets/sheet1.xml");
    assert!(!worksheet_xml.contains("<customProperties>"));
    assert!(archive.read_file(CUSTOM_PROPERTY_PATH).is_err());
    if let Ok(rels) = archive.read_file("xl/worksheets/_rels/sheet1.xml.rels") {
        assert!(
            parse_all_rels(&rels)
                .iter()
                .all(|rel| rel.rel_type != REL_CUSTOM_PROPERTY)
        );
    }
}

#[test]
fn stale_worksheet_custom_property_ref_prunes_only_unresolved_entry() {
    let imported = worksheet_custom_property_fixture_with(
        Some(CUSTOM_PROPERTY_BYTES),
        mixed_worksheet_xml(),
        mixed_worksheet_rels_xml(),
    );
    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("mixed custom-property fixture should parse");

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("mixed custom-property fixture should export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let worksheet_xml = read_utf8(&archive, "xl/worksheets/sheet1.xml");
    assert!(worksheet_xml.contains("MogCustom"));
    assert!(worksheet_xml.contains(r#"r:id="rIdCustom""#));
    assert!(!worksheet_xml.contains("StaleCustom"));
    assert!(!worksheet_xml.contains("rIdMissing"));
    let custom_property_bytes = archive
        .read_file(CUSTOM_PROPERTY_PATH)
        .expect("valid custom-property part should be emitted");
    assert_eq!(custom_property_bytes.as_slice(), CUSTOM_PROPERTY_BYTES);

    let worksheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .expect("worksheet relationships should be emitted"),
    );
    let custom_property_rels: Vec<_> = worksheet_rels
        .iter()
        .filter(|rel| rel.rel_type == REL_CUSTOM_PROPERTY)
        .collect();
    assert_eq!(custom_property_rels.len(), 1);
    assert_eq!(custom_property_rels[0].id, "rIdCustom");
}

#[test]
fn duplicate_worksheet_custom_property_relationships_keep_distinct_ids() {
    let imported = worksheet_custom_property_fixture_with(
        Some(CUSTOM_PROPERTY_BYTES),
        duplicate_relationship_worksheet_xml(),
        duplicate_relationship_worksheet_rels_xml(),
    );
    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&imported).expect("duplicate custom-property fixture should parse");

    let exported = write_xlsx_from_parse_output(&parsed)
        .expect("duplicate custom-property relationship fixture should export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let worksheet_xml = read_utf8(&archive, "xl/worksheets/sheet1.xml");
    assert!(worksheet_xml.contains(r#"r:id="rIdCustomA""#));
    assert!(worksheet_xml.contains(r#"r:id="rIdCustomB""#));
    let worksheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .expect("worksheet relationships should be emitted"),
    );
    let custom_property_rels: Vec<_> = worksheet_rels
        .iter()
        .filter(|rel| rel.rel_type == REL_CUSTOM_PROPERTY)
        .collect();
    assert_eq!(custom_property_rels.len(), 2);
    assert!(
        custom_property_rels
            .iter()
            .any(|rel| rel.id == "rIdCustomA")
    );
    assert!(
        custom_property_rels
            .iter()
            .any(|rel| rel.id == "rIdCustomB")
    );
}

fn worksheet_custom_property_fixture(custom_property_bytes: Option<&[u8]>) -> Vec<u8> {
    worksheet_custom_property_fixture_with(
        custom_property_bytes,
        worksheet_xml(),
        worksheet_rels_xml(),
    )
}

fn worksheet_custom_property_fixture_with(
    custom_property_bytes: Option<&[u8]>,
    worksheet_xml: String,
    worksheet_rels_xml: String,
) -> Vec<u8> {
    let mut zip = ZipBuilder::new();
    zip.add_stored("[Content_Types].xml", content_types_xml().as_bytes())
        .add_stored("_rels/.rels", root_rels_xml().as_bytes())
        .add_stored("xl/workbook.xml", workbook_xml().as_bytes())
        .add_stored("xl/_rels/workbook.xml.rels", workbook_rels_xml().as_bytes())
        .add_stored(
            "xl/styles.xml",
            br#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>"#,
        )
        .add_stored("xl/worksheets/sheet1.xml", worksheet_xml.as_bytes())
        .add_stored(
            "xl/worksheets/_rels/sheet1.xml.rels",
            worksheet_rels_xml.as_bytes(),
        );
    if let Some(bytes) = custom_property_bytes {
        zip.add_stored(CUSTOM_PROPERTY_PATH, bytes);
    }
    zip.build()
}

fn content_types_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/customProperty/item1.xml" ContentType="{CUSTOM_PROPERTY_CONTENT_TYPE}"/>
</Types>"#
    )
}

fn root_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
        .to_string()
}

fn workbook_rels_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdSheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#
        .to_string()
}

fn worksheet_rels_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdCustom" Type="{REL_CUSTOM_PROPERTY}" Target="../customProperty/item1.xml"/>
</Relationships>"#
    )
}

fn mixed_worksheet_rels_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdCustom" Type="{REL_CUSTOM_PROPERTY}" Target="../customProperty/item1.xml"/>
  <Relationship Id="rIdMissing" Type="{REL_CUSTOM_PROPERTY}" Target="../customProperty/missing.xml"/>
</Relationships>"#
    )
}

fn duplicate_relationship_worksheet_rels_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdCustomA" Type="{REL_CUSTOM_PROPERTY}" Target="../customProperty/item1.xml"/>
  <Relationship Id="rIdCustomB" Type="{REL_CUSTOM_PROPERTY}" Target="../customProperty/item1.xml"/>
</Relationships>"#
    )
}

fn workbook_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rIdSheet1"/>
  </sheets>
</workbook>"#
        .to_string()
}

fn worksheet_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <customProperties><customPr name="MogCustom" r:id="rIdCustom"/></customProperties>
</worksheet>"#
        .to_string()
}

fn mixed_worksheet_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <customProperties><customPr name="MogCustom" r:id="rIdCustom"/><customPr name="StaleCustom" r:id="rIdMissing"/></customProperties>
</worksheet>"#
        .to_string()
}

fn duplicate_relationship_worksheet_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <customProperties><customPr name="MogCustomA" r:id="rIdCustomA"/><customPr name="MogCustomB" r:id="rIdCustomB"/></customProperties>
</worksheet>"#
        .to_string()
}

fn read_utf8(archive: &XlsxArchive<'_>, path: &str) -> String {
    String::from_utf8(
        archive
            .read_file(path)
            .unwrap_or_else(|err| panic!("{path} should be readable: {err}")),
    )
    .unwrap_or_else(|err| panic!("{path} should be UTF-8: {err}"))
}
