//! Native Excel controls for PHONETIC references and invariant JIS admission.
use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;

#[test]
fn unannotated_phonetic_and_invariant_jis_match_native_errors() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    let result = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async context => {
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          sheet.getRange("C47").values = [["foo bar baz qux"]];
          sheet.getRange("B47:B51").formulas = [
            ["=PHONETIC(C47)"], ["=PHONETIC(C48)"],
            ["=JIS(C48)"], ["=JIS(\"ABC 123\")"], ["=JIS(\"ＡＢＣ　１２３\")"]
          ];
          const result = sheet.getRange("B47:B51");
          result.load("values,valueTypes");
          await context.sync();
          return {values: result.values, types: result.valueTypes};
        });
        "#,
    )
    .expect("Office.js execution");
    assert_eq!(
        result.value,
        json!({"values": [["#N/A"], ["#N/A"], ["#NAME?"], ["#NAME?"], ["#NAME?"]], "types": [["Error"], ["Error"], ["Error"], ["Error"], ["Error"]]})
    );
}
