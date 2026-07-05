use super::super::fixtures::ZipBuilder;
use domain_types::domain::floating_object::{
    FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
    FormControlData, FormControlOoxmlProps,
};
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::{
    REL_ACTIVE_X_CONTROL, REL_ACTIVE_X_CONTROL_BINARY, REL_HYPERLINK, REL_OFFICE_DOCUMENT,
    REL_WORKSHEET, resolve_relationship_target,
};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::REL_CTRL_PROP;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

const ACTIVE_X_XML: &str = r#"<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ax:classid="{8BD21D40-EC42-11CE-9E0D-00AA006002F3}" r:id="rIdAxBin"/>"#;
const ACTIVE_X_XML_WITH_EXTERNAL_REL: &str = r#"<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ax:classid="{8BD21D40-EC42-11CE-9E0D-00AA006002F3}" r:id="rIdAxBin" r:link="rIdAxExternal"/>"#;
const ACTIVE_X_XML_WITH_CUSTOM_XML_REL: &str = r#"<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ax:classid="{8BD21D40-EC42-11CE-9E0D-00AA006002F3}" r:id="rIdAxBin" r:link="rIdAxCustomXml"/>"#;
const ACTIVE_X_XML_WITH_STALE_REL: &str = r#"<ax:ocx xmlns:ax="http://schemas.microsoft.com/office/2006/activeX" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ax:classid="{8BD21D40-EC42-11CE-9E0D-00AA006002F3}" r:id="rIdAxBin" r:link="rIdMissing"/>"#;
const ACTIVE_X_BYTES: &[u8] = b"\xd0\xcf\x11\xe0activex payload";
const CUSTOM_XML_BYTES: &[u8] = b"<root><value>preserved</value></root>";

#[test]
fn imported_active_x_controls_roundtrip_as_quarantined_package_closure() {
    let imported = create_active_x_xlsx();
    let (parsed, diagnostics) =
        parse_xlsx_to_output(&imported).expect("fixture should parse to ParseOutput");

    assert!(
        diagnostics
            .errors
            .iter()
            .any(|error| error.message.contains("Preserved XLSX active content")),
        "expected quarantined active-content diagnostic, got {:?}",
        diagnostics.errors
    );
    assert!(
        diagnostics
            .errors
            .iter()
            .all(|error| !(error.message.contains("ActiveX") && error.message.contains("Dropped"))),
        "ActiveX must not be reported as dropped: {:?}",
        diagnostics.errors
    );

    let package_fidelity = parsed
        .package_fidelity
        .as_ref()
        .expect("package fidelity should retain ActiveX parts");
    assert!(package_fidelity.opaque_parts.iter().any(|part| {
        part.path == "xl/activeX/activeX1.xml" && part.bytes == ACTIVE_X_XML.as_bytes()
    }));
    assert!(
        package_fidelity
            .opaque_parts
            .iter()
            .any(|part| { part.path == "xl/activeX/activeX1.bin" && part.bytes == ACTIVE_X_BYTES })
    );
    assert!(
        package_fidelity
            .package_diagnostics
            .iter()
            .any(|diagnostic| {
                diagnostic.code == "xlsx.activeContent.quarantined"
                    && diagnostic.normalized_part_path.as_deref() == Some("xl/activeX/activeX1.xml")
                    && diagnostic.continuation
                        == domain_types::XlsxDiagnosticContinuation::ExportContinued
            })
    );
    assert!(
        package_fidelity
            .package_diagnostics
            .iter()
            .all(|diagnostic| {
                diagnostic.code != "xlsx.activeContent.blocked"
                    && diagnostic.action != domain_types::XlsxDiagnosticAction::Blocked
            }),
        "ActiveX preservation must not produce blocked export diagnostics"
    );

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("ParseOutput export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");

    assert_eq!(
        archive.read_file("xl/activeX/activeX1.xml").unwrap(),
        ACTIVE_X_XML.as_bytes()
    );
    assert_eq!(
        archive.read_file("xl/activeX/activeX1.bin").unwrap(),
        ACTIVE_X_BYTES
    );

    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(worksheet_xml.contains("<controls>"));
    assert!(worksheet_xml.contains(r#"r:id="rIdAx1""#));

    let worksheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    );
    let active_x_rel = worksheet_rels
        .iter()
        .find(|rel| rel.rel_type == REL_ACTIVE_X_CONTROL)
        .expect("worksheet should relate to ActiveX XML");
    assert_eq!(active_x_rel.id, "rIdAx1");
    let active_x_path =
        resolve_relationship_target(Some("xl/worksheets/sheet1.xml"), &active_x_rel.target)
            .expect("worksheet ActiveX target should resolve");
    assert_eq!(active_x_path, "xl/activeX/activeX1.xml");

    let active_x_rels = parse_all_rels(
        &archive
            .read_file("xl/activeX/_rels/activeX1.xml.rels")
            .unwrap(),
    );
    let active_x_bin_rel = active_x_rels
        .iter()
        .find(|rel| rel.rel_type == REL_ACTIVE_X_CONTROL_BINARY)
        .expect("ActiveX XML should relate to binary persistence");
    assert_eq!(active_x_bin_rel.id, "rIdAxBin");
    let active_x_bin_path =
        resolve_relationship_target(Some("xl/activeX/activeX1.xml"), &active_x_bin_rel.target)
            .expect("ActiveX binary target should resolve");
    assert_eq!(active_x_bin_path, "xl/activeX/activeX1.bin");

    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    assert!(content_types.contains(
        r#"PartName="/xl/activeX/activeX1.xml" ContentType="application/vnd.ms-office.activeX+xml""#
    ));
    assert!(content_types.contains(
        r#"PartName="/xl/activeX/activeX1.bin" ContentType="application/vnd.ms-office.activeX""#
    ));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let (roundtripped, roundtrip_diagnostics) =
        parse_xlsx_to_output(&exported).expect("exported XLSX should parse back");
    assert!(
        roundtrip_diagnostics
            .errors
            .iter()
            .all(|error| !error.message.contains("Dropped XLSX import data")),
        "roundtripped ActiveX must not be reported as dropped: {:?}",
        roundtrip_diagnostics.errors
    );
    let roundtrip_fidelity = roundtripped
        .package_fidelity
        .as_ref()
        .expect("roundtrip package fidelity should retain ActiveX");
    assert!(roundtrip_fidelity.opaque_parts.iter().any(|part| {
        part.path == "xl/activeX/activeX1.xml" && part.bytes == ACTIVE_X_XML.as_bytes()
    }));
    assert!(
        roundtrip_fidelity
            .opaque_parts
            .iter()
            .any(|part| { part.path == "xl/activeX/activeX1.bin" && part.bytes == ACTIVE_X_BYTES })
    );
}

#[test]
fn imported_active_x_controls_merge_with_modeled_form_controls_without_data_loss() {
    let imported = create_active_x_xlsx();
    let (mut parsed, _) = parse_xlsx_to_output(&imported).expect("fixture should parse");
    parsed.sheets[0]
        .floating_objects
        .push(modeled_checkbox_form_control());

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("mixed ActiveX/form-control export succeeds");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");

    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(
        worksheet_xml.contains("Imported ActiveX"),
        "imported ActiveX worksheet control ref must be preserved: {worksheet_xml}"
    );
    assert!(
        worksheet_xml.contains("Modeled Check"),
        "modeled form control output must not be overwritten: {worksheet_xml}"
    );

    let worksheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    );
    assert!(
        worksheet_rels
            .iter()
            .any(|rel| rel.rel_type == REL_ACTIVE_X_CONTROL && rel.id == "rIdAx1"),
        "worksheet ActiveX relationship must remain present: {worksheet_rels:?}"
    );
    assert!(
        worksheet_rels
            .iter()
            .any(|rel| rel.rel_type == REL_CTRL_PROP),
        "modeled form-control relationship must remain present: {worksheet_rels:?}"
    );
    validate_archive_package_integrity(&archive).expect("mixed controls package should be valid");

    let (roundtripped, roundtrip_diagnostics) =
        parse_xlsx_to_output(&exported).expect("mixed controls export should parse back");
    assert_no_dropped_or_blocked_diagnostics(&roundtripped, &roundtrip_diagnostics);
    let controls_xml = roundtripped.sheets[0]
        .worksheet_semantic_containers
        .controls
        .as_ref()
        .expect("roundtrip controls XML should be retained")
        .raw_xml
        .as_str();
    assert!(controls_xml.contains("Imported ActiveX"));
    assert!(controls_xml.contains("Modeled Check"));
}

#[test]
fn imported_active_x_sidecar_external_relationship_does_not_block_export() {
    let imported = create_active_x_xlsx_with_active_x_rels(
        ACTIVE_X_XML_WITH_EXTERNAL_REL,
        &active_x_rels_with_external_xml(),
    );
    let (parsed, _) = parse_xlsx_to_output(&imported).expect("fixture should parse");

    let exported = write_xlsx_from_parse_output(&parsed)
        .expect("ActiveX external sidecar relationships must not block export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    assert_eq!(
        archive.read_file("xl/activeX/activeX1.xml").unwrap(),
        ACTIVE_X_XML_WITH_EXTERNAL_REL.as_bytes()
    );
    let active_x_rels = parse_all_rels(
        &archive
            .read_file("xl/activeX/_rels/activeX1.xml.rels")
            .unwrap(),
    );
    assert!(
        active_x_rels.iter().any(|rel| {
            rel.id == "rIdAxExternal"
                && rel.rel_type == REL_HYPERLINK
                && rel.target == "https://example.com/activex-help"
                && rel.target_mode.as_deref() == Some("External")
        }),
        "external ActiveX sidecar relationship must be replayed: {active_x_rels:?}"
    );
}

#[test]
fn imported_active_x_internal_sidecar_relationship_to_inert_part_does_not_block_export() {
    let imported = create_active_x_xlsx_with_active_x_rels_and_parts(
        ACTIVE_X_XML_WITH_CUSTOM_XML_REL,
        &active_x_rels_with_custom_xml(),
        &[("customXml/item1.xml", CUSTOM_XML_BYTES)],
    );
    let (parsed, _) = parse_xlsx_to_output(&imported).expect("fixture should parse");

    let exported = write_xlsx_from_parse_output(&parsed)
        .expect("ActiveX internal sidecar relationships must not block export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    assert_eq!(
        archive.read_file("xl/activeX/activeX1.xml").unwrap(),
        ACTIVE_X_XML_WITH_CUSTOM_XML_REL.as_bytes()
    );
    assert_eq!(
        archive.read_file("customXml/item1.xml").unwrap(),
        CUSTOM_XML_BYTES
    );
    let active_x_rels = parse_all_rels(
        &archive
            .read_file("xl/activeX/_rels/activeX1.xml.rels")
            .unwrap(),
    );
    assert!(
        active_x_rels.iter().any(|rel| {
            rel.id == "rIdAxCustomXml"
                && rel.rel_type == REL_HYPERLINK
                && rel.target == "../../customXml/item1.xml"
        }),
        "internal ActiveX sidecar relationship must be replayed: {active_x_rels:?}"
    );
}

#[test]
fn imported_active_x_stale_relationship_reference_does_not_block_export() {
    let imported =
        create_active_x_xlsx_with_active_x_rels(ACTIVE_X_XML_WITH_STALE_REL, &active_x_rels_xml());
    let (parsed, _) = parse_xlsx_to_output(&imported).expect("fixture should parse");

    let exported = write_xlsx_from_parse_output(&parsed)
        .expect("stale ActiveX relationship references must not block export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    assert_eq!(
        archive.read_file("xl/activeX/activeX1.xml").unwrap(),
        ACTIVE_X_XML_WITH_STALE_REL.as_bytes()
    );

    let (roundtripped, roundtrip_diagnostics) =
        parse_xlsx_to_output(&exported).expect("stale ActiveX export should parse back");
    assert_no_dropped_or_blocked_diagnostics(&roundtripped, &roundtrip_diagnostics);
}

#[test]
fn imported_active_x_stale_worksheet_control_reference_does_not_block_export() {
    let imported = create_active_x_xlsx_with_worksheet_xml(
        &worksheet_xml_with_stale_control_ref(),
        &worksheet_rels_xml(),
        ACTIVE_X_XML,
        &active_x_rels_xml(),
        &[],
    );
    let (parsed, _) = parse_xlsx_to_output(&imported).expect("fixture should parse");

    let exported = write_xlsx_from_parse_output(&parsed)
        .expect("stale worksheet ActiveX control refs must not block export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive)
        .expect("stale worksheet control refs are quarantined, not package graph failures");

    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(
        worksheet_xml.contains("Imported ActiveX Stale"),
        "stale imported control XML must be preserved: {worksheet_xml}"
    );
    assert!(
        worksheet_xml.contains(r#"r:id="rIdMissing""#),
        "stale imported control r:id must remain inertly preserved: {worksheet_xml}"
    );

    let (roundtripped, roundtrip_diagnostics) =
        parse_xlsx_to_output(&exported).expect("stale worksheet control export should parse back");
    assert_no_dropped_or_blocked_diagnostics(&roundtripped, &roundtrip_diagnostics);
}

#[test]
fn imported_active_x_stale_worksheet_control_reference_merges_with_modeled_controls() {
    let imported = create_active_x_xlsx_with_worksheet_xml(
        &worksheet_xml_with_stale_control_ref(),
        &worksheet_rels_xml(),
        ACTIVE_X_XML,
        &active_x_rels_xml(),
        &[],
    );
    let (mut parsed, _) = parse_xlsx_to_output(&imported).expect("fixture should parse");
    parsed.sheets[0]
        .floating_objects
        .push(modeled_checkbox_form_control());

    let exported = write_xlsx_from_parse_output(&parsed)
        .expect("stale imported controls must compose with modeled controls");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive)
        .expect("mixed stale controls package should remain exportable");

    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(
        worksheet_xml.contains("Imported ActiveX Stale"),
        "stale imported control XML must not be dropped during merge: {worksheet_xml}"
    );
    assert!(
        worksheet_xml.contains(r#"r:id="rIdMissing""#),
        "stale imported control r:id must remain inertly preserved: {worksheet_xml}"
    );
    assert!(
        worksheet_xml.contains("Modeled Check"),
        "modeled form control output must still be emitted: {worksheet_xml}"
    );
}

#[test]
fn imported_active_x_alternate_content_controls_do_not_duplicate_on_repeated_mixed_export() {
    let imported = create_active_x_xlsx_with_worksheet_xml(
        &worksheet_xml_with_alternate_content_controls(),
        &worksheet_rels_xml(),
        ACTIVE_X_XML,
        &active_x_rels_xml(),
        &[],
    );
    let (mut parsed, _) = parse_xlsx_to_output(&imported).expect("fixture should parse");
    parsed.sheets[0]
        .floating_objects
        .push(modeled_checkbox_form_control());

    let exported_once =
        write_xlsx_from_parse_output(&parsed).expect("first mixed controls export succeeds");
    let archive_once =
        XlsxArchive::new(&exported_once).expect("first exported XLSX should be readable");
    validate_archive_package_integrity(&archive_once)
        .expect("first mixed controls package should be valid");
    let worksheet_once =
        String::from_utf8(archive_once.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert_imported_alternate_content_counts(&worksheet_once);

    let (roundtripped, roundtrip_diagnostics) =
        parse_xlsx_to_output(&exported_once).expect("first mixed export should parse back");
    assert_no_dropped_or_blocked_diagnostics(&roundtripped, &roundtrip_diagnostics);

    let exported_twice =
        write_xlsx_from_parse_output(&roundtripped).expect("second mixed controls export succeeds");
    let archive_twice =
        XlsxArchive::new(&exported_twice).expect("second exported XLSX should be readable");
    validate_archive_package_integrity(&archive_twice)
        .expect("second mixed controls package should be valid");
    let worksheet_twice =
        String::from_utf8(archive_twice.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert_imported_alternate_content_counts(&worksheet_twice);
}

fn create_active_x_xlsx() -> Vec<u8> {
    create_active_x_xlsx_with_active_x_rels(ACTIVE_X_XML, &active_x_rels_xml())
}

fn create_active_x_xlsx_with_active_x_rels(active_x_xml: &str, active_x_rels_xml: &str) -> Vec<u8> {
    create_active_x_xlsx_with_active_x_rels_and_parts(active_x_xml, active_x_rels_xml, &[])
}

fn create_active_x_xlsx_with_active_x_rels_and_parts(
    active_x_xml: &str,
    active_x_rels_xml: &str,
    extra_parts: &[(&str, &[u8])],
) -> Vec<u8> {
    create_active_x_xlsx_with_worksheet_xml(
        &worksheet_xml(),
        &worksheet_rels_xml(),
        active_x_xml,
        active_x_rels_xml,
        extra_parts,
    )
}

fn create_active_x_xlsx_with_worksheet_xml(
    worksheet_xml: &str,
    worksheet_rels_xml: &str,
    active_x_xml: &str,
    active_x_rels_xml: &str,
    extra_parts: &[(&str, &[u8])],
) -> Vec<u8> {
    let mut builder = ZipBuilder::new();
    builder
        .add_deflate("[Content_Types].xml", content_types_xml().as_bytes())
        .add_deflate("_rels/.rels", root_rels_xml().as_bytes())
        .add_deflate("xl/_rels/workbook.xml.rels", workbook_rels_xml().as_bytes())
        .add_deflate("xl/workbook.xml", workbook_xml().as_bytes())
        .add_deflate("xl/worksheets/sheet1.xml", worksheet_xml.as_bytes())
        .add_deflate(
            "xl/worksheets/_rels/sheet1.xml.rels",
            worksheet_rels_xml.as_bytes(),
        )
        .add_deflate("xl/activeX/activeX1.xml", active_x_xml.as_bytes())
        .add_deflate(
            "xl/activeX/_rels/activeX1.xml.rels",
            active_x_rels_xml.as_bytes(),
        )
        .add_deflate("xl/activeX/activeX1.bin", ACTIVE_X_BYTES);
    for (path, bytes) in extra_parts {
        builder.add_deflate(path, bytes);
    }
    builder.build()
}

fn content_types_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/activeX/activeX1.xml" ContentType="application/vnd.ms-office.activeX+xml"/>
  <Override PartName="/xl/activeX/activeX1.bin" ContentType="application/vnd.ms-office.activeX"/>
</Types>"#
        .to_string()
}

fn root_rels_xml() -> String {
    rels_xml(&[("rIdWorkbook", REL_OFFICE_DOCUMENT, "xl/workbook.xml", None)])
}

fn workbook_rels_xml() -> String {
    rels_xml(&[("rIdSheet1", REL_WORKSHEET, "worksheets/sheet1.xml", None)])
}

fn worksheet_rels_xml() -> String {
    rels_xml(&[(
        "rIdAx1",
        REL_ACTIVE_X_CONTROL,
        "../activeX/activeX1.xml",
        None,
    )])
}

fn active_x_rels_xml() -> String {
    rels_xml(&[(
        "rIdAxBin",
        REL_ACTIVE_X_CONTROL_BINARY,
        "activeX1.bin",
        None,
    )])
}

fn active_x_rels_with_external_xml() -> String {
    rels_xml(&[
        (
            "rIdAxBin",
            REL_ACTIVE_X_CONTROL_BINARY,
            "activeX1.bin",
            None,
        ),
        (
            "rIdAxExternal",
            REL_HYPERLINK,
            "https://example.com/activex-help",
            Some("External"),
        ),
    ])
}

fn active_x_rels_with_custom_xml() -> String {
    rels_xml(&[
        (
            "rIdAxBin",
            REL_ACTIVE_X_CONTROL_BINARY,
            "activeX1.bin",
            None,
        ),
        (
            "rIdAxCustomXml",
            REL_HYPERLINK,
            "../../customXml/item1.xml",
            None,
        ),
    ])
}

fn modeled_checkbox_form_control() -> FloatingObject {
    let ooxml = FormControlOoxmlProps {
        shape_id: 2048,
        anchor_source: "Modern".to_string(),
        ..FormControlOoxmlProps::default()
    };
    FloatingObject {
        common: FloatingObjectCommon {
            id: "modeled-checkbox".to_string(),
            sheet_id: "1".to_string(),
            name: "Modeled Check".to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row: 1,
                anchor_col: 1,
                end_row: Some(3),
                end_col: Some(3),
                ..FloatingObjectAnchor::default()
            },
            width: 120.0,
            height: 24.0,
            ..FloatingObjectCommon::default()
        },
        data: FloatingObjectData::FormControl(FormControlData {
            control_type: "CheckBox".to_string(),
            cell_link: None,
            input_range: None,
            ooxml: Some(ooxml),
        }),
    }
}

fn assert_no_dropped_or_blocked_diagnostics(
    output: &domain_types::ParseOutput,
    diagnostics: &domain_types::ParseDiagnostics,
) {
    assert!(
        diagnostics
            .errors
            .iter()
            .all(|error| !(error.message.contains("ActiveX") && error.message.contains("Dropped"))),
        "ActiveX must not be reported as dropped: {:?}",
        diagnostics.errors
    );
    let package_fidelity = output
        .package_fidelity
        .as_ref()
        .expect("package fidelity should exist");
    assert!(
        package_fidelity
            .package_diagnostics
            .iter()
            .all(|diagnostic| {
                diagnostic.code != "xlsx.activeContent.blocked"
                    && diagnostic.action != domain_types::XlsxDiagnosticAction::Blocked
            }),
        "ActiveX must not produce blocked diagnostics: {:?}",
        package_fidelity.package_diagnostics
    );
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
  <controls>
    <control shapeId="1025" r:id="rIdAx1" name="Imported ActiveX"/>
  </controls>
</worksheet>"#
        .to_string()
}

fn worksheet_xml_with_stale_control_ref() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <controls>
    <control shapeId="1026" r:id="rIdMissing" name="Imported ActiveX Stale"/>
  </controls>
</worksheet>"#
        .to_string()
}

fn worksheet_xml_with_alternate_content_controls() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <sheetData/>
  <mc:AlternateContent>
    <mc:Choice Requires="x14">
      <controls>
        <control shapeId="1025" r:id="rIdAx1" name="Imported ActiveX Choice"/>
      </controls>
    </mc:Choice>
    <mc:Fallback>
      <controls>
        <control shapeId="1025" r:id="rIdAx1" name="Imported ActiveX Fallback"/>
      </controls>
    </mc:Fallback>
  </mc:AlternateContent>
</worksheet>"#
        .to_string()
}

fn assert_imported_alternate_content_counts(worksheet_xml: &str) {
    assert_eq!(
        worksheet_xml.matches("Imported ActiveX Choice").count(),
        1,
        "choice-branch imported ActiveX control must not duplicate: {worksheet_xml}"
    );
    assert_eq!(
        worksheet_xml.matches("Imported ActiveX Fallback").count(),
        1,
        "fallback-branch imported ActiveX control must not duplicate: {worksheet_xml}"
    );
    assert!(
        worksheet_xml.contains("Modeled Check"),
        "modeled form control must remain present: {worksheet_xml}"
    );
}

fn rels_xml(relationships: &[(&str, &str, &str, Option<&str>)]) -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    for (id, rel_type, target, target_mode) in relationships {
        xml.push_str(&format!(
            r#"<Relationship Id="{id}" Type="{rel_type}" Target="{target}""#
        ));
        if let Some(target_mode) = target_mode {
            xml.push_str(&format!(r#" TargetMode="{target_mode}""#));
        }
        xml.push_str("/>");
    }
    xml.push_str("</Relationships>");
    xml
}
