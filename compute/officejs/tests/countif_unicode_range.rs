use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;

#[test]
fn unicode_countif_uses_valid_range() {
    let w = Workbook::blank().unwrap().0;
    let result = run_office_js_with_workbook(
        &w,
        r#"
return await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("J1:J2").values=[["CAFÉ"],["café"]];
 s.getRange("A1:A3").formulas=[['="CAFÉ"="café"'],['=COUNTIF(J1:J2,"café")'],['="ABC"="abc"']];
 const r=s.getRange("A1:A3");r.load("values");await c.sync();return r.values;
});"#,
    )
    .unwrap();
    assert_eq!(result.value, json!([[true], [2], [true]]));
}

#[test]
fn unicode_criteria_agree_across_scan_and_cache_paths() {
    let w = Workbook::blank().unwrap().0;
    let result = run_office_js_with_workbook(
        &w,
        r#"
return await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("J1:K4").values=[["CAFÉ",10],["café",20],["cafe",40],["ABC",80]];
 s.getRange("A1:A15").formulas=[
 ['=COUNTIF(J1:J4,"café")'],['=COUNTIF(J1:J4,"=café")'],['=COUNTIF(J1:J4,"<>café")'],
 ['=COUNTIF(J1:J4,"caf?")'],['=COUNTIFS(J1:J4,"café",K1:K4,">0")'],
 ['=SUMIF(J1:J4,"café",K1:K4)'],['=SUMIF(J1:J4,"CAFÉ",K1:K4)'],
 ['=SUMIF(J1:J4,"=café",K1:K4)'],['=SUMIF(J1:J4,"<>café",K1:K4)'],
 ['=SUMIFS(K1:K4,J1:J4,"café")'],['=COUNTIF(J1:J4,"abc")'],
 ['=COUNTIF(K1:K4,">20")'],['=COUNTIF(K1:K4,"20")'],
 ['=EXACT(J1,J2)'],['=COUNTIF(J1:J4,"cafe")']];
 const r=s.getRange("A1:A15");r.load("values");await c.sync();return r.values;
});"#,
    )
    .unwrap();
    assert_eq!(
        result.value,
        json!([
            [2],
            [2],
            [2],
            [3],
            [2],
            [30],
            [30],
            [30],
            [120],
            [30],
            [1],
            [2],
            [1],
            [false],
            [1]
        ])
    );
}
