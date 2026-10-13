use compute_api::Workbook;
use mog::run_office_js_with_workbook;
#[test]
fn edited_imported_chart_keeps_string_category_cache() {
    let workbook = Workbook::from_xlsx_bytes(include_bytes!("fixtures/issue438.xlsx"))
        .unwrap()
        .0;
    run_office_js_with_workbook(&workbook,r#"
 await Excel.run(async c=>{const s=c.workbook.worksheets.getItem("Sheet1");s.getRange("B2").values=[[15]];await c.sync();});
 "#).unwrap();
    let bytes = workbook.to_xlsx_bytes().unwrap();
    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).unwrap();
    let xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();
    let category = xml
        .split("<c:cat>")
        .nth(1)
        .expect("category")
        .split("</c:cat>")
        .next()
        .unwrap();
    assert!(
        category.contains("<c:strRef>") && category.contains("<c:strCache>"),
        "{category}"
    );
    assert!(!category.contains("<c:numCache>"), "{category}");
    assert!(category.contains("<c:v>A</c:v>") && category.contains("<c:v>B</c:v>"));
}
