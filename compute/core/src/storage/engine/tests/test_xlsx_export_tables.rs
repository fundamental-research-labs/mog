//! XLSX export regressions for runtime-created table metadata.

use super::super::*;
use super::helpers::*;

fn archive_entry_names(bytes: &[u8]) -> Vec<String> {
    xlsx_parser::zip::XlsxArchive::new(bytes)
        .expect("exported XLSX should be readable")
        .entries()
        .iter()
        .map(|entry| entry.name.clone())
        .collect()
}

#[test]
fn runtime_created_range_backed_table_exports_to_xlsx_package() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (0, 0, "Product".to_string()),
                (0, 1, "Q1".to_string()),
                (0, 2, "Q2".to_string()),
                (1, 0, "Widget".to_string()),
                (1, 1, "100".to_string()),
                (1, 2, "150".to_string()),
                (2, 0, "Gadget".to_string()),
                (2, 1, "200".to_string()),
                (2, 2, "180".to_string()),
            ],
        )
        .expect("seed table cells");
    engine
        .create_table_lifecycle(
            &sid,
            Some("SalesData".to_string()),
            0,
            0,
            2,
            2,
            Vec::new(),
            true,
            Some("TableStyleMedium2".to_string()),
        )
        .expect("create range-backed table");
    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (3, 0, "Service".to_string()),
                (3, 1, "50".to_string()),
                (3, 2, "75".to_string()),
            ],
        )
        .expect("seed appended row cells");
    engine
        .resize_table("SalesData", 0, 0, 3, 2)
        .expect("expand table range after append");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    let table = exported.sheets[0]
        .tables
        .iter()
        .find(|table| table.name == "SalesData")
        .expect("runtime-created table should export as TableSpec");
    assert_eq!(table.display_name, "SalesData");
    assert_eq!(table.range_ref, "A1:C4");
    assert_eq!(
        table
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Product", "Q1", "Q2"]
    );
    assert_eq!(table.style_name.as_deref(), Some("TableStyleMedium2"));
    assert_eq!(table.auto_filter_ref.as_deref(), Some("A1:C4"));

    let bytes = engine
        .export_to_xlsx_bytes()
        .expect("runtime-created table should export to XLSX bytes");
    let entries = archive_entry_names(&bytes);
    assert!(entries.iter().any(|entry| entry == "xl/tables/table1.xml"));
    assert!(
        entries
            .iter()
            .any(|entry| entry == "xl/worksheets/_rels/sheet1.xml.rels")
    );

    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).expect("xlsx archive");
    let table_xml = String::from_utf8(archive.read_file("xl/tables/table1.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(table_xml.contains(r#"name="SalesData""#));
    assert!(table_xml.contains(r#"displayName="SalesData""#));
    assert!(table_xml.contains(r#"ref="A1:C4""#));
    assert!(table_xml.contains(r#"name="Product""#));
    assert!(table_xml.contains(r#"name="Q1""#));
    assert!(table_xml.contains(r#"name="Q2""#));
    assert!(sheet_xml.contains(r#"<tableParts count="1">"#));
    assert!(sheet_rels.contains(r#"Target="../tables/table1.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/tables/table1.xml""#));
}
