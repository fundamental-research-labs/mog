use std::sync::Arc;

use super::super::helpers::{cell, make_single_sheet};
use domain_types::{TableColumnSpec, TableSpec, TotalsFunction};
use value_types::{CellValue, FiniteF64};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

#[test]
fn modeled_table_export_registers_xml_relationship_and_content_type() {
    let mut output = make_single_sheet(
        "Tables",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Name"))),
            cell(0, 1, CellValue::Text(Arc::from("Score"))),
            cell(0, 2, CellValue::Text(Arc::from("Bonus"))),
            cell(1, 0, CellValue::Text(Arc::from("Ada"))),
            cell(1, 1, CellValue::Number(FiniteF64::new(95.0).unwrap())),
            cell(1, 2, CellValue::Number(FiniteF64::new(5.0).unwrap())),
            cell(2, 0, CellValue::Text(Arc::from("Grace"))),
            cell(2, 1, CellValue::Number(FiniteF64::new(88.0).unwrap())),
            cell(2, 2, CellValue::Number(FiniteF64::new(7.0).unwrap())),
            cell(3, 0, CellValue::Text(Arc::from("Total"))),
            cell(3, 1, CellValue::Null),
            cell(3, 2, CellValue::Null),
        ],
    );
    output.sheets[0].tables = vec![TableSpec {
        id: 1,
        name: "ScoreTable".to_string(),
        display_name: "ScoreTable".to_string(),
        range_ref: "A1:C4".to_string(),
        has_headers: true,
        has_totals: true,
        style_name: Some("TableStyleMedium9".to_string()),
        row_stripes: true,
        col_stripes: true,
        auto_filter_ref: Some("A1:C3".to_string()),
        columns: vec![
            TableColumnSpec {
                id: 1,
                name: "Name".to_string(),
                totals_label: Some("Total".to_string()),
                ..Default::default()
            },
            TableColumnSpec {
                id: 2,
                name: "Score".to_string(),
                totals_function: Some(TotalsFunction::Average),
                ..Default::default()
            },
            TableColumnSpec {
                id: 3,
                name: "Bonus".to_string(),
                totals_function: Some(TotalsFunction::Sum),
                ..Default::default()
            },
        ],
        ..Default::default()
    }];

    let bytes = write_xlsx_from_parse_output(&output).expect("table export should succeed");
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let table_xml = String::from_utf8(archive.read_file("xl/tables/table1.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(sheet_xml.contains(r#"<tableParts count="1">"#));
    assert!(sheet_xml.contains(r#"<tablePart r:id="rId"#));
    assert!(sheet_rels.contains(xlsx_parser::write::REL_TABLE));
    assert!(sheet_rels.contains(r#"Target="../tables/table1.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/tables/table1.xml""#));
    assert!(content_types.contains(xlsx_parser::write::CT_TABLE));
    assert!(table_xml.contains(r#"name="ScoreTable""#));
    assert!(table_xml.contains(r#"displayName="ScoreTable""#));
    assert!(table_xml.contains(r#"ref="A1:C4""#));
    assert!(table_xml.contains(r#"totalsRowCount="1""#));
    assert!(table_xml.contains(r#"<autoFilter ref="A1:C3""#));
    assert!(table_xml.contains(r#"tableColumn id="1" name="Name""#));
    assert!(table_xml.contains(r#"totalsRowLabel="Total""#));
    assert!(table_xml.contains(r#"totalsRowFunction="average""#));
    assert!(table_xml.contains(r#"totalsRowFunction="sum""#));
    assert!(table_xml.contains(r#"name="TableStyleMedium9""#));

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
    let (rt, _diagnostics) = parse_xlsx_to_output(&bytes).expect("exported XLSX should parse back");
    let table = rt.sheets[0]
        .tables
        .iter()
        .find(|table| table.name == "ScoreTable")
        .expect("modeled table should parse back");
    assert_eq!(table.range_ref, "A1:C4");
    assert_eq!(table.columns.len(), 3);
    assert_eq!(
        table.columns[1].totals_function,
        Some(TotalsFunction::Average)
    );
    assert_eq!(table.columns[2].totals_function, Some(TotalsFunction::Sum));
}
