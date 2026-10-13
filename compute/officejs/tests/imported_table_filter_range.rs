//! Imported table filter bounds follow the table when Office.js appends a row.
use compute_api::Workbook;
use mog::run_office_js_with_workbook;

#[test]
fn imported_table_append_updates_filter_bounds() {
    let (workbook, _) = Workbook::from_xlsx_bytes(include_bytes!("fixtures/issue434.xlsx"))
        .expect("import exact issue fixture");
    run_office_js_with_workbook(
        &workbook,
        r#"
await Excel.run(async c => {
  const w = c.workbook;
  const s = w.worksheets.getItem("Sheet1");
  s.tables.getItem("Data").rows.add(null, [["B",20]]);
  await c.sync();
});
"#,
    )
    .expect("append with exact issue script");
    let bytes = workbook.to_xlsx_bytes().expect("export appended table");
    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).expect("read exported package");
    let xml = String::from_utf8(archive.read_file("xl/tables/table1.xml").unwrap()).unwrap();
    let table_attributes = xml
        .split("<table ")
        .nth(1)
        .expect("table element")
        .split('>')
        .next()
        .unwrap();
    assert!(
        table_attributes.contains(r#"ref="A1:B3""#),
        "table did not expand: {xml}"
    );
    let filter = xml
        .split("<autoFilter")
        .nth(1)
        .expect("existing filter retained");
    let attributes = filter.split('>').next().unwrap();
    assert!(
        attributes.contains(r#"ref="A1:B3""#),
        "ISSUE_434_FILTER_BOUNDS_FAILED: {xml}"
    );
    assert!(xml.contains(r#"name="Item""#) && xml.contains(r#"name="Sales""#));
}
