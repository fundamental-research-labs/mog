use mog::run_office_js;
use serde_json::json;

#[test]
fn structured_sum_refreshes_at_resize_and_later_cell_syncs() {
    let output = run_office_js(
        r#"
      return await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("B2:C3").values=[["Item","Sales"],["A",10]];
        const t=s.tables.add("B2:C3",true); t.name="Data";
        await c.sync();
        s.getRange("E1").formulas=[["=SUM(Data[Sales])"]];
        s.getRange("B4:C4").values=[["B",20]];
        const r=s.getRange("E1"); r.load("values"); await c.sync();
        const before=r.values;
        t.resize("B2:C4"); r.load("values"); await c.sync();
        const expanded=r.values;
        s.getRange("C4").values=[[40]]; r.load("values"); await c.sync();
        const edited=r.values;
        t.resize("B2:C3"); r.load("values"); await c.sync();
        const shrunk=r.values;
        s.getRange("C4").values=[[90]]; r.load("values"); await c.sync();
        return [before,expanded,edited,shrunk,r.values];
      });
    "#,
    )
    .unwrap();
    assert_eq!(
        output.value,
        json!([[[10]], [[30]], [[50]], [[10]], [[10]]])
    );
}
