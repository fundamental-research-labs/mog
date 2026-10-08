use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
#[test]
fn sum_ignores_array_booleans_but_coerces_scalar_boolean() {
    let workbook = Workbook::blank().unwrap().0;
    let result=run_office_js_with_workbook(&workbook,r#"
 return await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("B1:B2").values=[[true],[1]];
 s.getRange("A1:A6").formulas=[["=SUM({TRUE,1})"],["=SUM(TRUE,1)"],["=SUM({FALSE,TRUE})"],["=SUM(B1:B2)"],["=COUNT({TRUE,1})"],["=COUNT(TRUE,1)"]];
 const r=s.getRange("A1:A6");r.load("values");await c.sync();return r.values;
 });"#).unwrap();
    assert_eq!(result.value, json!([[1], [2], [0], [1], [1], [2]]));
}
