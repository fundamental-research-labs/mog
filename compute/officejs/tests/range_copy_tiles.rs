use mog::run_office_js;
use serde_json::json;

#[test]
fn larger_destination_repeats_source() {
    let out = run_office_js(
        r#"
      return await Excel.run(async c => {
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1:B1").values=[[1,2]];
        await c.sync();
        s.getRange("D1:G2").copyFrom(s.getRange("A1:B1"),"Values");
        const r=s.getRange("D1:G2"); r.load("values"); await c.sync(); return r.values;
      });
    "#,
    )
    .unwrap();
    assert_eq!(out.value, json!([[1, 2, 1, 2], [1, 2, 1, 2]]));
}

#[test]
fn overlapping_tiles_read_original_source_and_skip_original_blanks() {
    let out = run_office_js(
        r#"
      return await Excel.run(async c => {
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1:F1").values=[[1,null,9,8,7,6]];
        await c.sync();
        s.getRange("B1:E1").copyFrom(s.getRange("A1:B1"),"Values",true);
        const r=s.getRange("A1:F1"); r.load("values"); await c.sync(); return r.values;
      });
    "#,
    )
    .unwrap();
    assert_eq!(out.value, json!([[1, 1, 9, 1, 7, 6]]));
}

#[test]
fn transposed_tiles_and_single_cell_destination_expand() {
    let out = run_office_js(
        r#"
      return await Excel.run(async c => {
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1:B1").values=[[1,2]];
        await c.sync();
        s.getRange("D1:E4").copyFrom(s.getRange("A1:B1"),"Values",false,true);
        s.getRange("G1").copyFrom(s.getRange("A1:B1"),"Values");
        const a=s.getRange("D1:E4"), b=s.getRange("G1:H1");
        a.load("values"); b.load("values"); await c.sync(); return [a.values,b.values];
      });
    "#,
    )
    .unwrap();
    assert_eq!(
        out.value,
        json!([[[1, 1], [2, 2], [1, 1], [2, 2]], [[1, 2]]])
    );
}

#[test]
fn formula_and_format_tiles_use_relative_offsets() {
    let out = run_office_js(
        r#"
      return await Excel.run(async c => {
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1").formulas=[["=B1+$C$1"]];
        s.getRange("A1").numberFormat=[["0.00"]];
        await c.sync();
        s.getRange("D2:E3").copyFrom(s.getRange("A1"),"All");
        const r=s.getRange("D2:E3"); r.load(["formulas","numberFormat"]);
        await c.sync(); return [r.formulas,r.numberFormat];
      });
    "#,
    )
    .unwrap();
    assert_eq!(
        out.value,
        json!([
            [["=E2+$C$1", "=F2+$C$1"], ["=E3+$C$1", "=F3+$C$1"]],
            [["0.00", "0.00"], ["0.00", "0.00"]]
        ])
    );
}

#[test]
fn nonmultiple_shape_retains_single_copy_behavior() {
    let out = run_office_js(
        r#"
      return await Excel.run(async c => {
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1:B1").values=[[1,2]];
        s.getRange("D1:F1").values=[[8,8,8]];
        await c.sync();
        s.getRange("D1:F1").copyFrom(s.getRange("A1:B1"),"Values");
        let code; try { await c.sync(); } catch(e) {code=e.code;}
        const r=s.getRange("D1:F1"); r.load("values"); await c.sync(); return [code,r.values];
      });
    "#,
    )
    .unwrap();
    assert_eq!(out.value, json!([null, [[1, 2, 8]]]));
}

#[test]
fn shorter_but_wider_destination_expands_rows_and_repeats_columns() {
    let out = run_office_js(
        r#"
      return await Excel.run(async c => {
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1:B2").values=[[1,2],[3,4]];
        await c.sync();
        s.getRange("D1:G1").copyFrom(s.getRange("A1:B2"),"Values");
        const r=s.getRange("D1:G2"); r.load("values"); await c.sync(); return r.values;
      });
    "#,
    )
    .unwrap();
    assert_eq!(out.value, json!([[1, 2, 1, 2], [3, 4, 3, 4]]));
}

#[test]
fn tiled_copy_is_one_undo_redo_step() {
    let workbook = compute_api::Workbook::blank().unwrap().0;
    mog::run_office_js_with_workbook(
        &workbook,
        r#"
      await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1:B1").values=[[1,2]];
        await c.sync();
        s.getRange("D1:G2").copyFrom(s.getRange("A1:B1"),"Values");
        await c.sync();
      });
    "#,
    )
    .unwrap();
    let read = r#"return await Excel.run(async c=>{
      const r=c.workbook.worksheets.getItem("Sheet1").getRange("D1:G2");
      r.load("values"); await c.sync(); return r.values;
    });"#;
    workbook.history().undo().unwrap();
    let undone = mog::run_office_js_with_workbook(&workbook, read).unwrap();
    assert_eq!(undone.value, json!([["", "", "", ""], ["", "", "", ""]]));
    workbook.history().redo().unwrap();
    let redone = mog::run_office_js_with_workbook(&workbook, read).unwrap();
    assert_eq!(redone.value, json!([[1, 2, 1, 2], [1, 2, 1, 2]]));
}
