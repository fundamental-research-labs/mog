//! Table renames must keep the formula-facing XLSX display name in sync.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use xlsx_parser::XlsxArchive;

#[test]
fn renamed_tables_export_unique_display_names_across_sheets() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    run_office_js_with_workbook(
        &workbook,
        r#"
        await Excel.run(async context => {
            const first = context.workbook.worksheets.getItem("Sheet1");
            first.getRange("A1:B2").values = [["Item", "Amount"], ["A", 1]];
            first.tables.add("A1:B2", true).name = "FirstOrders";
            await context.sync();

            const second = context.workbook.worksheets.add("Other");
            second.getRange("A1:B2").values = [["Item", "Amount"], ["B", 2]];
            second.tables.add("A1:B2", true).name = "SecondOrders";
            await context.sync();
        });
        "#,
    )
    .expect("create and rename tables");

    let bytes = workbook.to_xlsx_bytes().expect("export workbook");
    let archive = XlsxArchive::new(&bytes).expect("read saved XLSX");
    for (part, name) in [(1, "FirstOrders"), (2, "SecondOrders")] {
        let xml = String::from_utf8(
            archive
                .read_file(&format!("xl/tables/table{part}.xml"))
                .expect("saved table part"),
        )
        .expect("UTF-8 table XML");
        assert!(xml.contains(&format!("name=\"{name}\"")), "{xml}");
        assert!(
            xml.contains(&format!("displayName=\"{name}\"")),
            "renamed tables must not retain a shared default displayName: {xml}"
        );
    }
}
