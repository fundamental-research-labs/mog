use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
#[test]
fn long_this_row_resolves_containing_table() {
    let w = Workbook::blank().unwrap().0;
    let result = run_office_js_with_workbook(
        &w,
        r#"return await Excel.run(async c => {
  const w = c.workbook;
  const s = w.worksheets.getItem("Sheet1");
  s.getRange("A1:C2").values = [["Item","Sales","Double"],["A",10,""]];
  const t = s.tables.add("A1:C2",true);
  t.name = "Data";
  await c.sync();
  s.getRange("C2").formulas = [["=[[#This Row],Sales]*2"]];
  const r = s.getRange("C2");
  r.load("values");
  await c.sync();
  return r.values;
});
"#,
    )
    .unwrap();
    assert_eq!(result.value, json!([[20]]));
}
