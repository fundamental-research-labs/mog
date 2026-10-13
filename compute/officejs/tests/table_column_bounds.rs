use mog::run_office_js;
use serde_json::json;

#[test]
fn column_add_and_delete_preserve_rows_outside_table() {
    for position in [0, 1, 2] {
        let output = run_office_js(&format!(r#"
          return await Excel.run(async c => {{
            const s = c.workbook.worksheets.getItem("Sheet1");
            s.getRange("B2:C3").values = [["Item","Sales"],["A",10]];
            const t = s.tables.add("B2:C3",true);
            await c.sync();
            s.getRange("C6:D6").values = [[98,99]];
            s.getRange("B1:D1").values = [[91,92,93]];
            s.getRange("D2:D3").values = [["outside"],[77]];
            await c.sync();
            const added = t.columns.add({position},[["Qty"],[2]]);
            await c.sync();
            const table = t.getRange(), above = s.getRange("B1:D1"), below = s.getRange("C6:E6"), side = s.getRange("E2:E3");
            table.load(["address","values"]); above.load("values"); below.load("values"); side.load("values");
            await c.sync();
            const after = [table.address, table.values, above.values, below.values, side.values];
            added.delete();
            await c.sync();
            const restored = t.getRange(), restoredSide = s.getRange("D2:D3"), restoredBelow = s.getRange("C6:E6");
            restored.load(["address","values"]); restoredSide.load("values"); restoredBelow.load("values");
            await c.sync();
            return [after, [restored.address, restored.values, restoredSide.values, restoredBelow.values]];
          }});
        "#)).unwrap();
        let mut headers = vec![json!("Item"), json!("Sales")];
        let mut values = vec![json!("A"), json!(10)];
        headers.insert(position, json!("Qty"));
        values.insert(position, json!(2));
        assert_eq!(
            output.value,
            json!([
                [
                    "Sheet1!B2:D3",
                    [headers, values],
                    [[91, 92, 93]],
                    [[98, 99, ""]],
                    [["outside"], [77]]
                ],
                [
                    "Sheet1!B2:C3",
                    [["Item", "Sales"], ["A", 10]],
                    [["outside"], [77]],
                    [[98, 99, ""]]
                ]
            ]),
            "position {position}"
        );
    }
}
