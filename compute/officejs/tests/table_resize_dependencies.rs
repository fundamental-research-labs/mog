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
        // A gap row stays outside; writing C4 would auto-expand again.
        s.getRange("C5").values=[[90]]; r.load("values"); await c.sync();
        return [before,expanded,edited,shrunk,r.values];
      });
    "#,
    )
    .unwrap();
    assert_eq!(
        output.value,
        json!([[[30]], [[30]], [[50]], [[10]], [[10]]])
    );
}

#[test]
fn original_sync_probe_matches_native_excel_observations() {
    let output = run_office_js(include_str!("fixtures/issue425_sync_observations.js")).unwrap();
    assert_eq!(
        output.stdout.trim(),
        "before_resize=[[30]]\nafter_resize=[[30]]\n[[50]]"
    );
}

#[test]
fn adjacent_row_expansion_and_values_share_one_undo_step() {
    let (workbook, _) = compute_api::Workbook::blank().unwrap();
    mog::run_office_js_with_workbook(
        &workbook,
        r#"
      await Excel.run(async c => {
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("B2:C3").values=[["Item","Sales"],["A",10]];
        const t=s.tables.add("B2:C3",true); t.name="Data";
        await c.sync();
        s.getRange("E1").formulas=[["=SUM(Data[Sales])"]]; await c.sync();
        s.getRange("B4:C4").values=[["B",20]]; await c.sync();
      });
    "#,
    )
    .unwrap();
    let sheet = workbook.sheet_by_name("Sheet1").unwrap();
    assert_eq!(
        sheet
            .tables()
            .get_by_name("Data")
            .unwrap()
            .unwrap()
            .range
            .end_row(),
        3
    );
    workbook.history().undo().unwrap();
    assert_eq!(
        sheet
            .tables()
            .get_by_name("Data")
            .unwrap()
            .unwrap()
            .range
            .end_row(),
        2
    );
    let undone = mog::run_office_js_with_workbook(
        &workbook,
        r#"
      return await Excel.run(async c=>{
        const r=c.workbook.worksheets.getItem("Sheet1").getRange("B4:C4");
        r.load("values"); await c.sync(); return r.values;
      });
    "#,
    )
    .unwrap();
    assert_eq!(undone.value, json!([["", ""]]));
    workbook.history().redo().unwrap();
    assert_eq!(
        sheet
            .tables()
            .get_by_name("Data")
            .unwrap()
            .unwrap()
            .range
            .end_row(),
        3
    );
}

#[test]
fn adjacent_values_do_not_expand_through_another_table() {
    let output = run_office_js(
        r#"
      return await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("B2:C3").values=[["Item","Sales"],["A",10]];
        s.getRange("B4:C5").values=[["Other","Amount"],["Z",7]];
        const first=s.tables.add("B2:C3",true);
        const second=s.tables.add("B4:C5",true);
        await c.sync();
        s.getRange("B4:C4").values=[["Updated","Value"]]; await c.sync();
        const a=first.getRange(),b=second.getRange(),v=s.getRange("B4:C4");
        a.load("address"); b.load("address"); v.load("values"); await c.sync();
        return [a.address,b.address,v.values];
      });
    "#,
    )
    .unwrap();
    assert_eq!(
        output.value,
        json!(["Sheet1!B2:C3", "Sheet1!B4:C5", [["Updated", "Value"]]])
    );
}

#[test]
fn adjacent_expansion_controls_match_native_excel() {
    let output = run_office_js(include_str!("fixtures/issue425_expansion_controls.js")).unwrap();
    let rows: serde_json::Value = serde_json::from_str(output.stdout.trim()).unwrap();
    let expected = [
        ("FullRow", "B2:C4", 30),
        ("Partial", "B2:C4", 30),
        ("Gap", "B2:C3", 10),
        ("Outside", "B2:C3", 10),
        ("Totals", "B2:C4", 10),
        ("TwoRows", "B2:C5", 60),
        ("Clear", "B2:C3", 10),
        ("Null", "B2:C3", 10),
    ];
    for (actual, (name, address, sum)) in rows.as_array().unwrap().iter().zip(expected) {
        assert_eq!(actual["name"], json!(name));
        assert_eq!(actual["address"], json!(format!("{name}!{address}")));
        assert_eq!(actual["sum"], json!([[sum]]));
    }
    assert_eq!(rows.as_array().unwrap().len(), expected.len());
}
