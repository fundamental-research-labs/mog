use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
#[test]
fn xlookup_checks_shapes_before_matching() {
    let workbook = Workbook::blank().unwrap().0;
    let result=run_office_js_with_workbook(&workbook,r#"
 return await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("D1:E3").values=[[1,10],[2,20],[3,30]];
 const fs=[];
 for (const mode of [1,-1,2,-2]) fs.push([`=XLOOKUP(1,D1:D3,E1:E2,,0,${mode})`]);
 fs.push(['=XLOOKUP(1,{1,2,3},{10,20})'],['=XLOOKUP(1,{1,2;3,4},{10,20;30,40})'],['=XLOOKUP(1,{1;2;3},{10;20},,-1)'],['=XLOOKUP(2,D1:D3,E1:E3)']);
 s.getRange("A1:A8").formulas=fs;
 const r=s.getRange("A1:A8");r.load("values");await c.sync();return r.values;
 });"#).unwrap();
    assert_eq!(
        result.value,
        json!([
            ["#VALUE!"],
            ["#VALUE!"],
            ["#VALUE!"],
            ["#VALUE!"],
            ["#VALUE!"],
            ["#VALUE!"],
            ["#VALUE!"],
            [20]
        ])
    );
}
#[test]
fn xlookup_preserves_multi_cell_return_orientation() {
    let workbook = Workbook::blank().unwrap().0;
    let result=run_office_js_with_workbook(&workbook,r#"
 return await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("A1").formulas=[['=XLOOKUP(2,{1;2},{10,11;20,21})']];
 s.getRange("D1").formulas=[['=XLOOKUP(2,{1,2},{10,20;11,21})']];
 const a=s.getRange("A1:B1"),d=s.getRange("D1:D2");a.load("values");d.load("values");await c.sync();return [a.values,d.values];
 });"#).unwrap();
    assert_eq!(result.value, json!([[[20, 21]], [[20], [21]]]));
}
