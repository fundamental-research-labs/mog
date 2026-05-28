use domain_types::{CellData, ParseOutput, SheetData};
use value_types::CellValue;
use xlsx_parser::{XlsxArchive, write::write_xlsx_from_parse_output};

#[test]
fn writer_regenerates_explicit_empty_formula_cached_value() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![CellData {
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: Some("A2".to_string()),
                has_empty_cached_value: true,
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).expect("write XLSX");
    let archive = XlsxArchive::new(&bytes).expect("XLSX archive");
    let sheet_xml = String::from_utf8(
        archive
            .read_file("xl/worksheets/sheet1.xml")
            .expect("worksheet XML"),
    )
    .expect("worksheet XML should be UTF-8");

    assert!(sheet_xml.contains("<f>A2</f>"));
    assert!(
        sheet_xml.contains("<v></v>") || sheet_xml.contains("<v/>"),
        "formula cell should carry an explicit empty cached value: {sheet_xml}"
    );
}
