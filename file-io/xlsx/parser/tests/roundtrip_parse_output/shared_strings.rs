use std::sync::Arc;

use value_types::CellValue;
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

#[test]
fn imported_shared_string_edit_regenerates_sst_and_package_graph() {
    let imported = super::fixtures::create_xlsx_with_shared_strings(&["original"], &[((0, 0), 0)]);
    let (mut output, _diagnostics) = parse_xlsx_to_output(&imported).expect("fixture should parse");
    let cell = output.sheets[0]
        .cells
        .iter_mut()
        .find(|cell| cell.row == 0 && cell.col == 0)
        .expect("A1 should parse from shared strings");
    cell.value = CellValue::Text(Arc::from("edited"));

    let exported = write_xlsx_from_parse_output(&output).expect("export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(shared_strings.contains("count=\"1\""));
    assert!(shared_strings.contains("uniqueCount=\"1\""));
    assert!(shared_strings.contains("<t>edited</t>"));
    assert!(!shared_strings.contains("original"));
    assert!(workbook_rels.contains(xlsx_parser::write::REL_SHARED_STRINGS));
    assert!(workbook_rels.contains("Target=\"sharedStrings.xml\""));
    assert!(content_types.contains("PartName=\"/xl/sharedStrings.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
