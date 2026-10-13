use mog::run_office_js;
use serde_json::json;

#[test]
fn copied_self_sheet_reference_uses_copied_values() {
    let out = run_office_js(
        r#"
      return await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1").values=[[2]];
        s.getRange("B1").formulas=[["=Sheet1!A1*3"]];
        await c.sync();
        const other=s.copy("End"); await c.sync();
        other.getRange("A1").values=[[5]];
        const r=other.getRange("B1"); r.load("values"); await c.sync(); return r.values;
      });
    "#,
    )
    .unwrap();
    assert_eq!(out.value, json!([[15]]));
}

#[test]
fn quoted_self_refs_rebind_but_foreign_refs_and_strings_stay() {
    let out=run_office_js(r#"
      return await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1"); s.name="O'Brien";
        const foreign=c.workbook.worksheets.add("Foreign");
        foreign.getRange("A1").values=[[11]];
        s.getRange("A1:A2").values=[[2],[3]];
        s.getRange("B1:D1").formulas=[["=SUM('O''Brien'!A1:A2)","=Foreign!A1+'O''Brien'!$A$1","=\"O'Brien!A1\""]];
        await c.sync();
        const other=s.copy("End"); await c.sync();
        other.getRange("A1:A2").values=[[5],[7]];
        const copy=other.getRange("B1:D1"), original=s.getRange("B1:D1");
        copy.load("values"); original.load("values"); await c.sync();
        return [copy.values,original.values];
      });
    "#).unwrap();
    assert_eq!(
        out.value,
        json!([[[12, 16, "O'Brien!A1"]], [[5, 13, "O'Brien!A1"]]])
    );
}
