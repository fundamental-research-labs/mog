use compute_api::Workbook;
use mog::run_office_js_with_workbook;

#[test]
fn bounded_insert_preserves_adjacent_columns_and_rows() {
    for (direction, range, expected) in [
        (
            "Down",
            "A1:A2",
            serde_json::json!([["", 10], ["", 20], [1, ""], [2, ""]]),
        ),
        (
            "Right",
            "A1:B1",
            serde_json::json!([["", "", 1, 10], [2, 20, "", ""]]),
        ),
    ] {
        let workbook = Workbook::blank().unwrap().0;
        let read = if direction == "Down" {
            "A1:B4"
        } else {
            "A1:D2"
        };
        let output = run_office_js_with_workbook(
            &workbook,
            &format!(
                r#"
          return await Excel.run(async c => {{
            const s = c.workbook.worksheets.getItem("Sheet1");
            s.getRange("A1:B2").values = [[1,10],[2,20]];
            await c.sync();
            s.getRange("{range}").insert("{direction}");
            const result = s.getRange("{read}");
            result.load("values");
            await c.sync();
            return result.values;
          }});
        "#
            ),
        )
        .unwrap();
        assert_eq!(output.value, expected, "{direction}");
    }
}

#[test]
fn entire_axis_insert_still_moves_all_cells() {
    for (direction, range, read, expected) in [
        (
            "Down",
            "1:1",
            "A1:B3",
            serde_json::json!([["", ""], [1, 10], [2, 20]]),
        ),
        (
            "Right",
            "A:A",
            "A1:C2",
            serde_json::json!([["", 1, 10], ["", 2, 20]]),
        ),
    ] {
        let workbook = Workbook::blank().unwrap().0;
        let output = run_office_js_with_workbook(
            &workbook,
            &format!(
                r#"
          return await Excel.run(async c => {{
            const s = c.workbook.worksheets.getItem("Sheet1");
            s.getRange("A1:B2").values = [[1,10],[2,20]];
            await c.sync();
            s.getRange("{range}").insert("{direction}");
            const result = s.getRange("{read}");
            result.load("values");
            await c.sync();
            return result.values;
          }});
        "#
            ),
        )
        .unwrap();
        assert_eq!(output.value, expected, "{direction}");
    }
}

#[test]
fn bounded_insert_moves_formulas_and_formats_with_cells() {
    let workbook = Workbook::blank().unwrap().0;
    let output = run_office_js_with_workbook(&workbook, r#"
      return await Excel.run(async c => {
        const s = c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1").values = [[7]];
        s.getRange("A2").formulas = [["=A1*2"]];
        s.getRange("A2").numberFormat = [["0.00"]];
        s.getRange("B1").formulas = [["=A2+1"]];
        await c.sync();
        s.getRange("A1").insert("Down");
        const moved = s.getRange("A3"), neighbor = s.getRange("B1");
        moved.load(["values", "formulas", "numberFormat"]);
        neighbor.load(["values", "formulas"]);
        await c.sync();
        return [moved.values, moved.formulas, moved.numberFormat, neighbor.values, neighbor.formulas];
      });
    "#).unwrap();
    assert_eq!(
        output.value,
        serde_json::json!([[[14]], [["=A2*2"]], [["0.00"]], [[15]], [["=A3+1"]]])
    );
}

#[test]
fn bounded_insert_grows_compact_imported_axes_without_losing_tail_cells() {
    for (script, read, expected) in [
        (
            r#"
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1:B2").values = [[1, 2], [3, 4]];
  sheet.getRange("B1:B2").insert(Excel.InsertShiftDirection.right);
  sheet.getRange("B1:B2").values = [[8], [9]];
  await context.sync();
});
"#,
            "A1:C2",
            serde_json::json!([[1, 8, 2], [3, 9, 4]]),
        ),
        (
            r#"
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1:A3").values = [[1], [2], [3]];
  sheet.getRange("A2:A2").insert(Excel.InsertShiftDirection.down);
  sheet.getRange("A2").values = [[99]];
  await context.sync();
});
"#,
            "A1:A4",
            serde_json::json!([[1], [99], [2], [3]]),
        ),
    ] {
        let workbook = Workbook::from_xlsx_bytes(include_bytes!("fixtures/insert-compact.xlsx"))
            .unwrap()
            .0;
        run_office_js_with_workbook(&workbook, script).unwrap();
        let exported = workbook.to_xlsx_bytes().unwrap();
        let imported = Workbook::from_xlsx_bytes(&exported).unwrap().0;
        for w in [&workbook, &imported] {
            let result=run_office_js_with_workbook(w,&format!(r#"
return await Excel.run(async c=>{{const r=c.workbook.worksheets.getActiveWorksheet().getRange("{read}");r.load("values");await c.sync();return r.values;}});
"#)).unwrap();
            assert_eq!(result.value, expected);
        }
    }
}
