use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
#[test]
fn formula_text_equality_handles_accented_case_without_changing_exact() {
    let w = Workbook::blank().unwrap().0;
    let result = run_office_js_with_workbook(
        &w,
        r#"
 return await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("A1:A12").formulas=[
 ['="CAFÉ"="café"'],['=COUNTIF({"CAFÉ","café"},"café")'],['="ABC"="abc"'],
 ['="CAFÉ"<>"café"'],['="CAFÉ"="cafe"'],['="CAFÉ"<>"cafe"'],
 ['=EXACT("CAFÉ","café")'],['=EXACT("CAFÉ","CAFÉ")'],
 ['=1=1'],['=1<>2'],['=TRUE=FALSE'],['="1"=1']
 ];
 const r=s.getRange("A1:A12");r.load("values");await c.sync();return r.values;
 });"#,
    )
    .unwrap();
    assert_eq!(
        result.value,
        json!([
            [true],
            [2],
            [true],
            [false],
            [false],
            [true],
            [false],
            [true],
            [true],
            [true],
            [false],
            [false]
        ])
    );
}
