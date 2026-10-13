//! Separate SUMPRODUCT arguments require equal dimensions.
use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;

#[test]
fn sumproduct_requires_matching_argument_dimensions() {
    let workbook = Workbook::blank().unwrap().0;
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
    return await Excel.run(async c => {
      const s = c.workbook.worksheets.getItem("Sheet1");
      s.getRange("A1:A7").formulas = [
        ["=SUMPRODUCT({1,2},{1;2})"],
        ["=SUMPRODUCT({1;2},3)"],
        ["=SUMPRODUCT({1;2},{3;4;5})"],
        ["=SUMPRODUCT({1,2},{3,4})"],
        ["=SUMPRODUCT({1;2},{3;4})"],
        ["=SUMPRODUCT({1,2}*{1;2})"],
        ["=SUMPRODUCT({1;2}*3)"]
      ];
      const r=s.getRange("A1:A7"); r.load("values"); await c.sync(); return r.values;
    });
    "#,
    )
    .unwrap();
    assert_eq!(
        output.value,
        json!([["#VALUE!"], ["#VALUE!"], ["#VALUE!"], [11], [11], [9], [9]])
    );
}
