//! Range.insert returns a usable proxy before the queued insert is applied.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;

#[test]
fn insert_returns_range_for_chained_write_and_load() {
    for shift in ["Down", "Right"] {
        let workbook = Workbook::blank().expect("blank workbook").0;
        let script = r#"
        return await Excel.run(async (context) => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("B2:C3").values = [[1, 2], [3, 4]];
          await context.sync();
          const source = sheet.getRange("A1:B2").getOffsetRange(1, 1);
          source.load("values");
          await context.sync();
          const inserted = source.insert("SHIFT");
          if (!(inserted instanceof Excel.Range)) throw new Error("insert must return a Range");
          inserted.values = [[5, 6], [7, 8]];
          inserted.load("address,values,rowCount,columnCount");
          const moved = sheet.getRange("MOVED");
          moved.load("values");
          await context.sync();
          return {
            address: inserted.address, values: inserted.values,
            rows: inserted.rowCount, columns: inserted.columnCount,
            moved: moved.values,
          };
        });
        "#
        .replace("SHIFT", shift)
        .replace("MOVED", if shift == "Down" { "B4:C5" } else { "D2:E3" });
        let output = run_office_js_with_workbook(&workbook, &script)
            .expect("inserted range should support write and load");
        assert_eq!(
            output.value,
            json!({
                "address": "Sheet1!B2:C3", "values": [[5, 6], [7, 8]],
                "rows": 2, "columns": 2, "moved": [[1, 2], [3, 4]],
            })
        );
    }
}
