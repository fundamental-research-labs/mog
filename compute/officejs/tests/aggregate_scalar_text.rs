use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
#[test]
fn aggregates_coerce_scalar_text_but_skip_array_and_reference_text() {
    let workbook = Workbook::blank().unwrap().0;
    let result = run_office_js_with_workbook(
        &workbook,
        r#"
 return await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("B1").formulas=[['="2"']];
 const fs=[];
 for(const fn of ["SUM","AVERAGE","MIN","MAX","PRODUCT","SUMSQ"]){
   for(const args of ['"2",4','"abc",4','B1,4','{"2",4}']) fs.push([`=${fn}(${args})`]);
 }
 s.getRange("A1:A24").formulas=fs;
 const r=s.getRange("A1:A24");r.load("values");await c.sync();return r.values;
 });"#,
    )
    .unwrap();
    assert_eq!(
        result.value,
        json!([
            [6],
            ["#VALUE!"],
            [4],
            [4],
            [3],
            ["#VALUE!"],
            [4],
            [4],
            [2],
            ["#VALUE!"],
            [4],
            [4],
            [4],
            ["#VALUE!"],
            [4],
            [4],
            [8],
            ["#VALUE!"],
            [4],
            [4],
            [20],
            ["#VALUE!"],
            [16],
            [16]
        ])
    );
}

#[test]
fn product_and_sumsq_keep_numeric_boolean_error_and_empty_controls() {
    let workbook = Workbook::blank().unwrap().0;
    let result = run_office_js_with_workbook(
        &workbook,
        r#"
    return await Excel.run(async c=>{
      const s=c.workbook.worksheets.getItem("Sheet1");
      s.getRange("B1:B2").values=[[true],[4]];
      s.getRange("A1:A12").formulas=[
        ["=PRODUCT(2,3,4)"],["=SUMSQ(2,3,4)"],
        ["=PRODUCT(TRUE,4)"],["=SUMSQ(TRUE,4)"],
        ["=PRODUCT({TRUE,4})"],["=SUMSQ({TRUE,4})"],
        ["=PRODUCT(B1:B2)"],["=SUMSQ(B1:B2)"],
        ["=PRODUCT(C1:C2)"],["=SUMSQ(C1:C2)"],
        ["=PRODUCT(1/0,2)"],["=SUMSQ(1/0,2)"]
      ];
      const r=s.getRange("A1:A12");r.load("values");await c.sync();return r.values;
    });"#,
    )
    .unwrap();
    assert_eq!(
        result.value,
        json!([
            [24],
            [29],
            [4],
            [17],
            [4],
            [16],
            [4],
            [16],
            [0],
            [0],
            ["#DIV/0!"],
            ["#DIV/0!"]
        ])
    );
}
