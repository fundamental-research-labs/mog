//! XLSX export regressions for runtime-created sheet protection metadata.

use super::super::*;
use super::helpers::*;

#[test]
fn runtime_created_sheet_protection_exports_to_xlsx_package() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .protect_sheet(&sid, Some("CC2A".to_string()))
        .expect("runtime sheet protection should succeed");

    let exported = engine.export_to_parse_output().unwrap().parse_output;
    let protection = exported.sheets[0]
        .protection
        .as_ref()
        .expect("runtime-created sheet protection should export to ParseOutput");
    assert!(protection.is_protected);
    assert_eq!(protection.password_hash.as_deref(), Some("CC2A"));

    let bytes = engine
        .export_to_xlsx_bytes()
        .expect("runtime-created sheet protection should export to XLSX bytes");
    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).expect("xlsx archive");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<sheetProtection"));
    assert!(sheet_xml.contains(r#"password="CC2A""#));
}
