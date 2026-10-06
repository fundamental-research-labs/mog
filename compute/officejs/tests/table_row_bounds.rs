use mog::run_office_js;
use serde_json::json;

#[test]
fn table_row_append_preserves_cells_on_both_sides() {
    let output = run_office_js(
        r#"
      return await Excel.run(async c => {
        const s = c.workbook.worksheets.getItem("Sheet1");
        s.getRange("B2:C3").values = [["Item","Sales"],["A",10]];
        const t = s.tables.add("B2:C3",true);
        t.name = "Data";
        await c.sync();
        s.getRange("E4").values = [[99]];
        s.getRange("A4").values = [[88]];
        s.getRange("B4:C4").values = [["tail",77]];
        await c.sync();
        t.rows.add(null,[["B",20]]);
        const left = s.getRange("A4:A5");
        const right = s.getRange("E4:E5");
        const middle = s.getRange("B2:C5");
        left.load("values"); right.load("values"); middle.load("values");
        await c.sync();
        return [left.values, right.values, middle.values];
      });
    "#,
    )
    .unwrap();
    assert_eq!(
        output.value,
        json!([
            [[88], [""]],
            [[99], [""]],
            [["Item", "Sales"], ["A", 10], ["B", 20], ["tail", 77]]
        ])
    );
}
